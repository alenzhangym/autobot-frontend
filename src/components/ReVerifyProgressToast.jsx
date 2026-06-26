import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Progress, Space, Tag, Typography, Button } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined,
  ClockCircleOutlined, CloseOutlined, SyncOutlined, RocketOutlined,
} from '@ant-design/icons'
import { useReVerifyStatusPoller } from '../hooks/useReVerifyStatusPoller'

const { Text } = Typography

function fmtElapsed(ms) {
  if (!ms || ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m} 分 ${rs} 秒`
}

export default function ReVerifyProgressToast({ sessionId, enabled, onDone }) {
  const [hideRequested, setHideRequested] = useState(false)

  const handleDone = useCallback((final) => {
    if (typeof onDone === 'function') {
      try { onDone(final) } catch (e) { console.error(e) }
    }
  }, [onDone])

  const { progress, dismiss } = useReVerifyStatusPoller({
    sessionId,
    enabled: enabled && !!sessionId,
    pollIntervalMs: 2000,
    onDone: handleDone,
  })

  // 1s tick — 仅在 running 时刷 elapsedMs 显示
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled || !sessionId) return
    if (!progress) return
    if (progress.running === false) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [enabled, sessionId, progress && progress.running])

  // 显式 "关闭" 按钮: hideRequested, 等到 running=false 后才真正卸载
  const handleDismiss = useCallback(() => {
    setHideRequested(true)
    try { dismiss() } catch (e) { /* ignore */ }
    if (typeof onDone === 'function') {
      onDone(progress)
    }
  }, [dismiss, onDone, progress])

  // 没启用 / 没数据 / 主动隐藏: 不渲染
  if (!enabled || !sessionId) return null
  if (!progress) return null
  if (hideRequested && progress.running === false) return null

  const running = progress.running === true
  const total = Number(progress.toCheck || 0)
  const checked = Number(progress.checked || 0)
  const fixed = Number(progress.fixed || 0)
  const stillOpen = Number(progress.stillOpen || 0)
  const changed = Number(progress.changed || 0)
  const failed = Number(progress.failed || 0)
  const backendElapsed = Number(progress.elapsedMs || 0)
  const elapsedMs = running ? backendElapsed + (tick * 1000) : backendElapsed
  const percent = total > 0 ? Math.min(100, Math.round((checked / total) * 100)) : 0

  const status = progress.errorMessage
    ? 'exception'
    : (running ? 'active' : 'success')

  return (
    <div
      data-reverify-toast
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 2000,
        width: 400,
        maxWidth: 'calc(100vw - 48px)',
        // 半透明白 + backdrop blur: 让下方聊天文字仍可透出, 不被实心白底完全挡住
        background: 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(232, 232, 232, 0.9)',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <RocketOutlined style={{ color: '#1677ff', marginRight: 8, fontSize: 16 }} />
        <Text strong style={{ fontSize: 14 }}>
          {running
            ? '正在重新核实 issue'
            : (progress.errorMessage ? '重新核实异常' : '重新核实完成')}
        </Text>
      </div>

      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: progress.goal }}>
          {progress.goal
            ? (progress.goal.length > 30 ? progress.goal.slice(0, 30) + '…' : progress.goal)
            : '重新核实中'}
        </Text>
      </div>

      <Progress
        percent={percent}
        status={status}
        format={() => `${checked} / ${total}`}
        strokeWidth={10}
      />

      <Space size={6} wrap style={{ marginTop: 10 }}>
        <Tag color="success" icon={<CheckCircleOutlined />}>已修复 {fixed}</Tag>
        <Tag color="error" icon={<CloseCircleOutlined />}>仍存在 {stillOpen}</Tag>
        <Tag color="warning" icon={<WarningOutlined />}>已变更 {changed}</Tag>
        <Tag color="default" icon={<ClockCircleOutlined />}>失败/超时 {failed}</Tag>
      </Space>

      {running && progress.currentIssue && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
            <SyncOutlined spin style={{ marginRight: 4 }} />
            正在核实: {progress.currentIssue}
          </Text>
        </div>
      )}

      {progress.errorMessage && (
        <div style={{ marginTop: 8 }}>
          <Text type="danger" style={{ fontSize: 12 }}>
            {progress.errorMessage}
          </Text>
        </div>
      )}

      <div style={{
        marginTop: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <Text
          type={running ? 'secondary' : (progress.errorMessage ? 'danger' : 'success')}
          style={{ fontSize: 12 }}
        >
          {fmtElapsed(elapsedMs)}
        </Text>
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          onClick={handleDismiss}
        >
          关闭
        </Button>
      </div>
    </div>
  )
}
