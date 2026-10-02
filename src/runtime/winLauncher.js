// ─────────────────────────────────────────────────────────────────────────────
// [L1] Windows 启动器解析 —— 把"裸命令"变成"真的能 spawn 起来的东西"
//
// 2026-10-02 实测（本机 sidecar）:
//   execFile('mvn',      ['--version'])              → spawn mvn ENOENT
//   execFile('mvn.cmd',  ['--version'])              → spawn EINVAL (Node ≥20.12 安全限制:
//                                                       .cmd/.bat 必须 shell:true, 否则拒绝执行)
//   execFile('cmd.exe',  ['/d','/s','/c','mvn','-v'])→ 正常: Apache Maven 3.9.8 / Java 21.0.4
//
// mvn / npm / pnpm / yarn / npx / gradlew 在 Windows 上都是 .cmd shim，所以 sidecar 里**每一条**
// 走 `execFile(shell:false)` 的装依赖/起进程命令，今天都必然以 [exit=1] 收场 —— 与 cwd 对不对无关。
// 这就是"零弹窗"最底下那一层：不是模型不听话，是这只手在 Windows 上是断的。
//
// 设计纪律（三条，缺一条就会把事情做坏）:
//   ① 不是无条件包 shell。只有 .cmd/.bat 才包 `cmd.exe /d /s /c`；.exe 直接 spawn。
//      无条件包 shell 等于把整条命令重新交回 cmd 解析面，凭空多出一个注入面。
//   ② 不是拼字符串。cmd 模式只送**裸命令名**（不带路径、不带引号），其余 token 逐字跟在后面，
//      由 cmd.exe 自己在 cwd + PATH 上解析 —— 与实测可用的那条写法逐字一致。
//      带路径的 .cmd 一旦进 `/s /c`，cmd 的引号剥离规则会在空格处把路径切断。
//   ③ 判不了 ≠ 没有。`where.exe` 找不到 = 真的不在 PATH（found:false）；
//      超时/权限/EINVAL 等 = **判不了**（found:null），绝不能写成"这台机器没装 X"。
//      （F47 文档里"本机实测 mvn found:false"就是这么来的假阴性。）
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const IS_WIN = os.platform() === 'win32'

/**
 * cmd 解析面里会改变语义的字符。命中即 fail-closed（refuse），不做"转义一下试试"。
 */
const CMD_META = /["%^&|<>()\r\n!]/

/** 可直接 spawn 的真二进制扩展名。 */
const DIRECT_EXTS = new Set(['.exe', '.com'])
/** 必须经 cmd.exe 才能跑起来的脚本扩展名。 */
const CMD_EXTS = new Set(['.cmd', '.bat'])

/** 是否有 cmd 元字符（refuse 判据，导出以便单测与调用方复用）。 */
export function hasCmdMeta(token) {
  return CMD_META.test(String(token == null ? '' : token))
}

/**
 * 用 `where.exe` 解析一个裸命令，返回命中路径列表（按 where 的输出顺序）。
 * 找不到 → 空数组。`where.exe` 本身跑不起来 → 返回 null（**判不了**，与"没有"分开）。
 */
export function wherePaths(name) {
  try {
    const out = execFileSync('where.exe', [name], {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return String(out || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch (e) {
    // exit=1 / ENOENT(stdout 空) = where 跑过了但没找到；其余（EINVAL/EPERM/超时）= 判不了
    const code = e && e.status
    if (code === 1) return []
    return null
  }
}

/**
 * 解析一条命令该以什么形态启动。
 *
 * @param {string} command 裸命令或带扩展名/相对路径的命令
 * @param {{cwd?: string}} [opts] cwd（用于优先认项目内 shim：mvnw / gradlew 这类）
 * @returns {{
 *   mode: 'direct'|'cmd'|'refuse',
 *   file: string,          // 实际 spawn 的可执行文件（cmd 模式恒为 cmd.exe）
 *   args: string[],        // 需要前置的 argv（cmd 模式为 /d /s /c <裸名>）
 *   kind: 'exe'|'cmd'|'unknown',
 *   resolved: string|null, // where/项目内查到的路径（分类依据，也是可读证据）
 *   reason: string|null,   // refuse/未解析时的原因（可读，直接给模型或用户看）
 *   env: { ComSpec?: string }
 * }}
 */
export function resolveLauncher(command, opts = {}) {
  const raw = String(command == null ? '' : command).trim()
  const cwd = opts.cwd ? path.resolve(opts.cwd) : null

  if (!raw) {
    return { mode: 'refuse', file: '', args: [], kind: 'unknown', resolved: null, reason: '空命令' }
  }

  // 非 Windows: 一律原样直连（这套只在 Windows 上有必要，别处保持零影响）
  if (!IS_WIN) {
    return { mode: 'direct', file: raw, args: [], kind: 'exe', resolved: null, reason: null }
  }

  if (hasCmdMeta(raw)) {
    return {
      mode: 'refuse', file: raw, args: [], kind: 'unknown', resolved: null,
      reason: `命令含 shell 元字符，拒绝执行（不是转义问题，是另一条命令）: ${raw}`,
    }
  }

  const ext = path.extname(raw).toLowerCase()

  // ① 已带扩展名：直接按扩展名分类，不再查 where（调用方已经指名道姓）
  if (ext) {
    if (DIRECT_EXTS.has(ext)) {
      return { mode: 'direct', file: raw, args: [], kind: 'exe', resolved: raw, reason: null }
    }
    if (CMD_EXTS.has(ext)) {
      if (/\s/.test(raw)) {
        return {
          mode: 'refuse', file: raw, args: [], kind: 'cmd', resolved: null,
          reason: `带路径的 ${ext} 脚本含空格，cmd /d /s /c 的引号剥离会切断路径，拒绝执行: ${raw}`,
        }
      }
      return { mode: 'cmd', file: cmdExe(), args: ['/d', '/s', '/c', raw], kind: 'cmd', resolved: raw, reason: null }
    }
    // 其它扩展名（.py/.sh/.js…）不是可执行体，保持原样交给调用方（可能带 shebang / 关联）
    return { mode: 'direct', file: raw, args: [], kind: 'unknown', resolved: raw, reason: null }
  }

  // ② 项目内 shim 优先：cwd 下的 mvnw / gradlew 这类仓库自带包装器，必须先于 PATH 命中
  if (cwd) {
    for (const cand of ['.exe', '.cmd', '.bat']) {
      const p = path.join(cwd, raw + cand)
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          if (CMD_EXTS.has(cand)) {
            return { mode: 'cmd', file: cmdExe(), args: ['/d', '/s', '/c', raw], kind: 'cmd', resolved: p, reason: null }
          }
          return { mode: 'direct', file: p, args: [], kind: 'exe', resolved: p, reason: null }
        }
      } catch { /* 权限/竞态 → 继续找下一个候选 */ }
    }
  }

  // ③ PATH 上解析：where.exe 给出真路径，用来分类（不是用来当 spawn 参数）
  const paths = wherePaths(raw)
  if (paths === null) {
    return {
      mode: 'direct', file: raw, args: [], kind: 'unknown', resolved: null,
      reason: 'where.exe 无法运行，无法判定该命令的形态（判不了 ≠ 没有）',
    }
  }
  if (paths.length === 0) {
    return {
      mode: 'direct', file: raw, args: [], kind: 'unknown', resolved: null, notFound: true,
      reason: `PATH 上找不到 ${raw}（确实没装，或没进 PATH）`,
    }
  }
  // 有 .exe 优先用 .exe（少一层 cmd）；否则第一个 .cmd/.bat 走 cmd 模式
  const exeHit = paths.find((p) => DIRECT_EXTS.has(path.extname(p).toLowerCase()))
  if (exeHit) {
    return { mode: 'direct', file: exeHit, args: [], kind: 'exe', resolved: exeHit, reason: null }
  }
  const cmdHit = paths.find((p) => CMD_EXTS.has(path.extname(p).toLowerCase()))
  if (cmdHit) {
    return { mode: 'cmd', file: cmdExe(), args: ['/d', '/s', '/c', raw], kind: 'cmd', resolved: cmdHit, reason: null }
  }
  return { mode: 'direct', file: paths[0], args: [], kind: 'exe', resolved: paths[0], reason: null }
}

/** `cmd.exe` 的绝对路径（ComSpec 优先，退到 System32；都拿不到就用裸名）。 */
function cmdExe() {
  const spec = process.env.ComSpec
  if (spec && fs.existsSync(spec)) return spec
  const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const p = path.join(sysRoot, 'System32', 'cmd.exe')
  return fs.existsSync(p) ? p : 'cmd.exe'
}