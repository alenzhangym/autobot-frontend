import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Card, List, Tag, Space, Typography, Button, Empty, Spin, Tooltip, message, Segmented, Modal, Radio } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined,
  FileTextOutlined, ReloadOutlined, FolderOpenOutlined, ToolOutlined,
  LoadingOutlined, StopOutlined, QuestionCircleOutlined,
  BranchesOutlined
} from '@ant-design/icons'
import api, { getBackendHost, getWsBaseUrl } from '../auth'
import FixSummaryCard from './FixSummaryCard'
import FixTaskStateMachine from './FixTaskStateMachine'

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
  // Latest `fix-task.completed` summary per issueId. The
  // WebSocket subscription below stores the most recent one
  // here when the backend's FixTaskEventBus publishes
  // `fix-task.completed`. We open a Modal so the user can see
  // the diff and verification result as a single card — this
  // is the only place the actual machine-verified outcome is
  // surfaced (the `fix-task.phase` events only carry phase
  // names like "COMPLETED" without the diff body).
  const [summaryModal, setSummaryModal] = useState(null)  // { issueId, summary }
  // Tracks issueIds we've already shown the summary modal for
  // in this session so the same card doesn't auto-pop twice
  // if the WS reconnects. The user can still re-open it via
  // the "查看修复结果" button on the fixed issue.
  const seenSummaryRef = useRef(new Set())
  // Persistent cache of the latest summary per issueId, so
  // that dismissing the modal does not lose the data — the
  // fixed issue row keeps a "查看修复结果" link that re-opens
  // it. Entries stay in here until the panel unmounts.
  const [summaries, setSummaries] = useState({})  // issueId -> summary obj
  // Accumulated fix-task phase events per issueId, fed by the
  // WebSocket subscription above. Each entry is
  //   { phase, status, ts, note }
  // keyed off the same issueId as `tasks`. The FixTaskStateMachine
  // component renders this as a timeline. We keep it in React
  // state (not the in-memory `tasks` map) so that
  // IssueItem-spawned modals see the full trajectory without
  // having to lift the data up to the parent.
  //
  // Reset semantics:
  //   - `fix-task.phase` events append (no dedup; backend ts
  //     + phase pair is unique per transition).
  //   - `fix-task.snapshot` seeds with a single entry ONLY if
  //     the array is empty (i.e. a tab that connects mid-flight
  //     and missed the earlier events). If we already have
  //     accumulated events, the snapshot is a no-op (preserves
  //     history across WS reconnects).
  //
  // On a hard page reload the phases for already-completed tasks
  // are lost (the WS reconnect only sends the current snapshot,
  // not the past events). This is a known limitation; for
  // in-progress tasks it is irrelevant.
  const [phaseLogs, setPhaseLogs] = useState({})  // issueId -> [{phase, status, ts, note}]
  // The currently-shown state-machine timeline modal. One at a
  // time. The shape is:
  //   {
  //     issueId, sessionId, taskId,  // for backend fetch
  //     backendPhases: [...],         // source-of-truth from GET
  //     loading: bool,                // true while fetch in flight
  //   }
  // The displayed phases are computed by merging backendPhases
  // (canonical) with phaseLogs[issueId] (live WS tail) so a tab
  // that's open during the task sees the full picture and the
  // user can keep the modal open while more events stream in.
  const [stateMachineModal, setStateMachineModal] = useState(null)

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
  // Fix-task polling — fetch PENDING CONFIRMATIONS only. Terminal
  // state (COMPLETED/FAILED) is now delivered over the WebSocket
  // subscription below; the poller used to GET /fix-task/{id} on
  // every tick, but that work is fully covered by the WS push, so
  // the only thing the poller still needs is to surface new
  // confirmations to the modal — confirmations aren't yet pushed
  // over the bus, so we still poll /pending-confirmations.
  // ─────────────────────────────────────────────────────────────────
  const pollTaskStates = useCallback(async () => {
    const entries = Object.entries(tasks)
    if (entries.length === 0) return
    for (const [issueId, t] of entries) {
      if (!t || !t.taskId) continue
      try {
        const pendingRes = await api.get(
          `/api/code-analysis/${sessionId}/fix-task/${t.taskId}/pending-confirmations`,
          { baseURL: getBackendHost() }
        ).catch(err => ({ data: { confirmations: [] }, _err: err }))
        const pending = (pendingRes.data && Array.isArray(pendingRes.data.confirmations))
          ? pendingRes.data.confirmations : []
        // Refresh the cache's pending list only. status/phase
        // come from the WebSocket; if the WS connection is broken
        // the parent 2s `refresh()` will eventually re-read the
        // issue from IssueStore and the "修复中" tag will clear
        // on its own.
        setTasks(prev => prev[issueId] ? {
          ...prev,
          [issueId]: { ...prev[issueId], pending, lastChecked: Date.now() }
        } : prev)
        // AWAITING_CONFIRMATION is not strictly "terminal" — the
        // user can still reply and the task can transition to
        // COMPLETED. Surface the modal if we haven't shown this
        // confirmation yet.
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

  // Fetch the state-machine timeline from the backend whenever
  // the modal opens for a fresh issueId. The backend is the
  // source of truth — the WS events we accumulated in
  // phaseLogs are lossy on reconnect. The merge in render
  // combines backend (canonical) with phaseLogs (live tail).
  //
  // We key the effect on stateMachineModal.issueId rather than
  // the whole object so re-renders triggered by setLoading or
  // setBackendPhases don't re-fetch. We use a ref-equivalent
  // guard to discard the result if the user has already
  // closed the modal by the time the fetch resolves (avoids
  // a setState on a closed modal — a benign no-op but still
  // noise on the console).
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
        // Normalise the backend payload into the same shape
        // as phaseLogs entries:
        //   { phase (upper-case), status, ts (epoch ms), note }
        // The backend ships ts as ISO-8601 (consistent with
        // the other created_at/updated_at fields on the same
        // payload); phaseLogs uses epoch ms. FixTaskStateMachine
        // only knows the latter, so we parse on the way in.
        // status is not per-transition in the store; we
        // synthesise it from the task's current status (the
        // last entry inherits the terminal status, everything
        // else is "RUNNING"). The store's per-task status
        // lives at res.data.task.status.
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
        // Fetch failure is non-fatal — the modal still
        // renders the live phaseLogs we accumulated via WS.
        if (cancelled) return
        setStateMachineModal(sm => sm
          ? { ...sm, loading: false, backendPhases: [] } : sm)
      })
    return () => { cancelled = true }
  }, [stateMachineModal && stateMachineModal.issueId])

  // Merge the backend timeline (canonical, fetched on modal
  // open) with the live phaseLogs (WS tail appended while the
  // modal stays open). Hoisted out of the JSX IIFE to keep
  // useMemo's hook order stable. See the modal body for the
  // merge rules.
  const mergedTimeline = useMemo(() => {
    if (!stateMachineModal) return []
    const { issueId, backendPhases, loading } = stateMachineModal
    const live = phaseLogs[issueId] || []
    if (loading && (!backendPhases || backendPhases.length === 0)) {
      return live
    }
    if (!backendPhases || backendPhases.length === 0) {
      return live
    }
    if (live.length === 0) return backendPhases
    const lastBackendTs = backendPhases[backendPhases.length - 1].ts
    const newLive = live.filter(p => p.ts > lastBackendTs)
    return [...backendPhases, ...newLive]
  }, [stateMachineModal, phaseLogs])

  useEffect(() => {
    if (Object.keys(tasks).length === 0) return
    const id = setInterval(pollTaskStates, 2000)
    return () => clearInterval(id)
  }, [Object.keys(tasks).length, pollTaskStates])  // eslint-disable-line

  // ─────────────────────────────────────────────────────────────────
  // Fix-task WebSocket subscription — primary path for terminal
  // status. The backend's FixTaskEventBus publishes one
  // JSON envelope per phase transition over
  //   ws://host/ws/fix-task/{taskId}
  // and pushes a one-shot snapshot on connect so a tab that
  // opens mid-flight sees the correct state immediately.
  //
  // For each active taskId we open one socket, parse each
  // fix-task.phase / fix-task.snapshot message, update the task
  // cache, and on terminal (COMPLETED/FAILED) mirror the state
  // onto the issue. The poller above is intentionally kept as a
  // defense-in-depth: if the WS handshake fails (corporate proxy
  // stripping the Upgrade header, brief network blip) the next
  // 2s `refresh()` tick will still observe the right issue
  // status from IssueStore.
  // ─────────────────────────────────────────────────────────────────
  const wsRef = useRef(new Map())  // taskId → WebSocket
  // Mirror the latest `tasks` snapshot so the WS message handler
  // can map taskId → issueId without depending on the effect's
  // `tasks` closure (which is captured at effect run time and
  // would otherwise see a stale view).
  const tasksRef = useRef(tasks)
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  useEffect(() => {
    const currentTaskIds = new Set()
    for (const t of Object.values(tasks)) {
      if (t && t.taskId) currentTaskIds.add(t.taskId)
    }
    // Close sockets for taskIds that are no longer active (task
    // was cleaned up after reaching a terminal state, or the user
    // closed the issue).
    for (const [taskId, ws] of Array.from(wsRef.current.entries())) {
      if (!currentTaskIds.has(taskId)) {
        try { ws.close() } catch (_) { /* idempotent */ }
        wsRef.current.delete(taskId)
      }
    }
    // Open sockets for new taskIds. We do not auto-reconnect on
    // close — keeps the implementation simple per AGENTS.md and
    // matches the "poller is the safety net" design.
    for (const taskId of currentTaskIds) {
      if (wsRef.current.has(taskId)) continue
      const token = encodeURIComponent(localStorage.getItem('token') || '')
      const url = `${getWsBaseUrl()}/ws/fix-task/${taskId}?token=${token}`
      let ws
      try {
        ws = new WebSocket(url)
      } catch (e) {
        // Browser refused to open the socket (e.g. invalid URL,
        // mixed-content block). The poller above still covers
        // this task.
        continue
      }
      wsRef.current.set(taskId, ws)
      ws.onmessage = (ev) => {
        let data
        try { data = JSON.parse(ev.data) } catch (_) { return }
        if (!data) return
        // Map taskId → issueId via the latest tasks snapshot.
        let issueId = null
        for (const [iid, tt] of Object.entries(tasksRef.current)) {
          if (tt && tt.taskId === taskId) { issueId = iid; break }
        }
        if (!issueId) return
        if (data.type === 'fix-task.completed') {
          // Heavyweight summary: contains diffs and verification.
          // Stash it per-issueId and pop the modal. We dedupe by
          // taskId+ts so a WS reconnect (which re-sends the
          // snapshot but not the completed event — yet, the
          // server could replay it) doesn't double-show.
          const key = `${taskId}:${data.ts || 0}`
          if (seenSummaryRef.current.has(key)) return
          seenSummaryRef.current.add(key)
          setSummaries(prev => ({ ...prev, [issueId]: data }))
          setSummaryModal({ issueId, summary: data })
          // The backend has just updated the chat-stream's
          // placeholder message in place (createFixIssueMessage
          // → updateFixIssueMessage). The chat UI does NOT poll
          // messages on its own, so we have to nudge App.jsx to
          // re-fetch the session history; otherwise the bubble
          // stays stuck on "🔧 已开始修复…" and the user sees
          // the placeholder instead of the verdict + diff.
          if (typeof onFixIssueMessageUpdated === 'function') {
            try { onFixIssueMessageUpdated(issueId) } catch (_) {}
          }
          return
        }
        if (data.type !== 'fix-task.phase'
            && data.type !== 'fix-task.snapshot') return
        const status = (data.status || '').toLowerCase()
        const phase = (data.phase || '').toLowerCase()
        // Append to the state-machine trajectory log. We do
        // this for BOTH `phase` and `snapshot` events so a tab
        // that connects mid-flight at least sees the current
        // phase (snapshot seed). The snapshot is a no-op when
        // the log is non-empty (preserves history across WS
        // reconnects).
        //
        // The backend serialises phase/status as upper-case
        // ("ANALYZING", "RUNNING"). The existing `phase` and
        // `status` variables here are lower-cased for the
        // `tasks` state; for the trajectory we keep the
        // upper-case form to match FixTaskStateMachine's color
        // table and the user's expectations (which come from
        // the same names on the backend).
        const phaseUpper = (data.phase || '').toUpperCase()
        const statusUpper = (data.status || '').toUpperCase()
        setPhaseLogs(prev => {
          const cur = prev[issueId] || []
          if (data.type === 'fix-task.snapshot') {
            // Tab connected mid-flight: only seed if we have
            // nothing yet. The snapshot carries the current
            // phase as a single entry.
            if (cur.length > 0) return prev
            return { ...prev,
              [issueId]: [{ phase: phaseUpper, status: statusUpper,
                ts: data.ts || Date.now(),
                note: data.note || '(snapshot)' }] }
          }
          // `fix-task.phase`: append. Backend never re-sends the
          // same (ts, phase) pair for the same task, so we don't
          // need to dedup. Use a functional setState form to
          // avoid races between two events arriving in quick
          // succession.
          return { ...prev,
            [issueId]: [...cur,
              { phase: phaseUpper, status: statusUpper,
                ts: data.ts || Date.now(),
                note: data.note || '' }] }
        })
        setTasks(prev => prev[issueId] ? {
          ...prev,
          [issueId]: {
            ...prev[issueId],
            status, phase, lastChecked: Date.now()
          }
        } : prev)
        if (status === 'completed') {
          message.success('修复任务已完成，代码已通过校验')
          setIssues(prev => prev.map(i =>
            i.issueId === issueId ? { ...i, status: 'fixed' } : i))
          cleanupTask(issueId)
          try { ws.close() } catch (_) {}
          wsRef.current.delete(taskId)
        } else if (status === 'failed') {
          message.warning('修复任务校验未通过，已回到待处理')
          setIssues(prev => prev.map(i =>
            i.issueId === issueId ? { ...i, status: 'open' } : i))
          cleanupTask(issueId)
          try { ws.close() } catch (_) {}
          wsRef.current.delete(taskId)
        }
      }
      ws.onclose = () => {
        // Drop the dead socket. If the task is still active the
        // parent 2s `refresh()` will re-read the issue from
        // IssueStore and the poller will keep an eye on pending
        // confirmations.
        wsRef.current.delete(taskId)
      }
      ws.onerror = () => { /* onclose will follow */ }
    }
  }, [tasks])

  // Close all sockets when the component unmounts.
  useEffect(() => {
    return () => {
      for (const ws of wsRef.current.values()) {
        try { ws.close() } catch (_) {}
      }
      wsRef.current.clear()
    }
  }, [])

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
        // Register the task so the poller starts watching it.
        // status: 'running' is the post-FixTaskStore.createTask
        // value; the next poll tick will overwrite it with the
        // current task.status (also 'running' until the driver
        // reaches a terminal phase).
        setTasks(prev => ({
          ...prev,
          [issue.issueId]: { taskId, status: data.task?.status || 'running', pending: [] }
        }))
      }
      // After the async refactor, the synchronous response only
      // contains status=started (or one of the synchronous error
      // values below). Verified/Failed/Executing/Awaiting are no
      // longer possible in the HTTP body — the poller picks them
      // up on the next tick.
      if (data.status === 'dispatch_error') {
        message.error('派发修复任务失败: ' + (data.message || '未知错误'))
        if (taskId) cleanupTask(issue.issueId)
        // Roll back the optimistic in_progress.
        setIssues(prev => prev.map(i =>
          i.issueId === issue.issueId ? { ...i, status: 'open' } : i))
      } else {
        message.info('修复任务已派发，CodeAgent 正在执行，可在任务列表中查看进度')
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
                onViewSummary={summaries[issue.issueId]
                  ? () => setSummaryModal({ issueId: issue.issueId,
                      summary: summaries[issue.issueId] })
                  : null}
                // State-machine timeline. We surface the button
                // for both in_progress (live trajectory) and
                // fixed (post-mortem) issues, as long as we have
                // at least one phase event to show. For a
                // task that completed before this tab connected
                // (no events accumulated), the button is hidden
                // — the trajectory is gone in that case.
                //
                // We always pass sessionId + taskId so the modal
                // can refetch the canonical timeline from the
                // backend; the WS-accumulated phaseLogs only
                // covers events the current tab observed.
                onViewStateMachine={
                  ((phaseLogs[issue.issueId] || []).length > 0
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
        onCancel={() => setActiveConfirm(null)}
        onConfirm={(choiceId) => submitConfirmation(activeConfirm, choiceId)}
        busy={!!activeConfirm && busyId === activeConfirm.issueId}
      />
      {/* Fix-task completed summary. The backend's
          FixTaskEventBus pushes one `fix-task.completed` event
          per task (carrying the diffs + verification result).
          We surface it as a modal so the user can see exactly
          what changed and whether the build passed. */}
      <Modal
        open={!!summaryModal}
        onCancel={() => setSummaryModal(null)}
        footer={null}
        width={760}
        title={null}
        destroyOnClose
      >
        {summaryModal && (
          <FixSummaryCard
            summary={summaryModal.summary}
            onClose={() => setSummaryModal(null)}
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
