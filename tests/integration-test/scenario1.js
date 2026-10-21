import { Scenario, check } from './harness.js';

export const meta = { n: 1, name: '疑似重复消费建一条问题', input: '09:00/09:05 各 ¥30，不同编号 TX1/TX2', expected: '一条 SUSPECT 问题；不删除交易' };

export function run() {
  const s = new Scenario('u1');
  s.setNow('2026-10-01', '09:05');
  s.tx('TX1', '某商户', 30, '2026-10-01', '09:00');
  s.tx('TX2', '某商户', 30, '2026-10-01', '09:05');
  const dup = s.list().filter((i) => i.kind === 'duplicate');
  const id = s.dupId('TX1', 'TX2');
  const iss = s.issueState(id);
  return {
    evidence: { dup_issue_ids: dup.map((d) => d.issue_id), transactions: s.node.transactions.map((t) => t.tx_id) },
    checks: [
      check('生成且仅生成一条疑似问题', () => dup.length === 1),
      check('问题状态为 SUSPECT（疑似）', () => iss && iss.status === 'SUSPECT'),
      check('关联两笔不同编号交易', () => iss && [...iss.tx_ids].sort().join(',') === 'TX1,TX2'),
      check('两笔交易都保留（不删除）', () => s.node.transactions.length === 2),
    ],
  };
}
