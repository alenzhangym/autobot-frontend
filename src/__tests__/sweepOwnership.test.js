/**
 * [C·2026-10-31 归属判据] `proc_sweep` 的三级证据（tree / port / path 里的前两级）。
 *
 * <p>这里只钉纯函数：给定"同一份快照"上的进程表、登记任务表、PID→PPID 表、监听表与端口账，
 * 算出哪些 pid 有强证据属于这个工作区。真枚举/真杀都在 sidecar 里，不在这里碰。</p>
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { attributeOwnedPids, commandLineMentionsTask } from '../runtime/sweepOwnership.js'

/** 造一条 taskRegistry 风格的登记条目。 */
function task(pid, cwd, command) {
  return { _child: { pid }, cwd, command }
}

describe('sweepOwnership: commandLineMentionsTask（pid 复用守卫）', () => {
  test('命令行里有那条任务的命令 → 认得出', () => {
    const line = 'bash.exe -c "cd E:\\code\\autobot && npm run dev"'
    assert.equal(commandLineMentionsTask(line, 'npm run dev'), true)
  })

  test('命令行里没有那条命令（号被复用）→ 认不出', () => {
    assert.equal(commandLineMentionsTask('powershell.exe -NoProfile -Command Get-CimInstance', 'npm run dev'), false)
  })

  test('空命令 / 空命令行 → 认不出（宁可不认）', () => {
    assert.equal(commandLineMentionsTask('node server.js', ''), false)
    assert.equal(commandLineMentionsTask('', 'node server.js'), false)
    assert.equal(commandLineMentionsTask(null, undefined), false)
  })

  test('包装层改写引号（整串对不上）→ 退一步认前 3 个 token', () => {
    const line = 'bash.exe -c npm run dev -- --host 127.0.0.1'
    assert.equal(commandLineMentionsTask(line, 'npm run dev -- --host "127.0.0.1"'), true)
  })

  test('[真机形状] Git Bash 把内层引号转义成 \\" → 仍认得出（否则 tree 证据整级失效）', () => {
    const line = String.raw`"C:\Program Files\Git\bin\bash.exe" -c "node -e \"setInterval(()=>{},1e3)\""`
    assert.equal(commandLineMentionsTask(line, 'node -e "setInterval(()=>{},1e3)"'), true)
  })
})

describe('sweepOwnership: attributeOwnedPids · tree 证据', () => {
  test('登记根 + 后代整棵子树 → 全是 tree', () => {
    const tasks = [task(700, 'E:\\code\\autobot', 'npm run dev')]
    const procs = [
      { pid: 700, commandLine: 'bash.exe -c "npm run dev"' },
      { pid: 701, commandLine: 'node E:\\code\\autobot\\node_modules\\vite\\bin\\vite.js' },
    ]
    const ppidOf = new Map([[701, 700], [702, 701]])
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks, procs, ppidOf })
    assert.deepEqual(r.roots, [700])
    assert.deepEqual(r.tree, [700, 701, 702])
    assert.deepEqual([...r.evidence.keys()], [700, 701, 702])
    for (const pid of [700, 701, 702]) assert.equal(r.evidence.get(pid), 'tree')
    assert.equal(r.diag.roots, 1)
    assert.equal(r.diag.tree, 3)
  })

  test('根 pid 已从进程表消失（断链）→ 仍按树认，后代照样收', () => {
    // Windows 不重新收养：包装层退出后，子进程的 PPID 仍指向那个空号（procListen #183）。
    const tasks = [task(700, 'E:\\code\\autobot', 'mvn spring-boot:run')]
    const procs = [{ pid: 703, commandLine: 'java -jar admin.jar' }]
    const ppidOf = new Map([[703, 701], [701, 700]])
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks, procs, ppidOf })
    assert.deepEqual(r.tree, [700, 701, 703])
    assert.equal(r.evidence.get(703), 'tree')
    assert.equal(r.notes.length, 0)
  })

  test('pid 复用守卫：号还在但命令行不像那条任务 → 不按树认，并留一条说明', () => {
    const tasks = [task(700, 'E:\\code\\autobot', 'npm run dev')]
    const procs = [{ pid: 700, commandLine: 'node C:\\other\\app.js' }]
    const ppidOf = new Map([[701, 700]])
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks, procs, ppidOf })
    assert.deepEqual(r.roots, [])
    assert.deepEqual(r.tree, [])
    assert.equal(r.evidence.size, 0)
    assert.equal(r.notes.length, 1)
    assert.match(r.notes[0], /700/)
    assert.match(r.notes[0], /复用/)
  })

  test('cwd 范围闸：别的项目 / 没记 cwd 的登记任务都进不来', () => {
    const tasks = [
      task(700, 'E:\\code\\autobot-fork', 'npm run dev'),
      task(701, '', 'npm run dev'),
      task(702, 'E:\\code\\autobot', 'npm run dev'),
    ]
    const procs = [{ pid: 702, commandLine: 'bash.exe -c "npm run dev"' }]
    const ppidOf = new Map()
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks, procs, ppidOf })
    assert.deepEqual(r.roots, [702])
    assert.deepEqual(r.tree, [702])
    assert.equal(r.diag.skipped_foreign_tasks, 1)
    assert.equal(r.diag.skipped_no_cwd, 1)
  })

  test('子目录里登记的任务算这次 sweep 的（isUnderPath，不是子串）', () => {
    const tasks = [task(700, 'E:\\code\\autobot\\autobot-frontend', 'node server.js')]
    const procs = [{ pid: 700, commandLine: 'node server.js' }]
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks, procs, ppidOf: new Map() })
    assert.deepEqual(r.roots, [700])
  })

  test('[真机形状] taskRegistry.list() 的快照（_child 被摘掉、pid 单列）也认得出根', () => {
    // server.js 传进来的就是 list() 的结果；只认 _child.pid 的话树这一级在真机上永远为空。
    const tasks = [{ id: 't1', pid: 700, cwd: 'E:\\code\\autobot', command: 'npm run dev', status: 'running' }]
    const procs = [{ pid: 700, commandLine: 'bash.exe -c "npm run dev"' }]
    const ppidOf = new Map([[701, 700]])
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks, procs, ppidOf })
    assert.deepEqual(r.tree, [700, 701])
    assert.equal(r.evidence.get(701), 'tree')
  })

  test('没有登记任务 → 树这一级为空（不猜）', () => {
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks: [], procs: [], ppidOf: new Map() })
    assert.equal(r.evidence.size, 0)
    assert.equal(r.diag.roots, 0)
    assert.equal(r.diag.tree, 0)
  })
})

describe('sweepOwnership: attributeOwnedPids · port 证据', () => {
  test('监听本会话为这个工作区观测过的口 → port', () => {
    const listenRows = [
      { pid: 800, port: 3000, address: '127.0.0.1' },
      { pid: 801, port: 9999, address: '127.0.0.1' },
    ]
    const r = attributeOwnedPids({
      cwd: 'E:\\code\\autobot', tasks: [], procs: [], ppidOf: new Map(),
      listenRows, knownPorts: [3000],
    })
    assert.equal(r.evidence.get(800), 'port')
    assert.equal(r.evidence.has(801), false)
    assert.equal(r.diag.port_pids, 1)
    assert.equal(r.diag.known_ports, 1)
  })

  test('没有端口账 → 这一级今天给不出归属，绝不按监听表乱认', () => {
    const listenRows = [{ pid: 800, port: 3000 }]
    const r = attributeOwnedPids({
      cwd: 'E:\\code\\autobot', tasks: [], procs: [], ppidOf: new Map(), listenRows,
    })
    assert.equal(r.evidence.size, 0)
    assert.equal(r.diag.port_pids, 0)
    assert.equal(r.diag.known_ports, 0)
  })

  test('非法端口号被丢掉（0 / 负数 / 超范围 / 非整数）', () => {
    const r = attributeOwnedPids({
      cwd: 'E:\\code\\autobot', tasks: [], procs: [], ppidOf: new Map(),
      knownPorts: [0, -1, 70000, 3.5, 'abc', 3000],
    })
    assert.equal(r.diag.known_ports, 1)
  })

  test('tree 优先于 port：同一 pid 两级都命中时带 tree', () => {
    const tasks = [task(700, 'E:\\code\\autobot', 'npm run dev')]
    const procs = [{ pid: 700, commandLine: 'bash.exe -c "npm run dev"' }]
    const listenRows = [{ pid: 700, port: 3000 }]
    const r = attributeOwnedPids({
      cwd: 'E:\\code\\autobot', tasks, procs, ppidOf: new Map(),
      listenRows, knownPorts: [3000],
    })
    assert.equal(r.evidence.get(700), 'tree')
    assert.equal(r.diag.port_pids, 0)
  })

  test('pid 未知（pid=0）的监听行不算进任何归属', () => {
    const r = attributeOwnedPids({
      cwd: 'E:\\code\\autobot', tasks: [], procs: [], ppidOf: new Map(),
      listenRows: [{ pid: 0, port: 3000 }, { port: 3000 }], knownPorts: [3000],
    })
    assert.equal(r.evidence.size, 0)
    assert.equal(r.diag.port_pids, 0)
  })
})

describe('sweepOwnership: attributeOwnedPids · 输入边界', () => {
  test('空输入 → 空证据，不抛', () => {
    const r = attributeOwnedPids()
    assert.equal(r.evidence.size, 0)
    assert.deepEqual(r.roots, [])
    assert.deepEqual(r.tree, [])
    assert.deepEqual(r.notes, [])
  })

  test('登记条目的 pid 不是正整数 → 跳过', () => {
    const tasks = [{ _child: { pid: 0 } }, { _child: {} }, { cwd: 'E:\\code\\autobot' }, null]
    const r = attributeOwnedPids({ cwd: 'E:\\code\\autobot', tasks, procs: [], ppidOf: new Map() })
    assert.deepEqual(r.roots, [])
    assert.equal(r.diag.skipped_no_cwd, 0)
  })
})
