// 交付5：带旁白的等价可重放演示脚本（真实录屏可由用户按此流程录制）。
// 使用独立临时库，不触碰 data/db.json；覆盖 正常/异常/核验 三类路径。
// 运行：node scripts/demo.js   或   npm run demo
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store/jsonStore.js';
import { tick } from '../src/app/followUpEngine.js';
import { ingestTransaction, ingestRefundApplication, ingestRefundReceipt } from '../src/app/ingestService.js';
import { markIssue, setControl } from '../src/app/userService.js';
import { listIssues, report } from '../src/app/queryService.js';
import { beijingMs, setNow, advance } from '../src/domain/simClock.js';

const DAY = '2026-10-01';
const dbPath = path.join(os.tmpdir(), `bill-demo-${Date.now()}.json`);
const store = new Store(dbPath);
store.load();
const node = store.userNode('demo');

const line = (s = '') => console.log(s);
const step = (t) => line(`\n──────── ${t} ────────`);
const showIssues = () => {
  for (const i of listIssues(node)) {
    const extra = i.kind === 'refund'
      ? `应退 ${i.expected_str ?? '?'} / 已收 ${i.received_str ?? '?'} / 尚欠 ${i.remaining_str ?? '?'}${i.overdue ? ' [逾期]' : ''}`
      : `交易 ${i.tx_ids.join('+')}${i.link_issue_ids.length ? `（关联 ${i.link_issue_ids.length} 条）` : ''}`;
    line(`  · ${i.issue_id}  [${i.status_label}]  已提醒 ${i.reminders_sent}  ${extra}`);
  }
};

line('================================================================');
line(' 账单疑似问题跟进系统 —— 演示（纯模拟，无任何真实交易/付款）');
line('================================================================');

step('0) 设置模拟时间基准（北京时间 2026-10-01 09:00）');
setNow(node, beijingMs(DAY, '09:00'));
tick(node);
store.flush();
line('  已建立每用户模拟时钟；后续判定都用它，可 advance，无需等真实数天。');

step('1) 正常路径：疑似重复消费（09:00 与 09:05 各 ¥30，不同编号）');
ingestTransaction(node, { tx_id: 'TX1', merchant: '示例咖啡', amount_cents: 3000, occurred_at: beijingMs(DAY, '09:00') });
ingestTransaction(node, { tx_id: 'TX2', merchant: '示例咖啡', amount_cents: 3000, occurred_at: beijingMs(DAY, '09:05') });
tick(node);
store.flush();
line('  → 引擎自动建“一条”疑似问题（措辞为“疑似”，不断言已证实），并发首次提醒：');
showIssues();

step('2) 核验：用户回复“正常两次购买”→ 记 NORMAL；重放同批交易不重开');
markIssue(node, 'DUP:TX1|TX2', 'normal_two_purchases');
tick(node);
ingestTransaction(node, { tx_id: 'TX2', merchant: '示例咖啡', amount_cents: 3000, occurred_at: beijingMs(DAY, '09:05') });
tick(node);
store.flush();
line('  → 状态 NORMAL；重放同一笔不新增、不重开：');
showIssues();

step('3) 退款逾期：应退 ¥100，满 72h 未到 → 提醒；部分到账显示差额');
ingestRefundApplication(node, { refund_id: 'R1', expected_amount_cents: 10000, confirmed_at: beijingMs(DAY, '09:00') });
advance(node, 72 * 3600 * 1000); // 到 10-04 09:00 逾期
tick(node);
ingestRefundReceipt(node, { receipt_id: 'RC1', refund_id: 'R1', amount_cents: 6000, received_at: beijingMs('2026-10-04', '10:00') });
tick(node);
store.flush();
line('  → 逾期触发首次提醒；到账 ¥60 显示尚欠 ¥40（未满额不算解决）：');
showIssues();

step('4) 全额到账 → 验证解决（VERIFIED_BY_REFUND）；重放到账不累计');
ingestRefundReceipt(node, { receipt_id: 'RC2', refund_id: 'R1', amount_cents: 4000, received_at: beijingMs('2026-10-05', '10:00') });
ingestRefundReceipt(node, { receipt_id: 'RC1', refund_id: 'R1', amount_cents: 6000, received_at: beijingMs('2026-10-04', '10:00') }); // 重放
tick(node);
store.flush();
line('  → 累计满 ¥100 才 RESOLVED；重放不重复累加：');
showIssues();

step('5) 用户控制：暂停后不再主动催办；恢复只按最新数据检查');
ingestRefundApplication(node, { refund_id: 'R2', expected_amount_cents: 5000, confirmed_at: beijingMs(DAY, '09:00') });
setControl(node, 'paused');
advance(node, 72 * 3600 * 1000 + 48 * 3600 * 1000); // 远超期
tick(node);
store.flush();
const pausedR2 = listIssues(node).find((i) => i.issue_id === 'RFD:R2');
line(`  → 暂停期间 R2 逾期但已发送提醒数 = ${pausedR2.reminders_sent}（暂停=停主动提醒，不清计数、不补发）。`);
setControl(node, 'running');
advance(node, 24 * 3600 * 1000);
tick(node);
store.flush();
line('  → 恢复后按最新数据继续检查：');
showIssues();

step('6) 诚实性：到账先到、申请未到 → 列为缺口（孤儿到账），绝不伪装完成');
ingestRefundReceipt(node, { receipt_id: 'RCX', refund_id: 'R_GHOST', amount_cents: 8000, received_at: beijingMs(DAY, '08:00') });
tick(node);
store.flush();
const rep = report(node);
line(`  → report.gaps 如实列出：${JSON.stringify(rep.gaps)}`);
line(`  → 汇总：共 ${rep.counts.total} 个问题，未结 ${rep.counts.open}，已结 ${rep.counts.closed}，控制态 ${rep.control_state}`);

step('7) 中断恢复：从 db.json 读回计数与状态（模拟进程重启）');
const store2 = new Store(dbPath);
store2.load();
const node2 = store2.userNode('demo');
line(`  → 重新读盘后问题数 = ${node2.issues.length}，提醒记录 = ${node2.reminders.filter((r) => r.status === 'sent').length}（计数与状态均保留，不重复处理）。`);

line('\n================================================================');
line(' 演示结束（临时库：' + dbPath + '）。');
line(' 更多逐条断言请运行：node scenarios/run-all.js');
line('================================================================');
