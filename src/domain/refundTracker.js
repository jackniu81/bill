// 退款跟踪（纯函数）：按 refund_id 关联申请与到账；先到账保留、齐全再判；显示差额；72h 逾期。
import { REFUND_OVERDUE_MS } from './rules.js';
import { getNow } from './simClock.js';

export function refundIssueId(refundId) {
  return `RFD:${refundId}`;
}

// 去重到账合计：到账记录以 receipt_id 唯一存储，故直接求和；重放不会重复入库（在仓储层保证）。
export function sumReceipts(node, refundId) {
  return node.refund_receipts
    .filter((r) => r.refund_id === refundId)
    .reduce((s, r) => s + r.amount_cents, 0);
}

export function findApplication(node, refundId) {
  return node.refund_applications.find((a) => a.refund_id === refundId) || null;
}

// 综合退款状态。
export function computeRefundState(node, refundId, now = getNow(node)) {
  const app = findApplication(node, refundId);
  const received = sumReceipts(node, refundId);
  const expected = app ? app.expected_amount_cents : null;
  const state = {
    refund_id: refundId,
    has_application: !!app,
    expected_cents: expected,
    received_cents: received,
    remaining_cents: expected == null ? null : expected - received,
    fully_received: expected != null && received >= expected,
    overdue: false,
    overdue_at: null,
    // 诚实性：到账但无申请 / 有申请未确认时间 都如实标注，不伪装为 0 或已完成。
    note: null,
  };
  if (app) {
    state.overdue_at = app.confirmed_at + REFUND_OVERDUE_MS;
    state.overdue = now >= state.overdue_at && !state.fully_received;
  } else {
    state.note = '有到账但退款申请未到（已保留，齐全后再判断）';
  }
  return state;
}

// 孤儿到账：有 receipt 但无对应 application。
export function orphanReceipts(node) {
  const appIds = new Set(node.refund_applications.map((a) => a.refund_id));
  const ids = new Set();
  for (const r of node.refund_receipts) if (!appIds.has(r.refund_id)) ids.add(r.refund_id);
  return [...ids];
}
