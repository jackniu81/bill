const VALID = ['running', 'paused', 'closed'];

export function getState(node) {
  return node.control.control_state;
}

export function setState(node, state) {
  if (!VALID.includes(state)) throw new Error(`非法控制态: ${state}`);
  node.control.control_state = state;
  return state;
}
