/**
 * [C·2026-10-31 归属判据] `workspacePorts` —— sweep 二级证据「端口归属」的账本。
 *
 * <p>它只记<b>已实测</b>的读表结果（proc-scan / proc-listen），带 TTL；这里验证落账、归一化、
 * 子目录账合并、过期不认、非法端口丢弃、清理。</p>
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  recordWorkspacePorts, workspacePortsOf, clearWorkspacePorts,
  setWorkspacePortTtlForTests, WORKSPACE_PORT_TTL_MS,
} from '../runtime/workspacePorts.js'

beforeEach(() => {
  clearWorkspacePorts()
  setWorkspacePortTtlForTests(WORKSPACE_PORT_TTL_MS)
})

describe('workspacePorts: 落账与读取', () => {
  test('记一次 → 读得到（接受 {port} 行与裸数字两种原料）', () => {
    const t0 = 1_000_000
    const rec = recordWorkspacePorts('E:\\code\\autobot', [{ port: 3000 }, 5173], 'proc-scan', t0)
    assert.equal(rec.recorded, 2)
    assert.deepEqual(rec.ports, [3000, 5173])
    const got = workspacePortsOf('E:\\code\\autobot', t0)
    assert.deepEqual([...got.ports].sort((a, b) => a - b), [3000, 5173])
    assert.deepEqual(got.sources, ['proc-scan'])
  })

  test('cwd 归一化：反斜杠/大小写/尾部斜杠都指向同一本账', () => {
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan')
    const got = workspacePortsOf('e:/CODE/AUTOBOT/', Date.now())
    assert.deepEqual([...got.ports], [3000])
  })

  test('子目录的账并进父目录（proc-listen 按 task.cwd 落账，sweep 的 cwd 是工作区根）', () => {
    recordWorkspacePorts('E:\\code\\autobot\\autobot-frontend', [3000], 'proc-listen')
    recordWorkspacePorts('E:\\code\\autobot', [8080], 'proc-scan')
    const got = workspacePortsOf('E:\\code\\autobot', Date.now())
    assert.deepEqual([...got.ports].sort((a, b) => a - b), [3000, 8080])
    assert.deepEqual(got.sources.sort(), ['proc-listen', 'proc-scan'])
    assert.equal(got.cwds.length, 2)
  })

  test('前缀共享的**别的项目**的账不并进来（autobot-fork ≠ autobot）', () => {
    recordWorkspacePorts('E:\\code\\autobot-fork', [9999], 'proc-scan')
    const got = workspacePortsOf('E:\\code\\autobot', Date.now())
    assert.equal(got.ports.size, 0)
  })

  test('查子目录时看不到父目录的账（归属只往下认）', () => {
    recordWorkspacePorts('E:\\code\\autobot', [8080], 'proc-scan')
    const got = workspacePortsOf('E:\\code\\autobot\\autobot-frontend', Date.now())
    assert.equal(got.ports.size, 0)
  })

  test('同一个口被再次观测 → 刷新 last_ms（source 记为最近一次出处）', () => {
    const t0 = 1_000_000
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan', t0)
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-listen', t0 + 500)
    const got = workspacePortsOf('E:\\code\\autobot', t0 + 500)
    assert.deepEqual([...got.ports], [3000])
    assert.deepEqual(got.sources, ['proc-listen'])
  })
})

describe('workspacePorts: TTL 与非法输入', () => {
  test('超过 TTL 没再观测 → 不再当证据（并计入 expired）', () => {
    setWorkspacePortTtlForTests(1000)
    const t0 = 1_000_000
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan', t0)
    const fresh = workspacePortsOf('E:\\code\\autobot', t0 + 500)
    assert.deepEqual([...fresh.ports], [3000])
    assert.equal(fresh.expired, 0)
    const stale = workspacePortsOf('E:\\code\\autobot', t0 + 2000)
    assert.equal(stale.ports.size, 0)
    assert.equal(stale.expired, 1)
  })

  test('刷新过就重新计时（旧账不该因为第一次观测得早而被丢掉）', () => {
    setWorkspacePortTtlForTests(1000)
    const t0 = 1_000_000
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan', t0)
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan', t0 + 900)
    const got = workspacePortsOf('E:\\code\\autobot', t0 + 1400)
    assert.deepEqual([...got.ports], [3000])
  })

  test('非法端口号一律丢弃（0 / 负数 / 超范围 / 非整数 / 非数字）', () => {
    const rec = recordWorkspacePorts('E:\\code\\autobot', [0, -1, 70000, 3.5, 'abc', null, 22], 'proc-scan')
    assert.equal(rec.recorded, 1)
    assert.deepEqual(rec.ports, [22])
    const got = workspacePortsOf('E:\\code\\autobot', Date.now())
    assert.deepEqual([...got.ports], [22])
  })

  test('没有什么可记（空表 / 全非法）→ recorded=0，读数仍为空', () => {
    assert.equal(recordWorkspacePorts('E:\\code\\autobot', [], 'proc-scan').recorded, 0)
    assert.equal(workspacePortsOf('E:\\code\\autobot', Date.now()).ports.size, 0)
  })

  test('空 cwd → 读不到任何账（不猜）', () => {
    recordWorkspacePorts('', [3000], 'proc-scan')
    const got = workspacePortsOf('', Date.now())
    assert.equal(got.ports.size, 0)
  })

  test('setWorkspacePortTtlForTests 传 ≤0 / 非数字 → 恢复默认', () => {
    setWorkspacePortTtlForTests(0)
    const t0 = 1_000_000
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan', t0)
    assert.deepEqual([...workspacePortsOf('E:\\code\\autobot', t0 + 60_000).ports], [3000])
  })
})

describe('workspacePorts: 清理', () => {
  test('clearWorkspacePorts(cwd) 只清那一本', () => {
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan')
    recordWorkspacePorts('E:\\code\\autobot-fork', [9999], 'proc-scan')
    clearWorkspacePorts('e:/code/AUTOBOT/')
    assert.equal(workspacePortsOf('E:\\code\\autobot', Date.now()).ports.size, 0)
    assert.deepEqual([...workspacePortsOf('E:\\code\\autobot-fork', Date.now()).ports], [9999])
  })

  test('clearWorkspacePorts() 无参数 → 整本清空', () => {
    recordWorkspacePorts('E:\\code\\autobot', [3000], 'proc-scan')
    recordWorkspacePorts('E:\\code\\autobot-fork', [9999], 'proc-scan')
    clearWorkspacePorts()
    assert.equal(workspacePortsOf('E:\\code\\autobot', Date.now()).ports.size, 0)
    assert.equal(workspacePortsOf('E:\\code\\autobot-fork', Date.now()).ports.size, 0)
  })
})
