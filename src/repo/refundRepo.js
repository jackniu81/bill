import { ensureUniqueById } from './idgen.js';

// 退款申请按 refund_id 幂等。
export function addApplication(node, app) {
  const rec = {
    refund_id: app.refund_id,
    expected_amount_cents: app.expected_amount_cents,
    confirmed_at: app.confirmed_at,
    ingested_at: app.ingested_at ?? null,
  };
  return ensureUniqueById(node.refund_applications, rec, 'refund_id');
}

// 到账按 receipt_id 幂等：重放不累计；先到账也保留（即便申请未到）。
export function addReceipt(node, receipt) {
  const rec = {
    receipt_id: receipt.receipt_id,
    refund_id: receipt.refund_id,
    amount_cents: receipt.amount_cents,
    received_at: receipt.received_at,
    ingested_at: receipt.ingested_at ?? null,
  };
  return ensureUniqueById(node.refund_receipts, rec, 'receipt_id');
}
