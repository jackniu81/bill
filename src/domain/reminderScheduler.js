// 提醒调度（纯函数）：首次提醒不计追加；未回复自上次 ≥24h 追加、最多两次；
// 新数据不重置计数；"确有问题"停无回复催办；"明天再提醒" next_due=max(既有最早到期, 标记+24h) 且次数不清零。
import { FOLLOWUP_INTERVAL_MS, MAX_FOLLOWUPS, REFUND_OVERDUE_MS, REMIND_TOMORROW_DEFAULT_MS } from './rules.js';
import { getNow } from './simClock.js';
import { findApplication, sumReceipts } from './refundTracker.js';

const CLOSED_STATUSES = ['RESOLVED', 'NORMAL', 'SELF_RESOLVED', 'CLOSED'];

// 退款/重复各自的首次提醒触发条件与触发时刻。
export function triggerFor(node, issue, now = getNow(node)) {
  if (issue.kind === 'duplicate') {
    return { dueNow: issue.created_at != null, triggerAt: issue.created_at, nextDueAt: issue.created_at };
  }
  if (issue.kind === 'refund') {
    const app = findApplication(node, issue.refund_id);
    if (!app) return { dueNow: false, reason: '退款申请未到', nextDueAt: null };
    const received = sumReceipts(node, issue.refund_id);
    if (received >= issue.expected_cents) return { dueNow: false, reason: '已全额到账', nextDueAt: null };
    const overdueAt = app.confirmed_at + REFUND_OVERDUE_MS;
    return { dueNow: now >= overdueAt, triggerAt: overdueAt, nextDueAt: overdueAt };
  }
  return { dueNow: false, reason: '未知类型' };
}

function latestUserMark(node, issueId) {
  const marks = node.issue_events
    .filter((e) => e.issue_id === issueId && e.type === 'user_mark')
    .sort((a, b) => a.at - b.at);
  return marks.length ? marks[marks.length - 1] : null;
}

// 返回该问题当前应发送的提醒（可能 0/1/多条），以及下一次到期时间。
// opts.resume=true：恢复模式，不补发暂停期间每条过期提醒（仅重排到期，不发送）。
// opts.controlState!=='running'：暂停/关闭 → 不发送。
export function planReminders(node, issue, now = getNow(node), opts = {}) {
  const res = { toSend: [], nextDueAt: null, stopped: false, reason: null };
  const rid = issue.issue_id;

  if (CLOSED_STATUSES.includes(issue.status)) {
    res.stopped = true;
    res.reason = '已结案/关闭，不再提醒';
    return res;
  }
  if (opts.controlState && opts.controlState !== 'running') {
    res.stopped = true;
    res.reason = `控制态为 ${opts.controlState}，暂停主动提醒`;
    return res;
  }

  const sent = node.reminders
    .filter((r) => r.issue_id === rid && r.status === 'sent')
    .sort((a, b) => a.sent_at - b.sent_at);
  const first = sent.find((r) => r.kind === 'first');
  const followups = sent.filter((r) => r.kind === 'followup').sort((a, b) => a.seq - b.seq);

  const trig = triggerFor(node, issue, now);
  if (!trig.dueNow) {
    res.reason = trig.reason || '未到期';
    res.nextDueAt = trig.nextDueAt ?? null;
    return res;
  }

  if (!first) {
    // 尚未发首次提醒
    if (opts.resume) {
      // 恢复：仍应建立"已提醒"基线，但不回溯补发；此处允许发送当前这一条首次提醒（不算过期堆积）。
      res.toSend.push({ kind: 'first', seq: 0, due_at: now });
      res.nextDueAt = now + FOLLOWUP_INTERVAL_MS;
      return res;
    }
    res.toSend.push({ kind: 'first', seq: 0, due_at: now });
    res.nextDueAt = now + FOLLOWUP_INTERVAL_MS;
    return res;
  }

  // 已有首次提醒
  const lastMark = latestUserMark(node, rid);
  if (lastMark && lastMark.at >= first.sent_at && lastMark.payload?.action === 'confirm_problem') {
    res.stopped = true;
    res.reason = '确有问题：停止无回复催办，等待事实或下一明确约定';
    return res;
  }

  if (followups.length >= MAX_FOLLOWUPS) {
    res.stopped = true;
    res.reason = `追加提醒已达上限(${MAX_FOLLOWUPS})，以后不催`;
    return res;
  }

  const lastSentAt = followups.length ? followups[followups.length - 1].sent_at : first.sent_at;
  let due = lastSentAt + FOLLOWUP_INTERVAL_MS;
  // “明天再提醒”：与既有最早到期取较晚值，次数不清零
  if (lastMark && lastMark.payload?.action === 'remind_tomorrow' && lastMark.at >= lastSentAt) {
    const target = lastMark.payload.target_at ?? lastMark.at + REMIND_TOMORROW_DEFAULT_MS;
    due = Math.max(due, target);
  }

  if (opts.resume) {
    res.reason = '恢复模式：不补发暂停期间过期提醒，下一次到期见 nextDueAt';
    res.nextDueAt = due;
    return res;
  }

  if (now >= due) {
    const nextSeq = followups.length + 1;
    res.toSend.push({ kind: 'followup', seq: nextSeq, due_at: now });
    if (nextSeq >= MAX_FOLLOWUPS) {
      res.nextDueAt = null;
    } else {
      res.nextDueAt = now + FOLLOWUP_INTERVAL_MS;
    }
  } else {
    res.nextDueAt = due;
  }
  return res;
}
