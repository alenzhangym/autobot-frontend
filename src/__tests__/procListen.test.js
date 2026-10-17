// [F72·枚35] proc_listen 的纯函数：把「PID+父 PID」表读成进程树、把监听表逐行原料按 pid 归到树里。
// 只钉纯函数 —— 真枚举那一步在 sidecar 里由 powershell/ss/netstat 完成（与 portProbe.test.js 同一口径）。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parsePpidTable, descendFromRoots, listenersOfTree } from '../runtime/procListen.js'
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
