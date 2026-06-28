import { useCallback, useEffect, useRef, useState } from 'react'
import api, { getBackendHost, getWsBaseUrl } from '../auth'

/**
 * v5 N-8: 把 LLM 的「问用户 / 维护 TODO」状态收口到一个 hook。
 *
 * <h3>数据来源</h3>
 * <ul>
 *   <li>HTTP：{@code /api/local/questions} 和 {@code /api/local/todos}
 *       —— 拉初始 / 兜底 polling</li>
 *   <li>WS：{@code /ws/logs?session_id=...} 推 {@code question.ask} /
 *       {@code question.answered} / {@code question.expired} /
 *       {@code todo.update} 事件 —— 实时</li>
 * </ul>
 *
 * <h3>API</h3>
 * <ul>
 *   <li>{@code pendingQuestion} —— 当前应当弹的 question（null = 不弹）</li>
 *   <li>{@code todos} —— 当前 TODO 列表</li>
 *   <li>{@code answerQuestion(id, answer)} —— 用户在弹窗选了</li>
 *   <li>{@code updateTodo(id, patch)} —— 用户在 UI 改某条状态</li>
 *   <li>{@code clearTodos()} —— 清空</li>
 * </ul>
 *
 * <p>为什么不用 zustand：跟 LLM 单 session 生命周期绑定，组件级 state
 * 足够，避免跨组件同步 todo 状态。</p>
 */
export function useInteractiveState({ sessionId, enabled = true } = {}) {
  const [pendingQuestions, setPendingQuestions] = useState([])   // queue
  const [todos, setTodos] = useState({ items: [], updatedAt: 0 })
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  // mirror 给 WS handler 用
  const sessionRef = useRef(sessionId)
  useEffect(() => { sessionRef.current = sessionId }, [sessionId])

  // ── HTTP helpers ───────────────────────────────────────────────
  const reloadTodos = useCallback(async () => {
    if (!sessionRef.current) return
    try {
      const r = await api.get('/local/todos', { params: { sessionId: sessionRef.current } })
      const body = r && r.data ? r.data : {}
      setTodos({ items: body.items || [], updatedAt: body.updatedAt || 0 })
    } catch (e) {
      // silently ignore — backend may be down
    }
  }, [])

  const reloadQuestions = useCallback(async () => {
    if (!sessionRef.current) return
    try {
      const r = await api.get('/local/questions/pending', { params: { sessionId: sessionRef.current } })
      const body = r && r.data ? r.data : {}
      setPendingQuestions(body.questions || [])
    } catch (e) { /* ignore */ }
  }, [])

  const answerQuestion = useCallback(async (id, answer) => {
    try {
      const r = await api.post(`/local/questions/${id}/answer`,
        { answer, sessionId: sessionRef.current })
      if (r && r.data && r.data.question) {
        // 立即从 pending 列表里拿掉，避免再弹
        setPendingQuestions((prev) => prev.filter((q) => q.id !== id))
      }
      return !!(r && r.data && r.data.status === 'ok')
    } catch (e) {
      return false
    }
  }, [])

  const updateTodo = useCallback(async (id, patch) => {
    try {
      const r = await api.patch(`/local/todos/${id}`, patch, {
        params: { sessionId: sessionRef.current },
      })
      if (r && r.data && r.data.items) {
        setTodos({ items: r.data.items, updatedAt: r.data.updatedAt || 0 })
      }
      return !!(r && r.data && r.data.status === 'ok')
    } catch (e) {
      return false
    }
  }, [])

  const clearTodos = useCallback(async () => {
    try {
      const r = await api.delete('/local/todos', { params: { sessionId: sessionRef.current } })
      if (r && r.data) {
        setTodos({ items: r.data.items || [], updatedAt: r.data.updatedAt || 0 })
      }
    } catch (e) { /* ignore */ }
  }, [])

  // ── WS 订阅 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !sessionId) return undefined
    let stop = false
    const base = getWsBaseUrl()
    const token = localStorage.getItem('token') || ''
    const url = `${base}/ws/logs?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`
    let ws
    try { ws = new WebSocket(url) } catch (e) { return undefined }
    wsRef.current = ws

    ws.onopen = () => {
      if (stop) return
      setConnected(true)
      // 拿到新连接时拉一次
      reloadQuestions()
      reloadTodos()
    }
    ws.onclose = () => {
      if (stop) return
      setConnected(false)
    }
    ws.onerror = () => { /* onclose 会接 */ }
    ws.onmessage = (ev) => {
      if (stop) return
      let msg
      try { msg = JSON.parse(ev.data) } catch (e) { return }
      const sid = sessionRef.current
      if (msg.sessionId && sid && msg.sessionId !== sid) return   // 别 session 的事件不要
      if (msg.type === 'question.ask') {
        // 推过来的 ask 不一定有 sessionId；按 queue 处理
        setPendingQuestions((prev) => {
          if (prev.some((q) => q.id === msg.id)) return prev
          return [...prev, {
            id: msg.id, sessionId: msg.sessionId || sid, question: msg.question,
            options: msg.options, multiSelect: msg.multiSelect, header: msg.header,
            default: msg.default, createdAt: msg.createdAt, status: 'pending',
          }]
        })
      } else if (msg.type === 'question.answered' || msg.type === 'question.expired') {
        setPendingQuestions((prev) => prev.filter((q) => q.id !== msg.id))
      } else if (msg.type === 'todo.update') {
        if (Array.isArray(msg.items)) {
          setTodos({ items: msg.items, updatedAt: msg.updatedAt || Date.now() })
        }
      }
    }

    // 第一次 mount 拉一次
    reloadQuestions()
    reloadTodos()

    return () => {
      stop = true
      try { ws.close() } catch (e) { /* ignore */ }
      wsRef.current = null
      setConnected(false)
    }
  }, [sessionId, enabled, reloadQuestions, reloadTodos])

  return {
    pendingQuestions,
    todos,
    connected,
    answerQuestion,
    updateTodo,
    clearTodos,
    reloadQuestions,
    reloadTodos,
  }
}
