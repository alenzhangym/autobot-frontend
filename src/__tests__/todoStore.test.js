/**
 * Phase 4 (C-8) tests for todoStore.
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { write, read, updateItem, clear } from '../runtime/todoStore.js'

beforeEach(() => clear())

describe('todoStore: write/read', () => {
  test('write replaces the entire list', () => {
    write([{ content: 'a' }, { content: 'b', status: 'in_progress' }])
    const r = read()
    assert.equal(r.items.length, 2)
    assert.equal(r.items[0].content, 'a')
    assert.equal(r.items[0].status, 'pending')
    assert.equal(r.items[1].status, 'in_progress')
  })

  test('write assigns ids when missing', () => {
    write([{ content: 'a' }, { content: 'b' }])
    const r = read()
    assert.ok(r.items[0].id)
    assert.ok(r.items[1].id)
    assert.notEqual(r.items[0].id, r.items[1].id)
  })

  test('write preserves user-supplied ids', () => {
    write([{ id: 'my-id', content: 'a' }])
    const r = read()
    assert.equal(r.items[0].id, 'my-id')
  })

  test('write coerces unknown status to pending', () => {
    write([{ content: 'a', status: 'banana' }])
    const r = read()
    assert.equal(r.items[0].status, 'pending')
  })

  test('write rejects non-array input', () => {
    assert.throws(() => write('not an array'))
    assert.throws(() => write(null))
  })

  test('write rejects items without content', () => {
    assert.throws(() => write([{ status: 'pending' }]))
  })
})

describe('todoStore: updateItem', () => {
  test('patches a single item by id', () => {
    const w = write([{ id: 'x', content: 'a' }, { content: 'b' }])
    const id = w.items[0].id
    updateItem(id, { status: 'completed' })
    const r = read()
    const item = r.items.find((it) => it.id === id)
    assert.equal(item.status, 'completed')
  })

  test('returns null for unknown id', () => {
    const result = updateItem('nonexistent', { status: 'completed' })
    assert.equal(result, null)
  })

  test('rejects invalid status', () => {
    const w = write([{ id: 'x', content: 'a' }])
    assert.throws(() => updateItem(w.items[0].id, { status: 'banana' }))
  })
})

describe('todoStore: clear', () => {
  test('clears the list', () => {
    write([{ content: 'a' }])
    clear()
    assert.equal(read().items.length, 0)
  })
})
