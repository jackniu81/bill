import { ensureUniqueById } from './idgen.js';

// 交易按 tx_id 幂等：重放同一编号不新增（不删除交易，符合"不删交易"）。
export function addTransaction(node, tx) {
  const rec = {
    tx_id: tx.tx_id,
    merchant: tx.merchant,
    amount_cents: tx.amount_cents,
    occurred_at: tx.occurred_at,
    ingested_at: tx.ingested_at ?? null,
  };
  return ensureUniqueById(node.transactions, rec, 'tx_id');
}

export function getTransaction(node, txId) {
  return node.transactions.find((t) => t.tx_id === txId) || null;
}
