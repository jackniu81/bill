import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Store, defaultUserNode } from '../src/store/jsonStore.js';
import { tick } from '../src/app/followUpEngine.js';
import { ingestTransaction, ingestRefundApplication, ingestRefundReceipt } from '../src/app/ingestService.js';
import { markIssue, setControl } from '../src/app/userService.js';
import { beijingMs, setNow, advance } from '../src/domain/simClock.js';

const sent = (node, id) => node.reminders.filter((r) => r.issue_id === id && r.status === 'sent');
const issue = (node, id) => node.issues.find((i) => i.issue_id === id);

test('engine: 疑似重复建一条 SUSPECT + 首次提醒；重放交易不新增、不重发', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:05'));
  ingestTransaction(node, { tx_id: 'TX1', merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', '09:00') });
  ingestTransaction(node, { tx_id: 'TX2', merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', '09:05') });
  tick(node);
  const id = 'DUP:TX1|TX2';
  assert.equal(node.issues.filter((i) => i.kind === 'duplicate').length, 1);
  assert.equal(issue(node, id).status, 'SUSPECT');
  assert.equal(sent(node, id).length, 1);

  // 重放同样交易
  ingestTransaction(node, { tx_id: 'TX1', merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', '09:00') });
  ingestTransaction(node, { tx_id: 'TX2', merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', '09:05') });
  tick(node);
  assert.equal(node.transactions.length, 2);
  assert.equal(node.issues.filter((i) => i.kind === 'duplicate').length, 1);
  assert.equal(sent(node, id).length, 1); // 不重发
});

test('engine: 三笔两两 → 三条并互相关联', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:09'));
  for (const [id, t] of [['TX1', '09:00'], ['TX2', '09:05'], ['TX3', '09:09']]) {
    ingestTransaction(node, { tx_id: id, merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', t) });
  }
  tick(node);
  const dups = node.issues.filter((i) => i.kind === 'duplicate');
  assert.equal(dups.length, 3);
  for (const d of dups) assert.equal(d.link_issue_ids.length, 2);
  tick(node); // 幂等
  assert.equal(node.issues.filter((i) => i.kind === 'duplicate').length, 3);
});

test('engine: 退款逾期→提醒；全额到账→解决且不再提醒；重放到账不累计', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:00'));
  ingestRefundApplication(node, { refund_id: 'R1', expected_amount_cents: 10000, confirmed_at: beijingMs('2026-10-01', '09:00') });
  const id = 'RFD:R1';
  assert.equal(sent(node, id).length, 0); // 未到期

  advance(node, 72 * 3600 * 1000); // 逾期
  tick(node);
  assert.equal(sent(node, id).length, 1);

  ingestRefundReceipt(node, { receipt_id: 'RC1', refund_id: 'R1', amount_cents: 6000, received_at: beijingMs('2026-10-04', '10:00') });
  tick(node);
  assert.equal(issue(node, id).received_cents, 6000);
  assert.equal(issue(node, id).status, 'SUSPECT'); // 部分到账仍未解决

  ingestRefundReceipt(node, { receipt_id: 'RC2', refund_id: 'R1', amount_cents: 4000, received_at: beijingMs('2026-10-05', '10:00') });
  tick(node);
  assert.equal(issue(node, id).status, 'RESOLVED');
  assert.equal(issue(node, id).closure_basis, 'VERIFIED_BY_REFUND');

  // 重放到账
  ingestRefundReceipt(node, { receipt_id: 'RC1', refund_id: 'R1', amount_cents: 6000, received_at: beijingMs('2026-10-04', '10:00') });
  tick(node);
  assert.equal(issue(node, id).received_cents, 10000);
});

test('engine: 全额先于申请到账 → 齐全即解决、不发逾期', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:00'));
  ingestRefundReceipt(node, { receipt_id: 'RC1', refund_id: 'R2', amount_cents: 10000, received_at: beijingMs('2026-10-01', '08:00') });
  tick(node);
  assert.equal(node.issues.filter((i) => i.kind === 'refund').length, 0); // 申请未到，仅孤儿到账
  ingestRefundApplication(node, { refund_id: 'R2', expected_amount_cents: 10000, confirmed_at: beijingMs('2026-10-01', '09:00') });
  tick(node);
  const id = 'RFD:R2';
  assert.equal(issue(node, id).status, 'RESOLVED');
  assert.equal(sent(node, id).length, 0);
});

test('engine: 标记 NORMAL 后重放不重开', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:05'));
  ingestTransaction(node, { tx_id: 'TX1', merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', '09:00') });
  ingestTransaction(node, { tx_id: 'TX2', merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', '09:05') });
  tick(node);
  const id = 'DUP:TX1|TX2';
  markIssue(node, id, 'normal_two_purchases');
  assert.equal(issue(node, id).status, 'NORMAL');
  ingestTransaction(node, { tx_id: 'TX2', merchant: 'M', amount_cents: 3000, occurred_at: beijingMs('2026-10-01', '09:05') });
  tick(node);
  assert.equal(issue(node, id).status, 'NORMAL'); // 不重开
});

test('engine: control closed → 逾期也不发提醒', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:00'));
  ingestRefundApplication(node, { refund_id: 'R1', expected_amount_cents: 10000, confirmed_at: beijingMs('2026-10-01', '09:00') });
  setControl(node, 'closed');
  advance(node, 72 * 3600 * 1000);
  tick(node);
  assert.equal(sent(node, 'RFD:R1').length, 0);
});

test('engine: 中断恢复(落盘重读) → 计数与状态保留、不重复处理', () => {
  const dbPath = path.join(os.tmpdir(), `bill-engine-test-${Date.now()}.json`);
  const store = new Store(dbPath);
  store.load();
  const node = store.userNode('u10');
  setNow(node, beijingMs('2026-10-01', '09:00'));
  ingestRefundApplication(node, { refund_id: 'R1', expected_amount_cents: 10000, confirmed_at: beijingMs('2026-10-01', '09:00') });
  advance(node, 72 * 3600 * 1000);
  tick(node);
  store.flush();
  assert.equal(sent(node, 'RFD:R1').length, 1);

  // 重启：重新读盘
  const store2 = new Store(dbPath);
  store2.load();
  const node2 = store2.userNode('u10');
  tick(node2); // 恢复后一次自检
  assert.equal(sent(node2, 'RFD:R1').length, 1); // 不重发
  advance(node2, 24 * 3600 * 1000);
  tick(node2);
  assert.equal(sent(node2, 'RFD:R1').length, 2); // 继续按规则追加
});
