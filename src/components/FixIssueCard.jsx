import React, { useMemo } from 'react'
import { Tag, Typography, Space, Spin } from 'antd'
import {
  CheckCircleFilled, CloseCircleFilled, LoadingOutlined,
  ToolOutlined, FileTextOutlined
} from '@ant-design/icons'
import { MarkdownContent } from '../utils/helpers.jsx'
import { useFixTaskContext, extractFixTaskKeysFromMessage } from '../context/FixTaskContext.jsx'

const { Text } = Typography

/**
 * Inline card rendered in the chat stream for messages tied to a
 * fix task (placeholder / in-progress / terminal). S1 起：
 * <ul>
 *   <li>不再从 {@code msg.meta} 解析 status / patches / taskId
 *       —— 状态从 {@link useFixTaskContext}（WS 唯一真源）取</li>
 *   <li>msg.meta 仅作"key 兜底"读 taskId/issueId 字段（不改 DB schema）</li>
 *   <li>无 WS 状态时按"in-progress 占位"渲染，避免空白</li>
 * </ul>
 */
export default function FixIssueCard({ msg }) {
  const meta = useMemo(() => {
    if (!msg || !msg.meta) return null
    try { return JSON.parse(msg.meta) } catch (_) { return null }
  }, [msg?.meta])

  const { getFixTaskByTaskId, getFixTaskForIssue } = useFixTaskContext()
  // msg.meta 仅作 key 兜底：拿 taskId / issueId
  const metaKeys = useMemo(() => extractFixTaskKeysFromMessage(msg), [msg?.meta])
  // 真实状态走 context（WS）
  const taskState = useMemo(() => {
    if (metaKeys.taskId) return getFixTaskByTaskId(metaKeys.taskId)
    if (metaKeys.issueId) return getFixTaskForIssue(metaKeys.issueId)
    return null
  }, [metaKeys.taskId, metaKeys.issueId, getFixTaskByTaskId, getFixTaskForIssue])

  // 计算显示状态：context > meta > 兜底 in-progress
  const status = useMemo(() => {
    if (taskState && taskState.status) return String(taskState.status).toUpperCase()
    const metaType = meta && meta.type
    if (metaType === 'fix_issue') return 'IN_PROGRESS'
    if (metaType === 'fix_summary') return String(meta.status || 'COMPLETED').toUpperCase()
    return 'IN_PROGRESS' // 兜底
  }, [taskState, meta])

  const isInProgress = status === 'IN_PROGRESS' || status === 'RUNNING'
  const isCompleted = status === 'COMPLETED'
  const isFailed = status === 'FAILED'
  // patches 优先 context；context 没有时退到 meta（兼容老消息）
  const patches = useMemo(() => {
    if (taskState && Array.isArray(taskState.patches) && taskState.patches.length > 0) {
      return taskState.patches
    }
    return Array.isArray(meta && meta.patches) ? meta.patches : []
  }, [taskState, meta])

  const files = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const p of patches) {
      if (p && p.file && !seen.has(p.file)) { seen.add(p.file); out.push(p.file) }
    }
    return out
  }, [patches])

  // ── Header chrome: icon + label + status tag + taskId ──
  let icon, label, tagColor
  if (isInProgress) {
    icon = <Spin indicator={<LoadingOutlined spin />} size="small" />
    label = '正在修复'
    tagColor = 'processing'
  } else if (isCompleted) {
    icon = <CheckCircleFilled style={{ color: '#52c41a' }} />
    label = '修复完成'
    tagColor = 'success'
  } else if (isFailed) {
    icon = <CloseCircleFilled style={{ color: '#ff4d4f' }} />
    label = '修复失败'
    tagColor = 'error'
  } else {
    icon = <ToolOutlined style={{ color: '#888' }} />
    label = '修复任务'
    tagColor = 'default'
  }

  return (
    <div
      data-fix-issue-card="true"
      style={{
        background: '#141414',
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: '10px 12px',
        margin: '4px 0',
        maxWidth: '100%'
      }}
    >
      <Space size={6} align="center" style={{ marginBottom: files.length > 0 ? 6 : 0 }}>
        {icon}
        <Text strong style={{ color: '#e3e3e3' }}>{label}</Text>
        <Tag color={tagColor} style={{ fontSize: 11 }}>{status || 'PENDING'}</Tag>
        {meta.taskId && (
          <Text type="secondary" style={{ fontSize: 11 }} copyable={{ tooltips: ['复制 taskId', '已复制'] }}>
            {meta.taskId}
          </Text>
        )}
      </Space>
      {files.length > 0 && (
        <div style={{ marginBottom: 6, color: '#bbb', fontSize: 12 }}>
          <FileTextOutlined style={{ marginRight: 4 }} />
          {files.map((f, i) => (
            <React.Fragment key={f}>
              {i > 0 && <span style={{ color: '#666' }}> · </span>}
              <code style={{ background: '#1f1f1f', padding: '1px 5px', borderRadius: 3 }}>{f}</code>
            </React.Fragment>
          ))}
        </div>
      )}
      {/* Body: the message's own content. For the placeholder
          this is "🔧 已开始修复…"; for the terminal summary
          this is the buildFixSummaryContent output (verdict +
          diff). Rendered as Markdown so diff code blocks stay
          highlighted. */}
      {msg.content && (
        <div style={{ fontSize: 13, color: '#e3e3e3' }}>
          <MarkdownContent content={msg.content} />
        </div>
      )}
    </div>
  )
}
