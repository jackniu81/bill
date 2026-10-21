// 查询/进展报告：list/show/report。缺失与失败如实呈现（孤儿到账等）。
import { allIssues, getIssue } from '../repo/issueRepo.js';
import { eventsFor } from '../repo/eventRepo.js';
import { listFor } from '../repo/reminderRepo.js';
import { getTransaction } from '../repo/transactionRepo.js';
import { getState } from '../repo/controlRepo.js';
import { computeRefundState, orphanReceipts } from '../domain/refundTracker.js';
import { formatRMB } from '../domain/money.js';
import { formatBeijing, getNow } from '../domain/simClock.js';
import { isTerminal } from '../domain/issueStateMachine.js';

function statusLabel(issue) {
  switch (issue.status) {
    case 'SUSPECT':
      return issue.kind === 'duplicate' ? '疑似重复·待确认' : '退款进行中·待全额到账';
    case 'PENDING_RESOLUTION':
      return '已确认问题·待解决';
    case 'RESOLVED':
      return '已解决（验证退款到账）';
    case 'NORMAL':
      return '正常两次购买';
    case 'SELF_RESOLVED':
      return '用户已自行解决';
    case 'CLOSED':
      return '已关闭';
    default:
      return issue.status;
  }
}

export function summarize(node, issue) {
  const base = {
    issue_id: issue.issue_id,
    kind: issue.kind,
    status: issue.status,
    status_label: statusLabel(issue),
    closure_basis: issue.closure_basis,
    created_at: issue.created_at,
    created_at_str: formatBeijing(issue.created_at),
  };
  if (issue.kind === 'refund') {
    const st = computeRefundState(node, issue.refund_id);
    base.refund_id = issue.refund_id;
    base.expected_cents = st.expected_cents;
    base.received_cents = st.received_cents;
    base.remaining_cents = st.remaining_cents;
    base.expected_str = st.expected_cents == null ? '未知' : formatRMB(st.expected_cents);
    base.received_str = formatRMB(st.received_cents);
    base.remaining_str = st.remaining_cents == null ? '未知' : formatRMB(Math.max(0, st.remaining_cents));
    base.overdue = st.overdue;
    base.overdue_at_str = st.overdue_at == null ? '未知' : formatBeijing(st.overdue_at);
    base.note = st.note;
  } else {
    base.tx_ids = issue.tx_ids;
    base.link_issue_ids = issue.link_issue_ids || [];
    base.txns = issue.tx_ids.map((id) => {
      const t = getTransaction(node, id);
      return t
        ? { tx_id: t.tx_id, merchant: t.merchant, amount_str: formatRMB(t.amount_cents), occurred_at_str: formatBeijing(t.occurred_at) }
        : null;
    });
  }
  const rem = listFor(node, issue.issue_id).filter((r) => r.status === 'sent');
  base.reminders_sent = rem.length;
  base.last_reminder_str = rem.length ? formatBeijing(rem[rem.length - 1].sent_at) : null;
  return base;
}

export function listIssues(node) {
  return allIssues(node).map((i) => summarize(node, i));
}

export function showIssue(node, issueId) {
  const issue = getIssue(node, issueId);
  if (!issue) return null;
  return {
    ...summarize(node, issue),
    timeline: eventsFor(node, issueId).map((e) => ({
      at_str: formatBeijing(e.at),
      type: e.type,
      detail: e.payload?.message || e.payload?.text || JSON.stringify(e.payload),
    })),
  };
}

export function report(node) {
  const issues = listIssues(node);
  const gaps = orphanReceipts(node).map((oid) => ({
    type: 'orphan_receipt',
    refund_id: oid,
    message: `退款 ${oid} 有到账但申请未到（已保留，齐全后再判断）`,
  }));
  return {
    user_id: node.user_id,
    control_state: getState(node),
    now_str: formatBeijing(getNow(node)),
    counts: {
      total: issues.length,
      open: issues.filter((i) => !isTerminal(i.status)).length,
      closed: issues.filter((i) => isTerminal(i.status)).length,
    },
    issues,
    gaps,
  };
}
