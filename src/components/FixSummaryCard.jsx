import React, { useState, useMemo } from 'react'
import {
  Card, Tag, Typography, Space, Button, Tooltip, Collapse,
  Empty, Row, Col
} from 'antd'
import {
  CheckCircleFilled, CloseCircleFilled, MinusCircleOutlined,
  CodeOutlined, FileTextOutlined, CaretRightOutlined,
  CopyOutlined
} from '@ant-design/icons'
import SemanticValidationBadge from './SemanticValidationBadge'

const { Text, Paragraph } = Typography

/**
 * One-shot "fix completed" summary card, driven by the
 * `fix-task.completed` WebSocket event. Renders the verdict
 * (VERIFIED / FAILED), the build command and outcome, and
 * a per-file line-level diff of every APPLIED patch. This is
 * the only place in the UI where the user sees the actual
 * diff; the `fix-task.phase` events carry only phase names.
 *
 * Props:
 *   summary — the FixSummary object as serialised by
 *     FixSummary.toMap() on the backend. Wire shape:
 *     {
 *       type: "fix-task.completed",
 *       taskId, issueId, status: "COMPLETED", ts,
 *       verification: { verdict, buildRan, buildPassed,
 *         buildCommand, buildExitCode, buildOutput },
 *       diffs: [{
 *         filePath, patchIndex, oldLineCount, newLineCount,
 *         lines: [{ kind: "removed"|"added", text }]
 *       }]
 *     }
 *   onClose — optional callback. If provided, a small × shows
 *     in the top-right; the parent usually opens this card in
 *     a Modal and uses onClose to dismiss it. When embedded
 *     inline (e.g. inside a chat message), omit onClose.
 *   compact — when true, hide the build output by default and
 *     show a smaller header. Used when many fix results are
 *     stacked in a chat history.
 */
export default function FixSummaryCard({ summary, onClose, compact = false, workspaceId }) {
  if (!summary) return null
  const v = summary.verification || {}
  const diffs = Array.isArray(summary.diffs) ? summary.diffs : []
  const verdict = (v.verdict || '').toUpperCase()
  const isVerified = verdict === 'VERIFIED'

  return (
    <Card
      size={compact ? 'small' : 'default'}
      className="fix-summary-card"
      title={
        <Space>
          {isVerified
            ? <CheckCircleFilled style={{ color: '#52c41a' }} />
            : <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
          <span>修复完成 · {isVerified ? '已通过校验' : '校验未通过'}</span>
          <Tag color={isVerified ? 'success' : 'error'}>{verdict || 'UNKNOWN'}</Tag>
          {summary.taskId && (
            <Text type="secondary" style={{ fontSize: 12 }} copyable>
              {summary.taskId}
            </Text>
          )}
        </Space>
      }
      extra={onClose && <Button type="text" size="small" onClick={onClose}>×</Button>}
      style={{ marginBottom: 12 }}
    >
      <VerificationSection verification={v} compact={compact} />
      <DiffsSection diffs={diffs} compact={compact} workspaceId={workspaceId} />
      {diffs.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未应用任何补丁（LLM 直接确认通过）"
        />
      )}
    </Card>
  )
}

/**
 * Top section: verdict + build command + exit code + (collapsible)
 * build output. Renders nothing if both buildRan is false AND no
 * buildCommand is present (pure-LLM verdict with no machine
 * signal — rare but possible if BuildVerifier skipped).
 */
function VerificationSection({ verification, compact }) {
  const v = verification || {}
  const ran = !!v.buildRan
  const passed = !!v.buildPassed
  const skipped = !ran
  const showOutput = !compact && (v.buildOutput || '').length > 0
  const exit = v.buildExitCode

  return (
    <div style={{ marginBottom: 12 }}>
      <Row gutter={[8, 8]} align="middle">
        <Col>
          <Space size={4} wrap>
            <Tag color={skipped ? 'default' : (passed ? 'success' : 'error')}>
              {skipped ? '构建跳过' : (passed ? '构建通过' : '构建失败')}
            </Tag>
            {v.buildCommand && (
              <Tag icon={<CodeOutlined />}>
                <span style={{ fontFamily: 'monospace' }}>{v.buildCommand}</span>
              </Tag>
            )}
            {exit != null && exit !== -1 && (
              <Tag color={exit === 0 ? 'success' : 'error'}>
                exit {exit}
              </Tag>
            )}
          </Space>
        </Col>
      </Row>
      {showOutput && (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 4 }}
          items={[{
            key: 'out',
            label: (
              <Text type="secondary" style={{ fontSize: 12 }}>
                构建输出 ({(v.buildOutput || '').length} chars)
              </Text>
            ),
            children: (
              <pre style={{
                fontSize: 12,
                background: '#f5f5f5',
                padding: 8,
                borderRadius: 4,
                maxHeight: 240,
                overflow: 'auto',
                margin: 0
              }}>{v.buildOutput}</pre>
            )
          }]}
        />
      )}
    </div>
  )
}

/**
 * Per-file diff list. Each file is a collapsible panel showing
 * removed (red) then added (green) lines, with `+`/`-` gutter
 * markers. The simple layout matches the backend's
 * `buildFileDiff()` output: removed lines first, then added —
 * the user's mental model is "this is what was removed, this
 * is what replaces it", which is exactly what the LLM patch
 * contained (searchText → replaceText).
 */
function DiffsSection({ diffs, compact, workspaceId }) {
  if (!diffs || diffs.length === 0) return null
  return (
    <Collapse
      defaultActiveKey={compact ? [] : diffs.map(d => `f-${d.patchIndex}`)}
      ghost
      size="small"
      expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
      items={diffs.map(d => ({
        key: `f-${d.patchIndex}`,
        label: <DiffHeader diff={d} workspaceId={workspaceId} />,
        children: <DiffBody diff={d} />
      }))}
    />
  )
}

function DiffHeader({ diff, workspaceId }) {
  const removed = (diff.oldLineCount || 0)
  const added = (diff.newLineCount || 0)
  // 软校验：把 added 行拼成 code 喂给后端
  const softCode = useMemo(() => {
    const lines = Array.isArray(diff.lines) ? diff.lines : []
    return lines.filter(l => l.kind === 'added').map(l => l.text).join('\n')
  }, [diff.lines])
  return (
    <Space>
      <FileTextOutlined />
      <Text style={{ fontFamily: 'monospace', fontSize: 13 }}>
        {diff.filePath}
      </Text>
      <Text type="secondary" style={{ fontSize: 12 }}>
        -{removed} +{added}
      </Text>
      {workspaceId && softCode && (
        <SemanticValidationBadge
          workspaceId={workspaceId}
          filePath={diff.filePath}
          code={softCode}
        />
      )}
    </Space>
  )
}

/**
 * Renders the line list. We pre-compute the gutter symbols
 * (`+` / `-` / ` `) once via useMemo so scrolling the panel
 * doesn't re-render the heavy inner span tree on every
 * keystroke elsewhere in the parent.
 */
function DiffBody({ diff }) {
  const rows = useMemo(() => {
    const lines = Array.isArray(diff.lines) ? diff.lines : []
    return lines.map((l, i) => {
      const kind = l.kind === 'added' ? 'added' : (l.kind === 'removed' ? 'removed' : 'context')
      const sign = kind === 'added' ? '+' : (kind === 'removed' ? '-' : ' ')
      return { sign, kind, text: l.text || '', i }
    })
  }, [diff.lines])

  const onCopyAll = async () => {
    const text = rows.map(r => `${r.sign} ${r.text}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch (_) { /* clipboard may be unavailable in non-secure contexts */ }
  }

  return (
    <div style={{
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      fontSize: 12,
      background: '#fafafa',
      border: '1px solid #f0f0f0',
      borderRadius: 4,
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '2px 6px',
        borderBottom: '1px solid #f0f0f0',
        background: '#f5f5f5'
      }}>
        <Tooltip title="复制 diff">
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={onCopyAll}
          />
        </Tooltip>
      </div>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {rows.map(r => (
          <div
            key={r.i}
            style={{
              padding: '0 8px',
              background: r.kind === 'added'
                ? '#f6ffed'
                : (r.kind === 'removed' ? '#fff1f0' : 'transparent'),
              color: r.kind === 'added'
                ? '#389e0d'
                : (r.kind === 'removed' ? '#cf1322' : 'inherit'),
              whiteSpace: 'pre'
            }}
          >
            <span style={{ color: '#bfbfbf', userSelect: 'none', marginRight: 8 }}>
              {r.sign}
            </span>
            {r.text}
          </div>
        ))}
      </div>
    </div>
  )
}
