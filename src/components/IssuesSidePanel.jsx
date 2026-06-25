import React, { useEffect, useState, useRef, useMemo } from 'react'
import { Card, List, Tag, Space, Typography, Button, Empty, Spin, Tooltip, message, Segmented, Modal, Radio } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined,
  FileTextOutlined, ReloadOutlined, FolderOpenOutlined, ToolOutlined,
  LoadingOutlined, StopOutlined, QuestionCircleOutlined,
  BranchesOutlined
} from '@ant-design/icons'
import api, { getBackendHost } from '../auth'
import FixSummaryCard from './FixSummaryCard'
import FixTaskStateMachine from './FixTaskStateMachine'
import { useFixTaskBus, useIssueList } from '../hooks/useFixTaskPoller'

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

export default function IssuesSidePanel({ sessionId, workspaceDir, onJumpToFile, onInjectAssistantMessage, onFixIssueMessageUpdated }) {
  const [filter, setFilter] = useState('open')   // 'open' | 'in_progress' | 'all' | 'fixed' | 'ignored'
  // S7: 列表 + 自适应轮询 走 useIssueList
  const { issues, setIssues, loading, refresh } = useIssueList({ sessionId })
  const [busyId, setBusyId] = useState(null)
  // S7: WS + 状态机 + 确认弹窗 走 useFixTaskBus
  const {
    tasks, summaries, activeConfirm,
    registerTask, closeTask,
    submitConfirmation, dismissConfirm,
  } = useFixTaskBus({ sessionId })
  // The currently-shown completion summary modal (one at a time).
  // Driven by the latest `summaries[issueId]` from the bus when
  // the user opens a fixed issue's "查看修复结果" link.
  const [summaryModal, setSummaryModal] = useState(null)  // { issueId, summary }
  // Tracks issueIds we've already auto-opened the summary modal
  // for in this session, so the same card doesn't pop twice on
  // WS reconnect. The user can still re-open via the fixed row
  // button (which bypasses this guard).
  const seenAutoSummaryRef = useRef(new Set())
  // The currently-shown state-machine timeline modal. One at a
  // time. Fetches the canonical timeline from the backend when
  // opened, then merges with the live phases streamed via WS
  // (hook's `tasks[issueId].phases`) so a tab that connects
  // mid-flight sees the full picture.
  const [stateMachineModal, setStateMachineModal] = useState(null)  // { issueId, sessionId, taskId, backendPhases, loading }

  // ── S7: 删掉本地的 refresh / 自适应轮询 / pollTaskStates / per-task WS ──
  // 全部下沉到 hooks（useIssueList 负责列表+轮询，useFixTaskBus 负责 WS+状态机）。

  // Fetch the state-machine timeline from the backend whenever
  // the modal opens for a fresh issueId. The backend is the
  // source of truth — the WS events accumulated in
  // tasks[issueId].phases (via the bus hook) are lossy on
  // reconnect. The merge in render combines backend (canonical)
  // with the live phases (WS tail).
  //
  // We key the effect on stateMachineModal.issueId rather than
  // the whole object so re-renders triggered by setLoading or
  // setBackendPhases don't re-fetch.
  useEffect(() => {
    if (!stateMachineModal) return
    const { issueId, sessionId: smSessionId, taskId } = stateMachineModal
    if (!smSessionId || !taskId) {
      setStateMachineModal(sm => sm
        ? { ...sm, loading: false, backendPhases: [] } : sm)
      return
    }
    let cancelled = false
    setStateMachineModal(sm => sm
      ? { ...sm, loading: true, backendPhases: [] } : sm)
    api.get(`/api/code-analysis/${smSessionId}/fix-task/${taskId}`)
      .then(res => {
        if (cancelled) return
        const timeline = res?.data?.task?.state_machine_timeline
        if (!Array.isArray(timeline)) {
          setStateMachineModal(sm => sm
            ? { ...sm, loading: false, backendPhases: [] } : sm)
          return
        }
        const taskStatus = (res?.data?.task?.status || '').toUpperCase()
        const normalised = timeline.map((e, i) => {
          const isLast = i === timeline.length - 1
          return {
            phase: (e.phase || '').toUpperCase(),
            status: isLast && taskStatus ? taskStatus : 'RUNNING',
            ts: e.ts ? new Date(e.ts).getTime() : Date.now(),
            note: e.note || ''
          }
        })
        setStateMachineModal(sm => sm
          ? { ...sm, loading: false, backendPhases: normalised } : sm)
      })
      .catch(() => {
        if (cancelled) return
        setStateMachineModal(sm => sm
          ? { ...sm, loading: false, backendPhases: [] } : sm)
      })
    return () => { cancelled = true }
  }, [stateMachineModal && stateMachineModal.issueId])

  // Merge backend (canonical) + live phases (from bus hook) for
  // the timeline modal.
  const mergedTimeline = useMemo(() => {
    if (!stateMachineModal) return []
    const { issueId, backendPhases, loading } = stateMachineModal
    const live = (tasks[issueId] && tasks[issueId].phases) || []
    if (loading && (!backendPhases || backendPhases.length === 0)) return live
    if (!backendPhases || backendPhases.length === 0) return live
    if (live.length === 0) return backendPhases
    const lastBackendTs = backendPhases[backendPhases.length - 1].ts
    const newLive = live.filter(p => p.ts > lastBackendTs)
    return [...backendPhases, ...newLive]
  }, [stateMachineModal, tasks])

  // S7: bus hook 自动更新 summaries —— 这里 effect 监听 "新 issueId 完成"
  // 自动弹 summary modal（once-per-issueId）+ 回调 onFixIssueMessageUpdated
  // 让 App.jsx 重拉 chat 历史。effect 依赖 summaries 数量 + sessionId。
  const lastSeenSummaryCountRef = useRef(0)
  useEffect(() => {
    const ids = Object.keys(summaries)
    if (ids.length <= lastSeenSummaryCountRef.current) {
      lastSeenSummaryCountRef.current = ids.length
      return
    }
    // 找到新加入的 issueId
    const newIds = ids.slice(lastSeenSummaryCountRef.current)
    lastSeenSummaryCountRef.current = ids.length
    for (const iid of newIds) {
      // 1) 更新 issue 状态为 fixed（与原行为一致）
      setIssues(prev => prev.map(i =>
        i.issueId === iid ? { ...i, status: 'fixed' } : i))
      // 2) 自动弹 modal
      if (!seenAutoSummaryRef.current.has(iid)) {
        seenAutoSummaryRef.current.add(iid)
        setSummaryModal({ issueId: iid, summary: summaries[iid] })
      }
      // 3) 通知 App.jsx 重拉 chat（fix-task.completed 更新了 chat 占位）
      if (typeof onFixIssueMessageUpdated === 'function') {
        try { onFixIssueMessageUpdated(iid) } catch (_) {}
      }
    }
  }, [summaries, onFixIssueMessageUpdated])

  // ── S7: per-task WS 订阅 + onclose teardown 全在 hook 里，这里不写 ──

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
   * Dispatch a fix task to the code agent. Backend (async path):
   *   1. marks the issue IN_PROGRESS
   *   2. opens a FixTask row and returns its task_id
   *   3. returns immediately (status: "started") — the actual
   *      driver + chat-fallback runs on a background thread on
   *      the server, so the browser no longer blocks on a long-
   *      lived POST.
   *
   * The terminal outcome (COMPLETED → fixed, FAILED → open) is
   * observed by the WebSocket subscription declared above — the
   * backend's FixTaskEventBus pushes a fix-task.phase event the
   * moment the driver reaches COMPLETED|FAILED, so the UI updates
   * within ~100ms of the actual transition (no more waiting for
   * a 2s poll tick). The confirmation modal is still surfaced by
   * the poller since confirmations aren't yet published on the
   * bus.
   *
   * The synchronous error paths (issue not found, server down)
   * are handled by the catch block.
   */
  const startFix = async (issue) => {
    setBusyId(issue.issueId)
    // Optimistic transition: open → in_progress immediately so
    // the UI doesn't flicker while the synchronous POST is in
    // flight. The WebSocket subscription above will overwrite
    // this with fixed/open the moment the backend's driver
    // reaches COMPLETED|FAILED.
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
        // S7: 把 task 注册到 bus —— hook 会开 WS + 维护状态
        registerTask(issue.issueId, taskId, data.task?.status || 'running')
      }
      if (data.status === 'dispatch_error') {
        message.error('派发修复任务失败: ' + (data.message || '未知错误'))
        if (taskId) closeTask(issue.issueId, 'dispatch_error')
        // Roll back the optimistic in_progress.
        setIssues(prev => prev.map(i =>
          i.issueId === issue.issueId ? { ...i, status: 'open' } : i))
      } else {
        message.info('修复任务已派发，CodeAgent 正在执行，可在任务列表中查看进度')
        // The synchronous POST just (a) created the fix task in
        // FixTaskStore and (b) inserted a new chat-stream row
        // via `createFixIssueMessage` with meta.type=fix_issue
        // (the "🔧 已开始修复…" placeholder). The chat UI does
        // NOT poll messages on its own — it only reloads on a
        // `fix-task.completed` WS event (see
        // `onFixIssueMessageUpdated` below). If we don't nudge
        // App.jsx to re-fetch the session history RIGHT NOW,
        // the placeholder row never shows up in the chat flow
        // and the user has no feedback that the fix has started
        // at all. Calling the same callback we use for the
        // terminal event reuses a single, well-tested reload
        // path and keeps the contract: "this callback means a
        // fix-related message row was just added or updated".
        if (typeof onFixIssueMessageUpdated === 'function') {
          try { onFixIssueMessageUpdated(issue.issueId) } catch (_) {}
        }
      }
    } catch (e) {
      message.error('启动修复任务失败: ' + (e.response?.data?.message || e.message))
      // Roll back to open so the user can retry.
      setIssues(prev => prev.map(i =>
        i.issueId === issue.issueId ? { ...i, status: 'open' } : i))
    }
    setBusyId(null)
  }

  // S7: drop task 由 hook 提供 (closeTask)

  // Close the summary modal AND tear down the WS for that task.
  // The modal is the only place we know the fix-task.completed
  // event has been fully processed, so this is the only safe
  // moment to release the socket — closing earlier (e.g. on
  // the fix-task.phase event) drops the very event the modal
  // exists to display.
  const closeSummaryModal = () => {
    if (summaryModal) {
      const iid = summaryModal.issueId
      // S7: hook 同时拆 socket + 清 tasks[iid]
      closeTask(iid, 'summary_modal_closed')
    }
    setSummaryModal(null)
  }

  /**
   * Submit the user's choice to the backend. The backend marks the
   * confirmation RESOLVED and returns a `resume_prompt` that the LLM
   * thread uses to continue.
   */
  const handleConfirmationSubmit = async (confirmation, choiceId) => {
    if (!confirmation) return
    const t = tasks[confirmation.issueId]
    if (!t || !t.taskId) {
      message.error('内部错误：找不到对应的修复任务')
      dismissConfirm()
      return
    }
    setBusyId(confirmation.issueId)
    try {
      // S7: 走 hook 提交（hook 内部走 POST 并 dismiss）
      const data = await submitConfirmation(
        t.taskId, confirmation.confirmation_id, 'user_choice', choiceId
      )
      if (data && data.status === 'resolved') {
        message.success('已记录您的选择，CodeAgent 将基于此继续修复')
        if (data.resume_prompt) {
          message.info('已为您生成继续提示，可在聊天框中发送以继续修复')
        }
      } else if (data && data.status === 'error') {
        message.error('提交选择失败: ' + (data.message || '未知错误'))
      }
    } catch (e) {
      message.error('提交选择失败: ' + (e.message || 'unknown'))
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
                onViewSummary={summaries[issue.issueId]
                  ? () => setSummaryModal({ issueId: issue.issueId,
                      summary: summaries[issue.issueId] })
                  : null}
                // State-machine timeline. Live phases now live in
                // tasks[issueId].phases (from the bus hook) — same
                // shape as the old phaseLogs[issueId] so the
                // condition below still works.
                onViewStateMachine={
                  (((tasks[issue.issueId] || {}).phases || []).length > 0
                   || (tasks[issue.issueId] || {}).taskId
                   || (summaries[issue.issueId] || {}).taskId)
                    ? () => setStateMachineModal({
                        issueId: issue.issueId,
                        sessionId,
                        taskId: (tasks[issue.issueId] || {}).taskId
                             || (summaries[issue.issueId] || {}).taskId
                             || null,
                        backendPhases: [],
                        loading: true
                      })
                    : null}
              />
            )}
          />
        )}
      </div>

      {/* Fix-task confirmation dialog. Shown when the code agent emits
          a <CONFIRM_REQUEST> mid-fix and the user has not yet answered. */}
      <FixConfirmDialog
        confirmation={activeConfirm}
        onCancel={() => dismissConfirm()}
        onConfirm={(choiceId) => handleConfirmationSubmit(activeConfirm, choiceId)}
        busy={!!activeConfirm && busyId === activeConfirm.issueId}
      />
      {/* Fix-task completed summary. The backend's
          FixTaskEventBus pushes one `fix-task.completed` event
          per task (carrying the diffs + verification result).
          We surface it as a modal so the user can see exactly
          what changed and whether the build passed. */}
      <Modal
        open={!!summaryModal}
        onCancel={closeSummaryModal}
        footer={null}
        width={760}
        title={null}
        destroyOnClose
      >
        {summaryModal && (
          <FixSummaryCard
            summary={summaryModal.summary}
            onClose={closeSummaryModal}
            workspaceId={workspaceDir || sessionId}
          />
        )}
      </Modal>
      {/* Fix-task state-machine timeline. The displayed phases
          are a merge of two sources:
            1. backendPhases — fetched from
               GET /api/code-analysis/{sessionId}/fix-task/{taskId}.
               This is the canonical, server-side record; it
               survives page reloads, contains the original ISO
               timestamps from the driver, and is the only
               place REPLAN reasons from a previous tab session
               are visible.
            2. phaseLogs[issueId] — events streamed live to this
               tab via the WebSocket. These are the most recent
               transitions; anything with a ts strictly newer
               than the backend's last entry is appended.
          On fetch failure (or for a task with no backend
          history yet), we fall back to the live phaseLogs
          alone. */}
      <Modal
        open={!!stateMachineModal}
        onCancel={() => setStateMachineModal(null)}
        footer={null}
        width={680}
        destroyOnClose
        title={
          stateMachineModal && (
            <Space>
              <span>状态机轨迹</span>
              {stateMachineModal.taskId && (
                <Text type="secondary" style={{ fontSize: 12 }} copyable>
                  {stateMachineModal.taskId}
                </Text>
              )}
              {stateMachineModal.loading && (
                <Spin size="small" />
              )}
            </Space>
          )
        }
      >
        {stateMachineModal && (
          <FixTaskStateMachine
            phases={mergedTimeline}
            loading={stateMachineModal.loading && mergedTimeline.length === 0}
          />
        )}
      </Modal>
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

function IssueItem({ issue, busy, onJump, onStartFix, onMarkFixed, onMarkIgnored, onReopen, onViewSummary, onViewStateMachine }) {
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
            {onViewStateMachine && (
              <Tooltip title="查看状态机轨迹（含 REPLAN 回退）">
                <Button size="small" icon={<BranchesOutlined />}
                  onClick={onViewStateMachine}>状态机</Button>
              </Tooltip>
            )}
          </>
        )}

        {/* fixed / ignored → 重新打开 + 可选的查看修复结果 / 状态机 */}
        {isResolved && (
          <>
            <Button size="small" loading={busy} onClick={busy ? undefined : onReopen}>
              重新打开
            </Button>
            {onViewSummary && (
              <Button size="small" type="link" onClick={onViewSummary}>
                查看修复结果
              </Button>
            )}
            {onViewStateMachine && (
              <Tooltip title="查看状态机轨迹（含 REPLAN 回退）">
                <Button size="small" icon={<BranchesOutlined />}
                  onClick={onViewStateMachine}>状态机</Button>
              </Tooltip>
            )}
          </>
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
