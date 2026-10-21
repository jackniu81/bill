import { Scenario, check } from './harness.js';

export const meta = { n: 3, name: '三笔两两成对→三条并关联', input: '09:00/09:05/09:09 各 ¥30，TX1/TX2/TX3', expected: '三个不同交易对形成三条问题且互相关联；重放不新增；不得称“已证实”' };

export function run() {
  const s = new Scenario('u3');
  s.setNow('2026-10-01', '09:09');
  s.tx('TX1', '某商户', 30, '2026-10-01', '09:00');
  s.tx('TX2', '某商户', 30, '2026-10-01', '09:05');
  s.tx('TX3', '某商户', 30, '2026-10-01', '09:09');
  // 重放
  s.tx('TX1', '某商户', 30, '2026-10-01', '09:00');
  s.tx('TX2', '某商户', 30, '2026-10-01', '09:05');
  s.tx('TX3', '某商户', 30, '2026-10-01', '09:09');
  const dup = s.list().filter((i) => i.kind === 'duplicate');
  const ids = [s.dupId('TX1', 'TX2'), s.dupId('TX1', 'TX3'), s.dupId('TX2', 'TX3')];
  const allLinked = ids.every((id) => (s.issueState(id).link_issue_ids || []).length === 2);
  const allSuspect = ids.every((id) => s.issueState(id).status === 'SUSPECT');
  return {
    evidence: { dup_count: dup.length, dup_issue_ids: dup.map((d) => d.issue_id) },
    checks: [
      check('三条不同交易对 → 三条问题（重放后仍为 3）', () => dup.length === 3),
      check('三条问题互相关联（各关联另两条）', () => allLinked),
      check('均为 SUSPECT 疑似，未表述为已证实', () => allSuspect),
    ],
  };
}
