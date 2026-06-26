/**
 * Phase 4 (C-6+C-8) end-to-end tests for the new tool endpoints in
 * server.js. Spins up a tiny Express app that wires the same
 * route handlers and exercises the full request/response flow.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { webfetch, WebfetchError } from '../runtime/webfetch.js'
import { write as todoWrite, read as todoRead, updateItem as todoUpdate, clear as todoClear, _clear as todoReset } from '../runtime/todoStore.js'
import { create as qCreate, get as qGet, listPending as qListPending, answer as qAnswer, _clear as qReset } from '../runtime/questionQueue.js'

function startServer() {
  return new Promise((resolve) => {
    const app = express()
    app.use(express.json())

    app.post('/api/local/webfetch', async (req, res) => {
      const { url, maxBytes } = req.body || {}
      if (typeof url !== 'string' || !url) {
        return res.status(400).json({ status: 'error', error: 'url is required' })
      }
      try {
        const r = await webfetch(url, { maxBytes })
        return res.json({ status: 'ok', ...r })
      } catch (err) {
        if (err instanceof WebfetchError) {
          const status = err.code === 'invalid_url' ? 400 : 502
          return res.status(status).json({ status: 'error', code: err.code, error: err.message })
        }
        return res.status(500).json({ status: 'error', error: err.message })
      }
    })

    app.post('/api/local/todos', (req, res) => {
      try { res.json({ status: 'ok', ...todoWrite(req.body?.items || []) }) }
      catch (err) { res.status(400).json({ status: 'error', error: err.message }) }
    })
    app.get('/api/local/todos', (req, res) => res.json(todoRead()))
    app.patch('/api/local/todos/:id', (req, res) => {
      const out = todoUpdate(req.params.id, req.body || {})
      if (!out) return res.status(404).json({ status: 'error', error: 'todo not found' })
      res.json({ status: 'ok', ...out })
    })
    app.delete('/api/local/todos', (req, res) => res.json({ status: 'ok', ...todoClear() }))

    app.post('/api/local/questions', (req, res) => {
      try { res.status(201).json({ status: 'ok', question: qCreate(req.body || {}) }) }
      catch (err) { res.status(400).json({ status: 'error', error: err.message }) }
    })
    app.get('/api/local/questions/pending', (req, res) => res.json({ questions: qListPending() }))
    app.get('/api/local/questions/:id', (req, res) => {
      const q = qGet(req.params.id)
      if (!q) return res.status(404).json({ status: 'error', error: 'question not found' })
      res.json({ question: q })
    })
    app.post('/api/local/questions/:id/answer', (req, res) => {
      const { answer } = req.body || {}
      if (typeof answer !== 'string' && typeof answer !== 'number') {
        return res.status(400).json({ status: 'error', error: 'answer is required' })
      }
      const q = qAnswer(req.params.id, answer)
      if (!q) return res.status(404).json({ status: 'error', error: 'question not found or already answered' })
      res.json({ status: 'ok', question: q })
    })

    const server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

let server, port, target
function post(p, body) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
function getFn(p) {
  return fetch(`http://127.0.0.1:${port}${p}`).then(async (r) => ({ status: r.status, body: await r.json() }))
}
function patch(p, body) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
function del(p) {
  return fetch(`http://127.0.0.1:${port}${p}`, { method: 'DELETE' }).then(async (r) => ({ status: r.status, body: await r.json() }))
}

before(async () => {
  const started = await startServer()
  server = started.server
  port = started.port
  target = `http://127.0.0.1:${port}`
})
after(async () => {
  if (server) await new Promise((r) => server.close(() => r()))
})

describe('webfetch endpoint', () => {
  test('rejects missing url with 400', async () => {
    const r = await post('/api/local/webfetch', {})
    assert.equal(r.status, 400)
  })

  test('rejects file:// scheme with 400', async () => {
    const r = await post('/api/local/webfetch', { url: 'file:///etc/passwd' })
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'invalid_url')
  })

  test('fetches HTML from in-process server', async () => {
    // The endpoint hits `url` directly; we point it back at our test
    // server's own origin is not a known route, so use an httpbin-ish
    // in-process target. Easier: stand up a one-shot server here.
    const target2 = await new Promise((resolve) => {
      const s = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<h1>Hi</h1>')
      })
      s.listen(0, '127.0.0.1', () => resolve({ s, p: s.address().port }))
    })
    try {
      const r = await post('/api/local/webfetch', { url: `http://127.0.0.1:${target2.p}/` })
      assert.equal(r.status, 200)
      assert.match(r.body.body, /Hi/)
    } finally {
      target2.s.close()
    }
  })
})

describe('todos endpoint', () => {
  before(() => { todoReset() })

  test('write + read', async () => {
    const w = await post('/api/local/todos', { items: [{ content: 'a' }, { content: 'b', status: 'in_progress' }] })
    assert.equal(w.status, 200)
    assert.equal(w.body.items.length, 2)
    const r = await getFn('/api/local/todos')
    assert.equal(r.body.items.length, 2)
  })

  test('rejects non-array items', async () => {
    const r = await post('/api/local/todos', { items: 'nope' })
    assert.equal(r.status, 400)
  })

  test('update via PATCH', async () => {
    const w = await post('/api/local/todos', { items: [{ id: 'my-todo', content: 'a' }] })
    const id = w.body.items[0].id
    const p = await patch(`/api/local/todos/${id}`, { status: 'completed' })
    assert.equal(p.status, 200)
    assert.equal(p.body.items.find((x) => x.id === id).status, 'completed')
  })

  test('clear', async () => {
    await del('/api/local/todos')
    const r = await getFn('/api/local/todos')
    assert.equal(r.body.items.length, 0)
  })
})

describe('questions endpoint', () => {
  before(() => { qReset() })

  test('create + list pending', async () => {
    const c = await post('/api/local/questions', { question: 'color?' })
    assert.equal(c.status, 201)
    assert.ok(c.body.question.id)
    const list = await getFn('/api/local/questions/pending')
    assert.equal(list.body.questions.length, 1)
  })

  test('answer returns the question with answer set', async () => {
    const c = await post('/api/local/questions', { question: 'a or b?' })
    const a = await post(`/api/local/questions/${c.body.question.id}/answer`, { answer: 'a' })
    assert.equal(a.status, 200)
    assert.equal(a.body.question.answer, 'a')
    assert.equal(a.body.question.status, 'answered')
  })

  test('second answer is rejected with 404', async () => {
    const c = await post('/api/local/questions', { question: 'x' })
    await post(`/api/local/questions/${c.body.question.id}/answer`, { answer: 'first' })
    const second = await post(`/api/local/questions/${c.body.question.id}/answer`, { answer: 'second' })
    assert.equal(second.status, 404)
  })

  test('rejects missing answer with 400', async () => {
    const c = await post('/api/local/questions', { question: 'x' })
    const r = await post(`/api/local/questions/${c.body.question.id}/answer`, {})
    assert.equal(r.status, 400)
  })
})
