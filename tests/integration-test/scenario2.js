import { Scenario, check } from './harness.js';

export const meta = { n: 2, name: '标正常两次购买并重放', input: '同上，用户标“正常两次购买”，再重放同一批交易', expected: '记录 NORMAL；重放不重新打开、不新增' };

export function run() {
  const s = new Scenario('u2');
  s.setNow('2026-10-01', '09:05');
  s.tx('TX1', '某商户', 30, '2026-10-01', '09:00');
  s.tx('TX2', '某商户', 30, '2026-10-01', '09:05');
  const id = s.dupId('TX1', 'TX2');
  s.mark(id, 'normal_two_purchases');
  // 重放：再次导入相同两笔交易（幂等）
  s.tx('TX1', '某商户', 30, '2026-10-01', '09:00');
  s.tx('TX2', '某商户', 30, '2026-10-01', '09:05');
  const dup = s.list().filter((i) => i.kind === 'duplicate');
  const iss = s.issueState(id);
  return {
    evidence: { status: iss && iss.status, closure_basis: iss && iss.closure_basis, dup_count: dup.length },
    checks: [
      check('状态记为 NORMAL', () => iss && iss.status === 'NORMAL'),
      check('结案依据为 USER_MARKED_NORMAL', () => iss && iss.closure_basis === 'USER_MARKED_NORMAL'),
      check('重放后仍只有一条问题（不重开/不新增）', () => dup.length === 1),
      check('重放不重复插入交易', () => s.node.transactions.length === 2),
    ],
  };
}
