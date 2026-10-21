// 单一 data/db.json 的加载/保存/原子写。存储为「结构化（MySQL 式）关系表」：
// 顶层为 tables，每张表是行数组，行以 user_id 外键归属用户；多对多用关联表（issue_txs / issue_links）。
// 领域/仓储/引擎仍按「每用户视图」工作（数组字段），由本模块负责 表 ↔ 视图 的装配与回写，隔离由 user_id 过滤保证。
import fs from 'node:fs';
import path from 'node:path';
import { resolveDbPath } from '../config.js';

export const SCHEMA_VERSION = 2;

// 表清单与主键（用于装配/回写与去重语义）。
export const TABLES = {
  users: 'user_id',
  transactions: 'tx_id',
  refund_applications: 'refund_id',
  refund_receipts: 'receipt_id',
  issues: 'issue_id',
  issue_txs: null, // 关联表：(issue_id, tx_id)
  issue_links: null, // 关联表：(issue_id, link_issue_id)
  issue_events: 'event_id',
  reminders: 'reminder_id',
  controls: 'user_id', // 每用户一行
  clocks: 'user_id', // 每用户一行
};

// 属于「每用户多行」的数据表（回写时按 user_id 整组替换）。
const ROW_TABLES = [
  'transactions',
  'refund_applications',
  'refund_receipts',
  'issues',
  'issue_txs',
  'issue_links',
  'issue_events',
  'reminders',
];

export function emptyDb() {
  const tables = {};
  for (const name of Object.keys(TABLES)) tables[name] = [];
  return { version: SCHEMA_VERSION, tables };
}

// 每用户「视图」——领域/仓储/引擎看到的形状（数组字段 + control/clock 单例）。
export function defaultUserNode(userId) {
  return {
    user_id: userId,
    transactions: [], // {tx_id, merchant, amount_cents, occurred_at, ingested_at}
    refund_applications: [], // {refund_id, expected_amount_cents, confirmed_at, ingested_at}
    refund_receipts: [], // {receipt_id, refund_id, amount_cents, received_at, ingested_at}
    issues: [], // {issue_id, kind, status, closure_basis, tx_ids[], link_issue_ids[], refund_id?, expected_cents?, received_cents?, created_at, updated_at}
    issue_events: [], // {event_id, issue_id, seq, at, type, payload}
    reminders: [], // {reminder_id, issue_id, kind, seq, due_at, sent_at, status}
    control: { control_state: 'running', settings: {} },
    clock: { now_at: null },
  };
}

function tbl(db, name) {
  if (!db.tables[name]) db.tables[name] = [];
  return db.tables[name];
}

// 确保用户存在并具备 control/clock 单例行。
export function ensureUser(db, userId) {
  if (!userId) throw new Error('userId is required');
  if (!tbl(db, 'users').some((u) => u.user_id === userId)) tbl(db, 'users').push({ user_id: userId });
  if (!tbl(db, 'controls').some((c) => c.user_id === userId)) tbl(db, 'controls').push({ user_id: userId, control_state: 'running', settings: {} });
  if (!tbl(db, 'clocks').some((c) => c.user_id === userId)) tbl(db, 'clocks').push({ user_id: userId, now_at: null });
  return db.tables;
}

// 关系表 → 每用户视图（按 user_id 过滤装配；issues 回填 tx_ids/link_issue_ids）。
export function loadScoped(db, userId) {
  ensureUser(db, userId);
  const node = defaultUserNode(userId);
  const t = db.tables;
  const mine = (name) => t[name].filter((r) => r.user_id === userId);

  node.transactions = mine('transactions').map((r) => ({ ...r }));
  node.refund_applications = mine('refund_applications').map((r) => ({ ...r }));
  node.refund_receipts = mine('refund_receipts').map((r) => ({ ...r }));
  node.issue_events = mine('issue_events').map((r) => ({ ...r }));
  node.reminders = mine('reminders').map((r) => ({ ...r }));

  const txs = mine('issue_txs');
  const links = mine('issue_links');
  node.issues = mine('issues').map((row) => {
    const { user_id, tx_ids, link_issue_ids, ...rest } = row; // 视图不含标量之外的数组列
    return {
      ...rest,
      tx_ids: txs.filter((x) => x.issue_id === rest.issue_id).map((x) => x.tx_id),
      link_issue_ids: links.filter((x) => x.issue_id === rest.issue_id).map((x) => x.link_issue_id),
    };
  });

  const ctrl = t.controls.find((c) => c.user_id === userId);
  node.control = { control_state: ctrl?.control_state ?? 'running', settings: ctrl?.settings ?? {} };
  const clock = t.clocks.find((c) => c.user_id === userId);
  node.clock = { now_at: clock?.now_at ?? null };
  return node;
}

// 每用户视图 → 关系表（按 user_id 整组替换回写；剥离标量行内的数组字段并落到关联表）。
export function saveScoped(db, userId, node) {
  ensureUser(db, userId);
  const stamp = (rows) => rows.map((r) => ({ ...r, user_id: userId }));
  const replace = (name, rows) => {
    db.tables[name] = db.tables[name].filter((r) => r.user_id !== userId).concat(rows);
  };

  replace('transactions', stamp(node.transactions));
  replace('refund_applications', stamp(node.refund_applications));
  replace('refund_receipts', stamp(node.refund_receipts));
  replace('issue_events', stamp(node.issue_events));
  replace('reminders', stamp(node.reminders));

  // issues 标量列（去掉数组字段）
  const issueRows = node.issues.map(({ tx_ids, link_issue_ids, ...rest }) => ({ ...rest, user_id: userId }));
  replace('issues', issueRows);
  // 关联表
  const txLinkRows = [];
  const idLinkRows = [];
  for (const it of node.issues) {
    for (const tx of it.tx_ids || []) txLinkRows.push({ issue_id: it.issue_id, tx_id: tx, user_id: userId });
    for (const li of it.link_issue_ids || []) idLinkRows.push({ issue_id: it.issue_id, link_issue_id: li, user_id: userId });
  }
  replace('issue_txs', txLinkRows);
  replace('issue_links', idLinkRows);
  // 单例
  replace('controls', [{ user_id: userId, control_state: node.control.control_state, settings: node.control.settings || {} }]);
  replace('clocks', [{ user_id: userId, now_at: node.clock.now_at }]);
  return db.tables;
}

// 清空某用户的所有行（用于测试/场景重建干净状态，不影响其他用户）。
export function clearUserRows(db, userId) {
  for (const name of Object.keys(TABLES)) {
    db.tables[name] = (db.tables[name] || []).filter((r) => r.user_id !== userId);
  }
  return db;
}

// v1（文档式：{users:{<id>:node}}）→ v2（关系表）。
function migrateV1toV2(parsed) {
  const db = emptyDb();
  const users = parsed && parsed.users ? parsed.users : {};
  for (const [uid, node] of Object.entries(users)) {
    ensureUser(db, uid);
    saveScoped(db, uid, { ...defaultUserNode(uid), ...node, user_id: uid });
  }
  return db;
}

function normalizeToTables(parsed) {
  if (parsed && parsed.tables) {
    const db = emptyDb();
    for (const name of Object.keys(TABLES)) db.tables[name] = Array.isArray(parsed.tables[name]) ? parsed.tables[name] : [];
    db.version = parsed.version || SCHEMA_VERSION;
    return db;
  }
  if (parsed && parsed.users) return migrateV1toV2(parsed); // 兼容旧文档结构
  return emptyDb();
}

export class Store {
  constructor(dbPath) {
    this.memory = dbPath === ':memory:';
    this.dbPath = this.memory ? null : dbPath || resolveDbPath();
    this.db = emptyDb();
    this._scoped = null; // { userId, node }
  }

  static inFile(dbPath) {
    return new Store(dbPath || resolveDbPath());
  }

  static inMemory() {
    return new Store(':memory:');
  }

  load() {
    if (this.memory) {
      this.db = emptyDb();
      return this.db;
    }
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf8');
      this.db = normalizeToTables(JSON.parse(raw));
    } catch (e) {
      if (e.code === 'ENOENT') this.db = emptyDb();
      else throw new Error(`读取 db.json 失败: ${e.message}`);
    }
    return this.db;
  }

  // 取当前用户「视图」；记录之，flush 时回写（保证隔离：仅暴露该 user_id 的行）。
  userNode(userId) {
    const node = loadScoped(this.db, userId);
    this._scoped = { userId, node };
    return node;
  }

  // 供测试/场景：清掉该用户持久化行（重建干净视图前调用）。
  clearUser(userId) {
    clearUserRows(this.db, userId);
    this._scoped = null;
    return this;
  }

  flush() {
    if (this._scoped) saveScoped(this.db, this._scoped.userId, this._scoped.node);
    if (this.memory) return;
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.dbPath); // 原子落盘
  }
}
