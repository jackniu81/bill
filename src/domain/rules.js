// 业务规则常量（时间均为毫秒）。
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// 疑似重复：同用户同商户同额、发生时间相差不超过 10 分钟。
export const DUPLICATE_WINDOW_MS = 10 * MINUTE;

// 退款：从申请确认起满 72 小时未全额到账 → 提醒。
export const REFUND_OVERDUE_MS = 72 * HOUR;

// 追加提醒：未回复时自上次至少 24 小时追加，最多两次。
export const FOLLOWUP_INTERVAL_MS = 24 * HOUR;
export const MAX_FOLLOWUPS = 2;

// “明天再提醒”默认延后 24 小时。
export const REMIND_TOMORROW_DEFAULT_MS = 24 * HOUR;
