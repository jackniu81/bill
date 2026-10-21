import { Scenario, check } from './harness.js';

export const meta = { n: 10, name: '中断恢复保留计数与状态', input: '退款逾期发出首次提醒后进程重启，再继续推进', expected: '重启从 db.json 读回提醒计数与处理状态，不重复处理；重启后仍可按规则追加，最多两次' };

export function run() {
  const s = new Scenario('u10');
  s.setNow('2026-10-01', '09:00');
  s.app('R10', 100, '2026-10-01', '09:00');
  const id = s.rfdId('R10');

  s.advanceDur('72h'); // 逾期 → 首次提醒（1 条 sent）
  const beforeRestart = s.remindersFor(id).length;

  s.restart(); // 模拟进程中断恢复（flush + 重新读盘）
  const afterRestart = s.remindersFor(id).length;
  const statusAfterRestart = s.issueState(id).status;
  const clockAfterRestart = s.node.clock.now_at;

  s.advanceDur('24h'); // first+24h → 追加1（重启后计数不清零，继续）
  const afterFu1 = s.remindersFor(id).length;

  s.restart(); // 二次重启
  const afterSecondRestart = s.remindersFor(id).length;

  s.advanceDur('24h'); // first+48h → 追加2
  s.advanceDur('72h'); // 继续推进 → 不再催
  const finalCount = s.remindersFor(id).length;

  return {
    evidence: { beforeRestart, afterRestart, statusAfterRestart, afterFu1, afterSecondRestart, finalCount },
    checks: [
      check('重启前已发首次提醒', () => beforeRestart === 1),
      check('重启后首次提醒计数保留（不重发）', () => afterRestart === beforeRestart),
      check('重启后处理状态保留（仍为 SUSPECT，未终结）', () => statusAfterRestart === 'SUSPECT'),
      check('重启后模拟时钟保留', () => clockAfterRestart != null),
      check('重启后仍按规则追加（first+24h）', () => afterFu1 === 2),
      check('二次重启计数仍保留', () => afterSecondRestart === 2),
      check('最多两次追加，之后不再催', () => finalCount === 3),
    ],
  };
}
