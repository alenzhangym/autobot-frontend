// [F72·枚35] `proc_listen` —— 只读事实：**某个后台任务（task_id）的进程树此刻在听哪些口**。
//
// 为什么要有这一格（§0.④ 的根治点）：停止腿今天只信 `taskkill` 的返回码 —— 端侧说"杀过了"就收场，
//   系统里**没有任何一格**能证伪"它其实还在听 9527"。而运行腿那条路（`proc_port_probe`）之所以证不了，
//   是因为它挂在"账上这条腿的端口那一格"上：npm 包了一层 node、端口在**子进程**上，端口格是空的，
//   于是永不铸探针（§0.④）。
// 这一格把缺的原料一次补齐：`task_id → 根 pid → 子进程树 → 树里那些 pid 各自在听的口`，
//   全部只读、逐字带出处（pid / port / address / channel）。服务端只把它当原料写进账 ——
//   **不解读、不筛端口、不猜"哪个是它对外服务的口"**（§1 立场：那是判断，归模型）。
//
// 与 portProbe.js 的分工：那一格回答"这个**端口**有没有人听"（三态）；这一格回答
//   "这一**任务**的进程树在听哪些口"（按 pid 归树，不猜端口）。两者共用同一份监听表枚举。
import { platform } from 'node:os'
import { spawn } from 'node:child_process'
import { listListeners } from './portProbe.js'
import { get as getTask } from './taskRegistry.js'

/** Windows 枚举 `PID<TAB>PPID`（真 TAB，避免 CSV 引号转义）。 */
const WIN_TREE = 'Get-CimInstance Win32_Process | '
  + 'ForEach-Object { "$($_.ProcessId)\t$($_.ParentProcessId)" }'

/**
 * 解析「PID + 父 PID」逐行输出（Windows TAB 分隔 / POSIX `ps -eo pid=,ppid=` 空白分隔）—— 纯函数。
 * @param {string} text
 * @returns {Map<number, number>} pid → ppid
 */
export function parsePpidTable(text) {
  const out = new Map()
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/)
    if (!m) continue
    out.set(Number.parseInt(m[1], 10), Number.parseInt(m[2], 10))
  }
  return out
}

/**
 * 从根 pid 集合顺出整棵子进程树（先在子进程树上做一次走访，再收集）—— 纯函数。
 * 结果按"根在前、后代在后"的稳定次序排列；环形/自引用由 `seen` 兜住（不重复、不死循环）。
 * @param {Array<number|string>} roots
 * @param {Map<number, number>} ppidOf
 * @returns {number[]}
 */
export function descendFromRoots(roots, ppidOf) {
  const out = []
  const seen = new Set()
  const children = new Map()
  for (const [pid, ppid] of ppidOf || []) {
    const arr = children.get(ppid) || []
    arr.push(pid)
    children.set(ppid, arr)
  }
  const queue = []
  for (const raw of roots || []) {
    const p = Number.parseInt(raw, 10)
    if (p > 0 && !seen.has(p)) { seen.add(p); out.push(p); queue.push(p) }
  }
  while (queue.length) {
    const cur = queue.shift()
    for (const child of children.get(cur) || []) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/**
 * 从监听表逐行原料里挑出"树里那些 pid 在听的"（纯函数）。
 *
 * <p>只按 <b>pid</b> 归属：pid 未知（`netstat` 那种没有 pid 列的表）的行<b>不算进来</b> ——
 * 把它们并进任何一棵树都是编出来的归属。挑不到就如实回空，由调用方按 `state` 说"这一格今天不知道"。</p>
 * @param {Array<{pid:number, port:number, address:string, channel:string}>} rows
 * @param {number[]} tree
 * @returns {Array<{pid:number, port:number, address:string, channel:string}>}
 */
export function listenersOfTree(rows, tree) {
  const allow = new Set((tree || []).map((x) => Number.parseInt(x, 10)))
  const out = []
  for (const row of rows || []) {
    // pid 未知（缺少 pid 列的 netstat 那种，pid=0）一律不算 —— 把它并进任何一棵树都是编出来的归属。
    if (!row || !row.pid || row.pid <= 0 || !allow.has(row.pid)) continue
    out.push({ pid: row.pid, port: row.port, address: row.address || '', channel: row.channel || '' })
  }
  return out
}

/**
 * 这份原料<b>覆盖不覆盖得住</b>"本机此刻在听的那些 pid"（纯函数，[返工R3·枚54 / #183]）。
 *
 * <p>#183 实测到的那一档（`scripts/dogfood/proc-listen-broken-chain-probe.mjs`）：
 * 包装层（`cmd /d /s /c node …`）被 taskkill 之后，<b>孙进程还在听</b>，而它的
 * `ParentProcessId` 已经是一个<b>不在进程表里的号</b> —— Windows 不重新收养子进程，
 * `descendFromRoots` 的 children 表只由活着的行构成，那个死掉的中间层进不了队列，
 * 它的孩子就顺不到。于是 `listeners` 为空、`state` 仍是 `ok`（两份枚举确实都成功了），
 * 服务端据此交付「停完之后实测没有监听的口」—— 恰好在这条腿<b>根本没停干净</b>的时候说。</p>
 *
 * <p>这一格只数三件事，全是从已有原料直读的结构事实：树外还在听的条数、其中父进程已不在表里的条数
 * （断链）、以及根本没有 pid 可归的行数（`netstat` 那种表）。<b>不筛端口、不猜归属</b> ——
 * "哪个口是这条腿对外服务的口"是判断，归读文本的那一方。</p>
 *
 * @param {Array<{pid:number}>} listenRows 整张监听表（未筛树）
 * @param {number[]} tree 这条腿顺出来的进程树
 * @param {Map<number, number>} ppidOf 活着的 PID→PPID 表
 * @returns {{off_tree_listening:number, off_tree_broken_chain:number, pid_unknown:number}}
 */
export function coverageOfTree(listenRows, tree, ppidOf) {
  const allow = new Set((tree || []).map((x) => Number.parseInt(x, 10)))
  let off = 0
  let broken = 0
  let unknown = 0
  for (const row of listenRows || []) {
    const pid = Number.parseInt(row && row.pid, 10)
    if (!(pid > 0)) { unknown++; continue }
    if (allow.has(pid)) continue
    off++
    const ppid = ppidOf && ppidOf.get(pid)
    // ppid<=4 是 System/System Idle 那一类根，本就该在表外；除此以外父不在这张表里 = 断链。
    if (ppid === undefined || (ppid > 4 && !(ppidOf && ppidOf.has(ppid)))) broken++
  }
  return { off_tree_listening: off, off_tree_broken_chain: broken, pid_unknown: unknown }
}

/** 收一条只读命令的 stdout+stderr（失败 → 空串，绝不抛）。超时 code=-2、spawn 失败 -1。 */
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

/**
 * 枚举一次「PID + 父 PID」表；打不到 → code 非 0 且 err 带成因。
 *
 * <p>[C·2026-10-31] 公开导出：sweep 的归属判据要把"本会话登记的 pid 树"展开一次
 * （`sweepOwnership.js` 的 `tree` 证据），与这里同一份枚举。</p>
 */
export async function listPpidTable() {
  if (platform() === 'win32') {
    const r = await runCapture('powershell', ['-NoProfile', '-NonInteractive', '-Command', WIN_TREE])
    return { ppidOf: parsePpidTable(r.out), via: 'cim', code: r.code, err: r.err.trim() }
  }
  const r = await runCapture('ps', ['-eo', 'pid=,ppid='])
  return { ppidOf: parsePpidTable(r.out), via: 'ps', code: r.code, err: r.err.trim() }
}

/**
 * 收集「任务 → 根 pid → 子进程树 → 树里在听的口」这一份只读事实。
 *
 * <p>输出（服务端只当原料写账，不做任何解读）：</p>
 * <pre>
 * { task_id, roots:[pid…], tree:[pid…],
 *   listeners:[{pid, port, address, channel}…],
 *   via, enumerated, state, error, observed_at_ms }
 * </pre>
 *
 * <p>`state` 三态（与端口真探同一条纪律：绝不许把"没取到"折成"没有"）：</p>
 * <ul>
 *   <li>{@code ok}    <b>两份</b>事实都取到了（监听表 + 进程树）—— 那时 `listeners` 为空才是真事实；</li>
 *   <li>{@code unknown} 监听表<b>或</b>进程树没取到 —— 这一格今天不知道；</li>
 *   <li>{@code no-root} 拿不到根 pid（task_id 不在登记簿里、或它没有活着的子进程句柄）。</li>
 * </ul>
 *
 * <p>进程树那一半为什么也算缺事实（[F72·枚41 #161]）：npm 包一层 node 时端口挂在<b>子进程</b>上，
 * 只有树枚举成功才认得出那棵树的成员。旧写法只看监听表 —— 树没拿到就只按根 pid 筛，
 * 于是这份事实必然是空的，而 `state` 还写着 {@code ok}，服务端据此交付
 * 「停完之后实测没有监听的口」：那正是 §0.④ 那条谎换了个措辞回来。</p>
 *
 * @param {{taskId?: string, rootPid?: number|string}} opts
 * @param {{listProcessTable?: Function, listListeners?: Function, getTask?: Function}} [deps]
 *        只给用例注入真值用的缝（默认走本机枚举，产品路径不传）
 * @returns {Promise<object>}
 */
export async function collectProcListen(opts = {}, deps = {}) {
  const listTable = deps.listProcessTable || listPpidTable
  const listListen = deps.listListeners || listListeners
  const lookupTask = deps.getTask || getTask
  const taskId = String(opts.taskId || '').trim()
  const observedAtMs = Date.now()
  const roots = []
  const notes = []
  const rootPid = Number.parseInt(opts.rootPid, 10)
  if (rootPid > 0) roots.push(rootPid)
  if (taskId) {
    const t = lookupTask(taskId)
    if (!t) {
      notes.push('task_id 不在端侧登记簿里（已终态并过了保留期，或本机不是起它的那台）')
    } else {
      const pid = t._child && typeof t._child.pid === 'number' ? t._child.pid : 0
      if (pid > 0) roots.push(pid)
      else notes.push('登记簿里这条任务没有活着的子进程句柄（起它的 shell 已退出）')
    }
  }
  const dedup = [...new Set(roots.filter((p) => p > 0))]
  if (dedup.length === 0) {
    return { task_id: taskId, roots: [], tree: [], listeners: [],
      via: '', enumerated: 0, state: 'no-root',
      error: notes.join(' | ') || '没拿到根 pid（这条指令要 task_id 或 pid）',
      observed_at_ms: observedAtMs }
  }

  const treeInfo = await listTable()
  const treeFailed = !(treeInfo && treeInfo.code === 0 && treeInfo.ppidOf && treeInfo.ppidOf.size > 0)
  let tree = dedup
  if (!treeFailed) tree = descendFromRoots(dedup, treeInfo.ppidOf)
  else notes.push(((treeInfo && treeInfo.err) || '进程树枚举没给出可判的结果')
    + ' —— 只认得到根 pid，认不出它的子进程（端口常常正挂在子进程上）')

  const listen = await listListen()
  const listenersEnumFailed = !listen.raw && listen.err
  if (listenersEnumFailed) notes.push('监听表枚举失败: ' + listen.err)
  // 两份事实任缺一格都不算"取到了" —— 缺事实只能写"今天不知道"，不许折成"没有监听的口"
  const state = listenersEnumFailed || treeFailed ? 'unknown' : 'ok'
  // [枚54 / #183] 覆盖性那一格：树枚举没成功时它是"没算出来"，写 -1 而不是 0 ——
  //   0 会被服务端读成"树外没有别的口"，那正是这一枚要治的那类折法。
  const coverage = treeFailed
    ? { off_tree_listening: -1, off_tree_broken_chain: -1, pid_unknown: -1 }
    : coverageOfTree(listen.rows, tree, treeInfo.ppidOf)
  return { task_id: taskId, roots: dedup, tree,
    listeners: listenersEnumFailed ? [] : listenersOfTree(listen.rows, tree),
    via: listen.via, enumerated: (listen.rows || []).length, state,
    ...coverage,
    error: notes.filter(Boolean).join(' | '), observed_at_ms: observedAtMs }
}
