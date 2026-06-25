import React, { useEffect, useState } from 'react'
import { Tag, Tooltip, Spin } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, WarningFilled, LoadingOutlined } from '@ant-design/icons'
import api from '../auth'

/**
 * S5: 语义校验徽章 —— 后端
 * {@code POST /api/semantic-validate} 的前端薄包装。
 *
 * <p>在 {@code FixSummaryCard} 内每个 patch 旁边渲染：</p>
 * <ul>
 *   <li>✓ ok —— 代码语义正确（imports / 类名 都对得上）</li>
 *   <li>✗ N errors —— 有 N 处错（hover 看列表）</li>
 *   <li>⚠ N warnings —— 有 N 处告警（hover 看列表）</li>
 *   <li>⏳ validating —— 后端在跑</li>
 * </ul>
 *
 * <p>后端不可用 / workspaceId 缺失时静默降级 —— 不渲染徽章。</p>
 */
export default function SemanticValidationBadge({ workspaceId, filePath, code }) {
  const [state, setState] = useState({ status: 'idle', report: null, error: null })

  useEffect(() => {
    if (!workspaceId || !filePath || !code) return
    let cancelled = false
    setState({ status: 'loading', report: null, error: null })
    // baseURL 已是 /api，path 直接给 semantic-validate——不能再加 /api/ 前缀
    api.post('/semantic-validate', { workspaceId, filePath, code })
      .then(r => {
        if (cancelled) return
        const body = r && r.data ? r.data : {}
        if (body && body.error) {
          setState({ status: 'unavailable', report: null, error: body.error })
        } else {
          setState({ status: 'done', report: body, error: null })
        }
      })
      .catch(e => {
        if (cancelled) return
        setState({ status: 'unavailable', report: null, error: e && e.message })
      })
    return () => { cancelled = true }
  }, [workspaceId, filePath, code])

  if (state.status === 'idle' || state.status === 'unavailable') return null
  if (state.status === 'loading') {
    return <Tag icon={<LoadingOutlined spin />} color="processing">校验中</Tag>
  }
  const r = state.report || {}
  if (r.ok) {
    return (
      <Tooltip title={r.summary || '语义校验通过'}>
        <Tag icon={<CheckCircleFilled />} color="success">语义 ✓</Tag>
      </Tooltip>
    )
  }
  const errCount = Number(r.errorCount || (Array.isArray(r.errors) ? r.errors.length : 0))
  const warnCount = Number(r.warningCount || (Array.isArray(r.warnings) ? r.warnings.length : 0))
  return (
    <Tooltip title={
      <div>
        {Array.isArray(r.errors) && r.errors.slice(0, 5).map((e, i) => (
          <div key={i} style={{ color: '#ffccc7' }}>✗ {String(e)}</div>
        ))}
        {Array.isArray(r.warnings) && r.warnings.slice(0, 5).map((w, i) => (
          <div key={i} style={{ color: '#ffe58f' }}>⚠ {String(w)}</div>
        ))}
        {(errCount + warnCount) > 5 && <div>... 共 {errCount + warnCount} 条</div>}
      </div>
    }>
      <Tag icon={<CloseCircleFilled />} color={errCount > 0 ? 'error' : 'warning'}>
        语义 {errCount > 0 ? `✗${errCount}` : `⚠${warnCount}`}
      </Tag>
    </Tooltip>
  )
}
