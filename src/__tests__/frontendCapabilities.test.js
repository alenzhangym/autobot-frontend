/**
 * [L0 收口] 能力清单与前端实际会执行的动作必须一致。
 *
 * 为什么值得钉：清单是后端**发命令之前**唯一的依据（`client_info.features`）。列了一个前端不认识的
 * 动作，后端就会以为"这只手在"并发的走过去，收到的只是 `unsupported_action` —— 比清单缺失更坏，
 * 因为它把一次本可以事前避免的失败换成一轮空转。2026-10-02 就写错过一次（`depgraph` 其实由后端
 * ServerSideCommandResolver 就地解析，前端没有对应 case）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRONTEND_CAPABILITIES } from '../runtime/frontendCapabilities.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const panelSrc = fs.readFileSync(
  path.join(here, '..', 'components', 'WorkspacePanel.jsx'), 'utf-8')

test('清单里没有重复项, 且都是非空字符串', () => {
  const seen = new Set()
  for (const c of FRONTEND_CAPABILITIES) {
    assert.equal(typeof c, 'string')
    assert.ok(c.length > 0)
    assert.ok(!seen.has(c), `重复的能力名: ${c}`)
    seen.add(c)
  }
})

test('清单里每一项在 WorkspacePanel 都有对应 case（否则后端会发出不可能成功的指令）', () => {
  const missing = FRONTEND_CAPABILITIES.filter(
    (c) => !new RegExp(`case\\s+'${c}'`).test(panelSrc))
  assert.deepEqual(missing, [], `这些能力前端执行不了: ${missing.join(', ')}`)
})

test('由后端就地解析的动作不许混进清单', () => {
  for (const serverSide of ['depgraph', 'graph', 'graph_search', 'focus', 'issues', 'skill']) {
    assert.ok(!FRONTEND_CAPABILITIES.includes(serverSide),
      `${serverSide} 由后端解析, 列进来等于谎报能力`)
  }
})
