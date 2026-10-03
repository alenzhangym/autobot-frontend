/**
 * [B·ii] How long the browser should wait before answering a `proc_status` re-look.
 *
 * The backend's run-acceptance leg needs the *process log* to judge whether the
 * service came up, but a cold start (mvn compiling 56 sources + a Spring context)
 * takes tens of seconds. Answering immediately can only ever return an empty
 * `stdout_tail` — and a budget counted in round-trips then judges the leg dead
 * while the process is still being born (2026-10-03: three re-looks spanned 4.1s,
 * the process reported a compilation error at 5.8s).
 *
 * The wait lives here, on the machine that owns the process, so the server never
 * sleeps on a worker thread for it. Bounds are a hard ceiling, not a suggestion:
 * an adversarial/buggy `wait_ms` must not park a browser tab indefinitely.
 */

export const MAX_WAIT_MS = 60000

/**
 * @param {unknown} raw value of `cmd.wait_ms` (may be absent, a string, negative, NaN)
 * @returns {number} milliseconds to wait, clamped to `[0, MAX_WAIT_MS]`; unusable → 0
 */
export function clampWaitMs(raw) {
  if (raw === undefined || raw === null || raw === '') return 0
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_WAIT_MS, Math.floor(n))
}
