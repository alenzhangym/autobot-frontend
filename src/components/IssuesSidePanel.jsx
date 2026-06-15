import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Card, List, Tag, Space, Typography, Button, Empty, Spin, Tooltip, message, Segmented } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined,
  FileTextOutlined, ReloadOutlined, FolderOpenOutlined, ToolOutlined,
  LoadingOutlined, StopOutlined
} from '@ant-design/icons'
import api, { getBackendHost } from '../auth'

const { Text } = Typography

const SEVERITY_COLOR = {
  HIGH: 'red',
  MEDIUM: 'orange',
  LOW: 'blue'
}

const STATUS_TAG = {
  open:        { color: 'default', icon: <MinusCircleOutlined />, label: '待处理' },
  in_progress: { color: 'processing', icon: <LoadingOutlined />, label: '修复中' },
  fixed:       { color: 'success', icon: <CheckCircleOutlined />, label: '已修复' },
  ignored:     { color: 'warning', icon: <CloseCircleOutlined />, label: '已忽略' }
}

export default function IssuesSidePanel({ sessionId, workspaceDir, onJumpToFile }) {
  const [filter, setFilter] = useState('open')   // 'open' | 'in_progress' | 'all' | 'fixed' | 'ignored'
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // Polls more aggressively while there is at least one in-flight
  // (in_progress) issue, so the user sees status transitions without
  // manual refresh. Falls back to a slow idle poll otherwise.
  const pollRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setIssues([])
      return
    }
    setLoading(true)
    try {
      const res = await api.get(`/api/code-analysis/${sessionId}/issues`,
        { baseURL: getBackendHost() })
      setIssues(res.data?.issues || [])
    } catch (e) {
      message.error('加载问题失败: ' + (e.response?.data?.message || e.message))
      setIssues([])
    }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { refresh() }, [refresh])

  // Adaptive polling: 2s while any issue is in_progress, 15s otherwise.
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (!sessionId) return
    const hasInProgress = issues.some(i => (i.status || 'open') === 'in_progress')
    const interval = hasInProgress ? 2000 : 15000
    pollRef.current = setInterval(refresh, interval)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [sessionId, issues, refresh])

  const updateStatus = async (issue, nextStatus) => {
    setBusyId(issue.issueId)
    try {
      await api.post(
        `/api/code-analysis/${sessionId}/issues/${issue.issueId}/status`,
        { status: nextStatus },
        { baseURL: getBackendHost() }
      )
      // Optimistic local update so the strike-through is visible without
      // waiting for the next refresh tick.
      setIssues(prev => prev.map(i =>
        i.issueId === issue.issueId ? { ...i, status: nextStatus } : i))
    } catch (e) {
      message.error('更新状态失败: ' + (e.response?.data?.message || e.message))
    }
    setBusyId(null)
  }

  /**
   * Dispatch a fix task to the code agent. Backend:
   *   1. marks the issue IN_PROGRESS
   *   2. injects a structured user message into the chat session
   *   3. runs the code agent end-to-end (read → plan → apply → verify)
   *   4. scans the agent's final reply for [FIX_VERIFIED: <id>] /
   *      [FIX_FAILED: <id>] markers and transitions the issue.
   *
   * If neither marker is found, the issue stays in IN_PROGRESS and the
   * user can mark it manually via the "标记已修复" / "取消" buttons.
   */
  const startFix = async (issue) => {
    setBusyId(issue.issueId)
    // Optimistic transition: open → in_progress immediately.
    setIssues(prev => prev.map(i =>
      i.issueId === issue.issueId ? { ...i, status: 'in_progress' } : i))
    try {
      const res = await api.post(
        `/api/code-analysis/${sessionId}/issues/${issue.issueId}/start-fix`,
        {},
        { baseURL: getBackendHost() }
      )
      const data = res.data || {}
      if (data.status === 'verified') {
        message.success('修复任务已完成，代码已通过校验')
        setIssues(prev => prev.map(i =>
          i.issueId === issue.issueId ? { ...i, status: 'fixed' } : i))
      } else if (data.status === 'failed') {
        message.warning('修复任务校验未通过，已回到待处理')
        setIssues(prev => prev.map(i =>
          i.issueId === issue.issueId ? { ...i, status: 'open' } : i))
      } else if (data.status === 'dispatch_error') {
        message.error('派发修复任务失败: ' + (data.message || '未知错误'))
      } else {
        // awaiting_verification: agent did not emit a marker. Leave
        // the issue in IN_PROGRESS; user can poll or mark manually.
        message.info('修复任务已派发，CodeAgent 正在执行，可点击刷新查看进度')
      }
    } catch (e) {
      message.error('启动修复任务失败: ' + (e.response?.data?.message || e.message))
      // Roll back to open so the user can retry.
      setIssues(prev => prev.map(i =>
        i.issueId === issue.issueId ? { ...i, status: 'open' } : i))
    }
    setBusyId(null)
  }

  const filtered = issues.filter(i => {
    if (filter === 'all') return true
    return (i.status || 'open') === filter
  })

  const counts = issues.reduce((acc, i) => {
    const s = i.status || 'open'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #222' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Text strong style={{ color: '#ddd', fontSize: 13 }}>问题列表</Text>
            <Tag>{issues.length}</Tag>
            {counts.open > 0 && <Tag color="orange">{counts.open} 待处理</Tag>}
            {counts.in_progress > 0 && <Tag color="processing">{counts.in_progress} 修复中</Tag>}
            {counts.fixed > 0 && <Tag color="success">{counts.fixed} 已修复</Tag>}
          </Space>
          <Tooltip title="刷新">
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
          </Tooltip>
        </Space>
        <div style={{ marginTop: 8 }}>
          <Segmented
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { label: '待处理', value: 'open' },
              { label: '修复中', value: 'in_progress' },
              { label: '已修复', value: 'fixed' },
              { label: '已忽略', value: 'ignored' },
              { label: '全部',   value: 'all' }
            ]}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {loading && issues.length === 0 ? (
          <Spin size="small" style={{ display: 'block', margin: 24 }} />
        ) : filtered.length === 0 ? (
          <Empty
            description={emptyDescription(filter, counts)}
            imageStyle={{ height: 60 }}
            style={{ padding: 20 }}
          />
        ) : (
          <List
            dataSource={filtered}
            renderItem={(issue) => (
              <IssueItem
                issue={issue}
                busy={busyId === issue.issueId}
                onJump={() => onJumpToFile && onJumpToFile(issue.filePath, issue.lineNumber)}
                onStartFix={() => startFix(issue)}
                onMarkFixed={() => updateStatus(issue, 'fixed')}
                onMarkIgnored={() => updateStatus(issue, 'ignored')}
                onReopen={() => updateStatus(issue, 'open')}
              />
            )}
          />
        )}
      </div>
    </div>
  )
}

function emptyDescription(filter, counts) {
  if (filter === 'open') return '暂无待处理问题'
  if (filter === 'in_progress') return '没有正在修复的问题'
  if (filter === 'fixed') return '还没有已修复的问题'
  if (filter === 'ignored') return '没有已忽略的问题'
  return '该筛选下没有问题'
}

function IssueItem({ issue, busy, onJump, onStartFix, onMarkFixed, onMarkIgnored, onReopen }) {
  const status = issue.status || 'open'
  const tag = STATUS_TAG[status] || STATUS_TAG.open
  const isResolved = status === 'fixed' || status === 'ignored'
  const isInProgress = status === 'in_progress'
  const canJump = !!issue.filePath

  return (
    <Card
      size="small"
      style={{ marginBottom: 8, borderColor: '#2a2a2a', background: '#141414' }}
      bodyStyle={{ padding: 10 }}
    >
      <Space style={{ marginBottom: 4 }} size={4} wrap>
        <Tag color={SEVERITY_COLOR[issue.severity] || 'default'} style={{ margin: 0 }}>
          {issue.severity}
        </Tag>
        {issue.category && <Tag style={{ margin: 0 }}>{issue.category}</Tag>}
        <Tag color={tag.color} icon={tag.icon} style={{ margin: 0 }}>{tag.label}</Tag>
        <Text code style={{ fontSize: 10, color: '#666' }}>{issue.issueId}</Text>
      </Space>

      <div
        onClick={canJump ? onJump : undefined}
        style={{
          cursor: canJump ? 'pointer' : 'default',
          textDecoration: isResolved ? 'line-through' : 'none',
          color: isResolved ? '#666' : '#ccc',
          fontSize: 12,
          marginTop: 4,
          marginBottom: 4
        }}
        title={canJump ? `跳转到 ${issue.filePath}:${issue.lineNumber || 1}` : issue.filePath || ''}
      >
        {issue.description}
      </div>

      {issue.filePath && (
        <div style={{ marginBottom: 4 }}>
          <Text code style={{ fontSize: 10, color: '#888' }}>
            <FileTextOutlined /> {issue.filePath}
            {issue.lineNumber > 0 ? `:${issue.lineNumber}` : ''}
          </Text>
        </div>
      )}

      {issue.suggestion && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 2, fontStyle: 'italic' }}>
          建议: {issue.suggestion}
        </div>
      )}

      <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {canJump && (
          <Button size="small" icon={<FolderOpenOutlined />} onClick={onJump}>
            定位代码
          </Button>
        )}

        {/* open → 修复 (dispatch) / 忽略 */}
        {status === 'open' && (
          <>
            <Button size="small" type="primary" icon={<ToolOutlined />}
              loading={busy} onClick={onStartFix}>修复</Button>
            <Button size="small" icon={<CloseCircleOutlined />}
              loading={busy} onClick={onMarkIgnored}>忽略</Button>
          </>
        )}

        {/* in_progress → 取消 (roll back to open) / 标记已修复 (manual confirm) */}
        {isInProgress && (
          <>
            <Tooltip title="代码修复任务正在执行中，CodeAgent 完成后会自动校验并标记">
              <Tag color="processing" icon={<LoadingOutlined />} style={{ margin: 0 }}>
                修复中…
              </Tag>
            </Tooltip>
            <Button size="small" type="primary" icon={<CheckCircleOutlined />}
              loading={busy} onClick={onMarkFixed}>标记已修复</Button>
            <Button size="small" icon={<StopOutlined />}
              loading={busy} onClick={onReopen}>取消</Button>
          </>
        )}

        {/* fixed / ignored → 重新打开 */}
        {isResolved && (
          <Button size="small" loading={busy} onClick={busy ? undefined : onReopen}>
            重新打开
          </Button>
        )}
      </div>
    </Card>
  )
}
