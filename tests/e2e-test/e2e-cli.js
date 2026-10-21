// 真·端到端（e2e）验收：通过 spawn 真实 CLI 子进程逐一复现 10 个验收场景。
// 与 run-all.js（进程内直调服务层）互补：这里每条命令都是独立 `node src/cli.js` 进程，
// 读写一份独立临时库（BILL_DB_PATH），因此额外真实覆盖「跨进程持久化 / 中断恢复」。
// 输出格式与退出码与 run-all.js 一致：任一条断言失败 → 非零退出（交付3 验收证据）。
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// 断言助手（内联，不依赖 src/，保证本 e2e 套件与业务代码零耦合）：收集 {desc, ok, err} 供汇总。
function check(desc, fn) {
  let ok = false;
  let err = null;
  try {
    ok = !!fn();
  } catch (e) {
    ok = false;
    err = e.message;
  }
  return { desc, ok, err };
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url)); // 仓库根目录（本文件位于 tests/e2e-test/）
const CLI = path.join(ROOT, 'src', 'cli.js');
const DB = path.join(os.tmpdir(), 'bill-e2e-cli.json');
const ENV = { ...process.env, BILL_DB_PATH: DB };

// 运行一条 CLI 命令并解析其 JSON 输出（user 省略则不追加 --user）。
function cli(args, user) {
  const argv = user ? [...args, '--user', user] : args;
  const out = execFileSync('node', [CLI, ...argv], { encoding: 'utf8', env: ENV, cwd: ROOT });
  return JSON.parse(out);
}
const reset = () => cli(['reset']);
const list = (u) => cli(['list'], u).issues;
const show = (id, u) => cli(['show', id], u).issue;
const gaps = (u) => cli(['report'], u).gaps.map((g) => g.refund_id);
const sent = (id, u) => show(id, u).reminders_sent;

// 三个疑似重复交易（同商户同额、09:00/09:05/09:09，间隔 ≤10min）。
function ingestDupTxs(u, ids) {
  cli(['set-now', '--at', '2026-10-01 09:09'], u);
  for (const [id, at] of ids) cli(['ingest-tx', '--id', id, '--merchant', 'M', '--amount', '30', '--at', `2026-10-01 ${at}`], u);
}

const scenarios = [
  {
    meta: { n: 1, name: '疑似重复消费建一条问题', input: '09:00/09:05 各 ¥30，不同编号 TX1/TX2', expected: '一条 SUSPECT 问题；不删除交易' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:05'], 'u1');
      cli(['ingest-tx', '--id', 'TX1', '--merchant', 'M', '--amount', '30', '--at', '2026-10-01 09:00'], 'u1');
      cli(['ingest-tx', '--id', 'TX2', '--merchant', 'M', '--amount', '30', '--at', '2026-10-01 09:05'], 'u1');
      const dup = list('u1').filter((i) => i.kind === 'duplicate');
      return {
        evidence: { dup_ids: dup.map((d) => d.issue_id), tx_ids: dup[0]?.tx_ids },
        checks: [
          check('生成且仅生成一条疑似问题', () => dup.length === 1),
          check('问题状态为 SUSPECT（疑似）', () => dup[0]?.status === 'SUSPECT'),
          check('关联两笔不同编号交易', () => dup[0]?.tx_ids?.length === 2),
          check('两笔交易都保留（不删除）', () => cli(['report'], 'u1').counts.total === 1 && dup[0]?.tx_ids?.includes('TX1') && dup[0]?.tx_ids?.includes('TX2')),
        ],
      };
    },
  },
  {
    meta: { n: 2, name: '标正常两次购买并重放', input: '同上，标“正常两次购买”，再重放同批交易', expected: '记录 NORMAL；重放不重开、不新增' },
    run: () => {
      reset();
      ingestDupTxs('u2', [['TX1', '09:00'], ['TX2', '09:05']]);
      cli(['mark', 'DUP:TX1|TX2', 'normal'], 'u2');
      cli(['ingest-tx', '--id', 'TX1', '--merchant', 'M', '--amount', '30', '--at', '2026-10-01 09:00'], 'u2'); // 重放
      cli(['ingest-tx', '--id', 'TX2', '--merchant', 'M', '--amount', '30', '--at', '2026-10-01 09:05'], 'u2');
      const issue = show('DUP:TX1|TX2', 'u2');
      const dup = list('u2').filter((i) => i.kind === 'duplicate');
      return {
        evidence: { status: issue.status, closure_basis: issue.closure_basis, dup_count: dup.length },
        checks: [
          check('状态记为 NORMAL', () => issue.status === 'NORMAL'),
          check('结案依据为 USER_MARKED_NORMAL', () => issue.closure_basis === 'USER_MARKED_NORMAL'),
          check('重放后仍只有一条问题（不重开/不新增）', () => dup.length === 1),
        ],
      };
    },
  },
  {
    meta: { n: 3, name: '三笔两两成对→三条并关联', input: '09:00/09:05/09:09 各 ¥30，TX1/TX2/TX3（并重放）', expected: '三条问题且互相关联；重放不新增；均“疑似”' },
    run: () => {
      reset();
      const ids = [['TX1', '09:00'], ['TX2', '09:05'], ['TX3', '09:09']];
      ingestDupTxs('u3', ids);
      for (const [id, at] of ids) cli(['ingest-tx', '--id', id, '--merchant', 'M', '--amount', '30', '--at', `2026-10-01 ${at}`], 'u3'); // 重放
      const dup = list('u3').filter((i) => i.kind === 'duplicate');
      return {
        evidence: { dup_count: dup.length, ids: dup.map((d) => d.issue_id), links: dup.map((d) => d.link_issue_ids?.length) },
        checks: [
          check('三条不同交易对 → 三条问题（重放后仍为 3）', () => dup.length === 3),
          check('三条问题互相关联（各关联另两条）', () => dup.every((d) => d.link_issue_ids?.length === 2)),
          check('均为 SUSPECT 疑似，未表述为已证实', () => dup.every((d) => d.status === 'SUSPECT')),
        ],
      };
    },
  },
  {
    meta: { n: 4, name: '退款逾期→部分到账→全额解决', input: '应退 ¥100；满 72h 未到；再到 ¥60、¥40；重放到账', expected: '先逾期提醒；显示差额 40；全额解决；重放不累计' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:00'], 'u4');
      cli(['ingest-refund', '--refund-id', 'R1', '--expected', '100', '--confirmed-at', '2026-10-01 09:00'], 'u4');
      const before = sent('RFD:R1', 'u4');
      cli(['advance', '72h'], 'u4');
      const after = sent('RFD:R1', 'u4');
      cli(['ingest-receipt', '--receipt-id', 'RC60', '--refund-id', 'R1', '--amount', '60', '--received-at', '2026-10-04 10:00'], 'u4');
      const mid = show('RFD:R1', 'u4');
      cli(['ingest-receipt', '--receipt-id', 'RC40', '--refund-id', 'R1', '--amount', '40', '--received-at', '2026-10-05 10:00'], 'u4');
      cli(['ingest-receipt', '--receipt-id', 'RC60', '--refund-id', 'R1', '--amount', '60', '--received-at', '2026-10-04 10:00'], 'u4'); // 重放
      const end = show('RFD:R1', 'u4');
      return {
        evidence: { before, after, mid: { received: mid.received_cents, remaining: mid.remaining_cents }, end: { status: end.status, basis: end.closure_basis, received: end.received_cents } },
        checks: [
          check('满 72h 前不发逾期提醒', () => before === 0),
          check('满 72h 未全额到账 → 触发逾期提醒', () => after === 1),
          check('部分到账显示差额（已收 60，剩 40）', () => mid.received_cents === 6000 && mid.remaining_cents === 4000 && mid.status === 'SUSPECT'),
          check('全额到账才验证解决', () => end.status === 'RESOLVED' && end.closure_basis === 'VERIFIED_BY_REFUND'),
          check('重放到账不累计（仍为 100）', () => end.received_cents === 10000),
        ],
      };
    },
  },
  {
    meta: { n: 5, name: '全额到账先于申请', input: '先到账 ¥100（申请未到），随后申请到达', expected: '齐全即显示到账并解决；不发过期逾期消息' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:00'], 'u5');
      cli(['ingest-receipt', '--receipt-id', 'RC100', '--refund-id', 'R2', '--amount', '100', '--received-at', '2026-10-01 08:00'], 'u5');
      const gapsBefore = gaps('u5');
      cli(['ingest-refund', '--refund-id', 'R2', '--expected', '100', '--confirmed-at', '2026-10-01 09:00'], 'u5');
      const issue = show('RFD:R2', 'u5');
      const gapsAfter = gaps('u5');
      return {
        evidence: { orphanGaps: gapsBefore, status: issue.status, basis: issue.closure_basis, reminders: issue.reminders_sent, gapsAfter },
        checks: [
          check('先到账被保留并列为缺口（诚实呈现）', () => gapsBefore.includes('R2')),
          check('申请到达后齐全 → 显示到账并验证解决', () => issue.status === 'RESOLVED' && issue.closure_basis === 'VERIFIED_BY_REFUND'),
          check('不发过期逾期消息', () => issue.reminders_sent === 0),
          check('齐全后缺口不再悬挂', () => !gapsAfter.includes('R2')),
        ],
      };
    },
  },
  {
    meta: { n: 6, name: '首次提醒后持续不回复', input: '退款 ¥100 满 72h 逾期，之后一直不回复', expected: '≥24/48h 各追加一次，最多两次，以后不催' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:00'], 'u6');
      cli(['ingest-refund', '--refund-id', 'R6', '--expected', '100', '--confirmed-at', '2026-10-01 09:00'], 'u6');
      cli(['advance', '72h'], 'u6');
      const atOverdue = sent('RFD:R6', 'u6');
      cli(['advance', '24h'], 'u6');
      const atPlus24 = sent('RFD:R6', 'u6');
      cli(['advance', '24h'], 'u6');
      const atPlus48 = sent('RFD:R6', 'u6');
      cli(['advance', '72h'], 'u6');
      const after = sent('RFD:R6', 'u6');
      return {
        evidence: { atOverdue, atPlus24, atPlus48, after },
        checks: [
          check('逾期触发首次提醒（=1）', () => atOverdue === 1),
          check('≥24h 追加第一次（=2）', () => atPlus24 === 2),
          check('≥48h 追加第二次（=3）', () => atPlus48 === 3),
          check('最多两次，之后不再催（=3）', () => after === 3),
        ],
      };
    },
  },
  {
    meta: { n: 7, name: '明天再提醒', input: '逾期首次提醒后，用户回复“明天再提醒”', expected: '至少延后 24h；次数不清零' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:00'], 'u7');
      cli(['ingest-refund', '--refund-id', 'R7', '--expected', '100', '--confirmed-at', '2026-10-01 09:00'], 'u7');
      cli(['advance', '72h'], 'u7');
      const afterFirst = sent('RFD:R7', 'u7');
      cli(['mark', 'RFD:R7', 'tomorrow'], 'u7');
      cli(['advance', '23h'], 'u7');
      const before24 = sent('RFD:R7', 'u7');
      cli(['advance', '1h'], 'u7');
      const at24 = sent('RFD:R7', 'u7');
      return {
        evidence: { afterFirst, before24, at24 },
        checks: [
          check('逾期首次提醒（=1）', () => afterFirst === 1),
          check('标记“明天再提醒”不立即触发（23h 时仍=1）', () => before24 === 1),
          check('满 24h 才发第 2 条（追加计入次数、不清零）', () => at24 === 2),
        ],
      };
    },
  },
  {
    meta: { n: 8, name: '确认重复但无解决结果', input: '疑似重复消费，用户“确有问题”，但无解决事实', expected: 'PENDING_RESOLUTION（待解决）；确有问题 ≠ 解决' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:05'], 'u8');
      cli(['ingest-tx', '--id', 'TX1', '--merchant', 'M', '--amount', '30', '--at', '2026-10-01 09:00'], 'u8');
      cli(['ingest-tx', '--id', 'TX2', '--merchant', 'M', '--amount', '30', '--at', '2026-10-01 09:05'], 'u8');
      cli(['mark', 'DUP:TX1|TX2', 'confirm'], 'u8');
      const issue = show('DUP:TX1|TX2', 'u8');
      return {
        evidence: { status: issue.status, closure_basis: issue.closure_basis },
        checks: [
          check('状态为 PENDING_RESOLUTION（待解决）', () => issue.status === 'PENDING_RESOLUTION'),
          check('结案依据为空（确有问题不等于解决）', () => issue.closure_basis == null),
        ],
      };
    },
  },
  {
    meta: { n: 9, name: '关闭后到账', input: '退款逾期后关闭问题，之后有到账', expected: '只补事实记录；不重新打开、不催办' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:00'], 'u9');
      cli(['ingest-refund', '--refund-id', 'R9', '--expected', '100', '--confirmed-at', '2026-10-01 09:00'], 'u9');
      cli(['advance', '72h'], 'u9');
      const beforeClose = sent('RFD:R9', 'u9');
      cli(['mark', 'RFD:R9', 'close'], 'u9');
      cli(['ingest-receipt', '--receipt-id', 'RC9', '--refund-id', 'R9', '--amount', '50', '--received-at', '2026-10-06 10:00'], 'u9');
      const issue = show('RFD:R9', 'u9');
      const facts = (issue.timeline || []).filter((t) => t.type === 'fact_ingested').length;
      return {
        evidence: { status: issue.status, beforeClose, remindersAfter: issue.reminders_sent, arrivalFacts: facts },
        checks: [
          check('关闭后状态为 CLOSED', () => issue.status === 'CLOSED'),
          check('到账不重新打开（仍 CLOSED）', () => issue.status === 'CLOSED'),
          check('到账不触发催办（提醒数不变）', () => issue.reminders_sent === beforeClose),
          check('补记到账事实（append-only fact_ingested）', () => facts >= 1),
        ],
      };
    },
  },
  {
    meta: { n: 10, name: '中断恢复保留计数与状态', input: '逾期首次提醒后进程重启（每条 CLI 即独立进程），再继续推进', expected: '读回计数与状态不重发；继续追加且最多两次' },
    run: () => {
      reset();
      cli(['set-now', '--at', '2026-10-01 09:00'], 'u10');
      cli(['ingest-refund', '--refund-id', 'R10', '--expected', '100', '--confirmed-at', '2026-10-01 09:00'], 'u10');
      cli(['advance', '72h'], 'u10');
      const afterFirst = sent('RFD:R10', 'u10'); // 新进程读盘 → 不重发
      const statusAfter = show('RFD:R10', 'u10').status;
      cli(['advance', '24h'], 'u10');
      const fu1 = sent('RFD:R10', 'u10');
      cli(['advance', '24h'], 'u10');
      const fu2 = sent('RFD:R10', 'u10');
      cli(['advance', '72h'], 'u10');
      const finalCount = sent('RFD:R10', 'u10');
      return {
        evidence: { afterFirst, statusAfter, fu1, fu2, finalCount },
        checks: [
          check('重启读回首次提醒计数（不重发，=1）', () => afterFirst === 1),
          check('重启后处理状态保留（仍 SUSPECT，未终结）', () => statusAfter === 'SUSPECT'),
          check('重启后仍按规则追加（first+24h → =2）', () => fu1 === 2),
          check('第二次追加（=3）', () => fu2 === 3),
          check('最多两次，之后不再催（仍=3）', () => finalCount === 3),
        ],
      };
    },
  },
];

// —— 汇总（与 run-all.js 同格式）——
let totalChecks = 0;
let failedChecks = 0;
const scenarioResults = [];

reset(); // 保证干净起点
try {
  for (const { meta, run } of scenarios) {
    console.log('\n' + '='.repeat(72));
    console.log(`[CLI-e2e] 场景 ${meta.n}：${meta.name}`);
    console.log(`  输入：${meta.input}`);
    console.log(`  预期：${meta.expected}`);
    console.log('-'.repeat(72));

    let result;
    let runErr = null;
    try {
      result = run();
    } catch (e) {
      runErr = e;
    }
    if (runErr) {
      console.log(`  ✗ 运行异常：${runErr.message}`);
      scenarioResults.push({ n: meta.n, name: meta.name, ok: false, passed: 0, failed: 1 });
      failedChecks += 1;
      totalChecks += 1;
      continue;
    }

    console.log(`  证据：${JSON.stringify(result.evidence)}`);
    let passed = 0;
    let failed = 0;
    for (const c of result.checks) {
      totalChecks += 1;
      if (c.ok) {
        passed += 1;
        console.log(`    ✓ ${c.desc}`);
      } else {
        failed += 1;
        failedChecks += 1;
        console.log(`    ✗ ${c.desc}${c.err ? '（异常：' + c.err + '）' : ''}`);
      }
    }
    scenarioResults.push({ n: meta.n, name: meta.name, ok: failed === 0, passed, failed });
  }
} finally {
  try {
    fs.rmSync(DB, { force: true }); // 清理临时库
  } catch {}
}

console.log('\n' + '='.repeat(72));
console.log('CLI 端到端验收汇总');
console.log('='.repeat(72));
for (const r of scenarioResults) {
  const flag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${flag}] 场景 ${String(r.n).padStart(2)}  ${r.name}  （通过 ${r.passed} / 失败 ${r.failed}）`);
}
const scenariosFailed = scenarioResults.filter((r) => !r.ok).length;
console.log('-'.repeat(72));
console.log(`  场景：${scenarioResults.length - scenariosFailed}/${scenarioResults.length} 通过；断言：${totalChecks - failedChecks}/${totalChecks} 通过`);

if (failedChecks > 0) {
  console.log('\n结果：FAIL（存在未通过项，如实呈现，不伪装为通过）');
  process.exit(1);
} else {
  console.log('\n结果：PASS（全部 CLI 端到端场景通过）');
}
