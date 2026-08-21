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
import { Layout, Card, Row, Col, Statistic, Spin, Empty, Tag, Button, message, Input, Tooltip, Alert, Divider, Select, Space, Popconfirm, Slider, InputNumber, Switch } from 'antd'
import {
  ReloadOutlined, CheckCircleOutlined, ThunderboltOutlined,
  ApiOutlined, ArrowRightOutlined, UndoOutlined, ExclamationCircleOutlined,
  ExperimentOutlined, DeleteOutlined, SettingOutlined, PlusOutlined, KeyOutlined,
} from '@ant-design/icons'
import api from './auth'

const { Content } = Layout

// 铜色主题 (与项目其他 admin 页面一致)
const COPPER = '#d4a574'
const COPPER_DIM = 'rgba(212,165,116,0.3)'
const COPPER_GLOW = 'rgba(212,165,116,0.08)'

export default function LlmManagement() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)       // { default_model, runtime_override, current_model, api_url }
  const [models, setModels] = useState([])         // ["model-id-1", "model-id-2", ...]
  const [omlxBaseUrl, setOmlxBaseUrl] = useState('')
  const [modelsError, setModelsError] = useState('')
  const [selectedModel, setSelectedModel] = useState('')  // 用户在输入框/列表里选中的模型
  const [customModel, setCustomModel] = useState('')      // 自定义输入的模型名
  const [applying, setApplying] = useState(false)

  // 推理强度等级配置
  const [reasoning, setReasoning] = useState(null)                 // { global, agents, levels, default_max_tokens, model_context }
  const [reasoningLoading, setReasoningLoading] = useState(false)
  const [savingLevel, setSavingLevel] = useState(false)
  const [savingKey, setSavingKey] = useState(null)                 // 正在保存的行 (agent 或 'GLOBAL')
  const [draft, setDraft] = useState({})                           // agent -> { level, maxTokens, thinkingBudget }
  const [globalDraft, setGlobalDraft] = useState({ level: null, maxTokens: null, thinkingBudget: null })

  // 2026-08-21: 功能模块级端点配置
  const [modules, setModules] = useState([])                       // [{ module_key, display_name, agent_patterns, ... }]
  const [knownModules, setKnownModules] = useState([])             // [{ moduleKey, name, agentPattern }]
  const [moduleGlobal, setModuleGlobal] = useState({ url: '', model: '' })
  const [modulesLoading, setModulesLoading] = useState(false)
  const [moduleDrafts, setModuleDrafts] = useState({})             // module_key -> { display_name, agent_patterns, endpoint_url, model_name, api_key, maxTokens, temperature, enabled }
  const [savingModule, setSavingModule] = useState(false)
  const [savingModuleKey, setSavingModuleKey] = useState(null)
  const [showNewModule, setShowNewModule] = useState(false)

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
      // 为全部 agent 初始化草稿值（实际生效值），供滑动条/下拉直接编辑
      const initDrafts = {}
      for (const a of (res.data?.agents || [])) {
        initDrafts[a.agent] = {
          level: a.level || 'MEDIUM',
          maxTokens: a.max_tokens ?? res.data?.default_max_tokens,
          thinkingBudget: a.thinking_enabled ? (a.thinking_budget || 2048) : a.thinking_budget || 0,
        }
      }
      setDraft(initDrafts)
      const g = res.data?.global || {}
      setGlobalDraft({
        level: g.level || null,
        maxTokens: g.max_tokens ?? res.data?.default_max_tokens,
        thinkingBudget: g.thinking_budget ?? null,
      })
    } catch (err) {
      message.error('获取推理强度配置失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setReasoningLoading(false)
    }
  }, [])

  const fetchModules = useCallback(async () => {
    setModulesLoading(true)
    try {
      const res = await api.get('/admin/llm/module-configs')
      setModules(res.data?.modules || [])
      setKnownModules(res.data?.known || [])
      setModuleGlobal(res.data?.global || { url: '', model: '' })
      // 为全部模块初始化草稿值（实际生效值）
      const initDrafts = {}
      for (const m of (res.data?.modules || [])) {
        initDrafts[m.module_key] = {
          display_name: m.display_name || '',
          agent_patterns: m.agent_patterns || '',
          endpoint_url: m.endpoint_url || '',
          model_name: m.model_name || '',
          api_key: m.has_api_key ? '******' : (m.api_key || ''),
          maxTokens: m.max_tokens ?? null,
          temperature: m.temperature ?? null,
          enabled: m.enabled !== false,
        }
      }
      setModuleDrafts(initDrafts)
    } catch (err) {
      message.error('获取模块配置失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setModulesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchModels()
    fetchReasoning()
    fetchModules()
  }, [fetchStatus, fetchModels, fetchReasoning, fetchModules])

  const applyReasoning = async (agent, cfg) => {
  setSavingLevel(true)
  setSavingKey(agent || 'GLOBAL')
  try {
    const body = { agent: agent || null }
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

  const saveAgent = (agent) => {
    const d = draft[agent]
    if (!d) return
    applyReasoning(agent, d)
  }

  const saveGlobal = () => applyReasoning('', globalDraft)

  const deleteReasoningAgent = async (agent) => {
    try {
      await api.delete(`/admin/llm/reasoning-config/${encodeURIComponent(agent)}`)
      message.success(`已删除 ${agent} 的覆盖, 回退到全局默认`)
      await fetchReasoning()
    } catch (err) {
      message.error('删除失败: ' + (err.response?.data?.error || err.message))
    }
  }

  const saveModule = async (mkey, draft) => {
    if (!mkey) return
    setSavingModule(true)
    setSavingModuleKey(mkey)
    try {
      const body = {
        module_key: mkey,
        display_name: draft.display_name,
        agent_patterns: draft.agent_patterns,
        endpoint_url: draft.endpoint_url,
        model_name: draft.model_name,
        maxTokens: draft.maxTokens,
        temperature: draft.temperature,
        enabled: draft.enabled !== false,
      }
      // api_key: 仅当用户输入了真实值时提交；'******' 占位表示保留原值则不传
      if (draft.api_key && draft.api_key !== '******') body.api_key = draft.api_key
      await api.post('/admin/llm/module-config', body)
      message.success(`模块 ${draft.display_name || mkey} 保存成功 (持久化, 立即生效)`)
      await fetchModules()
    } catch (err) {
      message.error('保存失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingModule(false)
      setSavingModuleKey(null)
    }
  }

  const applyModule = (mkey) => {
    const d = moduleDrafts[mkey]
    if (!d) return
    saveModule(mkey, d)
  }

  const createEmptyModule = (m) => {
    const mkey = m.moduleKey
    setModuleDrafts(prev => ({
      ...prev,
      [mkey]: {
        display_name: m.name || '',
        agent_patterns: m.agentPattern || '',
        endpoint_url: '',
        model_name: '',
        api_key: '',
        maxTokens: null,
        temperature: null,
        enabled: true,
      },
    }))
    setShowNewModule(false)
  }

  const deleteModule = async (mkey) => {
    try {
      await api.delete(`/admin/llm/module-config/${encodeURIComponent(mkey)}`)
      message.success(`已删除模块 ${mkey} 配置, 回退到全局配置`)
      await fetchModules()
    } catch (err) {
      message.error('删除失败: ' + (err.response?.data?.error || err.message))
    }
  }

  // 模块模型下拉候选: 以 omlx 已加载模型列表为主; 若当前已保存的模型不在列表中则追加一项, 保证可回显/可选择
  const modelOptionsForModule = (currentName) => {
    const opts = (models || []).map(m => ({ value: m, label: m }))
    if (currentName && !opts.some(o => o.value === currentName)) {
      opts.push({ value: currentName, label: currentName + ' (不在 omlx 列表)' })
    }
    return opts
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

        {/* 推理强度等级配置 */}
        <Card
          style={{ background: '#1a1a1a', borderColor: '#333', marginTop: 20 }}
          headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ExperimentOutlined style={{ color: COPPER }} />
              <span>推理强度等级 (Agent 级)</span>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchReasoning} loading={reasoningLoading}
                style={{ color: '#888', marginLeft: 8 }} />
            </div>
          }
          extra={<Tag style={{ fontSize: 11, borderColor: '#2a2620', color: '#807a6e', background: '#0d0d0d' }}>持久化 · 立即生效</Tag>}
        >
          <Alert
            type="info"
            showIcon
            icon={<SettingOutlined />}
            style={{ marginBottom: 16, background: COPPER_GLOW, borderColor: COPPER_DIM }}
            message={
              <span style={{ color: '#e8e3d8', fontSize: 12.5 }}>
                以下为<b style={{ color: COPPER }}>全部 agent</b>清单，可单独调节每个 agent 的<b style={{ color: COPPER }}>推理档位 / 思考token预算 / 最大输出token</b>。
                模型上下文上限 {reasoning?.model_context?.toLocaleString() || '—'}，max_tokens 不得超过此值。
              </span>
            }
            description={
              <span style={{ color: '#807a6e', fontSize: 11.5 }}>
                思考token: <b style={{ color: COPPER }}>0 = 不推理(关闭 thinking)</b>；每行滑动条调节，点「应用」即时入库生效。全局 max_tokens 在下方顶部配置，未单独设置的 agent 沿用全局值。
              </span>
            }
          />

          {/* 全局默认配置：推理档位 + 思考token + max_tokens（可编辑） */}
          <div style={{ marginBottom: 16, padding: '12px 14px', border: '1px solid #2a2620', borderRadius: 4, background: '#141414' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <span style={{ fontSize: 12.5, color: '#a8a298', fontWeight: 500, width: 120 }}>全局默认</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#807a6e' }}>档位</span>
                <Select
                  size="small" style={{ width: 130 }}
                  value={globalDraft?.level || null}
                  placeholder="不修改"
                  allowClear
                  onChange={(v) => setGlobalDraft(p => ({ ...p, level: v || null }))}
                  options={(reasoning?.levels || []).map(l => ({ value: l, label: l }))}
                />
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#807a6e' }}>思考token</span>
                <InputNumber size="small" style={{ width: 110 }} min={0} step={512}
                  value={globalDraft?.thinkingBudget ?? null}
                  placeholder="不修改"
                  onChange={(v) => setGlobalDraft(p => ({ ...p, thinkingBudget: v }))} />
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#807a6e' }}>max_tokens</span>
                <InputNumber size="small" style={{ width: 130 }} min={1024}
                  max={reasoning?.model_context || 131072} step={1024}
                  value={globalDraft?.maxTokens ?? null}
                  onChange={(v) => setGlobalDraft(p => ({ ...p, maxTokens: v }))} />
              </span>
              <Button size="small" type="primary" icon={<CheckCircleOutlined />}
                loading={savingLevel && savingKey === 'GLOBAL'}
                onClick={saveGlobal}
                style={{ background: COPPER, borderColor: COPPER, color: '#0a0a0a', fontWeight: 500 }}>
                应用全局
              </Button>
            </div>
            <div style={{ fontSize: 11, color: '#5a554d', marginTop: 6 }}>
              当前全局: 档位 {reasoning?.global?.level_label || '未设置(.env)'} · 思考token <b style={{ color: COPPER }}>{globalDraft?.thinkingBudget ?? reasoning?.global?.thinking_budget ?? 0}</b> · max_tokens <b style={{ color: COPPER }}>{globalDraft?.maxTokens ?? reasoning?.default_max_tokens}</b>
            </div>
          </div>

          {/* 全部 agent 列表 */}
          {reasoningLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
          ) : (reasoning?.agents || []).length === 0 ? (
            <Empty description={<span style={{ color: '#807a6e', fontSize: 12 }}>暂无 agent 清单</span>} />
          ) : (
            <div style={{ maxHeight: 480, overflow: 'auto', border: '1px solid #2a2620', borderRadius: 4 }}>
              {(reasoning?.agents || []).map(a => {
                const d = draft[a.agent] || {}
                const maxCap = reasoning?.model_context || 131072
                return (
                  <div key={a.agent}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid #2a2620', flexWrap: 'wrap' }}>
                    <div style={{ width: 270, flexShrink: 0 }}>
                      <ExperimentOutlined style={{ color: '#5a554d', fontSize: 13, marginRight: 6 }} />
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#a8a298', wordBreak: 'break-all' }}>
                        {a.agent}
                      </span>
                      {a.configured && <Tag color="gold" style={{ fontSize: 10, marginLeft: 6, borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>已配置</Tag>}
                      {a.desc && <div style={{ fontSize: 10.5, color: '#5a554d', marginTop: 2 }}>{a.desc}</div>}
                    </div>

                    {/* 档位 */}
                    <Space size={4}>
                      <span style={{ fontSize: 10.5, color: '#807a6e', width: 26 }}>档位</span>
                      <Select size="small" style={{ width: 96 }}
                        value={d.level || 'MEDIUM'}
                        onChange={(v) => setDraft(p => ({ ...p, [a.agent]: { ...p[a.agent], level: v } }))}
                        options={(reasoning?.levels || []).map(l => ({ value: l, label: l }))} />
                    </Space>

                    {/* 思考token 滑动条 */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>思考token: <b style={{ color: d.thinkingBudget ? COPPER : '#555', marginLeft: 4 }}>{d.thinkingBudget || 0}{d.thinkingBudget ? '' : ' (不推理)'}</b></div>
                      <Slider
                        min={0} max={Math.max(16384, Math.min(65536, d.maxTokens || 32768))} step={256}
                        value={d.thinkingBudget ?? 0}
                        onChange={(v) => setDraft(p => ({ ...p, [a.agent]: { ...p[a.agent], thinkingBudget: v } }))}
                        tooltip={{ open: false }}
                        trackStyle={{ backgroundColor: d.thinkingBudget ? COPPER : '#333' }}
                        railStyle={{ backgroundColor: '#2a2620' }}
                        handleStyle={{ borderColor: COPPER, backgroundColor: d.thinkingBudget ? COPPER : '#444' }}
                      />
                    </div>

                    {/* max_tokens 滑动条 (受模型上下文约束) */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>max_tokens: <b style={{ color: COPPER, marginLeft: 4 }}>{d.maxTokens ?? maxCap}</b></div>
                      <Slider
                        min={1024} max={maxCap} step={1024}
                        value={Math.min(d.maxTokens || 8192, maxCap)}
                        onChange={(v) => setDraft(p => ({ ...p, [a.agent]: { ...p[a.agent], maxTokens: v } }))}
                        tooltip={{ open: false }}
                        trackStyle={{ backgroundColor: COPPER }}
                        railStyle={{ backgroundColor: '#2a2620' }}
                        handleStyle={{ borderColor: COPPER, backgroundColor: COPPER }}
                      />
                    </div>

                    <Button size="small" type="primary"
                      loading={savingLevel && savingKey === a.agent}
                      onClick={() => saveAgent(a.agent)}
                      style={{ background: '#333', borderColor: '#444', color: '#e8e3d8', fontWeight: 500 }}>
                      应用
                    </Button>
                    {a.configured && (
                      <Popconfirm title={`删除 ${a.agent} 的覆盖?`} onConfirm={() => deleteReasoningAgent(a.agent)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ borderColor: 'transparent' }} />
                      </Popconfirm>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* 功能模块级端点配置 */}
        <Card
          style={{ background: '#1a1a1a', borderColor: '#333', marginTop: 20 }}
          headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined style={{ color: COPPER }} />
              <span>功能模块 LLM 端点 (按模块)</span>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchModules} loading={modulesLoading}
                style={{ color: '#888', marginLeft: 8 }} />
            </div>
          }
          extra={<Tag style={{ fontSize: 11, borderColor: '#2a2620', color: '#807a6e', background: '#0d0d0d' }}>持久化 · 立即生效</Tag>}
        >
          <Alert
            type="info"
            showIcon
            icon={<SettingOutlined />}
            style={{ marginBottom: 16, background: COPPER_GLOW, borderColor: COPPER_DIM }}
            message={
              <span style={{ color: '#e8e3d8', fontSize: 12.5 }}>
                为不同<b style={{ color: COPPER }}>功能模块</b>绑定独立的 LLM <b style={{ color: COPPER }}>端点 URL + 模型</b>，
                让轻量任务（如股票分析、小说生成）走轻量模型，而不用 dense 大模型。
                按 <code style={{ color: COPPER, fontFamily: "'JetBrains Mono', monospace" }}>agentPatterns</code> 前缀命中 agent 即生效。
              </span>
            }
            description={
              <span style={{ color: '#807a6e', fontSize: 11.5 }}>
                全局默认: <code style={{ color: COPPER, fontFamily: "'JetBrains Mono', monospace" }}>{moduleGlobal.url}</code> · 模型 <code style={{ color: COPPER, fontFamily: "'JetBrains Mono', monospace" }}>{moduleGlobal.model || '—'}</code>。
                命中模块时对应字段覆盖全局；未填的字段回退全局。
              </span>
            }
          />

          {/* 新建模块 (从已知候选创建) */}
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#807a6e' }}>从候选新建模块:</span>
            {!showNewModule ? (
              <Button size="small" icon={<PlusOutlined />} onClick={() => setShowNewModule(true)}
                style={{ borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>
                新建模块
              </Button>
            ) : (
              <Select
                size="small"
                style={{ width: 260 }}
                placeholder="选择要创建的模块"
                autoFocus
                options={knownModules.map(k => ({ value: k.moduleKey, label: `${k.name} (${k.moduleKey})` }))}
                onChange={(v) => {
                  const k = knownModules.find(x => x.moduleKey === v)
                  if (k) createEmptyModule(k)
                }}
              />
            )}
            {knownModules.length > 0 && (
              <span style={{ fontSize: 10.5, color: '#5a554d' }}>
                提示: 候选含默认 agent 前缀, 创建后按需修改
              </span>
            )}
          </div>

          {modulesLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
          ) : modules.length === 0 ? (
            <Empty description={<span style={{ color: '#807a6e', fontSize: 12 }}>暂无模块配置 — 点击"新建模块"开始</span>} />
          ) : (
            <div style={{ maxHeight: 480, overflow: 'auto', border: '1px solid #2a2620', borderRadius: 4 }}>
              {modules.map(m => {
                const d = moduleDrafts[m.module_key] || {}
                return (
                  <div key={m.module_key}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #2a2620', flexWrap: 'wrap' }}>
                    <div style={{ width: 160, flexShrink: 0 }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: m.configured ? '#a8a298' : '#5a554d', wordBreak: 'break-all' }}>
                        {m.display_name || m.module_key}
                      </div>
                      {m.configured && <Tag color="gold" style={{ fontSize: 10, marginTop: 3, borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>已配置</Tag>}
                      {!m.configured && <span style={{ fontSize: 10, color: '#5a554d', marginTop: 2 }}>未配置(用全局)</span>}
                    </div>

                    <Space size={4} style={{ flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10.5, color: '#807a6e' }}>显示名</span>
                      <Input size="small" style={{ width: 120 }}
                        value={d.display_name || ''}
                        placeholder={m.display_name || m.module_key}
                        onChange={(e) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], display_name: e.target.value } }))} />
                    </Space>

                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>Agent 前缀 (逗号分隔)</div>
                      <Input size="small"
                        value={d.agent_patterns || ''}
                        placeholder={m.agent_patterns || 'e.g. AcademicResearch-Novel'}
                        onChange={(e) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], agent_patterns: e.target.value } }))} />
                    </div>

                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>端点 URL</div>
                      <Input size="small" placeholder={moduleGlobal.url || '回退全局'}
                        value={d.endpoint_url || ''}
                        onChange={(e) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], endpoint_url: e.target.value } }))} />
                    </div>

                    <div style={{ width: 240 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>模型 (omlx 列表)</div>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        placeholder={moduleGlobal.model || '从 omlx 列表选择'}
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        value={d.model_name || null}
                        onChange={(v) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], model_name: v || '' } }))}
                        options={modelOptionsForModule(d.model_name)}
                      />
                    </div>

                    <div style={{ width: 150 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>API Key ({d.api_key === '******' ? '已设置' : '不填=回退'})</div>
                      <Input size="small" placeholder="可选"
                        prefix={<KeyOutlined style={{ color: '#5a554d' }} />}
                        value={d.api_key || ''}
                        onChange={(e) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], api_key: e.target.value } }))} />
                    </div>

                    <div style={{ width: 120 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>max_tokens</div>
                      <InputNumber size="small" style={{ width: '100%' }} min={0} step={1024}
                        value={d.maxTokens ?? null}
                        placeholder="回退"
                        onChange={(v) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], maxTokens: v } }))} />
                    </div>

                    <div style={{ width: 110 }}>
                      <div style={{ fontSize: 10.5, color: '#807a6e' }}>temperature</div>
                      <InputNumber size="small" style={{ width: '100%' }} min={0} max={2} step={0.1}
                        value={d.temperature ?? null}
                        placeholder="回退"
                        onChange={(v) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], temperature: v === null ? null : v } }))} />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: '#807a6e' }}>启用</span>
                      <Switch size="small" checked={d.enabled !== false}
                        onChange={(v) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], enabled: v } }))} />
                    </div>

                    <Button size="small" type="primary"
                      loading={savingModule && savingModuleKey === m.module_key}
                      onClick={() => applyModule(m.module_key)}
                      style={{ background: '#333', borderColor: '#444', color: '#e8e3d8', fontWeight: 500 }}>
                      应用
                    </Button>
                    {m.configured && (
                      <Popconfirm title={`删除模块 ${m.module_key} 配置?`} onConfirm={() => deleteModule(m.module_key)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ borderColor: 'transparent' }} />
                      </Popconfirm>
                    )}
                  </div>
                )
              })}
            </div>
          )}
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
          </ul>
        </Card>
      </div>
    </Content>
  )
}
