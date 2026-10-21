import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReminders } from '../src/domain/reminderScheduler.js';
import { defaultUserNode } from '../src/store/jsonStore.js';
import { beijingMs } from '../src/domain/simClock.js';
import { REFUND_OVERDUE_MS, FOLLOWUP_INTERVAL_MS } from '../src/domain/rules.js';

const HOUR = 3600 * 1000;

// 构造一个退款问题节点：申请应退 100、confirmed 于 day1 09:00；now 默认已过 72h。
function refundNode() {
  const node = defaultUserNode('u');
  node.clock.now_at = beijingMs('2026-10-01', '09:00');
  node.refund_applications.push({ refund_id: 'R1', expected_amount_cents: 10000, confirmed_at: node.clock.now_at });
  node.issues.push({
    issue_id: 'RFD:R1', kind: 'refund', status: 'SUSPECT', closure_basis: null,
    tx_ids: [], link_issue_ids: [], refund_id: 'R1', expected_cents: 10000, received_cents: 0,
    created_at: node.clock.now_at, updated_at: node.clock.now_at,
  });
  return node;
}
const issueOf = (node) => node.issues[0];
function markSent(node, kind, seq, sentAt) {
  node.reminders.push({ reminder_id: kind === 'first' ? `${node.issues[0].issue_id}:first` : `${node.issues[0].issue_id}:fu${seq}`, issue_id: node.issues[0].issue_id, kind, seq, due_at: sentAt, sent_at: sentAt, status: 'sent' });
}
function addMark(node, action, at, extra = {}) {
  node.issue_events.push({ event_id: `e${node.issue_events.length + 1}`, issue_id: node.issues[0].issue_id, seq: node.issue_events.length + 1, at, type: 'user_mark', payload: { action, ...extra } });
}

test('scheduler: 逾期且未发过 → 规划一条 first（不计追加）', () => {
  const node = refundNode();
  node.clock.now_at += REFUND_OVERDUE_MS; // 恰好逾期
  const plan = planReminders(node, issueOf(node), node.clock.now_at, { controlState: 'running' });
  assert.equal(plan.toSend.length, 1);
  assert.equal(plan.toSend[0].kind, 'first');
  assert.equal(plan.nextDueAt, node.clock.now_at + FOLLOWUP_INTERVAL_MS);
});

test('scheduler: 未满 72h 不发首次', () => {
  const node = refundNode();
  node.clock.now_at += REFUND_OVERDUE_MS - HOUR;
  const plan = planReminders(node, issueOf(node), node.clock.now_at, { controlState: 'running' });
  assert.equal(plan.toSend.length, 0);
});

test('scheduler: first 后 <24h 不追加；≥24h 追加 1；再 ≥24h 追加 2', () => {
  const node = refundNode();
  node.clock.now_at += REFUND_OVERDUE_MS;
  const firstAt = node.clock.now_at;
  markSent(node, 'first', 0, firstAt);

  // +23h：不追加
  let now = firstAt + 23 * HOUR;
  assert.equal(planReminders(node, issueOf(node), now, { controlState: 'running' }).toSend.length, 0);

  // +24h：追加 fu1
  now = firstAt + 24 * HOUR;
  let plan = planReminders(node, issueOf(node), now, { controlState: 'running' });
  assert.equal(plan.toSend.length, 1);
  assert.equal(plan.toSend[0].kind, 'followup');
  assert.equal(plan.toSend[0].seq, 1);
  markSent(node, 'followup', 1, now);

  // 再 +24h：追加 fu2
  now = now + 24 * HOUR;
  plan = planReminders(node, issueOf(node), now, { controlState: 'running' });
  assert.equal(plan.toSend[0].seq, 2);
  markSent(node, 'followup', 2, now);

  // 已达上限，不再追加
  now = now + 48 * HOUR;
  plan = planReminders(node, issueOf(node), now, { controlState: 'running' });
  assert.equal(plan.toSend.length, 0);
  assert.equal(plan.stopped, true);
});

test('scheduler: 确有问题(confirm_problem)停止无回复催办', () => {
  const node = refundNode();
  node.clock.now_at += REFUND_OVERDUE_MS;
  const firstAt = node.clock.now_at;
  markSent(node, 'first', 0, firstAt);
  addMark(node, 'confirm_problem', firstAt + 2 * HOUR);
  const plan = planReminders(node, issueOf(node), firstAt + 30 * HOUR, { controlState: 'running' });
  assert.equal(plan.toSend.length, 0);
  assert.equal(plan.stopped, true);
  assert.match(plan.reason, /确有问题/);
});

test('scheduler: 明天再提醒 → 到期取 max(上次+24h, 标记目标)，次数不清零', () => {
  const node = refundNode();
  node.clock.now_at += REFUND_OVERDUE_MS;
  const firstAt = node.clock.now_at;
  markSent(node, 'first', 0, firstAt);
  const markAt = firstAt + 1 * HOUR;
  const target = firstAt + 10 * HOUR; // 明确约定更早 → 应取上次+24h（较晚者）
  addMark(node, 'remind_tomorrow', markAt, { target_at: target });

  // first+24h 前不发
  assert.equal(planReminders(node, issueOf(node), firstAt + 23 * HOUR, { controlState: 'running' }).toSend.length, 0);
  // first+24h 到期（target 更早被忽略），仍计为追加 seq=1（不清零）
  const plan = planReminders(node, issueOf(node), firstAt + 24 * HOUR, { controlState: 'running' });
  assert.equal(plan.toSend[0].seq, 1);

  // 约定更晚 → 取较晚者
  const node2 = refundNode();
  node2.clock.now_at = firstAt;
  markSent(node2, 'first', 0, firstAt);
  addMark(node2, 'remind_tomorrow', firstAt + 1 * HOUR, { target_at: firstAt + 30 * HOUR });
  assert.equal(planReminders(node2, issueOf(node2), firstAt + 24 * HOUR, { controlState: 'running' }).toSend.length, 0); // 24h<30h
  assert.equal(planReminders(node2, issueOf(node2), firstAt + 30 * HOUR, { controlState: 'running' }).toSend.length, 1); // 到目标
});

test('scheduler: 暂停/关闭控制态 → 不发送', () => {
  const node = refundNode();
  node.clock.now_at += REFUND_OVERDUE_MS;
  const plan = planReminders(node, issueOf(node), node.clock.now_at, { controlState: 'paused' });
  assert.equal(plan.toSend.length, 0);
  assert.equal(plan.stopped, true);
});

test('scheduler: 恢复模式不补发过期提醒（仅报 nextDueAt）', () => {
  const node = refundNode();
  node.clock.now_at += REFUND_OVERDUE_MS;
  markSent(node, 'first', 0, node.clock.now_at);
  // 已过期 3 天，恢复模式应不补发
  const plan = planReminders(node, issueOf(node), node.clock.now_at + 3 * 24 * HOUR, { controlState: 'running', resume: true });
  assert.equal(plan.toSend.length, 0);
  assert.ok(plan.nextDueAt != null);
});

test('scheduler: 终结态（已解决）不再提醒', () => {
  const node = refundNode();
  issueOf(node).status = 'RESOLVED';
  node.clock.now_at += REFUND_OVERDUE_MS;
  const plan = planReminders(node, issueOf(node), node.clock.now_at, { controlState: 'running' });
  assert.equal(plan.toSend.length, 0);
  assert.equal(plan.stopped, true);
});
