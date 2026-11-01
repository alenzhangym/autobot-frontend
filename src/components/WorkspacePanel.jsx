import React, { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef, lazy, Suspense } from 'react'
import { Layout, Input, Button, Tree, Space, Typography, message, Spin, Modal, List } from 'antd'
import { FolderOpenOutlined, FileOutlined, ReloadOutlined, SaveOutlined, EditOutlined, HomeOutlined, SearchOutlined, SafetyOutlined } from '@ant-design/icons'
import api, { getBackendHost, getLocalAgentBaseUrl } from '../auth'
import axios from 'axios'
import { shouldRequireConfirmation, formatCommandSummary, addTrustedPattern, patternFromCommand } from './agentCommandSafety'
import { unsupportedActionPayload } from '../utils/unsupportedAction'
import { clampWaitMs } from '../runtime/procVerifyWait.js'
import {
  buildCommandResultsMeta, buildCommandCellResults, isBatchEnumerated,
  recordCommandCellFact, takeCommandCellFacts, readRunCell,
} from '../runtime/commandResultsMeta.js'
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
  // Defender 白名单（手动入口）：status 只读、ensure 需 UAC。
  const [defenderVisible, setDefenderVisible] = useState(false)
  const [defenderStatus, setDefenderStatus] = useState(null)
  const [defenderLoading, setDefenderLoading] = useState(false)
  const [defenderBusy, setDefenderBusy] = useState(false)
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

  // ── Defender 白名单（手动入口）──────────────────────────────
  // 把当前工作区登记给 sidecar，并只读展示"哪些项目尚未排除"。真正加入要用户确认后走 UAC。
  const refreshDefenderStatus = async () => {
    setDefenderLoading(true)
    try {
      const res = await localApi.get('/api/local/defender/status')
      setDefenderStatus(res.data || null)
    } catch (e) {
      setDefenderStatus({ supported: false, reason: 'request_failed', error: e.response?.data?.error || e.message, projects: [] })
    }
    setDefenderLoading(false)
  }

  const openDefender = async () => {
    setDefenderVisible(true)
    const target = dirInput || workspaceDir
    if (target) {
      try { await localApi.post('/api/local/workspaces/register', { path: target }) } catch (e) { /* 登记失败不阻断查看 */ }
    }
    await refreshDefenderStatus()
  }

  const confirmDefenderEnsure = async () => {
    setDefenderBusy(true)
    try {
      const target = dirInput || workspaceDir
      const res = await localApi.post('/api/local/defender/ensure', { paths: target ? [target] : [] })
      const d = res.data || {}
      if (d.ok) {
        message.success(d.alreadyOk ? '所登记项目均已在白名单中' : `已加入白名单: ${(d.added || []).join(', ')}`)
      } else {
        message.error('加入白名单失败: ' + (d.message || d.reason || '未知原因'))
      }
      await refreshDefenderStatus()
    } catch (e) {
      message.error('加入白名单失败: ' + (e.response?.data?.error || e.message))
    }
    setDefenderBusy(false)
  }

  const defenderProjects = defenderStatus?.projects || []
  const defenderPending = defenderProjects.filter(p => p.excluded === false)

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
          <Button
            size="small"
            icon={<SafetyOutlined />}
            onClick={openDefender}
            disabled={!isWindows()}
            title="把本机项目目录加入 Windows Defender 白名单（需管理员 UAC）"
          >
            防护白名单
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
      {/* Defender 白名单（手动入口）—— 只读展示 + 用户确认后提权加入 */}
      <Modal
        title="Windows Defender 白名单"
        open={defenderVisible}
        onCancel={() => setDefenderVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDefenderVisible(false)}>关闭</Button>,
          <Button
            key="ensure"
            type="primary"
            loading={defenderBusy}
            disabled={!defenderStatus?.supported || defenderPending.length === 0}
            onClick={confirmDefenderEnsure}
          >
            {defenderPending.length ? `加入白名单 (${defenderPending.length})` : '已全部在白名单'}
          </Button>
        ]}
        width={560}
      >
        {defenderLoading ? <Spin size="small" /> : (
          <div style={{ fontSize: 12, color: '#ccc' }}>
            {!defenderStatus?.supported ? (
              <div style={{ color: '#faad14' }}>
                当前环境不支持（{defenderStatus?.reason || '未知原因'}）。此功能仅在安装了 Defender 的 Windows 上可用。
                {defenderStatus?.error ? <div style={{ color: '#888', marginTop: 6 }}>{defenderStatus.error}</div> : null}
              </div>
            ) : (
              <>
                <div style={{ color: '#faad14', marginBottom: 10 }}>
                  注意：把目录加入白名单会<b>降低该目录的实时防护</b>。加入需要管理员权限，会弹出 UAC 由你确认。
                </div>
                {defenderProjects.length === 0 ? (
                  <div style={{ color: '#888' }}>尚无已登记项目。请先在上方选择工作区目录。</div>
                ) : (
                  <List
                    size="small"
                    dataSource={defenderProjects}
                    renderItem={item => (
                      <List.Item style={{ padding: '4px 8px' }}>
                        <Space>
                          <span style={{ color: item.excluded ? '#52c41a' : '#ff4d4f' }}>
                            {item.excluded ? '已排除' : '未排除'}
                          </span>
                          <Text code style={{ fontSize: 11 }}>{item.path}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </>
            )}
          </div>
        )}
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

// [返工 R2·2.1] [META:{json}] 头与逐格原子事实的纯逻辑在 runtime/commandResultsMeta.js
//   —— 抽出去是为了钉住"不给 extra 就与今天逐字节一致"这条判据（JSX 在 node --test 下编不动，
//   与 runtime/portProbe.js、runtime/procListen.js 同一口径）。这里只负责在派发时记账。

// ── Streaming __CMD__ pre-dispatch ───
// When the LLM streams tokens via WebSocket, we intercept __CMD__ blocks and
// dispatch them immediately so file reads / scans complete before the full
// HTTP response arrives.  Results are cached per command-id; the regular
// executeAgentCommands path reuses them to avoid double execution.

/** Shared set of read-only action types (same as in executeAgentCommands). */
const READ_ACTIONS = new Set(['read', 'scan', 'tree_sync', 'ls', 'diff', 'search', 'env_probe',
  // [P4-A·运行时确认] 只读探测各族：不写盘、不占口、不杀进程，可与读腿并行预派发。
  'proc_scan', 'proc_status', 'proc_port_probe', 'proc_listen'])

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
  const readActions = new Set(['read', 'scan', 'tree_sync', 'ls', 'diff', 'search', 'env_probe',
    // [P4-A·运行时确认] 只读探测各族（进程/端口事实）：不写盘、不占口、不杀进程。
    'proc_scan', 'proc_status', 'proc_port_probe', 'proc_listen'])
  const readCmds = commands.filter(c => readActions.has(c.action))
  const mutCmds = commands.filter(c => !readActions.has(c.action))

  // [返工 R2·2.1] 逐格耗时：只有**这一批真执行过**的那几格才有值。
  //   走缓存复用（流式预派发已经跑过）的那条不许编一个本轮耗时出来 —— 那一格本轮没花时间。
  const cellTimings = new Map()
  async function runCell(cmd) {
    const t0 = Date.now()
    try {
      return await executeSingleCommand(cmd, workspaceDir, onLog, sessionId)
    } finally {
      cellTimings.set(cmd.id, Date.now() - t0)
    }
  }

  for (const cmd of readCmds) {
    const targetPath = cmd.path || workspaceDir || '(empty)'
    onLog?.(
      `[AgentCMD] Running ${cmd.action} id=${cmd.id || '(none)'} path=${targetPath}${formatCommandLogMeta(cmd)}\n`
    )
  }
  const readResults = await Promise.all(readCmds.map(c => runCell(c)))
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
      r = await runCell(cmd)
      streamedCmdResults.set(cmd.id, r)
    } else {
      onLog?.(`[AgentCMD] Reusing streamed ${cmd.action} id=${cmd.id || '(none)'}\n`)
    }
    results.push(`[RESULT:${cmd.id}]\n${r}`)
  }

  // Preserve the full trailing state JSON so backend can recover the next round correctly
  const stateJson = extractTrailingAnalysisStateJson(text)

  // [返工 R2·2.1] 逐格原子事实 + "这批我逐格报完了没有"。前端**不折 outcome、不折批**：
  //   这里既没写 status 也没写 killed_ids —— 那一层判决归读回灌正文的一方，
  //   服务端唯一的集合运算（killed_ids = ∪ timed_out）在 CommandResultsEnvelope 一处做。
  const cellResults = buildCommandCellResults(commands, takeCommandCellFacts(commands), cellTimings)

  // P1: 可选 [META:...] 头 (有 sessionId 时前置), body 部分与 legacy 格式逐字节一致.
  const metaLine = buildCommandResultsMeta(sessionId, {
    results: cellResults,
    enumerated: isBatchEnumerated(commands),
  })

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
          // [L4] 带上工作区根，让 sidecar 能判 cwd 有没有越界（只给 cwd 时它无从判"相对谁"）。
          //   越界 → sidecar 直接拒绝执行（fail-closed），不给"在错误目录真跑一次命令"的机会。
          workspace_root: workspaceDir,
          code: cmd.code,
          extension: cmd.extension,
          timeoutSeconds: cmd.timeout_seconds || 60,
          tailLines: cmd.tail_lines || 200,
          skipIfNoTestScript: cmd.skip_if_no_test_script === true,
        })
        // [返工 R2·2.1] 这一格真在手的结构化事实原样记进逐格账。
        // [枚48/#173] 正文与逐格账由同一次归一产出：sidecar 没回退出码 → 两处都如实成"不知道"，
        //   不许折成 0（折出来的那个假 0 会被服务端读成"跑通了"）。
        const cell = readRunCell(res.data.output, res.data.exit_code, res.data.timed_out)
        recordCommandCellFact(cmd.id, { action: cmd.action, ...cell.fact })
        onLog?.(`[AgentCMD] run ok ${cmd.command} (exit=${cell.exitCode ?? 'unknown'}`
          + `${cell.timedOut ? ', timed out' : ''})\n`)
        return cell.body
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
          // [L2] 三态逐字透传: found:true 有版本 / found:false 确实没有 / found:null 判不了。
          //   旧写法 `t.found ? … : {found:false}` 把"判不了"写成"没有" —— 后端据此会去装一个
          //   已经装好的东西（2026-10-02: mvn 明明能跑，probe 却回 found:false）。
          for (const t of res.data?.tools || []) {
            if (t.found === true) {
              out.tools.push({ name: t.key, version: String(t.version || '').slice(0, 40) })
            } else if (t.found === false) {
              out.tools.push({ name: t.key, found: false })
            } else {
              const why = String(t.reason || '探测失败（判不了）')
              out.tools.push({ name: t.key, found: null, reason: why })
              out.degraded.push(`tool ${t.key}: ${why}`)
            }
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
        // [L4] 同 run：带工作区根，让 sidecar 的 cwd 越界守卫能判（proc_start 起的是常驻进程）。
        workspace_root: workspaceDir,
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
        // [C·2026-10-31] 起进程不给「本次信任」：它是长命进程，一次点头不该让后面同类启动静默通过。
        const approved = await confirmRunCommand(pseudo, askReason, onLog, { allowTrust: false })
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
      // [B·ii] wait_ms = 后端请我"等这么久再回答"。一次冷启动 (mvn 编译 + Spring 上下文) 要几十秒,
      //   立刻回看只能拿到一份空 stdout (2026-10-03 实证: 三轮回看共 4.1 秒, 进程第 5.8 秒才报编译失败)。
      //   等待放在本机这一侧: 服务端不 sleep, 就不占 worker 线程。上限 60s, 非法值按 0。
      const waitMs = clampWaitMs(cmd.wait_ms)
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
      const id = String(cmd.task_id || '').trim()
      try {
        if (id) {
          const res = await localApi.get(`/api/local/bash/tasks/${encodeURIComponent(id)}`)
          const t = res.data?.task
          if (!t) return '{"proc":"status","task_id":' + JSON.stringify(id) + ',"status":"未找到"}'
          // [F64③] uptime 只对**还活着**的任务按 now 算。taskRegistry 的终态是
          //   success/error/timeout/killed（status==='running' 才是活着），旧写法对已退出的任务
          //   仍按 now-startedAt 递增 —— 2026-10-06 22:18 那轮 mvn 第 8.3 秒就退了
          //   （duration_ms 恒为 8274），uptime_sec 却一路 21→42→63→84 地涨，
          //   于是"进程还在启动中"这个信念是被这份假增长喂着的（它还进了后端的快照指纹）。
          const alive = t.status === 'running'
          const endMs = alive ? Date.now() : (t.endedAt ?? (t.startedAt + (t.durationMs ?? 0)))
          const upSec = t.startedAt ? Math.max(0, Math.round((endMs - t.startedAt) / 1000)) : null
          return JSON.stringify({
            proc: 'status', task_id: id, status: t.status, command: t.command, cwd: t.cwd,
            // [C·2026-10-31] pid 是 proc_stop {pid} 唯一可靠的目标来源（台账里查不到的残留也靠它）
            pid: typeof t.pid === 'number' ? t.pid : null,
            uptime_sec: upSec, exit_code: typeof t.exitCode === 'number' ? t.exitCode : null,
            duration_ms: typeof t.durationMs === 'number' ? t.durationMs : null,
            stdout_tail: tailLines(t.stdout, 40),
            stderr_tail: tailLines(t.stderr, 20),
          })
        }
        const res = await localApi.get('/api/local/bash/tasks')
        const tasks = (res.data?.tasks || []).map(t => ({
          task_id: t.id, status: t.status, command: String(t.command || '').slice(0, 120), cwd: t.cwd,
          pid: typeof t.pid === 'number' ? t.pid : null,
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
      // [C·2026-10-31] 显式目标：台账里查不到的残留进程只剩 pid 可指（sidecar 重启后台账会清空）。
      //   两种停止都带着服务端递下来的 exclude_pids（它的进程族），端侧兜底扫按它摘人。
      const exPids = Array.isArray(cmd.exclude_pids) ? cmd.exclude_pids : []
      const pidText = String(cmd.pid ?? '').trim()
      if (!id && !pidText) return '{"proc":"error","error":"proc_stop 需要 task_id 或 pid"}'
      if (!id) {
        const pid = Number(pidText)
        if (!Number.isInteger(pid) || pid <= 0) {
          return `{"proc":"error","error":"proc_stop 的 pid 必须是正整数（收到 ${pidText}）"}`
        }
        // 破坏性且不可撤销 → 先把"要杀哪一个"摊开让用户点头（不提供"本次信任"）。
        const approved = await confirmStopPid(pid, cmd.reason, onLog)
        if (!approved) {
          onLog?.(`[AgentCMD] proc_stop pid=${pid} REJECTED by user\n`)
          return JSON.stringify({ proc: 'rejected', pid, error: '用户拒绝终止该进程（未终止任何进程）' })
        }
        try {
          const res = await localApi.post('/api/local/bash/kill-pid', { pid, exclude_pids: exPids })
          const d = res.data || {}
          onLog?.(`[AgentCMD] proc_stop pid=${pid} killed=${d.killed} exit=${d.exitCode} err=${d.error || ''}\n`)
          return JSON.stringify({ proc: d.killed ? 'stopped' : 'stop_failed', pid,
            killed: d.killed === true, exit_code: Number.isFinite(d.exitCode) ? d.exitCode : null,
            error: d.error || '' })
        } catch (e) {
          const detail = e.response?.data?.error || e.message
          onLog?.(`[AgentCMD] proc_stop pid=${pid} failed: ${detail}\n`)
          return `{"proc":"error","pid":${pid},"error":${JSON.stringify(detail)}}`
        }
      }
      try {
        const res = await localApi.delete(`/api/local/bash/tasks/${encodeURIComponent(id)}`, {
          data: { exclude_pids: exPids },
        })
        onLog?.(`[AgentCMD] proc_stop task=${id} killed=${res.data?.killed}\n`)
        return JSON.stringify({ proc: 'stopped', task_id: id, killed: res.data?.killed === true })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        return `{"proc":"error","task_id":${JSON.stringify(id)},"error":${JSON.stringify(detail)}}`
      }
    }
    case 'proc_sweep': {
      // [方案C 兜底] 现查无登记任务时（如 sidecar 重启清空台账），按工作区目录做 OS 级兜底清扫。
      //   cwd 由后端带（=工作区根）；缺失则退回本组件的 workspaceDir。
      //
      // [C·2026-10-31] 两段式：先只读预览"命中了谁"，用户确认后才真杀。
      //   为什么必须这一刀：sweep 没有可分析的命令字符串（它按 cwd 匹配），确认只能落在**候选**上；
      //   旧实现直接 POST 就杀，用户在确认框里根本没有东西可看 —— 2026-10-31 dogfood 那次盲扫
      //   把后端自己当成孤儿杀掉，就是"命令不可见 + 无人确认"的合成结果。
      const rawCwd = String(cmd.cwd || '').trim()
      const cwd = rawCwd ? String(resolveCommandPath(workspaceDir, rawCwd) || '').trim()
        : String(workspaceDir || '').trim()
      if (!cwd) return '{"proc":"error","error":"proc_sweep 需要 cwd"}'
      const base = {
        cwd,
        workspace_root: workspaceDir,
        // 后端随手令带来的"别杀我"名单（workspace 就是 autobot 仓库时，后端自己的命令行里含 cwd）
        exclude_pids: Array.isArray(cmd.exclude_pids) ? cmd.exclude_pids : [],
        exclude_markers: Array.isArray(cmd.exclude_markers) ? cmd.exclude_markers : [],
      }
      let preview
      try {
        preview = await localApi.post('/api/local/bash/sweep', { ...base, dry_run: true })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] proc_sweep 预览失败: ${detail}\n`)
        return `{"proc":"error","error":${JSON.stringify(detail)}}`
      }
      const p = preview.data || {}
      const cands = Array.isArray(p.candidates) ? p.candidates : []
      onLog?.(`[AgentCMD] proc_sweep 预览 cwd=${cwd} 枚举=${p.enumerated} 命中=${p.matched} `
        + `via=${p.via || ''} 候选=${JSON.stringify(cands)}\n`)
      if (p.status !== 'candidates') {
        return JSON.stringify({ proc: 'error', cwd,
          error: `sweep 预览没回候选（status=${p.status || '空'}）`, enumErr: p.enumErr || '' })
      }
      if (cands.length === 0) {
        // 没有命中 → 不需要确认框（这一步不改任何东西），如实说"一个都没扫到"
        return JSON.stringify({ proc: 'swept', cwd, killed: false,
          enumerated: Number.isFinite(p.enumerated) ? p.enumerated : -1, matched: 0,
          via: p.via || '', enumErr: p.enumErr || '',
          note: '扫了一遍，命中 0 条 —— 没有终止任何进程' })
      }
      const approved = await confirmSweep(cands, p.reason, onLog)
      if (!approved) {
        onLog?.('[AgentCMD] proc_sweep REJECTED by user\n')
        return '{"proc":"rejected","error":"用户拒绝清扫这些进程（未终止任何进程）"}'
      }
      try {
        // [C·2026-10-31] 把"用户刚确认的那一批 pid"钉进请求体（only_pids）：预览到执行之间
        //   新起的进程用户没见过，端侧重新按 cwd 枚举就会把它们顺带杀掉 —— 确认的对象必须与
        //   执行的对象是同一批。
        const res = await localApi.post('/api/local/bash/sweep', {
          ...base, confirmed: true, only_pids: cands.map((c) => c.pid),
        })
        const d = res.data || {}
        onLog?.(`[AgentCMD] proc_sweep cwd=${cwd} killed=${d.killed} via=${d.via} enumerated=${d.enumerated} matched=${d.matched} enumErr=${d.enumErr || ''} detail=${JSON.stringify(d.detail || [])}\n`)
        // [F72·枚26] 诊断字段一起回传，不再只留在本机日志里：服务端要说清"扫了几条/命中几条/
        //   逐条杀没杀掉"必须拿到它们。旧形状只有 {proc,cwd,killed} 三键 → 交付只能回一个布尔，
        //   于是"停止前后端服务"杀了一条却没说杀的是谁，用户只能再问一次「停止前端服务」（真机 12:55）。
        return JSON.stringify({ proc: 'swept', cwd, killed: d.killed === true,
          enumerated: Number.isFinite(d.enumerated) ? d.enumerated : -1,
          matched: Number.isFinite(d.matched) ? d.matched : -1,
          via: d.via || '', enumErr: d.enumErr || '',
          pids: (d.detail || []).map((x) => `${x.pid}${x.killed ? '' : '(未杀掉)'}`).join(' '),
          // 逐条命令行摘要（剥掉引号与反斜杠 —— 回传正文由服务端的朴素 jsonField 取字段，
          //   嵌套引号会把它读歪；完整原文只进本机 onLog）。
          matched_cmds: (d.detail || []).map((x) => `${x.pid}${x.killed ? '' : '(未杀掉)'} `
            + String(x.cmd || '').replace(/["\\]/g, '').slice(0, 120)).join(' ;; ') })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] proc_sweep failed: ${detail}\n`)
        return `{"proc":"error","error":${JSON.stringify(detail)}}`
      }
    }
    case 'proc_port_probe': {
      // [F72·枚23/枚26] 只读: 这个端口现在有没有进程在听（读现有监听表，不做绑定试探）。
      //   三态原样回传 —— listening / free / unknown。"枚举失败"绝不能折成"没在听"，
      //   这一格存在的意义就是把这两件事分开说。
      try {
        const res = await localApi.post('/api/local/bash/port-probe', { port: cmd.port })
        const d = res.data || {}
        onLog?.(`[AgentCMD] proc_port_probe port=${cmd.port} state=${d.state} pids=${d.pids || ''} via=${d.via} enumerated=${d.enumerated} err=${d.error || ''}\n`)
        return JSON.stringify({ proc: 'portprobe', port: d.port ?? null, state: d.state || 'unknown',
          pids: d.pids || '', via: d.via || '',
          enumerated: Number.isFinite(d.enumerated) ? d.enumerated : -1,
          error: d.error || '' })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] proc_port_probe failed: ${detail}\n`)
        return `{"proc":"portprobe","state":"unknown","error":${JSON.stringify(detail)}}`
      }
    }
    case 'proc_scan': {
      // [P4-A·运行时确认] 只读: 这个工作区里此刻有哪些进程在跑（归属判据 = 命令行含该 cwd），
      //   以及它们各自在听哪些口。回答"前后端起没起来"必须先有这一格 —— 
      //   否则代码通道只能把缺口甩回给用户（"请提供日志 / 请自己 ps -ef"）。
      //   两个枚举的失败各自原样带回（enumErr / listen_err），不许折成"没有进程 / 没在听"。
      // [键名容错] 模型常把工作区写成 path=/dir=（后端已归一，这里再兜一层：别的调用方也可能这么发）。
      const rawScanCwd = String(cmd.cwd || cmd.path || cmd.dir || '').trim()
      const cwd = resolveCommandPath(workspaceDir, rawScanCwd)
      try {
        const res = await localApi.post('/api/local/bash/proc-scan', { cwd })
        const d = res.data || {}
        const ls = d.listen || {}
        onLog?.(`[AgentCMD] proc_scan cwd=${cwd} enumerated=${d.enumerated} matched=${d.matched}`
          + ` operand_only=${d.operand_only || 0} via=${d.via} listen=${(ls.rows || []).length} err=${d.enumErr || ''}`
          + `${ls.err ? ' listenErr=' + ls.err : ''}`
          + ` own=${JSON.stringify(d.ownership || {})} ports=${JSON.stringify(d.ports_recorded || {})}\n`)
        return JSON.stringify({
          proc: 'scan', cwd,
          enumerated: Number.isFinite(d.enumerated) ? d.enumerated : -1,
          matched: Number.isFinite(d.matched) ? d.matched : -1,
          // [口径 2026-11-01] 命中锚点、但只把该目录当操作对象参数（`--workspace <ws>`）而剔掉的条数：
          //   让服务端分得清"没算进来"与"没有这条进程"。
          operand_only: Number.isFinite(d.operand_only) ? d.operand_only : 0,
          via: d.via || '', enumErr: d.enumErr || '',
          // 归属锚点数（工作区根 + 一级子目录）：多模块仓库里服务常从子目录起，
          //   只按根扫会把"命中 0 条"读成"服务没起"。这一格让服务端知道覆盖范围到哪。
          roots: (d.anchors || []).length,
          // 逐行收成字符串: 服务端的 jsonField 是朴素抽键，嵌套数组会被读歪（与 proc_listen 同一条纪律）。
          procs: (d.procs || []).map((p) => `${p.pid}|${p.cmd}`).join(' ;; '),
          listen_via: ls.via || '',
          listen_enumerated: Number.isFinite(ls.enumerated) ? ls.enumerated : -1,
          listen_err: ls.err || '',
          listeners: (ls.rows || []).map((x) => `${x.pid}|${x.port}|${x.address}|${x.channel}`).join(';'),
        })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] proc_scan failed: ${detail}\n`)
        return `{"proc":"scan","state":"unknown","error":${JSON.stringify(detail)}}`
      }
    }
    case 'proc_listen': {
      // [F72·枚35] 只读: 这条任务(task_id)的**进程树此刻在听哪些口**（按 pid 归树，不占口、不筛端口）。
      //   state 三态原样回传 —— ok / unknown / no-root。"枚举失败"与"一条都没有"是两件事。
      const id = String(cmd.task_id || '').trim()
      try {
        const res = await localApi.post('/api/local/bash/proc-listen',
          { task_id: id, pid: cmd.pid })
        const d = res.data || {}
        onLog?.(`[AgentCMD] proc_listen task=${id} state=${d.state} via=${d.via} roots=${(d.roots || []).join(',')}`
          + ` listeners=${(d.listeners || []).length} off_tree=${d.off_tree_listening}`
          + ` broken_chain=${d.off_tree_broken_chain} pid_unknown=${d.pid_unknown} err=${d.error || ''}\n`)
        // 回传体是**扁平**的：服务端的 jsonField 是朴素抽键（嵌套数组会被读歪），所以
        //   listeners/tree 逐行收成 "|" / 空格分隔的字符串，逐字带出处（pid|port|address|channel）。
        // [返工R3·枚54 / #183] 覆盖性那三格一起带上（-1 = 没算出来，服务端不许折成 0 读成"树外没有别的口"）。
        const cov = (v) => (Number.isFinite(v) ? v : -1)
        return JSON.stringify({
          proc: 'listen', task_id: d.task_id || id, state: d.state || 'unknown',
          roots: (d.roots || []).join(' '), tree: (d.tree || []).join(' '),
          listeners: (d.listeners || [])
            .map((x) => `${x.pid}|${x.port}|${x.address}|${x.channel}`).join(';'),
          via: d.via || '', enumerated: Number.isFinite(d.enumerated) ? d.enumerated : -1,
          off_tree_listening: cov(d.off_tree_listening),
          off_tree_broken_chain: cov(d.off_tree_broken_chain),
          pid_unknown: cov(d.pid_unknown),
          error: d.error || '',
        })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] proc_listen failed: ${detail}\n`)
        return `{"proc":"listen","task_id":${JSON.stringify(id)},"state":"unknown","error":${JSON.stringify(detail)}}`
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
    case 'defender_exclude': {
      // 后端检测到"写/git 腿被系统实时防护瞬时拒绝"后提议这件事；**排除哪些目录由客户端决定**
      // （后端不带任何路径）。这里把当前工作区并入已登记项目集，再让 sidecar 自算缺少的集合，
      // 一次性提权批量加入。是否需要 UAC 由 sidecar 判断：全都已排除就不会弹框。
      // 诚实纪律：以 sidecar"重新读取排除列表"的判定为准，不把"发出了提权请求"当成"已生效"。
      try {
        // 人批准才执行：这是后端在"写/git 腿被实时防护拒绝"后自动发来的提议，不是用户主动点的。
        // 加入排除项会降低该目录实时防护，必须由用户显式点头（随后还会弹一次 UAC）。
        const approved = await confirmRunCommand(
          { action: 'run', command: 'Add-MpPreference -ExclusionPath <本项目目录>', args: [] },
          '把项目目录加入 Windows Defender 白名单会降低该目录的实时防护，且需要管理员权限（会弹 UAC）。',
          onLog
        )
        if (!approved) {
          onLog?.(`[AgentCMD] defender_exclude REJECTED by user\n`)
          return JSON.stringify({ defender: 'rejected' })
        }
        const regPaths = workspaceDir ? [workspaceDir] : []
        if (regPaths.length) {
          try { await localApi.post('/api/local/workspaces/register', { paths: regPaths }) } catch (e) { /* 登记失败不阻断 ensure */ }
        }
        try {
          const st = await localApi.get('/api/local/defender/status')
          if (st.data?.supported === false) {
            onLog?.(`[AgentCMD] defender_exclude 不支持: ${st.data?.reason || 'unknown'}\n`)
            return JSON.stringify({ defender: 'unsupported', reason: st.data?.reason || 'unknown' })
          }
          const pending = (st.data?.projects || []).filter(p => p.excluded === false).map(p => p.path)
          onLog?.(`[AgentCMD] defender_exclude pending=${pending.length} ${pending.join(', ')}\n`)
        } catch (e) {
          onLog?.(`[AgentCMD] defender_exclude status failed: ${e.response?.data?.error || e.message}\n`)
        }
        const res = await localApi.post('/api/local/defender/ensure', { paths: regPaths })
        const d = res.data || {}
        onLog?.(`[AgentCMD] defender_exclude ok=${d.ok} alreadyOk=${d.alreadyOk} added=${(d.added || []).length} stillMissing=${(d.stillMissing || []).length} msg=${d.message || ''}\n`)
        return JSON.stringify({
          defender: d.ok ? 'ok' : 'failed',
          already_ok: d.alreadyOk === true,
          requested: d.requested || [],
          added: d.added || [],
          still_missing: d.stillMissing || [],
          reason: d.reason || null,
          message: d.message || null,
        })
      } catch (e) {
        const detail = e.response?.data?.error || e.message
        onLog?.(`[AgentCMD] defender_exclude failed: ${detail}\n`)
        return JSON.stringify({ defender: 'failed', error: detail })
      }
    }
    default:
      // [F47 修复轮] 走到这里 = 这个包里没有该动作的 case（后端新加的动作 + 浏览器加载旧包）。
      // 回结构化标记而不是自由文本：后端据此一步收场，不会把"前端不认识"当成"环境还没探明白"
      // 再空转一档复探（2026-10-02 一轮为此烧掉 4 次往返，一个环境事实都没拿到）。
      return unsupportedActionPayload(cmd.action)
  }
}

/**
 * Show an Ant Design modal asking the user to confirm a `run` command.
 * Returns a Promise<boolean> — true if the user approved, false otherwise.
 *
 * @param {object} cmd
 * @param {string} reason
 * @param {(line:string)=>void} [onLog]
 * @param {{allowTrust?: boolean}} [opts] allowTrust=false 时**不提供**「本次信任」勾选，
 *   也绝不把这条命令写进信任表 —— 起进程/杀进程这类动作不可复用（{@link confirmStopPid} 同一条纪律）。
 */
function confirmRunCommand(cmd, reason, onLog, opts = {}) {
  return new Promise((resolve) => {
    const summary = formatCommandSummary(cmd)
    const cwd = cmd.cwd || '(no cwd)'
    const timeout = cmd.timeout_seconds || 60
    const allowTrust = opts.allowTrust !== false
    // Hold the trust-for-session flag in a closure so onOk can read it.
    let trustForSession = false
    let resolved = false
    const finish = (ok) => {
      if (resolved) return
      resolved = true
      if (ok && allowTrust && trustForSession) {
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
        <label style={{ display: allowTrust ? 'flex' : 'none', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 12 }}>
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

/**
 * [C·2026-10-31] `proc_stop {pid}` 的确认框：确认的对象是**那一个进程**（pid）。
 *
 * <p>为什么单开一格：按 task_id 停走的是端侧台账（模型只能抄回本会话见过的 id，成员闸在服务端，
 * 天然没有"杀错人"的面）；而按 pid 停是**手填一个数字**——服务端能验的只有"是不是自己"，
 * 剩下"这个 pid 到底是不是我要停的那个服务"只有用户能判。所以框里摊 pid + 一句"会连子进程一起杀"，
 * 且与 {@link confirmSweep} 同一条纪律：<b>不提供</b>「本次信任」。</p>
 */
function confirmStopPid(pid, reason, onLog) {
  return new Promise((resolve) => {
    let resolved = false
    const finish = (ok) => {
      if (resolved) return
      resolved = true
      resolve(ok)
    }
    const content = (
      <div>
        <p style={{ marginBottom: 8 }}>
          <strong>警告</strong>: 这一步会强杀进程 <b>pid={pid}</b> 及其子进程树，且不受 git 撤销影响。
        </p>
        <p style={{ marginBottom: 4 }}>
          <strong>为什么危险</strong>: {reason || '按 pid 杀进程不会核对它是不是你要停的服务 —— 杀错了只能重起。'}
        </p>
        <p style={{ marginTop: 8, marginBottom: 0, color: '#666', fontSize: 12 }}>
          确认这个 pid 就是你要停的那一个，再点「终止」；不确定就先 proc_status / proc_port_probe 核一下。
        </p>
      </div>
    )
    Modal.confirm({
      title: '确认终止该进程',
      content,
      okText: '终止',
      okButtonProps: { danger: true },
      cancelText: '取消',
      width: 560,
      maskClosable: false,
      onOk: () => {
        onLog?.(`[AgentCMD] proc_stop pid=${pid} 用户已确认\n`)
        finish(true)
      },
      onCancel: () => finish(false),
    })
  })
}

/**
 * [C·2026-10-31] `proc_sweep` 的确认框：确认的对象是**命中的进程**, 不是一条命令。
 *
 * <p>为什么单开一个而不是复用 {@link confirmRunCommand}：那个框的词是"要执行这条命令"，而 sweep
 * 没有命令可给 —— 它按 cwd 匹配，用户能核对的事实只有"要杀哪几个 pid、它们各自的命令行"。
 * 把 pid 与命令行摊在框里，才谈得上"用户自己确认"；同时也**刻意不提供"本次信任"**：
 * 杀进程不是可复用的安全形状，点过一次不该让后面静默通过（确认疲劳是这类框最大的失效模式）。</p>
 */
function confirmSweep(candidates, reason, onLog) {
  return new Promise((resolve) => {
    const rows = candidates.slice(0, 20)
    let resolved = false
    const finish = (ok) => {
      if (resolved) return
      resolved = true
      resolve(ok)
    }
    const content = (
      <div>
        <p style={{ marginBottom: 8 }}>
          <strong>警告</strong>: 这一步会<b>强杀</b>有归属证据指向该工作区的进程，并连同子进程一起终止
          （证据分三级，见下；每一条都标着它是靠哪一级进来的）。它不受 git 撤销影响，杀错了只能重起。
        </p>
        <p style={{ marginBottom: 4 }}><strong>为什么危险</strong>: {reason}</p>
        <p style={{ marginBottom: 4 }}><strong>将终止 {candidates.length} 个进程</strong>:</p>
        <pre
          style={{
            background: '#1f1f1f', color: '#f5f5f5', padding: 12, borderRadius: 4,
            overflow: 'auto', maxHeight: 240, margin: 0, fontSize: 12,
          }}
        >
          {rows.map((c) => `${c.pid}  [${c.evidence || 'path'}]  ${String(c.cmd || '').slice(0, 160)}`).join('\n')}
          {candidates.length > rows.length ? `\n…（还有 ${candidates.length - rows.length} 条未列出）` : ''}
        </pre>
        <p style={{ marginTop: 8, marginBottom: 0, color: '#666', fontSize: 12 }}>
          <b>tree</b> = 本会话起的后台任务的进程树；<b>port</b> = 正听本会话为该工作区观测到过的端口；
          <b>path</b> = 命令行里写到了这个目录（弱证据，要重点看）。<br />
          确认上面每一个都是你要停的那一个，再点「终止」；不确定就点「取消」。
        </p>
      </div>
    )
    Modal.confirm({
      title: '确认终止这些进程',
      content,
      okText: '终止',
      okButtonProps: { danger: true },
      cancelText: '取消',
      width: 640,
      maskClosable: false,
      onOk: () => {
        onLog?.(`[AgentCMD] proc_sweep 用户确认终止 ${candidates.length} 条\n`)
        finish(true)
      },
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
