/**
 * S2: 集中式 `__CMD__{...}` 块解析器 —— 三处共用。
 *
 * <p>历史背景：{@code __CMD__{...}} 块（agent 输出的 JSON 指令体）原来在
 * <strong>三处</strong>独立实现：</p>
 * <ol>
 *   <li>{@code App.jsx} 的 streaming handler（深度 + 字符串感知的 brace scan）</li>
 *   <li>{@code WorkspacePanel.tryStreamDispatch}（同样的 brace scan，但加
 *       {@code READ_ACTIONS} 早派发逻辑）</li>
 *   <li>{@code monitor/AnalysisClient.parseCmdBlocks}（独立 brace scan）</li>
 * </ol>
 *
 * <p>三份实现各有细节差异（escape 处理、depth 终止条件、错误恢复），任何
 * 一处修 bug 都要另外两处一起改。S2 把共用的"扫描 + 解析"逻辑抽到这里，
 * 各自只保留<strong>动作层</strong>（派发 / 早派发 / 入库）。</p>
 *
 * <p>注意：本模块是<strong>纯函数</strong>，不依赖 React / WebSocket /
 * workspaceDir，可被前端、monitor 脚本、单测共用。</p>
 */

/**
 * 在文本中扫描所有完整的 `__CMD__{...}` 块并返回解析后的对象。
 *
 * <p>扫描算法：</p>
 * <ul>
 *   <li>找 {@code __CMD__} 标记；其后必须紧跟 {@code '{'}</li>
 *   <li>从 {@code '{'} 起做 brace-depth 扫描，跟踪 string / escape
 *       状态以避免 JSON 字符串内的大括号误算</li>
 *   <li>depth 归 0 时把子串 JSON.parse；失败则跳过该块继续扫描</li>
 * </ul>
 *
 * @param {string} text 原始文本
 * @returns {Array<{cmd: object, start: number, end: number}>} 命令列表及位置
 */
export function parseAllCmdBlocks(text) {
  if (!text || typeof text !== 'string' || !text.includes('__CMD__')) {
    return []
  }
  const out = []
  let searchStart = 0
  const MARKER = '__CMD__'
  while (true) {
    const idx = text.indexOf(MARKER, searchStart)
    if (idx < 0) break
    const jsonStart = idx + MARKER.length
    if (jsonStart >= text.length || text[jsonStart] !== '{') {
      searchStart = jsonStart
      continue
    }
    const end = scanBraceEnd(text, jsonStart)
    if (end < 0) {
      // 不完整 —— 停止扫描（流式场景下这是预期行为）
      break
    }
    const jsonStr = text.substring(jsonStart, end + 1)
    try {
      out.push({ cmd: JSON.parse(jsonStr), start: idx, end: end + 1 })
    } catch (_) {
      // JSON 损坏 —— 跳过该块继续
    }
    searchStart = end + 1
  }
  return out
}

/**
 * 找一个 {@code '{'} 对应的匹配 {@code '}'}（含 string / escape 感知）。
 *
 * @param {string} text
 * @param {number} openIdx '{' 位置
 * @returns {number} 对应 '}' 的位置；-1 表示不完整
 */
export function scanBraceEnd(text, openIdx) {
  if (text[openIdx] !== '{') return -1
  let depth = 0
  let inString = false
  let escape = false
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (inString) {
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = false; continue }
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { depth++; continue }
    if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 流式增量场景：扫描"到目前为止"已完整的所有块。
 *
 * <p>与 {@link parseAllCmdBlocks} 的区别：本函数会在扫描期间遇到
 * <strong>不完整</strong>的尾部块时立即停止（{@code depth > 0} 而文本到末尾），
 * 不报错。这意味着调用方可以每次 token 进来时重新跑一次"全文扫描"，安全。</p>
 *
 * @param {string} text 累积的流式文本
 * @returns {Array<{cmd: object, start: number, end: number}>}
 */
export function parseCompleteCmdBlocksStreaming(text) {
  return parseAllCmdBlocks(text)
}

/**
 * 去除 {@code __CMD__{...}} 块（仅保留非指令文本），用于显示层。
 * 借用 {@code helpers.jsx} 的同名函数 —— 但本模块对 Node 环境也可用
 * （不依赖 React），因此独立实现一份。
 */
export function stripCmdBlocks(text) {
  if (!text || typeof text !== 'string') return text
  const blocks = parseAllCmdBlocks(text)
  if (blocks.length === 0) return text
  let out = ''
  let cursor = 0
  for (const b of blocks) {
    out += text.slice(cursor, b.start)
    cursor = b.end
  }
  out += text.slice(cursor)
  return out
}
