// 跟进引擎：一次 tick = 检测疑似重复 → 跟踪退款 → 按调度发送提醒。
// 由 ingest/mark/control/advance 之后触发（等价"新数据或约定时间到达后自行检查"）。
import { getNow } from '../domain/simClock.js';
import { findDuplicatePairs, buildLinkMap, duplicateIssueId } from '../domain/duplicateDetector.js';
import { refundIssueId, computeRefundState } from '../domain/refundTracker.js';
import { planReminders } from '../domain/reminderScheduler.js';
import { resolveByRefund, isTerminal, STATUS } from '../domain/issueStateMachine.js';
import { getIssue, addIssue, allIssues } from '../repo/issueRepo.js';
import { appendEvent } from '../repo/eventRepo.js';
import { addReminder, makeReminderId } from '../repo/reminderRepo.js';
import { sendReminder } from './messaging.js';
import { getState } from '../repo/controlRepo.js';

export function tick(node, opts = {}) {
  const now = getNow(node);
  if (now == null) throw new Error('时钟未初始化：tick 前需先设置模拟基准时间');
  const actions = [];
  const controlState = getState(node);

  // 1) 疑似重复：为每个未覆盖的无序交易对建且仅建一条问题（issue_id 由交易对稳定决定 → 幂等）。
  const pairs = findDuplicatePairs(node.transactions);
  const links = buildLinkMap(pairs);
  for (const p of pairs) {
    const id = duplicateIssueId(p.tx_ids[0], p.tx_ids[1]);
    if (!getIssue(node, id)) {
      addIssue(node, {
        issue_id: id,
        kind: 'duplicate',
        status: STATUS.SUSPECT,
        closure_basis: null,
        tx_ids: p.tx_ids,
        link_issue_ids: [],
        refund_id: null,
        created_at: now,
        updated_at: now,
      });
      appendEvent(
        node,
        id,
        'fact_ingested',
        { message: `疑似重复交易对 ${p.tx_ids.join(' & ')}（商户 ${p.merchant}，金额 ${p.amount_cents} 分，时间差 ${p.delta_ms}ms）`, merchant: p.merchant, amount_cents: p.amount_cents, delta_ms: p.delta_ms },
        now,
      );
      actions.push({ type: 'issue_created', issue_id: id });
    }
    const others = links[id] || [];
    const issue = getIssue(node, id);
    if (issue && others.length) {
      const cur = (issue.link_issue_ids || []).slice().sort().join(',');
      const nxt = others.slice().sort().join(',');
      if (cur !== nxt) issue.link_issue_ids = others.slice().sort();
    }
  }

  // 2) 退款：确保每个申请有一个跟踪问题；更新到账/差额；全额到账 → 验证解决（不重开终结态）。
  for (const app of node.refund_applications) {
    const id = refundIssueId(app.refund_id);
    const st = computeRefundState(node, app.refund_id, now);
    let issue = getIssue(node, id);
    if (!issue) {
      addIssue(node, {
        issue_id: id,
        kind: 'refund',
        status: STATUS.SUSPECT,
        closure_basis: null,
        tx_ids: [],
        link_issue_ids: [],
        refund_id: app.refund_id,
        expected_cents: st.expected_cents,
        received_cents: st.received_cents,
        created_at: now,
        updated_at: now,
      });
      appendEvent(node, id, 'fact_ingested', { message: `退款申请 ${app.refund_id}：应退 ${st.expected_cents} 分`, refund_id: app.refund_id, expected_cents: st.expected_cents }, now);
      actions.push({ type: 'issue_created', issue_id: id });
      issue = getIssue(node, id);
    }
    issue.expected_cents = st.expected_cents;
    issue.received_cents = st.received_cents;
    issue.updated_at = now;
    if (st.fully_received && !isTerminal(issue.status)) {
      resolveByRefund(issue);
      appendEvent(node, id, 'status_change', { status: issue.status, closure_basis: issue.closure_basis, message: `全额到账，验证解决（累计 ${st.received_cents} 分）` }, now);
      actions.push({ type: 'resolved', issue_id: id });
    }
  }

  // 3) 提醒调度：关闭态不主动推进；其余按 planReminders 发送（遵守暂停/恢复/终结）。
  if (controlState !== 'closed') {
    for (const issue of allIssues(node)) {
      if (isTerminal(issue.status)) continue;
      const plan = planReminders(node, issue, now, { controlState, resume: !!opts.resume });
      for (const s of plan.toSend) {
        const rid = makeReminderId(issue.issue_id, s.kind, s.seq);
        if (node.reminders.some((x) => x.reminder_id === rid)) continue;
        const reminder = { reminder_id: rid, issue_id: issue.issue_id, kind: s.kind, seq: s.seq, due_at: s.due_at, sent_at: null, status: 'scheduled' };
        addReminder(node, reminder);
        const r = sendReminder(node, issue, reminder, now);
        actions.push({ type: 'reminder', issue_id: issue.issue_id, kind: s.kind, seq: s.seq, result: r.status });
      }
    }
  }

  return actions;
}
