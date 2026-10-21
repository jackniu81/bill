import { ensureUniqueById } from './idgen.js';

export function makeReminderId(issueId, kind, seq) {
  return kind === 'first' ? `${issueId}:first` : `${issueId}:fu${seq}`;
}

// 提醒按 reminder_id 幂等（同一 first/followup-seq 只落一次）。
export function addReminder(node, reminder) {
  return ensureUniqueById(node.reminders, reminder, 'reminder_id');
}

export function listFor(node, issueId) {
  return node.reminders.filter((r) => r.issue_id === issueId);
}
