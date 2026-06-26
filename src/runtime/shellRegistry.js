/**
 * shellRegistry — a small id → PersistentShell map.
 *
 * <p>Phase 1 contract:</p>
 * <ul>
 *   <li>{@link getOrCreate} lazily creates a shell on first use; subsequent
 *       calls with the same id return the same instance (so cwd/env
 *       persist across HTTP requests).</li>
 *   <li>{@link get} returns the existing shell or {@code null}.</li>
 *   <li>{@link kill} terminates and removes.</li>
 *   <li>{@link killAll} is called by server.js on SIGINT/SIGTERM to clean
 *       up before exit.</li>
 *   <li>{@link list} returns a snapshot of all live shells for diagnostics.</li>
 * </ul>
 *
 * <p>Phase 3 will add a TTL/LRU eviction policy here (idle shells past N
 * minutes get killed). For now the registry is unbounded — fine for a dev
 * tool with one operator.</p>
 */
import { PersistentShell } from './PersistentShell.js'
import { randomUUID } from 'crypto'

const SHELLS = new Map() // id → PersistentShell

/**
 * Get an existing shell or create a new one. If {@code id} is omitted a
 * fresh UUID is allocated.
 *
 * @param {object} [opts]
 * @param {string} [opts.id] - Shell id (UUID recommended). Auto-generated if absent.
 * @param {string} [opts.cwd] - Used only when creating a new shell.
 * @param {object} [opts.env] - Used only when creating a new shell.
 * @param {string} [opts.shellPath] - Used only when creating a new shell.
 * @returns {{shell: PersistentShell, created: boolean}}
 */
export function getOrCreate(opts = {}) {
  const id = opts.id || randomUUID()
  if (SHELLS.has(id)) {
    const existing = SHELLS.get(id)
    if (existing.alive) {
      return { shell: existing, created: false }
    }
    // Dead — drop and recreate
    SHELLS.delete(id)
  }
  const shell = new PersistentShell({ ...opts, id })
  SHELLS.set(id, shell)
  return { shell, created: true }
}

export function get(id) {
  const shell = SHELLS.get(id)
  return shell && shell.alive ? shell : null
}

export function kill(id) {
  const shell = SHELLS.get(id)
  if (shell) {
    shell.kill()
    SHELLS.delete(id)
    return true
  }
  return false
}

export function list() {
  return Array.from(SHELLS.values())
    .filter((s) => s.alive)
    .map((s) => s.describe())
}

export function killAll() {
  for (const shell of SHELLS.values()) {
    try { shell.kill() } catch (_) {}
  }
  SHELLS.clear()
}

// Test-only hook: wipe the registry between unit tests. Not exported in
// the public API surface; guarded by NODE_ENV to avoid prod use.
export function _resetForTests() {
  if (process.env.NODE_ENV === 'test') {
    killAll()
  }
}
