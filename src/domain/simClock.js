// 每用户模拟时钟（存于 node.clock.now_at，epoch ms）。业务判定用它而非真实墙钟。
// 时间展示按北京时间 Asia/Shanghai；输入的场景时刻（如 09:00）以 +08:00 解释为 epoch。

const BJ_FMT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatBeijing(ms) {
  if (ms == null) return '未初始化';
  const parts = BJ_FMT.formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} (北京时间)`;
}

// 将「北京时间的日期 + 时刻」解析为 epoch ms。date='YYYY-MM-DD', time='HH:mm' 或 'HH:mm:ss'。
export function beijingMs(date, time) {
  const t = time.length === 5 ? `${time}:00` : time;
  const iso = `${date}T${t}+08:00`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`无法解析北京时间: ${date} ${time}`);
  return ms;
}

export function getNow(node) {
  return node.clock.now_at;
}

export function initClock(node, atMs) {
  if (typeof atMs !== 'number') throw new Error('initClock 需要 epoch ms');
  node.clock.now_at = atMs;
  return atMs;
}

export function setNow(node, atMs) {
  node.clock.now_at = atMs;
  return atMs;
}

export function advance(node, ms) {
  if (node.clock.now_at == null) throw new Error('时钟未初始化，请先 setNow/推进前的基准时间');
  node.clock.now_at += ms;
  return node.clock.now_at;
}

// 解析时长字符串：支持 30m / 24h / 48h / 90min / 2d / 以及纯毫秒。
export function parseDuration(str) {
  if (typeof str === 'number') return str;
  const s = String(str).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|min|m|h|d)$/i);
  if (!m) throw new Error(`无法解析时长: ${str}`);
  const val = Number(m[1]);
  const unit = m[2].toLowerCase();
  const table = { ms: 1, s: 1000, min: 60000, m: 60000, h: 3600000, d: 86400000 };
  return Math.round(val * table[unit]);
}
