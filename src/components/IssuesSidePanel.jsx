import React, { useEffect, useState, useRef, useMemo } from 'react'
import { Card, List, Tag, Space, Typography, Button, Empty, Spin, Tooltip, message, Segmented, Modal, Radio, Dropdown, Alert } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined,
  FileTextOutlined, ReloadOutlined, FolderOpenOutlined, ToolOutlined,
  LoadingOutlined, StopOutlined, QuestionCircleOutlined,
  BranchesOutlined, DisconnectOutlined, DeleteOutlined, MoreOutlined
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
  // 路线 B: 监听 App.jsx 在 re-verify 完成后派发的 'reverify-finished' 事件,
  // 立即 refresh 一次 (避免等下一次自适应轮询的 5s 间隔)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return
    const handler = () => {
      try { refresh() } catch (e) { console.error('[IssuesSidePanel] refresh on reverify-finished failed:', e) }
    }
    window.addEventListener('reverify-finished', handler)
    return () => window.removeEventListener('reverify-finished', handler)
  }, [refresh])
  // Agent-driven issue ops: 监听 App.jsx 在 chat 完成后派发的 'agent-issue-ops-applied' 事件.
  // 当用户在 chat 里说"删除 issue X" / "把 Y 标为已修复" 时, 后端会通过 <ISSUE_OP .../>
  // marker 直接改 IssueStore, 这里必须立即拉一次新数据, 否则 5s 轮询窗口内用户看不到变化.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return
    const handler = (ev) => {
      // 只对当前会话的事件反应, 避免跨 session 误刷
      const sid = ev?.detail?.sessionId
      if (sid && sessionId && sid !== sessionId) return
      try { refresh() } catch (e) { console.error('[IssuesSidePanel] refresh on agent-issue-ops-applied failed:', e) }
    }
    window.addEventListener('agent-issue-ops-applied', handler)
    return () => window.removeEventListener('agent-issue-ops-applied', handler)
  }, [refresh, sessionId])
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

  // ── Issue deletion ───────────────────────────────────────────
  // Single-issue delete is per-product-rule user-driven only.
  // The button is only shown for OPEN issues (and FIXED/IGNORED
  // where the user might want to clear a "noise" entry). For
  // IN_PROGRESS we hide it to avoid racing the fix-task.
  const [deletingId, setDeletingId] = useState(null)

  /**
   * Delete a single issue. Idempotent on the backend, so we use
   * optimistic update: remove from local list immediately, roll
   * back on failure. The backend returns 200 even if the id was
   * already gone (stale tab), so a 404 is not the same as an
   * error.
   */
  const deleteIssue = async (issue) => {
    Modal.confirm({
      title: `删除 issue: ${issue.issueId}?`,
      content: (
        <div>
          <div style={{ marginBottom: 6 }}>
            <Text code style={{ fontSize: 11 }}>{issue.filePath}:{issue.lineNumber}</Text>
          </div>
          <div style={{ color: '#888', fontSize: 12 }}>
            {issue.description}
          </div>
          <Alert
            type="warning" showIcon style={{ marginTop: 8 }}
            message="删除后无法恢复。如需隐藏但不删除, 请用'忽略'。"
          />
        </div>
      ),
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeletingId(issue.issueId)
        // Optimistic: drop from list, keep a copy for rollback.
        const snapshot = issues
        setIssues(prev => prev.filter(i => i.issueId !== issue.issueId))
        try {
          const res = await api.delete(
            `/api/code-analysis/${sessionId}/issues/${issue.issueId}`,
            { baseURL: getBackendHost() }
          )
          const data = res && res.data
          if (data && data.removed === false) {
            // Server says it was already gone — refresh to be sure.
            message.info('该 issue 已被删除过，正在刷新列表')
            try { await refresh() } catch (_) {}
          } else {
            message.success('已删除')
          }
        } catch (e) {
          // Roll back the optimistic removal.
          setIssues(snapshot)
          message.error('删除失败: ' + (e.response?.data?.message || e.message))
        }
        setDeletingId(null)
      }
    })
  }

  // ── Dedup (find duplicates → preview → apply) ────────────────
  // dedupModal shape:
  //   null                          → closed
  //   { step: 'pick' }              → strategy picker
  //   { step: 'preview', strategy, groups, groupCount, wouldRemove, loading }
  //                                  → preview list with "应用" button
  //   { step: 'applying', strategy } → apply in flight
  const [dedupModal, setDedupModal] = useState(null)

  /**
   * Open the dedup flow. First step: pick a strategy. We
   * explicitly do NOT call /dedup yet — the user must see the
   * preview and confirm.
   */
  const openDedup = () => {
    if (!issues || issues.length < 2) {
      message.info('当前 issue 不足 2 条, 无需去重')
      return
    }
    setDedupModal({ step: 'pick' })
  }

  /**
   * Fetch the duplicate groups from the backend. Read-only —
   * no state is mutated by this call.
   */
  const fetchPreview = async (strategy) => {
    setDedupModal({ step: 'preview', strategy, groups: [], groupCount: 0, wouldRemove: 0, loading: true })
    try {
      const res = await api.get(
        `/api/code-analysis/${sessionId}/issues/duplicates`,
        { params: { strategy }, baseURL: getBackendHost() }
      )
      const data = res && res.data
      if (!data || data.status !== 'ok') {
        message.error('预览去重失败: ' + (data && data.message || 'unknown'))
        setDedupModal(null)
        return
      }
      setDedupModal({
        step: 'preview',
        strategy,
        groups: data.groups || [],
        groupCount: data.groupCount || 0,
        wouldRemove: data.wouldRemove || 0,
        loading: false
      })
    } catch (e) {
      message.error('预览去重失败: ' + (e.response?.data?.message || e.message))
      setDedupModal(null)
    }
  }

  /**
   * Apply the dedup. Confirms with the user via the existing
   * Modal.confirm, then POSTs /dedup and refreshes the list.
   */
  const applyDedup = (strategy, wouldRemove, groupCount) => {
    Modal.confirm({
      title: `确认应用去重?`,
      content: `将删除 ${wouldRemove} 条 issue (${groupCount} 个重复组), 保留每组最早创建的一条。操作不可撤销。`,
      okText: '应用去重',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDedupModal({ step: 'applying', strategy })
        try {
          const res = await api.post(
            `/api/code-analysis/${sessionId}/issues/dedup`,
            { strategy },
            { baseURL: getBackendHost() }
          )
          const data = res && res.data
          if (!data || data.status !== 'ok') {
            message.error('去重失败: ' + (data && data.message || 'unknown'))
            setDedupModal(null)
            return
          }
          message.success(`去重完成: 删除 ${data.removed} 条, 保留 ${data.kept} 条 (${data.groups} 组)`)
          setDedupModal(null)
          // Refresh from backend so the local list matches reality
          // (in case of any race with concurrent mutations).
          try { await refresh() } catch (_) {}
        } catch (e) {
          message.error('去重失败: ' + (e.response?.data?.message || e.message))
          setDedupModal(null)
        }
      }
    })
  }

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
   * 一键批量忽略: 把当前所有 OPEN/IN_PROGRESS 的 issue 一次性标为 IGNORED。
   * 被忽略的 issue 在后端 re-verify 循环里被自动过滤 (下批不出现), 不再参与核实。
   * 走串行 POST (避免后端 DB 写锁冲突), 失败单条不影响其他。
   */
  const ignoreAllOpen = async () => {
    const targets = (issues || []).filter(i => {
      const s = (i.status || 'open')
      return s === 'open' || s === 'in_progress'
    })
    if (targets.length === 0) {
      message.info('当前没有待处理/修复中 issue 可忽略')
      return
    }
    Modal.confirm({
      title: `一键忽略 ${targets.length} 条 issue?`,
      content: '被忽略的 issue 在下次"重新核实"时将不再被分析。可在"已忽略"标签下重新打开。',
      okText: '确认忽略',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        let okCount = 0
        let failCount = 0
        for (const t of targets) {
          try {
            await api.post(
              `/api/code-analysis/${sessionId}/issues/${t.issueId}/status`,
              { status: 'ignored' },
              { baseURL: getBackendHost() }
            )
            okCount++
          } catch (e) {
            failCount++
          }
        }
        // 乐观一次性更新本地列表
        const ignoredSet = new Set(targets.map(t => t.issueId))
        setIssues(prev => prev.map(i =>
          ignoredSet.has(i.issueId) ? { ...i, status: 'ignored' } : i))
        if (failCount === 0) {
          message.success(`已忽略 ${okCount} 条 issue`)
        } else {
          message.warning(`忽略完成: 成功 ${okCount}, 失败 ${failCount}`)
        }
        // 触发一次完整 refresh, 同步后端
        try { await refresh() } catch (_) {}
      }
    })
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
          <Space>
            <Tooltip title="查找并去重: 同 file+line / 同 file+描述前缀 / 描述相似 ≥85% 的 issue, 保留最早创建的一条, 删除其他">
              <Button size="small" icon={<BranchesOutlined />}
                onClick={openDedup}
                disabled={!issues || issues.length < 2}>
                查找重复
              </Button>
            </Tooltip>
            <Tooltip title="把当前所有待处理/修复中 issue 标为已忽略, 重新核实时不再分析这些">
              <Button size="small" icon={<DisconnectOutlined />}
                onClick={ignoreAllOpen}
                disabled={!counts.open && !counts.in_progress}>
                一键忽略
              </Button>
            </Tooltip>
            <Tooltip title="刷新">
              <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
            </Tooltip>
          </Space>
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
                deleting={deletingId === issue.issueId}
                onJump={() => onJumpToFile && onJumpToFile(issue.filePath, issue.lineNumber)}
                onStartFix={() => startFix(issue)}
                onMarkFixed={() => updateStatus(issue, 'fixed')}
                onMarkIgnored={() => updateStatus(issue, 'ignored')}
                onReopen={() => updateStatus(issue, 'open')}
                onDelete={() => deleteIssue(issue)}
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

      {/* Dedup flow: pick strategy → preview groups → apply.
          Single modal whose body switches on `dedupModal.step` so the
          user never loses the dedup context mid-flow. */}
      <Modal
        open={!!dedupModal}
        onCancel={() => {
          // Don't allow closing mid-apply (the backend is mid-mutation).
          if (dedupModal && dedupModal.step === 'applying') return
          setDedupModal(null)
        }}
        footer={null}
        width={720}
        destroyOnClose
        title={
          <Space>
            <BranchesOutlined />
            <span>查找重复 issue</span>
          </Space>
        }
      >
        {dedupModal && dedupModal.step === 'pick' && (
          <DedupStrategyPicker
            onPick={(strategy) => fetchPreview(strategy)}
            onCancel={() => setDedupModal(null)}
          />
        )}
        {dedupModal && dedupModal.step === 'preview' && (
          <DedupPreview
            strategy={dedupModal.strategy}
            groups={dedupModal.groups}
            groupCount={dedupModal.groupCount}
            wouldRemove={dedupModal.wouldRemove}
            loading={dedupModal.loading}
            onApply={() => applyDedup(dedupModal.strategy, dedupModal.wouldRemove, dedupModal.groupCount)}
            onBack={() => setDedupModal({ step: 'pick' })}
            onCancel={() => setDedupModal(null)}
          />
        )}
        {dedupModal && dedupModal.step === 'applying' && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin size="large" />
            <div style={{ marginTop: 12, color: '#888' }}>
              正在应用去重 ({dedupModal.strategy})...
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * Step 1 of the dedup flow: pick a strategy. Three options that
 * trade recall vs risk. We keep the radio to allow back-and-forth
 * comparison before committing.
 */
function DedupStrategyPicker({ onPick, onCancel }) {
  const [strategy, setStrategy] = useState('file-line')
  const STRATEGIES = [
    { value: 'file-line',              label: 'file + line (推荐)',         desc: '同 filePath + 同 lineNumber 视为重复。最严格, 误判风险极低。' },
    { value: 'file-description-prefix',label: 'file + 描述前缀',             desc: '同 filePath + 描述前 80 字符相同视为重复。能容忍行号漂移。' },
    { value: 'fuzzy',                  label: '描述相似度 ≥ 85% (Jaccard)', desc: '按描述分词后 Jaccard 相似度 ≥ 0.85 视为重复。召回高, 需预览。' }
  ]
  return (
    <div>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="去重会删除每组中除'最早创建'以外的所有 issue, 不可撤销。请先在预览里确认。"
      />
      <Radio.Group
        value={strategy}
        onChange={e => setStrategy(e.target.value)}
        style={{ width: '100%' }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {STRATEGIES.map(s => (
            <Radio key={s.value} value={s.value} style={{ display: 'block' }}>
              <Text strong>{s.label}</Text>
              <div style={{ color: '#888', fontSize: 12, marginLeft: 24 }}>{s.desc}</div>
            </Radio>
          ))}
        </Space>
      </Radio.Group>
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={() => onPick(strategy)}>预览</Button>
        </Space>
      </div>
    </div>
  )
}

/**
 * Step 2 of the dedup flow: show the duplicate groups. Each row
 * shows the canonical survivor (kept) at the top in green, and the
 * candidates-for-removal below in red. The user reviews, then
 * clicks "应用" to confirm.
 */
function DedupPreview({ strategy, groups, groupCount, wouldRemove, loading, onApply, onBack, onCancel }) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin size="large" />
        <div style={{ marginTop: 12, color: '#888' }}>正在查找重复...</div>
      </div>
    )
  }
  if (!groups || groups.length === 0) {
    return (
      <div>
        <Alert
          type="success" showIcon style={{ marginBottom: 12 }}
          message={`未找到重复 issue (策略: ${strategy})`}
        />
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onBack}>返回</Button>
            <Button onClick={onCancel}>关闭</Button>
          </Space>
        </div>
      </div>
    )
  }
  return (
    <div>
      <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message={`发现 ${groupCount} 个重复组, 共 ${wouldRemove} 条 issue 会被删除`}
        description="每组保留最早创建的一条 (绿色), 其余 (红色) 会被删除。操作不可撤销。"
      />
      <div style={{ maxHeight: 380, overflow: 'auto', border: '1px solid #2a2a2a', borderRadius: 4, padding: 8 }}>
        {groups.map((g, idx) => (
          <div key={g.key || idx} style={{ marginBottom: 12, padding: 8, background: '#141414', borderRadius: 4 }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
              组 {idx + 1} · key=<Text code style={{ fontSize: 10 }}>{g.key}</Text>
            </div>
            {g.keep && (
              <div style={{ padding: 6, background: 'rgba(82,196,26,0.08)', border: '1px solid rgba(82,196,26,0.3)', borderRadius: 3, marginBottom: 4 }}>
                <Space size={4} wrap>
                  <Tag color="green">保留</Tag>
                  <Text code style={{ fontSize: 10 }}>{g.keep.filePath}:{g.keep.lineNumber}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{g.keep.issueId}</Text>
                </Space>
                <div style={{ fontSize: 11, marginTop: 2, color: '#aaa' }}>{g.keep.description}</div>
              </div>
            )}
            {(g.remove || []).map((r) => (
              <div key={r.issueId} style={{ padding: 6, background: 'rgba(255,77,79,0.06)', border: '1px solid rgba(255,77,79,0.25)', borderRadius: 3, marginBottom: 4 }}>
                <Space size={4} wrap>
                  <Tag color="red">删除</Tag>
                  <Text code style={{ fontSize: 10 }}>{r.filePath}:{r.lineNumber}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{r.issueId}</Text>
                </Space>
                <div style={{ fontSize: 11, marginTop: 2, color: '#888' }}>{r.description}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <Space>
          <Button onClick={onBack}>返回</Button>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" danger onClick={onApply}>
            应用去重 (删除 {wouldRemove} 条)
          </Button>
        </Space>
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

function IssueItem({ issue, busy, deleting, onJump, onStartFix, onMarkFixed, onMarkIgnored, onReopen, onDelete, onViewSummary, onViewStateMachine }) {
  const status = issue.status || 'open'
  const tag = STATUS_TAG[status] || STATUS_TAG.open
  const isResolved = status === 'fixed' || status === 'ignored'
  const isInProgress = status === 'in_progress'
  const canJump = !!issue.filePath
  // Show "..." menu only when there's a destructive action available.
  // IN_PROGRESS issues are protected — deleting while a fix-task is
  // running could leave the task in a weird state.
  const showMoreMenu = !!onDelete && !isInProgress

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

        {showMoreMenu && (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'delete',
                  label: '删除',
                  icon: <DeleteOutlined />,
                  danger: true,
                  onClick: ({ domEvent }) => {
                    // Stop propagation so the card's outer click (jump-to-file)
                    // doesn't also fire.
                    if (domEvent && domEvent.stopPropagation) domEvent.stopPropagation()
                    onDelete && onDelete()
                  }
                }
              ]
            }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Tooltip title="更多操作">
              <Button
                size="small"
                icon={<MoreOutlined />}
                loading={deleting}
              />
            </Tooltip>
          </Dropdown>
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
