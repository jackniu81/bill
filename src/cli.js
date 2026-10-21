#!/usr/bin/env node
// 账单疑似问题跟进系统 —— CLI（纯模拟；时间北京时间，金额人民币元）。
// 全局：--user <id>（隔离）。示例见 README。
import { Store, ensureUserNode } from './store/jsonStore.js';
import { resolveDbPath } from './config.js';
import { yuanToCents, formatRMB } from './domain/money.js';
import { beijingMs, parseDuration, advance, setNow, getNow } from './domain/simClock.js';
import { tick } from './app/followUpEngine.js';
import { ingestTransaction, ingestRefundApplication, ingestRefundReceipt } from './app/ingestService.js';
import { markIssue, setControl } from './app/userService.js';
import { listIssues, showIssue, report } from './app/queryService.js';
import { MARKS } from './domain/issueStateMachine.js';

const MARK_ALIAS = {
  normal: MARKS.NORMAL,
  confirm: MARKS.CONFIRM,
  tomorrow: MARKS.REMIND_TOMORROW,
  resolved: MARKS.SELF_RESOLVED,
  close: MARKS.CLOSE,
};

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const body = t.slice(2);
      if (body.includes('=')) {
        const [k, v] = body.split(/=(.*)/s);
        flags[k] = v;
      } else {
        const next = argv[i + 1];
        if (next == null || next.startsWith('--')) flags[body] = true;
        else {
          flags[body] = next;
          i++;
        }
      }
    } else rest.push(t);
  }
  return { flags, rest };
}

function toTime(str) {
  // "YYYY-MM-DD HH:mm[:ss]" → epoch ms（北京时间）
  const m = String(str).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (!m) throw new Error(`时间格式应为 "YYYY-MM-DD HH:mm"（北京时间）: ${str}`);
  return beijingMs(m[1], m[2]);
}

function loadNode(userId) {
  if (!userId) throw new Error('缺少 --user <id>（用于用户隔离）');
  const store = new Store(resolveDbPath());
  store.load();
  const node = store.userNode(userId);
  return { store, node };
}

function afterMutate(node) {
  if (getNow(node) == null) return { ticked: false, actions: [] };
  return { ticked: true, actions: tick(node) };
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function usage() {
  console.log(`用法: node src/cli.js <命令> [参数] --user <id>

时间基准/推进:
  set-now --at "2026-10-01 09:00"        设置模拟当前时间（北京时间）
  advance 24h                            推进模拟时长 (30m/24h/2d/ms)

导入事实（幂等，按业务编号去重；不删除交易）:
  ingest-tx --id TX1 --merchant 商户 --amount 30 --at "2026-10-01 09:00"
  ingest-refund --refund-id R1 --expected 100 --confirmed-at "2026-10-01 09:00"
  ingest-receipt --receipt-id RC1 --refund-id R1 --amount 60 --received-at "2026-10-04 10:00"

用户标记（触发自动检查）:
  mark <issueId> normal|confirm|tomorrow|resolved|close [--remind-at "2026-10-02 09:00"] [--note 文本]

控制态（持续工作与用户控制）:
  control pause|resume|close|reopen

查看:
  list      问题列表     show <issueId>  详情+时间线     report  进展报告(含缺口)

库管理:
  init | reset | seed <fixture.json>
`);
}

function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const cmd = rest[0];
  const userId = flags.user;

  try {
    if (!cmd || cmd === 'help' || flags.help) return usage();

    if (cmd === 'init' || cmd === 'reset') {
      const store = new Store(resolveDbPath());
      if (cmd === 'reset') store.db = { version: 1, users: {} };
      else store.load();
      store.flush();
      return print({ ok: true, cmd, db: resolveDbPath() });
    }
    if (cmd === 'seed') {
      print({ ok: false, note: 'seed 由 scripts/init-db.js 提供，请运行: node scripts/init-db.js seed <file>' });
      return;
    }

    const { store, node } = loadNode(userId);

    switch (cmd) {
      case 'set-now': {
        if (!flags.at) throw new Error('set-now 需要 --at "YYYY-MM-DD HH:mm"');
        const ms = setNow(node, toTime(flags.at));
        store.flush();
        return print({ ok: true, now_at: ms, now_str: beijingStrSafe(ms) });
      }
      case 'advance': {
        const ms = parseDuration(rest[1] ?? flags.ms);
        if (getNow(node) == null) throw new Error('请先 set-now 设置基准时间');
        advance(node, ms);
        const { actions } = afterMutate(node);
        store.flush();
        return print({ ok: true, now_at: getNow(node), now_str: beijingStrSafe(getNow(node)), actions });
      }
      case 'ingest-tx': {
        const r = ingestTransaction(node, {
          tx_id: flags.id,
          merchant: flags.merchant,
          amount_cents: yuanToCents(flags.amount),
          occurred_at: toTime(flags.at),
        });
        const { actions } = afterMutate(node);
        store.flush();
        return print({ ok: true, created: r.created, tx_id: flags.id, actions });
      }
      case 'ingest-refund': {
        const r = ingestRefundApplication(node, {
          refund_id: flags['refund-id'],
          expected_amount_cents: yuanToCents(flags.expected),
          confirmed_at: toTime(flags['confirmed-at']),
        });
        const { actions } = afterMutate(node);
        store.flush();
        return print({ ok: true, created: r.created, refund_id: flags['refund-id'], actions });
      }
      case 'ingest-receipt': {
        const r = ingestRefundReceipt(node, {
          receipt_id: flags['receipt-id'],
          refund_id: flags['refund-id'],
          amount_cents: yuanToCents(flags.amount),
          received_at: toTime(flags['received-at']),
        });
        const { actions } = afterMutate(node);
        store.flush();
        return print({ ok: true, created: r.created, receipt_id: flags['receipt-id'], actions });
      }
      case 'mark': {
        const issueId = rest[1];
        const alias = rest[2];
        const action = MARK_ALIAS[alias] || alias;
        if (!action) throw new Error('mark 需要 <issueId> <action>');
        const opts = { note: flags.note ?? null };
        if (action === MARKS.REMIND_TOMORROW && flags['remind-at']) opts.target_at = toTime(flags['remind-at']);
        const res = markIssue(node, issueId, action, opts);
        if (!res.ok) {
          store.flush();
          return print({ ok: false, error: res.error });
        }
        const { actions } = afterMutate(node);
        store.flush();
        return print({ ok: true, issue_id: issueId, action, result: res, actions });
      }
      case 'control': {
        const sub = rest[1];
        const map = { pause: 'paused', resume: 'running', close: 'closed', reopen: 'running' };
        if (!map[sub]) throw new Error('control 需要 pause|resume|close|reopen');
        setControl(node, map[sub]);
        let actions = [];
        if (getNow(node) != null) actions = tick(node, { resume: sub === 'resume' });
        store.flush();
        return print({ ok: true, control_state: node.control.control_state, resume_mode: sub === 'resume', actions });
      }
      case 'list':
        return print({ ok: true, issues: listIssues(node) });
      case 'show':
        return print({ ok: true, issue: showIssue(node, rest[1]) });
      case 'report':
        return print(report(node));
      default:
        throw new Error(`未知命令: ${cmd}`);
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
    process.exitCode = 1;
  }
}

// 轻量时间格式化（避免循环 import queryService 的格式化）
import { formatBeijing } from './domain/simClock.js';
function beijingStrSafe(ms) {
  try {
    return formatBeijing(ms);
  } catch {
    return null;
  }
}

main();
