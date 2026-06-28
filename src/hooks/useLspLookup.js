import { useState, useCallback } from 'react'
import api from '../auth'

/**
 * S4: LSP 跳定义 / 引用 端点的薄 hook。
 *
 * <p>直接调后端 {@code POST /api/lsp/...}，不依赖 React 18
 * {@code use()} —— 用经典 useState 以兼容老 React 编译目标。</p>
 *
 * <p>返回：</p>
 * <ul>
 *   <li>{@code data} —— 列表（Location / Symbol）</li>
 *   <li>{@code loading} —— 是否在请求中</li>
 *   <li>{@code available} —— 后端是否"真的"回了非空结果（false = jdtls 不可用）</li>
 *   <li>{@code error} —— 网络/业务错误</li>
 * </ul>
 */
export function useLspLookup() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState([])

  const call = useCallback(async (endpoint, body) => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.post(`/lsp/${endpoint}`, body)
      // r 是 axios response；data 才是真实 body
      const payload = r && r.data ? r.data : {}
      setData(Array.isArray(payload.locations || payload.symbols) ? (payload.locations || payload.symbols) : [])
      return payload
    } catch (e) {
      setError(e && e.message ? e.message : String(e))
      setData([])
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    data,
    loading,
    error,
    available: (data && data.length > 0) || error === null,
    gotoDefinition: (workspaceRoot, file, line, col) =>
      call('definition', { workspaceRoot, file, line, col }),
    findReferences: (workspaceRoot, file, line, col, maxResults = 50) =>
      call('references', { workspaceRoot, file, line, col, maxResults }),
    documentSymbols: (workspaceRoot, file, kind) =>
      call('symbols', { workspaceRoot, file, kind }),
  }
}
