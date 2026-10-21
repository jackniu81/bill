// 幂等导入事实。到账为"新事实"，若关联问题已关闭 → 只补记录不重开（引擎后续不会再推进/催办）。
import { addTransaction } from '../repo/transactionRepo.js';
import { addApplication, addReceipt } from '../repo/refundRepo.js';
import { getIssue } from '../repo/issueRepo.js';
import { appendEvent } from '../repo/eventRepo.js';
import { getNow } from '../domain/simClock.js';
import { refundIssueId, computeRefundState } from '../domain/refundTracker.js';
import { STATUS } from '../domain/issueStateMachine.js';
import { formatRMB } from '../domain/money.js';

export function ingestTransaction(node, tx) {
  const now = getNow(node);
  return addTransaction(node, { ...tx, ingested_at: now ?? null });
}

export function ingestRefundApplication(node, app) {
  const now = getNow(node);
  return addApplication(node, { ...app, ingested_at: now ?? null });
}

export function ingestRefundReceipt(node, receipt) {
  const now = getNow(node);
  const r = addReceipt(node, { ...receipt, ingested_at: now ?? null });
  if (r.created) {
    const id = refundIssueId(receipt.refund_id);
    const issue = getIssue(node, id);
    if (issue && issue.status === STATUS.CLOSED) {
      const st = computeRefundState(node, receipt.refund_id, now);
      appendEvent(
        node,
        id,
        'fact_ingested',
        {
          message: `关闭后到账记录：新增 ${formatRMB(receipt.amount_cents)}，累计 ${formatRMB(st.received_cents)}，尚欠 ${formatRMB(Math.max(0, st.remaining_cents ?? 0))}（不重开、不催办）`,
          receipt_id: receipt.receipt_id,
          received_cents: st.received_cents,
        },
        now,
      );
    }
  }
  return r;
}
