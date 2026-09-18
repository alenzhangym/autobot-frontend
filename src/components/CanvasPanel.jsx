import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import {
  Drawer, Tabs, Spin, Button, Tooltip, Typography, Space, Empty, Tag, Input
} from 'antd'
import {
  CodeOutlined, CloseOutlined, FileTextOutlined, GlobalOutlined,
  FolderOpenOutlined, ReloadOutlined, ExportOutlined, DesktopOutlined
} from '@ant-design/icons'
import Convert from 'ansi-to-html'
import axios from 'axios'
import { getLocalAgentBaseUrl } from '../auth'
import { CANVAS_TAB } from '../hooks/useCanvasUiActions'

const { Text } = Typography
const localApi = axios.create({ baseURL: getLocalAgentBaseUrl(), timeout: 600000 })
const converter = new Convert({ fg: '#ccc', bg: '#000', newline: false, escapeXML: true })

/**
 * 代理画布（OpenHands-style Agent Canvas）—— 折叠面板，点开才展开。
 *
 * <ul>
 *   <li><b>运行</b>：复用现有终端输出流（{@code localTerminalOutput}），monospace 渲染。</li>
 *   <li><b>文件</b>：展示 agent 经 {@code navigate_to_file/show_preview} 定位/预览的工作区文件，
 *       点选后经本地代理读文件预览。</li>
 *   <li><b>浏览器</b>：展示 agent 观测到的 URL（快照为文本式，无 DOM 截图），可一键新窗口打开。</li>
 * </ul>
 *
 * 纯展示增强：无 canvas_ui 事件时为近乎空状态；默认折叠，不挤占聊天区。
 */
export default function CanvasPanel({ open, onClose, state, workspaceDir, localTerminalOutput }) {
  const [activeTab, setActiveTab] = useState(state?.activeTab || CANVAS_TAB.FILES)
  const [fileContent, setFileContent] = useState('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [readError, setReadError] = useState('')
  const [selectedPath, setSelectedPath] = useState(null)
  const [browserUrl, setBrowserUrl] = useState('')
  const loadedKeyRef = useRef(null)

  // 外部 state 变化时跟随其 activeTab / 文件
  useEffect(() => {
    if (state?.activeTab) setActiveTab(state.activeTab)
    const last = state?.lastFile
    if (last && last.path && last.path !== loadedKeyRef.current) {
      setSelectedPath(last.path)
    }
  }, [state])

  const resolvePath = useCallback((path) => {
    if (!path) return ''
    if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')) return path
    if (workspaceDir) {
      const sep = workspaceDir.includes('\\') ? '\\' : '/'
      return workspaceDir.replace(/[\\/]+$/, '') + sep + path.replace(/^[\\/]+/, '')
    }
    return path
  }, [workspaceDir])

  const loadFile = useCallback(async (path) => {
    const resolved = resolvePath(path)
    if (!resolved) return
    loadedKeyRef.current = path
    setSelectedPath(path)
    setLoadingFile(true)
    setReadError('')
    try {
      const res = await localApi.post('/api/local/workspace/read', { path: resolved })
      setFileContent(res.data?.content || '')
    } catch (e) {
      setFileContent('')
      setReadError(e.response?.data?.error || e.message)
    }
    setLoadingFile(false)
  }, [resolvePath])

  // 初次打开时若有 lastFile，自动预读一处
  useEffect(() => {
    if (open && state?.lastFile?.path) {
      loadFile(state.lastFile.path)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const renderTerminal = () => {
    const lines = (localTerminalOutput || '').split('\n')
    return (
      <div style={{
        flex: 1, overflow: 'auto', padding: 8, background: '#0a0a0a',
        fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', color: '#ccc'
      }} className="custom-scrollbar">
        {localTerminalOutput
          ? lines.map((l, i) => (
              <div key={i} dangerouslySetInnerHTML={{ __html: converter.toHtml(l || '&nbsp;') }} />
            ))
          : <span style={{ color: '#444' }}>尚无运行输出（agent 执行命令时此处会实时滚动）。</span>}
      </div>
    )
  }

  const renderFiles = () => {
    const files = state?.files || []
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ color: '#888', fontSize: 11, flex: 1 }}>{selectedPath || 'agent 定位的文件'}</Text>
          {selectedPath && (
            <Tooltip title="刷新">
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => loadFile(selectedPath)} />
            </Tooltip>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid #222', overflow: 'auto', padding: '6px 0' }} className="custom-scrollbar">
            {files.length === 0 && (
              <div style={{ padding: 12, color: '#555', fontSize: 12 }}>
                暂无。agent 产出文件后调用<br />navigate_to_file 会出现在这里。
              </div>
            )}
            {files.map((f) => (
              <div
                key={f.path}
                onClick={() => loadFile(f.path)}
                style={{
                  padding: '5px 12px', cursor: 'pointer', fontSize: 12, color: '#bbb',
                  background: f.path === selectedPath ? 'rgba(212,165,116,0.12)' : 'transparent',
                  borderLeft: f.path === selectedPath ? '3px solid var(--ab-copper, #d4a574)' : '3px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 6, wordBreak: 'break-all'
                }}
              >
                <FileTextOutlined style={{ color: '#888' }} />
                <span>{f.label}</span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.6 }} className="custom-scrollbar">
            {loadingFile ? (
              <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
            ) : readError ? (
              <div style={{ padding: 16, color: '#ff4d4f', fontSize: 12 }}>读取失败: {readError}</div>
            ) : fileContent ? (
              <pre style={{ margin: 0, color: '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{fileContent}</pre>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中左侧文件以预览" />
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderBrowser = () => {
    const url = browserUrl || state?.browser?.url || ''
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            size="small"
            value={url}
            onChange={(e) => setBrowserUrl(e.target.value)}
            placeholder="agent 观测到的页面 URL"
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
          {url && (
            <Tooltip title="新窗口打开">
              <Button size="small" icon={<ExportOutlined />} onClick={() => window.open(url, '_blank', 'noopener')}>
                打开
              </Button>
            </Tooltip>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          {state?.browser?.snapshot ? (
            <div style={{
              background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12,
              fontFamily: 'monospace', fontSize: 12, color: '#bbb', whiteSpace: 'pre-wrap'
            }}>
              {state.browser.snapshot}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ fontSize: 12 }}>
                  尚无快照（本项目为文本式观测，暂无 DOM 截图）。<br />
                  agent 调用 web_fetch / web_search 等浏览器工具时会记录 URL。
                </span>
              }
            />
          )}
        </div>
        {state?.browser?.note && (
          <Tag style={{ marginTop: 8, fontSize: 11 }} color="blue">{state.browser.note}</Tag>
        )}
      </div>
    )
  }

  const tabItems = useMemo(() => [
    { key: CANVAS_TAB.TERMINAL, label: <span><CodeOutlined /> 运行</span>, children: <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>{renderTerminal()}</div> },
    { key: CANVAS_TAB.FILES, label: <span><FolderOpenOutlined /> 文件</span>, children: <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>{renderFiles()}</div> },
    { key: CANVAS_TAB.BROWSER, label: <span><GlobalOutlined /> 浏览器</span>, children: <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>{renderBrowser()}</div> },
  ], [localTerminalOutput, state, selectedPath, fileContent, readError, loadingFile, browserUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0, background: '#0d0d0d' } }}
      title={
        <Space size={6}>
          <DesktopOutlined style={{ color: 'var(--ab-copper, #d4a574)' }} />
          <Text style={{ fontSize: 13 }}>Agent 画布</Text>
          {state?.hasActivity ? (
            <Tag color="green" style={{ fontSize: 10, lineHeight: '14px' }}>活跃</Tag>
          ) : (
            <Tag style={{ fontSize: 10, lineHeight: '14px' }}>闲置</Tag>
          )}
        </Space>
      }
      extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} style={{ color: '#888' }} />}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ height: '100%' }}
        tabBarStyle={{ marginBottom: 0, padding: '0 12px', background: '#141414' }}
        items={tabItems}
      />
    </Drawer>
  )
}

CanvasPanel.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  state: PropTypes.shape({ activeTab: PropTypes.string, hasActivity: PropTypes.bool }),
  workspaceDir: PropTypes.string,
  localTerminalOutput: PropTypes.string,
}