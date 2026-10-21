// append-only 处理历史/审计。seq 每问题自增。
export function appendEvent(node, issueId, type, payload, at) {
  const seq = node.issue_events.filter((e) => e.issue_id === issueId).length + 1;
  const ev = {
    event_id: `${issueId}#${seq}`,
    issue_id: issueId,
    seq,
    at: at ?? null,
    type,
    payload: payload ?? {},
  };
  node.issue_events.push(ev);
  return ev;
}

export function eventsFor(node, issueId) {
  return node.issue_events.filter((e) => e.issue_id === issueId).sort((a, b) => a.seq - b.seq);
}
