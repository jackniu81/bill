// 幂等写入辅助：按指定业务唯一键去重。
export function ensureUniqueById(list, item, key) {
  const idx = list.findIndex((x) => x[key] === item[key]);
  if (idx >= 0) return { created: false, existing: list[idx] };
  list.push(item);
  return { created: true, item };
}
