/**
 * todoStore — in-memory TODO list with simple status transitions.
 * Phase 4 (C-8) of the opencode-vs-autobot gap plan.
 *
 * <h3>Why in-memory?</h3>
 * <p>TODOs are scratch space for a single LLM session. They are not
 * durable state — the agent's plan in the Java backend is the
 * authoritative record. This store exists so the LLM can call
 * `todowrite` to maintain a working checklist that the UI can show
 * next to the agent's stream.</p>
 *
 * <h3>API</h3>
 * <ul>
 *   <li>{@link write} — replace the list (idempotent)</li>
 *   <li>{@link read} — get the current list</li>
 *   <li>{@link updateItem} — patch a single item by id</li>
 *   <li>{@link clear} — wipe the list (e.g. on agent switch)</li>
 * </ul>
 *
 * Items have the shape `{ id, content, status, priority? }`. Status
 * is one of `pending` | `in_progress` | `completed` | `cancelled`.
 */

const VALID_STATUS = new Set(['pending', 'in_progress', 'completed', 'cancelled'])

/** @type {{ items: any[], updatedAt: number }} */
let STATE = { items: [], updatedAt: 0 }

/**
 * Replace the entire TODO list. Items missing an `id` get one
 * assigned. Unknown statuses are coerced to `pending`.
 *
 * @param {Array<{ id?: string, content: string, status?: string, priority?: string }>} items
 * @returns {{ items: any[], updatedAt: number }}
 */
export function write(items) {
  if (!Array.isArray(items)) {
    throw new Error('items must be an array')
  }
  const out = items.map((it, idx) => {
    if (typeof it.content !== 'string' || !it.content) {
      throw new Error(`item[${idx}].content is required`)
    }
    const status = VALID_STATUS.has(it.status) ? it.status : 'pending'
    return {
      id: it.id || `todo-${idx}-${Date.now()}`,
      content: it.content,
      status,
      priority: it.priority || 'normal',
    }
  })
  STATE = { items: out, updatedAt: Date.now() }
  return { ...STATE }
}

/** @returns {{ items: any[], updatedAt: number }} */
export function read() {
  return { ...STATE, items: [...STATE.items] }
}

/**
 * Update a single item by id. Returns the new state, or `null` if
 * no such item exists.
 *
 * @param {string} id
 * @param {object} patch  `{ status?, content?, priority? }`
 */
export function updateItem(id, patch) {
  const items = STATE.items.map((it) => {
    if (it.id !== id) return it
    const merged = { ...it, ...patch }
    if (patch.status && !VALID_STATUS.has(patch.status)) {
      throw new Error(`invalid status: ${patch.status}`)
    }
    return merged
  })
  if (!items.some((it) => it.id === id)) return null
  STATE = { items, updatedAt: Date.now() }
  return { ...STATE, items: [...STATE.items] }
}

export function clear() {
  STATE = { items: [], updatedAt: Date.now() }
  return { ...STATE }
}

/** Test-only: reset module state. Not exposed via the server endpoint. */
export function _clear() {
  STATE = { items: [], updatedAt: 0 }
}
