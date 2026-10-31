/**
 * sweepOwnership — `proc_sweep` 的归属证据（纯函数；I/O 由 server.js 注入）。
 *
 * <p>2026-10-31 dogfood 里，"停止后端服务"扫了一遍、把<b>后端自己</b>当成孤儿杀了。根因不是
 * `taskkill` 写错，而是<b>归属判据</b>太弱：当时只有一条「命令行里含这个工作区路径」，而工作区
 * 就是 autobot 仓库时，后端 JVM 的命令行自然含它。补两把显式排除（`exclude_pids` /
 * `exclude_markers`）能挡住那一次，但挡不住更一般的情形 —— 命令行里"恰好写到了"这个目录的
 * 进程（另一个仓库、编辑器、日志参数、脚本字面量）全都会进来。</p>
 *
 * <p>所以归属改成<b>三级证据</b>，逐条带回 `evidence`，让确认框与回传都能说清"凭什么算它"：</p>
 * <ol>
 *   <li><b>tree</b>（强）—— 这条 pid 是本会话登记过的那批后台任务的 <b>pid 树成员</b>。
 *       登记根 pid 即使在进程表里已经消失也保留：包装层死掉后子进程的 PPID 指向那个空号
 *       （Windows 不重新收养，见 `procListen.js` 的 #183），它的后代仍是我们的。
 *       <b>pid 复用守卫</b>：根 pid 还活着时必须"命令行里仍认得出那条任务的命令"，否则不按树认
 *       —— 号被别的进程复用时，认它等于认错人。</li>
 *   <li><b>port</b>（强）—— 这条 pid 正听着"本会话为这个工作区观测到过的端口"（`workspacePorts.js`）。
 *       这一级专治"命令行里没有工作区路径的孤儿"（{@code npm} 包一层的 node、spring-boot 派生的 Java）。</li>
 *   <li><b>path</b>（弱）—— 命令行里有<b>完整路径 token</b>指向工作区某个锚点（`matchesCwd`）。
 *       仍然保留：它是最初那条尺子，但已从子串收紧为 token 边界，且只作为兜底。</li>
 * </ol>
 *
 * <p>这一格只回答"有证据属于这个工作区"，不做排除（自身/父进程/exclude_pids/exclude_markers/
 * only_pids 全在 {@code selectSweepTargets} 那条链上），也不做任何终止。</p>
 */
import { descendFromRoots } from './procListen.js'
import { isUnderPath } from './processGroup.js'

/**
 * 文本归一化：还原被转义的引号、反斜杠转正斜杠、空白折叠、小写（命令行里的路径与命令串比对用）。
 *
 * <p>为什么要先还原 {@code \"}：Git Bash 起任务时把命令里的内层引号写成 {@code \"}，于是真实进程的
 * 命令行是 {@code bash.exe -c "node -e \"setInterval(...)\""}。若直接把反斜杠当路径转成斜杠，会变成
 * {@code node -e /"setInterval...} —— 与登记的命令串再也对不上，pid 复用守卫会把<b>自己的任务</b>
 * 当成"号被复用"拒掉（真机 2026-10-31 复验时正是这样，tree 证据整级失效）。</p>
 */
function normText(s) {
  return String(s == null ? '' : s)
    .replace(/\\"/g, '"')
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 命令行里是否仍认得出这条登记任务的命令（pid 复用守卫）—— 纯函数。
 *
 * <p>端侧起任务是 {@code bash.exe -c "<command>"}，命令串原样在命令行里；拿它对齐即可。
 * 命中判据刻意<b>从严</b>：整串包含就算；整串对不上时退一步用前 3 个 token（包装层可能改写引号）。
 * 两条都不中 → 判"不像"，不按树认（宁可少杀，不许错杀）。</p>
 *
 * @param {string} commandLine
 * @param {string} command
 * @returns {boolean}
 */
export function commandLineMentionsTask(commandLine, command) {
  const cmd = normText(command)
  if (!cmd) return false
  const line = normText(commandLine)
  if (!line) return false
  if (line.includes(cmd)) return true
  const head = cmd.split(' ').slice(0, 3).join(' ')
  return head.length >= 3 && line.includes(head)
}

/**
 * 算出"本会话有强证据归属这个工作区"的 pid 表（`pid → 'tree'|'port'`）。
 *
 * @param {Object} input
 * @param {string} input.cwd 本次 sweep 的工作区目录
 * @param {Array<Object>} [input.tasks] `taskRegistry.list()` 的条目（读 `pid` 与 `cwd`；也认原始条目的 `_child.pid`）
 * @param {Array<{pid:number, commandLine:string}>} [input.procs] 同一次快照里的全机进程表
 * @param {Map<number,number>} [input.ppidOf] PID → PPID 表（枚举失败给空表即可）
 * @param {Array<{pid:number, port:number}>} [input.listenRows] 监听表逐行原料
 * @param {Iterable<number>} [input.knownPorts] 本会话为这个工作区观测到过的端口
 * @returns {{evidence: Map<number,'tree'|'port'>, roots:number[], tree:number[],
 *   notes:string[], diag:Object}}
 */
export function attributeOwnedPids(input = {}) {
  const cwd = String(input.cwd || '')
  const tasks = input.tasks || []
  const procs = input.procs || []
  const ppidOf = input.ppidOf || new Map()
  const listenRows = input.listenRows || []
  const evidence = new Map()
  const notes = []

  const procsByPid = new Map()
  for (const p of procs) {
    const pid = Number(p && p.pid)
    if (pid > 0) procsByPid.set(pid, p)
  }

  // ① 登记任务 → 根 pid（带 cwd 范围闸与 pid 复用守卫）
  const roots = []
  let skippedForeign = 0
  let skippedNoCwd = 0
  for (const t of tasks) {
    // 两种形状都认：`taskRegistry.get()` 的原始条目（`_child.pid`）与 `taskRegistry.list()` 的
    // 快照（`summarize` 把 `_child` 摘掉、单列 `pid`）。server.js 传的是后者 —— 只认前者的话
    // 树这一级在真机上永远是空的。
    const pid = Number((t && t._child && t._child.pid) || (t && t.pid))
    if (!(pid > 0)) continue
    const taskCwd = String((t && t.cwd) || '')
    if (!taskCwd) { skippedNoCwd++; continue }
    if (!isUnderPath(taskCwd, cwd)) { skippedForeign++; continue }
    const row = procsByPid.get(pid)
    if (row && !commandLineMentionsTask(row.commandLine, t && t.command)) {
      notes.push(`pid ${pid} 的命令行不像这条登记任务（号可能已被复用）→ 不按树认`)
      continue
    }
    roots.push(pid)
  }

  // ② 树展开（根即使在进程表里已消失也保留：断链的后代仍要在队列里走一遍）
  const tree = roots.length ? descendFromRoots(roots, ppidOf) : []
  for (const pid of tree) evidence.set(pid, 'tree')

  // ③ 端口归属（只认本会话为这个工作区观测到过的口；不给名单 = 这一级今天为空，不猜）
  const ports = new Set()
  for (const raw of input.knownPorts || []) {
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 1 && n <= 65535) ports.add(n)
  }
  let portPids = 0
  for (const row of listenRows) {
    const pid = Number(row && row.pid)
    const port = Number(row && row.port)
    if (!(pid > 0) || !ports.has(port)) continue
    if (evidence.has(pid)) continue
    evidence.set(pid, 'port')
    portPids++
  }

  return {
    evidence,
    roots,
    tree,
    notes,
    diag: {
      roots: roots.length,
      tree: tree.length,
      port_pids: portPids,
      known_ports: ports.size,
      skipped_foreign_tasks: skippedForeign,
      skipped_no_cwd: skippedNoCwd,
    },
  }
}
