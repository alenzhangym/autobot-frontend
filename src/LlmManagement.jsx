/**
 * 2026-07-22: LLM 模型管理页面 (仅超管可见).
 *
 * 功能:
 *   1. 展示当前 LLM 配置状态 (默认模型 / 运行时覆盖 / 实际生效模型 / 端点 URL)
 *   2. 列出 omlx 服务上已加载的模型列表 (调 GET /api/admin/llm/models)
 *   3. superadmin 可选择某个模型作为运行时覆盖 (热切换, 立即生效, 无需重启)
 *   4. 可清除覆盖回到 .env 配置
 *
 * 数据来源:
 *   - GET    /api/admin/llm/status         — 当前配置状态
 *   - GET    /api/admin/llm/models         — omlx 模型列表
 *   - POST   /api/admin/llm/model-override — 设置覆盖
 *   - DELETE /api/admin/llm/model-override — 清除覆盖
 *
 * 权限: 仅 SUPER_ADMIN 可访问 (后端校验, 前端菜单也只对超管可见)
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Card, Row, Col, Statistic, Spin, Empty, Tag, Button, message, Input, Tooltip, Alert, Divider, Select, InputNumber } from 'antd'
import {
  ReloadOutlined, CheckCircleOutlined, ThunderboltOutlined,
  ApiOutlined, ArrowRightOutlined, UndoOutlined, ExclamationCircleOutlined,
  ExperimentOutlined, SettingOutlined,
} from '@ant-design/icons'
import api from './auth'

const { Content } = Layout

// 铜色主题 (与项目其他 admin 页面一致)
const COPPER = '#d4a574'
const COPPER_DIM = 'rgba(212,165,116,0.3)'
const COPPER_GLOW = 'rgba(212,165,116,0.08)'

// 思考强度档位 (粗粒度): 档位 → thinking budget token。
// 与后端 ReasoningLevel 的 thinkingBudget() 映射一致 (NONE=0/LOW=2048/MEDIUM=8192/HIGH=32768)。
const THINKING_LEVELS = [
  { value: 'NONE', label: '不推理', budget: 0 },
  { value: 'LOW', label: '低', budget: 2048 },
  { value: 'MEDIUM', label: '中', budget: 8192 },
  { value: 'HIGH', label: '强', budget: 32768 },
]

export default function LlmManagement() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)       // { default_model, runtime_override, current_model, api_url }
  const [models, setModels] = useState([])         // ["model-id-1", "model-id-2", ...]
  const [omlxBaseUrl, setOmlxBaseUrl] = useState('')
  const [modelsError, setModelsError] = useState('')
  const [selectedModel, setSelectedModel] = useState('')  // 用户在输入框/列表里选中的模型
  const [customModel, setCustomModel] = useState('')      // 自定义输入的模型名
  const [applying, setApplying] = useState(false)

  // 全局会话配置 (上下文 + 思考强度)
  const [reasoning, setReasoning] = useState(null)                 // { global, agents, levels, default_max_tokens, model_context }
  const [reasoningLoading, setReasoningLoading] = useState(false)
  const [savingLevel, setSavingLevel] = useState(false)
  const [savingKey, setSavingKey] = useState(null)                 // 正在保存的行 ('GLOBAL')
  const [globalDraft, setGlobalDraft] = useState({ level: null, maxTokens: null })

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get('/admin/llm/status')
      setStatus(res.data)
    } catch (err) {
      const code = err.response?.status
      if (code === 403) {
        message.error('仅超级管理员可访问此页面')
      } else if (code === 401) {
        message.error('未登录, 请重新登录')
      } else {
        message.error('获取 LLM 状态失败: ' + (err.response?.data?.error || err.message))
      }
    }
  }, [])

  const fetchModels = useCallback(async () => {
    setLoading(true)
    setModelsError('')
    try {
      const res = await api.get('/admin/llm/models')
      setModels(res.data?.models || [])
      setOmlxBaseUrl(res.data?.omlx_base_url || '')
      if (res.data?.error) {
        setModelsError(res.data.error)
      }
    } catch (err) {
      setModelsError('获取模型列表失败: ' + (err.response?.data?.error || err.message))
      setModels([])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchReasoning = useCallback(async () => {
    setReasoningLoading(true)
    try {
      const res = await api.get('/admin/llm/reasoning-configs')
      setReasoning(res.data)
      const g = res.data?.global || {}
      setGlobalDraft({
        level: g.level || null,
        maxTokens: g.max_tokens ?? res.data?.default_max_tokens ?? null,
      })
    } catch (err) {
      message.error('获取推理强度配置失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setReasoningLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchModels()
    fetchReasoning()
  }, [fetchStatus, fetchModels, fetchReasoning])

  const applyReasoning = async (cfg) => {
    setSavingLevel(true)
    setSavingKey('GLOBAL')
    try {
      const body = { agent: null }
      if (cfg.level) body.level = cfg.level
      if (cfg.maxTokens && cfg.maxTokens > 0) body.maxTokens = cfg.maxTokens
      if (cfg.thinkingBudget !== null && cfg.thinkingBudget !== undefined) body.thinkingBudget = cfg.thinkingBudget
      await api.post('/admin/llm/reasoning-config', body)
      message.success('已保存 — 持久化, 立即生效')
      await fetchReasoning()
    } catch (err) {
      message.error('保存失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingLevel(false)
      setSavingKey(null)
    }
  }

  const saveGlobal = () => {
    const cfg = { level: globalDraft.level, maxTokens: globalDraft.maxTokens }
    // 显式带上档位对应的 thinking budget, 让档位映射权威
    // (否则历史遗留的全局 budget 会盖过档位默认值)
    const lv = THINKING_LEVELS.find(t => t.value === globalDraft.level)
    if (lv && lv.budget > 0) cfg.thinkingBudget = lv.budget
    applyReasoning(cfg)
  }

  const handleApply = async (modelName) => {
    if (!modelName || !modelName.trim()) {
      message.warning('请先选择或输入模型名')
      return
    }
    setApplying(true)
    try {
      await api.post('/admin/llm/model-override', { model: modelName.trim() })
      message.success(`已切换主模型为: ${modelName.trim()} (热生效, 后续所有 LLM 调用使用此模型)`)
      await fetchStatus()
    } catch (err) {
      message.error('切换模型失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setApplying(false)
    }
  }

  const handleClear = async () => {
    setApplying(true)
    try {
      await api.delete('/admin/llm/model-override')
      message.success('已清除运行时覆盖, 回到 .env 默认模型')
      await fetchStatus()
    } catch (err) {
      message.error('清除覆盖失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setApplying(false)
    }
  }

  const hasOverride = !!status?.runtime_override
  const currentModel = status?.current_model || '—'

  return (
    <Content style={{ background: '#0d0d0d', padding: '24px 28px', overflow: 'auto', minHeight: '100%' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* 标题 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <ApiOutlined style={{ fontSize: 22, color: COPPER }} />
            <span style={{ fontSize: 22, fontWeight: 500, color: '#e8e3d8', fontFamily: "'Fraunces', serif", letterSpacing: '-0.01em' }}>
              LLM 模型管理
            </span>
            <Tag color="gold" style={{ fontSize: 11, marginInlineEnd: 0, borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>
              SUPER ADMIN
            </Tag>
          </div>
          <div style={{ fontSize: 12.5, color: '#807a6e', fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
            列出 omlx 服务上已加载的模型, superadmin 可热切换主模型用于测试 (无需重启后端, 重启后回到 .env 配置)
          </div>
        </div>

        {/* 当前状态卡片 */}
        <Card
          loading={!status}
          style={{ background: '#1a1a1a', borderColor: '#333', marginBottom: 20 }}
          headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircleOutlined style={{ color: COPPER }} />
              <span>当前配置状态</span>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchStatus}
                style={{ color: '#888', marginLeft: 8 }} />
            </div>
          }
          extra={hasOverride && (
            <Button danger size="small" icon={<UndoOutlined />} onClick={handleClear} loading={applying}
              style={{ borderColor: '#c97a6b', color: '#c97a6b' }}>
              清除覆盖
            </Button>
          )}
        >
          <Row gutter={[24, 16]}>
            <Col xs={24} sm={12}>
              <Statistic
                title={<span style={{ color: '#807a6e', fontSize: 12 }}>默认模型 (.env)</span>}
                value={status?.default_model || '—'}
                valueStyle={{ color: '#a8a298', fontSize: 15, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}
              />
            </Col>
            <Col xs={24} sm={12}>
              <Statistic
                title={<span style={{ color: '#807a6e', fontSize: 12 }}>运行时覆盖</span>}
                value={status?.runtime_override || '未设置'}
                valueStyle={{
                  color: hasOverride ? COPPER : '#5a554d',
                  fontSize: 15,
                  fontFamily: "'JetBrains Mono', monospace",
                  wordBreak: 'break-all',
                }}
                prefix={hasOverride ? <ThunderboltOutlined /> : null}
              />
            </Col>
            <Col xs={24} sm={12}>
              <Statistic
                title={<span style={{ color: '#807a6e', fontSize: 12 }}>实际生效模型</span>}
                value={currentModel}
                valueStyle={{
                  color: hasOverride ? COPPER : '#16a34a',
                  fontSize: 16,
                  fontWeight: 500,
                  fontFamily: "'JetBrains Mono', monospace",
                  wordBreak: 'break-all',
                }}
                prefix={hasOverride ? <ArrowRightOutlined style={{ color: COPPER }} /> : <CheckCircleOutlined style={{ color: '#16a34a' }} />}
              />
            </Col>
            <Col xs={24} sm={12}>
              <Statistic
                title={<span style={{ color: '#807a6e', fontSize: 12 }}>端点 URL</span>}
                value={status?.api_url || '—'}
                valueStyle={{ color: '#a8a298', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all' }}
              />
            </Col>
          </Row>

          {hasOverride && (
            <Alert
              type="warning"
              showIcon
              icon={<ThunderboltOutlined />}
              style={{ marginTop: 16, background: COPPER_GLOW, borderColor: COPPER_DIM }}
              message={
                <span style={{ color: '#e8e3d8', fontSize: 12.5 }}>
                  运行时覆盖已生效 — 后续所有 LLM 调用 (学术分析 / 小说生成 / ERP ReAct / 编程助手) 都将使用
                  <code style={{ color: COPPER, margin: '0 4px', fontFamily: "'JetBrains Mono', monospace" }}>{status.runtime_override}</code>
                  替代默认模型. ERP/CRM LoRA 专用模型不受影响.
                </span>
              }
              description={
                <span style={{ color: '#807a6e', fontSize: 11.5 }}>
                  特性: 热切换 (无需重启) · 易失 (重启后端回到 .env) · 仅影响主路径 · 用于临时测试
                </span>
              }
            />
          )}
        </Card>

        {/* omlx 模型列表 */}
        <Card
          style={{ background: '#1a1a1a', borderColor: '#333' }}
          headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined style={{ color: COPPER }} />
              <span>omlx 已加载模型</span>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchModels} loading={loading}
                style={{ color: '#888', marginLeft: 8 }} />
            </div>
          }
          extra={omlxBaseUrl && (
            <Tooltip title="omlx 服务地址 (从 llm.api.url 派生)">
              <Tag style={{ fontSize: 11, borderColor: '#333', color: '#807a6e', background: '#0d0d0d', fontFamily: "'JetBrains Mono', monospace" }}>
                {omlxBaseUrl}
              </Tag>
            </Tooltip>
          )}
        >
          {modelsError && (
            <Alert
              type="error"
              showIcon
              icon={<ExclamationCircleOutlined />}
              style={{ marginBottom: 16, background: 'rgba(201,122,107,0.08)', borderColor: '#c97a6b' }}
              message={<span style={{ color: '#c97a6b', fontSize: 12.5 }}>{modelsError}</span>}
              description={
                <span style={{ color: '#807a6e', fontSize: 11.5 }}>
                  请确认 omlx 服务正在运行, 且 llm.api.url 配置正确. 也可在下方手动输入模型名切换.
                </span>
              }
            />
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin tip="正在从 omlx 获取模型列表..." />
            </div>
          ) : models.length === 0 && !modelsError ? (
            <Empty description={<span style={{ color: '#807a6e', fontSize: 12 }}>omlx 上无可用模型</span>} />
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#807a6e', marginBottom: 10, fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
                共 {models.length} 个模型 — 点击某行可选中, 再点底部"切换到此模型"按钮应用 (热生效)
              </div>
              <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid #2a2620', borderRadius: 4 }}>
                {models.map((m, i) => {
                  const isCurrent = m === currentModel
                  const isSelected = m === selectedModel
                  const isDefault = m === status?.default_model
                  return (
                    <div
                      key={m}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedModel(m)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedModel(m) } }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', cursor: 'pointer',
                        borderBottom: i < models.length - 1 ? '1px solid #2a2620' : 'none',
                        background: isSelected ? COPPER_GLOW : 'transparent',
                        transition: 'background 0.15s',
                        outline: 'none',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#1f1f1c' }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                    >
                      <ApiOutlined style={{ color: isSelected ? COPPER : '#5a554d', fontSize: 13 }} />
                      <span style={{
                        flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5,
                        color: isCurrent ? COPPER : '#a8a298', wordBreak: 'break-all',
                      }}>
                        {m}
                      </span>
                      {isCurrent && (
                        <Tag color="gold" style={{ fontSize: 10, marginInlineEnd: 0, borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>
                          当前生效
                        </Tag>
                      )}
                      {!isCurrent && isDefault && (
                        <Tag style={{ fontSize: 10, marginInlineEnd: 0, borderColor: '#2a2620', color: '#807a6e', background: '#0d0d0d' }}>
                          默认
                        </Tag>
                      )}
                      {isSelected && !isCurrent && (
                        <Tag color="blue" style={{ fontSize: 10, marginInlineEnd: 0 }}>已选中</Tag>
                      )}
                    </div>
                  )
                })}
              </div>

              {selectedModel && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#807a6e' }}>
                    选中: <code style={{ color: COPPER, fontFamily: "'JetBrains Mono', monospace" }}>{selectedModel}</code>
                  </span>
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={applying}
                    disabled={selectedModel === currentModel}
                    onClick={() => handleApply(selectedModel)}
                    style={{
                      background: selectedModel === currentModel ? '#333' : COPPER,
                      borderColor: selectedModel === currentModel ? '#333' : COPPER,
                      color: '#0a0a0a', fontWeight: 500,
                    }}
                  >
                    {selectedModel === currentModel ? '已是当前模型' : '切换到此模型'}
                  </Button>
                </div>
              )}
            </>
          )}

          <Divider style={{ borderColor: '#2a2620', margin: '16px 0' }} />

          {/* 自定义模型名输入 */}
          <div style={{ fontSize: 12, color: '#807a6e', marginBottom: 8, fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
            手动输入模型名 (适用于 omlx 列表获取失败, 或要切换到未列出的模型):
          </div>
          <Input.Search
            enterButton={
              <Button type="primary" icon={<ThunderboltOutlined />} loading={applying}
                style={{ background: COPPER, borderColor: COPPER, color: '#0a0a0a', fontWeight: 500 }}>
                切换
              </Button>
            }
            placeholder="例如: mlx-community--Qwen3.5-35B-A3B-8bit"
            value={customModel}
            onChange={e => setCustomModel(e.target.value)}
            onSearch={(v) => handleApply(v)}
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          />
        </Card>

        {/* 全局会话配置 (上下文 + 思考强度) */}
        <Card
          style={{ background: '#1a1a1a', borderColor: '#333', marginTop: 20 }}
          headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ExperimentOutlined style={{ color: COPPER }} />
              <span>全局会话配置</span>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchReasoning} loading={reasoningLoading}
                style={{ color: '#888', marginLeft: 8 }} />
            </div>
          }
          extra={<Tag style={{ fontSize: 11, borderColor: '#2a2620', color: '#807a6e', background: '#0d0d0d' }}>持久化 · 立即生效</Tag>}
        >
          <Alert
            type="warning"
            showIcon
            icon={<SettingOutlined />}
            style={{ marginBottom: 16, background: COPPER_GLOW, borderColor: COPPER_DIM }}
            message={
              <span style={{ color: '#e8e3d8', fontSize: 12.5 }}>
                只保留两个会话级旋钮：<b style={{ color: COPPER }}>上下文</b>（单次输出上限，不得超过模型窗口 {reasoning?.model_context?.toLocaleString() || '—'}）
                与 <b style={{ color: COPPER }}>思考强度</b>。<b style={{ color: COPPER }}>全局配置会覆盖 .env 的逐 agent 设置</b>，请谨慎调整。
              </span>
            }
          />

          <div style={{ padding: '12px 14px', border: '1px solid #2a2620', borderRadius: 4, background: '#141414' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#807a6e' }}>上下文</span>
                <InputNumber size="small" style={{ width: 150 }} min={1024}
                  max={reasoning?.model_context || 262144} step={1024}
                  value={globalDraft?.maxTokens ?? null}
                  placeholder="不修改"
                  onChange={(v) => setGlobalDraft(p => ({ ...p, maxTokens: v }))} />
                <span style={{ fontSize: 10.5, color: '#5a554d' }}>max_tokens</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#807a6e' }}>思考强度</span>
                <Select size="small" style={{ width: 170 }}
                  value={globalDraft?.level ?? null}
                  placeholder="不修改 (沿用 .env)"
                  allowClear
                  onChange={(v) => setGlobalDraft(p => ({ ...p, level: v || null }))}
                  options={THINKING_LEVELS.map(t => ({ value: t.value, label: t.budget > 0 ? `${t.label} (${t.budget} token)` : t.label }))} />
              </span>
              <Button size="small" type="primary" icon={<CheckCircleOutlined />}
                loading={savingLevel && savingKey === 'GLOBAL'}
                onClick={saveGlobal}
                style={{ background: COPPER, borderColor: COPPER, color: '#0a0a0a', fontWeight: 500 }}>
                应用
              </Button>
            </div>
            <div style={{ fontSize: 11, color: '#5a554d', marginTop: 8 }}>
              当前全局: 上下文 <b style={{ color: COPPER }}>{reasoning?.default_max_tokens ?? '—'}</b> · 思考强度 <b style={{ color: COPPER }}>{reasoning?.global?.level_label || '未设置(.env)'}</b> · 模型窗口 <b style={{ color: COPPER }}>{reasoning?.model_context?.toLocaleString() || '—'}</b>
            </div>
          </div>
        </Card>

        {/* 说明卡片 */}
        <Card style={{ background: '#1a1a1a', borderColor: '#333', marginTop: 20 }}
          headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
          title={<span style={{ fontSize: 13 }}>使用说明</span>}>
          <ul style={{ color: '#807a6e', fontSize: 12, lineHeight: 1.8, margin: 0, paddingLeft: 18 }}>
            <li><b style={{ color: '#a8a298' }}>热切换</b>: 选择模型后立即对后续所有 LLM 调用生效, 无需重启后端</li>
            <li><b style={{ color: '#a8a298' }}>易失性</b>: 重启后端后清除覆盖, 自动回到 .env 配置的 <code style={{ color: COPPER, fontFamily: "'JetBrains Mono', monospace" }}>llm.model.name</code></li>
            <li><b style={{ color: '#a8a298' }}>影响范围</b>: 仅影响主路径 (学术分析 / 小说生成 / 编程助手); ERP/CRM LoRA 专用模型不受影响</li>
            <li><b style={{ color: '#a8a298' }}>优先级</b>: 方法参数 override (D-1) &gt; 运行时覆盖 &gt; .env 配置</li>
            <li><b style={{ color: '#a8a298' }}>用途</b>: 临时切换小模型加速测试, 或对比不同模型生成质量</li>
            <li><b style={{ color: '#a8a298' }}>清除</b>: 点击顶部"清除覆盖"按钮, 回到 .env 默认模型</li>
            <li><b style={{ color: '#a8a298' }}>全局会话配置</b>: 上下文 / 思考强度是全局默认, 会覆盖 .env 的逐 agent 设置; 未单独配置的 agent 也一并生效, 调整请谨慎</li>
          </ul>
        </Card>
      </div>
    </Content>
  )
}
