// 模拟消息发送 + 诚实性：发送前已关闭/终结则不发（如实保留不声称撤回）；措辞遵守"疑似不称已证实"。
import { getState } from '../repo/controlRepo.js';
import { isTerminal } from '../domain/issueStateMachine.js';
import { appendEvent } from '../repo/eventRepo.js';
import { computeRefundState } from '../domain/refundTracker.js';
import { getTransaction } from '../repo/transactionRepo.js';
import { formatRMB } from '../domain/money.js';

export function buildReminderText(node, issue) {
  if (issue.kind === 'refund') {
    const st = computeRefundState(node, issue.refund_id);
    return `【退款逾期提醒】${issue.refund_id}：应退 ${formatRMB(st.expected_cents ?? 0)}，已到账 ${formatRMB(st.received_cents ?? 0)}，尚欠 ${formatRMB(Math.max(0, st.remaining_cents ?? 0))}（自申请确认满 72 小时仍未全额到账）。`;
  }
  const t0 = getTransaction(node, issue.tx_ids[0]);
  const merchant = t0 ? t0.merchant : '?';
  const amount = t0 ? formatRMB(t0.amount_cents) : '?';
  const related = issue.link_issue_ids && issue.link_issue_ids.length
    ? `（属同一疑似簇，共 ${issue.link_issue_ids.length + 1} 个疑似交易对且互相关联；尚未证实为错误扣款）`
    : '';
  return `【疑似重复消费】交易 ${issue.tx_ids.join(' 与 ')}（商户 ${merchant}，金额 ${amount}）发生时间相差 ≤10 分钟，请确认：${related}`;
}

// 发送提醒；返回 {status, reason}。模拟环境发送即成功；仅在发送前处于关闭/终结时不发。
export function sendReminder(node, issue, reminder, now) {
  const controlState = getState(node);
  if (controlState === 'closed' || isTerminal(issue.status)) {
    reminder.status = 'cancelled';
    return { status: 'cancelled', reason: '发送前已关闭/终结，未发送（如实保留，不声称撤回）' };
  }
  reminder.status = 'sent';
  reminder.sent_at = now;
  appendEvent(node, issue.issue_id, 'reminder_sent', { kind: reminder.kind, seq: reminder.seq, text: buildReminderText(node, issue) }, now);
  return { status: 'sent' };
}
