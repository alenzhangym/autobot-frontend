/**
 * questionQueue — a tiny in-memory FIFO for questions the LLM
 * wants to ask the user. Phase 4 (C-8) of the opencode-vs-autobot
 * gap plan.
 *
 * <h3>Why not WebSocket?</h3>
 * <p>The Java backend already has a richer "awaiter" mechanism for
 * long-running prompts (e.g. confirmation dialogs). This queue is
 * the frontend-side primitive the autobot-frontend can poll while
 * the long-term goal is to wire it into the existing channel. For
 * v1, the frontend can `GET /api/local/questions/pending` every
 * second and pop questions off as they arrive.</p>
 *
 * <h3>Lifecycle</h3>
 * <ol>
 *   <li>LLM calls `POST /api/local/question` → entry created with
 *       status `pending`.</li>
 *   <li>Frontend polls `GET /api/local/questions/pending` and shows
 *       a dialog.</li>
 *   <li>User answers; frontend posts to
 *       `POST /api/local/questions/:id/answer`.</li>
 *   <li>LLM (or whoever owns the awaiting future) reads the answer
 *       via `get(id)` and resumes.</li>
 * </ol>
 *
 * Each entry has a TTL (default 5 minutes) so abandoned questions
 * don't pile up forever.
 */
import { randomUUID } from 'node:crypto'

const TTL_MS = 5 * 60 * 1000
const QUESTIONS = new Map()

/**
 * @typedef {Object} Question
 * @property {string} id
 * @property {string} question
 * @property {string[]} [options]   Pre-defined options if multi-choice.
 * @property {string} [default]     Default option id.
 * @property {number} createdAt
 * @property {number} [answeredAt]
 * @property {string} [answer]
 * @property {string} status        'pending' | 'answered' | 'expired'
 * @property {string} [header]      Optional short label, e.g. "Auth choice"
 */

/**
 * Create a new pending question.
 * @param {Object} opts
 * @param {string} opts.question
 * @param {string[]} [opts.options]
 * @param {string} [opts.default]
 * @param {string} [opts.header]
 * @returns {Question}
 */
export function create(opts) {
  if (typeof opts.question !== 'string' || !opts.question.trim()) {
    throw new Error('question is required')
  }
  const id = randomUUID()
  /** @type {Question} */
  const q = {
    id,
    question: opts.question,
    options: Array.isArray(opts.options) ? opts.options : undefined,
    default: opts.default,
    header: opts.header,
    createdAt: Date.now(),
    status: 'pending',
  }
  QUESTIONS.set(id, q)
  setTimeout(() => expire(id), TTL_MS).unref?.()
  return q
}

/** @param {string} id */
export function get(id) {
  const q = QUESTIONS.get(id)
  return q ? { ...q } : null
}

/** @returns {Question[]} */
export function listPending() {
  return Array.from(QUESTIONS.values())
    .filter((q) => q.status === 'pending')
    .map((q) => ({ ...q }))
}

/** @returns {Question[]} */
export function listAll() {
  return Array.from(QUESTIONS.values()).map((q) => ({ ...q }))
}

/**
 * Answer a question. Returns the updated question, or `null` if
 * not found / already answered / expired.
 *
 * @param {string} id
 * @param {string} answer
 */
export function answer(id, answerText) {
  const q = QUESTIONS.get(id)
  if (!q) return null
  if (q.status !== 'pending') return null
  q.answer = String(answerText)
  q.answeredAt = Date.now()
  q.status = 'answered'
  return { ...q }
}

function expire(id) {
  const q = QUESTIONS.get(id)
  if (q && q.status === 'pending') {
    q.status = 'expired'
  }
}

/** Test-only: wipe the queue. Not exposed via the server endpoint. */
export function _clear() {
  QUESTIONS.clear()
}
