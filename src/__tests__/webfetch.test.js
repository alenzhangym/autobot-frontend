/**
 * Phase 4 (C-6) tests for webfetch + stripHtml.
 *
 * Uses a tiny in-process HTTP server as the fetch target so we
 * don't depend on the network and can control content-type, size,
 * and slow responses.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { webfetch, stripHtml, WebfetchError } from '../runtime/webfetch.js'

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

describe('webfetch: URL sandboxing', () => {
  test('rejects non-http schemes', async () => {
    await assert.rejects(
      () => webfetch('file:///etc/passwd'),
      (err) => err instanceof WebfetchError && err.code === 'invalid_url'
    )
    await assert.rejects(
      () => webfetch('ftp://example.com/foo'),
      (err) => err instanceof WebfetchError && err.code === 'invalid_url'
    )
  })

  test('rejects malformed URLs', async () => {
    await assert.rejects(
      () => webfetch('not a url'),
      (err) => err instanceof WebfetchError && err.code === 'invalid_url'
    )
  })
})

describe('webfetch: fetching real (in-process) URLs', () => {
  let server, port
  before(async () => {
    const started = await startServer((req, res) => {
      if (req.url === '/json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ hello: 'world' }))
        return
      }
      if (req.url === '/html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html><head><title>T</title></head><body><h1>Hi</h1><p>Hello <b>world</b>!</p><script>alert(1)</script></body></html>')
        return
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '10485760' })
        res.end('too big')
        return
      }
      if (req.url === '/notfound') {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('nope')
        return
      }
      res.writeHead(500).end('unknown')
    })
    server = started.server
    port = started.port
  })

  after(async () => {
    if (server) await new Promise((r) => server.close(() => r()))
  })

  test('fetches JSON and returns status + body', async () => {
    const r = await webfetch(`http://127.0.0.1:${port}/json`)
    assert.equal(r.status, 200)
    assert.match(r.contentType, /json/)
    assert.match(r.body, /hello/)
  })

  test('fetches HTML and strips tags', async () => {
    const r = await webfetch(`http://127.0.0.1:${port}/html`)
    assert.equal(r.status, 200)
    assert.match(r.body, /Hi/)
    assert.match(r.body, /Hello world/)
    assert.doesNotMatch(r.body, /<script/)
    assert.doesNotMatch(r.body, /<b>/)
  })

  test('rejects oversize content via Content-Length', async () => {
    await assert.rejects(
      () => webfetch(`http://127.0.0.1:${port}/big`),
      (err) => err instanceof WebfetchError && err.code === 'too_large'
    )
  })

  test('returns the body for 4xx responses (does not throw)', async () => {
    const r = await webfetch(`http://127.0.0.1:${port}/notfound`)
    assert.equal(r.status, 404)
    assert.match(r.body, /nope/)
  })
})

describe('stripHtml', () => {
  test('removes tags and keeps text', () => {
    assert.equal(stripHtml('<p>hello <b>world</b></p>').trim(), 'hello world')
  })

  test('removes script and style blocks entirely', () => {
    const s = stripHtml('<style>body{color:red}</style><p>ok</p><script>alert(1)</script>')
    assert.doesNotMatch(s, /color:red/)
    assert.doesNotMatch(s, /alert\(1\)/)
    assert.match(s, /ok/)
  })

  test('decodes common entities', () => {
    const s = stripHtml('<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot;</p>')
    assert.match(s, /Tom & Jerry <3 "cheese"/)
  })

  test('inserts newlines for block-level closing tags', () => {
    const s = stripHtml('<p>a</p><p>b</p>')
    assert.equal(s.trim(), 'a\nb')
  })
})
