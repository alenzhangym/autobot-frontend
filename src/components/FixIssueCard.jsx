import React, { useMemo } from 'react'
import { Tag, Typography, Space, Spin } from 'antd'
import {
  CheckCircleFilled, CloseCircleFilled, LoadingOutlined,
  ToolOutlined, FileTextOutlined
} from '@ant-design/icons'
import { MarkdownContent } from '../utils/helpers.jsx'

const { Text } = Typography

/**
 * Inline card rendered in the chat stream for messages whose
 * {@code meta.type} is {@code "fix_issue"} (placeholder) or
 * {@code "fix_summary"} (terminal). Designed to give the user
 * a single, stable, scannable card that morphs from "正在
 * 修复…" to the final verdict as the backend updates the
 * message row in place.
 *
 * Why a dedicated card (and not just the raw {@code content}
 * string): the placeholder is intentionally terse ("🔧 已
 * 开始修复…"), the terminal summary is a multi-line diff. A
 * shared card keeps the two states visually continuous, and
 * preserves the file list + diff the user actually wants to
 * see.
 *
 * Props:
 *   msg — the message object. We read {@code msg.meta}
 *     (JSON string) and {@code msg.content} (string body).
 *     The card is purely a function of those two fields, so
 *     the parent's reload-on-update path is enough to keep
 *     it in sync.
 */
export default function FixIssueCard({ msg }) {
  const meta = useMemo(() => {
    if (!msg || !msg.meta) return null
    try { return JSON.parse(msg.meta) } catch (_) { return null }
  }, [msg?.meta])

  // Not a fix-issue / fix-summary message — bail out and let
  // MessageBubble render the raw content the usual way.
  if (!meta || (meta.type !== 'fix_issue' && meta.type !== 'fix_summary')) {
    return null
  }

  const status = String(meta.status || '').toUpperCase()
  const isInProgress = status === 'IN_PROGRESS' || status === 'RUNNING'
  const isCompleted = status === 'COMPLETED'
  const isFailed = status === 'FAILED'
  // Patches are only present in the terminal meta envelope
  // (buildFixSummaryMeta). During the in-progress phase the
  // placeholder has no patches; we render the spinner only.
  const patches = Array.isArray(meta.patches) ? meta.patches : []
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
