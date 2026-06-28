import { useEffect, useRef, useState, useCallback } from 'react'
import api, { getBackendHost, getWsBaseUrl } from '../auth'

/**
 * S7: fix-task 状态机收口 hook。
 *
 * <p>把 IssuesSidePanel 里散落的 5 个 ref/state
 * （{@code tasks} / {@code phaseLogs} / {@code summaries} /
 *  {@code seenConfirmRef} / {@code seenSummaryRef} / WS / poll）
 * 收到这一个 hook 里 —— IssuesSidePanel 只 render。</p>
 *
 * <p>WS 协议：fix-task 事件 <strong>只</strong>走 per-task 端点
 * {@code /ws/fix-task/{taskId}}（FixTaskWebSocketHandler），session 级别的
 * {@code /ws/logs} 不推送 fix-task 事件 —— 本 hook 用 per-task
 * 订阅，并在父组件调 {@link closeTask}（summary modal 关闭时）时
 * 主动关 socket。</p>
 *
 * <p>API：</p>
 * <ul>
 *   <li>{@code tasks} —— issueId → { taskId, status, phases[], summary, pending[], lastChecked }</li>
 *   <li>{@code summaries} —— issueId → 最近一次 fix-task.completed 的 summary</li>
 *   <li>{@code activeConfirm} —— 当前应当展示的确认弹窗（null = 不展示）</li>
 *   <li>{@code registerTask(issueId, taskId)} —— start-fix 成功后调用，开 socket</li>
 *   <li>{@code closeTask(issueId, reason?)} —— 拆 socket、删 tasks[issueId]，modal 关闭时调用</li>
 *   <li>{@code submitConfirmation(taskId, confirmationId, decision, payload)} —— 走 POST /confirm</li>
 * </ul>
 */
export function useFixTaskBus({ sessionId, enabled = true } = {}) {
  const [tasks, setTasks] = useState({})          // issueId -> { taskId, status, phases, summary, pending, lastChecked }
  const [summaries, setSummaries] = useState({})  // issueId -> summary obj (重开后还能重看)
  const [activeConfirm, setActiveConfirm] = useState(null)
  const seenConfirmRef = useRef(new Set())
  const seenSummaryRef = useRef(new Set())
  // Per-task WS —— 跟 FixTaskWebSocketHandler 配套
  const wsMapRef = useRef(new Map())  // taskId -> WebSocket
  // 镜像 tasks 供 WS message handler 用（避免 effect 闭包拿到旧值）
  const tasksRef = useRef(tasks)
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  // 镜像 activeConfirm 供 poller 用
  const activeConfirmRef = useRef(activeConfirm)
  useEffect(() => { activeConfirmRef.current = activeConfirm }, [activeConfirm])
  // pending-confirmations 轮询句柄
  const pollRef = useRef(null)

  // ── 把 taskId → issueId 映射（通过 tasksRef） ─────────────
  const lookupIssueId = useCallback((taskId) => {
    for (const [iid, t] of Object.entries(tasksRef.current)) {
      if (t && t.taskId === taskId) return iid
    }
    return null
  }, [])

  // ── WS message 统一处理 ───────────────────────────────────
  const handleMessage = useCallback((taskId, data) => {
    if (!data || !data.type) return
    const issueId = lookupIssueId(taskId)
    if (data.type === 'fix-task.completed') {
      // 重要：completed 必须先于 WS 关闭处理（modal 还要展示它）
      const key = `${taskId}:${data.ts || 0}`
      if (seenSummaryRef.current.has(key)) return
      seenSummaryRef.current.add(key)
      if (issueId) {
        setSummaries(prev => ({ ...prev, [issueId]: data }))
      }
      if (issueId) {
        setTasks(prev => prev[issueId] ? {
          ...prev,
          [issueId]: { ...prev[issueId], status: (data.status || 'completed').toLowerCase(),
                       phase: (data.phase || '').toLowerCase(),
                       summary: data, lastChecked: Date.now() }
        } : prev)
      }
      return
    }
    if (data.type === 'fix-task.phase' || data.type === 'fix-task.snapshot') {
      const phaseUpper = (data.phase || '').toUpperCase()
      const statusUpper = (data.status || '').toUpperCase()
      const phaseLower = (data.phase || '').toLowerCase()
      const statusLower = (data.status || '').toLowerCase()
      if (issueId) {
        setTasks(prev => {
          const cur = prev[issueId] || { taskId, phases: [] }
          let nextPhases
          if (data.type === 'fix-task.snapshot') {
            nextPhases = cur.phases && cur.phases.length > 0
              ? cur.phases
              : [{ phase: phaseUpper, status: statusUpper, ts: data.ts || Date.now(), note: data.note || '(snapshot)' }]
          } else {
            nextPhases = [...(cur.phases || []),
              { phase: phaseUpper, status: statusUpper, ts: data.ts || Date.now(), note: data.note || '' }]
          }
          return {
            ...prev,
            [issueId]: { ...cur, status: statusLower, phase: phaseLower, phases: nextPhases, lastChecked: Date.now() }
          }
        })
      }
    }
  }, [lookupIssueId])

  // ── 给一个 taskId 开 WS（per-task） ────────────────────────
  const openTaskSocket = useCallback((taskId) => {
    if (wsMapRef.current.has(taskId)) return
    let ws
    try {
      const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || ''
      const url = `${getWsBaseUrl()}/ws/fix-task/${encodeURIComponent(taskId)}?token=${encodeURIComponent(token)}`
      ws = new WebSocket(url)
    } catch (e) {
      return
    }
    wsMapRef.current.set(taskId, ws)
    ws.onmessage = (ev) => {
      let data
      try { data = JSON.parse(ev.data) } catch (_) { return }
      handleMessage(taskId, data)
    }
    ws.onerror = () => { /* onclose handles teardown */ }
    ws.onclose = () => {
      wsMapRef.current.delete(taskId)
      // 不自动重连 —— IssuesSidePanel 原行为，poller 是兜底
    }
  }, [handleMessage])

  // ── 主动关闭某 task 的 socket 并清掉 tasks[issueId] ────────
  const closeTask = useCallback((issueId, reason) => {
    const t = tasksRef.current[issueId]
    if (t && t.taskId) {
      const ws = wsMapRef.current.get(t.taskId)
      if (ws) { try { ws.close() } catch (_) {} }
      wsMapRef.current.delete(t.taskId)
    }
    setTasks(prev => {
      if (!prev[issueId]) return prev
      const cp = { ...prev }
      delete cp[issueId]
      return cp
    })
    // eslint-disable-next-line no-console
    if (reason) console.log('[useFixTaskBus] closeTask', issueId, reason)
  }, [])

  // ── register —— start-fix 成功后调用 ──────────────────────
  const registerTask = useCallback((issueId, taskId, status = 'running') => {
    if (!issueId || !taskId) return
    setTasks(prev => ({
      ...prev,
      [issueId]: { taskId, status, phase: '', phases: prev[issueId]?.phases || [], pending: [], lastChecked: Date.now() }
    }))
    openTaskSocket(taskId)
  }, [openTaskSocket])

  // ── pending-confirmations 轮询（confirm 事件 WS 暂未推） ───
  useEffect(() => {
    if (!enabled || !sessionId) return
    const taskEntries = Object.entries(tasks)
    if (taskEntries.length === 0) return
    const tick = async () => {
      for (const [iid, t] of taskEntries) {
        if (!t || !t.taskId) continue
        try {
          const r = await api.get(
            `/api/code-analysis/${sessionId}/fix-task/${t.taskId}/pending-confirmations`,
            { baseURL: getBackendHost() }
          ).catch(err => ({ data: { confirmations: [] } }))
          const pending = r && r.data && Array.isArray(r.data.confirmations) ? r.data.confirmations : []
          setTasks(prev => prev[iid] ? { ...prev, [iid]: { ...prev[iid], pending, lastChecked: Date.now() } } : prev)
          if (pending.length > 0 && !activeConfirmRef.current) {
            const c = pending[0]
            if (!seenConfirmRef.current.has(c.confirmation_id)) {
              seenConfirmRef.current.add(c.confirmation_id)
              setActiveConfirm({ ...c, issueId: iid })
            }
          }
        } catch (_) {}
      }
    }
    pollRef.current = setInterval(tick, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null }
  }, [enabled, sessionId, tasks])

  // ── 提交确认（IssueSidePanel 在 onConfirm 用） ─────────────
  const submitConfirmation = useCallback(async (taskId, confirmationId, decision, choiceId) => {
    if (!taskId || !confirmationId) return null
    try {
      const r = await api.post(
        `/api/code-analysis/${sessionId}/fix-task/${taskId}/confirm`,
        { confirmation_id: confirmationId, choice_id: choiceId, decision, payload: null },
        { baseURL: getBackendHost() }
      )
      setActiveConfirm(null)
      return r && r.data
    } catch (e) {
      return { status: 'error', message: e && e.message }
    }
  }, [sessionId])

  const dismissConfirm = useCallback(() => setActiveConfirm(null), [])

  // ── 卸载关所有 socket ─────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const ws of wsMapRef.current.values()) {
        try { ws.close() } catch (_) {}
      }
      wsMapRef.current.clear()
    }
  }, [])

  return {
    tasks, summaries, activeConfirm,
    registerTask, closeTask,
    submitConfirmation, dismissConfirm,
  }
}

/**
 * S7: issue 列表 + 自适应轮询 hook。
 *
 * <p>原 IssuesSidePanel 的 issues 轮询（in-progress → 2s, idle → 15s）
 * 抽到这里。</p>
 *
 * <p>API：</p>
 * <ul>
 *   <li>{@code issues} —— 后端原始列表</li>
 *   <li>{@code filtered} —— 应用 filter 后的列表</li>
 *   <li>{@code loading} —— 首次加载中</li>
 *   <li>{@code refresh()} —— 手动刷新</li>
 *   <li>{@code setIssues(updater)} —— 本地乐观更新（不重新拉）</li>
 * </ul>
 */
export function useIssueList({ sessionId, filter = 'open' } = {}) {
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!sessionId) { setIssues([]); return }
    setLoading(true)
    try {
      const r = await api.get(`/api/code-analysis/${sessionId}/issues`,
        { baseURL: getBackendHost() })
      setIssues(r && r.data && Array.isArray(r.data.issues) ? r.data.issues : [])
    } catch (e) {
      setIssues([])
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // 只在 mount + sessionId 变化时拉一次；不轮询。
  // 显式 status 变更（start-fix / status / 删除）由调用方本地乐观更新 setIssues 即可。
  useEffect(() => { refresh() }, [refresh])

  const filtered = issues.filter(i => filter === 'all' ? true : (i.status || 'open') === filter)
  return { issues, filtered, loading, refresh, setIssues }
}
