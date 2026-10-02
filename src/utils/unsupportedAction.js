/**
 * 前端遇到自己不认识的动作时回给后端的载荷。
 *
 * 为什么不能是一句自由文本（`Unknown command: xxx`）：后端拿它只能判"探测失败"，于是
 * 环境准备那条状态机会把失败当成"这个环境还没探明白"，再挂起一档去复探 —— 而真实原因是
 * **浏览器加载的前端包不认识这个动作**（前后端动作版本没对齐），复探一万次也不会有事实。
 * 结构化之后后端能一步收场，并把"要刷新/重建前端"这句真话说给用户。
 */

export const UNSUPPORTED_ACTION_KEY = 'unsupported_action';

/** @param {string} action 命令里带的动作名（缺失时给 '(missing)'，不让它变成空串） */
export function unsupportedActionPayload(action) {
  return JSON.stringify({
    [UNSUPPORTED_ACTION_KEY]: String(action == null || action === '' ? '(missing)' : action),
    note: '本机前端包不认识这个动作，需要重新构建/刷新页面（不是环境问题，重试不会变好）',
  });
}
