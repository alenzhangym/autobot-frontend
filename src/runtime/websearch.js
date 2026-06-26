/**
 * websearch — multi-provider web search for LLM agents (Phase P-3 v4).
 *
 * <h3>Why a separate tool from webfetch?</h3>
 * <p>opencode exposes {@code websearch} and {@code webfetch} as two
 * distinct permission keys. websearch lets the LLM <i>find</i> URLs
 * ("latest Spring Boot release notes"), webfetch lets it <i>read</i>
 * a specific URL it already knows. They have different rate limits,
 * different outputs, and different cost models — so the runtime
 * permission should be enforced separately (see
 * {@link StepPermissionState#WEBFETCH} vs the new
 * {@code WEBSEARCH} action).</p>
 *
 * <h3>Providers</h3>
 * <ul>
 *   <li><b>bing</b> — Bing Web Search API v7 (Azure). Needs
 *       {@code BING_SEARCH_KEY}. Free tier: 1000 calls/month.</li>
 *   <li><b>duckduckgo</b> — Instant Answer API, no key required.
 *       Quality is lower but free and works out of the box.</li>
 *   <li><b>mock</b> — deterministic stub for tests / offline dev.</li>
 * </ul>
 *
 * <h3>Sandbox</h3>
 * <ul>
 *   <li>Query: trimmed, max 500 chars</li>
 *   <li>Result count: 1-20 (default 8)</li>
 *   <li>Per-result snippet: max 600 chars</li>
 *   <li>Total response: 1 MiB cap</li>
 *   <li>Timeout: 15s</li>
 * </ul>
 */
import { Readable } from 'node:stream'

const MAX_QUERY_LEN = 500
const MIN_RESULTS = 1
const MAX_RESULTS = 20
const MAX_SNIPPET_LEN = 600
const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 15_000

/**
 * @typedef {Object} SearchResult
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 * @property {string} [source]  provider that returned this hit
 */

/**
 * @typedef {Object} SearchResponse
 * @property {string} query
 * @property {SearchResult[]} results
 * @property {number} totalResults  totalResults reported by provider (may be 0)
 * @property {string} provider
 * @property {boolean} truncated
 */

/**
 * Run a web search.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.maxResults=8]  1..20
 * @param {string} [options.provider]      override env var
 * @param {string} [options.apiKey]        override env var
 * @returns {Promise<SearchResponse>}
 */
export async function websearch(query, options = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new WebsearchError('invalid_query', 'query must be non-empty string')
  }
  const q = query.trim()
  if (q.length > MAX_QUERY_LEN) {
    throw new WebsearchError('query_too_long',
      `query length ${q.length} exceeds max ${MAX_QUERY_LEN}`)
  }
  const maxResults = clamp(options.maxResults ?? 8, MIN_RESULTS, MAX_RESULTS)
  const provider = (options.provider || process.env.WEBSEARCH_PROVIDER || 'duckduckgo').toLowerCase()
  const apiKey = options.apiKey || process.env.BING_SEARCH_KEY

  let resp
  switch (provider) {
    case 'bing':     resp = await searchBing(q, maxResults, apiKey); break
    case 'duckduckgo': resp = await searchDuckDuckGo(q, maxResults); break
    case 'mock':     resp = searchMock(q, maxResults); break
    default: throw new WebsearchError('unknown_provider', `unknown provider: ${provider}`)
  }
  return resp
}

async function searchBing(query, maxResults, apiKey) {
  if (!apiKey) {
    throw new WebsearchError('missing_key', 'BING_SEARCH_KEY env var is required for provider=bing')
  }
  const url = new URL('https://api.bing.microsoft.com/v7.0/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(maxResults))
  url.searchParams.set('safeSearch', 'Moderate')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (err) {
    throw new WebsearchError('network_error', `bing fetch failed: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new WebsearchError('provider_error',
      `bing returned ${response.status}: ${text.slice(0, 200)}`)
  }
  const body = await readWithCap(response.body, MAX_BYTES)
  let json
  try { json = JSON.parse(body.text) } catch {
    throw new WebsearchError('bad_response', 'bing returned non-JSON body')
  }
  const hits = Array.isArray(json?.webPages?.value) ? json.webPages.value : []
  const results = hits.slice(0, maxResults).map((h) => ({
    title: truncate(String(h.name || ''), MAX_SNIPPET_LEN),
    url: String(h.url || ''),
    snippet: truncate(String(h.snippet || ''), MAX_SNIPPET_LEN),
    source: 'bing',
  }))
  return {
    query,
    results,
    totalResults: Number(json?.webPages?.totalEstimatedMatches ?? results.length),
    provider: 'bing',
    truncated: body.truncated,
  }
}

async function searchDuckDuckGo(query, maxResults) {
  // DuckDuckGo Instant Answer: https://api.duckduckgo.com/?q=...&format=json
  // Note: this is a "instant answer" endpoint, not a general web search.
  // Real deployments should use bing/serpapi; this is the "no key" fallback.
  const url = new URL('https://api.duckduckgo.com/')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_redirect', '1')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('skip_disambig', '1')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'User-Agent': 'autobot-websearch/1.0' },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (err) {
    throw new WebsearchError('network_error', `duckduckgo fetch failed: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new WebsearchError('provider_error', `duckduckgo returned ${response.status}`)
  }
  const body = await readWithCap(response.body, MAX_BYTES)
  let json
  try { json = JSON.parse(body.text) } catch {
    throw new WebsearchError('bad_response', 'duckduckgo returned non-JSON body')
  }
  const results = []
  if (json.AbstractURL && json.AbstractText) {
    results.push({
      title: truncate(String(json.Heading || query), MAX_SNIPPET_LEN),
      url: String(json.AbstractURL),
      snippet: truncate(String(json.AbstractText), MAX_SNIPPET_LEN),
      source: 'duckduckgo',
    })
  }
  const topics = Array.isArray(json.RelatedTopics) ? json.RelatedTopics : []
  for (const t of topics) {
    if (results.length >= maxResults) break
    if (t.FirstURL && t.Text) {
      results.push({
        title: truncate(String(t.Text).split(' - ')[0] || t.Text, MAX_SNIPPET_LEN),
        url: String(t.FirstURL),
        snippet: truncate(String(t.Text), MAX_SNIPPET_LEN),
        source: 'duckduckgo',
      })
    }
  }
  return {
    query,
    results,
    totalResults: results.length,
    provider: 'duckduckgo',
    truncated: body.truncated,
  }
}

function searchMock(query, maxResults) {
  // Deterministic stub for tests / offline dev. Always returns one hit
  // that echos the query.
  return {
    query,
    results: [{
      title: `Mock result for: ${query}`,
      url: `https://example.com/mock?q=${encodeURIComponent(query)}`,
      snippet: `This is a deterministic mock search result for query "${query}".`,
      source: 'mock',
    }],
    totalResults: 1,
    provider: 'mock',
    truncated: false,
  }
}

// ── 内部工具 ───────────────────────────────────────────────

async function readWithCap(stream, maxBytes) {
  if (!stream) return { text: '', truncated: false }
  const chunks = []
  let total = 0
  let truncated = false
  for await (const chunk of stream) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk)
    if (total + buf.length > maxBytes) {
      const allowed = maxBytes - total
      if (allowed > 0) chunks.push(buf.subarray(0, allowed))
      truncated = true
      break
    }
    chunks.push(buf)
    total += buf.length
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated }
}

function clamp(n, min, max) {
  if (typeof n !== 'number' || Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function truncate(s, max) {
  if (s.length <= max) return s
  return s.slice(0, max - 3) + '...'
}

export class WebsearchError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WebsearchError'
    this.code = code
  }
}
