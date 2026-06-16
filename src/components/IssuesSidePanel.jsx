import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Card, List, Tag, Space, Typography, Button, Empty, Spin, Tooltip, message, Segmented, Modal, Radio } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined,
  FileTextOutlined, ReloadOutlined, FolderOpenOutlined, ToolOutlined,
  LoadingOutlined, StopOutlined, QuestionCircleOutlined
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

export default function IssuesSidePanel({ sessionId, workspaceDir, onJumpToFile, onInjectAssistantMessage }) {
  const [filter, setFilter] = useState('open')   // 'open' | 'in_progress' | 'all' | 'fixed' | 'ignored'
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // Polls more aggressively while there is at least one in-flight
  // (in_progress) issue, so the user sees status transitions without
  // manual refresh. Falls back to a slow idle poll otherwise.
  const pollRef = useRef(null)
  // Active fix-task sessions, keyed by issueId. Maps to { taskId, status,
  // pending: [confirmation, ...] }. Polled in the same loop as the issues
  // list so the modal opens as soon as the agent emits a <CONFIRM_REQUEST>.
  const [tasks, setTasks] = useState({})   // issueId -> task state
  // The currently shown confirmation modal (one at a time).
  const [activeConfirm, setActiveConfirm] = useState(null)
  // Tracks the highest confirmation id we've already shown for a task so
  // we don't pop the same modal twice.
  const seenConfirmRef = useRef(new Set())

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

  // ─────────────────────────────────────────────────────────────────
  // Fix-task polling — fetch status + pending confirmations for any
  // task we know about. As soon as a fresh confirmation appears and
  // we haven't shown it yet, surface a modal.
  // ─────────────────────────────────────────────────────────────────
  const pollTaskStates = useCallback(async () => {
    const entries = Object.entries(tasks)
    if (entries.length === 0) return
    for (const [issueId, t] of entries) {
      if (!t || !t.taskId) continue
      try {
        const r = await api.get(
          `/api/code-analysis/${sessionId}/fix-task/${t.taskId}/pending-confirmations`,
          { baseURL: getBackendHost() }
        )
        const data = r.data || {}
        const pending = Array.isArray(data.confirmations) ? data.confirmations : []
        // Update task cache
        setTasks(prev => ({
          ...prev,
          [issueId]: { ...prev[issueId], pending, lastChecked: Date.now() }
        }))
        // Show the first unseen confirmation
        if (pending.length > 0 && !activeConfirm) {
          const c = pending[0]
          if (!seenConfirmRef.current.has(c.confirmation_id)) {
            seenConfirmRef.current.add(c.confirmation_id)
            setActiveConfirm({ ...c, issueId })
          }
        }
      } catch (e) {
        // 404 → task is gone (e.g. server restart); drop it.
        if (e.response && e.response.status === 404) {
          setTasks(prev => {
            const cp = { ...prev }
            delete cp[issueId]
            return cp
          })
        }
      }
    }
  }, [sessionId, tasks, activeConfirm])

  useEffect(() => {
    if (Object.keys(tasks).length === 0) return
    const id = setInterval(pollTaskStates, 2000)
    return () => clearInterval(id)
  }, [Object.keys(tasks).length, pollTaskStates])  // eslint-disable-line

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
      const taskId = data.task_id || null
      if (taskId) {
        // Register the task so we start polling for confirmations.
        setTasks(prev => ({
          ...prev,
          [issue.issueId]: { taskId, status: data.task?.status || 'running', pending: [] }
        }))
      }
      if (data.status === 'verified') {
        message.success('修复任务已完成，代码已通过校验')
        setIssues(prev => prev.map(i =>
          i.issueId === issue.issueId ? { ...i, status: 'fixed' } : i))
        if (taskId) cleanupTask(issue.issueId)
      } else if (data.status === 'failed') {
        message.warning('修复任务校验未通过，已回到待处理')
        setIssues(prev => prev.map(i =>
          i.issueId === issue.issueId ? { ...i, status: 'open' } : i))
        if (taskId) cleanupTask(issue.issueId)
      } else if (data.status === 'awaiting_confirmation') {
        // The agent emitted <CONFIRM_REQUEST>. If the response already
        // includes pending_confirmations, open the modal right away.
        const pc = Array.isArray(data.pending_confirmations) ? data.pending_confirmations : []
        if (pc.length > 0) {
          const c = pc[0]
          if (!seenConfirmRef.current.has(c.confirmation_id)) {
            seenConfirmRef.current.add(c.confirmation_id)
            setActiveConfirm({ ...c, issueId: issue.issueId })
          }
        }
        message.info('CodeAgent 需要您确认一项选择，请查看弹窗')
      } else if (data.status === 'dispatch_error') {
        message.error('派发修复任务失败: ' + (data.message || '未知错误'))
        if (taskId) cleanupTask(issue.issueId)
      } else if (data.status === 'executing') {
        // CodeAgent returned __CMD__ — it needs the frontend to
        // execute commands (read files, run tests, etc.) and send
        // back [COMMAND_RESULTS]. Inject the response into the chat
        // message flow so App.jsx's auto __CMD__ execution loop
        // picks it up and continues the multi-round interaction.
        const chatData = data.chat || {}
        const responseText = chatData.response || ''
        if (responseText && onInjectAssistantMessage) {
          onInjectAssistantMessage(responseText)
          message.info('CodeAgent 正在执行修复，请查看聊天面板中的命令执行进度')
        } else {
          message.info('修复任务已派发，CodeAgent 正在执行，可点击刷新查看进度')
        }
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

  // Drop the task entry once the issue is closed out.
  const cleanupTask = (issueId) => {
    setTasks(prev => {
      const cp = { ...prev }
      delete cp[issueId]
      return cp
    })
  }

  /**
   * Submit the user's choice to the backend. The backend marks the
   * confirmation RESOLVED and returns a `resume_prompt` that the LLM
   * thread uses to continue. We surface it to the chat input as a
   * queued message so the user can edit / send manually.
   */
  const submitConfirmation = async (confirmation, choiceId) => {
    if (!confirmation) return
    const t = tasks[confirmation.issueId]
    if (!t || !t.taskId) {
      message.error('内部错误：找不到对应的修复任务')
      setActiveConfirm(null)
      return
    }
    setBusyId(confirmation.issueId)
    try {
      const res = await api.post(
        `/api/code-analysis/${sessionId}/fix-task/${t.taskId}/confirm`,
        { confirmation_id: confirmation.confirmation_id, choice_id: choiceId },
        { baseURL: getBackendHost() }
      )
      const data = res.data || {}
      if (data.status === 'resolved') {
        message.success('已记录您的选择，CodeAgent 将基于此继续修复')
        // Mark all confirmations for this task as resolved in cache.
        setTasks(prev => ({
          ...prev,
          [confirmation.issueId]: {
            ...prev[confirmation.issueId],
            pending: (prev[confirmation.issueId]?.pending || []).filter(
              c => c.confirmation_id !== confirmation.confirmation_id)
          }
        }))
        // Resume prompt is logged in the backend; the user can paste it
        // into the chat input to continue the conversation.
        if (data.resume_prompt) {
          message.info('已为您生成继续提示，可在聊天框中发送以继续修复')
        }
      } else {
        message.error('提交选择失败: ' + (data.message || '未知错误'))
      }
    } catch (e) {
      message.error('提交选择失败: ' + (e.response?.data?.message || e.message))
    }
    setActiveConfirm(null)
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

      {/* Fix-task confirmation dialog. Shown when the code agent emits
          a <CONFIRM_REQUEST> mid-fix and the user has not yet answered. */}
      <FixConfirmDialog
        confirmation={activeConfirm}
        onCancel={() => setActiveConfirm(null)}
        onConfirm={(choiceId) => submitConfirmation(activeConfirm, choiceId)}
        busy={!!activeConfirm && busyId === activeConfirm.issueId}
      />
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

/**
 * Modal that surfaces a <CONFIRM_REQUEST> the code agent emitted
 * during a fix task. Renders one radio per option in the confirmation
 * payload. Submits the chosen id via onConfirm.
 *
 * Props:
 *   confirmation: { confirmation_id, prompt, options:[{id,label,description}], context, kind, issueId } | null
 *   onCancel:     () => void
 *   onConfirm:    (choiceId: string) => void
 *   busy:         boolean
 */
function FixConfirmDialog({ confirmation, onCancel, onConfirm, busy }) {
  const [choice, setChoice] = useState(null)

  // Reset the radio when a new confirmation arrives or the modal closes.
  useEffect(() => {
    if (!confirmation) setChoice(null)
  }, [confirmation])

  const options = (confirmation && Array.isArray(confirmation.options))
    ? confirmation.options : []
  const kindLabel = {
    OPTION_CHOICE: '请选择',
    PLAN_APPROVAL: '请审阅方案',
    CONFIRM_DESTRUCTIVE: '请确认'
  }[confirmation?.kind] || '请选择'

  return (
    <Modal
      title={
        <Space>
          <QuestionCircleOutlined style={{ color: '#faad14' }} />
          <span>CodeAgent 需要您确认</span>
          {confirmation?.kind && <Tag>{confirmation.kind}</Tag>}
        </Space>
      }
      open={!!confirmation}
      onCancel={onCancel}
      okButtonProps={{ disabled: !choice, loading: busy }}
      okText="确认"
      cancelText="稍后再说"
      maskClosable={false}
      onOk={() => choice && onConfirm(choice)}
      width={520}
    >
      {confirmation && (
        <>
          <div style={{ marginBottom: 12, color: '#bbb', whiteSpace: 'pre-wrap' }}>
            {kindLabel}：<Text style={{ color: '#fff' }}>{confirmation.prompt}</Text>
          </div>
          {confirmation.context && Object.keys(confirmation.context).length > 0 && (
            <div style={{ marginBottom: 12, fontSize: 11, color: '#888' }}>
              {Object.entries(confirmation.context)
                .filter(([k]) => k !== 'source')
                .map(([k, v]) => (
                  <div key={k}><code>{k}</code>: <code>{String(v)}</code></div>
                ))}
            </div>
          )}
          <Radio.Group
            onChange={e => setChoice(e.target.value)}
            value={choice}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {options.map((o) => (
                <Radio
                  key={o.id}
                  value={o.id}
                  style={{
                    display: 'block',
                    padding: '8px 12px',
                    border: '1px solid #333',
                    borderRadius: 4,
                    background: choice === o.id ? '#1f2a3d' : 'transparent',
                    width: '100%'
                  }}
                >
                  <div style={{ fontWeight: 500, color: '#eee' }}>{o.label || o.id}</div>
                  {o.description && (
                    <div style={{ color: '#999', fontSize: 11, marginTop: 2 }}>
                      {o.description}
                    </div>
                  )}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </>
      )}
    </Modal>
  )
}
