// 测试辅助：构造干净的内存用户节点并设置北京时间基准。
import { defaultUserNode } from '../src/store/jsonStore.js';
import { setNow, beijingMs, advance } from '../src/domain/simClock.js';
import { tick } from '../src/app/followUpEngine.js';
import { ingestTransaction, ingestRefundApplication, ingestRefundReceipt } from '../src/app/ingestService.js';
import { markIssue } from '../src/app/userService.js';

export function freshNode(userId = 'test-user') {
  return defaultUserNode(userId);
}

// 便捷：设置模拟时钟（北京时间 date/time）
export function at(node, date, time) {
  setNow(node, beijingMs(date, time));
  return node;
}

export { tick, advance, beijingMs, setNow, ingestTransaction, ingestRefundApplication, ingestRefundReceipt, markIssue };
