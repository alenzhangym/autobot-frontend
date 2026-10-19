/**
 * [返工 R2·2.1] `[COMMAND_RESULTS]` 的 `[META:{json}]` 头与逐格原子事实 —— 纯函数，可单测。
 *
 * <p>为什么单独成文件: 这一轮的判据是"无 extra 时消息与今天<b>逐字节一致</b>"，
 * 而 `WorkspacePanel.jsx` 在 `node --test` 下编不动（JSX）。本仓已有同一口径的先例
 * （`runtime/portProbe.js` / `runtime/procListen.js`：纯函数抽出来钉，派发那一步留在组件里）。</p>
 *
 * <p>立场（清单"协议面"硬约束 #5）: 前端这一层<b>只报原子事实</b>——
 * 不写 `status`、不写 `killed_ids`、不折 outcome、不折批。
 * "整批到底算成功还是失败"归读回灌正文的那一方；服务端唯一的集合运算
 * （`killed_ids = 显式 killed_ids ∪ {r.id : r.timed_out === true}`）在
 * {@code CommandResultsEnvelope} 一处做。</p>
 */

/**
 * 逐格原子事实的临时账：命令 id → 这一格<b>真的在手</b>的结构化事实。
 *
 * <p>只有 `run` 那一族给得出 `exit_code` / `timed_out`（响应体里就有，见
 * `WorkspacePanel.jsx` 的 `case 'run'`）；其余动作一格不编 ——
 * 缺字段在后端读成"不知道"，既不折成 true 也不折成 false。</p>
 *
 * <p>生命周期：随一批命令生灭。批次拼 META 时由 {@link takeCommandCellFacts} 取走并清空，
 * 与 `streamedCmdResults` 同口径（防止流式预派发被中断时留下孤儿条目）。</p>
 */
export const cmdCellFacts = new Map()

export function recordCommandCellFact(id, fact) {
  if (!id || typeof id !== 'string') return
  cmdCellFacts.set(id, { ...(cmdCellFacts.get(id) || {}), ...fact })
}

/** 取走并清空：批次 META 是唯一消费者，取完不许再留。 */
export function takeCommandCellFacts(commands) {
  const out = new Map()
  for (const cmd of commands) {
    const id = cmd?.id
    if (!id || typeof id !== 'string') continue
    const f = cmdCellFacts.get(id)
    if (f) out.set(id, f)
    cmdCellFacts.delete(id)
  }
  return out
}

/**
 * 这批命令是否被<b>逐格枚举完全</b>（结构性事实，不是判决）。
 *
 * <p>两种 false 都如实报：有命令没 id（那一格没法在明细里指认）、同 id 出现两次
 * （服务端折出的集合会把两条并成一条，等于"报少了"）。旧包没有这一格 = 缺字段，
 * 消费侧照旧按 `cmd-read:` 前缀兜底整批剔。</p>
 */
export function isBatchEnumerated(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return false
  const ids = commands.map((c) => c?.id)
  if (!ids.every((id) => typeof id === 'string' && id.trim() !== '')) return false
  return new Set(ids).size === ids.length
}

/**
 * [枚48/#173] `run` 那一格的退出码：sidecar 没回 = <b>不知道</b>，不许折成 0。
 *
 * <p>原状是一处折两次：{@code WorkspacePanel.jsx} 的 {@code case 'run'} 与
 * {@code scripts/dogfood/real-session-driver.mjs} 各写一份 {@code typeof x === 'number' ? x : 0}，
 * 于是①交回服务端的正文尾部出现 {@code [exit=0]}、②逐格账的 {@code exit_code} 也是 0。
 * 服务端 {@code CommandResultsEnvelope.exitCodeOfRunBody} 里"没有标记 = 判不了成败（不等于失败）"
 * 那一支因此永远不会被喂到，而一条没拿到结论的命令被说成"跑通了"。</p>
 *
 * <p>定式：这一格只有<b>一个实现点</b>，正文与逐格账由同一次归一产出（一枚结构事实的两个消费点
 * 不许各写一份）。{@code [exit=unknown]} 与"不写标记"在服务端读成同一格（都判不了成败），
 * 选前者是为了让读正文的那一方看见"端侧真去拿了，那一格不在场"。</p>
 */
export function normalizeRunExitCode(raw) {
  return Number.isInteger(raw) ? raw : null
}

/** 正文尾部那一格：被等待上限杀死 / 真拿到的退出码 / 没拿到（unknown = 判不了，不是失败）。
 *  标记要始终在场：后端 `isExecutionFailure` 优先按它判，避免"成功但 stdout 含 Error 字样"被误判成失败。 */
export function runOutputMarker(exitCode, timedOut) {
  if (timedOut === true) return '\n[Execution timed out]'
  return Number.isInteger(exitCode) ? `\n[exit=${exitCode}]` : '\n[exit=unknown]'
}

/**
 * 一次产出 `run` 那一格的<b>两个</b>消费者：逐格账要的 fact、交回服务端的正文。
 *
 * <p>{@code fact} 里那一格缺失时 {@code exit_code} 键<b>不进</b>明细 —— 端侧只报原子事实，
 * 缺字段在后端读成"不知道"（折成 null 上去会让 {@code ImplementationService} 那句
 * "含 exit_code 且不为 0 = 失败"的字符串兜底把它读成失败）。</p>
 */
export function readRunCell(output, rawExitCode, rawTimedOut) {
  const exitCode = normalizeRunExitCode(rawExitCode)
  const timedOut = rawTimedOut === true
  return {
    exitCode,
    timedOut,
    fact: exitCode === null ? { timed_out: timedOut } : { exit_code: exitCode, timed_out: timedOut },
    body: (typeof output === 'string' ? output : String(output || '')) + runOutputMarker(exitCode, timedOut),
  }
}

/**
 * 拼逐格明细：每格只带它真的有的那几项。
 *
 * @param {Array<{id?: string, action?: string}>} commands 本批命令（顺序即回传顺序）
 * @param {Map<string, {exit_code?: number, timed_out?: boolean}>} facts 已由
 *   {@link recordCommandCellFact} 记下的事实
 * @param {Map<string, number>} timings 本批<b>真执行过</b>的那几格的墙钟耗时；
 *   走缓存复用的格子没有这一项（不编）
 */
export function buildCommandCellResults(commands, facts, timings) {
  const out = []
  for (const cmd of commands) {
    const one = {}
    if (cmd?.id != null) one.id = cmd.id
    if (cmd?.action != null) one.action = cmd.action
    const f = cmd?.id != null ? facts?.get?.(cmd.id) : undefined
    if (f && f.exit_code !== undefined) one.exit_code = f.exit_code
    if (f && typeof f.timed_out === 'boolean') one.timed_out = f.timed_out
    const ms = cmd?.id != null ? timings?.get?.(cmd.id) : undefined
    if (typeof ms === 'number') one.elapsed_ms = ms
    out.push(one)
  }
  return out
}

/**
 * P1 线协议升级: 构造 [COMMAND_RESULTS] 可选的 [META:{json}] 行。
 * 仅携带已跟踪的字段 (session_id 必有; turn_id / tool_call_id / session_version 尚未
 * 跟踪时可缺省, 由后端填权威值)。无 sessionId 时返回空串 → 消息保持与 legacy 格式一致。
 *
 * [返工 R2·2.1] `extra.results` / `extra.enumerated`：逐格原子事实 + "这批我报全了没有"。
 * 这两键<b>只在显式给出时出现</b>——不给 extra 的调用点必须逐字节回到今天的形状。
 *
 * @param {string} sessionId
 * @param {{turnId?: number, toolCallId?: string, sessionVersion?: number,
 *          results?: Array<Object>, enumerated?: boolean}} [extra]
 * @returns {string} '[META:{...}]' 或 ''
 */
export function buildCommandResultsMeta(sessionId, extra) {
  if (!sessionId) return ''
  const meta = { session_id: sessionId }
  if (extra?.turnId != null) meta.turn_id = extra.turnId
  if (extra?.toolCallId != null) meta.tool_call_id = extra.toolCallId
  if (extra?.sessionVersion != null) meta.session_version = extra.sessionVersion
  if (Array.isArray(extra?.results)) meta.results = extra.results
  if (typeof extra?.enumerated === 'boolean') meta.enumerated = extra.enumerated
  return `[META:${JSON.stringify(meta)}]`
}
