import { useMemo } from 'react'

/**
 * 共享 unified diff 渲染件 (F15)。
 *
 * 原先是 CodePreviewDrawer 的私有函数；写计划确认卡也要展示 LLM 拟写入的
 * per-file diff，故提为独立组件供两处复用。
 *
 * 行着色：`diff --git`/`---`/`+++`/`index` 灰、`@@` 青、`+` 绿底、`-` 红底、其余默认。
 *
 * @param {string} diff      diff 文本
 * @param {number} maxHeight 可选高度上限 (默认不限, 由父容器滚动)
 */
export default function DiffViewer({ diff, maxHeight }) {
  const rows = useMemo(() => (diff || '').split('\n'), [diff])
  return (
    <div
      style={{
        overflow: 'auto',
        maxHeight: maxHeight || undefined,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.6,
        padding: '8px 0',
        background: '#0d0d0d',
        border: '1px solid #262626',
        borderRadius: 6,
      }}
    >
      {rows.map((l, i) => {
        let color = '#bbb'
        let bg = 'transparent'
        if (/^diff --git|^index |^--- |^\+\+\+ /.test(l)) {
          color = '#8a8a8a'
        } else if (/^@@ /.test(l)) {
          color = '#5ac8fa'
          bg = 'rgba(90,200,250,0.08)'
        } else if (l.startsWith('+')) {
          color = '#52c41a'
          bg = 'rgba(82,196,26,0.10)'
        } else if (l.startsWith('-')) {
          color = '#ff4d4f'
          bg = 'rgba(255,77,79,0.10)'
        } else if (l.startsWith('!!')) {
          color = '#faad14'
        }
        return (
          <div key={i} style={{ display: 'flex', background: bg }}>
            <span style={{ width: 28, flexShrink: 0, textAlign: 'right', paddingRight: 8, color: '#555', userSelect: 'none' }}>
              {l.startsWith('+') ? '+' : l.startsWith('-') ? '-' : ' '}
            </span>
            <span style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1, paddingRight: 12 }}>
              {l || ' '}
            </span>
          </div>
        )
      })}
    </div>
  )
}
