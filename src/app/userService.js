// 用户标记与控制态。终结态不因标记而重开（只记录事件）。
import { getIssue } from '../repo/issueRepo.js';
import { appendEvent } from '../repo/eventRepo.js';
import { getNow } from '../domain/simClock.js';
import { applyMark, validateMark, isTerminal } from '../domain/issueStateMachine.js';
import { getState, setState } from '../repo/controlRepo.js';

export function markIssue(node, issueId, action, opts = {}) {
  const issue = getIssue(node, issueId);
  if (!issue) return { ok: false, error: `问题不存在: ${issueId}` };
  const v = validateMark(issue, action);
  if (!v.ok) return { ok: false, error: v.error };

  const now = getNow(node);
  appendEvent(node, issueId, 'user_mark', { action, note: opts.note ?? null, target_at: opts.target_at ?? null }, now);

  const wasTerminal = isTerminal(issue.status);
  const prev = { status: issue.status, closure_basis: issue.closure_basis };
  const res = applyMark(issue, action);

  if (res.status && wasTerminal) {
    // 已终结：标记仅作记录，不重开。
    issue.status = prev.status;
    issue.closure_basis = prev.closure_basis;
    return { ok: true, recorded: true, reopened: false, status: issue.status, note: '问题已终结，标记仅作记录不重开' };
  }
  issue.updated_at = now;
  return { ok: true, result: res, status: issue.status, warn: v.warn };
}

export function getControl(node) {
  return getState(node);
}

export function setControl(node, state) {
  return setState(node, state);
}
