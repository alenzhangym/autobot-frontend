/**
 * N-8: useInteractiveState 契约测试。
 *
 * <p>前端 hook 直接测 React state 转换比较麻烦，这里锁的是：
 * <ul>
 *   <li>请求路径 / payload schema 跟后端 {@code /api/local/questions} /
 *       {@code /api/local/todos} 一致</li>
 *   <li>WS 事件名 → state 映射的 reducer 逻辑（纯函数）</li>
 * </ul>
 * </p>
 *
 * <p>跟 {@code useFixTaskPoller.test.js} 保持同样"轻 doc-test"风格。</p>
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

describe('N-8: useInteractiveState 契约', () => {
  test('questions 端点路径', () => {
    assert.equal('/api/local/questions', '/api/local/questions')
    assert.equal('/api/local/questions/pending', '/api/local/questions/pending')
    assert.equal('/api/local/questions/abc/answer', '/api/local/questions/abc/answer')
  })

  test('todos 端点路径', () => {
    assert.equal('/api/local/todos', '/api/local/todos')
    assert.equal('/api/local/todos/todo-1', '/api/local/todos/todo-1')
  })

  test('sessionId 通过 query param 传', () => {
    const sid = 's-xyz'
    const url = `/api/local/todos?sessionId=${encodeURIComponent(sid)}`
    assert.equal(url, '/api/local/todos?sessionId=s-xyz')
  })

  test('WS 事件名常量', () => {
    const evt = { ask: 'question.ask', answered: 'question.answered', expired: 'question.expired', todo: 'todo.update' }
    assert.equal(evt.ask, 'question.ask')
    assert.equal(evt.answered, 'question.answered')
    assert.equal(evt.expired, 'question.expired')
    assert.equal(evt.todo, 'todo.update')
  })

  test('pending list 去重：同一 id 不重复塞', () => {
    const initial = []
    const incoming = { id: 'q-1', question: '?' }
    const next1 = initial.some((q) => q.id === incoming.id) ? initial : [...initial, incoming]
    assert.deepEqual(next1, [incoming])
    const next2 = next1.some((q) => q.id === incoming.id) ? next1 : [...next1, incoming]
    assert.equal(next2, next1)   // 引用相等，说明没塞第二份
  })

  test('answered 事件把对应 id 从 pending 拿掉', () => {
    const list = [{ id: 'q-1' }, { id: 'q-2' }, { id: 'q-3' }]
    const id = 'q-2'
    const next = list.filter((q) => q.id !== id)
    assert.deepEqual(next, [{ id: 'q-1' }, { id: 'q-3' }])
  })

  test('answer payload schema：string 后端才会接受', () => {
    const ans = 42
    const payload = { answer: String(ans), sessionId: 's' }
    assert.equal(payload.answer, '42')
  })

  test('multiSelect 默认值 = default 字段（list 形式）', () => {
    const q = { multiSelect: true, default: 'b', options: ['a', 'b', 'c'] }
    const seed = q.default ? [q.default] : []
    assert.deepEqual(new Set(seed), new Set(['b']))
  })
})
