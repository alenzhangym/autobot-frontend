/**
 * 阶段1: Monaco 编辑器 + LSP WebSocket 客户端。
 *
 * <p>替代 {@code WorkspacePanel} 里的 {@code <TextArea>}：</p>
 * <ul>
 *   <li>用 monaco-editor 真正渲染（行号 / 语法高亮 / 错误标记）</li>
 *   <li>连后端 {@code /ws/lsp/{lang}?ws=...} 拿 hover / go-to-def / references</li>
 *   <li>publishDiagnostics 走 monaco markers 渲染错误线</li>
 *   <li>LSP 没起来 / 断线 → 退到普通编辑器（不卡 UI）</li>
 * </ul>
 *
 * <p>Props：</p>
 * <ul>
 *   <li>{@code value}     —— 编辑器内容（受控）</li>
 *   <li>{@code onChange}  —— 内容变更回调</li>
 *   <li>{@code language}  —— 'typescript' | 'python' | 'go' | 'java' | 'javascript' | 'plaintext'</li>
 *   <li>{@code path}      —— 文件相对路径（用于 {@code textDocument/didOpen}）</li>
 *   <li>{@code workspaceRoot} —— 项目根，传给后端 WS query {@code ?ws=...}</li>
 *   <li>{@code wsBase}    —— 默认 {@code window.location.origin}，可覆盖</li>
 *   <li>{@code readOnly}  —— 传给 monaco editor</li>
 * </ul>
 */
import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { LspWebSocketClient } from '../lsp/LspWebSocketClient'

// 让 monaco-editor 在 Vite 跑 worker；用 Vite `?worker` 语法自动分包
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

const LSP_LANGS = new Set(['typescript', 'javascript', 'python', 'go', 'java'])

function uriFor(path) {
  // path 是相对工作区的相对路径；workspaceRoot 在后端查
  // 统一用 file:// URI；后端只取路径段
  return 'file:///' + String(path || '').replace(/^\/+/, '').replace(/\\/g, '/')
}

function lspPathFor(language) {
  if (language === 'typescript' || language === 'javascript') return 'typescript'
  if (language === 'python') return 'python'
  if (language === 'go') return 'go'
  if (language === 'java') return 'java'
  return null
}

export default function LspMonacoEditor({
  value,
  onChange,
  language = 'plaintext',
  path = 'untitled.txt',
  workspaceRoot = '',
  wsBase,
  readOnly = false,
  height = '100%',
}) {
  const editorRef = useRef(null)
  const containerRef = useRef(null)
  const lspRef = useRef(null)
  const modelsRef = useRef(null)  // { model, markersOwner }
  const [lspState, setLspState] = useState('idle')
  const [diagCount, setDiagCount] = useState(0)

  // 创建 / 复用 monaco model（path 变时换；value 外部变更时 setValue）
  useEffect(() => {
    if (!containerRef.current) return
    const uri = monaco.Uri.parse(uriFor(path))
    const langId = monacoLangId(language)
    // 复用同 uri 的 model，避免 "already exists" 警告
    const existing = monaco.editor.getModel(uri)
    const model = existing || monaco.editor.createModel(value || '', langId, uri)
    if (existing) model.setValue(value || '')
    modelsRef.current = { model, markersOwner: 'lsp' }
    const editor = monaco.editor.create(containerRef.current, {
      model,
      automaticLayout: true,
      readOnly,
      minimap: { enabled: false },
      fontSize: 13,
      theme: 'vs-dark',
      scrollBeyondLastLine: false,
    })
    editorRef.current = editor
    model.onDidChangeContent(() => {
      const v = model.getValue()
      onChange && onChange(v)
    })

    return () => {
      // 不 destroy model —— 下次同 uri 复用；但要 dispose editor
      try { editor.dispose() } catch (_) {}
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language])

  // value prop 变化时同步（外部控制：保存/重置）
  useEffect(() => {
    const m = modelsRef.current && modelsRef.current.model
    if (m && m.getValue() !== value) m.setValue(value || '')
  }, [value])

  // LSP client lifecycle
  useEffect(() => {
    const lspPath = lspPathFor(language)
    if (!lspPath) {
      setLspState('disabled')
      return undefined
    }
    if (!workspaceRoot) {
      setLspState('no-workspace')
      return undefined
    }
    const base = wsBase || (typeof window !== 'undefined' ? window.location.origin : '')
    const qs = new URLSearchParams({ ws: workspaceRoot }).toString()
    const url = `${base}/ws/lsp/${lspPath}?${qs}`
    const lsp = new LspWebSocketClient({
      url,
      languageId: language,
      rootUri: `file:///${String(workspaceRoot).replace(/\\/g, '/')}`,
      onState: (s) => setLspState(s),
      onDiagnostics: (params) => applyDiagnostics(params),
    })
    lspRef.current = lsp
    lsp.connect()
    return () => {
      try { lsp.dispose() } catch (_) {}
      lspRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, workspaceRoot, wsBase])

  // 注册 monaco providers：hover / definition / references
  useEffect(() => {
    if (!editorRef.current) return
    const langId = monacoLangId(language)
    const disposables = []
    disposables.push(monaco.languages.registerHoverProvider(langId, {
      provideHover: async (model, position) => {
        const lsp = lspRef.current
        if (!lsp || lsp.state !== 'ready') return null
        try {
          const res = await lsp.hover(position.lineNumber - 1, position.column - 1)
          if (!res || !res.contents) return null
          const contents = Array.isArray(res.contents) ? res.contents : [res.contents]
          return { contents: contents.map((c) => typeof c === 'string' ? c : (c.value || '')) }
        } catch (_) { return null }
      },
    }))
    disposables.push(monaco.languages.registerDefinitionProvider(langId, {
      provideDefinition: async (model, position) => {
        const lsp = lspRef.current
        if (!lsp || lsp.state !== 'ready') return null
        try {
          const res = await lsp.definition(position.lineNumber - 1, position.column - 1)
          return lspLocationsToMonaco(res)
        } catch (_) { return null }
      },
    }))
    disposables.push(monaco.languages.registerReferenceProvider(langId, {
      provideReferences: async (model, position) => {
        const lsp = lspRef.current
        if (!lsp || lsp.state !== 'ready') return null
        try {
          const res = await lsp.references(position.lineNumber - 1, position.column - 1)
          return lspLocationsToMonaco(res)
        } catch (_) { return null }
      },
    }))
    return () => disposables.forEach((d) => { try { d.dispose() } catch (_) {} })
  }, [language])

  // 内容变更 → LSP didChange
  useEffect(() => {
    if (!modelsRef.current) return
    const sub = modelsRef.current.model.onDidChangeContent(() => {
      const lsp = lspRef.current
      if (!lsp || lsp.state !== 'ready') return
      const m = modelsRef.current.model
      // 首次 didOpen
      if (lsp.openDocUri !== m.uri.toString()) {
        lsp.didOpen(m.uri.toString(), m.getValue(), monacoLangId(language))
      } else {
        lsp.didChange(m.getValue())
      }
    })
    return () => sub.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  function applyDiagnostics(params) {
    const uri = params && params.uri
    if (!uri || !modelsRef.current) return
    const m = modelsRef.current.model
    if (uri !== m.uri.toString()) return
    const markers = (params.diagnostics || []).map((d) => ({
      severity: severityToMonaco(d.severity),
      startLineNumber: (d.range && d.range.start && d.range.start.line || 0) + 1,
      endLineNumber: (d.range && d.range.end && d.range.end.line || 0) + 1,
      startColumn: (d.range && d.range.start && d.range.start.character || 0) + 1,
      endColumn: (d.range && d.range.end && d.range.end.character || 0) + 1,
      message: d.message || '',
      source: d.source || 'lsp',
    }))
    monaco.editor.setModelMarkers(m, 'lsp', markers)
    setDiagCount(markers.length)
  }

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{
        position: 'absolute', top: 4, right: 8, zIndex: 2,
        fontSize: 11, color: '#888', background: 'rgba(0,0,0,0.4)',
        padding: '1px 6px', borderRadius: 3, pointerEvents: 'none',
      }} title={`LSP state: ${lspState}`}>
        LSP: {lspState}{diagCount > 0 ? ` · ${diagCount} diag` : ''}
      </div>
    </div>
  )
}

function monacoLangId(language) {
  if (language === 'typescript' || language === 'ts') return 'typescript'
  if (language === 'javascript' || language === 'js') return 'javascript'
  return language
}

function severityToMonaco(sev) {
  // LSP: 1 Error 2 Warning 3 Info 4 Hint
  switch (sev) {
    case 1: return monaco.MarkerSeverity.Error
    case 2: return monaco.MarkerSeverity.Warning
    case 3: return monaco.MarkerSeverity.Info
    case 4: return monaco.MarkerSeverity.Hint
    default: return monaco.MarkerSeverity.Info
  }
}

function lspLocationsToMonaco(locs) {
  if (!Array.isArray(locs)) return []
  return locs.map((loc) => ({
    uri: loc.uri || (loc.targetUri),
    range: loc.range || loc.targetSelectionRange || {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
  })).filter((l) => l.uri)
}
