import { Scenario, check } from './harness.js';

export const meta = { n: 5, name: '全额到账先于申请', input: '先到账 ¥100（申请未到），随后申请到达', expected: '齐全后显示到账并解决；不发过期逾期消息' };

export function run() {
  const s = new Scenario('u5');
  s.setNow('2026-10-01', '09:00');
  // 到账先到（此时无申请 → 保留为孤儿到账，不建问题）
  s.receipt('RC100', 'R2', 100, '2026-10-01', '08:00');
  const orphanGaps = s.report().gaps.map((g) => g.refund_id);
  // 申请随后到达
  s.app('R2', 100, '2026-10-01', '09:00');
  const id = s.rfdId('R2');
  const iss = s.issueState(id);
  const reminders = s.remindersFor(id).length;
  const gapsAfter = s.report().gaps.length;

  return {
    evidence: { orphanGaps, status: iss && iss.status, basis: iss && iss.closure_basis, reminders, gapsAfter },
    checks: [
      check('先到账被保留并列为缺口（诚实呈现）', () => orphanGaps.includes('R2')),
      check('申请到达后齐全 → 显示到账并验证解决', () => iss && iss.status === 'RESOLVED' && iss.closure_basis === 'VERIFIED_BY_REFUND'),
      check('不发过期逾期消息', () => reminders === 0),
      check('齐全后缺口不再悬挂', () => gapsAfter === 0),
    ],
  };
}
