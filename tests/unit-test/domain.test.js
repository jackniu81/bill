import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yuanToCents, formatRMB } from '../../src/domain/money.js';
import { beijingMs, formatBeijing, parseDuration } from '../../src/domain/simClock.js';
import { findDuplicatePairs, duplicateIssueId, buildLinkMap } from '../../src/domain/duplicateDetector.js';
import { computeRefundState, orphanReceipts } from '../../src/domain/refundTracker.js';
import { DUPLICATE_WINDOW_MS, REFUND_OVERDUE_MS } from '../../src/domain/rules.js';
import { defaultUserNode } from '../../src/store/jsonStore.js';
import { setNow } from '../../src/domain/simClock.js';

const T = (id, merchant, cents, at) => ({ tx_id: id, merchant, amount_cents: cents, occurred_at: beijingMs('2026-10-01', at) });

test('money: 元转分四舍五入、展示两位小数', () => {
  assert.equal(yuanToCents('30'), 3000);
  assert.equal(yuanToCents(19.99), 1999);
  assert.equal(yuanToCents(0.1), 10);
  assert.equal(formatRMB(3000), '¥30.00');
  assert.equal(formatRMB(5), '¥0.05');
  assert.equal(formatRMB(-150), '-¥1.50');
});

test('simClock: 北京时间解析/格式化/时长', () => {
  const ms = beijingMs('2026-10-01', '09:00');
  assert.equal(formatBeijing(ms), '2026-10-01 09:00:00 (北京时间)');
  assert.equal(parseDuration('24h'), 24 * 3600 * 1000);
  assert.equal(parseDuration('30m'), 30 * 60 * 1000);
  assert.equal(parseDuration('2d'), 2 * 24 * 3600 * 1000);
  assert.equal(parseDuration('48h'), 48 * 3600 * 1000);
});

test('duplicate: 同商户同额且 ≤10min → 一条无序对', () => {
  const pairs = findDuplicatePairs([T('TX2', 'M', 3000, '09:05'), T('TX1', 'M', 3000, '09:00')]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].tx_ids, ['TX1', 'TX2']); // 升序规范化
});

test('duplicate: 恰在 10min 边界内计入，超过则不计', () => {
  const within = findDuplicatePairs([T('A', 'M', 3000, '09:00'), T('B', 'M', 3000, '09:10')]);
  assert.equal(within.length, 1);
  assert.equal(within[0].delta_ms, DUPLICATE_WINDOW_MS);
  const beyond = findDuplicatePairs([T('A', 'M', 3000, '09:00'), T('B', 'M', 3000, '09:11')]);
  assert.equal(beyond.length, 0);
});

test('duplicate: 不同商户/不同额不成对', () => {
  assert.equal(findDuplicatePairs([T('A', 'M1', 3000, '09:00'), T('B', 'M2', 3000, '09:01')]).length, 0);
  assert.equal(findDuplicatePairs([T('A', 'M', 3000, '09:00'), T('B', 'M', 3100, '09:01')]).length, 0);
});

test('duplicate: 三笔两两成对 → 三对，并查集互相全关联', () => {
  const pairs = findDuplicatePairs([T('TX1', 'M', 3000, '09:00'), T('TX2', 'M', 3000, '09:05'), T('TX3', 'M', 3000, '09:09')]);
  assert.equal(pairs.length, 3);
  const links = buildLinkMap(pairs);
  const ids = [duplicateIssueId('TX1', 'TX2'), duplicateIssueId('TX1', 'TX3'), duplicateIssueId('TX2', 'TX3')];
  for (const id of ids) assert.equal(links[id].length, 2); // 每条关联另外两条
});

test('duplicate: issue_id 与顺序无关（幂等键稳定）', () => {
  assert.equal(duplicateIssueId('TX2', 'TX1'), duplicateIssueId('TX1', 'TX2'));
});

test('refund: 部分到账显示差额、72h 逾期、全额不算逾期', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:00'));
  node.refund_applications.push({ refund_id: 'R1', expected_amount_cents: 10000, confirmed_at: beijingMs('2026-10-01', '09:00') });

  // 满 72h 前、未到账
  let st = computeRefundState(node, 'R1');
  assert.equal(st.overdue, false);
  assert.equal(st.remaining_cents, 10000);

  // 恰好 72h、未全额 → 逾期
  setNow(node, beijingMs('2026-10-01', '09:00') + REFUND_OVERDUE_MS);
  st = computeRefundState(node, 'R1');
  assert.equal(st.overdue, true);

  // 部分到账 60 → 剩 40
  node.refund_receipts.push({ receipt_id: 'RC1', refund_id: 'R1', amount_cents: 6000, received_at: beijingMs('2026-10-04', '10:00') });
  st = computeRefundState(node, 'R1');
  assert.equal(st.received_cents, 6000);
  assert.equal(st.remaining_cents, 4000);
  assert.equal(st.overdue, true);
  assert.equal(st.fully_received, false);

  // 全额到账 → 不再逾期
  node.refund_receipts.push({ receipt_id: 'RC2', refund_id: 'R1', amount_cents: 4000, received_at: beijingMs('2026-10-05', '10:00') });
  st = computeRefundState(node, 'R1');
  assert.equal(st.received_cents, 10000);
  assert.equal(st.fully_received, true);
  assert.equal(st.overdue, false);
});

test('refund: 先到账无申请 → 列为孤儿到账、诚实标注', () => {
  const node = defaultUserNode('u');
  setNow(node, beijingMs('2026-10-01', '09:00'));
  node.refund_receipts.push({ receipt_id: 'RC1', refund_id: 'R9', amount_cents: 10000, received_at: beijingMs('2026-10-01', '08:00') });
  assert.deepEqual(orphanReceipts(node), ['R9']);
  const st = computeRefundState(node, 'R9');
  assert.equal(st.has_application, false);
  assert.ok(st.note);
});
