/**
 * W3 — full server.js integration smoke test.
 *
 * Spawns the real `server.js` as a child process on a random port
 * (with `NO_OPEN=1` to skip the auto-browser launch) and exercises
 * the Phase 1-4 endpoints end-to-end. This is the only test that
 * covers the wired-up server, not just the modules in isolation.
 *
 * <h3>Why not import server.js?</h3>
 * <p>server.js calls `app.listen()` at import time and has many
 * other top-level side effects (file probes, monitor loader, etc.).
 * Spawning it as a child process is the simplest way to get a clean
 * instance that we can tear down without polluting the test runner.</p>
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(__dirname, '..')
const SERVER_PATH = path.join(SERVER_DIR, 'server.js')

const IS_WIN = process.platform === 'win32'

function startServer() {
  return new Promise((resolve, reject) => {
    const port = 30000 + Math.floor(Math.random() * 30000)
    const child = spawn(process.execPath, [SERVER_PATH], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        NO_OPEN: '1',
        CI: 'true',
        AUTOBOT_ELECTRON: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      try { child.kill() } catch (_) {}
      reject(new Error(`server start timeout. stdout=${stdout.slice(-500)} stderr=${stderr.slice(-500)}`))
    }, 30_000)
    function tryResolve() {
      if (resolved) return
      // server.js prints "Local Agent API: http://localhost:PORT"
      if (stdout.includes(`http://localhost:${port}`)) {
        resolved = true
        clearTimeout(timer)
        resolve({ child, port, stdout, stderr })
      }
    }
    child.stdout.on('data', tryResolve)
    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        reject(new Error(`server exited early with code ${code}. stdout=${stdout.slice(-500)} stderr=${stderr.slice(-500)}`))
      }
    })
  })
}

function req(port, method, p, body) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
}

describe('server.js: Phase 1-4 integration smoke test', () => {
  let child, port

  before(async () => {
    const started = await startServer()
    child = started.child
    port = started.port
  })

  after(async () => {
    if (child) {
      // SIGTERM first, then SIGKILL after 3s, in case the server is
      // hung on a runaway background task.
      try { child.kill('SIGTERM') } catch (_) {}
      await new Promise((resolve) => {
        let done = false
        const fallback = setTimeout(() => {
          if (!done) { try { child.kill('SIGKILL') } catch (_) {} }
        }, 3000)
        child.on('exit', () => { done = true; clearTimeout(fallback); resolve() })
        setTimeout(resolve, 5000)
      })
    }
  })

  test('GET /api/local/bash returns the shell list', async () => {
    const r = await req(port, 'GET', '/api/local/bash')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.body.shells))
  })

  test('POST /api/local/bash: deny rm -rf / with 403', async () => {
    const r = await req(port, 'POST', '/api/local/bash', { command: 'rm -rf /', timeoutMs: 5000 })
    assert.equal(r.status, 403)
    assert.equal(r.body.status, 'denied')
  })

  test('POST /api/local/bash: ask plain rm with 200 needs_confirmation', async () => {
    const r = await req(port, 'POST', '/api/local/bash', { command: 'rm some.txt', timeoutMs: 5000 })
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'needs_confirmation')
  })

  test('POST /api/local/bash: confirmed=true runs the command', async () => {
    const r = await req(port, 'POST', '/api/local/bash', { command: 'echo integration', timeoutMs: 10_000, confirmed: true })
    assert.equal(r.status, 200)
    assert.match(r.body.stdout, /integration/)
  })

  test('POST /api/local/bash: background=true returns 202 with taskId', async () => {
    const r = await req(port, 'POST', '/api/local/bash', {
      command: IS_WIN ? 'ping -n 2 127.0.0.1 > nul' : 'sleep 0.2',
      timeoutMs: 10_000,
      background: true,
    })
    assert.equal(r.status, 202)
    assert.equal(r.body.status, 'running')
    assert.ok(r.body.taskId)
    // Poll until the task finishes
    const deadline = Date.now() + 10_000
    let final = null
    while (Date.now() < deadline) {
      const t = await req(port, 'GET', `/api/local/bash/tasks/${r.body.taskId}`)
      if (t.body?.task?.status && t.body.task.status !== 'running') {
        final = t.body.task
        break
      }
      await new Promise((res) => setTimeout(res, 100))
    }
    assert.ok(final, 'expected task to finish within 10s')
    assert.ok(['success', 'error', 'killed'].includes(final.status))
  })

  test('GET /api/local/bash/tasks lists tasks', async () => {
    const r = await req(port, 'GET', '/api/local/bash/tasks')
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.body.tasks))
  })

  test('DELETE /api/local/bash/tasks/:id kills a long-running task', async () => {
    // Start a long task
    const start = await req(port, 'POST', '/api/local/bash', {
      command: IS_WIN ? 'ping -n 30 127.0.0.1 > nul' : 'sleep 30',
      timeoutMs: 60_000,
      background: true,
    })
    assert.equal(start.status, 202)
    const taskId = start.body.taskId
    // Wait briefly to let the process spawn
    await new Promise((r) => setTimeout(r, 300))
    // Kill it
    const killRes = await req(port, 'DELETE', `/api/local/bash/tasks/${taskId}`)
    assert.equal(killRes.status, 200)
    assert.equal(killRes.body.killed, true)
    // Poll until it is no longer running
    const deadline = Date.now() + 5_000
    let final = null
    while (Date.now() < deadline) {
      const t = await req(port, 'GET', `/api/local/bash/tasks/${taskId}`)
      if (t.body?.task?.status && t.body.task.status !== 'running') {
        final = t.body.task
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.ok(final, 'expected task to be killed within 5s')
    assert.equal(final.status, 'killed')
  })

  test('POST /api/local/webfetch: rejects file:// with 400', async () => {
    const r = await req(port, 'POST', '/api/local/webfetch', { url: 'file:///etc/passwd' })
    assert.equal(r.status, 400)
  })

  test('POST/GET /api/local/todos: write then read', async () => {
    const w = await req(port, 'POST', '/api/local/todos', { items: [{ content: 'task a' }, { content: 'task b' }] })
    assert.equal(w.status, 200)
    assert.equal(w.body.items.length, 2)
    const r = await req(port, 'GET', '/api/local/todos')
    assert.equal(r.body.items.length, 2)
  })

  test('POST /api/local/questions: create + answer', async () => {
    const c = await req(port, 'POST', '/api/local/questions', { question: 'Pick a number' })
    assert.equal(c.status, 201)
    const id = c.body.question.id
    const a = await req(port, 'POST', `/api/local/questions/${id}/answer`, { answer: '7' })
    assert.equal(a.status, 200)
    assert.equal(a.body.question.answer, '7')
    const pending = await req(port, 'GET', '/api/local/questions/pending')
    assert.ok(Array.isArray(pending.body.questions))
    assert.ok(!pending.body.questions.find((q) => q.id === id))
  })
})
