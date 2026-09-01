import { useEffect, useRef, useCallback } from 'react'
import { getWsBaseUrl } from '../auth'

/**
 * React hook for real-time ReactSession events via WebSocket (/ws/react/{sessionId}).
 *
 * Subscribes to all events from {@link com.autobot.react.ReactEventBus} and calls
 * the corresponding callbacks when events are received. Auto-connect on mount,
 * auto-disconnect on unmount, auto-reconnect on abnormal closure.
 *
 * Event types (see backend ReactSessionEventWsBus):
 *  - onSubscribed: (sessionId) => void
 *  - onSessionCreated: (sessionId, channel) => void
 *  - onStateChanged: (sessionId, previous, current, action, turnIdKey) => void
 *  - onSessionTerminated: (sessionId, terminalState, errorMessage) => void
 *  - onToolDispatched: (sessionId, toolCallId, toolName) => void
 *  - onToolReceived: (sessionId, toolCallId, resultLength) => void
 *  - onStreamingChunk: (sessionId, agentName, chunkType, token, turnId, stepId) => void
 *  - onParallelDispatch: (sessionId, toolCalls, batchSize) => void
 *  - onBatchResult: (sessionId, toolCallIds, totalResultLength, completedCount) => void
 *  - onError: (errorMessage) => void
 *  - onClose: (code, reason) => void
 *
 * Usage:
 *   useReactSessionEvents(sessionId, {
 *     onStateChanged: (sid, prev, curr) => {
 *       setCurrentState(curr)
 *       if (curr === 'COMPLETED') refetch()
 *     },
 *     onStreamingChunk: (sid, agentName, chunkType, token) => {
 *       appendStreamingText(token)
 *     }
 *   })
 */
export function useReactSessionEvents(
  sessionId,
  {
    enabled = true,
    onSubscribed,
    onSessionCreated,
    onStateChanged,
    onSessionTerminated,
    onToolDispatched,
    onToolReceived,
    onStreamingChunk,
    onParallelDispatch,
    onBatchResult,
    onError,
    onClose,
  } = {}
) {
  const wsRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const callbacksRef = useRef({
    onSubscribed,
    onSessionCreated,
    onStateChanged,
    onSessionTerminated,
    onToolDispatched,
    onToolReceived,
    onStreamingChunk,
    onParallelDispatch,
    onBatchResult,
    onError,
    onClose,
  })

  // Update callbacks when they change to avoid stale closures
  useEffect(() => {
    callbacksRef.current = {
      onSubscribed,
      onSessionCreated,
      onStateChanged,
      onSessionTerminated,
      onToolDispatched,
      onToolReceived,
      onStreamingChunk,
      onParallelDispatch,
      onBatchResult,
      onError,
      onClose,
    }
  }, [
    onSubscribed,
    onSessionCreated,
    onStateChanged,
    onSessionTerminated,
    onToolDispatched,
    onToolReceived,
    onStreamingChunk,
    onParallelDispatch,
    onBatchResult,
    onError,
    onClose,
  ])

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'disconnected by user')
      } catch (e) {
        console.warn('[useReactSessionEvents] disconnect error', e)
      }
      wsRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (!sessionId || !enabled) return

    disconnect()

    try {
      const wsBase = getWsBaseUrl()
      const token = localStorage.getItem('token')
      const wsUrl = `${wsBase}/ws/react/${encodeURIComponent(sessionId)}` +
        (token ? `?token=${encodeURIComponent(token)}` : '')

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.debug('[ReactEventsWS] Connected', sessionId)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const { type, sessionId: sid } = msg

          switch (type) {
            case 'react.subscribed':
              if (callbacksRef.current.onSubscribed) {
                callbacksRef.current.onSubscribed(sid)
              }
              break

            case 'react.session.created':
              if (callbacksRef.current.onSessionCreated) {
                callbacksRef.current.onSessionCreated(sid, msg.channel)
              }
              break

            case 'react.state.changed':
              if (callbacksRef.current.onStateChanged) {
                callbacksRef.current.onStateChanged(
                  sid,
                  msg.previous,
                  msg.current,
                  msg.action,
                  msg.turnIdKey
                )
              }
              break

            case 'react.session.terminated':
              if (callbacksRef.current.onSessionTerminated) {
                callbacksRef.current.onSessionTerminated(
                  sid,
                  msg.terminalState,
                  msg.errorMessage
                )
              }
              break

            case 'react.tool.dispatched':
              if (callbacksRef.current.onToolDispatched) {
                callbacksRef.current.onToolDispatched(sid, msg.toolCallId, msg.toolName)
              }
              break

            case 'react.tool.received':
              if (callbacksRef.current.onToolReceived) {
                callbacksRef.current.onToolReceived(sid, msg.toolCallId, msg.resultLength)
              }
              break

            case 'react.stream.chunk':
              if (callbacksRef.current.onStreamingChunk) {
                callbacksRef.current.onStreamingChunk(
                  sid,
                  msg.agentName,
                  msg.chunkType,
                  msg.token,
                  msg.turnId,
                  msg.stepId
                )
              }
              break

            case 'react.parallel.dispatch':
              if (callbacksRef.current.onParallelDispatch) {
                callbacksRef.current.onParallelDispatch(sid, msg.toolCalls, msg.batchSize)
              }
              break

            case 'react.batch.result':
              if (callbacksRef.current.onBatchResult) {
                callbacksRef.current.onBatchResult(
                  sid,
                  msg.toolCallIds,
                  msg.totalResultLength,
                  msg.completedCount
                )
              }
              break

            default:
              console.debug('[ReactEventsWS] unknown event type', type)
          }
        } catch (e) {
          console.error('[ReactEventsWS] parse error', e)
          if (callbacksRef.current.onError) {
            callbacksRef.current.onError(`Parse error: ${e.message}`)
          }
        }
      }

      ws.onclose = (event) => {
        console.debug('[ReactEventsWS] disconnected', event.code, event.reason)
        wsRef.current = null

        if (callbacksRef.current.onClose) {
          callbacksRef.current.onClose(event.code, event.reason)
        }

        // Auto-reconnect on abnormal closure
        if (enabled && event.code !== 1000 && event.code !== 4001) {
          reconnectTimerRef.current = setTimeout(() => {
            if (enabled) {
              console.info('[ReactEventsWS] reconnecting...')
              connect()
            }
          }, 2000)
        }
      }

      ws.onerror = (error) => {
        console.error('[ReactEventsWS] error', error)
        if (callbacksRef.current.onError) {
          callbacksRef.current.onError(`WebSocket error`)
        }
      }
    } catch (e) {
      console.error('[ReactEventsWS] connection failed', e)
      if (callbacksRef.current.onError) {
        callbacksRef.current.onError(`Connection failed: ${e.message}`)
      }
    }
  }, [sessionId, enabled, disconnect])

  // Connect when enabled/sessionId changes
  useEffect(() => {
    if (enabled && sessionId) {
      connect()
    } else {
      disconnect()
    }
    return () => disconnect()
  }, [enabled, sessionId, connect, disconnect])

  const isConnected = () => {
    return wsRef.current && wsRef.current.readyState === WebSocket.OPEN
  }

  return {
    disconnect,
    isConnected,
  }
}

export default useReactSessionEvents
