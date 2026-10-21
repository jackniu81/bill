import { Scenario, check } from './harness.js';

export const meta = { n: 4, name: '退款逾期→部分到账→全额解决', input: '应退 ¥100；满 72h 未到账；再到 ¥60、¥40；重放到账', expected: '先逾期提醒；显示差额 40；全额到账解决；重放不累计' };

export function run() {
  const s = new Scenario('u4');
  s.setNow('2026-10-01', '09:00');
  s.app('R1', 100, '2026-10-01', '09:00');
  const id = s.rfdId('R1');

  const beforeOverdue = s.remindersFor(id).length; // 未到期，应无提醒
  s.advanceDur('72h'); // 到 10-04 09:00 → 逾期
  const afterOverdue = s.remindersFor(id).length; // 首次逾期提醒

  s.receipt('RC60', 'R1', 60, '2026-10-04', '10:00'); // 部分到账，剩 40
  const midReceived = s.issueState(id).received_cents; // 立即快照（取原始值，避免后续变更覆盖）
  s.receipt('RC40', 'R1', 40, '2026-10-05', '10:00'); // 全额到账 → 解决
  const endState = s.issueState(id);
  // 重放到账（幂等，不累计）
  s.receipt('RC60', 'R1', 60, '2026-10-04', '10:00');
  s.receipt('RC40', 'R1', 40, '2026-10-05', '10:00');
  const replayState = s.issueState(id);

  return {
    evidence: {
      before_overdue_reminders: beforeOverdue,
      after_overdue_reminders: afterOverdue,
      mid: { received: midReceived, remaining: 10000 - midReceived },
      end: { status: endState.status, basis: endState.closure_basis, received: endState.received_cents },
    },
    checks: [
      check('满 72h 前不发逾期提醒', () => beforeOverdue === 0),
      check('满 72h 未全额到账 → 触发逾期提醒', () => afterOverdue >= 1),
      check('部分到账显示差额（已收 60，剩 40）', () => midReceived === 6000 && 10000 - midReceived === 4000),
      check('全额到账才验证解决', () => endState.status === 'RESOLVED' && endState.closure_basis === 'VERIFIED_BY_REFUND'),
      check('重放到账不累计（仍为 100）', () => replayState.received_cents === 10000),
    ],
  };
}
