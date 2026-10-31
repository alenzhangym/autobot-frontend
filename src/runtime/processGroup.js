/**
 * processGroup — cross-platform helpers for killing a process and
 * all of its descendants. Phase 3 (C-4) of the opencode-vs-autobot
 * gap plan.
 *
 * Why a dedicated module?
 *  - On POSIX, a child spawned with `detached: true` is a process
 *    group leader. We can send `SIGTERM` to the whole group via
 *    `process.kill(-pid, 'SIGTERM')` (the leading `-` is the
 *    "process group" convention).
 *  - On Windows, there is no process-group primitive in the Node
 *    API. We shell out to `taskkill /pid <pid> /T /F` which walks
 *    the child tree (`/T`) and force-kills (`/F`).
 *
 * SIGTERM is sent first so well-behaved programs can flush buffers
 * and write a final log line; SIGKILL is sent after a grace period
 * if the process is still alive. The 2-second grace is short
 * enough that an agent doesn't feel stuck but long enough for
 * `mvn install` to write its BUILD SUCCESS line.
 */
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

const KILL_GRACE_MS = 2000

/**
 * Kill `child` and all of its descendants. Resolves once the kill
 * signal has been delivered (NOT once the process has actually
 * exited). Use `child.once('exit', ...)` if you need to wait for
 * full exit.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<void>}
 */
export function killProcessTree(child) {
  if (!child || child.killed || typeof child.pid !== 'number') {
    return Promise.resolve()
  }
  const pid = child.pid
  if (platform() === 'win32') {
    return killWindows(pid)
  }
  return killPosix(pid)
}

function killPosix(pid) {
  return new Promise((resolve) => {
    // SIGTERM to the whole process group.
    try {
      process.kill(-pid, 'SIGTERM')
    } catch (err) {
      // ESRCH means the process is already gone — that's fine.
      if (err.code !== 'ESRCH') {
        // Fall back to direct kill of the leader.
        try { process.kill(pid, 'SIGTERM') } catch (_) {}
      }
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (err) {
        if (err.code !== 'ESRCH') {
          try { process.kill(pid, 'SIGKILL') } catch (_) {}
        }
      }
      resolve()
    }, KILL_GRACE_MS).unref?.()
  })
}

function killWindows(pid) {
  return new Promise((resolve) => {
    // /T = kill child tree, /F = force.
    // We use `spawn` (not `exec`) so we don't have to escape
    // cmd.exe shell metacharacters. `windowsHide: true` keeps the
    // console flash from appearing on the user's desktop.
    const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    tk.on('exit', () => resolve())
    tk.on('error', () => {
      // taskkill missing? Try TerminateProcess via a direct signal.
      try { process.kill(pid, 'SIGTERM') } catch (_) {}
      resolve()
    })
  })
}

// ───────────────────────────────────────────────────────────────────
// [STOP] 终态任务的「OS 级兜底查杀」
// ───────────────────────────────────────────────────────────────────
// 背景（2026-10-12 实证）: 端侧起的 `mvn spring-boot:run` 超时后, 超时定时器只对 mvn 父进程做了
// killProcessTree; Windows 下 `taskkill /pid <mvn> /T /F` 若在父进程已退出时才执行, 由
// spring-boot:run 派生出的 Java 子进程会变成孤儿继续占着端口。此后 proc_status 把该任务报成
// `status=timeout`, 按 task_id 再停也杀不动 —— 于是要有这条"按 cwd 兜底扫孤儿"的路。
//
// 安全边界: 只认"命令行里含该任务 cwd"的进程, 且永不杀自身/父进程。task.cwd 是 autobot 起该任务时
// 记下的工作目录; 别的项目(含 autobot 后端自己)的命令行不含它, 天然不会被误伤。
//   [C·2026-10-31 更正] 上面这句在"workspace 就是 autobot 仓库"时不成立（dogfood 实测把后端杀了）——
//   所以现在多两把显式排除：excludePids（调用方把自己的 pid 递进来）与 excludeMarkers。

/** 归一化: 反斜杠转正斜杠 + 小写(Windows 大小写不敏感)。 */
function norm(s) {
  return String(s == null ? '' : s).replace(/\\/g, '/').toLowerCase()
}

/**
 * [C·2026-10-31 归属判据·收紧] 命令行是否**引用**给定 cwd —— 按「完整路径 token」判，不按子串判。
 *
 * <p>旧实现是 `norm(line).includes(norm(cwd))`（子串），于是两类假归属都会进来：</p>
 * <ul>
 *   <li>前缀共享的<b>别的项目</b>：工作区 {@code E:\code\autobot}，对手仓库 {@code E:\code\autobot-fork\app}
 *       的命令行里"含"这个子串 → 被当成这个项目的孤儿，sweep 会把它杀了；</li>
 *   <li>命令行里作为<b>内容</b>出现的路径（日志参数、脚本字面量、编辑器打开过的目录）：同样"含"。</li>
 * </ul>
 *
 * <p>新判据要求：该出现位置是一个<b>完整的路径 token</b> —— 前面不是路径的延续字符（字母/数字/
 * {@code -_.~} 与分隔符），后面只允许结束、路径分隔符（= 该目录下）或标点/空白/引号/分隔符
 * （{@code = : ; , " ' ) ] } | &}）。这样 {@code E:\code\autobot\autobot-frontend\server.js}
 * 与 {@code --project=E:\code\autobot} 命中，而 {@code E:\code\autobot-fork\app} 与
 * {@code E:\code\autobot.jar} 不命中。</p>
 *
 * <p>这只是三级证据里的<b>弱</b>一级（{@code path}）：它能证明"命令行里确实写到了这个目录"，
 * 证明不了"这个进程属于这个项目"（Windows 的命令行里没有工作目录这一格）。强证据在
 * `sweepOwnership.js` 的两级 —— 本会话登记的 pid 树（{@code tree}）与端口归属（{@code port}）。</p>
 *
 * @param {string} commandLine
 * @param {string} cwd
 * @returns {boolean}
 */
export function matchesCwd(commandLine, cwd) {
  const c = norm(cwd).replace(/\/+$/, '')
  const line = norm(commandLine)
  if (!c || !line) return false
  let from = 0
  while (true) {
    const i = line.indexOf(c, from)
    if (i < 0) return false
    const before = i === 0 ? '' : line[i - 1]
    const after = i + c.length >= line.length ? '' : line[i + c.length]
    // 后边界：路径分隔符 = 锚点**之下**的路径（命中）；其余必须是 token 结束符
    if (breaksPathToken(before) && (after === '' || after === '/' || breaksPathToken(after))) return true
    from = i + 1
  }
}

/** 路径 token 的两侧允许出现的字符（出现即说明是新的 token，而不是同一个更长的路径）。 */
const PATH_TOKEN_BREAK = new Set([
  ' ', '\t', '\n', '\r', '"', "'", '`', '=', ';', ':', ',', '(', ')', '[', ']', '{', '}', '<', '>', '|', '&',
])

/** 该字符是否"路径 token 的边界"（空串 = 行首/行尾）。 */
function breaksPathToken(ch) {
  return ch === '' || PATH_TOKEN_BREAK.has(ch)
}

/**
 * 子路径是否**在**父路径之下（含相等；按路径分隔符对齐，不做子串判）—— 纯函数。
 *
 * <p>给归属用：登记任务的 cwd 必须落在这次 sweep 的 cwd 之下才算同一片工地
 * （{@code E:\code\autobot-x} 不在 {@code E:\code\autobot} 之下）。</p>
 * @param {string} childPath
 * @param {string} parentPath
 * @returns {boolean}
 */
export function isUnderPath(childPath, parentPath) {
  const child = norm(childPath).replace(/\/+$/, '')
  const parent = norm(parentPath).replace(/\/+$/, '')
  if (!child || !parent) return false
  return child === parent || child.startsWith(parent + '/')
}

/**
 * [C·2026-10-31] 命令行是否命中某条「别杀」标记（大小写不敏感子串；纯函数）。
 *
 * <p>为什么要有这一格：{@link matchesCwd} 的假设是"别的项目（含 autobot 后端自己）的命令行不含
 * 这个 cwd"。workspace 就是 autobot 仓库时这条假设不成立 —— 2026-10-31 的 dogfood 里
 * {@code proc_sweep(cwd=E:\code\autobot)} 就把后端 JVM 当成孤儿杀了，驱动的那一轮随即连接失败。
 * 归属判据（含 cwd）只回答"像不像这个项目的"，**"是不是我自己"必须由调用方另行给出**：
 * 服务端把自己的 pid 递进来（{@code exclude_pids}），端侧再按标记兜一层（{@code exclude_markers}）。</p>
 *
 * @param {string} commandLine
 * @param {string[]} markers
 * @returns {boolean}
 */
export function matchesExcludeMarker(commandLine, markers) {
  if (!Array.isArray(markers) || markers.length === 0) return false
  const c = norm(commandLine)
  return markers.some((m) => {
    const t = norm(m).trim()
    if (t.length === 0) return false
    return c.includes(t.replace(/^[/\\]+|[/\\]+$/g, ''))
  })
}

/**
 * 解析「PID + 命令行」逐行输出（Windows 为 TAB 分隔, POSIX `ps` 为空白分隔）——纯函数。
 * @param {string} output
 * @returns {Array<{pid:number, commandLine:string}>}
 */
export function parseProcTable(output) {
  const out = []
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/)
    if (!m) continue
    const pid = Number.parseInt(m[1], 10)
    if (pid > 0) out.push({ pid, commandLine: m[2] })
  }
  return out
}

/** Windows 枚举命令: PID<TAB>命令行（用真 TAB, 避免 CSV 引号转义）。 */
const WIN_ENUM = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | '
  + 'ForEach-Object { "$($_.ProcessId)\t$($_.CommandLine)" }'

/**
 * 枚举全机「PID + 命令行」（{@code commandLine} 这一格只有停止腿/清扫用得上）。
 *
 * <p>[C·2026-10-31] 公开导出：sweep 的归属判据要把"进程表 + 本会话登记的 pid 树 + 端口归属"
 * 放在同一份快照上判（`sweepOwnership.js`），枚举因此提到调用方，不能再被扫两遍。</p>
 * @returns {Promise<{procs:Array<{pid:number, commandLine:string}>, via:string,
 *   code:number, bytes:number, err:string}>}
 */
export async function listCommandLines() {
  // [修复1 根因] 这里原来写的是 `platform === 'win32'` —— `platform` 是 node:os 导出的**函数**，
  //   与字符串恒不相等 → Windows 上永远走 POSIX 分支，去起 `ps -eo pid=,args=`（sidecar 在 Git
  //   Bash 的 PATH 上恰好有 MSYS 的 ps，它不认 -eo，直接 "unknown option -- o" 空回）。于是
  //   killOrphansByCwd 每次都枚举到 0 条，sweep 永远杀不到任何进程。必须调用 platform()。
  if (platform() === 'win32') {
    const r = await runCapture('powershell',
      ['-NoProfile', '-NonInteractive', '-Command', WIN_ENUM])
    return { procs: parseProcTable(r.out), via: 'cim', code: r.code, bytes: r.out.length, err: r.err.trim() }
  }
  const r = await runCapture('ps', ['-eo', 'pid=,args='])
  return { procs: parseProcTable(r.out), via: 'ps', code: r.code, bytes: r.out.length, err: r.err.trim() }
}

/**
 * 收一条只读/查杀命令的 stdout+stderr（失败 → 空串, 绝不抛）。
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<{code:number, out:string, err:string}>}
 */
function runCapture(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    const finish = (code) => { if (!done) { done = true; resolve({ code, out, err }) } }
    try {
      const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      p.stdout?.on('data', (d) => { out += d.toString('utf8') })
      p.stderr?.on('data', (d) => { err += d.toString('utf8') })
      p.on('error', (e) => { err += String(e && e.message || e); finish(-1) })
      p.on('exit', (code) => finish(code == null ? -1 : code))
      setTimeout(() => finish(-2), timeoutMs).unref?.()
    } catch (e) { err += String(e && e.message || e); finish(-1) }
  })
}

/** PowerShell 兜底：Stop-Process -Force（taskkill 失败时用，例如对端进程上下文不允许 taskkill /T）。 */
async function stopProcessPowerShell(pid) {
  const r = await runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `Stop-Process -Id ${Number(pid)} -Force -ErrorAction Stop`])
  return { killed: r.code === 0, error: r.err.trim() }
}

/**
 * 强杀单个 pid，返回诊断（是否成功 + taskkill 退出码 + stderr）。
 * Windows 下 taskkill 失败时兜底改用 PowerShell Stop-Process -Force，把真实原因暴露出来 ——
 * 这是 2026-10-12 实证的失败点：sidecar 进程上下文执行 taskkill 常常杀不动（进程以管理员身份
 * 启动 / 上下文权限不足），旧实现只 resolve(false)，一个字的原因都不留。
 *
 * <p>[C·2026-10-31] 公开导出：`proc_stop {pid}` 这条显式目标的腿（{@code POST /api/local/bash/kill-pid}）
 * 只杀用户看得见的那一个 pid，与 sweep 共用同一套诊断。</p>
 * @param {number} pid
 * @returns {Promise<{killed:boolean, exitCode:number, error:string}>}
 */
export function forceKill(pid) {
  return new Promise((resolve) => {
    if (platform() !== 'win32') {
      try {
        process.kill(pid, 'SIGKILL')
        resolve({ killed: true, exitCode: 0, error: '' })
      } catch (e) {
        resolve({ killed: false, exitCode: -1, error: String(e && e.message || e) })
      }
      return
    }
    runCapture('taskkill', ['/pid', String(pid), '/T', '/F']).then(async (r) => {
      if (r.code === 0) return resolve({ killed: true, exitCode: 0, error: '' })
      const fb = await stopProcessPowerShell(pid)
      const err = [r.err.trim(), fb.error].filter(Boolean).join(' | ')
      resolve({ killed: fb.killed, exitCode: r.code, error: err })
    })
  })
}

/**
 * [C·2026-10-31] "这条进程算不算本次清扫的目标"—— 唯一一处判据（纯函数）。
 *
 * <p>当场事故是"按 cwd 误杀后端"：workspace 根就是 autobot 仓库时，后端自己的命令行里也含这个
 * cwd，于是被当成孤儿。所有闸必须放在同一条链上，且预览与实杀共用它，否则"确认的不是执行的
 * 那一份"：</p>
 * <ol>
 *   <li>{@code excludePids} —— 自身/父进程/服务端点名的进程族，一个都不许动；</li>
 *   <li>{@code excludeMarkers} —— 命令行含这些标记的（如 {@code java-backend}）整体排除；</li>
 *   <li>{@code onlyPids} —— 用户刚确认过的那一批；给了就只杀这一批，预览之后新起的进程不顺手带走；</li>
 *   <li>归属三选一（并给每条打上 {@code evidence}，确认框里看得见"凭什么算它"）：
 *       <ul>
 *         <li>{@code tree} = 本会话登记任务的 pid 树成员（{@code ownedPids} 里带 {@code 'tree'}）；</li>
 *         <li>{@code port} = 正在监听"本会话为这个工作区观测到过的端口"（{@code ownedPids} 里带 {@code 'port'}）；</li>
 *         <li>{@code path} = 命令行里有**完整路径 token** 指向工作区某锚点（{@link matchesCwd}）。</li>
 *       </ul>
 *       旧实现只有 {@code path} 且是子串匹配 —— 前缀共享的对手仓库、命令行里当内容出现的路径都会进来。</li>
 * </ol>
 *
 * @param {Array<{pid:number, commandLine:string}>} procs 全机进程表
 * @param {{anchors?: string[], excludePids?: number[], excludeMarkers?: string[],
 *   onlyPids?: number[], ownedPids?: (Map<number,'tree'|'port'>|number[])}} [opts]
 *   {@code ownedPids}：本会话有强证据归属这个工作区的进程（Map 带证据类型；数组按 {@code 'tree'}）。
 * @returns {Array<{pid:number, commandLine:string, evidence:'tree'|'port'|'path'}>}
 */
export function selectSweepTargets(procs, opts = {}) {
  const exclude = new Set([process.pid, process.ppid, ...(opts.excludePids || [])])
  // 三态，别把"没给名单"与"名单为空"当成一件事：
  //   undefined/非数组 → 不设限（server 重启兜底、DELETE /tasks/:id 这类无确认流程照旧按 cwd 全收）；
  //   数组（哪怕是空数组/全是垃圾值）→ 只认这份名单，空名单意味着"一条都没确认" → 一条都不杀。
  //   （若把空数组也折成"不设限"，一次参数拼错就会退化成盲扫全 cwd。）
  const hasOnly = Array.isArray(opts.onlyPids)
  const only = hasOnly
    ? new Set(opts.onlyPids.map(Number).filter((p) => Number.isFinite(p) && p > 0))
    : null
  // 强证据表：pid → 'tree' | 'port'
  const owned = new Map()
  if (opts.ownedPids instanceof Map) {
    for (const [pid, why] of opts.ownedPids) {
      const n = Number(pid)
      if (n > 0) owned.set(n, String(why || 'tree'))
    }
  } else if (Array.isArray(opts.ownedPids)) {
    for (const pid of opts.ownedPids) {
      const n = Number(pid)
      if (n > 0) owned.set(n, 'tree')
    }
  }
  const anchors = Array.isArray(opts.anchors) ? opts.anchors : []
  const out = []
  for (const p of procs || []) {
    if (exclude.has(p.pid)) continue
    if (matchesExcludeMarker(p.commandLine, opts.excludeMarkers)) continue
    if (hasOnly && !only.has(p.pid)) continue
    const strong = owned.get(p.pid)
    const evidence = strong || (anchors.some((a) => matchesCwd(p.commandLine, a)) ? 'path' : null)
    if (!evidence) continue
    out.push({ pid: p.pid, commandLine: p.commandLine, evidence })
  }
  return out
}

/**
 * 只读版"按 cwd 扫存活进程"：与 {@link killOrphansByCwd} 共用同一份枚举与归属判据，但**不杀**。
 *
 * <p>为什么要有这一格：用户问"前后端起没起来 / 端口在不在听"时，代码通道此前手里只有文件类动作
 * （tree_sync / ls / read / search），跑不出任何运行时事实，于是把缺口甩回给用户（"请提供日志 /
 * 请自己 ps -ef"）。这条腿把"这台机器上这个项目的进程此刻在不在"变成一份可下发的只读原料 ——
 * 归属判据仍是"命令行里含该 cwd"（与停止腿同一把尺子），排除自身/父进程，不做任何终止。</p>
 *
 * <p>覆盖性如实带回：`enumerated`（枚举到几条）、`via`（枚举通道）、`enumErr`（枚举失败原因）。
 * 枚举失败 ≠ 没有进程 —— 读这一方必须能分开这两件事。</p>
 *
 * @param {string} cwd 工作区根（或某个模块目录）
 * @param {{excludePids?: number[], excludeMarkers?: string[], onlyPids?: number[],
 *   ownedPids?: (Map<number,'tree'|'port'>|number[]), includeChildren?: boolean,
 *   listing?: {procs:Array<{pid:number, commandLine:string}>, via:string, err:string}}} [opts]
 * @returns {Promise<{enumerated:number, matched:number, via:string, enumErr:string,
 *   anchors:string[], procs:Array<{pid:number, cmd:string, evidence:string}>}>}
 */
export async function scanProcessesByCwd(cwd, opts = {}) {
  if (!cwd) return { enumerated: 0, matched: 0, via: '', enumErr: '缺少 cwd', anchors: [], procs: [] }
  const anchors = scanAnchors(cwd, opts.includeChildren !== false)
  const listing = opts.listing || await listCommandLines()
  const procs = selectSweepTargets(listing.procs, { ...opts, anchors })
    .map((p) => ({
      pid: p.pid,
      cmd: String(p.commandLine || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      // 归属证据（tree/port/path）：只读这一格也要能说清"凭什么算它"，否则读的人无从分辨
      // "确实是我起的" 与 "命令行里恰好写到了这个目录"。
      evidence: p.evidence,
    }))
  return {
    enumerated: listing.procs.length,
    matched: procs.length,
    via: listing.via,
    enumErr: listing.err,
    anchors,
    procs,
  }
}

/**
 * 归属锚点：工作区根 + 它的一级子目录。
 *
 * <p>为什么不能只认根：多模块仓库里服务常从子目录起（{@code litemall-admin} / {@code litemall-all}），
 * 命令行里只有那个子目录的路径 —— 2026-10-31 的用例正是这种。只按根扫会得到"枚举到几百条、
 * 命中 0 条"，读起来像"服务没起"，其实是判据太窄。</p>
 *
 * <p>仍然是只读的同一把尺子（命令行包含某个锚点），只是把锚点从 1 个扩成"根 + 一级子目录"。
 * 一级子目录读不到（权限/路径不存在）→ 只按根扫，并把锚点数如实回带。</p>
 */
function scanAnchors(cwd, includeChildren) {
  const anchors = [cwd]
  if (!includeChildren) return anchors
  try {
    for (const e of fs.readdirSync(cwd, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      anchors.push(path.join(cwd, e.name))
    }
  } catch (_) {
    // 目录读不到 → 只按根扫；覆盖性由 anchors.length 与 enumerated 如实体现
  }
  return anchors
}

/**
 * 按 cwd 扫"命令行里含该 cwd"的存活进程并强杀（终态任务的 OS 级兜底）。
 *
 * <p>返回诊断而非裸布尔：枚举到几条、命中几条、逐条的 taskkill 退出码与 stderr —— 失败时
 * 才说得清"为什么一个都没杀到"（旧实现只回 killed=false，原因全丢）。</p>
 * @param {string} cwd 任务的工作目录（autobot 起它时记下的）
 * @param {{excludePids?: number[], excludeMarkers?: string[], includeChildren?: boolean,
 *   onlyPids?: number[], ownedPids?: (Map<number,'tree'|'port'>|number[]),
 *   listing?: {procs:Array<{pid:number, commandLine:string}>, via:string, err:string}}} [opts]
 *   `onlyPids` = 只杀这一份名单里的 pid（用户确认过的那一批）。
 *   [C·2026-10-31] 为什么要它：预览与实际执行之间有几十毫秒，期间新起的进程若按 cwd 重新枚举
 *   就会被"顺带"杀掉 —— 而那一条用户根本没见过。确认的对象必须与执行的对象是同一批。
 * @returns {Promise<{killed:boolean, enumerated:number, matched:number, anchors:string[],
 *   detail:Array<{pid:number, killed:boolean, exitCode:number, error:string, evidence:string}>}>}
 */
export async function killOrphansByCwd(cwd, opts = {}) {
  if (!cwd) return { killed: false, enumerated: 0, matched: 0, via: '', enumErr: '', anchors: [], detail: [] }
  // [C·2026-10-31] 与只读预览（{@link scanProcessesByCwd}）用同一组锚点、同一处过滤（{@link selectSweepTargets}）：
  //   预览列出 N 条、用户点头之后杀的却是另一组（旧实现只按 cwd 一根锚点）—— 那是"确认的不是执行的那一份"。
  const anchors = scanAnchors(cwd, opts.includeChildren !== false)
  const listing = opts.listing || await listCommandLines()
  const procs = listing.procs
  const targets = selectSweepTargets(procs, { ...opts, anchors })
  const detail = []
  if (targets.length === 0) {
    console.log(`[sweep] cwd=${cwd} 枚举 ${procs.length} 条(via=${listing.via}, code=${listing.code}, `
      + `bytes=${listing.bytes})，命中 0 条（无孤儿可清）`
      + (listing.err ? `；枚举诊断: ${listing.err}` : ''))
    return { killed: false, enumerated: procs.length, matched: 0, via: listing.via,
      enumErr: listing.err, anchors, detail }
  }
  let killedAny = false
  for (const t of targets) {
    const r = await forceKill(t.pid)
    if (r.killed) killedAny = true
    // [F72·枚26] 带上命令行摘要（截断）：服务端要拿它对着**模块表**说"命中这条是哪一档"，
    //   否则"停止前端服务"永远只能说"扫到几条"，答不出停的是不是前端。摘要只用于归属判断，
    //   不进模型上下文的那格由服务端控制。
    detail.push({ pid: t.pid, killed: r.killed, exitCode: r.exitCode, error: r.error,
      evidence: t.evidence,
      cmd: String(t.commandLine || '').replace(/\s+/g, ' ').trim().slice(0, 120) })
  }
  const killedN = detail.filter((d) => d.killed).length
  console.log(`[sweep] cwd=${cwd} 枚举 ${procs.length} 条(via=${listing.via})，命中 ${targets.length} 条，`
    + `终止 ${killedN} 条；逐条: ${JSON.stringify(detail)}`)
  return { killed: killedAny, enumerated: procs.length, matched: targets.length,
    via: listing.via, enumErr: listing.err, anchors, detail }
}
