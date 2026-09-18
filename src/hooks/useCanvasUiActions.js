import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

/**
 * 代理画布（OpenHands-style Agent Canvas）事件→UI 路由器。
 *
 * <p>把后端经 {@code REACT_TOOL_CALL}（tool=canvas_ui）下发的 UI 指令
 * （open_tab / navigate_to_file / show_preview）以及浏览器观测事件
 * 收敛成一份面板状态，供 {@code CanvasPanel} 渲染。默认折叠、无事件时为
 * 空状态 —— 纯展示增强，关闭即可回退，不破坏 ReAct 主循环。</p>
 */
export const CANVAS_TAB = Object.freeze({
  TERMINAL: 'terminal',
  FILES: 'files',
  BROWSER: 'browser',
})

/**
 * 解析 canvas_ui 自由文本输入：
 *   首行 = action，后续行 = target=... / label=...
 * @returns {{action:string, target:string|null, label:string|null}}
 */
export function parseCanvasInput(input) {
  if (!input || typeof input !== 'string') {
    return { action: '', target: null, label: null }
  }
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const action = (lines[0] || '').toLowerCase()
  let target = null
  let label = null
  for (const line of lines.slice(1)) {
    const low = line.toLowerCase()
    if (low.startsWith('target=')) target = line.slice('target='.length).trim() || null
    else if (low.startsWith('label=')) label = line.slice('label='.length).trim() || null
  }
  return { action, target, label }
}

const INIT = {
  activeTab: CANVAS_TAB.FILES,
  hasActivity: false,
  browser: { url: null, snapshot: null, note: null, ts: null },
  files: [],        // [{ path, label, ts }]
  lastFile: null,
  directives: [],   // [{ action, target, label, ts, ok }]
}

function reducer(state, { type, payload }) {
  switch (type) {
    case '@canvas/reset':
      return { ...INIT }
    case '@canvas/open_tab': {
      const tab = Object.values(CANVAS_TAB).includes(payload) ? payload : state.activeTab
      return { ...state, activeTab: tab, hasActivity: true }
    }
    case '@canvas/locate': {
      const file = { path: payload.path, label: payload.label || payload.path, ts: payload.ts }
      const files = [...state.files.filter((f) => f.path !== file.path), file].slice(-50)
      return { ...state, files, lastFile: file, activeTab: CANVAS_TAB.FILES, hasActivity: true }
    }
    case '@canvas/browser': {
      const browser = {
        url: payload.url ?? state.browser.url,
        snapshot: payload.snapshot !== undefined ? payload.snapshot : state.browser.snapshot,
        note: payload.note !== undefined ? payload.note : state.browser.note,
        ts: Date.now(),
      }
      return {
        ...state,
        browser,
        activeTab: payload.focus ? CANVAS_TAB.BROWSER : state.activeTab,
        hasActivity: true,
      }
    }
    case '@canvas/directive': {
      return { ...state, directives: [...state.directives, payload].slice(-200), hasActivity: true }
    }
    default:
      return state
  }
}

/**
 * 返回 { state, reset, onCanvasDirective, onBrowserUrl }。
 * @param {Object} opts.enabled 是否启用（P5 透传的 UI 开关，默认 true，fail-open）。
 */
export function useCanvasUiActions({ enabled = true } = {}) {
  const [state, dispatch] = useReducer(reducer, INIT)
  const enabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const reset = useCallback(() => dispatch({ type: '@canvas/reset' }), [])

  /** 事件→UI：canvas_ui 指令输入。 */
  const onCanvasDirective = useCallback((toolInput) => {
    if (!enabledRef.current) return
    const { action, target, label } = parseCanvasInput(toolInput)
    const ts = Date.now()
    dispatch({ type: '@canvas/directive', payload: { action, target, label, ts, ok: action !== '' } })
    switch (action) {
      case 'open_tab':
        dispatch({ type: '@canvas/open_tab', payload: target })
        break
      case 'navigate_to_file':
      case 'show_preview':
        if (target) dispatch({ type: '@canvas/locate', payload: { path: target, label, ts } })
        break
      default:
        break
    }
  }, [])

  /** 事件→UI：记录浏览器观测到的 URL / 快照文本。 */
  const onBrowserUrl = useCallback((url, { focus = false, snapshot, note } = {}) => {
    if (!enabledRef.current) return
    dispatch({ type: '@canvas/browser', payload: { url, focus, snapshot, note } })
  }, [])

  return useMemo(
    () => ({ state, reset, onCanvasDirective, onBrowserUrl }),
    [state, reset, onCanvasDirective, onBrowserUrl]
  )
}

export default useCanvasUiActions