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
 * <p>[返工 R3·U1 贡献规范] 反方向同一条规矩，两条都要同笔改：<b>新增一个 `case` 就必须同笔入这份清单</b>
 * （`__tests__/frontendCapabilities.test.js` 两向都钉着）。确实不归这份清单管的手 ——
 * 后端就地解析的（`graph*` / `focus` / `issues` / `skill`）、写通道那一族的（`mkdir` / `cp` /
 * `search_replace` / `network`）、只由铸卡那条腿下发而不经 `clientSupports` 的（`scan`）——
 * 要在测试文件那份 `OUT_OF_LIST_BY_DESIGN` 里加一项并<b>写一行是谁下发的</b>；
 * 空着不写等于下一轮没人分得清"漏报"和"刻意不报"。</p>
 *
 * <p>为什么反方向也值得钉：漏报的代价按族不同，最重的一族是<b>手令</b> —— 后端发前读
 * `clientSupports`（`CodeAnalysisAgent` 的 `analysisCmdActions()` 那一族），
 * 漏报会让一只本来在的手永远发不出去，而交付里出现的是 `[能力不支持]`，
 * 读起来像"这台机器没这个能力"。那是谎报宿主事实，不是缺功能。</p>
 *
 * <p>刻意<b>不</b>列的: `depgraph` / `graph*` / `focus` / `issues` / `skill` / `diff` —— 这些由后端
 * {@code ServerSideCommandResolver} 就地解析或由别的通道处理，前端走到它们只会落 `default` 回
 * `unsupported_action`；把它们列进来等于告诉后端"这只手在"，而它不在。</p>
 */
export const FRONTEND_CAPABILITIES = Object.freeze([
  // 只读
  'read', 'ls', 'tree_sync',
  // [P4-A] 只读检索（glob/grep，只回命中位置）：父循环编排器（CodeOrchestratorAgent）**发前读本清单**
  //   （allowedActions → clientSupports），所以它必须在这里 —— 否则这只本来在的手永远发不出去。
  //   `WorkspacePanel.executeSingleCommand` 的 case 'search' 是它的事实依据。
  'search',
  // [F72·枚23/枚26] 只读端口真探（读现有监听表，不占口）：运行腿的"起来了没有"与停止腿的
  //   "停了没有"都要这一格结构事实，不再靠 stdout 词表猜。
  'proc_port_probe',
  // [F72·枚35] 只读任务真探（按 task_id 顺 pid 树，看它的进程树在听哪些口）：停止腿"停了没有"
  //   与运行腿"起来了没有"都要这一格结构事实。与 proc_port_probe 的分工：那一格按**端口**问，
  //   这一格按**任务**问 —— npm 包了一层 node、端口在子进程上时，只有后者答得出来。
  'proc_listen',
  // [P4-A·运行时确认] 只读工作区真探（按 cwd 扫"命令行里含该目录"的进程 + 它们各自在听的口）：
  //   用户问"前后端起没起来 / 端口在不在听"时，代码通道的父循环（CodeOrchestratorAgent）**发前读本
  //   清单**（allowedActions → clientSupports）。它与 proc_status 的分工：那一格只在 sidecar 任务表里
  //   找（用户自己在 IDE/终端起的服务不在表里），这一格按工作区目录在 OS 进程表里找。
  'proc_scan',
  // 写
  'write', 'delete', 'restore_bak', 'delete_bak',
  // 执行
  'run', 'proc_start', 'proc_status', 'proc_stop', 'proc_sweep',
  // 环境（F47）
  'env_probe',
  // 系统防护（Windows Defender 排除项；由客户端统一管理，见 runtime/defenderExclusions.js）
  'defender_exclude',
  // 流程（F39⑥）
  'plan_continue',
]);

export default FRONTEND_CAPABILITIES;