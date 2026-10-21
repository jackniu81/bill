// 问题状态机与结案依据（纯函数）。
export const STATUS = {
  SUSPECT: 'SUSPECT', // 疑似/待处理
  PENDING: 'PENDING_RESOLUTION', // 确有问题但未解决 = 待解决
  RESOLVED: 'RESOLVED', // 已解决（退款全额到账验证）
  NORMAL: 'NORMAL', // 正常两次购买
  SELF_RESOLVED: 'SELF_RESOLVED', // 已自行解决
  CLOSED: 'CLOSED', // 关闭
};

export const BASIS = {
  VERIFIED_BY_REFUND: 'VERIFIED_BY_REFUND', // 退款全额到账（仅退款类）
  USER_CONFIRMED: 'USER_CONFIRMED', // 疑似重复由用户明确确认解决（非验证退款）
  USER_MARKED_NORMAL: 'USER_MARKED_NORMAL', // 用户标正常两次购买
  USER_SELF_RESOLVED: 'USER_SELF_RESOLVED', // 用户已自行解决
  USER_CLOSED: 'USER_CLOSED', // 用户关闭
};

export const MARKS = {
  NORMAL: 'normal_two_purchases',
  CONFIRM: 'confirm_problem',
  REMIND_TOMORROW: 'remind_tomorrow',
  SELF_RESOLVED: 'self_resolved',
  CLOSE: 'close',
};

// 是否为终结态（不再自动推进/提醒）。
export function isTerminal(status) {
  return [STATUS.RESOLVED, STATUS.NORMAL, STATUS.SELF_RESOLVED, STATUS.CLOSED].includes(status);
}

// 退款全额到账 → 验证解决。
export function resolveByRefund(issue) {
  issue.status = STATUS.RESOLVED;
  issue.closure_basis = BASIS.VERIFIED_BY_REFUND;
  return issue;
}

// 将用户标记映射为状态/结案依据；remind_tomorrow 只影响调度不改状态。
// 返回 { status?, closure_basis?, scheduling? } —— 由引擎落库并追加事件。
export function applyMark(issue, action) {
  switch (action) {
    case MARKS.NORMAL:
      // 仅对疑似重复有意义；退款类不允许此标记（引擎侧校验）。
      issue.status = STATUS.NORMAL;
      issue.closure_basis = BASIS.USER_MARKED_NORMAL;
      return { status: issue.status, closure_basis: issue.closure_basis };
    case MARKS.CONFIRM:
      // 确有问题 ≠ 解决：进入待解决，等待事实或下一明确约定。
      issue.status = STATUS.PENDING;
      issue.closure_basis = null;
      return { status: issue.status, closure_basis: null };
    case MARKS.SELF_RESOLVED:
      issue.status = STATUS.SELF_RESOLVED;
      // 疑似重复的"用户明确确认解决" → 标 USER_CONFIRMED；退款类 → USER_SELF_RESOLVED。
      issue.closure_basis = issue.kind === 'duplicate' ? BASIS.USER_CONFIRMED : BASIS.USER_SELF_RESOLVED;
      return { status: issue.status, closure_basis: issue.closure_basis };
    case MARKS.CLOSE:
      issue.status = STATUS.CLOSED;
      issue.closure_basis = BASIS.USER_CLOSED;
      return { status: issue.status, closure_basis: issue.closure_basis };
    case MARKS.REMIND_TOMORROW:
      return { scheduling: 'remind_tomorrow' }; // 不改状态/依据
    default:
      throw new Error(`未知用户标记: ${action}`);
  }
}

// 标记合法性校验（诚实性：不允许对退款标"正常两次购买"等）。
export function validateMark(issue, action) {
  if (action === MARKS.NORMAL && issue.kind !== 'duplicate') {
    return { ok: false, error: '“正常两次购买”仅适用于疑似重复消费问题' };
  }
  if (isTerminal(issue.status) && action !== MARKS.CONFIRM) {
    // 终结态后仍允许记录事实事件，但不因用户标记被重新打开（引擎负责不重开）。
    return { ok: true, warn: '问题已处终结态，标记仅作记录不重开' };
  }
  return { ok: true };
}
