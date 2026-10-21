// 单一 data/db.json 的加载/保存/原子写与按 userId 取节点。
// 顶层结构： { version, users: { <userId>: <userNode> } }
// 每个 userNode 即该用户的全部账目/问题/提醒/控制/时钟；仓储层只接收当前 userId 节点，天然隔离。
import fs from 'node:fs';
import path from 'node:path';
import { resolveDbPath } from '../config.js';

export function emptyDb() {
  return { version: 1, users: {} };
}

export function defaultUserNode(userId) {
  return {
    user_id: userId,
    transactions: [], // {tx_id, merchant, amount_cents, occurred_at, ingested_at}
    refund_applications: [], // {refund_id, expected_amount_cents, confirmed_at, ingested_at}
    refund_receipts: [], // {receipt_id, refund_id, amount_cents, received_at, ingested_at}
    issues: [], // {issue_id, kind, status, closure_basis, tx_ids[], link_issue_ids[], refund_id?, expected_cents?, received_cents?, created_at, updated_at}
    issue_events: [], // {event_id, issue_id, seq, at, type, payload}
    reminders: [], // {reminder_id, issue_id, kind, seq, due_at, sent_at, status}
    control: { control_state: 'running', settings: {} }, // running|paused|closed
    clock: { now_at: null }, // 每用户 SimClock（epoch ms）
  };
}

export function ensureUserNode(db, userId) {
  if (!userId) throw new Error('userId is required');
  if (!db.users[userId]) db.users[userId] = defaultUserNode(userId);
  return db.users[userId];
}

export class Store {
  constructor(dbPath) {
    this.memory = dbPath === ':memory:';
    this.dbPath = this.memory ? null : (dbPath || resolveDbPath());
    this.db = emptyDb();
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
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.users) parsed.users = {};
      this.db = parsed;
    } catch (e) {
      if (e.code === 'ENOENT') this.db = emptyDb();
      else throw new Error(`读取 db.json 失败: ${e.message}`);
    }
    return this.db;
  }

  flush() {
    if (this.memory) return;
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.dbPath); // 原子落盘
  }

  userNode(userId) {
    return ensureUserNode(this.db, userId);
  }
}
