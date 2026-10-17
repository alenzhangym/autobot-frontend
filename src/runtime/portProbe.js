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
 *  - `state:'listening'` 监听表里有它（带 pid）
 *  - `state:'free'`      枚举成功、表里没有它
 *  - `state:'unknown'`   枚举失败/超时/端口非法 —— 这一格今天不知道
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
  if (!r.raw && r.err) {
    return { state: 'unknown', port: want, pids: '', via: r.via, enumerated: 0,
      error: `监听表枚举失败: ${r.err}` }
  }
  const pids = r.table.get(want)
  if (pids) return { state: 'listening', port: want, pids: pids.filter(Boolean).join(' '),
    via: r.via, enumerated: r.table.size, error: '' }
  return { state: 'free', port: want, pids: '', via: r.via, enumerated: r.table.size, error: '' }
}
