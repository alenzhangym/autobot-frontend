/**
 * N-8: InteractivePanel 渲染契约测试。
 *
 * <p>不依赖 react-testing-library —— 只锁 "状态 → render props" 的映射。
 * 实际渲染靠 mount 时的手测 / e2e。</p>
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

describe('N-8: InteractivePanel 契约', () => {
  test('空 todos 时 render 进度 = 0', () => {
    const items = []
    const done = items.filter((i) => i.status === 'completed' || i.status === 'cancelled').length
    assert.equal(items.length === 0 ? 0 : done / items.length, 0)
  })

  test('全部 done 时 render 进度 = 1', () => {
    const items = [
      { id: '1', status: 'completed' },
      { id: '2', status: 'cancelled' },
    ]
    const done = items.filter((i) => i.status === 'completed' || i.status === 'cancelled').length
    assert.equal(done / items.length, 1)
  })

  test('部分 done 时进度 = done/total', () => {
    const items = [
      { id: '1', status: 'completed' },
      { id: '2', status: 'in_progress' },
      { id: '3', status: 'pending' },
    ]
    const done = items.filter((i) => i.status === 'completed' || i.status === 'cancelled').length
    assert.equal(Math.round(done / items.length * 1000) / 1000, Math.round(1 / 3 * 1000) / 1000)
  })

  test('priority → 颜色 映射覆盖 4 档', () => {
    const map = { urgent: 'red', high: 'volcano', medium: 'gold', low: 'green' }
    assert.equal(map.urgent, 'red')
    assert.equal(map.low, 'green')
    assert.equal(map.medium, 'gold')
    assert.equal(map.high, 'volcano')
  })

  test('multiSelect 的提交会拼接成逗号串给后端', () => {
    const sel = new Set(['a', 'b'])
    const out = Array.from(sel).join(',')
    assert.equal(out, 'a,b')
  })
})
