import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react'
import { getWsBaseUrl } from '../auth'

/**
 * S1: FixTaskContext —— WS 是 fix-task 信息的唯一真源。
 *
 * <p>历史背景：fix-issue / fix-summary 信息原本以两种形式传递：
 * ① 后端写 {@code Message.meta} JSON 字符串（{@code "fix_issue"/"fix_summary"}）
 * ② 后端通过 WebSocket 推 {@code fix-task.*} 事件（{@code fix-task.phase /
 *   fix-task.completed / fix-task.confirm}）。{@code MessageBubble} 同时消费
 *   两种来源，于是出现"双轨真相"风险 —— 两侧可能写出不一致的内容。</p>
 *
 * <p>S1 收敛：把 fix-task 信息集中在 React Context，{@code MessageBubble}
 * 只读 context，<strong>不再解析</strong> {@code msg.meta} 中的
 * {@code "fix_issue"/"fix_summary"} 字段。后端继续写 {@code meta}（DB schema
 * 不动），但前端 UI 路径完全走 WS。</p>
 *
 * <h3>结构</h3>
 * <ul>
 *   <li>{@code fixTasks} —— Map&lt;taskId, { status, patches, phases[], summary }&gt;</li>
 *   <li>{@code issueIndex} —— Map&lt;issueId, taskId&gt;（用于 message → task 反查）</li>
 *   <li>{@code getFixTaskForIssue(issueId)} —— 查询接口</li>
 * </ul>
 *
 * <p>向后兼容：如果某条 chat message 对应 task 在 context 中不存在
 * （冷启动 / 重连后丢失），回退到"占位符卡片"，提示用户等 WS 同步完。</p>
 */

const FixTaskContext = createContext(null)

export function FixTaskProvider({ sessionId, children }) {
  const [fixTasks, setFixTasks] = useState({})        // taskId -> { status, patches, phases[], summary, issueId }
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  // 累积事件：fix-task.phase 按 ts 排，fix-task.completed 是终态
  const ingest = useCallback((msg) => {
    if (!msg || !msg.type) return
    const type = msg.type
    if (type === 'fix-task.phase') {
      const { taskId, issueId, phase, status, ts, note } = msg
      if (!taskId) return
      setFixTasks(prev => {
        const cur = prev[taskId] || { phases: [], patches: [], status: 'pending' }
        const phases = [...(cur.phases || []), { phase, status, ts, note }]
        return {
          ...prev,
          [taskId]: {
            ...cur,
            issueId: issueId || cur.issueId,
            phases,
            status: status || cur.status,
          }
        }
      })
    } else if (type === 'fix-task.completed') {
      const { taskId, issueId, status, patches, summary } = msg
      if (!taskId) return
      setFixTasks(prev => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || {}),
          issueId: issueId || (prev[taskId] && prev[taskId].issueId),
          status: status || 'completed',
          patches: patches || (prev[taskId] && prev[taskId].patches) || [],
          summary: summary || (prev[taskId] && prev[taskId].summary),
        }
      }))
    } else if (type === 'fix-task.confirm') {
      const { taskId, issueId, confirmId, prompt } = msg
      if (!taskId) return
      setFixTasks(prev => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || {}),
          issueId: issueId || (prev[taskId] && prev[taskId].issueId),
          pendingConfirm: { confirmId, prompt },
        }
      }))
    }
  }, [])

  // 启动 WS 订阅 sessionId 的 fix-task.* 事件
  const subscribe = useCallback((sid) => {
    if (!sid) return
    if (wsRef.current) {
      try { wsRef.current.close() } catch (e) {}
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }
    try {
      const wsBase = getWsBaseUrl()
      const token = localStorage.getItem('token') || ''
      const wsUrl = `${wsBase}/ws/logs?session_id=${encodeURIComponent(sid)}&token=${encodeURIComponent(token)}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data)
          if (m && m.type && String(m.type).startsWith('fix-task.')) {
            ingest(m)
          }
        } catch (_) {}
      }
      ws.onclose = (ev) => {
        if (ev && ev.code !== 1000 && ev.code !== 4001) {
          reconnectRef.current = setTimeout(() => subscribe(sid), 2000)
        }
      }
    } catch (e) {
      // 静默失败：UI 走 legacy 路径
    }
  }, [ingest])

  if (sessionId) {
    // 简单 useEffect 替代品
    if (wsRef.current === null || (wsRef.current && wsRef.current.url.indexOf(sessionId) < 0)) {
      subscribe(sessionId)
    }
  }

  const getFixTaskByTaskId = useCallback((taskId) => {
    if (!taskId) return null
    return fixTasks[taskId] || null
  }, [fixTasks])

  const getFixTaskForIssue = useCallback((issueId) => {
    if (!issueId) return null
    for (const t of Object.values(fixTasks)) {
      if (t.issueId === issueId) return t
    }
    return null
  }, [fixTasks])

  const value = useMemo(() => ({
    fixTasks,
    getFixTaskByTaskId,
    getFixTaskForIssue,
  }), [fixTasks, getFixTaskByTaskId, getFixTaskForIssue])

  return <FixTaskContext.Provider value={value}>{children}</FixTaskContext.Provider>
}

export function useFixTaskContext() {
  const ctx = useContext(FixTaskContext)
  if (!ctx) {
    // 在 Provider 外使用 → 返回 stub（不抛，避免回归）
    return {
      fixTasks: {},
      getFixTaskByTaskId: () => null,
      getFixTaskForIssue: () => null,
    }
  }
  return ctx
}

/**
 * 工具函数：从 message 行推断 taskId / issueId。
 *
 * <p>S1 起不再依赖 {@code msg.meta} 中的"fix_issue" JSON 字符串（已弃用），
 * 但允许从 meta 中"被动"读 taskId / issueId（仅用作 key）。真正的状态、阶段、
 * 摘要、patches 全部走 {@link useFixTaskContext}。</p>
 */
export function extractFixTaskKeysFromMessage(msg) {
  if (!msg || !msg.meta) return { taskId: null, issueId: null }
  const m = String(msg.meta)
  const taskIdMatch = m.match(/"taskId"\s*:\s*"([^"]+)"/)
  const issueIdMatch = m.match(/"issueId"\s*:\s*"([^"]+)"/)
  return {
    taskId: taskIdMatch ? taskIdMatch[1] : null,
    issueId: issueIdMatch ? issueIdMatch[1] : null,
  }
}
