/**
 * Phase 3 (C-3+C-4) tests for taskRegistry.
 *
 * Covers:
 *  - createTask returns a task with id, status='running', startedAt
 *  - a short command eventually reaches 'success' with captured stdout
 *  - a non-zero exit command reaches 'error' with exitCode != 0
 *  - kill() terminates a long-running command
 *  - kill() returns false for a finished task
 *  - list() returns tasks and includes the running one
 *  - get() returns the task by id
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTask,
  get,
  list,
  kill,
  killAll,
  summarize,
} from '../runtime/taskRegistry.js'

const IS_WIN = process.platform === 'win32'

after(async () => {
  await killAll()
})

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function waitFor(taskId, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const t = get(taskId)
    if (t && predicate(t)) return t
    await sleep(50)
  }
  const t = get(taskId)
  throw new Error(`timeout waiting on ${taskId}: status=${t?.status} stdout=${t?.stdout?.slice(0, 100)} stderr=${t?.stderr?.slice(0, 100)}`)
}

describe('taskRegistry: createTask basics', () => {
  test('returns a task with id, running status, startedAt', () => {
    const t = createTask({ command: 'echo hi', cwd: process.cwd() })
    assert.ok(t.id, 'expected an id')
    assert.equal(t.status, 'running')
    assert.ok(typeof t.startedAt === 'number')
    assert.ok(t.startedAt > 0)
  })

  test('running command eventually succeeds with captured stdout', async () => {
    const t = createTask({ command: 'echo hello-task', cwd: process.cwd(), timeoutMs: 10_000 })
    const final = await waitFor(t.id, (x) => x.status === 'success' || x.status === 'error')
    assert.equal(final.status, 'success')
    assert.match(final.stdout, /hello-task/)
  })

  test('non-zero exit reaches error with exitCode set', async () => {
    // `false` is a shell builtin that exits 1
    const t = createTask({ command: IS_WIN ? 'exit 7' : 'exit 7', cwd: process.cwd(), timeoutMs: 5_000 })
    const final = await waitFor(t.id, (x) => x.status !== 'running')
    assert.equal(final.status, 'error')
    assert.equal(final.exitCode, 7)
  })
})

describe('taskRegistry: kill / cancel', () => {
  test('kill() terminates a long-running command', async () => {
    // `sleep 30` or, on Windows, ping localhost with a long delay.
    // We don't strictly need a long delay — we just need something
    // that the OS will need to actively kill.
    const t = createTask({
      command: IS_WIN
        ? 'ping -n 30 127.0.0.1 > nul'
        : 'sleep 30',
      cwd: process.cwd(),
      timeoutMs: 30_000,
    })
    // Give the process a moment to actually start.
    await sleep(300)
    const ok = await kill(t.id)
    assert.equal(ok, true, 'expected kill to return true for a running task')
    const final = await waitFor(t.id, (x) => x.status !== 'running', 5_000)
    assert.equal(final.status, 'killed')
    assert.equal(final.killed, true)
  })

  test('kill() returns false for a finished task', async () => {
    const t = createTask({ command: 'echo done', cwd: process.cwd(), timeoutMs: 5_000 })
    await waitFor(t.id, (x) => x.status !== 'running')
    const ok = await kill(t.id)
    assert.equal(ok, false, 'expected kill to return false for a finished task')
  })

  test('timeout fires and marks task timed out', async () => {
    // A command that should run longer than its timeout.
    const t = createTask({
      command: IS_WIN ? 'ping -n 10 127.0.0.1 > nul' : 'sleep 10',
      cwd: process.cwd(),
      timeoutMs: 1_000,
    })
    const final = await waitFor(t.id, (x) => x.status === 'timeout' || x.status === 'killed', 5_000)
    assert.equal(final.timedOut, true)
    assert.equal(final.status, 'timeout')
  })
})

describe('taskRegistry: list / get / summarize', () => {
  test('list returns a non-empty array', () => {
    const t = createTask({ command: 'echo a', cwd: process.cwd() })
    const all = list()
    assert.ok(Array.isArray(all))
    assert.ok(all.some((x) => x.id === t.id))
  })

  test('get returns the task by id', () => {
    const t = createTask({ command: 'echo b', cwd: process.cwd() })
    const fetched = get(t.id)
    assert.equal(fetched.id, t.id)
  })

  test('get returns undefined for unknown id', () => {
    assert.equal(get('nonexistent-id-12345'), undefined)
  })

  test('summarize strips internal refs', () => {
    const t = createTask({ command: 'echo c', cwd: process.cwd() })
    const s = summarize(t)
    assert.equal(s._child, undefined)
    assert.equal(s._timer, undefined)
    assert.ok(s.id)
  })
})
