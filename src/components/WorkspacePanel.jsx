import React, { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef, lazy, Suspense } from 'react'
import { Layout, Input, Button, Tree, Space, Typography, message, Spin, Modal, List } from 'antd'
import { FolderOpenOutlined, FileOutlined, ReloadOutlined, SaveOutlined, EditOutlined, HomeOutlined, SearchOutlined } from '@ant-design/icons'
import api, { getBackendHost, getLocalAgentBaseUrl } from '../auth'
import axios from 'axios'
import { shouldRequireConfirmation, formatCommandSummary, addTrustedPattern, patternFromCommand } from './agentCommandSafety'
import { extractTrailingStateJson, extractImplStateBlock } from '../utils/helpers.jsx'
import WorkspaceTopologySearch from './WorkspaceTopologySearch'

// 阶段1: Monaco 编辑器（按需加载 ~1.5MB）；SSR/老浏览器环境下不会触发
const LspMonacoEditor = lazy(() => import('./LspMonacoEditor.jsx'))

const localApi = axios.create({ baseURL: getLocalAgentBaseUrl(), timeout: 600000 })

const { Text } = Typography
const { TextArea } = Input

// ── Cross-platform workspace directory helpers ──
const isWindows = () => {
  if (typeof window !== 'undefined') {
    return window.navigator.userAgent.includes('Windows')
  }
  return false
}

const getDefaultWorkspaceDir = () => {
  if (typeof window !== 'undefined') {
    if (isWindows()) {
      // On Windows, use user home directory
      try {
        const homedir = require('os').homedir()
        return homedir
      } catch (e) {
        return 'C:\\Users\\Public'
      }
    } else {
      const homedir = require('os').homedir()
      const username = homedir.split('/').pop()
      return `/Users/${username}/code/autobot`
    }
  }
  return '/Users/user/code/autobot'
}

// 阶段1: 按后缀挑 monaco languageId。LSP 也按这个走；没匹配 = 普通文本
const languageForPath = (p) => {
  if (!p) return 'plaintext'
  const lower = String(p).toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
  if (lower.endsWith('.py') || lower.endsWith('.pyi')) return 'python'
  if (lower.endsWith('.go')) return 'go'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.xml')) return 'xml'
  if (lower.endsWith('.sh')) return 'shell'
  return 'plaintext'
}

const getInitialBrowsePath = () => {
  if (typeof window !== 'undefined') {
    if (isWindows()) {
      return 'C:\\'
    }
    return '/'
  }
  return '/'
}

export default forwardRef(function WorkspacePanel({ workspaceDir, onDirChange, sessionId }, ref) {
  const defaultValue = workspaceDir || getDefaultWorkspaceDir()
  const [dirInput, setDirInput] = useState(defaultValue)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [browseVisible, setBrowseVisible] = useState(false)
  const [browsePath, setBrowsePath] = useState(defaultValue)
  const [browseEntries, setBrowseEntries] = useState([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [targetLine, setTargetLine] = useState(null)  // 1-based; non-null after jumpToFile
  // S5: 拓扑索引搜索 modal
  const [topologyVisible, setTopologyVisible] = useState(false)
  const viewerRef = useRef(null)  // scrollable <pre> container

  // Imperative API for parent components (e.g. the right-hand issue panel
  // jumping to a file when the user clicks an issue). Resolves the path
  // against the current workspace if a relative path is supplied, then
  // reads the file and scrolls to the requested line.
  //
  // Exposed both as the imperative `jumpToFile` and as an internal
  // function so the topology-search modal can reuse the same logic
  // (it doesn't have a ref to this component).
  const jumpToFileInternal = async (filePath, lineNumber) => {
    if (!filePath) return
    let resolved = filePath
    if (workspaceDir && !filePath.match(/^[a-zA-Z]:[\\/]/) && !filePath.startsWith('/')) {
      const sep = workspaceDir.includes('\\') ? '\\' : '/'
      resolved = workspaceDir.replace(/[\\/]+$/, '') + sep + filePath.replace(/^[\\/]+/, '')
    }
    setTargetLine(lineNumber && lineNumber > 0 ? lineNumber : null)
    await readFile(resolved)
    // Scroll after content is rendered. readFile is async; the state
    // update from setFileContent will trigger a re-render in the next
    // tick, so we schedule the scroll on a microtask.
    Promise.resolve().then(() => {
      const container = viewerRef.current
      if (!container) return
      const lineHeight = 16  // matches monospace 11px * 1.5 line-height
      const idx = (lineNumber && lineNumber > 0 ? lineNumber : 1) - 1
      container.scrollTop = Math.max(0, idx * lineHeight - container.clientHeight / 3)
    })
  }

  useImperativeHandle(ref, () => ({
    jumpToFile: jumpToFileInternal
  }), [workspaceDir])
  const driveEntries = isWindows()
    ? browseEntries.filter(entry => entry?.isDir && /^[A-Za-z]:$/.test(entry.name))
    : []

  useEffect(() => {
    if (workspaceDir) {
      setDirInput(workspaceDir)
      fetchFilesList(workspaceDir)
    }
  }, [workspaceDir])

  const fetchFilesList = async (dir) => {
    if (!dir) return
    setLoading(true)
    try {
      const items = await fetchTreeChildren(dir)
      setFiles(items)
      if (onDirChange) onDirChange(dir)
    } catch (e) {
      message.error('读取失败: ' + (e.response?.data?.error || e.message))
      setFiles([])
    }
    setLoading(false)
  }

  const fetchFiles = useCallback(() => {
    fetchFilesList(dirInput || workspaceDir)
  }, [dirInput, workspaceDir])

  const openBrowser = (path) => {
    setBrowsePath(path || dirInput || defaultValue)
    setBrowseVisible(true)
    loadBrowseEntries(path || dirInput || defaultValue)
  }

  const loadBrowseEntries = async (path) => {
    setBrowseLoading(true)
    setBrowsePath(path || (isWindows() ? '磁盘根目录' : '/'))
    try {
      const res = await localApi.post('/api/local/workspace/browse', { path })
      setBrowseEntries(res.data.entries || [])
    } catch (e) {
      message.error('浏览失败: ' + (e.response?.data?.error || e.message))
    }
    setBrowseLoading(false)
  }

  const handleBrowseSelect = (entry) => {
    if (entry.isDir) {
      loadBrowseEntries(entry.path)
    }
  }

  const confirmBrowse = () => {
    setDirInput(browsePath)
    setBrowseVisible(false)
    if (onDirChange) onDirChange(browsePath)
    fetchFilesList(browsePath)
  }

  const readFile = async (filePath) => {
    setSelectedFile(filePath)
    setEditing(false)
    try {
      const res = await localApi.post('/api/local/workspace/read', {
        path: filePath,
        backendHost: getBackendHost()
      })
      setFileContent(res.data.content || '')
    } catch (e) {
      setFileContent('// 读取失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const startEdit = () => {
    setEditContent(fileContent)
    setEditing(true)
  }

  const saveFile = async () => {
    if (!selectedFile) return
    setSaving(true)
    try {
      await localApi.post('/api/local/workspace/save', { path: selectedFile, content: editContent })
      setFileContent(editContent)
      setEditing(false)
      message.success('已保存')
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.error || e.message))
    }
    setSaving(false)
  }

  // ── Lazy-loading tree: fetch children on expand ──
  const TREE_EXTS = '.java,.jsx,.js,.tsx,.ts,.json,.xml,.yml,.py,.sql'

  const fetchTreeChildren = useCallback(async (dirPath) => {
    try {
      const res = await localApi.post('/api/local/workspace/list', {
        path: dirPath,
        extensions: TREE_EXTS
      })
      const items = (res.data.files || []).map(f => {
        const isLeaf = !!f.isFile
        return {
          title: isLeaf ? (
            <Space size={4}>
              <FileOutlined style={{color:'#888',fontSize:11}} />
              <span style={{fontSize:12}}>{f.path}</span>
            </Space>
          ) : f.path,
          key: f.absolute,
          isLeaf,
          file: isLeaf ? f.absolute : null,
          children: isLeaf ? undefined : [] // Placeholder for lazy load
        }
      })
      return items
    } catch (e) {
      console.warn('Failed to load children for', dirPath, e)
      return []
    }
  }, [])

  const onLoadData = useCallback(async (node) => {
    if (node.children && node.children.length > 0) return // Already loaded
    const items = await fetchTreeChildren(node.key)
    setFiles(prev => {
      const update = (nodes) => nodes.map(n => {
        if (n.key === node.key) return { ...n, children: items }
        if (n.children) return { ...n, children: update(n.children) }
        return n
      })
      return update(prev)
    })
  }, [fetchTreeChildren])

  const onSelect = (keys) => {
    if (keys.length > 0) {
      // Find the file path from tree data
      const findFileInTree = (nodes, key) => {
        for (const n of nodes) {
          if (n.key === key && n.file) return n.file
          if (n.children) {
            const found = findFileInTree(n.children, key)
            if (found) return found
          }
        }
        return null
      }
      const filePath = findFileInTree(files, keys[0])
      if (filePath) readFile(filePath)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
      {/* Directory Input */}
      <div style={{ padding: 8, borderBottom: '1px solid #222' }}>
        <Space style={{ width: '100%' }}>
          <Input
            size="small"
            placeholder="项目目录, 点击浏览选择"
            value={dirInput}
            onChange={e => setDirInput(e.target.value)}
            onPressEnter={fetchFiles}
            style={{ background: '#141414', color: '#ccc', border: '1px solid #333', flex: 1 }}
          />
          <Button size="small" icon={<FolderOpenOutlined />} onClick={() => openBrowser(dirInput)} loading={loading}>
            浏览
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchFiles}>刷新</Button>
          <Button
            size="small"
            icon={<SearchOutlined />}
            onClick={() => setTopologyVisible(true)}
            disabled={!sessionId}
            title="按符号/类名/方法名搜索工作区拓扑索引"
          >
            拓扑搜索
          </Button>
        </Space>
      </div>

      {/* File Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: 4, maxHeight: '40%' }}>
        {loading ? <Spin size="small" style={{margin:20}} /> : (
          <Tree
            showLine
            loadData={onLoadData}
            treeData={files}
            onSelect={onSelect}
            style={{ background: 'transparent', color: '#aaa', fontSize: 12 }}
          />
        )}
      </div>

      {/* File Viewer/Editor */}
      <div style={{ flex: 1, borderTop: '1px solid #222', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '4px 8px', background: '#141414', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#888', fontSize: 11 }}>
            {selectedFile ? selectedFile.split('/').pop() : '选择文件查看'}
          </Text>
          {selectedFile && !editing && (
            <Button size="small" icon={<EditOutlined />} onClick={startEdit}>编辑</Button>
          )}
          {editing && (
            <Space size={4}>
              <Button size="small" onClick={() => setEditing(false)}>取消</Button>
              <Button size="small" type="primary" icon={<SaveOutlined />} onClick={saveFile} loading={saving}>保存</Button>
            </Space>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 0, position: 'relative' }}>
          {editing ? (
            <Suspense fallback={
              <TextArea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                style={{
                  background: '#111', color: '#ccc', border: '1px solid #333',
                  fontFamily: 'monospace', fontSize: 12, resize: 'none',
                  height: '100%', minHeight: 200
                }}
              />
            }>
              <LspMonacoEditor
                value={editContent}
                onChange={setEditContent}
                language={languageForPath(selectedFile)}
                path={selectedFile || 'untitled.txt'}
                workspaceRoot={workspaceDir || ''}
                height="100%"
              />
            </Suspense>
          ) : (
            <pre ref={viewerRef} style={{
              color: '#ccc', fontSize: 11, fontFamily: 'monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              margin: 0, lineHeight: 1.5, padding: 8
            }}>
              {fileContent || '// 选择文件查看内容'}
            </pre>
          )}
        </div>
      </div>

      {/* ── Directory Browser Modal ── */}
      <Modal
        title="选择项目目录"
        open={browseVisible}
        onCancel={() => setBrowseVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setBrowseVisible(false)}>取消</Button>,
          <Button key="ok" type="primary" onClick={confirmBrowse}>选择此目录</Button>
        ]}
        width={500}
      >
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
          当前路径: <Text code style={{ fontSize: 11 }}>{browsePath}</Text>
        </div>
        <Space style={{ marginBottom: 8 }}>
          <Button size="small" icon={<HomeOutlined />} onClick={() => loadBrowseEntries(getDefaultWorkspaceDir())}>
            {isWindows() ? '用户目录' : '项目根'}
          </Button>
          {isWindows() ? (
            <>
              <Button size="small" onClick={() => loadBrowseEntries('')}>磁盘根目录</Button>
              {driveEntries.map(entry => (
                <Button key={entry.path} size="small" onClick={() => loadBrowseEntries(entry.path)}>
                  {entry.name}
                </Button>
              ))}
            </>
          ) : (
            <>
              <Button size="small" onClick={() => loadBrowseEntries('/Users')}>/Users</Button>
              <Button size="small" onClick={() => loadBrowseEntries('/')}>/ (根)</Button>
            </>
          )}
        </Space>
        <div style={{
          maxHeight: 300, overflow: 'auto', border: '1px solid #333',
          borderRadius: 4, background: '#141414'
        }}>
          {browseLoading ? <Spin size="small" style={{padding:20}} /> : (
            <List
              size="small"
              dataSource={browseEntries}
              renderItem={item => (
                <List.Item
                  onClick={() => handleBrowseSelect(item)}
                  style={{
                    cursor: 'pointer', padding: '4px 12px',
                    borderBottom: '1px solid #1a1a1a',
                    color: '#ccc', fontSize: 12
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Space>
                    <FolderOpenOutlined style={{color:'#faad14'}} />
                    <span>{item.name}</span>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
      </Modal>
      {/* S5: 拓扑索引搜索 modal —— 按符号/类名/方法名跨文件检索 */}
      <WorkspaceTopologySearch
        open={topologyVisible}
        workspaceId={sessionId}
        onClose={() => setTopologyVisible(false)}
        onPick={(filePath) => {
          if (filePath) {
            setTopologyVisible(false)
            jumpToFileInternal(filePath, null)
          }
        }}
      />
    </div>
  )
})

function extractTrailingAnalysisStateJson(content) {
  // DEF-5 fix: include both __state and [IMPL_STATE] blocks so backend
  // can recover ImplementationService auxState without fragile DB search.
  const parts = []
  const stateJson = extractTrailingStateJson(content)
  if (stateJson) parts.push(stateJson)
  const implStateJson = extractImplStateBlock(content)
  if (implStateJson) parts.push('\n[IMPL_STATE]\n' + implStateJson + '\n')
  return parts.join('')
}

/**
 * P1 线协议升级: 构造 [COMMAND_RESULTS] 可选的 [META:{json}] 行。
 * 仅携带已跟踪的字段 (session_id 必有; turn_id / tool_call_id / session_version 尚未
 * 跟踪时可缺省, 由后端填权威值)。无 sessionId 时返回空串 → 消息保持与 legacy 格式一致。
 * @param {string} sessionId
 * @param {{turnId?: number, toolCallId?: string, sessionVersion?: number}} [extra]
 * @returns {string} '[META:{...}]' 或 ''
 */
export function buildCommandResultsMeta(sessionId, extra) {
  if (!sessionId) return ''
  const meta = { session_id: sessionId }
  if (extra?.turnId != null) meta.turn_id = extra.turnId
  if (extra?.toolCallId != null) meta.tool_call_id = extra.toolCallId
  if (extra?.sessionVersion != null) meta.session_version = extra.sessionVersion
  return `[META:${JSON.stringify(meta)}]`
}

// ── Streaming __CMD__ pre-dispatch ───
// When the LLM streams tokens via WebSocket, we intercept __CMD__ blocks and
// dispatch them immediately so file reads / scans complete before the full
// HTTP response arrives.  Results are cached per command-id; the regular
// executeAgentCommands path reuses them to avoid double execution.

/** Shared set of read-only action types (same as in executeAgentCommands). */
const READ_ACTIONS = new Set(['read', 'scan', 'tree_sync', 'ls', 'diff', 'search', 'env_probe'])

/** Shared cache: commandId → result string. Populated by the stream dispatcher. */
export const streamedCmdResults = new Map()

const streamBuffers = new Map()

/**
 * Scan a streaming text buffer for complete {@code __CMD__{...}} blocks.
 * Dispatches read-only commands immediately; stores results in
 * {@link #streamedCmdResults}.  Returns the number of commands dispatched.
 */
export function tryStreamDispatch(workspaceDir, onLog, sessionId) {
  const text = streamBuffers.get(sessionId) ?? ''
  if (!text.includes('__CMD__')) return 0

  let dispatched = 0
  let searchStart = 0
  while (true) {
    const idx = text.indexOf('__CMD__', searchStart)
    if (idx < 0) break
    const braceStart = text.indexOf('{', idx)
    if (braceStart < 0 || braceStart - idx > 10) { searchStart = idx + 7; continue }
    // Balanced-brace scan to find the end of the JSON object
    let depth = 0, i = braceStart
    let inStr = false, esc = false
    while (i < text.length) {
      const ch = text[i]
      if (esc) { esc = false; i++; continue }
      if (ch === '\\') { esc = true; i++; continue }
      if (ch === '"') { inStr = !inStr; i++; continue }
      if (inStr) { i++; continue }
      if (ch === '{') { depth++; i++; continue }
      if (ch === '}') {
        depth--
        if (depth === 0) {
          const json = text.substring(braceStart, i + 1)
          let cmd
          try { cmd = JSON.parse(json) } catch { i++; continue }
          // Only pre-dispatch read-only commands during streaming.
          // Mutation commands (write, delete, run, etc.) must wait
          // for executeAgentCommands so they run sequentially.
          if (cmd && cmd.action && !streamedCmdResults.has(cmd.id) && READ_ACTIONS.has(cmd.action)) {
            // D1 fix: store the pending Promise so resolveCachedResult
            // can await it, preventing double execution.
            const promise = executeSingleCommand(cmd, workspaceDir, onLog, sessionId)
            streamedCmdResults.set(cmd.id, promise)
            promise.then(r => {
              streamedCmdResults.set(cmd.id, r)
            })
            dispatched++
          }
          searchStart = i + 1
          break
        }
      }
      i++
    }
    if (depth !== 0) break  // incomplete object — stop scanning
  }
  return dispatched
}

/** Append streaming tokens to the buffer. Call from WebSocket AGENT_STREAM handler. */
export function appendStreamToken(token, sessionId) {
  if (!streamBuffers.has(sessionId)) streamBuffers.set(sessionId, '')
  streamBuffers.set(sessionId, streamBuffers.get(sessionId) + token)
}

/** Reset the streaming buffer (new message). */
export function resetStreamBuffer(sessionId) {
  streamBuffers.set(sessionId, '')
}

/**
 * Resolve a cached command result — if the cached value is a pending Promise
 * (i.e., the streaming pre-dispatch hasn't finished yet), await it.
 * Otherwise return the cached string or the fallback.
 * @param {string} cmdId
 * @param {string} [fallback]
 * @returns {Promise<string|undefined>}
 */
async function resolveCachedResult(cmdId, fallback) {
  const cached = streamedCmdResults.get(cmdId)
  if (cached instanceof Promise) {
    const resolved = await cached
    streamedCmdResults.set(cmdId, resolved)
    return resolved
  }
  return cached !== undefined ? cached : fallback
}

/**
 * Clear all cached streaming command results for a session.
 * Call when starting a new agent response to prevent stale results
 * from a previous message being reused.
 */
export function clearStreamedCmdCache() {
  streamedCmdResults.clear()
}

// ── Full-response command executor ───

/**
 * 宽松修复 LLM 生成的 __CMD__ JSON: Windows 绝对路径中的反斜杠(如 E:\code\autobot)
 * 在 JSON 字符串里是未转义字符, 而 \c / \a 等不是合法 JSON 转义序列, 会导致
 * JSON.parse 报 "Bad escaped character"。本函数做字符串感知的逐字符扫描:
 * 在字符串值内部, 遇到"后跟非法转义字符"的反斜杠时把它转义为 \\, 使 \c 被解析
 * 为字面量"反斜杠+c"(恢复原始 Windows 路径); 合法的 \n / \\ / \" / \u 等转义
 * 原样保留, 不受影响。
 */
function repairJsonBackslashes(str) {
  let out = ''
  let inStr = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (inStr) {
      if (ch === '\\') {
        const next = str[i + 1]
        // 合法 JSON 转义字符: " \ / b f n r t u
        if (next && '"\\/bfnrtu'.includes(next)) {
          out += ch + next
          i++
        } else {
          out += '\\\\' + (next || '')
          i++
        }
        continue
      }
      if (ch === '"') inStr = false
      out += ch
      continue
    }
    if (ch === '"') inStr = true
    out += ch
  }
  return out
}

/**
 * Execute agent commands embedded in a message text.
 * Returns results as a string to send back to the agent.
 * @param {string} text - The agent message text containing __CMD__ markers
 * @param {string} workspaceDir - The base workspace directory
 * @param {(line: string) => void} onLog - Optional terminal logger callback
 * @param {string} sessionId - Current session id for backend sync calls
 * @returns {Promise<string>} Command results to send back to chat
 */
export async function executeAgentCommands(text, workspaceDir, onLog, sessionId) {
  if (!text || !text.includes('__CMD__')) return null

  const commands = []
  let searchStart = 0
  while (true) {
    const idx = text.indexOf('__CMD__', searchStart)
    if (idx < 0) break
    const jsonStart = idx + '__CMD__'.length
    if (jsonStart >= text.length || text[jsonStart] !== '{') {
      searchStart = jsonStart
      continue
    }
    // Brace-counting parser to handle nested JSON
    let depth = 0
    let i = jsonStart
    let inString = false
    let escape = false
    while (i < text.length) {
      const ch = text[i]
      if (escape) { escape = false; i++; continue }
      if (ch === '\\' && inString) { escape = true; i++; continue }
      if (ch === '"') { inString = !inString; i++; continue }
      if (inString) { i++; continue }
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) break }
      i++
    }
    if (depth === 0) {
      const jsonStr = text.substring(jsonStart, i + 1)
      try {
        commands.push(JSON.parse(jsonStr))
      } catch (e) {
        // LLM 生成的 Windows 绝对路径(如 E:\code\autobot\java-backend)里反斜杠未转义,
        // \c/\a 不是合法 JSON 转义 → JSON.parse 失败。尝试宽松修复后重试。
        const repaired = repairJsonBackslashes(jsonStr)
        try {
          commands.push(JSON.parse(repaired))
          onLog?.(`[AgentCMD] JSON parse recovered (fixed unescaped backslashes)\n`)
        } catch (e2) {
          onLog?.(`[AgentCMD] JSON parse failed: ${e.message}\n`)
        }
      }
      searchStart = i + 1
    } else {
      searchStart = jsonStart + 1
    }
  }
  if (commands.length === 0) return null

  onLog?.(`[AgentCMD] Parsed ${commands.length} command(s)\n`)

  const results = []

  // Read-only commands (read, scan, tree_sync, ls) can execute in parallel.
  // Mutating commands (write, run, delete, restore_bak, delete_bak) run
  // sequentially after reads complete to preserve ordering.
  const readActions = new Set(['read', 'scan', 'tree_sync', 'ls', 'diff', 'search', 'env_probe'])
  const readCmds = commands.filter(c => readActions.has(c.action))
  const mutCmds = commands.filter(c => !readActions.has(c.action))

  for (const cmd of readCmds) {
    const targetPath = cmd.path || workspaceDir || '(empty)'
    onLog?.(
      `[AgentCMD] Running ${cmd.action} id=${cmd.id || '(none)'} path=${targetPath}${formatCommandLogMeta(cmd)}\n`
    )
  }
  const readResults = await Promise.all(readCmds.map(c => executeSingleCommand(c, workspaceDir, onLog, sessionId)))
  for (let i = 0; i < readCmds.length; i++) {
    const cmd = readCmds[i]
    let r = await resolveCachedResult(cmd.id, readResults[i])
    if (r === readResults[i]) {
      streamedCmdResults.set(cmd.id, r)
    } else {
      onLog?.(`[AgentCMD] Reusing streamed ${cmd.action} id=${cmd.id || '(none)'}\n`)
    }
    results.push(`[RESULT:${cmd.id}]\n${r}`)
  }

  for (const cmd of mutCmds) {
    let r = await resolveCachedResult(cmd.id)
    if (r === undefined) {
      const targetPath = cmd.path || workspaceDir || '(empty)'
      onLog?.(
        `[AgentCMD] Running ${cmd.action} id=${cmd.id || '(none)'} path=${targetPath}${formatCommandLogMeta(cmd)}\n`
      )
      r = await executeSingleCommand(cmd, workspaceDir, onLog, sessionId)
      streamedCmdResults.set(cmd.id, r)
    } else {
      onLog?.(`[AgentCMD] Reusing streamed ${cmd.action} id=${cmd.id || '(none)'}\n`)
    }
    results.push(`[RESULT:${cmd.id}]\n${r}`)
  }

  // Preserve the full trailing state JSON so backend can recover the next round correctly
  const stateJson = extractTrailingAnalysisStateJson(text)

  // P1: 可选 [META:...] 头 (有 sessionId 时前置), body 部分与 legacy 格式逐字节一致.
  const metaLine = buildCommandResultsMeta(sessionId)

  // P2: 当有并行只读命令时，在结果中嵌入批次元信息，让后端能匹配到 pendingToolCalls
  const batchLine = readCmds.length > 1
    ? `[BATCH_COMPLETE:${readCmds.map(c => c.id || '?').join(',')}]`
    : ''

  const header = `[COMMAND_RESULTS]\n${batchLine ? batchLine + '\n' : ''}${metaLine ? metaLine + '\n' : ''}`
  return `${header}${results.join('\n\n')}\n\n${stateJson}`
}

function isAbsoluteCommandPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\')
}

function resolveCommandPath(workspaceDir, filePath) {
  if (!filePath || typeof filePath !== 'string') return workspaceDir || filePath
  if (isAbsoluteCommandPath(filePath)) return filePath
  if (!workspaceDir) return filePath

  const base = workspaceDir.replace(/[\\/]+$/, '')
  const relative = filePath.replace(/^[\\/]+/, '')
  return base + (isWindows() ? '\\' : '/') + relative
}

function formatCommandLogMeta(cmd) {
  if (!cmd || typeof cmd !== 'object') return ''
  if (cmd.action === 'read') {
    const mode = cmd.mode || 'compact'
    const hasRange = Number.isFinite(Number(cmd.startLine)) && Number.isFinite(Number(cmd.endLine))
    return ` mode=${mode}${hasRange ? ` lines=${cmd.startLine}-${cmd.endLine}` : ''}`
  }
  if (cmd.maxDepth) {
    return ` depth=${cmd.maxDepth}`
  }
  return ''
}

async function executeSingleCommand(cmd, workspaceDir, onLog, sessionId) {
  switch (cmd.action) {
    case 'ls': {
      try {
        const path = resolveCommandPath(workspaceDir, cmd.path || workspaceDir)
        const res = await localApi.post('/api/local/workspace/list', {
          path,
          extensions: '.java,.jsx,.js,.tsx,.ts,.json,.xml,.yml,.py,.sql,.md'
        })
        const files = res.data.files || []
        onLog?.(`[AgentCMD] ls ok ${files.length} file(s) from ${path}\n`)
        return files.map(f => f.path).join('\n')
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] ls failed ${cmd.path || workspaceDir}: ${detail}\n`)
        return `Error listing ${cmd.path}: ${detail}`
      }
    }
    case 'read': {
      try {
        const path = resolveCommandPath(workspaceDir, cmd.path)
        const res = await localApi.post('/api/local/workspace/read', {
          path,
          mode: cmd.mode || 'compact',
          startLine: cmd.startLine,
          endLine: cmd.endLine,
          backendHost: getBackendHost()
        })
        const size = res.data.size || (res.data.content ? res.data.content.length : 0)
        onLog?.(`[AgentCMD] read ok ${path}${formatCommandLogMeta(cmd)} (${size} chars)\n`)
        if (res.data?.format === 'code_read_v2') {
          return JSON.stringify(res.data)
        }
        return res.data.content || ''
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        const path = resolveCommandPath(workspaceDir, cmd.path)
        onLog?.(`[AgentCMD] read failed ${path}${formatCommandLogMeta(cmd)}: ${detail}\n`)
        return `Error reading ${path}: ${detail}`
      }
    }
    case 'scan': {
      try {
        const path = resolveCommandPath(workspaceDir, cmd.path || workspaceDir)
        const res = await localApi.post('/api/local/workspace/scan', {
          path,
          maxDepth: cmd.maxDepth || 4,
          extensions: cmd.extensions || '.java,.jsx,.js,.tsx,.ts,.json,.xml,.yml,.yaml,.py,.sql,.md,.properties,.gradle,.toml'
        })
        const entries = res.data.entries || []
        onLog?.(`[AgentCMD] scan ok ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${path}\n`)
        return entries.join('\n')
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        const path = resolveCommandPath(workspaceDir, cmd.path || workspaceDir)
        onLog?.(`[AgentCMD] scan failed ${path}: ${detail}\n`)
        return `Error scanning ${path}: ${detail}`
      }
    }
    case 'search': {
      // [F37②] 搜索发现通道 —— 只回路径不回内容 (与 scan 同族, 但由 glob/正则驱动)。
      // 后端在工作区可见时自己就地搜; 这一支是"后端把搜索下发给本地代理"的同族入口。
      try {
        const path = resolveCommandPath(workspaceDir, cmd.path || workspaceDir)
        const res = await localApi.post('/api/local/workspace/search', {
          path,
          mode: cmd.mode === 'grep' ? 'grep' : 'glob',
          pattern: cmd.pattern || '',
          globs: Array.isArray(cmd.globs) ? cmd.globs : (cmd.globs ? [cmd.globs] : []),
          maxResults: cmd.maxResults || 50,
        })
        const paths = res.data.paths || []
        const hits = res.data.hits || []
        onLog?.(`[AgentCMD] search(${res.data.mode}) ok ${paths.length} path(s)`
          + `${hits.length ? `, ${hits.length} hit line(s)` : ''} from ${path}\n`)
        if (hits.length) {
          // 只把 path:line 交回后端 —— 内容由随后的 read 提供
          return hits.map(h => `${h.path}:${h.line}`).join('\n')
        }
        return paths.join('\n')
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] search failed ${cmd.path || workspaceDir}: ${detail}\n`)
        return `Error searching ${cmd.path || workspaceDir}: ${detail}`
      }
    }
    case 'issues': {
      // F14: tracked-issue 面板/REST 已下线, 后端不再下发 cmd-issues;
      // 防御性兜底 (旧会话残留 __CMD__ 命中时给明确文案而非报错)。
      onLog?.('[AgentCMD] issues skipped: issue pipeline removed\n')
      return 'Issue tracking pipeline has been retired; no issue list is available.'
    }
    case 'tree_sync': {
      try {
        const treePath = resolveCommandPath(workspaceDir, cmd.path || workspaceDir)
        const treeRes = await localApi.post('/api/local/workspace/tree', {
          path: treePath,
          maxDepth: cmd.maxDepth || 12,
          maxEntries: cmd.maxEntries || 30000,
          extensions: cmd.extensions || '.java,.jsx,.js,.tsx,.ts,.py,.sql,.xml,.json,.yml,.yaml,.properties,.md,.sh,.gradle,.toml',
          excludeDirs: cmd.excludeDirs || []
        })
        onLog?.(`[AgentCMD] tree_sync local ok ${treeRes.data.entryCount || 0} entries from ${treePath}\n`)
        const syncRes = await api.post('/workspace/tree/sync', {
          session_id: sessionId,
          workspace_dir: treePath,
          root: treeRes.data.root || treePath,
          scanned_at: treeRes.data.scannedAt,
          truncated: treeRes.data.truncated === true,
          entries: treeRes.data.entries || []
        })
        if (syncRes.data?.status !== 'success') {
          throw new Error(syncRes.data?.message || 'workspace tree sync failed')
        }
        onLog?.(`[AgentCMD] tree_sync backend ok ${syncRes.data.entry_count || 0} entries cached for ${treePath}\n`)
        return `Tree synced: ${syncRes.data.entry_count || 0} entries`
      } catch (e) {
        const detail = e.response?.data?.message || e.response?.data?.error || e.message
        const treePath = resolveCommandPath(workspaceDir, cmd.path || workspaceDir)
        onLog?.(`[AgentCMD] tree_sync failed ${treePath}: ${detail}\n`)
        return `Error syncing tree ${treePath}: ${detail}`
      }
    }
    case 'diff': {
      // git diff is not available on frontend — return hint
      return '(git diff not available via frontend — running on backend)'
    }
    case 'search_replace': {
      // 风险 1 修复：search/replace diff 模式
      // 优先调用后端原子 search/replace 端点（避免 500 行文件整体重写风险）
      // 若后端未提供该端点，前端兜底为 read → apply → write
      try {
        const target = resolveCommandPath(workspaceDir, cmd.path)
        const searchText = cmd.search_text || ''
        const replaceText = cmd.replace_text || ''
        const replaceAll = !!cmd.replace_all
        if (!searchText) {
          return `Error: search_replace requires non-empty search_text (path=${cmd.path})`
        }
        const res = await localApi.post('/api/local/workspace/search_replace', {
          path: target,
          search_text: searchText,
          replace_text: replaceText,
          replace_all: replaceAll,
          backup: cmd.backup !== false, // 默认 true
        })
        const r = res.data || {}
        onLog?.(`[AgentCMD] search_replace ok ${target} (${r.occurrences || 1} occurrence, ${r.new_size || '?'} bytes)\n`)
        return r.message || `Replaced ${r.occurrences || 1} occurrence(s)`
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        const target = resolveCommandPath(workspaceDir, cmd.path)
        // 后端端点可能未部署 — 兜底到 read → write
        if (e.response?.status === 404) {
          try {
            onLog?.(`[AgentCMD] search_replace backend missing — falling back to read+write for ${target}\n`)
            const readRes = await localApi.post('/api/local/workspace/read', { path: target })
            const original = readRes.data?.content || ''
            const searchText = cmd.search_text || ''
            const replaceText = cmd.replace_text || ''
            if (!original.includes(searchText)) {
              return `Error: search_text not found in ${cmd.path}`
            }
            const newContent = original.split(searchText).join(replaceText)
            // DEF-10 fix: create .bak backup in fallback path so rollback can
            // restore the file. Matches the primary search_replace and write
            // command behavior (both create .CodeAgent.bak by default).
            const backupPath = cmd.backup !== false ? target + '.CodeAgent.bak' : null
            const writeRes = await localApi.post('/api/local/workspace/write', {
              path: target,
              content: newContent,
              backup_path: backupPath,
            })
            onLog?.(`[AgentCMD] search_replace fallback ok ${target} (${newContent.length} bytes)\n`)
            return writeRes.data?.message || 'Replaced (fallback)'
          } catch (fallbackErr) {
            const fbDetail = fallbackErr.response?.data?.error || fallbackErr.message
            return `Error search_replace ${cmd.path} (fallback failed): ${fbDetail}`
          }
        }
        onLog?.(`[AgentCMD] search_replace failed ${target}: ${detail}\n`)
        return `Error search_replace ${cmd.path}: ${detail}`
      }
    }
    case 'write': {
      try {
        const target = resolveCommandPath(workspaceDir, cmd.path)
        const backup = cmd.backup
          ? resolveCommandPath(workspaceDir, cmd.path + cmd.backup)
          : null
        const res = await localApi.post('/api/local/workspace/write', {
          path: target,
          content: cmd.content || '',
          backup_path: backup,
        })
        onLog?.(`[AgentCMD] write ok ${target} (${(cmd.content || '').length} chars)\n`)
        return res.data?.message || 'Written'
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        const target = resolveCommandPath(workspaceDir, cmd.path)
        onLog?.(`[AgentCMD] write failed ${target}: ${detail}\n`)
        return `Error writing ${cmd.path}: ${detail}`
      }
    }
    case 'delete': {
      try {
        const target = resolveCommandPath(workspaceDir, cmd.path)
        const res = await localApi.post('/api/local/workspace/delete_file', {
          path: target,
        })
        onLog?.(`[AgentCMD] delete ok ${target}\n`)
        return res.data?.message || 'Deleted'
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        const target = resolveCommandPath(workspaceDir, cmd.path)
        onLog?.(`[AgentCMD] delete failed ${target}: ${detail}\n`)
        return `Error deleting ${cmd.path}: ${detail}`
      }
    }
    case 'mkdir': {
      // Create a directory (recursively). Safe and idempotent — backend
      // emits it with requires_confirmation=false, no prompt needed.
      try {
        const target = resolveCommandPath(workspaceDir, cmd.path)
        const res = await localApi.post('/api/local/workspace/mkdir', { path: target })
        onLog?.(`[AgentCMD] mkdir ok ${target}${formatCommandLogMeta(cmd)}\n`)
        return res.data?.message || 'Created'
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        const target = resolveCommandPath(workspaceDir, cmd.path)
        onLog?.(`[AgentCMD] mkdir failed ${target}: ${detail}\n`)
        return `Error creating directory ${cmd.path}: ${detail}`
      }
    }
    case 'cp': {
      // Copy a file/directory (recursive). Mutates the workspace, so honor
      // the backend's requires_confirmation flag and reuse the confirm modal.
      if (cmd.requires_confirmation) {
        const reason = 'Copying a file/directory modifies your workspace.'
        onLog?.(`[AgentCMD] cp awaiting user confirmation: ${reason}\n`)
        const approved = await confirmRunCommand(
          { ...cmd, command: 'cp', args: [cmd.from, cmd.to] },
          reason,
          onLog
        )
        if (!approved) {
          onLog?.(`[AgentCMD] cp REJECTED by user: ${cmd.id || '(no id)'}\n`)
          return `Error: cp command rejected by user`
        }
        onLog?.(`[AgentCMD] cp APPROVED by user: ${cmd.id || '(no id)'}\n`)
      }
      try {
        const from = resolveCommandPath(workspaceDir, cmd.from)
        const to = resolveCommandPath(workspaceDir, cmd.to)
        const res = await localApi.post('/api/local/workspace/copy', { from, to })
        onLog?.(`[AgentCMD] cp ok ${from} -> ${to}${formatCommandLogMeta(cmd)}\n`)
        return res.data?.message || 'Copied'
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] cp failed: ${detail}\n`)
        return `Error copying ${cmd.from || '?'} -> ${cmd.to || '?'}: ${detail}`
      }
    }
    case 'network':
    case 'run': {
      // ── Safety gate ─────────────────────────────────────────────────
      // Every `run` command requires user confirmation by default. The
      // backend flags the command via `requires_confirmation` and a
      // defense-in-depth pattern scan also runs here. If either signals
      // danger, pop a modal and let the user explicitly approve. `network`
      // (curl/wget/... emitted by adapters as a `network` action) goes
      // through the exact same gate — the command line is normalized to
      // action `run` so the existing pattern/whitelist logic applies.
      const dangerReason = shouldRequireConfirmation({ ...cmd, action: 'run' })
      if (dangerReason) {
        onLog?.(`[AgentCMD] run awaiting user confirmation: ${dangerReason}\n`)
        const approved = await confirmRunCommand(cmd, dangerReason, onLog)
        if (!approved) {
          onLog?.(`[AgentCMD] run REJECTED by user: ${cmd.id || '(no id)'}\n`)
          return `Error: run command rejected by user (${dangerReason})`
        }
        onLog?.(`[AgentCMD] run APPROVED by user: ${cmd.id || '(no id)'}\n`)
      }
      try {
        const res = await localApi.post('/api/local/workspace/run', {
          command: cmd.command,
          args: Array.isArray(cmd.args) ? cmd.args : [],
          // cwd 是工作区相对目录（后端下发的是 "admin" 这种），必须按工作区解析成绝对路径；
          // 原样透传会让 sidecar 的 path.resolve() 相对它自己的进程 cwd 解析 → monorepo 子模块装到错目录。
          cwd: cmd.cwd ? resolveCommandPath(workspaceDir, cmd.cwd) : workspaceDir,
          code: cmd.code,
          extension: cmd.extension,
          timeoutSeconds: cmd.timeout_seconds || 60,
          tailLines: cmd.tail_lines || 200,
          skipIfNoTestScript: cmd.skip_if_no_test_script === true,
        })
        const output = res.data.output || ''
        const exitCode = typeof res.data.exit_code === 'number' ? res.data.exit_code : 0
        const timedOut = res.data.timed_out === true
        onLog?.(`[AgentCMD] run ok ${cmd.command} (exit=${exitCode}${timedOut ? ', timed out' : ''})\n`)
        return formatRunOutput(output, exitCode, timedOut)
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] run failed ${cmd.command}: ${detail}\n`)
        return `Error running ${cmd.command}: ${detail}`
      }
    }
    case 'restore_bak': {
      try {
        const fromPath = resolveCommandPath(workspaceDir, cmd.from)
        const toPath = resolveCommandPath(workspaceDir, cmd.path)
        const res = await localApi.post('/api/local/workspace/restore_bak', {
          from: fromPath,
          to: toPath,
        })
        onLog?.(`[AgentCMD] restore_bak ok ${fromPath} -> ${toPath}\n`)
        return res.data?.message || 'Restored from backup'
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] restore_bak failed ${cmd.path}: ${detail}\n`)
        return `Error restoring ${cmd.path}: ${detail}`
      }
    }
    case 'delete_bak': {
      try {
        const path = resolveCommandPath(workspaceDir, cmd.path)
        const res = await localApi.post('/api/local/workspace/delete_bak', { path })
        onLog?.(`[AgentCMD] delete_bak ok ${path}\n`)
        return res.data?.message || 'Backup removed'
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] delete_bak failed ${cmd.path}: ${detail}\n`)
        return `Error removing backup ${cmd.path}: ${detail}`
      }
    }
    case 'env_probe': {
      // F47① 反向通道环境探测: 事实全部在**文件所在的那台主机**上现取。
      // 这是跨机部署下唯一够得到用户机器的路径 —— 后端 LocalAgentClient 打的是它自己的
      // localhost:3000, 服务端部署时探到的是后端那台机器的环境, 与用户工作区无关。
      // 只读: 除 sidecar 的 --version 子进程外不起进程、不写文件。
      const tools = (Array.isArray(cmd.tools) ? cmd.tools : [])
        .map(t => String(t).trim()).filter(Boolean).slice(0, 8)
      const dirs = (Array.isArray(cmd.dirs) ? cmd.dirs : [])
        .map(d => String(d).trim()).filter(Boolean).slice(0, 12)
      const rootRel = String(cmd.module_root || cmd.moduleRoot || '')
        .replace(/[\\/]+$/, '')
      const baseDir = (!rootRel || rootRel === '.' || rootRel === './')
        ? workspaceDir
        : resolveCommandPath(workspaceDir, rootRel)
      const out = { probe: 'env_probe', platform: '未探测', arch: '', tools: [], dirs: [], degraded: [] }
      if (rootRel && rootRel !== '.' && rootRel !== './') out.module_root = rootRel
      if (tools.length) {
        try {
          const res = await localApi.post('/api/local/workspace/probe', { tools })
          out.platform = res.data?.platform || '未探测'
          out.arch = res.data?.arch || ''
          for (const t of res.data?.tools || []) {
            out.tools.push(t.found
              ? { name: t.key, version: String(t.version || '').slice(0, 40) }
              : { name: t.key, found: false })
          }
        } catch (e) {
          const detail = e.response?.data?.error || e.message
          onLog?.(`[AgentCMD] env_probe tools failed: ${detail}\n`)
          out.degraded.push(`tools: ${detail}`)
        }
      }
      // 依赖目录 (node_modules / .venv / venv) 走 validate —— 它只认**目录**, 所以字段刻意叫
      // dirs 而不是 paths: 拿它探文件会得到"路径不是有效目录", 那是个假阴性。
      for (const d of dirs) {
        try {
          const res = await localApi.post('/api/local/workspace/validate', {
            path: resolveCommandPath(baseDir, d)
          })
          out.dirs.push({ rel: d, present: res.data?.valid === true })
        } catch (e) {
          // 探测失败 ≠ 目录不存在 —— 写 null 让后端渲染成"未探测"
          const detail = e.response?.data?.error || e.message
          onLog?.(`[AgentCMD] env_probe dir failed ${d}: ${detail}\n`)
          out.dirs.push({ rel: d, present: null, error: detail })
        }
      }
      if (!tools.length && !dirs.length) {
        out.degraded.push('tools 与 dirs 都为空: 什么都没探(请至少给一个)')
      }
      onLog?.(`[AgentCMD] env_probe ok tools=${tools.length} dirs=${dirs.length} platform=${out.platform}\n`)
      return JSON.stringify(out)
    }
    case 'proc_start': {
      // F47·C3 运行项目: 起**长命**进程 (dev server / 起服务后验端口)。
      // 刻意不复用 action=run —— /workspace/run 是 execFile + 硬超时 (上限 600s), dev server
      // 会被自己的超时杀掉, 杀掉之后什么都没剩下。这里走 sidecar 的后台任务面, 进程活在任务表里
      // 可查 (proc_status) 可停 (proc_stop)。
      // 权限不自建第二套: 先让 commandAnalyzer 判 —— 它说 ask 就弹确认, 用户点头才带 confirmed 重试;
      // 它说 deny 就是 deny, 不重试 (sidecar 才是这条命令能不能跑的权威)。
      const command = String(cmd.command || '').trim()
      if (!command) return '{"proc":"error","error":"proc_start 需要 command"}'
      const body = {
        command,
        cwd: cmd.cwd ? resolveCommandPath(workspaceDir, cmd.cwd) : workspaceDir,
        background: true,
        timeoutMs: Math.min(600_000, Math.max(1000, (Number(cmd.timeout_seconds) || 600) * 1000)),
      }
      const askReason = '起进程会在你的机器上常驻一个进程, 且不受 git 撤销影响。'
      let res
      try {
        res = await localApi.post('/api/local/bash', body)
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] proc_start denied/failed: ${detail}\n`)
        return `{"proc":"error","error":${JSON.stringify(detail)}}`
      }
      if (res.data?.status === 'needs_confirmation') {
        const pseudo = { ...cmd, action: 'run', command, args: [] }
        const approved = await confirmRunCommand(pseudo, askReason, onLog)
        if (!approved) {
          onLog?.(`[AgentCMD] proc_start REJECTED by user\n`)
          return '{"proc":"rejected","error":"用户拒绝起这个进程"}'
        }
        res = await localApi.post('/api/local/bash', { ...body, confirmed: true })
      }
      const taskId = res.data?.taskId || ''
      onLog?.(`[AgentCMD] proc_start ok task=${taskId} status=${res.data?.status}\n`)
      return JSON.stringify({
        proc: 'started', task_id: taskId, status: res.data?.status || 'unknown',
        command, cwd: body.cwd,
        note: '进程活着不等于跑对了 —— 用 proc_status 看 stdout 与端口',
      })
    }
    case 'proc_status': {
      // 只读回看: 有 task_id 看单条, 没有就列本机当前所有后台任务 (模型据此避免起第二个 dev server)。
      // ⚠ sidecar 的 task 快照里带着整个 **env 对象** (里面有 token) —— 这里必须逐字段挑着回传,
      //   绝不能把 t 整体塞进 JSON: 回传原文是要进模型上下文的。
      const id = String(cmd.task_id || '').trim()
      try {
        if (id) {
          const res = await localApi.get(`/api/local/bash/tasks/${encodeURIComponent(id)}`)
          const t = res.data?.task
          if (!t) return '{"proc":"status","task_id":' + JSON.stringify(id) + ',"status":"未找到"}'
          const upSec = t.startedAt ? Math.max(0, Math.round((Date.now() - t.startedAt) / 1000)) : null
          return JSON.stringify({
            proc: 'status', task_id: id, status: t.status, command: t.command, cwd: t.cwd,
            uptime_sec: upSec, exit_code: typeof t.exitCode === 'number' ? t.exitCode : null,
            duration_ms: typeof t.durationMs === 'number' ? t.durationMs : null,
            stdout_tail: tailLines(t.stdout, 40),
            stderr_tail: tailLines(t.stderr, 20),
          })
        }
        const res = await localApi.get('/api/local/bash/tasks')
        const tasks = (res.data?.tasks || []).map(t => ({
          task_id: t.id, status: t.status, command: String(t.command || '').slice(0, 120), cwd: t.cwd,
        }))
        return JSON.stringify({ proc: 'list', count: tasks.length, tasks })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] proc_status failed: ${detail}\n`)
        // 取不到 ≠ 没在跑: 写"未探测"语义, 不许模型据此宣布进程已死
        return `{"proc":"status","status":"未探测","error":${JSON.stringify(detail)}}`
      }
    }
    case 'proc_stop': {
      const id = String(cmd.task_id || '').trim()
      if (!id) return '{"proc":"error","error":"proc_stop 需要 task_id"}'
      try {
        const res = await localApi.delete(`/api/local/bash/tasks/${encodeURIComponent(id)}`)
        onLog?.(`[AgentCMD] proc_stop task=${id} killed=${res.data?.killed}\n`)
        return JSON.stringify({ proc: 'stopped', task_id: id, killed: res.data?.killed === true })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        return `{"proc":"error","task_id":${JSON.stringify(id)},"error":${JSON.stringify(detail)}}`
      }
    }
    case 'graph':
    case 'graph_search':
    case 'graph_callchain':
    case 'graph_references': {
      // 图谱数据在服务端(FalkorDB)由 ServerSideCommandResolver 就地解析；若该命令仍漏到
      // 前端(例如中间轮或 regex 未覆盖), 这里返回中性提示而非 "Unknown command",
      // 不伪造数据, 也不中断命令回环。
      const op = cmd.op || cmd.action || 'graph'
      onLog?.(`[AgentCMD] graph (server-side) id=${cmd.id || '(no id)'} op=${op}\n`)
      return `(graph ${op} 查询由服务端图谱解析, 命令 ${cmd.id || ''} 已忽略)`
    }
    case 'focus': {
      // focus 是回灌协议: 前端需要回应 LLM 声明的 focus domain, 后端从 COMMAND_RESULTS 里
      // 抽取 "domain" 落库。这里回一个含 domain 的 ack, 让后端能正常锁定 focus 域。
      const domain = cmd.domain || String(cmd.id || '').replace(/^cmd-focus:?/, '')
      onLog?.(`[AgentCMD] focus ack domain=${domain}\n`)
      return domain ? `{"domain":"${domain}","ack":true}` : 'focus ack'
    }
    case 'skill':
      // skill 文档由服务端 SkillService 就地加载, 前端无需拦截.
      return '(skill 文档由服务端加载)'
    case 'plan_continue': {
      // [F39⑥] 服务端"分析收口 → 写规划"之间的回合边界: 这条指令不需要本机做任何事,
      // 立刻 ack 让后端在下一个 HTTP 往返里继续规划。刻意不加入 readActions/READ_ACTIONS,
      // 以免被流式预派发; 后端每条指令都带唯一 id, 不会命中 streamedCmdResults 的 id 缓存。
      onLog?.(`[AgentCMD] plan_continue ack id=${cmd.id || ''}\n`)
      return '{"ack":true,"note":"已确认，请继续生成写方案"}'
    }
    default:
      return `Unknown command: ${cmd.action}`
  }
}

/**
 * Show an Ant Design modal asking the user to confirm a `run` command.
 * Returns a Promise<boolean> — true if the user approved, false otherwise.
 */
function confirmRunCommand(cmd, reason, onLog) {
  return new Promise((resolve) => {
    const summary = formatCommandSummary(cmd)
    const cwd = cmd.cwd || '(no cwd)'
    const timeout = cmd.timeout_seconds || 60
    // Hold the trust-for-session flag in a closure so onOk can read it.
    let trustForSession = false
    let resolved = false
    const finish = (ok) => {
      if (resolved) return
      resolved = true
      if (ok && trustForSession) {
        try {
          const fullCommandLine = [cmd.command, ...(Array.isArray(cmd.args) ? cmd.args : [])]
            .filter(Boolean)
            .join(' ')
          addTrustedPattern(patternFromCommand(fullCommandLine))
          onLog?.(`[AgentCMD] trust granted for pattern: ${fullCommandLine}\n`)
        } catch (e) {
          onLog?.(`[AgentCMD] failed to persist trust pattern: ${e.message}\n`)
        }
      }
      resolve(ok)
    }

    const content = (
      <div>
        <p style={{ marginBottom: 8 }}>
          <strong>警告</strong>: The CodeAgent wants to execute a shell command
          on your local machine. Please review and confirm.
        </p>
        <p style={{ marginBottom: 4 }}>
          <strong>Reason for confirmation</strong>: {reason}
        </p>
        <p style={{ marginBottom: 4 }}>
          <strong>Command</strong>:
        </p>
        <pre
          style={{
            background: '#1f1f1f',
            color: '#f5f5f5',
            padding: 12,
            borderRadius: 4,
            overflow: 'auto',
            maxHeight: 200,
            margin: 0,
            fontSize: 12,
          }}
        >
          {summary}
        </pre>
        <p style={{ marginTop: 8, marginBottom: 4, color: '#666', fontSize: 12 }}>
          cwd: {cwd} | timeout: {timeout}s
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 12 }}>
          <input
            type="checkbox"
            onChange={(e) => { trustForSession = e.target.checked }}
          />
          Trust this command for the rest of this session (no further prompts)
        </label>
      </div>
    )

    Modal.confirm({
      title: 'Confirm command execution',
      content,
      okText: 'Execute',
      okButtonProps: { danger: true },
      cancelText: 'Reject',
      width: 640,
      maskClosable: false,
      onOk: () => finish(true),
      onCancel: () => finish(false),
    })
  })
}

/** 取尾部 n 行 (后台任务的 stdout 可以涨到 MB 级, 头部往往是 npm install 的进度条)。 */
function tailLines(text, n) {
  const s = typeof text === 'string' ? text : String(text || '')
  if (!s) return ''
  const lines = s.split('\n')
  return lines.slice(Math.max(0, lines.length - (n || 40))).join('\n')
}

function formatRunOutput(output, exitCode, timedOut) {
  if (typeof output !== 'string') output = String(output || '')
  let suffix = ''
  // 始终追加结构化退出码标记（成功 [exit=0] / 失败 [exit=N] / 超时），
  // 让后端 isExecutionFailure 优先按退出码判定，避免"成功但 stdout 含 Error 字样"被误判为失败。
  if (timedOut) suffix += `\n[Execution timed out]`
  else suffix += `\n[exit=${exitCode}]`
  return output + suffix
}
