// 疑似重复消费检测（纯函数，无 I/O）。
// 规则：同用户(已在节点内隐含)+同商户+同金额+发生时间差 ≤ 窗口+不同编号 → 每个无序交易对建且仅一条。
import { DUPLICATE_WINDOW_MS } from './rules.js';

export function sortedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// 交易对决定出的问题 id 稳定可重放：重放同一对映射到同一 id → 天然幂等。
export function duplicateIssueId(a, b) {
  const [x, y] = sortedPair(a, b);
  return `DUP:${x}|${y}`;
}

// 返回所有满足条件的无序交易对。transactions 需含 tx_id/merchant/amount_cents/occurred_at。
export function findDuplicatePairs(transactions, windowMs = DUPLICATE_WINDOW_MS) {
  const txs = transactions.slice().sort((p, q) => p.occurred_at - q.occurred_at);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < txs.length; i++) {
    const a = txs[i];
    for (let j = i + 1; j < txs.length; j++) {
      const b = txs[j];
      if (b.occurred_at - a.occurred_at > windowMs) break; // 已按时间升序
      if (a.tx_id === b.tx_id) continue;
      if (a.merchant !== b.merchant) continue;
      if (a.amount_cents !== b.amount_cents) continue;
      const [x, y] = sortedPair(a.tx_id, b.tx_id);
      const key = `${x}|${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        pair_key: key,
        tx_ids: [x, y],
        merchant: a.merchant,
        amount_cents: a.amount_cents,
        delta_ms: b.occurred_at - a.occurred_at,
      });
    }
  }
  return out;
}

// 按共享交易做并查集，把同一簇内的多条疑似问题互相关联（三笔两两 → 三条并关联）。
export function buildLinkMap(pairs) {
  const parent = {};
  const find = (x) => {
    if (parent[x] == null) parent[x] = x;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (x, y) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  for (const p of pairs) {
    find(p.tx_ids[0]);
    find(p.tx_ids[1]);
    union(p.tx_ids[0], p.tx_ids[1]);
  }
  const comp = {};
  for (const p of pairs) {
    const r = find(p.tx_ids[0]);
    (comp[r] ??= []).push(duplicateIssueId(p.tx_ids[0], p.tx_ids[1]));
  }
  const links = {};
  for (const ids of Object.values(comp)) {
    if (ids.length <= 1) continue;
    for (const id of ids) links[id] = ids.filter((o) => o !== id).sort();
  }
  return links;
}
