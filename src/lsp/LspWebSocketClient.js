/**
 * 阶段1: 浏览器端 LSP 客户端 —— 直接连后端 {@code /ws/lsp/{lang}}。
 *
 * <p>不引 {@code @codingame/monaco-languageclient}（它依赖 vscode），
 * 只手写最薄的 JSON-RPC over WebSocket：</p>
 *
 * <ul>
 *   <li>开 WS → 发 {@code initialize} → 等结果 → 发 {@code initialized} 通知</li>
 *   <li>{@code textDocument/didOpen}：告诉 server 当前打开的文件</li>
 *   <li>{@code textDocument/didChange}：每次 Monaco 内容变更</li>
 *   <li>{@code textDocument/hover}：monaco hover provider 调</li>
 *   <li>{@code textDocument/definition}：monaco definition provider 调</li>
 *   <li>server push 通知（{@code publishDiagnostics}）→ 转 monaco markers</li>
 * </ul>
 *
 * <p>错误语义：</p>
 * <ul>
 *   <li>WS 断 / server 进程挂 → {@link #state} = {@code disconnected}，call 立刻 reject</li>
 *   <li>call 超时 8s → reject；monaco provider 给空结果即可</li>
 *   <li>request 没回复 → server bug，本端 reject；不等死</li>
 * </ul>
 */
export class LspWebSocketClient {
  /**
   * @param {object} opts
   * @param {string} opts.url           WS URL（含 query）
   * @param {string} opts.languageId    monaco language id（typescript / python / go / java）
   * @param {object} opts.rootUri       LSP rootUri，{scheme, path} 形
   */
  constructor(opts) {
    this.url = opts.url
    this.languageId = opts.languageId
    this.rootUri = opts.rootUri || null
    /** @type {'idle'|'connecting'|'ready'|'disconnected'} */
    this.state = 'idle'
    this.ws = null
    /** @type {Map<number, {resolve, reject, method, timer}>} */
    this.pending = new Map()
    this.nextId = 1
    /** @type {string|null} 当前打开的文件 URI（用于重连后 didOpen） */
    this.openDocUri = null
    this.openDocText = null
    this.openDocVersion = 0
    /** 状态变更回调，外部可订阅 */
    this.onState = opts.onState || (() => {})
    /** publishDiagnostics 回调：uri → diagnostics[] */
    this.onDiagnostics = opts.onDiagnostics || (() => {})
  }

  connect() {
    if (this.state === 'connecting' || this.state === 'ready') return
    this.state = 'connecting'
    this.onState('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => this._onOpen()
    ws.onmessage = (ev) => this._onMessage(ev.data)
    ws.onerror = () => { /* close 总会触发 */ }
    ws.onclose = () => this._onClose()
  }

  dispose() {
    if (this.ws) {
      try { this.ws.close() } catch (_) {}
      this.ws = null
    }
    // 拒掉所有 pending
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('lsp client disposed'))
    }
    this.pending.clear()
  }

  // ── LSP 高层 API（给 monaco provider 调） ──

  async didOpen(uri, text, languageId) {
    this.openDocUri = uri
    this.openDocText = text
    this.openDocVersion = 1
    return this._notify('textDocument/didOpen', {
      textDocument: { uri, languageId: languageId || this.languageId, version: 1, text },
    })
  }

  async didChange(text) {
    if (!this.openDocUri) return
    this.openDocText = text
    this.openDocVersion += 1
    return this._notify('textDocument/didChange', {
      textDocument: { uri: this.openDocUri, version: this.openDocVersion },
      contentChanges: [{ text }],
    })
  }

  async didClose() {
    if (!this.openDocUri) return
    const uri = this.openDocUri
    this.openDocUri = null
    return this._notify('textDocument/didClose', { textDocument: { uri } })
  }

  hover(line, character) {
    return this._request('textDocument/hover', {
      textDocument: { uri: this.openDocUri },
      position: { line, character },
    })
  }

  definition(line, character) {
    return this._request('textDocument/definition', {
      textDocument: { uri: this.openDocUri },
      position: { line, character },
    })
  }

  references(line, character) {
    return this._request('textDocument/references', {
      textDocument: { uri: this.openDocUri },
      position: { line, character },
      context: { includeDeclaration: true },
    })
  }

  // ── 内部 ──

  _onOpen() {
    this.state = 'ready'
    this.onState('ready')
    this._sendInitialize()
      .then(() => {
        this._notify('initialized', {})
        // 重连后要重新 didOpen
        if (this.openDocUri && this.openDocText != null) {
          this.didOpen(this.openDocUri, this.openDocText, this.languageId)
        }
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[lsp-ws] initialize failed', e)
        this.dispose()
      })
  }

  _sendInitialize() {
    return this._request('initialize', {
      processId: null,
      rootUri: this.rootUri,
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          synchronization: { didSave: true, willSave: false, dynamicRegistration: false },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          references: {},
          publishDiagnostics: { relatedInformation: true },
        },
      },
      initializationOptions: {},
    }, 15000)  // 冷启动久一些
  }

  _onMessage(data) {
    let msg
    try { msg = JSON.parse(data) } catch (_) { return }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message || 'lsp error'}`))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.onDiagnostics(msg.params)
    }
    // 其它通知忽略
  }

  _onClose() {
    this.state = 'disconnected'
    this.onState('disconnected')
    // 拒掉所有 pending
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('lsp disconnected'))
    }
    this.pending.clear()
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('lsp ws not open')
    }
    this.ws.send(JSON.stringify(obj))
  }

  _notify(method, params) {
    try {
      this._send({ jsonrpc: '2.0', method, params })
      return Promise.resolve()
    } catch (e) {
      return Promise.reject(e)
    }
  }

  _request(method, params, timeoutMs = 8000) {
    if (this.state !== 'ready') {
      return Promise.reject(new Error(`lsp not ready (state=${this.state})`))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} timeout after ${timeoutMs}ms`))
        }
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, method, timer })
      try {
        this._send({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e)
      }
    })
  }
}
