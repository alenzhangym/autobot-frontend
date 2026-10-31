/**
 * workspacePorts — 本会话为某个工作区**观测到过的端口**（sweep 的第二级归属证据）。
 *
 * <p>为什么要有这一格：{@code proc_sweep} 真正要清的常常是"包装层死了、服务还在听"的孤儿
 * （{@code npm run dev} 的 node 子进程、spring-boot 派生的 Java）。那条进程的命令行里往往
 * <b>没有</b>工作区路径（{@code node} 只带自己的入口脚本），于是「命令行含 cwd」这把尺子对
 * 它天然失明；而它<b>正听着的那个口</b>，是这台机器上唯一还能对上账的结构事实。</p>
 *
 * <p>所以这里记的不猜、不复制：只在两处<b>已实测</b>的读表结果落账 ——</p>
 * <ul>
 *   <li>{@code proc-scan}：这个 cwd 下按（tree/port/path）证据认出来的进程各自在听的端口；</li>
 *   <li>{@code proc-listen}：某条登记任务的进程树在听的端口（按 task 的 cwd 落账）。</li>
 * </ul>
 * <p>sweep 时用它做"端口归属"：此刻有进程在听这些口 → 这条进程算这个工作区的。**只在本进程
 * 内存里**、带 TTL（默认 30 分钟）—— 端口会被后来的无关进程复用，旧账不能无限期当证据；
 * sidecar 一重启账本就空，与 {@code taskRegistry} 同一条纪律（不落盘、不复活）。</p>
 */
import { isUnderPath } from './processGroup.js'

/** 观测记录的有效期：超过这么久没再被观测到，就不再用它做归属。 */
export const WORKSPACE_PORT_TTL_MS = 30 * 60 * 1000

/** cwd(归一化) → Map<port, {first_ms, last_ms, source}> */
const REGISTRY = new Map()
let ttlMs = WORKSPACE_PORT_TTL_MS

/** 只做本模块的归一化（与 processGroup 的 norm 同一条规矩：反斜杠转正斜杠 + 小写）。 */
function normCwd(cwd) {
  return String(cwd == null ? '' : cwd).replace(/\\/g, '/').toLowerCase().trim().replace(/\/+$/, '')
}

/** 端口三态里只留合法的那一格（1~65535 的整数；其余一律丢弃，不猜）。 */
function validPort(raw) {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null
}

/**
 * 记一次"这个工作区的这些端口此刻有人在听"。
 *
 * @param {string} cwd 工作区目录（调用方给的原样路径；内部归一化）
 * @param {Array<{port: number}|number>} rows 监听表逐行原料（只需要 port 这一列）
 * @param {string} [source] 出处（{@code proc-scan} / {@code proc-listen}），进诊断用
 * @param {number} [nowMs]
 * @returns {{recorded:number, ports:number[], cwd:string}} 实际落账的端口（0 条 = 这次没记到东西）
 */
export function recordWorkspacePorts(cwd, rows, source = '', nowMs = Date.now()) {
  const key = normCwd(cwd)
  let book = REGISTRY.get(key)
  if (!book) {
    book = new Map()
    REGISTRY.set(key, book)
  }
  const recorded = []
  for (const row of rows || []) {
    const port = validPort(typeof row === 'object' && row ? row.port : row)
    if (!port) continue
    const prev = book.get(port)
    book.set(port, {
      first_ms: prev ? prev.first_ms : nowMs,
      last_ms: nowMs,
      source: String(source || ''),
    })
    if (!recorded.includes(port)) recorded.push(port)
  }
  return { recorded: recorded.length, ports: recorded, cwd: key }
}

/**
 * 查"这个工作区（含其下子目录的账）观测到过的端口有哪些是仍然有效的"。
 *
 * <p>子目录的账并进来：{@code proc-listen} 按 task.cwd 落账（常常是模块子目录），而 sweep 的
 * cwd 往往是工作区根 —— 只看同一条 cwd 的账会把这层证据整批丢掉。</p>
 *
 * @param {string} cwd
 * @param {number} [nowMs]
 * @returns {{ports:Set<number>, sources:string[], expired:number, cwds:string[]}}
 */
export function workspacePortsOf(cwd, nowMs = Date.now()) {
  const key = normCwd(cwd)
  const ports = new Set()
  const sources = []
  const cwds = []
  let expired = 0
  if (!key) return { ports, sources, expired, cwds }
  for (const [bookCwd, book] of REGISTRY) {
    if (!isUnderPath(bookCwd, key)) continue
    cwds.push(bookCwd)
    for (const [port, meta] of book) {
      if (!(nowMs - meta.last_ms <= ttlMs)) { expired++; continue }
      ports.add(port)
      if (meta.source && !sources.includes(meta.source)) sources.push(meta.source)
    }
  }
  return { ports, sources, expired, cwds }
}

/** 清掉某个工作区（或整本）的端口账 —— 供测试与"用户说别再用旧账"的场景。 */
export function clearWorkspacePorts(cwd) {
  if (cwd === undefined || cwd === null || cwd === '') {
    REGISTRY.clear()
    return
  }
  REGISTRY.delete(normCwd(cwd))
}

/** 用例缝：把 TTL 改小以便验证"过期就不算"。传 ≤0 恢复默认。 */
export function setWorkspacePortTtlForTests(ms) {
  const n = Number(ms)
  ttlMs = Number.isFinite(n) && n > 0 ? n : WORKSPACE_PORT_TTL_MS
}
