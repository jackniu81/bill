import { Scenario, check } from './harness.js';

export const meta = { n: 8, name: '确认重复但无解决结果', input: '疑似重复消费，用户“确有问题”，但无解决事实', expected: 'PENDING_RESOLUTION（待解决）；确有问题 ≠ 解决' };

export function run() {
  const s = new Scenario('u8');
  s.setNow('2026-10-01', '09:05');
  s.tx('TX1', '某商户', 30, '2026-10-01', '09:00');
  s.tx('TX2', '某商户', 30, '2026-10-01', '09:05');
  const id = s.dupId('TX1', 'TX2');
  s.mark(id, 'confirm_problem');
  const iss = s.issueState(id);

  return {
    evidence: { status: iss.status, closure_basis: iss.closure_basis },
    checks: [
      check('状态为 PENDING_RESOLUTION（待解决）', () => iss.status === 'PENDING_RESOLUTION'),
      check('结案依据为空（确有问题不等于解决）', () => iss.closure_basis == null),
      check('问题仍处于未终结（待解决）', () => ['RESOLVED', 'NORMAL', 'SELF_RESOLVED', 'CLOSED'].includes(iss.status) === false),
    ],
  };
}
