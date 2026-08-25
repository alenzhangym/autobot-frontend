import React, { useState, useEffect, useCallback } from 'react'
import { Badge, Collapse, Spin, Tag, Typography } from 'antd'
import api from '../auth'
const { Text } = Typography

/**
 * EventLogPanel — P3 事件溯源调试面板 (2026-08-25).
 *
 * <p>显示当前会话的事件溯源日志数量和状态，帮助用户了解会话的生命周期和历史。
 * <p>所有数据通过 {@code GET /react/session/{sessionId}/events} 获取。
 * (axios baseURL 已含 /api 前缀, 路径不能再带 /api, 否则会变成 /api/api/... 导致 404)
 *
 * <p>Fail-open: 如果后端未启用事件溯源，面板显示"未启用"状态，不阻塞界面。
 */
export default function EventLogPanel({ sessionId, style }) {
  const [eventCount, setEventCount] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchEvents = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/react/session/${sessionId}/events`)
      if (res.data) {
        setEnabled(res.data.enabled === true)
        setEventCount(res.data.eventCount ?? 0)
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

  if (!sessionId) {
    return (
      <div style={{ padding: '4px 8px', ...style }}>
        <Text type="secondary" style={{ fontSize: 12 }}>事件溯源: 无活跃会话</Text>
      </div>
    )
  }

  if (loading && eventCount === null) {
    return (
      <div style={{ padding: '4px 8px', ...style }}>
        <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12 }}>加载中...</Text>
      </div>
    )
  }

  if (!enabled) {
    return (
      <div style={{ padding: '4px 8px', ...style }}>
        <Text type="secondary" style={{ fontSize: 12 }}>事件溯源: {error || '未启用'}</Text>
      </div>
    )
  }

  const eventColor = eventCount > 0 ? (eventCount > 50 ? 'blue' : 'green') : 'default'

  return (
    <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, ...style }}>
      <Badge status={eventCount > 0 ? 'success' : 'default'} />
      <Text style={{ fontSize: 12 }}>
        事件溯源:
      </Text>
      <Tag color={eventColor} style={{ margin: 0, fontSize: 11 }}>
        {eventCount} 条事件
      </Tag>
      {eventCount > 0 && (
        <Text type="secondary" style={{ fontSize: 11 }}>
          (可重建会话状态)
        </Text>
      )}
    </div>
  )
}