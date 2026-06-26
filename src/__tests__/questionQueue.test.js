/**
 * Phase 4 (C-8) tests for questionQueue.
 */
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { create, get, listPending, listAll, answer, _clear } from '../runtime/questionQueue.js'

beforeEach(() => _clear())

describe('questionQueue: create / get', () => {
  test('creates a pending question with an id', () => {
    const q = create({ question: 'Which database?' })
    assert.ok(q.id)
    assert.equal(q.status, 'pending')
    assert.equal(q.question, 'Which database?')
  })

  test('preserves options, default, header', () => {
    const q = create({
      question: 'Pick one',
      options: ['A', 'B', 'C'],
      default: 'A',
      header: 'Database',
    })
    assert.deepEqual(q.options, ['A', 'B', 'C'])
    assert.equal(q.default, 'A')
    assert.equal(q.header, 'Database')
  })

  test('rejects empty question', () => {
    assert.throws(() => create({ question: '' }))
    assert.throws(() => create({ question: '   ' }))
    assert.throws(() => create({}))
  })

  test('get returns null for unknown id', () => {
    assert.equal(get('nonexistent'), null)
  })

  test('get returns a copy of the question', () => {
    const q = create({ question: 'x' })
    const fetched = get(q.id)
    assert.equal(fetched.id, q.id)
    // mutating the copy does not affect the queue
    fetched.status = 'tampered'
    assert.equal(get(q.id).status, 'pending')
  })
})

describe('questionQueue: list', () => {
  test('listPending returns only pending entries', () => {
    const a = create({ question: 'a' })
    create({ question: 'b' })
    answer(a.id, 'choice')
    const pending = listPending()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].question, 'b')
  })

  test('listAll returns every entry', () => {
    create({ question: 'a' })
    create({ question: 'b' })
    assert.equal(listAll().length, 2)
  })
})

describe('questionQueue: answer', () => {
  test('records the answer and marks answered', () => {
    const q = create({ question: 'color?' })
    const updated = answer(q.id, 'blue')
    assert.equal(updated.status, 'answered')
    assert.equal(updated.answer, 'blue')
    assert.ok(updated.answeredAt >= q.createdAt)
  })

  test('returns null for unknown id', () => {
    assert.equal(answer('nonexistent', 'x'), null)
  })

  test('rejects a second answer', () => {
    const q = create({ question: 'a' })
    assert.ok(answer(q.id, 'first'))
    assert.equal(answer(q.id, 'second'), null)
  })

  test('coerces answer to string', () => {
    const q = create({ question: 'count' })
    const updated = answer(q.id, 42)
    assert.equal(updated.answer, '42')
  })
})
