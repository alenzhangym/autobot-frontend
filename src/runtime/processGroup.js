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

/** 归一化: 反斜杠转正斜杠 + 小写(Windows 大小写不敏感)。 */
function norm(s) {
  return String(s == null ? '' : s).replace(/\\/g, '/').toLowerCase()
}

/**
 * 命令行是否引用给定 cwd（纯函数，便于单测）。
 * @param {string} commandLine
 * @param {string} cwd
 * @returns {boolean}
 */
export function matchesCwd(commandLine, cwd) {
  const c = norm(cwd).replace(/\/+$/, '')
  if (!c) return false
  return norm(commandLine).includes(c)
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

async function listProcesses() {
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
 * @param {number} pid
 * @returns {Promise<{killed:boolean, exitCode:number, error:string}>}
 */
function forceKill(pid) {
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
 * 按 cwd 扫"命令行里含该 cwd"的存活进程并强杀（终态任务的 OS 级兜底）。
 *
 * <p>返回诊断而非裸布尔：枚举到几条、命中几条、逐条的 taskkill 退出码与 stderr —— 失败时
 * 才说得清"为什么一个都没杀到"（旧实现只回 killed=false，原因全丢）。</p>
 * @param {string} cwd 任务的工作目录（autobot 起它时记下的）
 * @param {{excludePids?: number[]}} [opts]
 * @returns {Promise<{killed:boolean, enumerated:number, matched:number,
 *   detail:Array<{pid:number, killed:boolean, exitCode:number, error:string}>}>}
 */
export async function killOrphansByCwd(cwd, opts = {}) {
  if (!cwd) return { killed: false, enumerated: 0, matched: 0, via: '', enumErr: '', detail: [] }
  const exclude = new Set([process.pid, process.ppid, ...(opts.excludePids || [])])
  const listing = await listProcesses()
  const procs = listing.procs
  const targets = procs.filter((p) => !exclude.has(p.pid) && matchesCwd(p.commandLine, cwd))
  const detail = []
  if (targets.length === 0) {
    console.log(`[sweep] cwd=${cwd} 枚举 ${procs.length} 条(via=${listing.via}, code=${listing.code}, `
      + `bytes=${listing.bytes})，命中 0 条（无孤儿可清）`
      + (listing.err ? `；枚举诊断: ${listing.err}` : ''))
    return { killed: false, enumerated: procs.length, matched: 0, via: listing.via,
      enumErr: listing.err, detail }
  }
  let killedAny = false
  for (const t of targets) {
    const r = await forceKill(t.pid)
    if (r.killed) killedAny = true
    detail.push({ pid: t.pid, killed: r.killed, exitCode: r.exitCode, error: r.error })
  }
  const killedN = detail.filter((d) => d.killed).length
  console.log(`[sweep] cwd=${cwd} 枚举 ${procs.length} 条(via=${listing.via})，命中 ${targets.length} 条，`
    + `终止 ${killedN} 条；逐条: ${JSON.stringify(detail)}`)
  return { killed: killedAny, enumerated: procs.length, matched: targets.length,
    via: listing.via, enumErr: listing.err, detail }
}
