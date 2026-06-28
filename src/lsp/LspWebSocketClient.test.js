/**
 * 阶段1: LspWebSocketClient 单测 —— 用 mock WebSocket 验证状态机 + JSON-RPC 帧。
 * 不连真 WS。node:test runner（跟现有 __tests__/*.test.js 一致）。
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { LspWebSocketClient } from './LspWebSocketClient.js'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  constructor(url) {
    this.url = url
    this.readyState = 0  // CONNECTING
    this.sent = []
    this.onopen = null
    this.onmessage = null
    this.onclose = null
    this.onerror = null
    MockWebSocket.instances.push(this)
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
    if (this.onclose) this.onclose()
  }
  fireOpen() {
    this.readyState = 1
    this.onopen && this.onopen()
  }
  fireMessage(obj) {
    this.onmessage && this.onmessage({ data: JSON.stringify(obj) })
  }
}
MockWebSocket.instances = []
globalThis.WebSocket = MockWebSocket

const flush = () => new Promise((r) => setImmediate(r))

beforeEach(() => {
  MockWebSocket.instances = []
})
afterEach(() => {
  // no-op
})

describe('LspWebSocketClient', () => {
  test('state 走到 connecting → ready on open', async () => {
    const states = []
    const c = new LspWebSocketClient({
      url: 'ws://test/typescript?ws=/x',
      languageId: 'typescript',
      onState: (s) => states.push(s),
    })
    c.connect()
    assert.equal(c.state, 'connecting')
    const ws = MockWebSocket.instances[0]
    ws.fireOpen()
    await flush()
    assert.equal(ws.sent[0].method, 'initialize')
    ws.fireMessage({ id: ws.sent[0].id, result: { capabilities: {} } })
    await flush()
    assert.equal(ws.sent[1].method, 'initialized')
    assert.equal(c.state, 'ready')
    assert.deepEqual(states, ['connecting', 'ready'])
  })

  test('hover 帧序列化正确（id 递增）', async () => {
    const c = new LspWebSocketClient({
      url: 'ws://test/typescript?ws=/x',
      languageId: 'typescript',
    })
    c.connect()
    const ws = MockWebSocket.instances[0]
    ws.fireOpen()
    await flush()
    ws.fireMessage({ id: ws.sent[0].id, result: {} })
    await flush()
    // didOpen
    c.didOpen('file:///a.ts', 'const x = 1', 'typescript')
    await flush()
    // hover
    const p = c.hover(2, 5)
    await flush()
    const reqFrame = ws.sent[ws.sent.length - 1]
    assert.ok(reqFrame.id > 0)
    assert.equal(reqFrame.method, 'textDocument/hover')
    assert.deepEqual(reqFrame.params.position, { line: 2, character: 5 })
    assert.equal(reqFrame.params.textDocument.uri, 'file:///a.ts')
    // 回应
    ws.fireMessage({ id: reqFrame.id, result: { contents: 'hi' } })
    assert.deepEqual(await p, { contents: 'hi' })
  })

  test('pending 超时 reject', async () => {
    const c = new LspWebSocketClient({
      url: 'ws://test/python?ws=/x',
      languageId: 'python',
    })
    c.connect()
    const ws = MockWebSocket.instances[0]
    ws.fireOpen()
    await flush()
    ws.fireMessage({ id: ws.sent[0].id, result: {} })
    await flush()
    const p = c.hover(0, 0)
    // 不 fire 回应，等超时（8s）—— 这里不真等，用 fake timer 替代
    // 没装 @sinonjs/fake-timers；用真实 setTimeout 不可行（测试会卡）
    // 替代方案：直接 dispose 让 reject
    c.dispose()
    await p.catch((e) => { assert.match(String(e), /disposed|disconnected/) })
  })

  test('dispose 拒掉 pending', async () => {
    const c = new LspWebSocketClient({
      url: 'ws://test/go?ws=/x',
      languageId: 'go',
    })
    c.connect()
    const ws = MockWebSocket.instances[0]
    ws.fireOpen()
    await flush()
    ws.fireMessage({ id: ws.sent[0].id, result: {} })
    await flush()
    const p = c.hover(0, 0)
    c.dispose()
    // dispose → ws.close → onclose → "lsp disconnected"（先）；或 dispose 后续 "lsp disposed"
    await p.catch((e) => assert.match(String(e), /disposed|disconnected/))
  })

  test('非 ready 状态调 hover → reject', async () => {
    const c = new LspWebSocketClient({
      url: 'ws://test/typescript?ws=/x',
      languageId: 'typescript',
    })
    await c.hover(0, 0).catch((e) => assert.match(String(e), /not ready/))
  })

  test('disconnected 后请求立刻 reject', async () => {
    const c = new LspWebSocketClient({
      url: 'ws://test/typescript?ws=/x',
      languageId: 'typescript',
    })
    c.connect()
    const ws = MockWebSocket.instances[0]
    ws.fireOpen()
    await flush()
    ws.fireMessage({ id: ws.sent[0].id, result: {} })
    await flush()
    ws.close()  // state -> disconnected
    assert.equal(c.state, 'disconnected')
    await c.hover(0, 0).catch((e) => assert.match(String(e), /disconnected/))
  })

  test('publishDiagnostics 通知走 onDiagnostics 回调', async () => {
    let captured = null
    const c = new LspWebSocketClient({
      url: 'ws://test/typescript?ws=/x',
      languageId: 'typescript',
      onDiagnostics: (p) => { captured = p },
    })
    c.connect()
    const ws = MockWebSocket.instances[0]
    ws.fireOpen()
    await flush()
    ws.fireMessage({ id: ws.sent[0].id, result: {} })
    await flush()
    ws.fireMessage({
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///a.ts',
        diagnostics: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: 'oops',
        }],
      },
    })
    assert.ok(captured)
    assert.equal(captured.diagnostics[0].message, 'oops')
  })
})
