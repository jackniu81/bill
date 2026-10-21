import { Scenario, check } from './harness.js';

export const meta = { n: 6, name: '首次提醒后持续不回复', input: '退款 ¥100 满 72h 逾期，之后一直不回复', expected: '不早于 24/48h 各追加一次，最多两次，以后不催' };

export function run() {
  const s = new Scenario('u6');
  s.setNow('2026-10-01', '09:00');
  s.app('R6', 100, '2026-10-01', '09:00');
  const id = s.rfdId('R6');

  s.advanceDur('72h'); // 逾期 → 首次提醒
  const atOverdue = s.remindersFor(id).length;
  s.advanceDur('24h'); // ≈ first+24h → 追加1
  const atPlus24 = s.remindersFor(id).length;
  s.advanceDur('24h'); // ≈ first+48h → 追加2
  const atPlus48 = s.remindersFor(id).length;
  s.advanceDur('72h'); // 继续推进 → 不再催
  const after = s.remindersFor(id).length;

  const kinds = s.remindersFor(id).map((r) => `${r.kind}${r.seq || ''}`);
  return {
    evidence: { atOverdue, atPlus24, atPlus48, after, kinds },
    checks: [
      check('逾期触发首次提醒', () => atOverdue === 1),
      check('≥24h 追加第一次', () => atPlus24 === 2),
      check('≥48h 追加第二次', () => atPlus48 === 3),
      check('最多两次，之后不再催', () => after === 3),
    ],
  };
}
