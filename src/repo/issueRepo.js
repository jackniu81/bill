import { ensureUniqueById } from './idgen.js';

export function getIssue(node, issueId) {
  return node.issues.find((i) => i.issue_id === issueId) || null;
}

export function addIssue(node, issue) {
  return ensureUniqueById(node.issues, issue, 'issue_id');
}

export function updateIssue(node, issueId, patch) {
  const issue = getIssue(node, issueId);
  if (!issue) return null;
  Object.assign(issue, patch);
  return issue;
}

export function allIssues(node) {
  return node.issues;
}
