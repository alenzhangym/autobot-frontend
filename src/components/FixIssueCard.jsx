import React, { useMemo, useState, useEffect } from 'react'
import { Tag, Typography, Space, Spin } from 'antd'
import {
  CheckCircleFilled, CloseCircleFilled, LoadingOutlined,
  ToolOutlined, FileTextOutlined
} from '@ant-design/icons'
import api from '../auth'
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
export default function FixIssueCard({ msg, sessionId }) {
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

  // ── 冷启动对账（HARDENING 2026-09-06, ft-b07ba95a）──────────
  // 页面刷新后 context（WS）里没有该任务，且后端任务若已丢失
  // （重启后内存态清空），meta 兜底会永远显示"正在修复 IN_PROGRESS"。
  // 这里在 context 无状态时对照单任务端点对账一次：
  //   - 404 → 任务已失效，渲染为 修复失败 + 原因
  //   - 后端已到终态（completed/failed/designed）→ 直接渲染终态
  //   - 后端仍在运行（RUNNING）→ 保持 IN_PROGRESS，等 WS 重新同步
  const [probe, setProbe] = useState(null)   // null | { status, reason }
  useEffect(() => {
    if (taskState) { setProbe(null); return }
    const taskId = metaKeys.taskId
    if (!taskId || !sessionId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get(`/fix-tasks/${sessionId}/${taskId}`)
        const st = r && r.data && r.data.task && r.data.task.status
        if (!cancelled && st && ['completed', 'failed', 'designed'].includes(String(st).toLowerCase())) {
          setProbe({ status: String(st).toLowerCase() })
        }
      } catch (e) {
        if (!cancelled && e && e.response && e.response.status === 404) {
          setProbe({ status: 'failed', reason: '修复任务已失效（后端重启或任务状态丢失），请重新发起修复' })
        }
      }
    })()
    return () => { cancelled = true }
  }, [taskState, metaKeys.taskId, sessionId])

  // 计算显示状态：context > probe > meta > 兜底 in-progress
  const status = useMemo(() => {
    if (taskState && taskState.status) return String(taskState.status).toUpperCase()
    if (probe && probe.status) return String(probe.status).toUpperCase()
    const metaType = meta && meta.type
    if (metaType === 'fix_issue') return 'IN_PROGRESS'
    if (metaType === 'fix_summary') return String(meta.status || 'COMPLETED').toUpperCase()
    return 'IN_PROGRESS' // 兜底
  }, [taskState, meta, probe])

  // 失效原因：context 对账 > 卡片冷启动对账
  const failureReason = (taskState && taskState.failureReason) || (probe && probe.reason) || null

  const isInProgress = status === 'IN_PROGRESS' || status === 'RUNNING'
  const isCompleted = status === 'COMPLETED'
  const isFailed = status === 'FAILED'
  // HARDENING (2026-09-06, ft-5e9a52e1): requirement-clarification /
  // missing-feature issues terminate with DESIGNED — the chat bubble
  // carries the "📋 已生成设计方案" body built by buildFixSummaryContent.
  const isDesigned = status === 'DESIGNED'
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
  } else if (isDesigned) {
    icon = <FileTextOutlined style={{ color: '#faad14' }} />
    label = '已生成设计方案'
    tagColor = 'gold'
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
      {/* 失效/中断任务：对账纠正为 failed 时给出原因，避免只显示"修复失败"没下文 */}
      {isFailed && failureReason && (
        <div style={{ fontSize: 12, color: '#ff7875', margin: '2px 0 6px' }}>
          {failureReason}
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
