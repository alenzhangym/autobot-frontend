// [F72·枚26/枚23 合流] 端口真探：读**现有监听表**回答"这个端口现在有没有进程在听"。
//
// 为什么要有这一格（真机 2026-10-13 23:01 与 2026-10-14 12:55 两轮）：
//   运行腿的 PASS 是 `ready = running && (looksReady || 端口非空)`，而 `looksReady` 的词表里
//   `started .*in ` 会命中 Spring Boot 的**启动横幅**那句 `(... started **by** alenz **in** E:\code\...)`
//   —— 于是 stdout 里根本没有真就绪行时也能给 PASS；而 litemall 把 `logging.level.root: ERROR`，
//   `Tomcat started on port(s): 8081` 那条 INFO 被压掉，"从输出认端口"这条路在这个项目上先天不通。
//   停止腿同族：`proc_sweep` 只回一个 `killed` 布尔，"前端到底还在不在跑"这一格从没被检测过。
//   两半缺的是同一格事实：**端口有没有人听**。这一格是可测的结构事实，不该由输出词表去猜。
//
// 与 `monitor/RestartService.js` 的 `waitForPortFree` 的区别是刻意的：那一条是**绑定试探**
// （自己 listen 一下，会短暂占口、且只回答"我能不能占"），这一条是**读表**（只读、不占口，
// 回答"谁在听"）。拿绑定试探去问"服务起来了没有"会把服务自己的口抢一下，绝不用于此。
import { platform } from 'node:os'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'

// [第3条·2026-10-31] 本机那张监听表**本身是坏的**（8000/3000 的监听行状态列是无效值，被
//   `-State Listen` 整批滤掉；netstat 读同一份表也缺行）—— 于是只读表会回 `free` 这个假事实。
//   表缺席时用 `verifyPortByConnect` 的**不占口**连接核验复核（真机证据写在该函数注释里）；
//   表命中仍以表为准（它带 pid/地址出处，连接核验给不出）。

/** Windows：逐行 `LocalPort<TAB>OwningProcess<TAB>LocalAddress`（真 TAB，避免 CSV 引号转义）。
 *  第三列（本地地址）是 [F72·枚35] 加的：`proc_listen` 要把"谁在听、听在哪张网卡上"逐字带出处；
 *  只探端口的 `probePortListening` 读前两列，不受这一列影响（多一列不改它的行为）。 */
const WIN_LISTEN = 'Get-NetTCPConnection -State Listen | '
  + 'ForEach-Object { "$($_.LocalPort)\t$($_.OwningProcess)\t$($_.LocalAddress)" }'

/**
 * 把输入收成合法端口号；非法一律 null（判不了就不探，绝不拿一个猜出来的端口去问盘）。
 * @param {unknown} raw
 * @returns {number|null}
 */
export function normalizePort(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!/^\d{1,5}$/.test(s)) return null
  const n = Number.parseInt(s, 10)
  return n >= 1 && n <= 65535 ? n : null
}

/** 从 `0.0.0.0:8081` / `[::]:8081` / `*:8081` / `*.8081` 这类本地地址列里取尾部端口号（取不到 → null）。 */
function portOfAddress(token) {
  const m = String(token || '').trim().match(/[:.](\d{1,5})$/)
  return m ? normalizePort(m[1]) : null
}

/** 一列里第一个"像本地地址"的 token（以 `:端口` 或 `.端口` 收尾）。 */
function localAddressToken(cols) {
  return cols.find((c) => /[:.]\d{1,5}$/.test(c)) || ''
}

/**
 * 解析三种通道的监听表输出为逐行<b>原料</b>（纯函数，可单测）：
 * `{pid, port, address, channel}`，`channel` 是枚举通道名（`nettcp`/`ss`/`netstat`），逐字带出处。
 *
 * <p>[F72·枚35] 为什么要有这一层：`proc_listen` 要答的是"某个 task 的进程树在听哪些口"，
 * 那一格必须逐字带上"这个口是谁在听（pid）、听在哪（address）、从哪张表读到的（channel）"——
 * 服务端只当原料写进账，不解读、不筛端口、不猜服务口（§1 立场）。</p>
 *
 * 认不出的行跳过而不猜：漏一条比编一条好，而"整表为空"由调用方按 `enumerated=0` 如实上报。
 * @param {string} text
 * @param {'nettcp'|'ss'|'netstat'} via
 * @returns {Array<{pid:number, port:number, address:string, channel:string}>}
 */
export function parseListenRows(text, via) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw) continue
    if (via === 'nettcp') {
      const cols = raw.split('\t')
      const port = normalizePort(cols[0])
      if (!port) continue
      out.push({ pid: Number.parseInt(cols[1] || '0', 10) || 0, port,
        address: String(cols[2] || '').trim(), channel: 'nettcp' })
      continue
    }
    const cols = raw.split(/\s+/)
    if (via === 'ss') {
      // LISTEN 0 4096 0.0.0.0:8081 0.0.0.0:* users:(("node",pid=2460,fd=18))
      const address = localAddressToken(cols)
      const port = portOfAddress(address)
      if (!port) continue
      const m = raw.match(/pid=(\d+)/)
      out.push({ pid: m ? Number.parseInt(m[1], 10) : 0, port, address, channel: 'ss' })
      continue
    }
    // netstat（Linux `tcp 0 0 0.0.0.0:8081 ...` / macOS `tcp4 0 0 *.8081 ...`）：没有 pid 列就不编
    if (!/listen/i.test(raw)) continue
    const address = localAddressToken(cols)
    const port = portOfAddress(address)
    if (!port) continue
    out.push({ pid: 0, port, address, channel: 'netstat' })
  }
  return out
}

/**
 * 解析三种通道的监听表输出为 `端口 → [pid]`（纯函数，可单测）：
 *  - `nettcp`（Windows CIM）：`8081\t2460`
 *  - `ss`：`LISTEN 0 100 0.0.0.0:8081 0.0.0.0:* users:(("node",pid=2460,fd=18))`
 *  - `netstat`：`tcp4 0 0 *.8081 *.* LISTEN`（无 pid 列）
 * 这一格只回答"这个端口有没有人听"（谁在听由 `parseListenRows` 的 pid 那一格答）。
 * @param {string} text
 * @param {'nettcp'|'ss'|'netstat'} via
 * @returns {Map<number, number[]>}
 */
export function parseListenTable(text, via) {
  const out = new Map()
  for (const row of parseListenRows(text, via)) {
    const pids = out.get(row.port) || []
    if (row.pid && !pids.includes(row.pid)) pids.push(row.pid)
    out.set(row.port, pids)
  }
  return out
}

/**
 * 收一条只读命令的 stdout+stderr（失败 → 空串，绝不抛）。超时 code=-2、spawn 失败 -1。
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} [timeoutMs]
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

/** 把一次枚举的原始输出收成同一种形状（`table` 给端口真探用，`rows` 给 `proc_listen` 用）。 */
function shapeListen(r, via, err) {
  return { table: parseListenTable(r.out, via), rows: parseListenRows(r.out, via),
    via, code: r.code, err: (err == null ? r.err : err).trim(), raw: r.out }
}

/** 连接核验的超时：回环上 open/refused 都在毫秒级，超时只防"卡住"，不参与判定。 */
const CONNECT_TIMEOUT_MS = 700

/** 一次只读连接：`connect` 成功 = open，`ECONNREFUSED` = refused，其余（超时/不可达）= unknown。 */
function connectOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* 已经关了就不管 */ }
      resolve(r)
    }
    let socket
    try {
      socket = connect({ host, port })
    } catch (e) {
      resolve({ state: 'unknown', error: `${String((e && e.message) || e)}（${host}:${port}）` })
      return
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ state: 'open' }))
    socket.once('timeout', () => finish({ state: 'unknown', error: `连接核验超时（${host}:${port}）` }))
    socket.once('error', (e) => {
      const code = String((e && e.code) || '')
      if (code === 'ECONNREFUSED') {
        finish({ state: 'refused' })
      } else {
        finish({ state: 'unknown', error: `${code || String((e && e.message) || e) || '连接失败'}（${host}:${port}）` })
      }
    })
  })
}

/**
 * [第3条·2026-10-31] 不占口的 TCP 连接核验 —— 监听表缺格时的**第二份结构事实**。
 *
 * <p>与 `monitor/RestartService.js` 的绑定试探**不是一回事**：绑定会真的占住那个口（甚至把服务
 * 自己的口抢一下），而这一格只问"此刻有没有人接受连接"，<b>不 bind、不发一个字节、连上就断</b>。
 * 在 TCP 语义上，"有人接受连接"与"端口有人在听"是同一件事的结构事实，而且它<b>不依赖那张表</b>。</p>
 *
 * <p>真机证据（2026-10-31）：本机 `Get-NetTCPConnection -State Listen` 只回 11 条临时端口，
 * 8000 的监听行 `LocalAddress=::` 的 State 列是<b>无效值 0</b>（PowerShell 转枚举直接抛），被过滤整批滤掉；
 * `netstat` 读同一份表也缺 8000/3000 的 LISTENING 行，而 8000 确在服务。
 * 于是 `port-probe {"port":8000}` 回了 `{state:"free", enumerated:11}` —— 一个假事实，
 * 运行腿验收因此恒 UNVERIFIED。坏掉的是枚举通道，不是被探的口：这一格是修那件事的。</p>
 *
 * <p>两族地址都试：先 `127.0.0.1`，再 `::1`（v6-only 的监听者）。v4 被拒且 v6 也没开 → refused；
 * v6 不可用（EADDRNOTAVAIL 等）不算定论，v4 的 refused 仍然成立。</p>
 *
 * @param {unknown} port
 * @param {number} [timeoutMs]
 * @returns {Promise<{state:'open'|'refused'|'unknown', how:string, error:string}>}
 */
export async function verifyPortByConnect(port, timeoutMs = CONNECT_TIMEOUT_MS) {
  const want = normalizePort(port)
  if (!want) {
    return { state: 'unknown', how: '', error: '端口不是可探的形状（要 1~65535 的整数）' }
  }
  const v4 = await connectOnce('127.0.0.1', want, timeoutMs)
  if (v4.state === 'open') return { state: 'open', how: 'connect', error: '' }
  const v6 = await connectOnce('::1', want, timeoutMs)
  if (v6.state === 'open') return { state: 'open', how: 'connect6', error: '' }
  if (v4.state === 'refused') return { state: 'refused', how: 'connect', error: v6.error || '' }
  return { state: 'unknown', how: 'connect', error: [v4.error, v6.error].filter(Boolean).join(' | ') }
}

/** 枚举一次监听表；三条通道都失败时把逐条诊断带回去（`state:'unknown'` 的成因不许丢）。 */
export async function listListeners() {
  if (platform() === 'win32') {
    const r = await runCapture('powershell',
      ['-NoProfile', '-NonInteractive', '-Command', WIN_LISTEN])
    return shapeListen(r, 'nettcp')
  }
  const ss = await runCapture('ss', ['-ltnH'])
  if (ss.code === 0 && ss.out.trim()) return shapeListen(ss, 'ss', '')
  const ns = await runCapture('netstat', ['-an', '-p', 'tcp'])
  if (ns.code === 0 && ns.out.trim()) return shapeListen(ns, 'netstat', '')
  return { table: new Map(), rows: [], via: ss.code === 0 ? 'ss' : 'netstat',
    code: ns.code, err: [ss.err.trim(), ns.err.trim()].filter(Boolean).join(' | '), raw: '' }
}

/**
 * 探一个端口现在有没有人听。返回**三态**，绝不把"没探成"折成"没在听"：
 *  - `state:'listening'` 监听表里有它（带 pid），或表缺席但连接核验被接受（表是坏的时候靠这一格）
 *  - `state:'free'`      枚举成功、表里没有它、且连接核验被拒（两份事实都指向"没人听"）
 *  - `state:'unknown'`   枚举失败/超时/端口非法/表与连接核验都给不出定论 —— 这一格今天不知道
 *
 * <p>[第3条·2026-10-31] 为什么要连接核验：本机那张表可能整批缺监听行（真机证据见
 * {@link verifyPortByConnect}）。只读表会把"在服务"的 8000 读成 `free`。表命中仍以表为准；
 * 表缺席才动用不占口的连接核验，两份事实都指向"没人听"才许写 `free`。</p>
 *
 * @param {unknown} port
 * @returns {Promise<{state:string, port:number|null, pids:string, via:string,
 *   enumerated:number, error:string}>}
 */
export async function probePortListening(port) {
  const want = normalizePort(port)
  if (!want) {
    return { state: 'unknown', port: null, pids: '', via: '', enumerated: 0,
      error: '端口不是可探的形状（要 1~65535 的整数）' }
  }
  const r = await listListeners()
  const enumerated = r.table.size
  const pids = r.table.get(want)
  if (pids) return { state: 'listening', port: want, pids: pids.filter(Boolean).join(' '),
    via: r.via, enumerated, error: '' }

  const enumFailed = !r.raw && r.err
  // [第3条] 表缺席（或整张表都没枚举成）→ 用不占口的连接核验复核：坏的常常是枚举通道，不是被探的口
  const c = await verifyPortByConnect(want)
  if (c.state === 'open') {
    return { state: 'listening', port: want, pids: '',
      via: `${r.via || 'connect'}${c.how === 'connect6' ? '+connect6' : '+connect'}`, enumerated,
      error: enumFailed ? `监听表枚举失败（结论来自连接核验）: ${r.err}` : '' }
  }
  if (enumFailed) {
    return { state: 'unknown', port: want, pids: '', via: r.via, enumerated,
      error: `监听表枚举失败: ${r.err}` }
  }
  if (c.state === 'refused') {
    return { state: 'free', port: want, pids: '', via: `${r.via}+connect`, enumerated, error: '' }
  }
  return { state: 'unknown', port: want, pids: '', via: r.via, enumerated,
    error: `监听表里没有它、连接核验也没给出定论: ${c.error}` }
}
