import { useRef, useCallback } from 'react';
import { getWsBaseUrl } from '../auth';

/**
 * WebSocket hook for chat log streaming.
 * Manages connection lifecycle, message dispatch, and auto-reconnect.
 * 
 * @param {Object} options
 * @param {Function} options.onPlan - callback when plan message received
 * @param {Function} options.onUiRender - callback when ui_render message received
 * @param {Function} options.onAgentStep - callback when agent_step message received
 * @param {Function} options.onAgentStream - callback when AGENT_STREAM/THOUGHT received
 * @param {Function} options.onLocalCommand - callback for local_command intercept
 * @param {Function} options.onLocalDb - callback for local_db intercept
 */
export function useWebSocket(options = {}) {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback((sessionId) => {
    if (!sessionId) return false;
    disconnect();

    try {
      const wsBase = getWsBaseUrl();
      const token = localStorage.getItem('token');
      const wsUrl = `${wsBase}/ws/logs?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token || '')}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected for session', sessionId);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const type = msg.type;
          
          if (type === 'local_command' && options.onLocalCommand) {
            options.onLocalCommand(msg);
          } else if (type === 'local_db' && options.onLocalDb) {
            options.onLocalDb(msg);
          } else if (type === 'plan' && options.onPlan) {
            options.onPlan(msg);
          } else if (type === 'ui_render' && options.onUiRender) {
            options.onUiRender(msg);
          } else if ((type === 'AGENT_STREAM' || type === 'AGENT_THOUGHT') && options.onAgentStream) {
            options.onAgentStream(msg);
          } else if (type === 'REACT_TOOL_CALL' && options.onReActToolCall) {
            // [P3] ReAct 工具调用事件 - 用于前端展示 "AI 正在使用 X 工具..."
            options.onReActToolCall(msg);
          } else if (type === 'agent_step' && options.onAgentStep) {
            options.onAgentStep(msg);
          }
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('[WS] Disconnected, code:', event.code);
        wsRef.current = null;
        // Auto-reconnect on abnormal closure (not intentional close)
        if (event.code !== 1000 && event.code !== 4001 && options.onReconnect) {
          reconnectTimerRef.current = setTimeout(() => {
            options.onReconnect();
          }, 2000);
        }
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };

      return true;
    } catch (e) {
      console.error('[WS] Connection failed:', e);
      return false;
    }
  }, [disconnect, options]);

  const isConnected = useCallback(() => {
    return wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
  }, []);

  return { connect, disconnect, isConnected, wsRef };
}
