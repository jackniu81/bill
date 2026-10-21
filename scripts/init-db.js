// 初始化/重建 data/db.json，便于重复测试。
//   node scripts/init-db.js init            # 不存在则创建空库
//   node scripts/init-db.js reset           # 清空重建空库
import fs from 'node:fs';
import { Store, emptyDb } from '../src/store/jsonStore.js';
import { resolveDbPath } from '../src/config.js';

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
  default:
    console.log('用法: node scripts/init-db.js [init|reset]');
}
