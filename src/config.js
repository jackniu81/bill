// 集中路径与运行期配置。可用环境变量覆盖 DB 路径，便于测试/场景使用独立临时库。
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DEFAULT_DB_PATH = path.join(DATA_DIR, 'db.json');

// 单一 db.json 存放所有用户（顶层按 userId 分组）。
export function resolveDbPath() {
  return process.env.BILL_DB_PATH || DEFAULT_DB_PATH;
}
