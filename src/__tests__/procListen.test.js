// [F72·枚35] proc_listen 的纯函数：把「PID+父 PID」表读成进程树、把监听表逐行原料按 pid 归到树里。
// 只钉纯函数 —— 真枚举那一步在 sidecar 里由 powershell/ss/netstat 完成（与 portProbe.test.js 同一口径）。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parsePpidTable, descendFromRoots, listenersOfTree, collectProcListen } from '../runtime/procListen.js'
import { parseListenRows } from '../runtime/portProbe.js'

describe('parsePpidTable：两种分隔（Windows TAB / POSIX 空白）都收，认不出的行跳过', () => {
  test('Windows PID<TAB>PPID 与 POSIX 空白分隔同解', () => {
    const win = parsePpidTable('100\t1\n200\t100\n300\t200\n')
    assert.equal(win.get(100), 1)
    assert.equal(win.get(200), 100)
    assert.equal(win.get(300), 200)
    const posix = parsePpidTable('  100  1\n  200  100\n')
    assert.equal(posix.get(100), 1)
    assert.equal(posix.get(200), 100)
  })
  test('垃圾行 / 空 / 单列不算数（漏一条比编一条好）', () => {
    assert.equal(parsePpidTable('').size, 0)
    assert.equal(parsePpidTable('abc\t1\n1\n\n').size, 0)
    assert.equal(parsePpidTable('100\t').size, 0)
  })
})

describe('descendFromRoots：从根 pid 顺出整棵子进程树', () => {
  test('npm → node 那一层要被顺进来（§0.④ 就是这一层让端口格为空）', () => {
    //   100(npm) → 200(node) → 300(worker)
    const ppidOf = parsePpidTable('100\t1\n200\t100\n300\t200\n400\t1\n')
    assert.deepEqual(descendFromRoots([100], ppidOf), [100, 200, 300])
    //   根之外的 400（ppid=1）不属于这棵树
    assert.equal(descendFromRoots([100], ppidOf).includes(400), false)
  })
  test('多根各顺各的，交集去重', () => {
    const ppidOf = parsePpidTable('10\t1\n20\t1\n30\t10\n')
    assert.deepEqual(descendFromRoots([10, 20], ppidOf), [10, 20, 30])
    assert.deepEqual(descendFromRoots([10, 10], ppidOf), [10, 30])
  })
  test('根非法 / 空表 → 只回合法根（绝不凭空造 pid）', () => {
    assert.deepEqual(descendFromRoots([0, 'x', null], parsePpidTable('1\t0\n')), [])
    assert.deepEqual(descendFromRoots([5], new Map()), [5])
  })
  test('环形父子（自引用/互引用）不死循环', () => {
    const ppidOf = parsePpidTable('7\t7\n8\t9\n9\t8\n')
    assert.deepEqual(descendFromRoots([7], ppidOf), [7])
    assert.deepEqual(descendFromRoots([8], ppidOf), [8, 9])
  })
})

describe('listenersOfTree：按 pid 归属，pid 未知的行不编进任何一棵树', () => {
  test('只取树里那些 pid 的监听行（带 address 与 channel 出处）', () => {
    const rows = parseListenRows('9527\t200\t0.0.0.0\n8081\t999\t127.0.0.1\n3000\t300\t::\n', 'nettcp')
    const got = listenersOfTree(rows, [100, 200, 300])
    assert.deepEqual(got, [
      { pid: 200, port: 9527, address: '0.0.0.0', channel: 'nettcp' },
      { pid: 300, port: 3000, address: '::', channel: 'nettcp' },
    ])
  })
  test('pid 为 0 的表（netstat 没有 pid 列）不并进任何树 —— 那是编出来的归属', () => {
    const rows = parseListenRows('tcp4 0 0 *.9527 *.* LISTEN\n', 'netstat')
    assert.equal(rows[0].pid, 0)
    assert.deepEqual(listenersOfTree(rows, [0, 1, 2]), [])
  })
  test('挑不到就如实回空（不是"没有"，由调用方按 state 说）', () => {
    assert.deepEqual(listenersOfTree([], [100]), [])
    assert.deepEqual(listenersOfTree(parseListenRows('8081\t5\tx\n', 'nettcp'), []), [])
  })
})

describe('collectProcListen：两份事实任缺一格都不算 ok（[F72·枚41 #161]）', () => {
  const rootTask = { _child: { pid: 100 } }
  const deps = (treeInfo, listenInfo, task = rootTask) => ({
    getTask: () => task,
    listProcessTable: async () => treeInfo,
    listListeners: async () => listenInfo,
  })
  const okTree = { code: 0, ppidOf: parsePpidTable('100\t1\n200\t100\n'), err: '' }
  const okListen = (rows, raw = 'x') => ({ rows, raw, via: 'nettcp', code: 0, err: '' })

  test('树枚举失败 → state=unknown，不许把「没顺到子进程」折成「没有监听的口」', async () => {
    const rows = parseListenRows('9527\t200\t0.0.0.0\n', 'nettcp')
    const got = await collectProcListen({ taskId: 't-1' },
      deps({ code: 1, ppidOf: new Map(), err: 'powershell 超时' }, okListen(rows)))
    assert.equal(got.state, 'unknown')
    assert.deepEqual(got.listeners, [])
    // 失败原因逐字带出去：服务端只在 state!=ok 时才读 error
    assert.ok(got.error.includes('powershell 超时'))
    assert.ok(got.error.includes('只认得到根 pid'), '要说清缺的是哪一份事实')
  })

  test('监听表枚举失败 → 同样 unknown', async () => {
    const got = await collectProcListen({ taskId: 't-1' },
      deps(okTree, { rows: [], raw: '', via: '', code: 1, err: 'netstat 拒绝访问' }))
    assert.equal(got.state, 'unknown')
    assert.ok(got.error.includes('监听表枚举失败'))
  })

  test('两份都取到 → ok；树里真没有监听行时 listeners 为空才是事实', async () => {
    const got = await collectProcListen({ taskId: 't-1' }, deps(okTree, okListen([])))
    assert.equal(got.state, 'ok')
    assert.deepEqual(got.tree, [100, 200])
    assert.deepEqual(got.listeners, [])
  })

  test('npm → node 那一层：树成功时端口归到这棵树上（枚35 存在的理由）', async () => {
    const rows = parseListenRows('9527\t200\t0.0.0.0\n8081\t777\t0.0.0.0\n', 'nettcp')
    const got = await collectProcListen({ taskId: 't-1' }, deps(okTree, okListen(rows)))
    assert.equal(got.state, 'ok')
    assert.deepEqual(got.listeners, [{ pid: 200, port: 9527, address: '0.0.0.0', channel: 'nettcp' }])
  })

  test('拿不到根 pid → no-root（与「取到了但为空」是两种下场）', async () => {
    const got = await collectProcListen({ taskId: 't-x' }, deps(okTree, okListen([]), null))
    assert.equal(got.state, 'no-root')
    assert.ok(got.error.includes('不在端侧登记簿里'))
  })
})
