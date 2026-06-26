/**
 * taskRegistry — in-memory registry for background (async) command
 * tasks. Phase 3 (C-3) of the opencode-vs-autobot gap plan.
 *
 * Each background task is a child process spawned with `detached: true`
 * so we can signal the entire process group on cancel. The registry
 * assigns a UUID at creation time, tracks status/stdout/stderr, and
 * exposes CRUD-style helpers to the server endpoint.
 *
 * Tasks live in memory only. We don't persist to disk because:
 *  - the command may write to disk on its own
 *  - a server restart should not resurrect long-running builds
 *  - completed tasks are evicted after `TASK_TTL_MS` to keep memory
 *    bounded.
 *
 * Concurrency: the registry is a single Map with synchronous read
 * helpers. All mutations happen on the server's event-loop thread so
 * no locking is needed.
 */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { killProcessTree } from './processGroup.js'

/** Default output cap per task (bytes). 2 MiB matches PersistentShell. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
/** TTL for completed tasks before they are evicted. */
export const TASK_TTL_MS = 5 * 60 * 1000

/**
 * @typedef {Object} BackgroundTask
 * @property {string} id            UUID
 * @property {string} command       raw command string
 * @property {string} cwd           working directory
 * @property {Object} env           environment vars
 * @property {string} status        'running' | 'success' | 'error' | 'timeout' | 'killed'
 * @property {number} [exitCode]
 * @property {boolean} [timedOut]
 * @property {boolean} [killed]     true if terminated by us
 * @property {number} startedAt     ms epoch
 * @property {number} [endedAt]
 * @property {number} [durationMs]
 * @property {string} stdout        accumulated output
 * @property {string} stderr        accumulated output
 * @property {number} [timeoutMs]
 * @property {string} [analysisReason]
 * @property {string} shellPath
 * @property {string[]} shellArgs
 */

const TASKS = new Map()

/**
 * Create and start a background task. Returns the task object
 * immediately; the caller can poll `get(id)` for status.
 *
 * @param {Object} opts
 * @param {string} opts.command
 * @param {string} opts.cwd
 * @param {Object} [opts.env]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.analysisReason]
 * @param {string} [opts.shellPath]
 * @param {string[]} [opts.shellArgs]
 * @returns {BackgroundTask}
 */
export function createTask(opts) {
  const id = randomUUID()
  const shellPath = opts.shellPath || (process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : '/bin/bash')
  const shellArgs = opts.shellArgs || (process.platform === 'win32'
    ? ['-c']
    : ['-c'])
  /** @type {BackgroundTask} */
  const task = {
    id,
    command: opts.command,
    cwd: opts.cwd,
    env: opts.env || {},
    status: 'running',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    timeoutMs: opts.timeoutMs,
    analysisReason: opts.analysisReason,
    shellPath,
    shellArgs,
  }
  TASKS.set(id, task)
  startTask(task)
  return task
}

function startTask(task) {
  // `detached: true` (POSIX) creates a new process group so we can
  // kill the whole tree with `process.kill(-pid, 'SIGTERM')`. On
  // Windows this option has no effect on the process group but we
  // still need it for stdio handle inheritance behavior.
  // stdio is captured in pipes (default) — we don't want a controlling
  // tty on a long-running build.
  const child = spawn(task.shellPath, [...task.shellArgs, task.command], {
    cwd: task.cwd,
    env: task.env,
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  task._child = child

  appendWithCap(child.stdout, 'stdout', task, MAX_OUTPUT_BYTES)
  appendWithCap(child.stderr, 'stderr', task, MAX_OUTPUT_BYTES)

  if (task.timeoutMs && task.timeoutMs > 0) {
    task._timer = setTimeout(() => {
      if (task.status === 'running') {
        task.status = 'timeout'
        task.timedOut = true
        killProcessTree(child).catch(() => { /* best effort */ })
      }
    }, task.timeoutMs)
    // Don't keep the event loop alive for this timer.
    if (task._timer.unref) task._timer.unref()
  }

  child.on('error', (err) => {
    // ENOENT etc. — shell binary missing or cwd invalid.
    if (task.status === 'running') {
      task.status = 'error'
    }
    task.stderr = appendChunk(task.stderr, `\n[spawn error] ${err.message}`)
    finalizeTask(task, null)
  })

  child.on('exit', (code, signal) => {
    if (task.status === 'running') {
      if (signal) {
        // The OS killed it (SIGTERM/SIGKILL). If we asked for it,
        // `task.killed` is set; otherwise treat as error.
        task.status = task.killed ? 'killed' : 'error'
        task.exitCode = null
      } else {
        task.status = code === 0 ? 'success' : 'error'
        task.exitCode = code
      }
    }
    finalizeTask(task, code)
  })
}

function appendWithCap(stream, field, task, cap) {
  stream.on('data', (chunk) => {
    if (task[field].length >= cap) {
      // Soft cap: stop accumulating. The child may still be running.
      return
    }
    const remaining = cap - task[field].length
    if (chunk.length > remaining) {
      task[field] += chunk.toString('utf8', 0, remaining)
      task[field] += `\n[...truncated at ${cap} bytes...]`
    } else {
      task[field] += chunk.toString('utf8')
    }
  })
}

function appendChunk(existing, chunk) {
  if (existing.length + chunk.length > MAX_OUTPUT_BYTES) {
    return existing + `\n[...truncated...]`
  }
  return existing + chunk
}

function finalizeTask(task, _exitCode) {
  task.endedAt = Date.now()
  task.durationMs = task.endedAt - task.startedAt
  if (task._timer) {
    clearTimeout(task._timer)
    task._timer = null
  }
  // Evict after TTL
  setTimeout(() => {
    TASKS.delete(task.id)
  }, TASK_TTL_MS).unref?.()
}

/** Get a task by id. Returns undefined if not found or already evicted. */
export function get(id) {
  return TASKS.get(id)
}

/** List all known tasks (running + recently completed). */
export function list() {
  return Array.from(TASKS.values()).map(summarize)
}

/** Terminate a running task. Returns true if a kill signal was sent. */
export async function kill(id) {
  const task = TASKS.get(id)
  if (!task) return false
  if (task.status !== 'running') return false
  task.killed = true
  task.status = 'killed'
  if (task._child) {
    await killProcessTree(task._child)
  }
  return true
}

/** Kill every running task — used on server shutdown. */
export async function killAll() {
  const ids = Array.from(TASKS.keys())
  await Promise.all(ids.map((id) => kill(id)))
}

/** Public-safe snapshot (no internal `_child` / `_timer` refs). */
export function summarize(task) {
  if (!task) return null
  const { _child, _timer, ...rest } = task
  return rest
}
