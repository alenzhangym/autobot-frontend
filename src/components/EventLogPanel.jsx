import React, { useState, useEffect, useCallback } from 'react'
import { Badge, Card, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import api from '../auth'
import { useReactSessionEvents } from '../hooks/useReactSessionEvents'
const { Text } = Typography

/**
 * EventLogPanel — P3 事件溯源调试面板 (2026-09-01).
 *
 * <p>显示当前会话的事件溯源日志数量和状态，帮助用户了解会话的生命周期和历史。
 *
 * <p><b>位置（2026-10-13）</b>：以前挂在会话顶栏的 {@code Space} 里，展开后整条列表要在
 * 一行的高度里挤出来 —— 时间列只有 52px，"11:10:43" 被裁成 "1:10:43"，步骤名与正文互相叠字，
 * 等于看不见。现在由 {@code App.jsx} 挂进右侧栏（与 TODO 同一列，320px 且整栏可滚），
 * 列表默认展开，不再需要"详情"这一层。
 *
 * <p><b>实时推送</b>: 订阅 {@code /ws/react/{sessionId}}，从 {@link ReactEventBus}
 * 实时收到会话状态 / 工具调用 / 流转式事件（替代 5s HTTP 轮询）。进出事件都视为一次
 * 溯源活动，用于动态刷新计数；同时兜底保留一次 HTTP GET 初始快照。</p>
 *
 * <p><b>G9 trace 过滤 (2026-09-15)</b>: 后端 {@code /events} 接口返回最近事件列表与
 * traceId 聚合。面板可展开查看最近事件，并按 traceId 过滤（跨域请求产出的
 * CROSS_DOMAIN_LIFECYCLE 事件带 traceId，把一次跨域请求的全部子步骤关联起来）。</p>
 *
 * <p>Fail-open: 如果后端未启用事件溯源，面板显示"未启用"状态，不阻塞界面。
 */
export default function EventLogPanel({ sessionId, style }) {
  const [eventCount, setEventCount] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // G9: 最近事件列表 + traceId 聚合 + 展开/过滤状态
  const [recentEvents, setRecentEvents] = useState([])
  const [traces, setTraces] = useState({})
  const [activeTrace, setActiveTrace] = useState(null)

  // 实时事件→溯源计数：会话有事件流转时即时增加计数，替代依赖轮询刷新。
  const handleActivity = useCallback(() => {
    setEventCount((prev) => {
      setEnabled(true)
      return (prev ?? 0) + 1
    })
  }, [])
  useReactSessionEvents(sessionId, {
    onStateChanged: handleActivity,
    onSessionCreated: handleActivity,
    onSessionTerminated: handleActivity,
    onToolDispatched: handleActivity,
    onToolReceived: handleActivity,
    onParallelDispatch: handleActivity,
    onBatchResult: handleActivity,
  })

  const fetchEvents = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/react/session/${sessionId}/events`)
      if (res.data) {
        setEnabled(res.data.enabled === true)
        setEventCount(res.data.eventCount ?? 0)
        setRecentEvents(res.data.recentEvents || [])
        setTraces(res.data.traces || {})
        if (res.data.enabled === false) {
          setError(res.data.message || '未启用')
        }
      }
    } catch (e) {
      // P3: 404 表示后端未部署该端点（未重启），静默降级
      if (e?.response?.status === 404) {
        setError('未部署')
      } else {
        setError(e?.message || '请求失败')
      }
      setEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Fetch on mount and when sessionId changes
  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  // Auto-refresh every 5s while session is active
  useEffect(() => {
    if (!sessionId) return
    const timer = setInterval(fetchEvents, 5000)
    return () => clearInterval(timer)
  }, [sessionId, fetchEvents])

  // 降级三格（无会话 / 首帧加载中 / 后端未启用或未部署）：仍占同一张卡的位，不阻塞界面。
  const degraded = (body) => (
    <Card size="small" style={{ margin: 0, ...style }} title="步骤">
      <div style={{ padding: '2px 0' }}>{body}</div>
    </Card>
  )

  if (!sessionId) return degraded(<Text type="secondary" style={{ fontSize: 12 }}>无活跃会话</Text>)
  if (loading && eventCount === null) {
    return degraded(<><Spin size="small" /> <Text type="secondary" style={{ fontSize: 12 }}>加载中...</Text></>)
  }
  if (!enabled) return degraded(<Text type="secondary" style={{ fontSize: 12 }}>{error || '未启用'}</Text>)

  const eventColor = eventCount > 0 ? (eventCount > 50 ? 'blue' : 'green') : 'default'

  // G9: 按 activeTrace 过滤事件 (null/'' = 全部)
  const traceKeys = Object.keys(traces || {})
  const filteredEvents = (recentEvents || []).filter(
    (e) => !activeTrace || e.traceId === activeTrace
  )

  const formatTime = (ts) => {
    if (!ts) return ''
    try {
      const d = new Date(ts)
      return d.toLocaleTimeString('zh-CN', { hour12: false })
    } catch {
      return ''
    }
  }

  const eventLabel = (e) => {
    if (e.eventType === 'CROSS_DOMAIN_LIFECYCLE' && e.type) {
      const typeMap = {
        split: '拆解',
        started: '开始',
        completed: '完成',
        failed: '失败',
        paused: '暂停',
        clarified: '澄清',
        blocked: '阻断',
      }
      const colorMap = {
        split: 'geekblue',
        started: 'blue',
        completed: 'green',
        failed: 'red',
        paused: 'orange',
        clarified: 'gold',
        blocked: 'volcano',
      }
      const label = (typeMap[e.type] || e.type) + (e.domain ? ` · ${e.domain}` : '') + (e.stepId && e.stepId !== '-' ? ` · ${e.stepId}` : '')
      return { text: label, color: colorMap[e.type] || 'default', isCross: true }
    }
    const t = e.eventType || 'EVENT'
    const short = t.startsWith('CROSS_DOMAIN_') ? t.replace('CROSS_DOMAIN_', '跨域') : t
    return { text: short, color: 'default', isCross: false }
  }

  return (
    <Card
      size="small"
      style={{ margin: 0, ...style }}
      title={
        <Space size={6}>
          <Badge status={eventCount > 0 ? 'success' : 'default'} />
          <span>步骤</span>
          <Tag color={eventColor} style={{ margin: 0, fontSize: 11 }}>{eventCount}</Tag>
          {traceKeys.length > 0 && (
            <Tooltip title={`共 ${traceKeys.length} 个跨域 trace`}>
              <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>{traceKeys.length} trace</Tag>
            </Tooltip>
          )}
        </Space>
      }
    >
      {/* G9: trace 过滤标签 — 点击切换只看该 trace 的事件 */}
      {traceKeys.length > 0 && (
        <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>按 trace 过滤:</Text>
          <Tag
            color={!activeTrace ? 'processing' : 'default'}
            style={{ fontSize: 11, cursor: 'pointer' }}
            onClick={() => setActiveTrace(null)}
          >
            全部
          </Tag>
          {traceKeys.map((t) => (
            <Tag
              key={t}
              color={activeTrace === t ? 'purple' : 'default'}
              style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'monospace' }}
              onClick={() => setActiveTrace(activeTrace === t ? null : t)}
            >
              {t} ×{traces[t]}
            </Tag>
          ))}
        </div>
      )}

      {filteredEvents.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 11 }}>暂无事件</Text>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: '45vh', overflowY: 'auto' }}>
          {filteredEvents.map((e, idx) => {
            const label = eventLabel(e)
            return (
              <li
                key={idx}
                style={{
                  display: 'flex', gap: 6, alignItems: 'flex-start', padding: '3px 0',
                  borderBottom: '1px dashed rgba(255,255,255,0.06)',
                }}
              >
                {/* 时间列以前是 52px 且不换行 → "11:10:43" 被裁成 "1:10:43"（用户说的"看不清"） */}
                <Text
                  type="secondary"
                  style={{ fontSize: 11, width: 70, flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatTime(e.timestamp)}
                </Text>
                <div style={{ minWidth: 0 }}>
                  <Space size={4} wrap>
                    <Tag color={label.color} style={{ fontSize: 11, margin: 0 }}>{label.text}</Tag>
                    {e.traceId && (
                      <Tag color="purple" style={{ fontSize: 10, margin: 0, fontFamily: 'monospace' }}>
                        {e.traceId}
                      </Tag>
                    )}
                  </Space>
                  {label.isCross && e.message && (
                    <div style={{ fontSize: 11, marginTop: 2, wordBreak: 'break-all' }}>
                      <Text type="secondary">{e.message}</Text>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
