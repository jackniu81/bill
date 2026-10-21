// 初始化/重建 data/db.json，便于重复测试。
//   node scripts/init-db.js init            # 不存在则创建空库
//   node scripts/init-db.js reset           # 清空重建空库
//   node scripts/init-db.js seed <file>     # 从 fixture 重建库（仅基础事实，问题由引擎生成）
import fs from 'node:fs';
import path from 'node:path';
import { Store, defaultUserNode, emptyDb, ensureUser, saveScoped } from '../src/store/jsonStore.js';
import { resolveDbPath, FIXTURES_DIR } from '../src/config.js';

const cmd = process.argv[2] || 'init';
const dbPath = resolveDbPath();

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function freshStore() {
  const s = new Store(dbPath);
  s.db = emptyDb();
  return s;
}

switch (cmd) {
  case 'reset': {
    const s = freshStore();
    s.flush();
    console.log(`[reset] db.json 已清空重建: ${dbPath}`);
    break;
  }
  case 'init': {
    if (exists(dbPath)) {
      console.log(`[init] db.json 已存在: ${dbPath}`);
    } else {
      const s = freshStore();
      s.flush();
      console.log(`[init] db.json 已创建: ${dbPath}`);
    }
    break;
  }
  case 'seed': {
    let file = process.argv[3];
    if (!file) {
      console.error('用法: node scripts/init-db.js seed <fixture.json>');
      process.exit(1);
    }
    if (!path.isAbsolute(file) && !exists(file)) file = path.join(FIXTURES_DIR, file);
    const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = freshStore();
    const users = fixture.users || {};
    for (const [uid, data] of Object.entries(users)) {
      ensureUser(s.db, uid);
      const node = defaultUserNode(uid);
      node.transactions = (data.transactions || []).slice();
      node.refund_applications = (data.refund_applications || []).slice();
      node.refund_receipts = (data.refund_receipts || []).slice();
      if (data.clock && typeof data.clock.now_at === 'number') node.clock.now_at = data.clock.now_at;
      saveScoped(s.db, uid, node);
    }
    s.flush();
    const userCount = s.db.tables.users.length;
    console.log(`[seed] 已从 ${file} 重建 db.json（${userCount} 个用户，关系表结构）`);
    console.log('[seed] 注意: 仅为模拟数据；疑似问题由引擎在处理数据后自动生成。');
    break;
  }
  default:
    console.log('用法: node scripts/init-db.js [init|reset|seed <file>]');
}
