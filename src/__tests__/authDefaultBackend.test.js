import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUTH_JS = resolve(__dirname, '..', 'auth.js')

// We can't easily import auth.js in node:test without Vite (it reads
// `import.meta.env` at module load), so we verify the canonical
// default is present in the source. This guards against accidental
// changes to the unconfigured-default backend URL.
const src = readFileSync(AUTH_JS, 'utf8')

test('auth.js: canonical default backend host is http://120.26.113.95:8000', () => {
  assert.match(
    src,
    /DEFAULT_BACKEND_HOST\s*=\s*['"]http:\/\/120\.26\.113\.95:8000['"]/,
    'expected DEFAULT_BACKEND_HOST to be set to the canonical public URL'
  )
})

test('auth.js: smartDefaultBackendHost returns the default (no double-prefix)', () => {
  // The default is a fully-qualified URL; callers must NOT prefix
  // http:// on top of it.
  assert.match(src, /function\s+smartDefaultBackendHost\s*\(\s*\)\s*{\s*return\s+DEFAULT_BACKEND_HOST/)
})

test('auth.js: getSuggestedBackendHost does not double-prefix http://', () => {
  // The earlier version built `http://${smartDefaultBackendHost()}`
  // which produced "http://http://120.26.113.95:8000" once the
  // default became a full URL. Guard against regressing to that.
  assert.doesNotMatch(src, /http:\/\/\$\{smartDefaultBackendHost\(\)\}/)
  assert.match(src, /return\s+smartDefaultBackendHost\(\)/)
})
