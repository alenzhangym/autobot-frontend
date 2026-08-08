/**
 * 2026-08-08: 翻译核对功能页面 — 中文→英文字幕翻译核对。
 *
 * 工具型页面，不保存历史。左侧逐句配对输入（中文原文 + 英文机翻），
 * 右侧展示核对结果（修正译文 + 关键/非关键错误标注）。
 *
 * 设计语言：暗色铜色暖光，与学术研究/小说创作页面保持一致。
 *   - 关键错误：红色标注
 *   - 非关键优化项：琥珀色标注
 */
import React, { useState, useRef, useCallback } from 'react'
import { Input, Button, Spin, message, Tooltip, Empty } from 'antd'
import {
  PlusOutlined, DeleteOutlined, SearchOutlined,
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined,
} from '@ant-design/icons'
import api from './auth'

const { TextArea } = Input

let __rowSeq = 0
const newRow = () => ({ id: `row-${++__rowSeq}`, chinese: '', english: '' })

const ERROR_TYPE_LABEL = {
  grammar: '语法错误',
  semantic: '语意不符',
  format: '固定格式错误',
  fixed_expression: '未使用固定表达',
  polish: '非关键优化',
}

export default function TranslationCheckPage({ user }) {
  const [rows, setRows] = useState([newRow()])
  const [checking, setChecking] = useState(false)
  const [resultsById, setResultsById] = useState({})
  const [checkedRows, setCheckedRows] = useState([])
  const resultRef = useRef(null)

  const updateRow = (id, field, value) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const addRow = () => setRows(prev => [...prev, newRow()])

  const removeRow = (id) => {
    setRows(prev => {
      const next = prev.filter(r => r.id !== id)
      return next.length === 0 ? [newRow()] : next
    })
    setResultsById(prev => { const n = { ...prev }; delete n[id]; return n })
    setCheckedRows(prev => prev.filter(rid => rid !== id))
  }

  const handleVerify = useCallback(async () => {
    const valid = rows.filter(r => (r.chinese && r.chinese.trim()) || (r.english && r.english.trim()))
    if (valid.length === 0) {
      message.warning('请至少输入一行中文原文或英文机翻')
      return
    }
    setChecking(true)
    try {
      const res = await api.post('/translation-check/verify', { items: valid.map(r => ({ id: r.id, chinese: r.chinese, english: r.english })) })
      const result = res.data?.result || []
      const byId = {}
      result.forEach(item => { byId[item.id] = item })
      setResultsById(byId)
      setCheckedRows(valid.map(r => r.id))
      message.success(`核对完成，共 ${result.length} 条`)
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (e) {
      message.error(e?.response?.data?.error || '核对失败，请稍后重试')
    } finally {
      setChecking(false)
    }
  }, [rows])

  const criticalCount = checkedRows.filter(id => resultsById[id]?.has_critical).length
  const rowCount = rows.length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ab-bg)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--ab-line)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontFamily: 'var(--ab-font-mono)', color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase' }}>Translation Check</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'var(--ab-font-display)', color: 'var(--ab-text)', fontSize: 22, fontWeight: 500 }}>翻译核对</span>
            <span style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 11, color: 'var(--ab-text-4)' }}>{rowCount} 句</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button
              icon={<PlusOutlined />} onClick={addRow}
              style={{ borderRadius: 6, borderColor: 'var(--ab-line)', color: 'var(--ab-text-2)', background: 'var(--ab-bg-2)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--ab-copper)'; e.currentTarget.style.color = 'var(--ab-copper)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--ab-line)'; e.currentTarget.style.color = 'var(--ab-text-2)' }}
            >添加一行</Button>
            <Button
              type="primary" icon={<SearchOutlined />} loading={checking}
              onClick={handleVerify}
              style={{ borderRadius: 6, background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)', fontWeight: 600 }}
            >开始核对</Button>
          </div>
        </div>
      </div>

      {/* Body: left input / right result */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: original input */}
        <div style={{ flex: 1, overflow: 'auto', borderRight: '1px solid var(--ab-line)', padding: '16px 20px' }} className="custom-scrollbar">
          <div style={{ fontFamily: 'var(--ab-font-mono)', color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12 }}>
            需要核对原文
          </div>
          {rows.map((row, idx) => (
            <div key={row.id} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ width: 26, flexShrink: 0, paddingTop: 8, textAlign: 'center' }}>
                <span style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 12, color: 'var(--ab-copper)' }}>{idx + 1}</span>
              </div>
              <div style={{ flex: 1 }}>
                <TextArea
                  value={row.chinese}
                  onChange={e => updateRow(row.id, 'chinese', e.target.value)}
                  placeholder="中文原文（人工已修正，默认无误）"
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  style={{ background: 'var(--ab-bg-2)', border: '1px solid var(--ab-line)', color: 'var(--ab-text)', borderRadius: 6, marginBottom: 8 }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--ab-copper)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--ab-copper-glow)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--ab-line)'; e.currentTarget.style.boxShadow = 'none' }}
                />
                <TextArea
                  value={row.english}
                  onChange={e => updateRow(row.id, 'english', e.target.value)}
                  placeholder="英文机翻（需核对修正）"
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  style={{ background: 'var(--ab-bg-2)', border: '1px solid var(--ab-line)', color: 'var(--ab-text)', borderRadius: 6 }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--ab-copper)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--ab-copper-glow)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--ab-line)'; e.currentTarget.style.boxShadow = 'none' }}
                />
              </div>
              <Tooltip title="删除该行">
                <Button type="text" icon={<DeleteOutlined />} onClick={() => removeRow(row.id)} style={{ color: 'var(--ab-text-3)', alignSelf: 'flex-start', marginTop: 4 }} />
              </Tooltip>
            </div>
          ))}
        </div>

        {/* Right: result */}
        <div ref={resultRef} style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }} className="custom-scrollbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--ab-font-mono)', color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              对照结果
            </span>
            {checkedRows.length > 0 && (
              <span style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 11, color: criticalCount > 0 ? 'var(--ab-danger, #e5484d)' : 'var(--ab-text-4)' }}>
                {criticalCount > 0 ? `${criticalCount} 句含关键错误` : '无可识别的关键错误'}
              </span>
            )}
          </div>

          {checking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0', justifyContent: 'center', color: 'var(--ab-text-3)' }}>
              <Spin /> 正在逐句核对，请稍候…
            </div>
          )}

          {!checking && checkedRows.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 80 }}
              description={<span style={{ color: 'var(--ab-text-3)', fontFamily: 'var(--ab-font-body)' }}>在左侧输入中文原文与英文机翻，点击「开始核对」</span>}
            />
          )}

          {!checking && rows.map((row, idx) => {
            const res = resultsById[row.id]
            if (!res) return null
            const hasCn = row.chinese && row.chinese.trim()
            const hasEn = row.english && row.english.trim()
            const errors = res.errors || []
            const criticalErrors = errors.filter(e => e.severity === 'critical')
            const polishErrors = errors.filter(e => e.severity !== 'critical')
            return (
              <div key={row.id} style={{ background: 'var(--ab-surface-2, var(--ab-bg-2))', border: '1px solid var(--ab-line)', borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 12, color: 'var(--ab-copper)' }}>{idx + 1}</span>
                  {res.has_critical ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ab-danger, #e5484d)' }}>
                      <CloseCircleOutlined /> 需修正
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#3fb68b' }}>
                      <CheckCircleOutlined /> 通过
                    </span>
                  )}
                </div>

                {(hasCn || hasEn) && (
                  <div style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 11, color: 'var(--ab-text-3)', marginBottom: 6 }}>
                    <div style={{ marginBottom: 2 }}><span style={{ color: 'var(--ab-copper)' }}>CN</span>&nbsp; {hasCn ? row.chinese : '（空）'}</div>
                    <div><span style={{ color: 'var(--ab-text-4)' }}>MT</span>&nbsp; {hasEn ? row.english : '（空）'}</div>
                  </div>
                )}

                <div style={{ fontFamily: 'var(--ab-font-body)', color: 'var(--ab-text)', fontSize: 14, lineHeight: 1.6, marginBottom: 10 }}>
                  {res.corrected_english || ''}
                </div>

                {errors.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {criticalErrors.map((er, i) => (
                      <div key={`c-${i}`} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--ab-danger, #e5484d)', background: 'rgba(229,72,77,0.08)', borderLeft: '3px solid var(--ab-danger, #e5484d)', padding: '6px 10px', borderRadius: 4 }}>
                        <WarningOutlined style={{ marginTop: 2 }} />
                        <div>
                          <span style={{ fontWeight: 600, marginRight: 6 }}>[{ERROR_TYPE_LABEL[er.type] || er.type}]</span>
                          {er.message}
                        </div>
                      </div>
                    ))}
                    {polishErrors.map((er, i) => (
                      <div key={`p-${i}`} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#c9a13b', background: 'rgba(201,161,59,0.08)', borderLeft: '3px solid #c9a13b', padding: '6px 10px', borderRadius: 4 }}>
                        <WarningOutlined style={{ marginTop: 2 }} />
                        <div>
                          <span style={{ fontWeight: 600, marginRight: 6 }}>[{ERROR_TYPE_LABEL[er.type] || '优化建议'}]</span>
                          {er.message}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}