/**
 * [L0] 前端能力清单 —— 单一事实来源。
 *
 * <p>为什么需要它: 后端有一条**反向通道**（`__CMD__{"action":"env_probe"|"proc_start"|...}`
 * 交给前端 WorkspacePanel 在用户机器上执行）。如果浏览器加载的是一份**旧前端包**，它不认识这些
 * 新动作，只会回一句自由文本 `Unknown command: env_probe`；后端只能判成"这次探测失败了"，
 * 整条环境准备（F47⑤）就静默死在那里 —— 2026-10-02 的事故正是如此（8000 端口服务的前端包
 * 停在 2026-09-06）。</p>
 *
 * <p>本清单随包走：每次 `/api/chat` 由 `getClientInfo()` 上报为 `client_info.features`。
 * 旧包没有这一段（或清单更短），后端据此在**发命令之前**就知道"这只手现在在不在"，
 * 从而给出精确指引，而不是发出一堆必然失败的指令再收到一串 Unknown command。</p>
 *
 * <p>约束: 这里的每一项都必须真的在 `components/WorkspacePanel.jsx` 的
 * `executeSingleCommand` 里有对应 `case`。清单只描述"我能执行什么"，不描述"后端有什么"。</p>
 *
 * <p>刻意<b>不</b>列的: `depgraph` / `graph*` / `focus` / `issues` / `skill` / `diff` —— 这些由后端
 * {@code ServerSideCommandResolver} 就地解析或由别的通道处理，前端走到它们只会落 `default` 回
 * `unsupported_action`；把它们列进来等于告诉后端"这只手在"，而它不在。</p>
 */
export const FRONTEND_CAPABILITIES = Object.freeze([
  // 只读
  'read', 'ls', 'tree_sync',
  // 写
  'write', 'delete', 'restore_bak', 'delete_bak',
  // 执行
  'run', 'proc_start', 'proc_status', 'proc_stop',
  // 环境（F47）
  'env_probe',
  // 流程（F39⑥）
  'plan_continue',
]);

export default FRONTEND_CAPABILITIES;