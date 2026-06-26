/**
 * webfetch — HTTP GET with HTML→text conversion and safety caps.
 * Phase 4 (C-6) of the opencode-vs-autobot gap plan.
 *
 * <h3>Why not just `fetch`?</h3>
 * <p>LLM-callable web fetch needs more than a thin wrapper around
 * `node:fetch`: the URL must be checked for `http(s)://` scheme, the
 * response body must be capped (an LLM that asks us to fetch a 4 GB
 * log file would otherwise exhaust the server's memory), and HTML
 * needs to be stripped down to readable text. This module does all
 * three.</p>
 *
 * <h3>Sandbox</h3>
 * <ul>
 *   <li>Scheme: `http` / `https` only. `file://`, `data:`, `ftp://` and
 *       anything else is rejected.</li>
 *   <li>Size: 5 MiB hard cap. We trust the `Content-Length` header
 *       when present and short-circuit before reading; otherwise we
 *       truncate the stream as it comes in.</li>
 *   <li>Timeout: 30s. The server endpoint may also enforce a global
 *       timeout but we want a sane fallback.</li>
 * </ul>
 */
import { Readable } from 'node:stream'

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 30_000

/**
 * Fetch a URL and return the body as text.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.selector]  Reserved for future CSS-selector
 *   filtering; not implemented in v1.
 * @param {number} [options.maxBytes]  Override the default 5 MiB cap.
 * @returns {Promise<{ url: string, finalUrl: string, status: number,
 *   contentType: string, body: string, truncated: boolean }>}
 */
export async function webfetch(url, options = {}) {
  const parsed = safeParseUrl(url)
  if (!parsed) {
    throw new WebfetchError('invalid_url', `URL must be http(s): ${url}`)
  }
  const maxBytes = options.maxBytes || MAX_BYTES
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  try {
    response = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'autobot-webfetch/1.0' },
    })
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new WebfetchError('timeout', `fetch exceeded ${TIMEOUT_MS}ms`)
    }
    throw new WebfetchError('network_error', err.message)
  }
  // Pre-flight size check
  const cl = response.headers.get('content-length')
  if (cl && Number(cl) > maxBytes) {
    clearTimeout(timer)
    response.body?.cancel?.()
    throw new WebfetchError('too_large', `Content-Length ${cl} exceeds ${maxBytes}`)
  }
  const contentType = response.headers.get('content-type') || ''
  const body = await readWithCap(response.body, maxBytes)
  clearTimeout(timer)
  const truncated = body.truncated
  const text = contentType.includes('html') ? stripHtml(body.text) : body.text
  return {
    url: parsed.toString(),
    finalUrl: response.url || parsed.toString(),
    status: response.status,
    contentType,
    body: text,
    truncated,
  }
}

export class WebfetchError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WebfetchError'
    this.code = code
  }
}

function safeParseUrl(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u
  } catch {
    return null
  }
}

async function readWithCap(stream, maxBytes) {
  if (!stream) return { text: '', truncated: false }
  const reader = stream.getReader()
  const chunks = []
  let received = 0
  let truncated = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        // Take the part of `value` that fits, then stop.
        const remaining = maxBytes - (received - value.byteLength)
        if (remaining > 0) {
          chunks.push(Buffer.from(value.buffer, value.byteOffset, remaining))
        }
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
  } finally {
    reader.releaseLock()
  }
  return {
    text: Buffer.concat(chunks).toString('utf8'),
    truncated,
  }
}

/**
 * Strip HTML tags and collapse whitespace. Not a full parser — we
 * only need something good enough for the LLM to read.
 *
 *   stripHtml('<p>hello <b>world</b>!</p>')  // → 'hello world!'
 */
export function stripHtml(html) {
  // Remove script/style blocks first so their content (e.g. CSS with
  // `>` characters) doesn't get treated as tags.
  let s = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // Replace block-level closing tags with newlines so paragraphs
  // don't all run together.
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|br|hr)>/gi, '\n')
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, '')
  // Decode the most common entities; the rest pass through literally.
  s = s.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  // Collapse runs of whitespace within a line, but keep newlines.
  s = s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
  return s
}
