/**
 * [后端地址解析] 2026-10-30 事故("设置了 backend_host=http://127.0.0.1:8000 却没生效")的回归用例。
 *
 * 现场证据(本机 java-backend/logs/backend.log): 同一个页面里 `/api/skills` 打到了本机、
 * `/api/chat` 却一条都没到; 本机只留下 `AuthInterceptor - Missing or invalid Authorization header`
 * 和 `[WS] invalid token` —— 浏览器拿着**另一个后端**签发的 token 在打本机。
 *
 * 成因: 后端地址的解析散落在 4 处, fallback 各不相同(auth.js 的远端默认 / helpers.jsx iframe bridge
 * 只读 `window.parent.localStorage` / helpers.jsx 抓 data-store 用 `hostname:8000` 且不带协议 /
 * App.jsx 的更新下载又一套 `hostname:8000`)。
 *
 * 这一轮把解析收敛到 `src/backendHost.js`(纯函数, 不读 DOM, 所以本用例是**真 import 真跑**),
 * 并逐字读前端真源, 钉住"不许再出现第二套 fallback"。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_BACKEND_HOST,
  apiBaseUrlFromHost,
  normalizeBackendHost,
  resolveBackendHost,
  sameOriginBackendHost,
  wsBaseUrlFromHost,
} from '../backendHost.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..')

describe('归一化: 用户输什么都会变成合法的 http(s)://host', () => {
  test('缺协议补 http://, 去尾部斜杠, 去空白', () => {
    assert.equal(normalizeBackendHost('127.0.0.1:8000'), 'http://127.0.0.1:8000')
    assert.equal(normalizeBackendHost('  http://127.0.0.1:8000/  '), 'http://127.0.0.1:8000')
    assert.equal(normalizeBackendHost('https://example.com/'), 'https://example.com')
  })

  test('空值/缺省返回空串, 让调用方知道"用户没配"', () => {
    assert.equal(normalizeBackendHost(''), '')
    assert.equal(normalizeBackendHost('   '), '')
    assert.equal(normalizeBackendHost(null), '')
    assert.equal(normalizeBackendHost(undefined), '')
  })
})

describe('解析优先级: 用户保存值 → 构建期 env → 同源(:8000) → 远端默认', () => {
  test('已保存值最高优先(且会被归一化)', () => {
    assert.equal(
      resolveBackendHost({ stored: '127.0.0.1:8000', env: 'http://env-host:9999' }),
      'http://127.0.0.1:8000'
    )
  })

  test('没保存时用 VITE_BACKEND_HOST', () => {
    assert.equal(resolveBackendHost({ stored: '', env: 'http://env-host:9999' }), 'http://env-host:9999')
  })

  test('由后端自己服务的页面(端口 8000)默认同源', () => {
    assert.equal(
      sameOriginBackendHost({ protocol: 'http:', hostname: '127.0.0.1', port: '8000' }),
      'http://127.0.0.1:8000'
    )
    assert.equal(
      resolveBackendHost({ location: { protocol: 'http:', hostname: '127.0.0.1', port: '8000' } }),
      'http://127.0.0.1:8000'
    )
  })

  test('3000 / 5173 的页面仍按安装说明走远端默认(不动其它部署形态)', () => {
    assert.equal(sameOriginBackendHost({ protocol: 'http:', hostname: 'localhost', port: '3000' }), '')
    assert.equal(
      resolveBackendHost({ location: { protocol: 'http:', hostname: 'localhost', port: '3000' } }),
      DEFAULT_BACKEND_HOST
    )
    assert.equal(
      resolveBackendHost({ location: { protocol: 'http:', hostname: 'localhost', port: '5173' } }),
      DEFAULT_BACKEND_HOST
    )
  })

  test('未配置时默认地址就是公网那台', () => {
    assert.equal(DEFAULT_BACKEND_HOST, 'http://120.26.113.95:8000')
    assert.equal(resolveBackendHost({}), DEFAULT_BACKEND_HOST)
  })
})

describe('派生: api / ws 基址必须与 host 同源', () => {
  test('没有协议也不会拼出非法 URL(历史 bug: "127.0.0.1:8000/api")', () => {
    assert.equal(apiBaseUrlFromHost('127.0.0.1:8000'), 'http://127.0.0.1:8000/api')
    assert.equal(apiBaseUrlFromHost('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000/api')
  })

  test('ws 基址与 http 基址是同一台机器', () => {
    assert.equal(wsBaseUrlFromHost('http://127.0.0.1:8000'), 'ws://127.0.0.1:8000')
    assert.equal(wsBaseUrlFromHost('https://example.com'), 'ws://example.com')
  })
})

describe('不许再有第二套 host fallback(逐字读前端真源)', () => {
  const appSrc = readFileSync(resolve(SRC, 'App.jsx'), 'utf8')
  const helpersSrc = readFileSync(resolve(SRC, 'utils', 'helpers.jsx'), 'utf8')
  const authSrc = readFileSync(resolve(SRC, 'auth.js'), 'utf8')

  test('App.jsx 不再自带 hostname:8000 / 裸读 backend_host', () => {
    assert.doesNotMatch(appSrc, /window\.location\.hostname\}:8000/)
    assert.doesNotMatch(appSrc, /localStorage\.getItem\('backend_host'\)/)
  })

  test('helpers.jsx 的 data-store 抓取统一走 getBackendHost()', () => {
    assert.match(helpersSrc, /import\s+\{\s*getBackendHost\s*\}\s+from\s+'\.\.\/auth'/)
    assert.doesNotMatch(helpersSrc, /window\.location\.hostname \+ ':8000'/)
  })

  test('auth.js: 切换地址要清旧后端的 token 并告诉调用方需要重登', () => {
    // JWT 是各后端用自己的 secret 签的, 不清就会 401 → 静默 reload → 用户只看到"设置没生效"
    assert.match(authSrc, /removeItem\('token'\)/)
    assert.match(authSrc, /requiresLogin/)
  })
})
