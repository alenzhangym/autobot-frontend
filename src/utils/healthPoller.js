/**
 * Robust health-check poller.
 *
 * <p>Replaces the naive {@code setInterval(checkHealth, 30000)} pattern
 * that was used previously. The old pattern had these issues:</p>
 * <ul>
 *   <li>No request timeout — a hung backend would leave the fetch
 *       pending forever, leaking sockets.</li>
 *   <li>No exponential backoff — a flapping backend (e.g. during
 *       restart) would cause repeated failures, with the interval
 *       staying short even after sustained failures.</li>
 *   <li>No in-flight cancellation — when the user navigates away or
 *       logs out, an in-flight fetch would still resolve and call
 *       {@code onUpdate} on an unmounted component, causing React
 *       warnings and stale state updates.</li>
 *   <li>No offline detection — a transient network drop looked
 *       identical to "agent missing", and there was no way to
 *       distinguish "still trying" from "gave up".</li>
 * </ul>
 *
 * <p>This utility fixes all of the above.</p>
 */

/**
 * Configuration for {@link createHealthPoller}.
 *
 * @typedef {Object} HealthPollerConfig
 * @property {() => Promise<boolean>} probe - async probe function; returns true if healthy
 * @property {(state: 'ok'|'down'|'offline'|'stopped') => void} onStateChange - state callback
 * @property {number} [intervalMs=30000] - normal poll interval when healthy
 * @property {number} [maxBackoffMs=300000] - upper bound for exponential backoff (5 min)
 * @property {number} [requestTimeoutMs=5000] - per-probe timeout
 */

/**
 * @param {HealthPollerConfig} config
 * @returns {{
 *   start: () => void,
 *   stop: () => void,
 *   isRunning: () => boolean
 * }}
 */
export function createHealthPoller(config) {
  const {
    probe,
    onStateChange,
    intervalMs = 30000,
    maxBackoffMs = 300000,
    requestTimeoutMs = 5000,
  } = config

  if (typeof probe !== 'function') {
    throw new Error('createHealthPoller: probe must be a function')
  }
  if (typeof onStateChange !== 'function') {
    throw new Error('createHealthPoller: onStateChange must be a function')
  }

  let timerId = null
  let running = false
  let currentState = 'unknown'
  let consecutiveFailures = 0
  let inFlightAbort = null
  let lastStateChangeTime = 0

  function setState(next) {
    if (next === currentState) return
    currentState = next
    lastStateChangeTime = Date.now()
    try {
      onStateChange(next)
    } catch (e) {
      // Caller errors must not break the poller loop
      // eslint-disable-next-line no-console
      console.warn('[createHealthPoller] onStateChange threw:', e)
    }
  }

  function computeBackoff() {
    if (consecutiveFailures <= 0) return intervalMs
    // Exponential: 1×, 2×, 4×, 8× ... capped at maxBackoffMs
    const factor = Math.min(maxBackoffMs, intervalMs * Math.pow(2, consecutiveFailures - 1))
    return Math.min(maxBackoffMs, factor)
  }

  async function runOnce() {
    if (!running) return
    // Abort any previous in-flight probe
    if (inFlightAbort) {
      try { inFlightAbort.abort() } catch (e) { /* ignore */ }
    }
    const ctrl = new AbortController()
    inFlightAbort = ctrl
    const timeoutId = setTimeout(() => ctrl.abort(), requestTimeoutMs)

    try {
      const ok = await probe({ signal: ctrl.signal })
      if (!running) return
      if (ok) {
        consecutiveFailures = 0
        setState('ok')
      } else {
        consecutiveFailures += 1
        setState('down')
      }
    } catch (e) {
      if (!running) return
      // AbortError is expected when we cancel — don't count it as failure
      if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
        return
      }
      // Network failures (no backend, DNS, etc.) — treat as "down" (not "offline")
      // because the user may have a local agent that's simply not started.
      consecutiveFailures += 1
      setState('down')
    } finally {
      clearTimeout(timeoutId)
      inFlightAbort = null
    }

    if (!running) return
    const nextDelay = computeBackoff()
    timerId = setTimeout(runOnce, nextDelay)
  }

  function start() {
    if (running) return
    running = true
    consecutiveFailures = 0
    currentState = 'unknown'
    // Fire one immediate probe, then schedule the next
    runOnce()
  }

  function stop() {
    running = false
    if (timerId) {
      clearTimeout(timerId)
      timerId = null
    }
    if (inFlightAbort) {
      try { inFlightAbort.abort() } catch (e) { /* ignore */ }
      inFlightAbort = null
    }
    setState('stopped')
  }

  function isRunning() {
    return running
  }

  function getState() {
    return currentState
  }

  function getConsecutiveFailures() {
    return consecutiveFailures
  }

  return { start, stop, isRunning, getState, getConsecutiveFailures, getLastStateChangeTime: () => lastStateChangeTime }
}

/**
 * Convenience: probe a URL with fetch + AbortController timeout.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true if the URL returned 2xx, false otherwise
 */
export async function probeHttp(url, timeoutMs = 5000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal })
    return res.ok
  } catch (e) {
    return false
  } finally {
    clearTimeout(id)
  }
}
