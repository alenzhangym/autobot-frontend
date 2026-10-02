/**
 * [L4] cwd 越界守卫。
 *
 * 反向通道下发的 cwd 是命令/进程的**执行目录**，而前端 `resolveCommandPath` 对绝对路径原样
 * 透传、对相对路径只做字符串拼接 —— `"../.."` 或 `"C:\\Windows"` 都能走到工作区外。这条守卫
 * 是 sidecar 侧的第二道（后端 `isCwdOutOfWorkspace` 是第一道），prove 的是"越界即拒绝执行"。
 *
 * 三态逐条钉住：没给 workspace_root = 判不了（放行，保持旧行为）；给了且在区内 = 放行；
 * 给了且越界 = 拒绝。判据用 Node 的 path，平台相关的分隔符不算进断言。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { cwdGuard } from '../runtime/cwdGuard.js'

const WS = path.join(os.tmpdir(), 'autobot-ws')
const OUTSIDE = path.join(os.tmpdir(), 'autobot-other')
const NESTED = path.join(WS, 'admin', 'sub')

describe('cwdGuard — 三态', () => {
  test('没给 workspace_root → 判不了 → 放行（不臆断，旧前端包不带这个字段）', () => {
    assert.equal(cwdGuard('/etc', undefined), null)
    assert.equal(cwdGuard(path.join(WS, 'admin'), ''), null)
    assert.equal(cwdGuard(path.join(WS, 'admin'), '   '), null)
    assert.equal(cwdGuard('/etc', null), null)
  })

  test('cwd 就是工作区根 → 放行', () => {
    assert.equal(cwdGuard(WS, WS), null)
    assert.equal(cwdGuard(path.join(WS, '.'), WS), null)
  })

  test('cwd 在工作区内（含嵌套）→ 放行', () => {
    assert.equal(cwdGuard(path.join(WS, 'admin'), WS), null)
    assert.equal(cwdGuard(NESTED, WS), null)
  })

  test('cwd 越界到兄弟目录 → 拒绝，理由里两个路径都在', () => {
    const reason = cwdGuard(OUTSIDE, WS)
    assert.ok(reason, 'sibling dir must be refused')
    assert.match(reason, /越界/)
    assert.ok(reason.includes(path.resolve(OUTSIDE)))
    assert.ok(reason.includes(path.resolve(WS)))
  })

  test('cwd 用 .. 爬出工作区 → 拒绝（字符串拼接掩盖不了）', () => {
    const escape = path.join(WS, '..', 'autobot-other')
    assert.ok(cwdGuard(escape, WS), 'traversal must be refused')
    // 深一层也拒绝
    assert.ok(cwdGuard(path.join(WS, 'a', '..', '..', '..', 'x'), WS))
  })

  test('省略 cwd → 以工作区根为目标 → 放行', () => {
    assert.equal(cwdGuard(undefined, WS), null)
    assert.equal(cwdGuard('', WS), null)
  })

  test('工作区不存在也照样判（纯字符串判据，不要求目录真的在）', () => {
    assert.ok(cwdGuard(OUTSIDE, path.join(os.tmpdir(), 'no-such-ws')))
  })
})