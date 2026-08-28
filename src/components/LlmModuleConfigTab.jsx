import { useEffect, useState, useCallback } from 'react'
import {
  Card, Tag, Button, Space, Typography, Table, Input, InputNumber, Select, Switch,
  Alert, Spin, Popconfirm, Empty, message,
} from 'antd'
import {
  ReloadOutlined, PlusOutlined, DeleteOutlined, ApiOutlined, KeyOutlined,
  ExperimentOutlined, SettingOutlined, CheckCircleOutlined,
} from '@ant-design/icons'
import api from '../auth'

const { Text } = Typography

const COPPER = '#d4a574'
const COPPER_DIM = 'rgba(212,165,116,0.3)'
const COPPER_GLOW = 'rgba(212,165,116,0.08)'

/**
 * LLM 配置 Tab (仅 Super Admin 可见, 在设置弹窗中展示).
 *
 * <p><b>设计理念：按功能模块进行 LLM 相关配置, 不再暴露逐 agent 推理强度滑动条等复杂选项.</b></p>
 *
 * <p>本 Tab 只包含：</p>
 * <ul>
 *   <li>全局默认 max_tokens + 模型上下文上限只读展示</li>
 *   <li>功能模块级端点配置（每行一个模块: 显示名/Agent前缀/端点URL/模型/API Key/max_tokens/temperature/启用）</li>
 * </ul>
 *
 * <p>其它高级能力（omlx 模型列表热切换、运行时覆盖、Agent 级推理强度档位）
 * 仍保留在侧边栏的 "LLM 模型管理" 页面, 供需要时使用.</p>
 *
 * 数据接口：
 * <ul>
 *   <li>GET    /api/admin/llm/module-configs            — 列出全部模块</li>
 *   <li>POST   /api/admin/llm/module-config             — 保存单个模块</li>
 *   <li>DELETE /api/admin/llm/module-config/{moduleKey} — 删除模块</li>
 *   <li>GET    /api/admin/llm/reasoning-configs          — 读取全局 max_tokens / 模型上下文</li>
 *   <li>POST   /api/admin/llm/reasoning-config           — 保存全局 max_tokens</li>
 * </ul>
 */
export default function LlmModuleConfigTab() {
  // 功能模块
  const [modules, setModules] = useState([])
  const [knownModules, setKnownModules] = useState([])
  const [moduleGlobal, setModuleGlobal] = useState({ url: '', model: '' })
  const [modulesLoading, setModulesLoading] = useState(false)
  const [moduleDrafts, setModuleDrafts] = useState({})
  const [savingModule, setSavingModule] = useState(false)
  const [savingModuleKey, setSavingModuleKey] = useState(null)
  const [showNewModule, setShowNewModule] = useState(false)

  // omlx 已加载模型列表 (用于"模型"下拉展示全部可选模型)
  const [models, setModels] = useState([]) // ["model-id-1", "model-id-2", ...]

  // 全局
  const [globalReasoning, setGlobalReasoning] = useState(null) // { global, default_max_tokens, model_context }
  const [globalDraft, setGlobalDraft] = useState({ maxTokens: null })
  const [globalLoading, setGlobalLoading] = useState(false)
  const [savingGlobal, setSavingGlobal] = useState(false)

  const fetchModules = useCallback(async () => {
    setModulesLoading(true)
    try {
      const res = await api.get('/admin/llm/module-configs')
      setModules(res.data?.modules || [])
      setKnownModules(res.data?.known || [])
      setModuleGlobal(res.data?.global || { url: '', model: '' })
      try {
        const mres = await api.get('/admin/llm/models')
        setModels(mres.data?.models || [])
      } catch (_) {
        // omlx 模型列表获取失败则保持空, 下拉至少保留当前已选模型可回显
      }
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
      const code = err.response?.status
      if (code === 403) message.error('仅超级管理员可访问')
      else message.error('获取模块配置失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setModulesLoading(false)
    }
  }, [])

  const fetchGlobal = useCallback(async () => {
    setGlobalLoading(true)
    try {
      const res = await api.get('/admin/llm/reasoning-configs')
      setGlobalReasoning(res.data)
      setGlobalDraft({
        maxTokens: res.data?.global?.max_tokens ?? res.data?.default_max_tokens ?? null,
      })
    } catch (err) {
      // 静默 — 全局只读展示不影响模块配置
    } finally {
      setGlobalLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModules()
    fetchGlobal()
  }, [fetchModules, fetchGlobal])

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

  const saveGlobalMaxTokens = async () => {
    if (!globalDraft.maxTokens || globalDraft.maxTokens <= 0) {
      message.warning('请输入有效的 max_tokens')
      return
    }
    const maxCap = globalReasoning?.model_context || 131072
    if (globalDraft.maxTokens > maxCap) {
      message.warning(`max_tokens 不得超过模型上下文上限 ${maxCap.toLocaleString()}`)
      return
    }
    setSavingGlobal(true)
    try {
      await api.post('/admin/llm/reasoning-config', {
        agent: null,
        maxTokens: globalDraft.maxTokens,
      })
      message.success('全局 max_tokens 保存成功 (持久化, 立即生效)')
      await fetchGlobal()
    } catch (err) {
      message.error('保存失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingGlobal(false)
    }
  }

  // 模块模型下拉候选: 列出 omlx 已加载的全部模型; 若当前已保存模型不在列表中则追加一项保证可回显;
  // 全局默认模型也作为补充项, 方便一键选回全局.
  const modelOptionsForModule = (currentName) => {
    const optSet = new Map()
    for (const m of (models || [])) {
      optSet.set(m, { value: m, label: m })
    }
    if (currentName && !optSet.has(currentName)) {
      optSet.set(currentName, { value: currentName, label: currentName + ' (不在 omlx 列表)' })
    }
    const g = moduleGlobal?.model
    if (g && !optSet.has(g)) {
      optSet.set(g, { value: g, label: g + ' (全局默认)' })
    }
    return Array.from(optSet.values())
  }

  const maxCap = globalReasoning?.model_context || 131072

  return (
    <div>
      <Alert
        type="info" showIcon
        icon={<ExperimentOutlined />}
        style={{ marginBottom: 16, background: COPPER_GLOW, borderColor: COPPER_DIM }}
        message={<span style={{ color: '#e8e3d8', fontSize: 12.5 }}>
          <b style={{ color: COPPER }}>按功能模块</b>绑定独立 LLM 端点+模型+max_tokens, 让轻量任务（如股票分析、小说生成）走轻量模型, 而不必共用 dense 大模型.
        </span>}
        description={<span style={{ color: '#807a6e', fontSize: 11.5 }}>
          按 <code style={{ color: COPPER }}>agentPatterns</code> 前缀命中 agent 即生效. 未配置的模块沿用全局默认. 高级能力（omlx 热切换、agent 级推理强度）仍保留在侧边栏 "LLM 模型管理" 页面.
        </span>}
      />

      {/* 全局默认配置 — 仅 max_tokens 可编辑, 模型上下文只读 */}
      <Card
        loading={globalLoading}
        style={{ background: '#1a1a1a', borderColor: '#333', marginBottom: 20 }}
        headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SettingOutlined style={{ color: COPPER }} />
            <span>全局默认</span>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchGlobal} loading={globalLoading}
              style={{ color: '#888', marginLeft: 8 }} />
          </div>
        }
        extra={<Tag style={{ fontSize: 11, borderColor: '#2a2620', color: '#807a6e', background: '#0d0d0d' }}>持久化 · 立即生效</Tag>}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: '#a8a298', fontWeight: 500, width: 100 }}>全局 max_tokens</span>
          <InputNumber
            size="middle" style={{ width: 160 }} min={1024} max={maxCap} step={1024}
            value={globalDraft.maxTokens}
            onChange={(v) => setGlobalDraft(p => ({ ...p, maxTokens: v }))}
          />
          <Button size="middle" type="primary" icon={<CheckCircleOutlined />}
            loading={savingGlobal} onClick={saveGlobalMaxTokens}
            style={{ background: COPPER, borderColor: COPPER, color: '#0a0a0a', fontWeight: 500 }}>
            应用全局
          </Button>
          <Tag color="blue" style={{ fontSize: 11 }}>
            模型上下文上限: {maxCap.toLocaleString()}
          </Tag>
        </div>
        <div style={{ fontSize: 11, color: '#5a554d', marginTop: 8 }}>
          默认模型 (.env): <code style={{ color: COPPER }}>{globalReasoning?.global?.default_model || '—'}</code>
          {' · '}
          端点: <code style={{ color: COPPER }}>{moduleGlobal.url || '—'}</code>
          {' · '}
          全局模型: <code style={{ color: COPPER }}>{moduleGlobal.model || '—'}</code>
        </div>
      </Card>

      {/* 功能模块级端点配置 */}
      <Card
        style={{ background: '#1a1a1a', borderColor: '#333' }}
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
        {/* 新建模块 */}
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#807a6e' }}>从候选新建模块:</span>
          {!showNewModule ? (
            <Button size="small" icon={<PlusOutlined />} onClick={() => setShowNewModule(true)}
              style={{ borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>
              新建模块
            </Button>
          ) : (
            <Select
              size="small" style={{ width: 280 }}
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
          <div style={{ border: '1px solid #2a2620', borderRadius: 4 }}>
            {modules.map((m, idx) => {
              const d = moduleDrafts[m.module_key] || {}
              return (
                <div key={m.module_key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    borderBottom: idx < modules.length - 1 ? '1px solid #2a2620' : 'none',
                    flexWrap: 'wrap',
                  }}>
                  <div style={{ width: 140, flexShrink: 0 }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: m.configured ? '#a8a298' : '#5a554d', wordBreak: 'break-all' }}>
                      {m.display_name || m.module_key}
                    </div>
                    {m.configured
                      ? <Tag color="gold" style={{ fontSize: 10, marginTop: 3, borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>已配置</Tag>
                      : <span style={{ fontSize: 10, color: '#5a554d', marginTop: 2 }}>未配置(用全局)</span>}
                  </div>

                  <Space size={4} style={{ flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, color: '#807a6e' }}>显示名</span>
                    <Input size="small" style={{ width: 120 }}
                      value={d.display_name || ''}
                      placeholder={m.display_name || m.module_key}
                      onChange={(e) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], display_name: e.target.value } }))} />
                  </Space>

                  <div style={{ flex: 1, minWidth: 160 }}>
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

                  <div style={{ width: 220 }}>
                    <div style={{ fontSize: 10.5, color: '#807a6e' }}>模型 (全部可选)</div>
                    <Select
                      size="small" style={{ width: '100%' }}
                      placeholder={models.length ? '从 omlx 全部模型中选择' : (moduleGlobal.model || '手动输入或从全局选')}
                      allowClear showSearch
                      optionFilterProp="label"
                      value={d.model_name || null}
                      onChange={(v) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], model_name: v || '' } }))}
                      options={modelOptionsForModule(d.model_name)}
                    />
                  </div>

                  <div style={{ width: 140 }}>
                    <div style={{ fontSize: 10.5, color: '#807a6e' }}>API Key ({d.api_key === '******' ? '已设置' : '不填=回退'})</div>
                    <Input size="small" placeholder="可选"
                      prefix={<KeyOutlined style={{ color: '#5a554d' }} />}
                      value={d.api_key || ''}
                      onChange={(e) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], api_key: e.target.value } }))} />
                  </div>

                  <div style={{ width: 110 }}>
                    <div style={{ fontSize: 10.5, color: '#807a6e' }}>max_tokens</div>
                    <InputNumber size="small" style={{ width: '100%' }} min={0} step={1024}
                      value={d.maxTokens ?? null}
                      placeholder="回退"
                      onChange={(v) => setModuleDrafts(p => ({ ...p, [m.module_key]: { ...p[m.module_key], maxTokens: v } }))} />
                  </div>

                  <div style={{ width: 100 }}>
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
                    onClick={() => saveModule(m.module_key, d)}
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
    </div>
  )
}
