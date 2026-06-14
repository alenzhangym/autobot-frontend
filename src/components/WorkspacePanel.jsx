import React, { useState, useCallback, useEffect } from 'react'
import { Layout, Input, Button, Tree, Space, Typography, message, Spin, Modal, List } from 'antd'
import { FolderOpenOutlined, FileOutlined, ReloadOutlined, SaveOutlined, EditOutlined, HomeOutlined } from '@ant-design/icons'
import api, { getBackendHost, getLocalAgentBaseUrl } from '../auth'
import axios from 'axios'
import { shouldRequireConfirmation, formatCommandSummary, addTrustedPattern, patternFromCommand } from './agentCommandSafety'
import { extractTrailingStateJson } from '../utils/helpers.jsx'

const localApi = axios.create({ baseURL: getLocalAgentBaseUrl() })

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

const getInitialBrowsePath = () => {
  if (typeof window !== 'undefined') {
    if (isWindows()) {
      return 'C:\\'
    }
    return '/'
  }
  return '/'
}

export default function WorkspacePanel({ workspaceDir, onDirChange, sessionId }) {
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
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {editing ? (
            <TextArea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{
                background: '#111', color: '#ccc', border: '1px solid #333',
                fontFamily: 'monospace', fontSize: 12, resize: 'none',
                height: '100%', minHeight: 200
              }}
            />
          ) : (
            <pre style={{
              color: '#ccc', fontSize: 11, fontFamily: 'monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              margin: 0, lineHeight: 1.5
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
    </div>
  )
}

function extractTrailingAnalysisStateJson(content) {
  // Delegate to the shared depth-tracking utility in helpers.jsx.
  // Avoids the previous `lastIndexOf('{"__state"')` heuristic which
  // could match the wrong occurrence on nested content.
  return extractTrailingStateJson(content) || ''
}

// ── Streaming __CMD__ pre-dispatch ───
// When the LLM streams tokens via WebSocket, we intercept __CMD__ blocks and
// dispatch them immediately so file reads / scans complete before the full
// HTTP response arrives.  Results are cached per command-id; the regular
// executeAgentCommands path reuses them to avoid double execution.

/** Shared cache: commandId → result string. Populated by the stream dispatcher. */
export const streamedCmdResults = new Map()

let streamBuffer = ''

/**
 * Scan a streaming text buffer for complete {@code __CMD__{...}} blocks.
 * Dispatches read-only commands immediately; stores results in
 * {@link #streamedCmdResults}.  Returns the number of commands dispatched.
 * Thread-safe enough for single-session use (one WS stream).
 */
export function tryStreamDispatch(workspaceDir, onLog, sessionId) {
  const text = streamBuffer
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
          if (cmd && cmd.action && !streamedCmdResults.has(cmd.id)) {
            // Fire-and-forget: dispatch read-only commands immediately
            executeSingleCommand(cmd, workspaceDir, onLog, sessionId).then(r => {
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
export function appendStreamToken(token) {
  streamBuffer += token
}

/** Reset the streaming buffer (new message). */
export function resetStreamBuffer() {
  streamBuffer = ''
}

// ── Full-response command executor ───

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
        onLog?.(`[AgentCMD] JSON parse failed: ${e.message}\n`)
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
  const readActions = new Set(['read', 'scan', 'tree_sync', 'ls', 'diff'])
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
    let r = streamedCmdResults.get(cmd.id)
    if (r !== undefined) {
      onLog?.(`[AgentCMD] Reusing streamed ${cmd.action} id=${cmd.id || '(none)'}\n`)
    } else {
      r = readResults[i]
      streamedCmdResults.set(cmd.id, r)
    }
    results.push(`[RESULT:${cmd.id}]\n${r}`)
  }

  for (const cmd of mutCmds) {
    let r = streamedCmdResults.get(cmd.id)
    if (r !== undefined) {
      onLog?.(`[AgentCMD] Reusing streamed ${cmd.action} id=${cmd.id || '(none)'}\n`)
    } else {
      const targetPath = cmd.path || workspaceDir || '(empty)'
      onLog?.(
        `[AgentCMD] Running ${cmd.action} id=${cmd.id || '(none)'} path=${targetPath}${formatCommandLogMeta(cmd)}\n`
      )
      r = await executeSingleCommand(cmd, workspaceDir, onLog, sessionId)
        streamedCmdResults.set(cmd.id, r)
      }
    results.push(`[RESULT:${cmd.id}]\n${r}`)
  }

  // Preserve the full trailing state JSON so backend can recover the next round correctly
  const stateJson = extractTrailingAnalysisStateJson(text)

  return `[COMMAND_RESULTS]\n${results.join('\n\n')}\n\n${stateJson}`
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
            const writeRes = await localApi.post('/api/local/workspace/write', {
              path: target,
              content: newContent,
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
    case 'run': {
      // ── Safety gate ─────────────────────────────────────────────────
      // Every `run` command requires user confirmation by default. The
      // backend flags the command via `requires_confirmation` and a
      // defense-in-depth pattern scan also runs here. If either signals
      // danger, pop a modal and let the user explicitly approve.
      const dangerReason = shouldRequireConfirmation(cmd)
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
          cwd: cmd.cwd || workspaceDir,
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

function formatRunOutput(output, exitCode, timedOut) {
  if (typeof output !== 'string') output = String(output || '')
  let suffix = ''
  if (timedOut) suffix += `\n[Execution timed out]`
  else if (exitCode !== 0) suffix += `\n[exit=${exitCode}]`
  return output + suffix
}
