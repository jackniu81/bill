// 场景脚手架：每场景一个独立用户 + 独立临时 db.json；每个操作后触发引擎自检（等价"自行检查"）。
// restart() 通过 flush + 重新读盘模拟进程中断恢复。
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/store/jsonStore.js';
import { tick } from '../../src/app/followUpEngine.js';
import { ingestTransaction, ingestRefundApplication, ingestRefundReceipt } from '../../src/app/ingestService.js';
import { markIssue, setControl } from '../../src/app/userService.js';
import { listIssues, showIssue, report } from '../../src/app/queryService.js';
import { beijingMs, parseDuration, setNow, advance, getNow } from '../../src/domain/simClock.js';
import { yuanToCents } from '../../src/domain/money.js';
import { duplicateIssueId } from '../../src/domain/duplicateDetector.js';
import { refundIssueId } from '../../src/domain/refundTracker.js';

export class Scenario {
  constructor(userId, dbPath) {
    this.userId = userId;
    this.dbPath = dbPath || path.join(os.tmpdir(), `bill-scenario-${userId}.json`);
    this.store = new Store(this.dbPath);
    this.store.load();
    // 每次运行为该用户清掉持久化行并重建干净视图，保证场景可重复、互不串扰（不影响 restart 的读盘恢复）
    this.store.clearUser(userId);
    this.node = this.store.userNode(userId);
  }

  _autoTick(opts) {
    if (getNow(this.node) != null) tick(this.node, opts);
    this.store.flush();
  }

  setNow(date, time) {
    setNow(this.node, beijingMs(date, time));
    this._autoTick();
  }
  tx(id, merchant, yuan, date, time) {
    ingestTransaction(this.node, { tx_id: id, merchant, amount_cents: yuanToCents(yuan), occurred_at: beijingMs(date, time) });
    this._autoTick();
  }
  app(refundId, yuan, date, time) {
    ingestRefundApplication(this.node, { refund_id: refundId, expected_amount_cents: yuanToCents(yuan), confirmed_at: beijingMs(date, time) });
    this._autoTick();
  }
  receipt(receiptId, refundId, yuan, date, time) {
    ingestRefundReceipt(this.node, { receipt_id: receiptId, refund_id: refundId, amount_cents: yuanToCents(yuan), received_at: beijingMs(date, time) });
    this._autoTick();
  }
  advanceDur(str) {
    advance(this.node, parseDuration(str));
    this._autoTick();
  }
  mark(issueId, action, opts = {}) {
    const r = markIssue(this.node, issueId, action, opts);
    this._autoTick();
    return r;
  }
  control(sub) {
    const map = { pause: 'paused', resume: 'running', close: 'closed', reopen: 'running' };
    setControl(this.node, map[sub]);
    this._autoTick({ resume: sub === 'resume' });
  }
  restart() {
    this.store.flush();
    this.store = new Store(this.dbPath);
    this.store.load();
    this.node = this.store.userNode(this.userId);
    return this;
  }

  dupId(a, b) {
    return duplicateIssueId(a, b);
  }
  rfdId(refundId) {
    return refundIssueId(refundId);
  }
  list() {
    return listIssues(this.node);
  }
  issue(id) {
    return showIssue(this.node, id);
  }
  issueState(id) {
    return this.node.issues.find((i) => i.issue_id === id) || null;
  }
  remindersFor(id) {
    return this.node.reminders.filter((r) => r.issue_id === id && r.status === 'sent');
  }
  report() {
    return report(this.node);
  }
}

// 断言辅助：收集 {desc, ok} 供 run-all 汇总。
export function check(desc, fn) {
  let ok = false;
  let err = null;
  try {
    ok = !!fn();
  } catch (e) {
    ok = false;
    err = e.message;
  }
  return { desc, ok, err };
}
