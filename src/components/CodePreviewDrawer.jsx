import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Drawer, Tabs, Spin, Tag, Typography, Space, Button, Tooltip, Segmented, Empty } from 'antd'
import { FileTextOutlined, DiffOutlined, CopyOutlined, ReloadOutlined, CodeOutlined } from '@ant-design/icons'
import axios from 'axios'
import { getLocalAgentBaseUrl } from '../auth'

const { Text } = Typography

const localApi = axios.create({ baseURL: getLocalAgentBaseUrl(), timeout: 600000 })

/**
 * 代码预览 Drawer — 点击「定位代码」/「Git Diff」时从右侧滑出（约 55% 宽）。
 *
 * <ul>
 *   <li>文件 tab：读取工作区文件，带行号 + 高亮目标行（点击 issue 定位到的行）</li>
 *   <li>Git Diff tab：调用本地 agent 的 /api/local/workspace/git_diff，
 *       展示真实 git diff（相对 HEAD），支持"当前文件 / 整个工作区"两种范围</li>
 * </ul>
 *
 * Props:
 *   open        是否打开
 *   onClose     关闭回调
 *   filePath    issue.filePath（相对或绝对路径）
 *   line        目标行号（1-based, 可选）
 *   workspaceDir 工作区根（用于解析相对路径）
 *   initialTab  'file'（默认）| 'diff'
 *   titlePrefix 标题前缀（如「修复后的改动」）
 */
export default function CodePreviewDrawer({
  open, onClose, filePath, line, workspaceDir, initialTab = 'file', titlePrefix
}) {
  const [tab, setTab] = useState(initialTab)
  const [content, setContent] = useState('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [readError, setReadError] = useState('')

  const [diffScope, setDiffScope] = useState('file')   // 'file' | 'repo'
  const [diffText, setDiffText] = useState('')
  const [diffMeta, setDiffMeta] = useState(null)        // { repoRoot, exit_code }
  const [loadingDiff, setLoadingDiff] = useState(false)

  const bodyRef = useRef(null)

  const resolvedPath = useMemo(() => {
    if (!filePath) return ''
    if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\')) {
      return filePath
    }
    if (workspaceDir) {
      const sep = workspaceDir.includes('\\') ? '\\' : '/'
      return workspaceDir.replace(/[\\/]+$/, '') + sep + filePath.replace(/^[\\/]+/, '')
    }
    return filePath
  }, [filePath, workspaceDir])

  // 打开 / 切换文件时重新加载
  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    loadFile()
  }, [open, filePath, initialTab])

  const loadFile = useCallback(async () => {
    if (!resolvedPath) return
    setLoadingFile(true)
    setReadError('')
    try {
      const res = await localApi.post('/api/local/workspace/read', { path: resolvedPath })
      setContent(res.data?.content || '')
    } catch (e) {
      setContent('')
      setReadError(e.response?.data?.error || e.message)
    }
    setLoadingFile(false)
  }, [resolvedPath])

  const loadDiff = useCallback(async () => {
    if (!resolvedPath) return
    setLoadingDiff(true)
    setDiffMeta(null)
    try {
      const res = await localApi.post('/api/local/workspace/git_diff', {
        path: diffScope === 'repo' ? (workspaceDir || resolvedPath) : resolvedPath,
        scope: diffScope
      })
      setDiffText(res.data?.diff || '')
      setDiffMeta({ repoRoot: res.data?.repoRoot, exit_code: res.data?.exit_code })
    } catch (e) {
      setDiffText('')
      setDiffMeta({ error: e.response?.data?.error || e.message })
    }
    setLoadingDiff(false)
  }, [resolvedPath, diffScope, workspaceDir])

  useEffect(() => {
    if (open && tab === 'diff') loadDiff()
  }, [open, tab, loadDiff])

  // 目标行高亮 + 滚动
  useEffect(() => {
    if (open && tab === 'file' && content && line > 0) {
      // 等 DOM 渲染后再滚
      requestAnimationFrame(() => {
        const el = bodyRef.current && bodyRef.current.querySelector(`[data-code-line="${line}"]`)
        if (el) el.scrollIntoView({ block: 'center' })
      })
    }
  }, [open, tab, content, line])

  const lines = useMemo(() => (content ? content.split('\n') : []), [content])

  const title = (() => {
    const base = filePath || ''
    const loc = line > 0 ? `:${line}` : ''
    return `${titlePrefix ? titlePrefix + ' · ' : ''}${base}${loc}`
  })()

  return (
    <Drawer
      placement="right"
      width="55%"
      open={open}
      onClose={onClose}
      title={
        <Space size={6} wrap>
          <CodeOutlined style={{ color: 'var(--ab-copper, #d4a574)' }} />
          <Text style={{ fontFamily: 'monospace', fontSize: 13 }}>{title}</Text>
          {resolvedPath && <Tag style={{ fontSize: 11 }}>工作区</Tag>}
        </Space>
      }
      styles={{ body: { padding: 0, background: '#0d0d0d' } }}
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        style={{ height: '100%' }}
        tabBarStyle={{ marginBottom: 0, padding: '0 12px', background: '#141414' }}
        items={[
          {
            key: 'file',
            label: <span><FileTextOutlined /> 文件</span>,
            children: (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 12px', background: '#141414', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: '#888', fontSize: 11 }}>{resolvedPath}</Text>
                  <Tooltip title="刷新">
                    <Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadFile} />
                  </Tooltip>
                </div>
                {loadingFile ? (
                  <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
                ) : readError ? (
                  <div style={{ padding: 24, color: '#ff4d4f', fontSize: 13 }}>读取失败: {readError}</div>
                ) : (
                  <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, lineHeight: 1.6, padding: '8px 0' }}>
                    {lines.map((l, i) => {
                      const n = i + 1
                      const isTarget = n === line
                      return (
                        <div
                          key={n}
                          data-code-line={n}
                          style={{
                            display: 'flex',
                            background: isTarget ? 'rgba(212, 165, 116, 0.14)' : 'transparent',
                            borderLeft: isTarget ? '3px solid var(--ab-copper, #d4a574)' : '3px solid transparent'
                          }}
                        >
                          <span style={{ width: 56, flexShrink: 0, textAlign: 'right', paddingRight: 8, color: '#555', userSelect: 'none' }}>{n}</span>
                          <span style={{ color: '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1, paddingRight: 12 }}>
                            {l || '\u00a0'}
                          </span>
                        </div>
                      )
                    })}
                    {lines.length === 0 && (
                      <div style={{ padding: 24, color: '#888' }}>（空文件）</div>
                    )}
                  </div>
                )}
              </div>
            )
          },
          {
            key: 'diff',
            label: <span><DiffOutlined /> Git Diff</span>,
            children: (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 12px', background: '#141414', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Segmented
                    size="small"
                    value={diffScope}
                    onChange={setDiffScope}
                    options={[
                      { label: '当前文件', value: 'file' },
                      { label: '整个工作区', value: 'repo' }
                    ]}
                  />
                  <Space size={4}>
                    {diffMeta?.repoRoot && (
                      <Text style={{ color: '#666', fontSize: 10 }}>{diffMeta.repoRoot}</Text>
                    )}
                    <Tooltip title="刷新 diff">
                      <Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadDiff} />
                    </Tooltip>
                    {diffText && (
                      <Tooltip title="复制 diff">
                        <Button size="small" type="text" icon={<CopyOutlined />} onClick={async () => {
                          try { await navigator.clipboard.writeText(diffText) } catch (_) {}
                        }} />
                      </Tooltip>
                    )}
                  </Space>
                </div>
                {loadingDiff ? (
                  <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
                ) : diffMeta?.error ? (
                  <div style={{ padding: 24, color: '#ff4d4f', fontSize: 13 }}>获取 diff 失败: {diffMeta.error}</div>
                ) : diffText ? (
                  <DiffViewer diff={diffText} />
                ) : (
                  <div style={{ padding: 24 }}>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={diffMeta?.repoRoot === null
                        ? '目标不在 git 仓库内（未找到 .git），无法生成 git diff'
                        : '相对 HEAD 无改动（工作区干净）'}
                    />
                  </div>
                )}
              </div>
            )
          }
        ]}
      />
    </Drawer>
  )
}

/**
 * 渲染 unified diff：`diff --git` / 文件头 灰显, `@@` 青色,
 * `-` 红底, `+` 绿底, 其余上下文默认色。
 */
function DiffViewer({ diff }) {
  const rows = useMemo(() => diff.split('\n'), [diff])
  return (
    <div style={{ flex: 1, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, lineHeight: 1.6, padding: '8px 0' }}>
      {rows.map((l, i) => {
        let kind = 'context'
        let bg = 'transparent'
        let color = '#bbb'
        if (/^diff --git|^index |^--- |^\+\+\+ /.test(l)) {
          kind = 'meta'; color = '#8a8a8a'; bg = 'transparent'
        } else if (/^@@ /.test(l)) {
          kind = 'hunk'; color = '#5ac8fa'; bg = 'rgba(90,200,250,0.08)'
        } else if (l.startsWith('+')) {
          kind = 'added'; color = '#52c41a'; bg = 'rgba(82,196,26,0.10)'
        } else if (l.startsWith('-')) {
          kind = 'removed'; color = '#ff4d4f'; bg = 'rgba(255,77,79,0.10)'
        }
        return (
          <div key={i} style={{ display: 'flex', background: bg }}>
            <span style={{ width: 28, flexShrink: 0, textAlign: 'right', paddingRight: 8, color: '#555', userSelect: 'none' }}>
              {l.startsWith('+') ? '+' : l.startsWith('-') ? '-' : ' '}
            </span>
            <span style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1, paddingRight: 12 }}>
              {l || '\u00a0'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
