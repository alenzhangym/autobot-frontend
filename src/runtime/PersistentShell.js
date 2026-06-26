/**
 * PersistentShell — long-lived, stateful command executor.
 *
 * <h3>Design</h3>
 * <p>This class gives the LLM the <em>illusion</em> of a single long-lived
 * shell: cwd and environment variables that the user mutates
 * ({@code cd /opt/proj}, {@code export FOO=bar},
 * {@code set FOO=bar & rem windows}) persist for subsequent calls in
 * the same session.</p>
 *
 * <p>Under the hood each {@link exec} call spawns a fresh child process
 * with the current tracked {@code cwd} and {@code env} passed in. After
 * the child exits, we heuristically parse the command line and update
 * our internal state (e.g. {@code cd /opt/proj} → set cwd to
 * {@code /opt/proj}). This is the same approach opencode uses for
 * cross-platform "stateful" shells; the alternative — keeping one
 * process alive and writing commands to its stdin — is fragile on
 * Windows (cmd.exe, PowerShell) and brings process-tree management
 * complexity that we defer to Phase 3 (background tasks, C-3+C-4).</p>
 *
 * <h3>Concurrency</h3>
 * <p>Commands are serialized through a FIFO queue. A long-running command
 * (e.g. {@code mvn install}) blocks subsequent ones on the same shell —
 * this matches the user's mental model of "I started a build, now I want
 * to wait for it". For true parallel work, callers should use distinct
 * shell ids.</p>
 *
 * <h3>Safety</h3>
 * <p>No built-in safety: the server endpoint is the trust boundary, and
 * it relies on the Java backend to have already gated the command via
 * the frontend's {@code agentCommandSafety} dialog. Phase 2 will add
 * AST-level analysis here.</p>
 */
import { execFile } from 'child_process'
import os from 'os'
import path from 'path'

function pathResolve(p, base) {
  if (!p) return base || process.cwd()
  return base ? path.resolve(base, p) : path.resolve(p)
}

export function resolveCwd(p, base) {
  return pathResolve(p, base)
}

function defaultShell() {
  if (process.env.AUTOBOT_PREFERRED_SHELL) {
    return process.env.AUTOBOT_PREFERRED_SHELL
  }
  if (os.platform() === 'win32') {
    return process.env.AUTOBOT_BASH_PATH
      || 'C:\\Program Files\\Git\\bin\\bash.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 600_000 // 10 min
const MAX_BUFFER_BYTES = 2 * 1024 * 1024

export class PersistentShell {
  /**
   * @param {object} opts
   * @param {string} opts.id - Stable shell id (UUID recommended).
   * @param {string} [opts.cwd] - Initial working directory.
   * @param {object} [opts.env] - Extra env vars merged on top of process.env.
   * @param {string} [opts.shellPath] - Override the shell binary.
   */
  constructor({ id, cwd, env = {}, shellPath } = {}) {
    if (!id) throw new Error('PersistentShell: id is required')
    this.id = id
    this.cwd = cwd ? pathResolve(cwd) : process.cwd()
    this.env = { ...process.env, ...env }
    this.shellPath = shellPath || defaultShell()
    this.alive = true
    this.startedAt = Date.now()
    this.commandCount = 0
    this.queue = []
    this.running = false
    this.lastError = null
  }

  /**
   * Execute a command string. Resolves with captured stdout/stderr,
   * elapsed time, and a {@code timedOut} flag if the timeout fired.
   *
   * @param {string} command
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<{status: string, exitCode: number|null, stdout: string, stderr: string, timedOut: boolean, durationMs: number}>}
   */
  exec(command, opts = {}) {
    if (!this.alive) {
      return Promise.reject(new Error(this.lastError || 'Shell not alive'))
    }
    const timeoutMs = Math.max(
      1000,
      Math.min(MAX_TIMEOUT_MS, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS)
    )
    return new Promise((resolve, reject) => {
      this.queue.push({ command, timeoutMs, resolve, reject })
      this._drain()
    })
  }

  _drain() {
    if (this.running) return
    if (this.queue.length === 0) return
    this.running = true
    const job = this.queue.shift()
    this._execOne(job)
      .then((result) => job.resolve(result))
      .catch((err) => job.reject(err))
      .finally(() => {
        this.running = false
        this._drain()
      })
  }

  _execOne({ command, timeoutMs }) {
    const startedAt = Date.now()
    this.commandCount += 1
    return new Promise((resolve) => {
      // We wrap the user command so we can discover the real cwd that
      // bash ended up in. The `cd "$PWD" >/dev/null 2>&1` re-asserts our
      // tracked cwd in case the user command left the shell somewhere
      // we don't expect (e.g. `cd` failed and we kept the old value).
      // The `__AUTOBOT_CWD__<path>__` line is the only way to know
      // where bash actually is, because `$TEMP` and other variables
      // are expanded by bash, not by our JS state tracker.
      const wrapped = `cd "${this.cwd.replace(/"/g, '\\"')}" >/dev/null 2>&1 || true; ${command}; __autobot_pwd=$(pwd -W 2>/dev/null || pwd); printf '\\n__AUTOBOT_CWD__%s__\\n' "$__autobot_pwd"`
      const child = execFile(this.shellPath, ['-c', wrapped], {
        cwd: this.cwd,
        env: this.env,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        const elapsed = Date.now() - startedAt
        let status = 'success'
        let exitCode = 0
        let timedOut = false
        if (error) {
          // execFile surfaces timeouts as an error with `killed=true` and
          // `signal='SIGTERM'` on POSIX. On Windows the shape is different:
          // the child may be killed via a non-SIGTERM mechanism and the
          // `code` field can be a string like 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          // or null. We treat any error where `killed` is true OR
          // `elapsed >= timeoutMs` (within 10% slack) as a timeout.
          const elapsedNearTimeout = elapsed >= timeoutMs * 0.9
          if (error.killed || error.signal === 'SIGTERM' || elapsedNearTimeout) {
            status = 'timeout'
            timedOut = true
            exitCode = null
          } else {
            status = 'error'
            exitCode = typeof error.code === 'number' ? error.code : 1
          }
        }
        // Parse the cwd sentinel from stdout and update tracked cwd.
        const cwdSentinelMatch = (stdout || '').match(/__AUTOBOT_CWD__([^\r\n]*)__/)
        if (cwdSentinelMatch) {
          const discovered = cwdSentinelMatch[1].trim()
          if (discovered) {
            this.cwd = discovered
          }
        }
        // Update tracked env from the command (heuristic; literal values only).
        this._absorbStateChange(command)
        // Strip the cwd sentinel line from the user-visible stdout
        const cleanStdout = (stdout || '').replace(/\n?__AUTOBOT_CWD__[^\r\n]*__\n?/, '')
        resolve({
          status,
          exitCode,
          stdout: cleanStdout,
          stderr: stderr || '',
          timedOut,
          durationMs: elapsed,
        })
      })
      child.on('error', (err) => {
        // ENOENT means the shell binary is missing
        this.alive = false
        this.lastError = err.message
        resolve({
          status: 'error',
          exitCode: null,
          stdout: '',
          stderr: err.message,
          timedOut: false,
          durationMs: Date.now() - startedAt,
        })
      })
    })
  }

  /**
   * Heuristically update the tracked env from a command. Cwd is NOT
   * updated here — it is captured via the {@code __AUTOBOT_CWD__}
   * sentinel that the wrapper script appends to each command. Updating
   * cwd by parsing the command string fails for cases like
   * {@code cd "$TEMP"} where the path contains a variable that only
   * bash can expand.
   *
   * Supported patterns (literal value only — variable references like
   * {@code $FOO} in the value are ignored to avoid double-tracking):
   *   export FOO=bar       → set env FOO=bar
   *   FOO=bar cmd          → set env FOO=bar
   *   set FOO=bar          (cmd.exe)  → set env FOO=bar
   *
   * Anything else: state unchanged.
   */
  _absorbStateChange(command) {
    const trimmed = command.trim()
    if (!trimmed) return

    // export FOO=bar  (bash) or  FOO=bar cmd  (inline env)
    // Only accept literal values — no $VAR expansion, no $(...), no backticks.
    const exportMatch = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(['"]?)([^$'"\s]*)\2(?:\s+(.*))?$/)
    if (exportMatch) {
      this.env[exportMatch[1]] = exportMatch[3]
      return
    }

    // set FOO=bar  (cmd.exe / Git Bash on Windows)
    const setMatch = trimmed.match(/^set\s+([A-Za-z_][A-Za-z0-9_]*)=(['"]?)([^$'"\s]*)\2\s*$/i)
    if (setMatch) {
      this.env[setMatch[1]] = setMatch[3]
      return
    }
  }

  /**
   * Kill the shell. For the stateful design this just marks the shell
   * as no longer accepting commands; it does NOT kill any background
   * process the user may have started (Phase 3 will add tracking).
   */
  kill() {
    this.alive = false
  }

  describe() {
    return {
      id: this.id,
      cwd: this.cwd,
      alive: this.alive,
      startedAt: this.startedAt,
      commandCount: this.commandCount,
      queued: this.queue.length,
      running: this.running,
      lastError: this.lastError,
      shellPath: this.shellPath,
    }
  }
}
