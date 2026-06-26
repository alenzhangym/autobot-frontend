import { useEffect, useRef, useState, useCallback } from 'react'
import api from '../auth'

/**
 * 路线 B: 轮询后端 re-verify 进度接口, 给右下角 Toast 用。
 *
 * 用法:
 *   const { progress, dismiss } = useReVerifyStatusPoller({
 *     sessionId,
 *     enabled: true,         // IntentCorrectionFloater 提交成功 + re_verify=true 时启用
 *     pollIntervalMs: 2000,  // 默认 2s
 *     onDone: (final) => { ... }  // 收到 running=false 的最终 snapshot 时触发
 *   })
 *
 * 返回的 progress 形如:
 *   { status: 'ok', running: true, sessionId, goal, total, toCheck, checked,
 *     fixed, stillOpen, changed, failed, currentIssue, elapsedMs }
 *
 * 行为:
 * - enabled=false → 不轮询, progress 保持 null
 * - 拉取失败 → 不抛错, 静默重试
 * - 拉到 running=false (或 status='no_record') → 停轮询 + 调 onDone + 自动调 DELETE dismiss
 * - 组件 unmount → 自动停轮询 + 自动 dismiss (避免后台还在轮空)
 */
export function useReVerifyStatusPoller({
  sessionId,
  enabled = true,
  pollIntervalMs = 2000,
  onDone,
} = {}) {
  const [progress, setProgress] = useState(null)
  const pollingRef = useRef(false)
  const timerRef = useRef(null)
  const enabledRef = useRef(enabled)
  const sessionIdRef = useRef(sessionId)
  const onDoneRef = useRef(onDone)

  // 镜像 props, 避免 effect 闭包拿到旧值
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  const dismiss = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) return
    try {
      await api.delete(`/code-analysis/${encodeURIComponent(sid)}/re-verify-status`)
    } catch (e) {
      // 静默 — 即便后端没记录 (404), 也无所谓
    }
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pollingRef.current = false
  }, [])

  useEffect(() => {
    if (!enabled || !sessionId) {
      setProgress(null)
      stop()
      return
    }

    pollingRef.current = true
    let cancelled = false

    const tick = async () => {
      if (cancelled || !pollingRef.current) return
      const sid = sessionIdRef.current
      if (!sid) return
      try {
        const r = await api.get(`/code-analysis/${encodeURIComponent(sid)}/re-verify-status`)
        if (cancelled) return
        const data = r && r.data
        if (!data) {
          scheduleNext()
          return
        }
        setProgress(data)
        // 终止条件 1: 后端说"没有记录" (从未启动 / 已 dismiss)
        // 终止条件 2: 收到 running=false 的最终 snapshot
        const isDone = data.running === false
        if (isDone) {
          stop()
          if (typeof onDoneRef.current === 'function') {
            try { onDoneRef.current(data) } catch (e) { console.error(e) }
          }
          // 自动 dismiss 释放后端 in-memory 记录
          dismiss()
          return
        }
        scheduleNext()
      } catch (e) {
        // 网络错误: 不打断, 下个 tick 再试
        if (!cancelled) scheduleNext()
      }
    }

    const scheduleNext = () => {
      if (cancelled || !pollingRef.current) return
      timerRef.current = setTimeout(tick, pollIntervalMs)
    }

    tick()

    return () => {
      cancelled = true
      stop()
      // 组件 unmount 时也 dismiss (避免内存里堆记录)
      dismiss()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, pollIntervalMs])

  return { progress, dismiss }
}
