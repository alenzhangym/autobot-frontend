/**
 * 2026-07-12: 学术研究功能页面 — Editorial Research Atlas 重设计。
 *
 * 不再作为会话，而是作为独立功能页面。垂直分步骤研究工作站：
 *   01  选择研究类型   — 4 大报告类型卡片，必选，选中态鲜明
 *   02  确定研究主题   — 大号衬线输入 + LLM 搜索建议（可编辑）
 *   03  检索资料       — 搜索源选择 + 左摘要 / 右全文 分屏
 *   04  生成建议       — 辅助提示词 + 生成按钮 + 报告展示
 *
 * 设计语言：Industrial Editorial Brutalism — Fraunces 衬线 × JetBrains Mono 技术感 × 铜色暖光
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Input, Button, Tooltip, Spin, message, Empty, Modal } from 'antd'
import {
  SearchOutlined, FileTextOutlined, BulbOutlined,
  CopyOutlined, LinkOutlined, CheckOutlined,
  ThunderboltOutlined, GlobalOutlined, DatabaseOutlined, ApiOutlined,
  ArrowRightOutlined, ExperimentOutlined, AlertOutlined, AuditOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import api from './auth'

const { TextArea } = Input

// ── 报告类型定义 ──────────────────────────────────────────────
const REPORT_TYPES = [
  {
    label: '对策建议型', value: 'policy_advice', btnLabel: '生成政策建议',
    numeral: 'Ⅰ', icon: <ThunderboltOutlined />,
    desc: '痛点案例 → 原因剖析 → 机制设计 → 落地实操',
  },
  {
    label: '预警研判型', value: 'forecast', btnLabel: '生成预警研判',
    numeral: 'Ⅱ', icon: <AlertOutlined />,
    desc: '时效数据 → 情境分析法推演三种走向',
  },
  {
    label: '评估验证型', value: 'evaluation', btnLabel: '生成评估验证',
    numeral: 'Ⅲ', icon: <AuditOutlined />,
    desc: '政策原文 → 执行偏差拆解 → ROI 评估',
  },
  {
    label: '调研实证型', value: 'empirical', btnLabel: '生成调研实证',
    numeral: 'Ⅳ', icon: <ExperimentOutlined />,
    desc: '标杆案例 → 剔除不可复制因素 → 通用模型提炼',
  },
]

const SEARCH_SOURCES = [
  { key: 'perplexity', label: 'Perplexity', icon: <ApiOutlined />, desc: 'API 检索，消耗配额' },
  { key: 'feedcoop',   label: 'FeedCoop',   icon: <DatabaseOutlined />, desc: '搜索 API，消耗配额' },
  { key: 'httpget',    label: 'HTTP GET',   icon: <GlobalOutlined />, desc: '免费抓取，无配额' },
  // 2026-07-17: 本地知识库作为第 4 个独立搜索源
  // 勾选后 executeSearch 会检索 DocumentSemanticSearchService 找到的相关片段，
  // 作为搜索结果存入 academic_search_item，前端列表中可查看/删除。
  { key: 'knowledge_base', label: '本地知识库', icon: <DatabaseOutlined />, desc: '检索本地文档库相关片段，无配额' },
]

// ── 动画变体 ──────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}

export default function AcademicResearchPage({ user }) {
  const [activeTab, setActiveTab] = useState(null)          // null = 未选择，强制用户选
  const [topic, setTopic] = useState('')
  const [researchId, setResearchId] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [searchResults, setSearchResults] = useState([])
  const [searchHistory, setSearchHistory] = useState([])
  const [userPrompt, setUserPrompt] = useState('')
  const [report, setReport] = useState('')
  const [history, setHistory] = useState([])

  // 搜索源：默认 Perplexity
  const [sources, setSources] = useState({ perplexity: true, feedcoop: false, httpget: false, knowledge_base: false })

  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [searching, setSearching] = useState(false)
  // 2026-07-17: 异步生成状态。原 generating boolean 保留兼容（generating === (genStatus==='generating')）
  const [generating, setGenerating] = useState(false)
  // genStatus: 'idle' | 'generating' | 'done' | 'cancelled' | 'failed'
  const [genStatus, setGenStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedResultIdx, setSelectedResultIdx] = useState(0)
  // 2026-07-17: 当前选中的历史记录 id（左侧列表点击切换）
  const [selectedHistoryId, setSelectedHistoryId] = useState(null)

  // 2026-07-12: 搜索用量（公司/用户搜索次数 + 剩余配额）
  const [searchUsage, setSearchUsage] = useState({ companyCount: 0, userCount: 0, limit: 10000, remaining: 10000, exceeded: false })

  // 2026-07-12: 报告结构模板（每种报告类型有多套模板）
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(null)

  const currentConfig = useMemo(
    () => REPORT_TYPES.find(t => t.value === activeTab) || REPORT_TYPES[0],
    [activeTab]
  )

  // 步骤完成度（用于步骤轴高亮）
  const stepDone = {
    s1: !!activeTab,
    s2: !!researchId && suggestions.length > 0,
    s3: searchResults.length > 0,
    s4: !!report,
  }

  // ── 切换报告类型 ────────────────────────────────────────────
  const handleTabChange = async (val) => {
    if (researchId && activeTab) {
      // 已有进行中的研究，切换需确认（这里简化为直接重置）
    }
    setActiveTab(val)
    // 2026-07-12: 拉取对应报告类型的结构模板列表
    setTemplateId(null)
    try {
      const res = await api.get('/academic/report-templates', { params: { report_type: val } })
      if (res.data && res.data.length > 0) {
        setTemplates(res.data)
        setTemplateId(res.data[0].id)  // 默认选第一个
      } else {
        setTemplates([])
      }
    } catch (e) { setTemplates([]) }
  }

  const resetResearch = () => {
    setTopic(''); setResearchId(null); setSuggestions([])
    setSearchResults([]); setSearchHistory([]); setUserPrompt('')
    setReport(''); setSelectedResultIdx(0)
    setTemplates([]); setTemplateId(null)
    // 2026-07-17: 重置异步生成状态和选中历史
    setGenStatus('idle'); setGenerating(false)
    setProgress(0); setProgressMessage('')
    setSelectedHistoryId(null)
  }

  // 2026-07-17: 新建研究 — 重置表单并在左侧列表中不选中任何历史
  const handleNewResearch = () => {
    resetResearch()
  }

  // ── 历史列表 ────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await api.get('/academic/research')
      if (res.data) setHistory(res.data)
    } catch (e) { /* 静默 */ }
    finally { setLoadingHistory(false) }
  }, [])

  // 2026-07-12: 拉取搜索用量（公司/用户已用次数 + 剩余配额）
  const fetchSearchUsage = useCallback(async () => {
    try {
      const res = await api.get('/search-usage')
      if (res.data) setSearchUsage(res.data)
    } catch (e) { /* 静默 */ }
  }, [])

  useEffect(() => { fetchHistory(); fetchSearchUsage() }, [fetchHistory, fetchSearchUsage])

  // ── Step 2: 创建研究 + 获取搜索建议 ─────────────────────────
  // 2026-07-12: 有 researchId 时走 PUT 更新（覆盖旧记录），无则 POST 创建
  const handleGetSuggestions = async () => {
    if (!activeTab) { message.warning('请先选择研究类型'); return }
    if (!topic.trim()) { message.warning('请输入研究主题'); return }
    setLoadingSuggestions(true)
    setSuggestions([]); setReport('')
    try {
      let currentId = researchId
      if (currentId) {
        // 已有记录 → 更新主题和报告类型（覆盖旧记录，不新建）
        await api.put(`/academic/research/${currentId}`, {
          topic: topic.trim(),
          report_type: activeTab,
        })
      } else {
        // 新建
        const createRes = await api.post('/academic/research', {
          topic: topic.trim(),
          report_type: activeTab,
        })
        if (createRes.data?.id) {
          currentId = createRes.data.id
          setResearchId(currentId)
        }
      }
      if (currentId) {
        const sugRes = await api.post(`/academic/research/${currentId}/suggestions`)
        if (sugRes.data?.queries) {
          // 转为 {text, checked} 对象数组，默认全选
          setSuggestions(sugRes.data.queries.map(q => ({ text: q, checked: true })))
        }
      }
    } catch (e) {
      message.error('获取搜索建议失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setLoadingSuggestions(false)
    }
  }

  // ── Step 3: 批量执行选中条目的搜索 ─────────────────────────
  const handleSearchSelected = async () => {
    const checked = suggestions.filter(s => s.checked && s.text && s.text.trim())
    if (checked.length === 0) { message.warning('请至少勾选一条搜索建议'); return }
    if (!researchId) { message.warning('请先获取搜索建议'); return }
    setSearching(true)
    const enablePerplexity = sources.perplexity && !sources.httpget
    const enableFeedCoop = sources.feedcoop && !sources.httpget
    // 2026-07-17: 本地知识库独立开关，不与 HTTP GET / API 互斥
    const enableKnowledgeBase = !!sources.knowledge_base
    let totalNew = 0
    try {
      for (const s of checked) {
        const res = await api.post(`/academic/research/${researchId}/search`, {
          query: s.text.trim(),
          enable_perplexity_search: enablePerplexity,
          enable_feedcoop_search: enableFeedCoop,
          enable_knowledge_base: enableKnowledgeBase,
        })
        if (res.data?.results) {
          setSearchResults(prev => [...prev, ...res.data.results])
          setSearchHistory(prev => [...prev, { query: s.text.trim(), count: res.data.count, time: Date.now() }])
          totalNew += res.data.count
        }
      }
      setSelectedResultIdx(searchResults.length) // 选中第一条新结果
      message.success(`搜索完成，共获取 ${totalNew} 条结果`)
      // 刷新搜索用量（让用户直观看到消耗了多少次）
      fetchSearchUsage()
    } catch (e) {
      message.error('搜索失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setSearching(false)
    }
  }

  // ── Step 4: 生成报告（异步模式） ───────────────────────────
  // 2026-07-17: 后端改为异步执行，/generate 立即返回 status=generating。
  // 此处只发起请求并切换到 generating 状态，实际进度通过下方 useEffect 轮询获取。
  const handleGenerate = async () => {
    if (!researchId) { message.warning('请先完成主题与搜索建议步骤'); return }
    setGenerating(true); setGenStatus('generating'); setReport('')
    setProgress(0); setProgressMessage('准备生成')
    try {
      await api.post(`/academic/research/${researchId}/generate`, {
        user_prompt: userPrompt,
        template_id: templateId,
      })
      // 立即返回，轮询 useEffect 会接管进度更新
      message.info('已开始异步生成，请等待进度更新')
    } catch (e) {
      message.error('启动生成失败: ' + (e.response?.data?.error || e.message))
      setGenerating(false); setGenStatus('failed')
      setProgressMessage('启动失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // 2026-07-17: 异步生成进度轮询。genStatus=generating 时每 2s 轮询一次。
  // 读取 status/progress/progressMessage/generatedReport，终止条件：done/cancelled/draft/failed
  useEffect(() => {
    if (genStatus !== 'generating' || !researchId) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await api.get(`/academic/research/${researchId}`)
        if (cancelled) return
        const r = res.data
        if (!r) return
        setProgress(r.progress || 0)
        setProgressMessage(r.progressMessage || '')
        if (r.status === 'done') {
          setReport(r.generatedReport || '')
          setGenStatus('done'); setGenerating(false)
          message.success('报告生成完成')
          fetchHistory()  // 刷新左侧列表状态
        } else if (r.status === 'cancelled') {
          setGenStatus('cancelled'); setGenerating(false)
          message.warning('生成已取消')
          fetchHistory()
        } else if (r.status === 'draft') {
          // 生成失败（后端异常时回退到 draft）
          setGenStatus('failed'); setGenerating(false)
          message.error('生成失败: ' + (r.progressMessage || '未知错误'))
          fetchHistory()
        }
        // status === 'generating' → 继续轮询
      } catch (e) {
        if (!cancelled) {
          console.warn('poll error', e)
        }
      }
    }
    poll()  // 立即执行一次
    // 2026-07-17: 轮询间隔 10s，降低后端负载。长任务（30min+）约 180 次请求。
    // 进度更新频率取决于 LLM 调用完成速度（每章/子小节约 30-90s），10s 足以反映进度变化。
    const timer = setInterval(poll, 10000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [genStatus, researchId])

  // 2026-07-17: 取消生成
  const handleCancel = async () => {
    if (!researchId) return
    try {
      const res = await api.post(`/academic/research/${researchId}/cancel`)
      if (res.data?.cancelled) {
        message.info('已请求取消，生成将在当前步骤完成后中止')
      } else {
        message.warning(res.data?.message || '无法取消')
      }
    } catch (e) {
      message.error('取消失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // ── 加载历史 ────────────────────────────────────────────────
  // 2026-07-17: 左侧列表点击切换。同步 genStatus 让轮询逻辑接管生成中的任务。
  const handleLoadHistory = async (id) => {
    setSelectedHistoryId(id)
    try {
      const res = await api.get(`/academic/research/${id}`)
      if (res.data) {
        const r = res.data
        setActiveTab(r.reportType || 'policy_advice')
        setTopic(r.topic || ''); setResearchId(r.id)
        setUserPrompt(r.userPrompt || ''); setReport(r.generatedReport || '')
        setSuggestions([]); setSearchResults([]); setSearchHistory([])
        setSelectedResultIdx(0)
        // 2026-07-17: 同步生成状态。若后端仍在 generating，前端轮询会接管进度更新
        setProgress(r.progress || 0)
        setProgressMessage(r.progressMessage || '')
        if (r.status === 'generating') {
          setGenerating(true); setGenStatus('generating')
        } else if (r.status === 'done') {
          setGenerating(false); setGenStatus('done')
        } else if (r.status === 'cancelled') {
          setGenerating(false); setGenStatus('cancelled')
        } else {
          setGenerating(false); setGenStatus('idle')
        }
        // 2026-07-12: 恢复模板选择状态
        setTemplateId(r.templateId || null)
        try {
          const tplRes = await api.get('/academic/report-templates', { params: { report_type: r.reportType || 'policy_advice' } })
          if (tplRes.data) setTemplates(tplRes.data)
          if (!r.templateId && tplRes.data && tplRes.data.length > 0) {
            setTemplateId(tplRes.data[0].id)
          }
        } catch (e) { /* 静默 */ }
        const itemsRes = await api.get(`/academic/research/${id}/search-items`)
        if (itemsRes.data) {
          const all = [], hist = []
          for (const item of itemsRes.data) {
            try {
              const parsed = JSON.parse(item.results || '[]')
              all.push(...parsed)
              hist.push({ query: item.query, count: item.resultCount, time: new Date(item.createdAt).getTime() })
            } catch (e) { /* ignore */ }
          }
          setSearchResults(all); setSearchHistory(hist)
        }
      }
    } catch (e) {
      message.error('加载历史研究失败: ' + e.message)
    }
  }

  const toggleSource = (key) => {
    setSources(prev => {
      // 2026-07-17: knowledge_base 是独立搜索源，不与 HTTP GET / API 互斥，
      // 可与任意其他源组合（如同时勾选 Perplexity + 本地知识库）
      if (key === 'knowledge_base') {
        return { ...prev, knowledge_base: !prev.knowledge_base }
      }
      if (key === 'httpget') {
        // HTTP GET 与 API 互斥：选中 HTTP GET 时关闭两个 API（不影响 knowledge_base）
        return { perplexity: false, feedcoop: false, httpget: !prev.httpget, knowledge_base: prev.knowledge_base }
      }
      // 选中 API 时关闭 HTTP GET（不影响 knowledge_base）
      return { ...prev, [key]: !prev[key], httpget: false }
    })
  }

  // ── 删除历史记录 ──────────────────────────────────────────
  // 2026-07-17: 若删除的是正在执行的任务，需用户确认。删除后停止轮询。
  // 后端 checkCancellation 会发现记录消失自动中止生成线程。
  const handleDeleteHistory = async (id, e) => {
    if (e) { e.stopPropagation(); e.preventDefault() }

    // 判断是否是正在执行的任务：优先用列表数据，兜底用当前组件状态
    const target = history.find(h => h.id === id)
    const isGenerating = (target?.status === 'generating') ||
                         (id === researchId && genStatus === 'generating')

    const doDelete = async () => {
      try {
        await api.delete(`/academic/research/${id}`)
        // 如果删除的是当前正在生成的任务，先停止轮询（触发 useEffect cleanup）
        if (id === researchId && genStatus === 'generating') {
          setGenStatus('idle'); setGenerating(false)
        }
        setHistory(prev => prev.filter(h => h.id !== id))
        // 若删除的是当前正在编辑的记录，重置为新建状态
        if (researchId === id) { resetResearch() }
        message.success('已删除')
      } catch (err) {
        message.error('删除失败: ' + (err.response?.data?.error || err.message))
      }
    }

    if (isGenerating) {
      Modal.confirm({
        title: '确认删除正在生成的任务',
        content: '该研究正在生成中，删除会立即停止生成任务且不可恢复。是否继续？',
        okText: '删除并停止',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: doDelete,
      })
    } else {
      doDelete()
    }
  }

  // ── 删除单条搜索结果（用户审核删除无关条目） ──────────────
  const [deletingResultIdx, setDeletingResultIdx] = useState(null)
  const handleDeleteSearchResult = async (idx, e) => {
    if (e) { e.stopPropagation(); e.preventDefault() }
    const r = searchResults[idx]
    if (!r) return
    if (!researchId) { message.warning('请先创建研究项目'); return }
    setDeletingResultIdx(idx)
    try {
      const res = await api.delete(`/academic/research/${researchId}/search-results`, {
        data: { url: r.url || '', title: r.title || '' }
      })
      if (res.data?.deleted) {
        // 先调整选中索引，再移除条目
        setSelectedResultIdx(prev => {
          if (idx === prev) return Math.max(0, idx - 1)
          if (idx < prev) return prev - 1
          return prev
        })
        setSearchResults(prev => prev.filter((_, i) => i !== idx))
        message.success('已删除该条搜索结果')
      } else {
        message.warning(res.data?.message || '未找到匹配的搜索结果')
      }
    } catch (err) {
      message.error('删除失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setDeletingResultIdx(null)
    }
  }

  const selectedResult = searchResults[selectedResultIdx]

  // ── 样式工具 ────────────────────────────────────────────────
  const serif   = { fontFamily: "var(--ab-font-display)" }
  const mono    = { fontFamily: "var(--ab-font-mono)" }
  const body    = { fontFamily: "var(--ab-font-body)" }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }} className="custom-scrollbar">
      {/* 注入关键帧与伪元素样式 */}
      <style>{`
        @keyframes arp-grain { 0%{transform:translate(0,0)} 100%{transform:translate(-8px,-8px)} }
        @keyframes arp-pulse { 0%,100%{opacity:.5} 50%{opacity:.9} }
        .arp-topic-input { background:transparent !important; border:none !important; color:var(--ab-text) !important;
          font-family:var(--ab-font-display) !important; font-size:30px !important; line-height:1.35 !important;
          font-weight:400 !important; letter-spacing:-0.01em !important; padding:6px 0 !important; resize:none !important; box-shadow:none !important; }
        .arp-topic-input::placeholder { color:var(--ab-text-4) !important; font-style:italic !important; font-weight:300 !important; }
        .arp-topic-input:focus { box-shadow:none !important; }
        .arp-prompt-input { background:var(--ab-bg-2) !important; border:1px solid var(--ab-line) !important; color:var(--ab-text) !important;
          font-family:var(--ab-font-body) !important; border-radius:6px !important; }
        .arp-prompt-input:focus { border-color:var(--ab-copper) !important; box-shadow:0 0 0 3px var(--ab-copper-glow) !important; }
        .arp-grain::before { content:''; position:fixed; inset:0; pointer-events:none; opacity:.025; z-index:0;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .arp-history-item:hover .arp-history-delete { opacity: 1 !important; }
        .arp-search-item:hover .arp-search-delete { opacity: 1 !important; }
        .arp-sidebar-item:hover .arp-history-delete { opacity: 1 !important; }
        @keyframes arp-spin-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
      `}</style>

      {/* ═══════════════════════════════════════════════════════
          左侧历史列表（2026-07-17 新增）
          取代原底部历史区，点击切换到右侧详情
          ═══════════════════════════════════════════════════════ */}
      <div className="arp-grain" style={{
        width: 280, flexShrink: 0, height: '100%', overflow: 'auto',
        borderRight: '1px solid var(--ab-line)',
        background: 'var(--ab-bg)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--ab-line)', position: 'sticky', top: 0, background: 'var(--ab-bg)', zIndex: 2 }}>
          <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 6 }}>
            Academic Research
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ ...serif, color: 'var(--ab-text)', fontSize: 18, fontWeight: 500 }}>
              研究列表
            </span>
            <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>{history.length}</span>
          </div>
          <button
            onClick={handleNewResearch}
            style={{
              marginTop: 12, width: '100%', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: selectedHistoryId === null ? 'var(--ab-surface-2)' : 'var(--ab-bg-2)',
              border: selectedHistoryId === null ? '1px solid var(--ab-copper)' : '1px solid var(--ab-line)',
              borderRadius: 6, padding: '8px 12px', transition: 'all .2s',
              color: selectedHistoryId === null ? 'var(--ab-copper)' : 'var(--ab-text-2)',
              ...mono, fontSize: 12, letterSpacing: '0.05em',
            }}>
            <span style={{ fontSize: 14, lineHeight: 0 }}>+</span>
            新建研究
          </button>
        </div>

        {/* 历史列表 */}
        <div style={{ padding: '8px 8px 20px' }}>
          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
          ) : history.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center' }}>
              <Empty description="暂无研究" image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ opacity: 0.5 }} />
            </div>
          ) : (
            history.map(h => {
              const isSelected = selectedHistoryId === h.id
              const isGenerating = h.status === 'generating'
              const isDone = h.status === 'done'
              const isCancelled = h.status === 'cancelled'
              const reportTypeMeta = REPORT_TYPES.find(t => t.value === h.reportType)
              return (
                <div
                  key={h.id}
                  onClick={() => handleLoadHistory(h.id)}
                  className="arp-sidebar-item"
                  style={{
                    cursor: 'pointer', textAlign: 'left', position: 'relative',
                    background: isSelected ? 'var(--ab-surface-2)' : 'transparent',
                    border: isSelected ? '1px solid var(--ab-copper)' : '1px solid transparent',
                    borderRadius: 6, padding: '10px 12px', marginBottom: 4, transition: 'all .15s',
                  }}
                >
                  {/* 删除按钮 — hover 时显现 */}
                  <Tooltip title="删除">
                    <button
                      onClick={(e) => handleDeleteHistory(h.id, e)}
                      className="arp-history-delete"
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        width: 20, height: 20, borderRadius: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: '1px solid transparent',
                        color: 'var(--ab-text-4)', cursor: 'pointer',
                        opacity: 0, transition: 'all .15s', zIndex: 2,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = 1
                        e.currentTarget.style.color = 'var(--ab-copper)'
                        e.currentTarget.style.borderColor = 'var(--ab-copper)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = 0
                        e.currentTarget.style.color = 'var(--ab-text-4)'
                        e.currentTarget.style.borderColor = 'transparent'
                      }}
                    >
                      <DeleteOutlined style={{ fontSize: 10 }} />
                    </button>
                  </Tooltip>

                  {/* 状态徽标行 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingRight: 22 }}>
                    <span style={{ ...mono, fontSize: 10, color: 'var(--ab-copper)', letterSpacing: '0.1em' }}>
                      {reportTypeMeta?.numeral || '·'}
                    </span>
                    <span style={{
                      ...mono, fontSize: 9, padding: '1px 6px', borderRadius: 3, letterSpacing: '0.05em',
                      color: isGenerating ? 'var(--ab-copper)' :
                             isDone ? 'var(--ab-text-3)' :
                             isCancelled ? 'var(--ab-text-4)' : 'var(--ab-text-4)',
                      background: isGenerating ? 'var(--ab-copper-glow)' :
                                  isDone ? 'var(--ab-surface-2)' :
                                  'transparent',
                      animation: isGenerating ? 'arp-spin-pulse 1.5s ease-in-out infinite' : 'none',
                    }}>
                      {isGenerating ? '生成中' : isDone ? '已完成' : isCancelled ? '已取消' : (h.status || '草稿')}
                    </span>
                  </div>

                  {/* 主题 */}
                  <div style={{
                    ...serif, fontSize: 13, fontWeight: 500, color: 'var(--ab-text)', lineHeight: 1.4, marginBottom: 4,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    paddingRight: 22,
                  }}>
                    {h.topic || '(无主题)'}
                  </div>

                  {/* 报告类型 + 更新时间 */}
                  <div style={{ ...mono, fontSize: 9, color: 'var(--ab-text-4)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{reportTypeMeta?.label || h.reportType}</span>
                    {h.updatedAt && <span>{new Date(h.updatedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          右侧主内容区（原 Step1-4 流程）
          ═══════════════════════════════════════════════════════ */}
      <div className="arp-grain custom-scrollbar" style={{ flex: 1, height: '100%', overflow: 'auto', position: 'relative', zIndex: 1 }}>
        <motion.div
          initial="hidden" animate="show" variants={stagger}
          style={{ maxWidth: 1180, margin: '0 auto', padding: '36px 32px 80px' }}
        >

          {/* ── 页眉：标题（移除历史按钮，由左侧列表取代） ─────── */}
          <motion.div variants={fadeUp} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            marginBottom: 40, borderBottom: '1px solid var(--ab-line)', paddingBottom: 22,
          }}>
            <div>
              <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 8 }}>
                Academic Research Atlas
              </div>
              <h1 style={{ ...serif, color: 'var(--ab-text)', fontSize: 38, fontWeight: 400, margin: 0, letterSpacing: '-0.02em', lineHeight: 1 }}>
                {selectedHistoryId ? '研究详情' : '学术分析'}
              </h1>
            </div>
            {/* 2026-07-17: 移除"历史"按钮，由左侧列表取代。保留"新建研究"在未选中历史时显示 */}
            {selectedHistoryId && (
              <Button size="small" onClick={handleNewResearch} style={{ ...mono, color: 'var(--ab-text-3)', borderColor: 'var(--ab-line)' }}>
                新建研究
              </Button>
            )}
          </motion.div>

          {/* ── 首次进入提示横幅 ──────────────────────────────── */}
          <AnimatePresence>
            {!researchId && !activeTab && !topic && (
              <motion.div
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'var(--ab-surface-2)', border: '1px solid var(--ab-copper)',
                  borderRadius: 6, padding: '12px 18px', marginBottom: 24,
                }}>
                <BulbOutlined style={{ color: 'var(--ab-copper)', fontSize: 16 }} />
                <div>
                  <div style={{ ...serif, fontSize: 14, fontWeight: 500, color: 'var(--ab-text)' }}>
                    新建学术研究
                  </div>
                  <div style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', marginTop: 2 }}>
                    选择报告类型 → 输入主题 → 获取建议 → 检索资料 → 生成报告。所有步骤会自动保存到同一条记录。
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ═══════════════════════════════════════════════════════
              STEP 01 — 选择研究类型
              4 大卡片，必选，选中态鲜明（铜色边框 + 光晕 + 角标 + 微抬升）
              ═══════════════════════════════════════════════════════ */}
          <StepShell index="01" title="选择研究类型" subtitle="必须选择一种报告范式，决定后续生成方向"
            done={stepDone.s1} variants={fadeUp}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              {REPORT_TYPES.map(t => {
                const selected = activeTab === t.value
                return (
                  <motion.button
                    key={t.value} variants={fadeUp}
                    whileHover={{ y: -4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTabChange(t.value)}
                    style={{
                      position: 'relative', cursor: 'pointer', textAlign: 'left',
                      background: selected ? 'var(--ab-surface-2)' : 'var(--ab-bg-2)',
                      border: selected ? '1px solid var(--ab-copper)' : '1px solid var(--ab-line)',
                      borderRadius: 8, padding: '18px 16px 16px',
                      boxShadow: selected ? 'var(--ab-shadow-glow)' : 'none',
                      transition: 'all .25s ease', overflow: 'hidden',
                    }}
                  >
                    {/* 选中角标 */}
                    <AnimatePresence>
                      {selected && (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                          style={{
                            position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: '50%',
                            background: 'var(--ab-copper)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                          <CheckOutlined style={{ fontSize: 10, color: 'var(--ab-bg)' }} />
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {/* 罗马数字 + 图标 */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                      <span style={{ ...serif, fontSize: 26, fontWeight: 300, color: selected ? 'var(--ab-copper)' : 'var(--ab-text-4)', lineHeight: 1 }}>
                        {t.numeral}
                      </span>
                      <span style={{ fontSize: 14, color: selected ? 'var(--ab-copper-hi)' : 'var(--ab-text-3)' }}>
                        {t.icon}
                      </span>
                    </div>
                    {/* 标签 */}
                    <div style={{ ...serif, fontSize: 17, fontWeight: 500, color: selected ? 'var(--ab-text)' : 'var(--ab-text-2)', marginBottom: 6, letterSpacing: '-0.01em' }}>
                      {t.label}
                    </div>
                    {/* 描述 */}
                    <div style={{ ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', lineHeight: 1.6, letterSpacing: '0.02em' }}>
                      {t.desc}
                    </div>
                    {/* 选中底部光条 */}
                    {selected && (
                      <motion.div layoutId="rtype-bar"
                        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--ab-copper)' }} />
                    )}
                  </motion.button>
                )
              })}
            </div>
          </StepShell>

          {/* ═══════════════════════════════════════════════════════
              STEP 02 — 确定研究主题 + 获取搜索建议
              大号衬线输入 + LLM 建议标签（可编辑）
              ═══════════════════════════════════════════════════════ */}
          <StepShell index="02" title="确定研究主题" subtitle="输入研究主题，LLM 将生成精准检索建议"
            done={stepDone.s2} active={stepDone.s1} variants={fadeUp}>
            {/* 主题大输入框 */}
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>
                Research Topic
              </div>
              <TextArea
                value={topic} onChange={e => setTopic(e.target.value)}
                placeholder="例如：海外湖泊治理的典型政策案例"
                autoSize={{ minRows: 1, maxRows: 3 }}
                className="arp-topic-input"
                onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleGetSuggestions() } }}
              />
              {/* 底部装饰线 — 聚焦时变铜色 */}
              <div style={{ height: 1, background: 'var(--ab-line)', marginTop: 2, transition: 'background .3s' }} />
            </div>

            {/* 获取建议按钮 */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Button size="large" icon={<BulbOutlined />} onClick={handleGetSuggestions} loading={loadingSuggestions}
                disabled={!stepDone.s1}
                style={{ ...mono, background: 'var(--ab-surface-2)', borderColor: 'var(--ab-line-bold)', color: 'var(--ab-copper)', letterSpacing: '0.04em', fontSize: 12 }}>
                获取搜索建议
              </Button>
              <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 11 }}>
                {topic.trim().length} 字 · 回车提交
              </span>
            </div>

            {/* LLM 分析中提示 */}
            <AnimatePresence>
              {loadingSuggestions && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Spin size="small" />
                  <span style={{ ...mono, color: 'var(--ab-text-3)', fontSize: 12 }}>LLM 正在分析主题并生成检索建议…</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 已生成建议的简短确认 — 详细勾选在下一步 */}
            <AnimatePresence>
              {suggestions.length > 0 && !loadingSuggestions && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', background: 'var(--ab-surface-2)',
                    border: '1px solid var(--ab-copper)', borderRadius: 6 }}>
                  <CheckOutlined style={{ color: 'var(--ab-copper)', fontSize: 13 }} />
                  <span style={{ ...mono, fontSize: 12, color: 'var(--ab-text-2)' }}>
                    已生成 {suggestions.length} 条检索建议
                  </span>
                  <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>
                    · 请在下一步勾选并执行搜索
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </StepShell>

          {/* ═══════════════════════════════════════════════════════
              STEP 03 — 检索资料
              搜索源选择 + LLM 建议勾选（可编辑）+ 左摘要 / 右全文 分屏
              ═══════════════════════════════════════════════════════ */}
          <StepShell index="03" title="检索资料" subtitle="勾选 LLM 建议的检索条目并执行搜索，或跳过直接使用知识库生成"
            done={stepDone.s3} active={stepDone.s2} variants={fadeUp}>

            {/* 搜索源选择器 */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 10 }}>
                搜索源
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {SEARCH_SOURCES.map(src => {
                  const on = sources[src.key]
                  return (
                    <button key={src.key} onClick={() => toggleSource(src.key)}
                      style={{
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        background: on ? 'var(--ab-surface-2)' : 'var(--ab-bg-2)',
                        border: on ? '1px solid var(--ab-copper)' : '1px solid var(--ab-line)',
                        borderRadius: 6, padding: '8px 14px',
                        transition: 'all .2s',
                      }}>
                      <span style={{ fontSize: 13, color: on ? 'var(--ab-copper)' : 'var(--ab-text-3)' }}>{src.icon}</span>
                      <span style={{ ...body, fontSize: 12, fontWeight: 500, color: on ? 'var(--ab-text)' : 'var(--ab-text-3)' }}>{src.label}</span>
                      <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>{src.desc}</span>
                    </button>
                  )
                })}
                <Tooltip title="不搜索时，生成报告将仅基于本地知识库文档">
                  <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', alignSelf: 'center', marginLeft: 4 }}>
                    可跳过此步直接生成
                  </span>
                </Tooltip>
              </div>
            </div>

            {/* 2026-07-12: 搜索用量展示 — 公司/用户已用次数 + 剩余配额 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              padding: '10px 14px', marginBottom: 18,
              background: searchUsage.exceeded ? 'var(--ab-bg-3)' : 'var(--ab-bg-2)',
              border: `1px solid ${searchUsage.exceeded ? 'var(--ab-line-bold)' : 'var(--ab-line)'}`,
              borderRadius: 6,
            }}>
              <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                搜索用量
              </span>
              {/* 公司用量 + 进度条 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
                <span style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)' }}>公司</span>
                <span style={{ ...serif, fontSize: 13, fontWeight: 500, color: searchUsage.exceeded ? 'var(--ab-text-4)' : 'var(--ab-text)' }}>
                  {searchUsage.companyCount}
                </span>
                <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>/ {searchUsage.limit}</span>
                {/* 进度条 */}
                <div style={{ flex: 1, height: 4, background: 'var(--ab-bg-3)', borderRadius: 2, overflow: 'hidden', minWidth: 60 }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (searchUsage.companyCount / searchUsage.limit) * 100)}%`,
                    background: searchUsage.exceeded ? 'var(--ab-line-bold)' : 'var(--ab-copper)',
                    transition: 'width .4s ease',
                  }} />
                </div>
              </div>
              {/* 用户用量 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)' }}>个人</span>
                <span style={{ ...serif, fontSize: 13, fontWeight: 500, color: 'var(--ab-text-2)' }}>
                  {searchUsage.userCount}
                </span>
                <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>次</span>
              </div>
              {/* 剩余配额 */}
              <div style={{
                ...mono, fontSize: 11,
                color: searchUsage.exceeded ? 'var(--ab-text-4)' : (searchUsage.remaining < 100 ? 'var(--ab-copper)' : 'var(--ab-text-3)'),
                padding: '2px 8px', borderRadius: 3,
                background: searchUsage.remaining < 100 ? 'var(--ab-copper-glow)' : 'transparent',
              }}>
                {searchUsage.exceeded ? '配额已耗尽' : `剩余 ${searchUsage.remaining}`}
              </div>
            </div>

            {/* 配额耗尽提示 */}
            {searchUsage.exceeded && (
              <div style={{
                marginBottom: 14, padding: '8px 14px',
                background: 'var(--ab-bg-3)', border: '1px solid var(--ab-line-bold)',
                borderRadius: 4, ...mono, fontSize: 11, color: 'var(--ab-text-4)',
              }}>
                搜索配额已耗尽，请改用 HTTP GET（免费抓取）或联系管理员
              </div>
            )}

            {/* LLM 搜索建议 — 可编辑多选列表（从 Step 02 移入） */}
            {suggestions.length > 0 && (
              <motion.div initial="hidden" animate="show" variants={stagger} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ ...mono, color: 'var(--ab-text-3)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    LLM 检索建议 · 勾选要搜索的条目，内容可直接修改
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={() => setSuggestions(prev => prev.map(s => ({ ...s, checked: true })))}
                      style={{ cursor: 'pointer', ...mono, fontSize: 10, color: 'var(--ab-copper)', background: 'transparent', border: 'none', padding: '2px 6px' }}>
                      全选
                    </button>
                    <span style={{ color: 'var(--ab-line)', ...mono, fontSize: 10 }}>|</span>
                    <button onClick={() => setSuggestions(prev => prev.map(s => ({ ...s, checked: false })))}
                      style={{ cursor: 'pointer', ...mono, fontSize: 10, color: 'var(--ab-text-4)', background: 'transparent', border: 'none', padding: '2px 6px' }}>
                      清空
                    </button>
                    <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', marginLeft: 4 }}>
                      {suggestions.filter(s => s.checked).length}/{suggestions.length}
                    </span>
                  </div>
                </div>
                {/* 可编辑条目列表 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {suggestions.map((s, i) => (
                    <motion.div key={i} variants={fadeUp}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: s.checked ? 'var(--ab-surface-2)' : 'var(--ab-bg-2)',
                        border: s.checked ? '1px solid var(--ab-copper)' : '1px solid var(--ab-line)',
                        borderRadius: 6, padding: '8px 12px',
                        transition: 'all .2s',
                      }}>
                      {/* 勾选框 */}
                      <button
                        onClick={() => setSuggestions(prev => prev.map((x, idx) => idx === i ? { ...x, checked: !x.checked } : x))}
                        style={{
                          cursor: 'pointer', width: 18, height: 18, borderRadius: 4,
                          border: s.checked ? '1px solid var(--ab-copper)' : '1px solid var(--ab-line-bold)',
                          background: s.checked ? 'var(--ab-copper)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'all .15s',
                        }}>
                        {s.checked && <CheckOutlined style={{ fontSize: 11, color: 'var(--ab-bg)' }} />}
                      </button>
                      {/* 序号 */}
                      <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', width: 20, flexShrink: 0 }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {/* 可编辑文本 */}
                      <input
                        value={s.text}
                        onChange={e => setSuggestions(prev => prev.map((x, idx) => idx === i ? { ...x, text: e.target.value } : x))}
                        style={{
                          flex: 1, background: 'transparent', border: 'none', outline: 'none',
                          color: 'var(--ab-text)', ...mono, fontSize: 12.5,
                          fontFamily: 'var(--ab-font-body)',
                        }}
                      />
                    </motion.div>
                  ))}
                </div>
                {/* 批量搜索按钮 */}
                <motion.div variants={fadeUp} style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Button type="primary" icon={<SearchOutlined />}
                    onClick={handleSearchSelected}
                    loading={searching}
                    disabled={suggestions.filter(s => s.checked).length === 0}
                    style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)', color: 'var(--ab-bg)', fontWeight: 500 }}>
                    搜索选中的 {suggestions.filter(s => s.checked).length} 条建议
                  </Button>
                  <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10 }}>
                    勾选后点击搜索，或跳过直接到下一步
                  </span>
                </motion.div>
              </motion.div>
            )}

            {/* 无建议时的提示 */}
            {suggestions.length === 0 && !loadingSuggestions && researchId && (
              <div style={{ textAlign: 'center', padding: '18px 0', ...mono, color: 'var(--ab-text-4)', fontSize: 11, marginBottom: 14 }}>
                暂无检索建议 · 请返回上一步获取建议，或直接跳至下一步使用知识库生成
              </div>
            )}

            {/* 搜索历史 */}
            {searchHistory.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, alignSelf: 'center' }}>已检索:</span>
                {searchHistory.map((h, i) => (
                  <span key={i} style={{
                    ...mono, fontSize: 10, color: 'var(--ab-copper)',
                    background: 'var(--ab-copper-glow)', padding: '2px 8px', borderRadius: 3,
                  }}>
                    {h.query.length > 28 ? h.query.slice(0, 28) + '…' : h.query} · {h.count}
                  </span>
                ))}
              </div>
            )}

            {/* 搜索结果分屏：左摘要 / 右全文 */}
            {searchResults.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                style={{
                  display: 'flex', height: 420,
                  background: 'var(--ab-line)', borderRadius: 8, overflow: 'hidden',
                  border: '1px solid var(--ab-line-bold)',
                  boxShadow: 'var(--ab-shadow-2)',
                }}>
                {/* 左：摘要列表 */}
                <div style={{ background: 'var(--ab-bg-1)', overflow: 'auto', minHeight: 0, flex: '0 0 42%', display: 'flex', flexDirection: 'column' }} className="custom-scrollbar">
                  <div style={{ position: 'sticky', top: 0, background: 'var(--ab-bg-2)', padding: '10px 14px',
                    borderBottom: '1px solid var(--ab-line-bold)', ...mono, fontSize: 10, color: 'var(--ab-text-3)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                    摘要 · {searchResults.length} 条
                  </div>
                  {searchResults.map((r, i) => {
                    const active = i === selectedResultIdx
                    let domain = ''
                    try { domain = new URL(r.url).hostname.replace(/^www\./, '') } catch (e) { domain = '' }
                    const isDeleting = deletingResultIdx === i
                    // 2026-07-17: 知识库结果标记（用于显示徽标）
                    const isKb = r.source === 'knowledge_base'
                    return (
                      <div key={i} className="arp-search-item" role="button" tabIndex={0}
                        onClick={() => setSelectedResultIdx(i)}
                        style={{
                          cursor: 'pointer', width: '100%', textAlign: 'left', position: 'relative',
                          background: active ? 'var(--ab-surface-2)' : 'transparent',
                          borderBottom: '1px solid var(--ab-line)',
                          borderLeft: active ? '2px solid var(--ab-copper)' : '2px solid transparent',
                          padding: '12px 14px', transition: 'all .15s',
                          opacity: isDeleting ? 0.5 : 1,
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <span style={{ ...mono, fontSize: 10, color: active ? 'var(--ab-copper)' : 'var(--ab-text-4)' }}>
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            {/* 2026-07-17: 知识库结果徽标 */}
                            {isKb && (
                              <span style={{
                                ...mono, fontSize: 8.5, padding: '1px 5px', borderRadius: 2,
                                letterSpacing: '0.08em', fontWeight: 600,
                                background: 'var(--ab-copper-glow)', color: 'var(--ab-copper)',
                                border: '1px solid var(--ab-copper)',
                              }}>
                                KB
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, justifyContent: 'flex-end' }}>
                            {domain && (
                              <span style={{ ...mono, fontSize: 9.5, color: 'var(--ab-text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1, textAlign: 'right' }}>
                                {domain}
                              </span>
                            )}
                            {/* 2026-07-13: 删除按钮 — hover 时显现，审核删除无关条目 */}
                            <button className="arp-search-delete"
                              onClick={(e) => handleDeleteSearchResult(i, e)}
                              disabled={isDeleting}
                              title="删除该条搜索结果"
                              style={{
                                opacity: 0, cursor: isDeleting ? 'wait' : 'pointer',
                                background: 'transparent', border: 'none', padding: '2px',
                                color: 'var(--ab-text-4)', flexShrink: 0, transition: 'all .15s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 0,
                              }}>
                              <DeleteOutlined style={{ fontSize: 11 }} />
                            </button>
                          </div>
                        </div>
                        <div style={{ ...body, fontSize: 12.5, fontWeight: 500, color: active ? 'var(--ab-text)' : 'var(--ab-text-2)',
                          lineHeight: 1.4, marginBottom: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          paddingRight: 18 }}>
                          {r.title || '(无标题)'}
                        </div>
                        <div style={{ ...body, fontSize: 11, color: 'var(--ab-text-4)', lineHeight: 1.5,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {r.snippet || ''}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 右：全文详情 */}
                <div style={{ background: 'var(--ab-surface)', overflow: 'auto', minHeight: 0, flex: 1, borderLeft: '1px solid var(--ab-line-bold)' }} className="custom-scrollbar">
                  {selectedResult ? (
                    <div style={{ padding: '20px 24px' }}>
                      {/* 标签：知识库/有 content 显示对应标签，否则显示"摘要" + 删除按钮 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                          {selectedResult.source === 'knowledge_base' ? '知识库片段' :
                           selectedResult.content ? '网页正文' : '摘要'}
                        </div>
                        {/* 2026-07-13: 阅读后审核删除 — 无关条目可直接移除 */}
                        <Button
                          size="small"
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          loading={deletingResultIdx === selectedResultIdx}
                          onClick={(e) => handleDeleteSearchResult(selectedResultIdx, e)}
                          style={{ fontSize: 11, ...mono, color: 'var(--ab-text-4)' }}>
                          删除该条
                        </Button>
                      </div>
                      <h3 style={{ ...serif, fontSize: 20, fontWeight: 500, color: 'var(--ab-text)', lineHeight: 1.3, margin: '0 0 12px', letterSpacing: '-0.01em' }}>
                        {selectedResult.title || '(无标题)'}
                      </h3>
                      {selectedResult.url && (
                        <a href={selectedResult.url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...mono, fontSize: 11,
                            color: 'var(--ab-copper)', marginBottom: 18, wordBreak: 'break-all' }}>
                          <LinkOutlined style={{ fontSize: 10 }} />
                          {selectedResult.url}
                        </a>
                      )}
                      <div style={{ height: 1, background: 'var(--ab-line)', marginBottom: 16 }} />
                      {/* 摘要区（有 content 时作为摘要展示，无 content 时作为全部内容） */}
                      {selectedResult.snippet && (
                        <div style={{ marginBottom: selectedResult.content ? 16 : 0 }}>
                          {selectedResult.content && (
                            <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', marginBottom: 6 }}>
                              摘要
                            </div>
                          )}
                          <div style={{ ...body, fontSize: 13, color: 'var(--ab-text-3)', lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {selectedResult.snippet}
                          </div>
                        </div>
                      )}
                      {/* 正文区（仅当有 content 时展示） */}
                      {selectedResult.content && (
                        <div>
                          {selectedResult.snippet && (
                            <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', marginBottom: 6, marginTop: 4 }}>
                              正文
                            </div>
                          )}
                          <div style={{ ...body, fontSize: 13.5, color: 'var(--ab-text-2)', lineHeight: 1.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {selectedResult.content}
                          </div>
                        </div>
                      )}
                      {/* 无内容兜底 */}
                      {!selectedResult.content && !selectedResult.snippet && (
                        <div style={{ ...body, fontSize: 13.5, color: 'var(--ab-text-4)', lineHeight: 1.85 }}>
                          (无摘要内容)
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ab-text-4)', ...mono, fontSize: 12 }}>
                      点击左侧摘要查看全文
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {searchResults.length === 0 && !searching && researchId && (
              <div style={{ textAlign: 'center', padding: '24px 0', ...mono, color: 'var(--ab-text-4)', fontSize: 11 }}>
                暂无搜索结果 · 可直接跳至下一步使用知识库生成
              </div>
            )}
          </StepShell>

          {/* ═══════════════════════════════════════════════════════
              STEP 04 — 生成建议
              辅助提示词 + 生成按钮 + 报告展示
              ═══════════════════════════════════════════════════════ */}
          <StepShell index="04" title="生成建议" subtitle="综合全部检索内容，由 LLM 生成结构化报告"
            done={stepDone.s4} active={stepDone.s2} variants={fadeUp}>

            {/* 2026-07-12: 报告结构模板选择 */}
            {templates.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                  <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    报告结构模板
                  </span>
                  <Tooltip title="不同模板对应不同的章节结构和分析方法，选择后 LLM 会按此结构生成">
                    <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10 }}>选择生成结构</span>
                  </Tooltip>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {templates.map(tpl => {
                    const selected = templateId === tpl.id
                    return (
                      <button key={tpl.id} onClick={() => setTemplateId(tpl.id)}
                        style={{
                          cursor: 'pointer', textAlign: 'left',
                          background: selected ? 'var(--ab-surface-2)' : 'var(--ab-bg-2)',
                          border: selected ? '1px solid var(--ab-copper)' : '1px solid var(--ab-line)',
                          borderRadius: 6, padding: '12px 14px', transition: 'all .2s',
                          position: 'relative',
                        }}>
                        {selected && (
                          <span style={{ position: 'absolute', top: 8, right: 8,
                            width: 14, height: 14, borderRadius: '50%',
                            background: 'var(--ab-copper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <CheckOutlined style={{ fontSize: 8, color: 'var(--ab-bg)' }} />
                          </span>
                        )}
                        <div style={{ ...serif, fontSize: 14, fontWeight: 500, color: selected ? 'var(--ab-text)' : 'var(--ab-text-2)', marginBottom: 4, paddingRight: 18 }}>
                          {tpl.name}
                        </div>
                        <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-3)', lineHeight: 1.5, marginBottom: 8 }}>
                          {tpl.desc}
                        </div>
                        {/* 章节结构预览 */}
                        <div style={{ borderTop: '1px solid var(--ab-line)', paddingTop: 6, marginTop: 6 }}>
                          {tpl.structure && tpl.structure.slice(0, 4).map((s, i) => (
                            <div key={i} style={{ ...mono, fontSize: 9, color: 'var(--ab-text-3)', lineHeight: 1.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              · {s}
                            </div>
                          ))}
                          {tpl.structure && tpl.structure.length > 4 && (
                            <div style={{ ...mono, fontSize: 9, color: 'var(--ab-text-4)' }}>
                              +{tpl.structure.length - 4} 更多
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 辅助提示词 */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  目标导向提示词
                </span>
                <Tooltip title="补充对报告的具体要求，例如：重点关注中国可借鉴的政策经验，需要数据支撑">
                  <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10 }}>(可选)</span>
                </Tooltip>
              </div>
              <TextArea
                value={userPrompt} onChange={e => setUserPrompt(e.target.value)}
                placeholder="例如：重点关注中国可借鉴的政策经验，需要有具体的数据支撑"
                autoSize={{ minRows: 2, maxRows: 5 }}
                className="arp-prompt-input"
              />
            </div>

            {/* 生成按钮 / 取消按钮（2026-07-17 异步模式） */}
            {generating ? (
              // 生成中：显示取消按钮
              <motion.button
                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                onClick={handleCancel}
                style={{
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'var(--ab-bg-2)',
                  border: '1px solid var(--ab-line)',
                  borderRadius: 6, padding: '14px 28px',
                  color: 'var(--ab-text-2)',
                  ...serif, fontSize: 17, fontWeight: 500, letterSpacing: '0.01em',
                  transition: 'all .25s',
                }}>
                <span style={{ fontSize: 16 }}>×</span>
                取消生成
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                onClick={handleGenerate} disabled={!researchId}
                style={{
                  cursor: researchId ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: researchId ? 'var(--ab-copper)' : 'var(--ab-bg-3)',
                  border: 'none', borderRadius: 6, padding: '14px 28px',
                  color: researchId ? 'var(--ab-bg)' : 'var(--ab-text-4)',
                  ...serif, fontSize: 17, fontWeight: 500, letterSpacing: '0.01em',
                  transition: 'all .25s', boxShadow: researchId ? 'var(--ab-shadow-glow)' : 'none',
                }}>
                <FileTextOutlined style={{ fontSize: 16 }} />
                {genStatus === 'cancelled' ? '重新生成' : currentConfig.btnLabel}
                <ArrowRightOutlined style={{ fontSize: 13, marginLeft: 2 }} />
              </motion.button>
            )}

            {/* 生成中：进度条 + 进度文字（2026-07-17 异步模式） */}
            <AnimatePresence>
              {generating && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  style={{
                    marginTop: 24, padding: '24px 28px',
                    background: 'var(--ab-surface)', border: '1px solid var(--ab-line)',
                    borderRadius: 8,
                  }}>
                  {/* 顶部：Spin + 标题 + 百分比 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                    <Spin size="small" />
                    <div style={{ flex: 1 }}>
                      <div style={{ ...serif, color: 'var(--ab-text)', fontSize: 15, fontWeight: 500 }}>
                        {progressMessage || '正在生成报告…'}
                      </div>
                      <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, marginTop: 3, letterSpacing: '0.05em' }}>
                        异步生成 · 整合 {searchResults.length} 条资料 + 知识库 · 无超时限制
                      </div>
                    </div>
                    <div style={{ ...mono, color: 'var(--ab-copper)', fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {progress}%
                    </div>
                  </div>
                  {/* 进度条 */}
                  <div style={{
                    height: 6, background: 'var(--ab-bg-3)', borderRadius: 3, overflow: 'hidden',
                  }}>
                    <motion.div
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      style={{
                        height: '100%', background: 'linear-gradient(90deg, var(--ab-copper-2), var(--ab-copper))',
                        borderRadius: 3,
                      }}
                    />
                  </div>
                  {/* 取消提示 */}
                  <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, marginTop: 12, textAlign: 'center' }}>
                    支持长文档多段落生成 · 可随时取消（当前 LLM 调用完成后生效）
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 取消状态提示 */}
            <AnimatePresence>
              {genStatus === 'cancelled' && !generating && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  style={{
                    marginTop: 20, padding: '14px 18px',
                    background: 'var(--ab-surface-2)', border: '1px solid var(--ab-line)',
                    borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                  <span style={{ color: 'var(--ab-text-3)', fontSize: 14 }}>⚠</span>
                  <div>
                    <div style={{ ...serif, color: 'var(--ab-text-2)', fontSize: 13, fontWeight: 500 }}>
                      生成已取消
                    </div>
                    <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, marginTop: 2 }}>
                      可点击"重新生成"重新发起，或调整参数后重试
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 失败状态提示 */}
            <AnimatePresence>
              {genStatus === 'failed' && !generating && progressMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  style={{
                    marginTop: 20, padding: '14px 18px',
                    background: 'var(--ab-surface-2)', border: '1px solid var(--ab-copper)',
                    borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                  <span style={{ color: 'var(--ab-copper)', fontSize: 14 }}>!</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...serif, color: 'var(--ab-text)', fontSize: 13, fontWeight: 500 }}>
                      生成失败
                    </div>
                    <div style={{ ...mono, color: 'var(--ab-text-3)', fontSize: 10, marginTop: 2 }}>
                      {progressMessage}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 报告展示 — 出版物质感 */}
            <AnimatePresence>
              {report && !generating && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  style={{ marginTop: 28 }}>
                  <div style={{
                    background: 'var(--ab-surface)', border: '1px solid var(--ab-line)',
                    borderRadius: 10, overflow: 'hidden',
                    boxShadow: 'var(--ab-shadow-2)',
                  }}>
                    {/* 报告页眉 */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '16px 28px', borderBottom: '1px solid var(--ab-line)',
                      background: 'var(--ab-bg-2)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 16, color: 'var(--ab-copper)' }}><FileTextOutlined /></span>
                        <span style={{ ...serif, fontSize: 16, fontWeight: 500, color: 'var(--ab-text)' }}>
                          {currentConfig.label}
                        </span>
                      </div>
                      <Button size="small" icon={<CopyOutlined />}
                        onClick={() => navigator.clipboard.writeText(report).then(() => message.success('已复制'))}
                        style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', borderColor: 'var(--ab-line)' }}>
                        复制
                      </Button>
                    </div>
                    {/* 报告正文 */}
                    <div style={{ padding: '28px 32px', maxWidth: 760 }}>
                      <div style={{
                        ...body, fontSize: 14.5, color: 'var(--ab-text)', lineHeight: 1.9,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }} className="prose">
                        {report}
                      </div>
                    </div>
                    {/* 报告页脚 */}
                    <div style={{
                      padding: '12px 28px', borderTop: '1px solid var(--ab-line)',
                      ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                      display: 'flex', justifyContent: 'space-between',
                    }}>
                      <span>{report.length} 字符</span>
                      <span>Generated · {new Date().toLocaleString('zh-CN')}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </StepShell>

        </motion.div>
      </div>
    </div>
  )
}

// ── 步骤外壳组件 ──────────────────────────────────────────────
function StepShell({ index, title, subtitle, done, active = true, variants, children }) {
  const state = done ? 'done' : (active ? 'active' : 'locked')
  const dotColor = state === 'done' ? 'var(--ab-copper)' : (state === 'active' ? 'var(--ab-copper-2)' : 'var(--ab-line)')
  return (
    <motion.div variants={variants} style={{
      display: 'grid', gridTemplateColumns: '64px 1fr', gap: 0,
      marginBottom: 8, opacity: active ? 1 : 0.45,
      transition: 'opacity .3s',
    }}>
      {/* 左侧步骤轴：编号 + 连接线 */}
      <div style={{ position: 'relative', paddingTop: 4 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '1px solid ' + dotColor,
          background: state === 'done' ? 'var(--ab-copper-glow)' : 'var(--ab-bg-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--ab-font-mono)',
        }}>
          <span style={{ fontSize: 12, color: state === 'done' ? 'var(--ab-copper)' : 'var(--ab-text-3)', letterSpacing: '0.05em' }}>
            {done ? <CheckOutlined style={{ fontSize: 13 }} /> : index}
          </span>
        </div>
        {/* 连接线 */}
        <div style={{
          position: 'absolute', top: 44, left: 20, bottom: -8, width: 1,
          background: done ? 'var(--ab-line-soft)' : 'var(--ab-line)',
        }} />
      </div>

      {/* 右侧内容 */}
      <div style={{ paddingBottom: 36, paddingLeft: 4 }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 style={{ fontFamily: 'var(--ab-font-display)', fontSize: 22, fontWeight: 500, color: 'var(--ab-text)', margin: 0, letterSpacing: '-0.01em' }}>
              {title}
            </h2>
            <span style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.15em' }}>
              STEP {index}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--ab-font-body)', fontSize: 12.5, color: 'var(--ab-text-3)', marginTop: 4 }}>
            {subtitle}
          </div>
        </div>
        {children}
      </div>
    </motion.div>
  )
}
