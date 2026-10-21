// 金额一律以「整数分」存储与计算，避免浮点误差；展示格式化为 RMB。
export function yuanToCents(value) {
  // 接受 number 或 string（元），最多两位小数，四舍五入到分。
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.\-]/g, '')) : Number(value);
  if (!Number.isFinite(n)) throw new Error(`无效金额: ${value}`);
  return Math.round(n * 100);
}

export function centsToYuan(cents) {
  return cents / 100;
}

export function formatRMB(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}¥${yuan}.${frac}`;
}
