import { Scenario, check } from './harness.js';

export const meta = { n: 9, name: '关闭后到账', input: '退款逾期后用户关闭问题，之后有到账', expected: '只补事实记录；不重新打开、不催办' };

export function run() {
  const s = new Scenario('u9');
  s.setNow('2026-10-01', '09:00');
  s.app('R9', 100, '2026-10-01', '09:00');
  const id = s.rfdId('R9');
  s.advanceDur('72h'); // 逾期首次提醒
  const remindersBeforeClose = s.remindersFor(id).length;
  s.mark(id, 'close'); // 关闭
  const closedStatus = s.issueState(id).status;

  s.receipt('RC9', 'R9', 50, '2026-10-06', '10:00'); // 关闭后到账（部分）
  const iss = s.issueState(id);
  const remindersAfterArrival = s.remindersFor(id).length;
  const arrivalFacts = s.issue(id).timeline.filter((t) => t.type === 'fact_ingested' && t.detail.includes('关闭后到账'));

  return {
    evidence: { closedStatus, remindersBeforeClose, remindersAfterArrival, statusAfter: iss.status, arrivalFacts: arrivalFacts.length },
    checks: [
      check('关闭后状态为 CLOSED', () => closedStatus === 'CLOSED'),
      check('到账不重新打开（仍 CLOSED）', () => iss.status === 'CLOSED'),
      check('到账不触发催办（提醒数不变）', () => remindersAfterArrival === remindersBeforeClose),
      check('补记到账事实（append-only）', () => arrivalFacts.length >= 1),
    ],
  };
}
