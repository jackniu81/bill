import { Scenario, check } from './harness.js';

export const meta = { n: 7, name: '明天再提醒', input: '逾期首次提醒后，用户回复“明天再提醒”', expected: '至少延后 24h；次数不清零（仍计入追加）' };

export function run() {
  const s = new Scenario('u7');
  s.setNow('2026-10-01', '09:00');
  s.app('R7', 100, '2026-10-01', '09:00');
  const id = s.rfdId('R7');
  s.advanceDur('72h'); // 逾期首次提醒（10-04 09:00）
  const afterFirst = s.remindersFor(id).length;

  s.mark(id, 'remind_tomorrow'); // 用户回复：明天再提醒
  const rightAfterMark = s.remindersFor(id).length; // 立即不应新增
  s.advanceDur('23h'); // 10-05 08:00 < 到期
  const before24h = s.remindersFor(id).length;
  s.advanceDur('1h'); // 10-05 09:00 = 到期（距标记≥24h）
  const at24h = s.remindersFor(id).length;

  return {
    evidence: { afterFirst, rightAfterMark, before24h, at24h },
    checks: [
      check('标记“明天再提醒”不立即触发新提醒', () => rightAfterMark === afterFirst),
      check('至少延后 24 小时（23h 时仍未发）', () => before24h === afterFirst),
      check('到点（距标记 ≥24h）发出追加提醒', () => at24h === afterFirst + 1),
      check('追加计入次数（不清零，seq 递增）', () => {
        const fu = s.remindersFor(id).filter((r) => r.kind === 'followup');
        return fu.length === 1 && fu[0].seq === 1;
      }),
    ],
  };
}
