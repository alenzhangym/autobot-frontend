/**
 * Phase 2 (C-5+C-7) end-to-end tests for the analyzer in
 * server.js `/api/local/bash`. Spins up a tiny Express app mirroring
 * the route handler and exercises:
 *  - `deny` → 403
 *  - `ask` without confirmation → 200 + needs_confirmation
 *  - `ask` with confirmation → command runs
 *  - `allow` → command runs
 *  - `confirmed` flag is ignored for `allow` (no harm in passing it)
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { analyzeCommand } from '../runtime/commandAnalyzer.js'
import { PersistentShell } from '../runtime/PersistentShell.js'

function startServer(handler) {
  return new Promise((resolve) => {
    const app = express()
    app.use(express.json())
    app.post('/api/local/bash', handler)
    const server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port })
    })
  })
}

function post(port, body) {
  return fetch(`http://127.0.0.1:${port}/api/local/bash`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}

describe('commandAnalyzer in /api/local/bash', () => {
  let server, port

  before(async () => {
    const started = await startServer(async (req, res) => {
      const { command, timeoutMs = 60_000, confirmed = false, namespace = 'default' } = req.body || {}
      if (typeof command !== 'string' || !command) {
        return res.status(400).json({ status: 'error', error: 'command is required' })
      }
      const analysis = analyzeCommand(command, { namespace })
      if (analysis.decision === 'deny') {
        return res.status(403).json({ status: 'denied', reason: analysis.reason, analysis })
      }
      if (analysis.decision === 'ask' && !confirmed) {
        return res.status(200).json({ status: 'needs_confirmation', reason: analysis.reason, analysis })
      }
      const shell = new PersistentShell({ id: 'test' })
      try {
        const r = await shell.exec(command, { timeoutMs })
        return res.json({ status: r.status, stdout: r.stdout, analysis })
      } finally {
        shell.kill()
      }
    })
    server = started.server
    port = started.port
  })

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()))
    }
  })

  test('denies rm -rf /', async () => {
    const r = await post(port, { command: 'rm -rf /' })
    assert.equal(r.status, 403)
    assert.equal(r.body.status, 'denied')
    assert.match(r.body.reason, /root|delete/i)
  })

  test('asks for confirmation on plain rm', async () => {
    const r = await post(port, { command: 'rm some.txt' })
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'needs_confirmation')
  })

  test('runs an ask command when confirmed=true', async () => {
    const r = await post(port, { command: 'rm some.txt', confirmed: true })
    assert.equal(r.status, 200)
    assert.notEqual(r.body.status, 'needs_confirmation')
  })

  test('runs an allow command without confirmation', async () => {
    const r = await post(port, { command: 'echo hello' })
    assert.equal(r.status, 200)
    assert.match(r.body.stdout, /hello/)
  })

  test('confirmation flag is ignored for deny (still 403)', async () => {
    const r = await post(port, { command: 'rm -rf /', confirmed: true })
    assert.equal(r.status, 403)
  })
})
