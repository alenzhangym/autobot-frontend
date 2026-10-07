/**
 * [F67②] 一个目标链一张结果卡 —— 分组边界（不含任何渲染，便于用真机消息序列直接验）。
 */

/** 只有"正文是字符串的 assistant 消息"才进折叠卡：plan / ui_render / react_flow 有自己的可视化。 */
const isPlainAssistant = (m) => !!m && m.role === 'assistant' && typeof m.content === 'string'

/**
 * index 所在"同一用户回合的连续 assistant 消息"的最大区间，非 assistant 返回 null。
 *
 * <p>边界为什么取"上一条非 assistant 消息"而不是服务端新造一个 chainId：这一路的 ack（端侧结果回传、
 * F39⑥ 的续跑、F67① 交还运行腿那一跳）都不落 user 行 —— 2026-10-07 真机那条会话在库表里是 user 9940
 * 之后连着 9941~9948 七条 assistant，中间没有任何用户发言。"用户那句话到下一句发言之间"本身就是
 * 一个目标链的完整边界，不必再补一个只对它自己成立的编号。</p>
 *
 * <p>刻意只给区间、不动数组：自动执行扫描与结果回传都按 {@code msg.id} 找消息（App.jsx），
 * 物理合并会把那条链路打断；显示层折叠则一律不受影响。</p>
 */
export function resolveTurnRun(messages, index) {
  if (!Array.isArray(messages) || index < 0 || index >= messages.length) return null
  if (!isPlainAssistant(messages[index])) return null
  let start = index
  while (start - 1 >= 0 && isPlainAssistant(messages[start - 1])) start--
  let end = index
  while (end + 1 < messages.length && isPlainAssistant(messages[end + 1])) end++
  return { start, end }
}
