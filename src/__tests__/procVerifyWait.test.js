/**
 * [B·ii] Tests for the browser-side wait before answering a `proc_status` re-look.
 *
 * The run-acceptance leg is only as honest as the evidence it gets. If the browser
 * answers instantly, `stdout_tail` is still empty and the server can never see a
 * readiness signal — the budget then burns on identical non-evidence (2026-10-03:
 * three re-looks inside 4.1s while mvn needed 5.8s to fail). So the wait must be
 * honoured, and it must be bounded: a bogus `wait_ms` must never park the tab.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampWaitMs, MAX_WAIT_MS } from '../runtime/procVerifyWait.js'

test('clampWaitMs — 缺省与非法值一律不等待', () => {
  for (const raw of [undefined, null, '', 'abc', NaN, {}, []]) {
    assert.equal(clampWaitMs(raw), 0, `不可用的 wait_ms (${String(raw)}) 必须当 0`)
  }
  assert.equal(clampWaitMs(0), 0)
  assert.equal(clampWaitMs(-5000), 0, '负数不许造成任何等待')
})

test('clampWaitMs — 可用值原样采纳', () => {
  assert.equal(clampWaitMs(20000), 20000)
  assert.equal(clampWaitMs('20000'), 20000, '后端 JSON 里是数字, 但字符串形态也要能用')
  assert.equal(clampWaitMs(1500.9), 1500, '小数向下取整')
})

test('clampWaitMs — 上限是硬闸, 拿不准宁可不等', () => {
  assert.equal(clampWaitMs(MAX_WAIT_MS), MAX_WAIT_MS)
  assert.equal(clampWaitMs(MAX_WAIT_MS + 1), MAX_WAIT_MS)
  assert.equal(clampWaitMs(1e12), MAX_WAIT_MS)
  // 不可用的值 (Infinity/NaN/负数) 一律当"不等"，绝不当"等满上限": 宁可让这条腿立刻回一次
  // (下一轮还会再看)，也不许它把浏览器标签页无故扣住 60 秒。
  assert.equal(clampWaitMs(Number.POSITIVE_INFINITY), 0)
})
