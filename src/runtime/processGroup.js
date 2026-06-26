/**
 * processGroup — cross-platform helpers for killing a process and
 * all of its descendants. Phase 3 (C-4) of the opencode-vs-autobot
 * gap plan.
 *
 * Why a dedicated module?
 *  - On POSIX, a child spawned with `detached: true` is a process
 *    group leader. We can send `SIGTERM` to the whole group via
 *    `process.kill(-pid, 'SIGTERM')` (the leading `-` is the
 *    "process group" convention).
 *  - On Windows, there is no process-group primitive in the Node
 *    API. We shell out to `taskkill /pid <pid> /T /F` which walks
 *    the child tree (`/T`) and force-kills (`/F`).
 *
 * SIGTERM is sent first so well-behaved programs can flush buffers
 * and write a final log line; SIGKILL is sent after a grace period
 * if the process is still alive. The 2-second grace is short
 * enough that an agent doesn't feel stuck but long enough for
 * `mvn install` to write its BUILD SUCCESS line.
 */
import { spawn } from 'node:child_process'
import { platform } from 'node:os'

const KILL_GRACE_MS = 2000

/**
 * Kill `child` and all of its descendants. Resolves once the kill
 * signal has been delivered (NOT once the process has actually
 * exited). Use `child.once('exit', ...)` if you need to wait for
 * full exit.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<void>}
 */
export function killProcessTree(child) {
  if (!child || child.killed || typeof child.pid !== 'number') {
    return Promise.resolve()
  }
  const pid = child.pid
  if (platform === 'win32') {
    return killWindows(pid)
  }
  return killPosix(pid)
}

function killPosix(pid) {
  return new Promise((resolve) => {
    // SIGTERM to the whole process group.
    try {
      process.kill(-pid, 'SIGTERM')
    } catch (err) {
      // ESRCH means the process is already gone — that's fine.
      if (err.code !== 'ESRCH') {
        // Fall back to direct kill of the leader.
        try { process.kill(pid, 'SIGTERM') } catch (_) {}
      }
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (err) {
        if (err.code !== 'ESRCH') {
          try { process.kill(pid, 'SIGKILL') } catch (_) {}
        }
      }
      resolve()
    }, KILL_GRACE_MS).unref?.()
  })
}

function killWindows(pid) {
  return new Promise((resolve) => {
    // /T = kill child tree, /F = force.
    // We use `spawn` (not `exec`) so we don't have to escape
    // cmd.exe shell metacharacters. `windowsHide: true` keeps the
    // console flash from appearing on the user's desktop.
    const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    tk.on('exit', () => resolve())
    tk.on('error', () => {
      // taskkill missing? Try TerminateProcess via a direct signal.
      try { process.kill(pid, 'SIGTERM') } catch (_) {}
      resolve()
    })
  })
}
