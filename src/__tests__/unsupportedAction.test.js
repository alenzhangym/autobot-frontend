/**
 * F47 修复轮：前端遇到不认识的动作时，回传必须是**结构化**的 unsupported_action。
 *
 * 钉住的两件事：
 *  - 载荷是合法 JSON 且带 `unsupported_action` 键 —— 后端只认这个键，自由文本会被当成一次
 *    失败的探测，环境准备状态机因此白挂一档（实测一轮烧掉 4 次往返）；
 *  - action 缺失/空串也不许回空 body，否则后端连"哪个动作不支持"都说不出来。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { unsupportedActionPayload, UNSUPPORTED_ACTION_KEY } from '../utils/unsupportedAction.js'

describe('unsupportedActionPayload', () => {
  test('是合法 JSON, 且带后端认的那个键', () => {
    const parsed = JSON.parse(unsupportedActionPayload('env_probe'))
    assert.equal(parsed[UNSUPPORTED_ACTION_KEY], 'env_probe')
    assert.ok(typeof parsed.note === 'string' && parsed.note.length > 0)
  })

  test('不是自由文本（后端要靠这个区分"版本没对齐"和"命令真失败"）', () => {
    const body = unsupportedActionPayload('proc_start')
    assert.ok(!/^Unknown command/.test(body))
    assert.ok(body.includes('"unsupported_action"'))
  })

  test('action 缺失时回 (missing), 不许回空串', () => {
    assert.equal(JSON.parse(unsupportedActionPayload(undefined))[UNSUPPORTED_ACTION_KEY], '(missing)')
    assert.equal(JSON.parse(unsupportedActionPayload(''))[UNSUPPORTED_ACTION_KEY], '(missing)')
  })

  test('带引号/反斜杠的动作名也不会破 JSON', () => {
    const weird = 'a"b\\c'
    assert.equal(JSON.parse(unsupportedActionPayload(weird))[UNSUPPORTED_ACTION_KEY], weird)
  })
})
