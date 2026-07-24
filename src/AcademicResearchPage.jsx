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
  DeleteOutlined, BookOutlined, PlusOutlined,
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import api from './auth'
import { stripThinking } from './utils/helpers.jsx'
import { useUIStore } from './store/useUIStore'

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
  // 2026-07-18: 新增教案任务类型
  {
    label: '编写教案', value: 'lesson_plan', btnLabel: '生成教案',
    numeral: 'Ⅴ', icon: <BookOutlined />,
    desc: '教学目标 → 重难点 → 教学过程 → 作业与反思',
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
  // 2026-07-20 P1-1: 进入学术研究页时自动折叠全局 Sider，让研究详情区获得更大宽度
  // 符合用户约定"研究详情应右对齐占更多屏幕宽度，减少两侧空白"
  // 离开时恢复进入前的原值，不破坏用户原有 Sider 偏好
  const setSiderCollapsed = useUIStore(s => s.setSiderCollapsed)
  useEffect(() => {
    const prevCollapsed = useUIStore.getState().siderCollapsed
    if (!prevCollapsed) setSiderCollapsed(true)
    return () => {
      // 仅当进入前是展开状态时恢复展开；若用户原本就是折叠则不改变
      if (!prevCollapsed) setSiderCollapsed(false)
    }
  }, [setSiderCollapsed])

  const [activeTab, setActiveTab] = useState(null)          // null = 未选择，强制用户选
  const [topic, setTopic] = useState('')
  const [researchId, setResearchId] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [searchResults, setSearchResults] = useState([])
  const [searchHistory, setSearchHistory] = useState([])
  const [userPrompt, setUserPrompt] = useState('')
  const [report, setReport] = useState('')
  const [history, setHistory] = useState([])
  // 2026-07-17: 报告生成的中间过程元数据（后端持久化，前端展示+编辑）
  const [outlineText, setOutlineText] = useState('')
  const [outlineDebate, setOutlineDebate] = useState('')
  // 2026-07-18: 大纲是否按 debate 建议修订过（前端展示徽标）
  const [outlineRevised, setOutlineRevised] = useState(false)
  const [sections, setSections] = useState([])  // [{title, outline, draft, debate, refined}, ...]

  // 搜索源：默认 Perplexity + 本地知识库
  // 2026-07-17: 本地知识库改为默认勾选（之前需手动勾选，认知负担高）
  const [sources, setSources] = useState({ perplexity: true, feedcoop: false, httpget: false, knowledge_base: true })

  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [searching, setSearching] = useState(false)
  // 2026-07-17: 异步生成状态。原 generating boolean 保留兼容（generating === (genStatus==='generating')）
  const [generating, setGenerating] = useState(false)
  // genStatus: 'idle' | 'generating' | 'done' | 'cancelled' | 'failed'
  const [genStatus, setGenStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  // 2026-07-20 小说生成功能 C2/C5: 自动续做批次号（后端 resume_batch 字段）
  // 0 = 首次生成或未进入 auto-resume 循环；N = 已自动续做第 N 批
  const [resumeBatch, setResumeBatch] = useState(0)
  // 2026-07-20 小说生成功能 C4: 卡住检测标志
  // true = progress 已 10 分钟无变化，提示用户"生成可能卡住"
  const [staleWarning, setStaleWarning] = useState(false)
  // 2026-07-20 小说生成功能 E3: LLM 心跳时间戳（后端 last_llm_activity_at 字段）
  // 用于精准卡住检测 — LLM 调用本身卡住时心跳不更新，比 progress 不变更精准
  const [lastLlmActivityAt, setLastLlmActivityAt] = useState(null)
  // 2026-07-20 小说生成功能 E4: 生成元数据（后端 generation_meta 字段）
  // done 状态时展示"本文自动续做 N 次完成，总耗时 X 分钟"
  const [generationMeta, setGenerationMeta] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedResultIdx, setSelectedResultIdx] = useState(0)
  // 2026-07-17: 当前选中的历史记录 id（左侧列表点击切换）
  const [selectedHistoryId, setSelectedHistoryId] = useState(null)

  // 2026-07-12: 搜索用量（公司/用户搜索次数 + 剩余配额）
  const [searchUsage, setSearchUsage] = useState({ companyCount: 0, userCount: 0, limit: 10000, remaining: 10000, exceeded: false })

  // 2026-07-12: 报告结构模板（每种报告类型有多套模板）
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(null)

  // 2026-07-18: 自定义模板创建弹窗状态
  // 用户可在任意任务类型下保存自己的章节结构模板（与内置模板并行显示，带"自定义"标识）
  const [tplModalOpen, setTplModalOpen] = useState(false)
  const [newTplName, setNewTplName] = useState('')
  const [newTplDesc, setNewTplDesc] = useState('')
  const [newTplStructure, setNewTplStructure] = useState('')  // 一行一个章节
  const [savingTpl, setSavingTpl] = useState(false)
  const [deletingTplId, setDeletingTplId] = useState(null)    // 正在删除的 templateId（前端展示用）

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

  // 2026-07-18: 重新拉取当前任务类型的模板列表（创建/删除自定义模板后调用）
  const refreshTemplates = async (reportType) => {
    if (!reportType) return
    try {
      const res = await api.get('/academic/report-templates', { params: { report_type: reportType } })
      const list = res.data || []
      setTemplates(list)
      // 当前选中的 templateId 不在列表中时，回退到第一个
      setTemplateId(prev => {
        if (prev && list.find(t => t.id === prev)) return prev
        return list.length > 0 ? list[0].id : null
      })
    } catch (e) { /* 静默 */ }
  }

  // 2026-07-18: 打开自定义模板创建弹窗
  const openNewTemplateModal = () => {
    if (!activeTab) { message.warning('请先选择任务类型'); return }
    // 默认填充当前选中模板的章节结构，便于用户基于已有模板修改
    const current = templates.find(t => t.id === templateId)
    const defaultStructure = current && current.structure
      ? current.structure.join('\n')
      : '一、\n二、\n三、\n四、\n五、参考来源'
    setNewTplName('')
    setNewTplDesc('')
    setNewTplStructure(defaultStructure)
    setTplModalOpen(true)
  }

  // 2026-07-18: 保存自定义模板（POST /api/academic/user-templates）
  const handleSaveTemplate = async () => {
    if (!activeTab) { message.warning('请先选择任务类型'); return }
    if (!newTplName.trim()) { message.warning('请输入模板名称'); return }
    const structure = newTplStructure
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
    if (structure.length === 0) { message.warning('请至少输入一个章节'); return }
    setSavingTpl(true)
    try {
      await api.post('/academic/user-templates', {
        report_type: activeTab,
        name: newTplName.trim(),
        description: newTplDesc.trim(),
        structure,
      })
      message.success('自定义模板已保存')
      setTplModalOpen(false)
      await refreshTemplates(activeTab)
      // 自动选中刚创建的模板（列表最后一个是新建的，按 isCustom 标识找最新一个）
      // refreshTemplates 已设置 templateId，这里不强制覆盖
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setSavingTpl(false)
    }
  }

  // 2026-07-18: 删除自定义模板（DELETE /api/academic/user-templates/{templateId}）
  // 后端按 templateId 删除（前端只持有 templateId，不持有 DB id）。
  const handleDeleteTemplate = async (tplId, e) => {
    if (e) { e.stopPropagation(); e.preventDefault() }
    if (!tplId) return
    setDeletingTplId(tplId)
    try {
      await api.delete(`/academic/user-templates/${encodeURIComponent(tplId)}`)
      message.success('已删除自定义模板')
      // 如果删除的是当前选中的模板，回退到第一个
      if (templateId === tplId) {
        const remaining = templates.filter(t => t.id !== tplId)
        setTemplateId(remaining.length > 0 ? remaining[0].id : null)
      }
      await refreshTemplates(activeTab)
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setDeletingTplId(null)
    }
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
    // 2026-07-17: 清空大纲/章节元数据
    setOutlineText(''); setOutlineDebate(''); setOutlineRevised(false); setSections([])
  }

  // 2026-07-17: 新建研究 — 重置表单并在左侧列表中不选中任何历史
  const handleNewResearch = () => {
    resetResearch()
  }

  // ── 历史列表 ────────────────────────────────────────────────
  // 2026-07-22: 过滤掉 novel 类型 — 小说历史只在 NovelPage 展示, 不混入学术研究列表.
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await api.get('/academic/research')
      if (res.data) {
        const academicOnly = res.data.filter(r => r.reportType !== 'novel')
        setHistory(academicOnly)
      }
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
        // 2026-07-17: 主题或类型变化时后端会删除旧 search-items，
        // 前端必须同步清空 searchResults，否则旧结果仍存在导致 canGenerate=true，
        // 用户可跳过搜索直接生成（违反"必须先搜索"约束）。
        await api.put(`/academic/research/${currentId}`, {
          topic: topic.trim(),
          report_type: activeTab,
        })
        // 清空旧搜索结果，强制用户基于新主题重新搜索
        setSearchResults([]); setSearchHistory([])
        setSelectedResultIdx(0)
        // 旧报告也已失效（后端已清空 generatedReport），同步前端状态
        setReport(''); setGenStatus('idle'); setGenerating(false)
        setProgress(0); setProgressMessage('')
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
  // 2026-07-17: 生成报告的前置条件 — 必须等前面搜索完成
  // 拦截规则：
  //   1. 必须有 researchId（已完成主题+报告类型选择）
  //   2. 不能正在获取搜索建议（loadingSuggestions）
  //   3. 不能正在执行搜索（searching）
  //   4. 必须有至少 1 条搜索结果（searchResults.length > 0）
  const generateBlockReason = (() => {
    if (!researchId) return '请先完成主题与搜索建议步骤'
    if (loadingSuggestions) return '正在获取搜索建议，请等待…'
    if (searching) return '正在执行搜索，请等待完成…'
    if (!searchResults || searchResults.length === 0) return '请先执行搜索获取至少 1 条结果'
    return null  // 无拦截原因，可生成
  })()
  const canGenerate = !generateBlockReason && !generating

  // 2026-07-17: 后端改为异步执行，/generate 立即返回 status=generating。
  // 此处只发起请求并切换到 generating 状态，实际进度通过下方 useEffect 轮询获取。
  //
  // 时序修复：必须先 await api.post 成功后再 setGenStatus('generating')。
  // 若先 setGenStatus 再 await，useEffect 会立即 poll()，此时后端 status 可能还是 'draft'
  // （/generate 请求未到达后端），轮询误判为失败，出现"一个开始提示+一个错误提示"。
  const handleGenerate = async () => {
    // 防御性检查：即使按钮 disabled 被绕过也拦截
    if (generateBlockReason) {
      message.warning(generateBlockReason)
      return
    }
    // 进入"启动中"状态：禁用按钮但还不触发轮询（genStatus 仍为 idle）
    setGenerating(true); setReport('')
    setProgress(0); setProgressMessage('正在启动生成任务…')
    // 2026-07-17: 清空旧的大纲/章节元数据，让新一轮生成重新跑全流程
    setOutlineText(''); setOutlineDebate(''); setOutlineRevised(false); setSections([])
    // 2026-07-20 C4/C5/E3/E4: 清空卡住提示 + 续做批次号 + LLM 心跳 + 元数据（新一轮生成从头开始）
    setStaleWarning(false); setResumeBatch(0); setLastLlmActivityAt(null); setGenerationMeta(null)
    try {
      await api.post(`/academic/research/${researchId}/generate`, {
        user_prompt: userPrompt,
        template_id: templateId,
      })
      // /generate 成功返回 → 后端 DB status 已为 'generating'，现在触发轮询安全
      setGenStatus('generating')
      setProgressMessage('准备生成')
      message.info('已开始异步生成，请等待进度更新')
    } catch (e) {
      message.error('启动生成失败: ' + (e.response?.data?.error || e.message))
      setGenerating(false); setGenStatus('failed')
      setProgressMessage('启动失败: ' + (e.response?.data?.error || e.message))
    }
  }

  // 2026-07-17: 异步生成进度轮询。genStatus=generating 时每 10s 轮询一次。
  // 读取 status/progress/progressMessage/generatedReport，终止条件：done/cancelled/draft/failed
  //
  // 宽容期机制：前 2 次轮询（约 10s 内）即使读到 status='draft' 也不立即判失败，
  // 避免后端线程启动与 DB 状态更新的微小时间差导致误判。
  //
  // 2026-07-20 C4: 卡住检测 — progress 连续 10 分钟无变化时设置 staleWarning=true，
  // 进度面板展示"生成可能卡住"提示，建议用户检查网络或取消重试。
  // 2026-07-20 C5: 同步 resumeBatch 字段，进度面板展示"已自动续做第 N 批"。
  // 2026-07-20 D2: 根据 reportType 动态选择卡住阈值 — 小说场景单章节生成可能 5-15 分钟，
  //   10 分钟阈值会误报；小说场景调到 20 分钟，非小说场景保持 10 分钟。
  // 2026-07-20 E3: 优先用 lastLlmActivityAt 检测卡住（LLM 调用本身卡住时心跳不更新，
  //   比 progress 不变更精准 — progress 不变可能是章节间持久化/后处理，不一定是卡住）。
  //   策略：若 lastLlmActivityAt 距当前 > 阈值 → staleWarning=true；
  //   否则回退到 progress 不变检测（覆盖 LLM 心跳未触发的场景，如大纲生成/段落扩展）。
  useEffect(() => {
    if (genStatus !== 'generating' || !researchId) return
    let cancelled = false
    let pollCount = 0  // 宽容期计数
    // C4: 卡住检测闭包状态（useEffect 重新执行时重置）
    let lastProgressValue = -1
    let lastProgressChangedAt = Date.now()
    let staleWarned = false  // 避免重复 message.warning 弹窗
    // D2: 根据 activeTab（reportType）动态选择卡住阈值
    //   novel: 20 分钟（单章节生成 5-15 分钟，10 分钟会误报）
    //   其他: 10 分钟（学术报告单章节 1-3 分钟，10 分钟足够检测卡住）
    const isNovelReport = activeTab === 'novel'
    const STALE_THRESHOLD_MS = (isNovelReport ? 20 : 10) * 60 * 1000
    const poll = async () => {
      pollCount++
      try {
        const res = await api.get(`/academic/research/${researchId}`)
        if (cancelled) return
        const r = res.data
        if (!r) return
        const currentProgress = r.progress || 0
        setProgress(currentProgress)
        setProgressMessage(r.progressMessage || '')
        // C5: 同步自动续做批次号
        setResumeBatch(r.resumeBatch || 0)
        // E3: 同步 LLM 心跳时间戳 + 生成元数据
        setLastLlmActivityAt(r.lastLlmActivityAt || null)
        setGenerationMeta(r.generationMeta || null)

        // E3: 优先用 LLM 心跳检测卡住 — LLM 心跳距当前 > 阈值 → 卡住
        // 回退到 progress 检测（覆盖大纲生成/段落扩展等无心跳场景）
        let isStale = false
        if (r.lastLlmActivityAt) {
          // 后端返回的是 ISO 格式时间戳，前端 new Date() 解析
          const llmActiveMs = new Date(r.lastLlmActivityAt).getTime()
          const elapsedSinceLlm = Date.now() - llmActiveMs
          if (elapsedSinceLlm > STALE_THRESHOLD_MS) {
            isStale = true
          }
        }
        // 回退检测：progress 不变超过阈值（覆盖无 LLM 心跳的场景）
        if (!isStale) {
          if (currentProgress !== lastProgressValue) {
            lastProgressValue = currentProgress
            lastProgressChangedAt = Date.now()
          } else {
            const elapsed = Date.now() - lastProgressChangedAt
            if (elapsed > STALE_THRESHOLD_MS) {
              isStale = true
            }
          }
        } else {
          // LLM 心跳检测到卡住时，仍更新 progress ref 避免 heartbeat 恢复后误报
          if (currentProgress !== lastProgressValue) {
            lastProgressValue = currentProgress
            lastProgressChangedAt = Date.now()
          }
        }

        if (isStale && !staleWarned) {
          staleWarned = true
          setStaleWarning(true)
          const thresholdMin = STALE_THRESHOLD_MS / 60000
          message.warning(`生成可能卡住：LLM 已 ${thresholdMin} 分钟无活动，建议检查网络或取消重试`)
        } else if (!isStale && staleWarned) {
          // 恢复：LLM 心跳更新或 progress 变化 → 清除卡住提示
          staleWarned = false
          setStaleWarning(false)
        }

        // 2026-07-17: 同步大纲/章节元数据（生成过程中可实时看到章节完成情况）
        if (r.outlineText) setOutlineText(r.outlineText)
        if (r.outlineDebate) setOutlineDebate(r.outlineDebate)
        // 2026-07-18: 同步大纲修订标记
        if (r.outlineRevised !== undefined && r.outlineRevised !== null) setOutlineRevised(!!r.outlineRevised)
        if (r.sectionsJson) {
          try {
            const parsed = JSON.parse(r.sectionsJson)
            if (Array.isArray(parsed)) setSections(parsed)
          } catch (e) { /* 忽略 JSON 解析错误 */ }
        }
        if (r.status === 'done') {
          setReport(r.generatedReport || '')
          setGenStatus('done'); setGenerating(false)
          // C4/C5/E3/E4: 生成完成时清理卡住提示 + resumeBatch（后端已清零，前端同步）
          // generationMeta 保留（done 状态展示用）
          setStaleWarning(false); setResumeBatch(0); setLastLlmActivityAt(null)
          message.success('报告生成完成')
          fetchHistory()  // 刷新左侧列表状态
        } else if (r.status === 'cancelled') {
          setGenStatus('cancelled'); setGenerating(false)
          setStaleWarning(false); setResumeBatch(0); setLastLlmActivityAt(null)
          message.warning('生成已取消')
          fetchHistory()
        } else if (r.status === 'draft') {
          // 生成失败（后端异常时回退到 draft）
          // 宽容期：前 2 次轮询（pollCount<=2，约 10s）跳过，避免启动竞态误判
          if (pollCount <= 2) {
            console.warn(`[poll] status=draft but in grace period (poll ${pollCount}/2), skip`)
            return
          }
          setGenStatus('failed'); setGenerating(false)
          setStaleWarning(false); setResumeBatch(0); setLastLlmActivityAt(null)
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
  }, [genStatus, researchId, activeTab])

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

  // 2026-07-17: 导出为 Word 文档（.doc，纯 HTML→Blob 方式，无需第三方库）。
  // Word 能识别 HTML 格式的 .doc 文件，通过 MIME 类型 application/msword 触发下载。
  // 报告已是 markdown 风格（## 标题 + 正文），这里做简单的 markdown→HTML 转换：
  //   - # 标题 → <h1>
  //   - ## 标题 → <h2>
  //   - ### 标题 → <h3>
  //   - 引用标注【资料N｜标题】→ 加粗保留
  //   - 其他行 → <p>
  const exportToWord = () => {
    if (!report) { message.warning('报告尚未生成'); return }
    // markdown → HTML（简化版，只处理标题和段落）
    const lines = report.split('\n')
    const htmlParts = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) { htmlParts.push(''); continue }
      if (trimmed.startsWith('### ')) {
        htmlParts.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`)
      } else if (trimmed.startsWith('## ')) {
        htmlParts.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`)
      } else if (trimmed.startsWith('# ')) {
        htmlParts.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`)
      } else {
        // 段落正文 — 保留引用标注的加粗样式
        const withRefs = escapeHtml(trimmed).replace(
          /【资料([^】]+)】/g,
          '<b>【资料$1】</b>'
        )
        htmlParts.push(`<p style="line-height:1.8;">${withRefs}</p>`)
      }
    }
    const title = topic || '学术研究报告'
    const fullHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: '宋体', SimSun, serif; font-size: 12pt; }
    h1 { font-size: 22pt; color: #2c2c2c; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
    h2 { font-size: 16pt; color: #b87346; margin-top: 24px; }
    h3 { font-size: 13pt; color: #555; margin-top: 18px; }
    p { text-indent: 2em; margin: 8px 0; }
  </style>
</head>
<body>
  ${htmlParts.join('\n  ')}
</body>
</html>`
    // Blob → 下载
    const blob = new Blob(['\ufeff' + fullHtml], { type: 'application/msword;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    // 文件名：主题前 30 字 + 日期
    const dateStr = new Date().toISOString().slice(0, 10)
    const safeName = title.replace(/[\\/:*?"<>|]/g, '').slice(0, 30)
    link.download = `${safeName}_${dateStr}.doc`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    message.success('Word 文档已导出')
  }

  // HTML 转义（防 XSS + 保证 Word 解析正确）
  const escapeHtml = (str) => {
    if (!str) return ''
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
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
        // 2026-07-20 C5: 同步 resumeBatch（切换历史记录时恢复"已自动续做第 N 批"展示）
        setResumeBatch(r.resumeBatch || 0)
        // 2026-07-20 E3/E4: 同步 LLM 心跳 + 生成元数据
        setLastLlmActivityAt(r.lastLlmActivityAt || null)
        setGenerationMeta(r.generationMeta || null)
        // 2026-07-20 C4: 切换历史记录时重置卡住提示（由轮询逻辑重新检测）
        setStaleWarning(false)
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
        // 2026-07-17: 恢复大纲/章节元数据
        setOutlineText(r.outlineText || '')
        setOutlineDebate(r.outlineDebate || '')
        // 2026-07-18: 恢复大纲修订标记
        setOutlineRevised(!!r.outlineRevised)
        if (r.sectionsJson) {
          try {
            const parsed = JSON.parse(r.sectionsJson)
            setSections(Array.isArray(parsed) ? parsed : [])
          } catch (e) { setSections([]) }
        } else {
          setSections([])
        }
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
        /* 2026-07-20 P3-2: 响应式断点 — 窄屏下 4 卡片网格降为 2 列，避免描述文案被挤压 */
        @media (max-width: 1280px) {
          .arp-rtype-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 720px) {
          .arp-rtype-grid { grid-template-columns: 1fr !important; }
        }
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
          style={{ maxWidth: 1700, margin: '0 auto', padding: '36px 40px 80px' }}
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
            <div className="arp-rtype-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
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
                  display: 'flex',
                  // 2026-07-20 P1-2: 高度从固定 420px 改为自适应 — 小屏不拥挤，大屏充分利用
                  // minHeight 保底避免内容过少时塌陷，maxHeight 避免占满整屏遮挡后续步骤
                  minHeight: 420,
                  maxHeight: 'calc(100vh - 280px)',
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
            {/* 2026-07-18: 支持用户自定义模板 — 末尾"+"按钮新增，自定义模板带"自定义"徽标+删除按钮 */}
            {templates.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    报告结构模板
                  </span>
                  <Tooltip title="不同模板对应不同的章节结构和分析方法，选择后 LLM 会按此结构生成">
                    <span style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10 }}>选择生成结构</span>
                  </Tooltip>
                  <Tooltip title="保存为自定义模板，以后在该任务类型下可复用">
                    <Button size="small" type="text" icon={<PlusOutlined />} onClick={openNewTemplateModal}
                      style={{ color: 'var(--ab-copper)', fontSize: 10, padding: '0 4px', marginLeft: 'auto' }}>
                      添加自定义模板
                    </Button>
                  </Tooltip>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {templates.map(tpl => {
                    const selected = templateId === tpl.id
                    const isCustom = tpl.isCustom === true
                    const isDeleting = deletingTplId === tpl.id
                    return (
                      <div key={tpl.id} style={{ position: 'relative' }}>
                        <button onClick={() => setTemplateId(tpl.id)}
                          style={{
                            cursor: 'pointer', textAlign: 'left', width: '100%',
                            background: selected ? 'var(--ab-surface-2)' : 'var(--ab-bg-2)',
                            border: selected ? '1px solid var(--ab-copper)' : '1px solid var(--ab-line)',
                            borderRadius: 6, padding: '12px 14px', transition: 'all .2s',
                            position: 'relative',
                          }}>
                          {/* 选中标识（自定义模板不显示选中圈，改用左上角徽标） */}
                          {selected && !isCustom && (
                            <span style={{ position: 'absolute', top: 8, right: 8,
                              width: 14, height: 14, borderRadius: '50%',
                              background: 'var(--ab-copper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <CheckOutlined style={{ fontSize: 8, color: 'var(--ab-bg)' }} />
                            </span>
                          )}
                          {/* 自定义模板徽标 */}
                          {isCustom && (
                            <span style={{ position: 'absolute', top: 6, left: 6,
                              ...mono, fontSize: 8, color: 'var(--ab-copper)',
                              border: '1px solid var(--ab-copper)', borderRadius: 3,
                              padding: '1px 4px', letterSpacing: '0.05em' }}>
                              自定义
                            </span>
                          )}
                          {/* 自定义模板选中标识 */}
                          {selected && isCustom && (
                            <span style={{ position: 'absolute', top: 8, right: 8,
                              width: 14, height: 14, borderRadius: '50%',
                              background: 'var(--ab-copper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <CheckOutlined style={{ fontSize: 8, color: 'var(--ab-bg)' }} />
                            </span>
                          )}
                          <div style={{ ...serif, fontSize: 14, fontWeight: 500, color: selected ? 'var(--ab-text)' : 'var(--ab-text-2)', marginBottom: 4, paddingRight: 18, marginTop: isCustom ? 14 : 0 }}>
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
                        {/* 自定义模板右上角删除按钮 */}
                        {isCustom && (
                          <Tooltip title={isDeleting ? '删除中…' : '删除此自定义模板'}>
                            <button
                              onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                              disabled={isDeleting}
                              style={{
                                position: 'absolute', top: 4, right: 4, width: 20, height: 20,
                                borderRadius: '50%', border: 'none', cursor: isDeleting ? 'wait' : 'pointer',
                                background: isDeleting ? 'var(--ab-bg-3)' : 'rgba(184,115,70,0.12)',
                                color: 'var(--ab-copper)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: 0, transition: 'all .2s',
                              }}
                              onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.background = 'var(--ab-copper)' }}
                              onMouseLeave={(e) => { if (!isDeleting) e.currentTarget.style.background = 'rgba(184,115,70,0.12)' }}
                            >
                              <DeleteOutlined style={{ fontSize: 10, color: isDeleting ? 'var(--ab-text-4)' : 'inherit' }} />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 2026-07-18: 自定义模板创建弹窗 */}
            <Modal
              title="添加自定义模板"
              open={tplModalOpen}
              onOk={handleSaveTemplate}
              onCancel={() => setTplModalOpen(false)}
              okText={savingTpl ? '保存中…' : '保存'}
              cancelText="取消"
              confirmLoading={savingTpl}
              okButtonProps={{ disabled: savingTpl || !newTplName.trim() }}
              width={560}
            >
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...mono, color: 'var(--ab-text-3)', fontSize: 11, marginBottom: 6 }}>模板名称 *</div>
                <Input
                  value={newTplName}
                  onChange={(e) => setNewTplName(e.target.value)}
                  placeholder="如：我的五段式教案 / 实验探究式教案"
                  maxLength={50}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...mono, color: 'var(--ab-text-3)', fontSize: 11, marginBottom: 6 }}>模板说明</div>
                <Input
                  value={newTplDesc}
                  onChange={(e) => setNewTplDesc(e.target.value)}
                  placeholder="一句话描述适用场景，如：适用于理科实验课，强调探究过程"
                  maxLength={120}
                />
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ ...mono, color: 'var(--ab-text-3)', fontSize: 11, marginBottom: 6 }}>
                  章节结构 * <span style={{ color: 'var(--ab-text-4)' }}>（一行一个章节，按顺序生成）</span>
                </div>
                <TextArea
                  value={newTplStructure}
                  onChange={(e) => setNewTplStructure(e.target.value)}
                  placeholder={'一、教学目标\n二、教学重点与难点\n三、教学过程\n四、作业设计\n五、参考来源'}
                  autoSize={{ minRows: 5, maxRows: 12 }}
                  style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 12 }}
                />
              </div>
              <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, marginTop: 8, lineHeight: 1.6 }}>
                提示：模板保存后，会在当前任务类型「{currentConfig?.label || ''}」下显示，带"自定义"徽标，可随时删除。
                生成报告时 LLM 会严格按照您定义的章节结构生成。
              </div>
            </Modal>

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
                whileHover={canGenerate ? { scale: 1.01 } : {}}
                whileTap={canGenerate ? { scale: 0.99 } : {}}
                onClick={handleGenerate} disabled={!canGenerate}
                style={{
                  cursor: canGenerate ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: canGenerate ? 'var(--ab-copper)' : 'var(--ab-bg-3)',
                  border: 'none', borderRadius: 6, padding: '14px 28px',
                  color: canGenerate ? 'var(--ab-bg)' : 'var(--ab-text-4)',
                  ...serif, fontSize: 17, fontWeight: 500, letterSpacing: '0.01em',
                  transition: 'all .25s', boxShadow: canGenerate ? 'var(--ab-shadow-glow)' : 'none',
                }}>
                <FileTextOutlined style={{ fontSize: 16 }} />
                {genStatus === 'cancelled' ? '重新生成' : currentConfig.btnLabel}
                <ArrowRightOutlined style={{ fontSize: 13, marginLeft: 2 }} />
              </motion.button>
            )}

            {/* 2026-07-17: 前置条件未满足时展示拦截原因，引导用户先完成搜索 */}
            {!generating && generateBlockReason && (
              <div style={{
                marginTop: 12, padding: '10px 14px',
                background: 'var(--ab-bg-2)', border: '1px dashed var(--ab-line)',
                borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
                ...mono, fontSize: 11, color: 'var(--ab-text-3)',
              }}>
                <span style={{ color: 'var(--ab-copper)', fontSize: 13 }}>⏳</span>
                <span>{generateBlockReason}</span>
              </div>
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
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      {/* 2026-07-20 P3-1: resumeBatch 徽标从副标题行移到百分比左侧独立显示
                          避免副标题行高随批次切换抖动；保持 AnimatePresence 数字淡入淡出 */}
                      <AnimatePresence mode="wait">
                        {resumeBatch > 0 && (
                          <motion.span
                            key={resumeBatch}
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.85 }}
                            transition={{ duration: 0.2 }}
                            title={`自动续做第 ${resumeBatch} 批次 · 当前进度 ${progress}% · 长篇小说分批生成避免单次超时`}
                            style={{
                              ...mono, fontSize: 10, fontWeight: 500,
                              color: 'var(--ab-copper-2)',
                              padding: '2px 8px', borderRadius: 3,
                              background: 'var(--ab-copper-glow)',
                              border: '1px solid var(--ab-copper)',
                              cursor: 'help', fontVariantNumeric: 'tabular-nums',
                              letterSpacing: '0.05em', whiteSpace: 'nowrap',
                            }}
                          >
                            续做第 {resumeBatch} 批
                          </motion.span>
                        )}
                      </AnimatePresence>
                      <div style={{ ...mono, color: 'var(--ab-copper)', fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                        {progress}%
                      </div>
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
                  {/* 2026-07-20 C4: 卡住检测提示（progress 长时间无变化时显示） */}
                  {/* 2026-07-20 D2: 阈值根据 reportType 动态（小说 20 分钟 / 其他 10 分钟） */}
                  {staleWarning && (
                    <div style={{
                      marginTop: 10, padding: '8px 12px',
                      background: 'rgba(220, 120, 50, 0.08)', border: '1px solid rgba(220, 120, 50, 0.3)',
                      borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ color: 'var(--ab-copper)', fontSize: 13, fontWeight: 500 }}>⚠ 生成可能卡住</span>
                      <span style={{ ...mono, color: 'var(--ab-text-3)', fontSize: 10 }}>
                        进度已 {activeTab === 'novel' ? '20' : '10'} 分钟无变化，建议检查网络或点击"取消生成"后重试
                      </span>
                    </div>
                  )}
                  {/* 取消提示 */}
                  <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, marginTop: 12, textAlign: 'center' }}>
                    支持长文档多段落生成 · 可随时取消（当前 LLM 调用完成后生效）
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 2026-07-20 E4+F3: done 状态生成元数据展示（自动续做次数 + 总耗时 + 章节数 + 配置快照） */}
            <AnimatePresence>
              {genStatus === 'done' && !generating && generationMeta && (() => {
                try {
                  const meta = typeof generationMeta === 'string' ? JSON.parse(generationMeta) : generationMeta
                  if (meta && (meta.totalResumeCount > 0 || meta.totalChapters > 0)) {
                    const isNovel = meta.reportType === 'novel'
                    const resumeText = meta.totalResumeCount > 0
                      ? `自动续做 ${meta.totalResumeCount} 次`
                      : '一次性生成'
                    const chapterText = meta.totalChapters > 0
                      ? ` · ${meta.totalChapters} 章`
                      : ''
                    const lengthText = meta.reportLength > 0
                      ? ` · ${(meta.reportLength / 10000).toFixed(1)} 万字`
                      : ''
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        title={meta.config ? `配置快照：单次最多 ${meta.config.chaptersPerSession} 章 / 最大重试 ${meta.config.maxResumeRetry} / 分层生成 ${meta.config.hierarchicalEnabled ? '开启' : '关闭'}${meta.config.hierarchicalEnabled ? `（阈值 ${meta.config.hierarchicalThreshold} 章）` : ''}` : ''}
                        style={{
                          marginTop: 20, padding: '14px 18px',
                          background: 'var(--ab-surface-2)', border: '1px solid var(--ab-line)',
                          borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, cursor: 'help',
                        }}>
                        <span style={{ color: 'var(--ab-copper)', fontSize: 14 }}>✓</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ ...serif, color: 'var(--ab-text-2)', fontSize: 13, fontWeight: 500 }}>
                            {isNovel ? '小说' : '报告'}生成完成 · {resumeText} · 总耗时 {meta.totalDurationMin || 0} 分钟
                          </div>
                          <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, marginTop: 2 }}>
                            {chapterText}{lengthText}
                            {meta.totalResumeCount > 0 && ` · 分批生成避免单次超时`}
                            {meta.config && ` · 配置: ${meta.config.chaptersPerSession} 章/批`}
                          </div>
                        </div>
                      </motion.div>
                    )
                  }
                } catch (e) { /* JSON 解析失败忽略 */ }
                return null
              })()}
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
                    {/* 报告页眉 — 2026-07-20 P2-2: sticky 让长报告滚动后仍可操作复制/导出 */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '16px 28px', borderBottom: '1px solid var(--ab-line)',
                      background: 'var(--ab-bg-2)',
                      position: 'sticky', top: 0, zIndex: 10,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 16, color: 'var(--ab-copper)' }}><FileTextOutlined /></span>
                        <span style={{ ...serif, fontSize: 16, fontWeight: 500, color: 'var(--ab-text)' }}>
                          {currentConfig.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button size="small" icon={<CopyOutlined />}
                          onClick={() => navigator.clipboard.writeText(report).then(() => message.success('已复制'))}
                          style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', borderColor: 'var(--ab-line)' }}>
                          复制
                        </Button>
                        {/* 2026-07-17: 导出 Word 文档（纯 HTML→Blob 方式，无外部依赖） */}
                        <Button size="small" icon={<FileTextOutlined />}
                          onClick={() => exportToWord()}
                          disabled={!report}
                          style={{ ...mono, fontSize: 11, color: 'var(--ab-copper)', borderColor: 'var(--ab-copper)', background: 'transparent' }}>
                          导出 Word
                        </Button>
                      </div>
                    </div>
                    {/* 报告正文 — 左侧大纲 + 右侧章节正文（2026-07-17 分块显示） */}
                    <ReportBody
                      report={report}
                      outlineText={outlineText}
                      outlineDebate={outlineDebate}
                      outlineRevised={outlineRevised}
                      sections={sections}
                      researchId={researchId}
                      genStatus={genStatus}
                      onOutlineUpdated={(text) => setOutlineText(text)}
                      onSectionsUpdated={(newSections, newReport) => {
                        setSections(newSections)
                        if (newReport) setReport(newReport)
                      }}
                    />
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

// ── 报告正文组件 ──────────────────────────────────────────────
// 2026-07-17: 将报告拆分为"左侧大纲 + 右侧章节正文"两栏布局。
// 优先使用后端持久化的 sections（含 title/outline/draft/debate/refined），
// 兜底从 report 文本中正则切分 ## 章节。
// - 顶部展示大纲（可编辑） + 大纲评审意见
// - 每个章节：主标题 + refined 正文 + 折叠面板显示 draft/debate

// 2026-07-18: 修订方式徽标配色 + 文案
// revise_method 值：two-step / single-call / debate-failed / subsection / subsection-retry
const REVISE_METHOD_META = {
  'two-step':         { label: '两步ReAct', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.12)' },     // 绿色：理想路径
  'single-call':      { label: '单次降级', color: '#d97706', bg: 'rgba(217, 119, 6, 0.12)' },     // 橙色：降级路径
  'debate-failed':    { label: '未修订',   color: '#dc2626', bg: 'rgba(220, 38, 38, 0.12)' },     // 红色：失败
  'subsection':       { label: '子小节',   color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)' },     // 蓝色：子小节路径
  'subsection-retry': { label: '拆分重试', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)' },    // 紫色：截断重试
}
function reviseMethodLabel(m) { return (REVISE_METHOD_META[m] || { label: m }).label }
function reviseMethodColor(m) { return (REVISE_METHOD_META[m] || { color: 'var(--ab-text-4)' }).color }
function reviseMethodBg(m)    { return (REVISE_METHOD_META[m] || { bg: 'rgba(0,0,0,0.04)' }).bg }

function ReportBody({ report, outlineText, outlineDebate, outlineRevised, sections: sectionsFromProps, researchId, genStatus, onOutlineUpdated, onSectionsUpdated }) {
  const serif = { fontFamily: 'var(--ab-font-display)' }
  const mono = { fontFamily: 'var(--ab-font-mono)' }
  const body = { fontFamily: 'var(--ab-font-body)' }
  const sectionRefs = React.useRef({})
  const [editingOutline, setEditingOutline] = React.useState(false)
  const [editedOutline, setEditedOutline] = React.useState('')
  const [savingOutline, setSavingOutline] = React.useState(false)
  // 章节思考过程展开状态：key=sectionIdx, value=Record<"draft"|"debate", boolean>
  const [expandedProcess, setExpandedProcess] = React.useState({})
  // 2026-07-17: 段落编辑模式 — key=sectionIdx, value={ editing: bool, editedText: string, saving: bool }
  const [sectionEditState, setSectionEditState] = React.useState({})
  // 2026-07-17: LLM 校准输入 — key=sectionIdx, value={ hint: string, regenerating: bool }
  const [sectionRegenState, setSectionRegenState] = React.useState({})
  // 2026-07-19: 段落级扩展 — key=`${sectionIdx}-${paraIdx}`, value={ showInput, hint, expanding }
  const [paragraphExpandState, setParagraphExpandState] = React.useState({})

  // 2026-07-17: 优先使用后端持久化的 sections（含 draft/debate/refined 完整元数据），
  // 兜底从 report 文本中按 ## 切分章节（保持向后兼容旧报告）。
  const sections = useMemo(() => {
    if (sectionsFromProps && sectionsFromProps.length > 0) {
      return sectionsFromProps.map((s, i) => ({
        idx: i,
        title: s.title || `章节 ${i + 1}`,
        outline: s.outline || '',
        draft: s.draft || '',
        debate: s.debate || '',
        refined: s.refined || '',
        // 2026-07-18: hasProcess 扩展 — subsection 路径下父章节 draft/debate 虽为空，
        // 但有子小节详情可展示，也标记为 true，让"思考过程"折叠面板可见，
        // 内部会根据 reviseMethod='subsection' 渲染子小节聚合提示。
        hasProcess: !!(s.draft || s.debate || (s.subsections && s.subsections.length > 0)),
        // 2026-07-18: 修订方式 + 一致性校验元数据
        reviseMethod: s.revise_method || '',         // two-step / single-call / debate-failed / subsection / subsection-retry
        similarity: s.similarity,                    // 0.0-1.0
        consistency: s.consistency_check || '',      // normal / low_revision / high_revision / skipped
        subsections: s.subsections || [],            // 子小节元数据数组
        // 2026-07-19: 段落级扩展历史 — [{ para_idx, original, debate, refined, expand_hint, expanded_at }]
        paragraphs: s.paragraphs || [],
        // 2026-07-19: 段落级扩展预览 — { "paraIdx": { original, expanded, debate, expand_hint, created_at } }
        // 存在则该段落进入预览态，显示扩展后内容 + 保存/取消按钮
        pendingParagraphExpands: s.pendingParagraphExpands || {},
      }))
    }
    if (!report) return []
    const lines = report.split('\n')
    const out = []
    let current = null
    for (const line of lines) {
      const m = line.match(/^##\s+(.+?)\s*$/)
      if (m) {
        if (current) out.push(current)
        current = { title: m[1].trim(), body: '' }
      } else if (current) {
        current.body += line + '\n'
      }
    }
    if (current) out.push(current)
    return out.map((s, i) => ({
      idx: i, title: s.title,
      outline: '', draft: '', debate: '',
      refined: s.body.trim(),
      hasProcess: false,
    }))
  }, [report, sectionsFromProps])

  const scrollToSection = (i) => {
    const el = sectionRefs.current[`section-${i}`]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const toggleProcess = (i, kind) => {
    setExpandedProcess(prev => ({
      ...prev,
      [i]: { ...(prev[i] || {}), [kind]: !(prev[i] || {})[kind] },
    }))
  }

  const startEditOutline = () => {
    setEditedOutline(outlineText || '')
    setEditingOutline(true)
  }

  const cancelEditOutline = () => {
    setEditingOutline(false)
    setEditedOutline('')
  }

  const saveOutline = async () => {
    if (!researchId) return
    if (!editedOutline.trim()) { message.warning('大纲不能为空'); return }
    setSavingOutline(true)
    try {
      const res = await api.put(`/academic/research/${researchId}/outline`, {
        outline_text: editedOutline.trim(),
      })
      if (res.data?.updated) {
        onOutlineUpdated(editedOutline.trim())
        setEditingOutline(false)
        message.success('大纲已保存。点击"生成文档"将按新大纲重新生成。')
      } else {
        message.error('保存失败')
      }
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setSavingOutline(false)
    }
  }

  // 2026-07-17: 段落直接编辑 — 进入/取消/保存
  const startEditSection = (idx, currentText) => {
    setSectionEditState(prev => ({
      ...prev,
      [idx]: { editing: true, editedText: currentText, saving: false },
    }))
  }

  const cancelEditSection = (idx) => {
    setSectionEditState(prev => {
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }

  const saveSection = async (idx) => {
    if (!researchId) return
    const st = sectionEditState[idx]
    if (!st || !st.editedText || !st.editedText.trim()) {
      message.warning('段落内容不能为空')
      return
    }
    setSectionEditState(prev => ({
      ...prev,
      [idx]: { ...prev[idx], saving: true },
    }))
    try {
      const res = await api.put(`/academic/research/${researchId}/sections/${idx}`, {
        refined: st.editedText,
      })
      if (res.data?.updated) {
        // 后端返回 sections（JSON 字符串）+ 新 report
        let newSections = []
        try {
          newSections = JSON.parse(res.data.sections)
        } catch (e) { /* ignore */ }
        onSectionsUpdated(newSections, res.data.report)
        // 退出编辑模式
        setSectionEditState(prev => {
          const next = { ...prev }
          delete next[idx]
          return next
        })
        message.success('段落已保存')
      } else {
        message.error('保存失败')
      }
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setSectionEditState(prev => ({
        ...prev,
        [idx]: prev[idx] ? { ...prev[idx], saving: false } : prev[idx],
      }))
    }
  }

  // 2026-07-17: LLM 校准 — 基于用户提示重新生成段落
  const regenerateSection = async (idx) => {
    if (!researchId) return
    const st = sectionRegenState[idx]
    if (!st || !st.hint || !st.hint.trim()) {
      message.warning('请输入修改点提示')
      return
    }
    setSectionRegenState(prev => ({
      ...prev,
      [idx]: { ...prev[idx], regenerating: true },
    }))
    try {
      const res = await api.post(`/academic/research/${researchId}/sections/${idx}/regenerate`, {
        user_hint: st.hint.trim(),
      })
      if (res.data?.regenerated) {
        let newSections = []
        try {
          newSections = JSON.parse(res.data.sections)
        } catch (e) { /* ignore */ }
        onSectionsUpdated(newSections, res.data.report)
        // 2026-07-17: 同步更新编辑器中的 editedText 为 LLM 重写后的新内容
        // 这样用户可以在编辑器中继续微调，或直接点保存
        const newRefined = newSections[idx]?.refined || ''
        if (newRefined) {
          setSectionEditState(prev => ({
            ...prev,
            [idx]: { ...prev[idx], editedText: newRefined },
          }))
        }
        // 清空 LLM 校准输入框（保留编辑模式，让用户检查后再保存）
        setSectionRegenState(prev => ({
          ...prev,
          [idx]: { hint: '', regenerating: false },
        }))
        message.success('LLM 已校准段落 ' + (idx + 1) + '，请检查后点击"保存"')
      } else {
        message.error('LLM 校准失败')
      }
    } catch (e) {
      message.error('LLM 校准失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setSectionRegenState(prev => ({
        ...prev,
        [idx]: prev[idx] ? { ...prev[idx], regenerating: false } : prev[idx],
      }))
    }
  }

  // 2026-07-19: 段落级扩展 — 对指定章节的指定段落做 ReAct 闭环扩展
  // key=`${sectionIdx}-${paraIdx}` → state={ showInput, hint, expanding }
  const toggleParagraphExpandInput = (sectionIdx, paraIdx) => {
    const key = `${sectionIdx}-${paraIdx}`
    setParagraphExpandState(prev => ({
      ...prev,
      [key]: prev[key]
        ? { ...prev[key], showInput: !prev[key].showInput }
        : { showInput: true, hint: '', expanding: false },
    }))
  }

  const setParagraphExpandHint = (sectionIdx, paraIdx, hint) => {
    const key = `${sectionIdx}-${paraIdx}`
    setParagraphExpandState(prev => ({
      ...prev,
      [key]: { ...(prev[key] || { showInput: true }), hint },
    }))
  }

  const cancelParagraphExpandInput = (sectionIdx, paraIdx) => {
    const key = `${sectionIdx}-${paraIdx}`
    setParagraphExpandState(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const expandParagraph = async (sectionIdx, paraIdx) => {
    if (!researchId) return
    const key = `${sectionIdx}-${paraIdx}`
    const st = paragraphExpandState[key] || { showInput: true, hint: '' }
    setParagraphExpandState(prev => ({
      ...prev,
      [key]: { ...st, expanding: true },
    }))
    try {
      const body = {}
      if (st.hint && st.hint.trim()) body.expand_hint = st.hint.trim()
      const res = await api.post(
        `/academic/research/${researchId}/sections/${sectionIdx}/paragraphs/${paraIdx}/expand`,
        body,
      )
      if (res.data?.expanded) {
        let newSections = []
        try {
          newSections = JSON.parse(res.data.sections)
        } catch (e) { /* ignore */ }
        // 2026-07-19: 扩展结果进入 pending 预览态，不更新 report（commit 时才更新）
        onSectionsUpdated(newSections, undefined)
        message.success(`已生成扩展预览，请确认保存或取消`)
        // 清理输入框状态
        setParagraphExpandState(prev => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      } else {
        message.error('段落扩展失败')
      }
    } catch (e) {
      message.error('段落扩展失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setParagraphExpandState(prev => ({
        ...prev,
        [key]: prev[key] ? { ...prev[key], expanding: false } : prev[key],
      }))
    }
  }

  // 2026-07-19: 提交段落扩展 — 把 pending 扩展结果应用到 refined，记录历史，重写 report
  const commitParagraphExpand = async (sectionIdx, paraIdx) => {
    if (!researchId) return
    const key = `${sectionIdx}-${paraIdx}`
    setParagraphExpandState(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), committing: true },
    }))
    try {
      const res = await api.post(
        `/academic/research/${researchId}/sections/${sectionIdx}/paragraphs/${paraIdx}/commit`,
      )
      if (res.data?.committed) {
        let newSections = []
        try {
          newSections = JSON.parse(res.data.sections)
        } catch (e) { /* ignore */ }
        onSectionsUpdated(newSections, res.data.report)
        message.success(`已保存章节 ${sectionIdx + 1} 段落 ${paraIdx + 1} 的扩展`)
      } else {
        message.error('保存扩展失败')
      }
    } catch (e) {
      message.error('保存扩展失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setParagraphExpandState(prev => ({
        ...prev,
        [key]: prev[key] ? { ...prev[key], committing: false } : prev[key],
      }))
    }
  }

  // 2026-07-19: 取消段落扩展 — 清除 pending，原 refined 不变
  const cancelPendingParagraphExpand = async (sectionIdx, paraIdx) => {
    if (!researchId) return
    const key = `${sectionIdx}-${paraIdx}`
    setParagraphExpandState(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), cancelling: true },
    }))
    try {
      const res = await api.post(
        `/academic/research/${researchId}/sections/${sectionIdx}/paragraphs/${paraIdx}/cancel`,
      )
      if (res.data?.cancelled) {
        let newSections = []
        try {
          newSections = JSON.parse(res.data.sections)
        } catch (e) { /* ignore */ }
        onSectionsUpdated(newSections, undefined)
        message.info(`已取消扩展，恢复原内容`)
      } else {
        message.error('取消扩展失败')
      }
    } catch (e) {
      message.error('取消扩展失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setParagraphExpandState(prev => ({
        ...prev,
        [key]: prev[key] ? { ...prev[key], cancelling: false } : prev[key],
      }))
    }
  }

  if (sections.length === 0 && !outlineText) {
    // 兜底：未识别到任何 ## 章节且无大纲，直接显示原文
    return (
      <div style={{ padding: '28px 32px', maxWidth: 760 }}>
        <div style={{
          ...body, fontSize: 14.5, color: 'var(--ab-text)', lineHeight: 1.9,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }} className="prose">
          {report}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ── 顶部：可编辑大纲 + 评审意见 ── */}
      {(outlineText || outlineDebate) && (
        <div style={{
          borderBottom: '1px solid var(--ab-line)',
          padding: '20px 32px',
          background: 'var(--ab-bg-2)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{
              ...mono, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
              color: 'var(--ab-text-4)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>· 报告大纲（{editingOutline ? '编辑中' : '可编辑'}）·</span>
              {/* 2026-07-18: 已按评审修订徽标 */}
              {outlineRevised && !editingOutline && (
                <span style={{
                  ...mono, fontSize: 9, color: '#16a34a',
                  padding: '1px 6px',
                  background: 'rgba(22, 163, 74, 0.12)', borderRadius: 2,
                  letterSpacing: '0.1em',
                }}>
                  已按评审修订
                </span>
              )}
            </div>
            {!editingOutline && outlineText && genStatus !== 'generating' && (
              <Button size="small" onClick={startEditOutline}
                style={{ ...mono, fontSize: 10, color: 'var(--ab-copper)',
                  borderColor: 'var(--ab-copper)', background: 'transparent' }}>
                编辑大纲
              </Button>
            )}
          </div>
          {editingOutline ? (
            <div>
              <TextArea
                value={editedOutline}
                onChange={e => setEditedOutline(e.target.value)}
                autoSize={{ minRows: 8, maxRows: 20 }}
                style={{ ...body, fontSize: 13, background: 'var(--ab-bg-3)',
                  color: 'var(--ab-text)', border: '1px solid var(--ab-copper)' }}
              />
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <Button type="primary" size="small" onClick={saveOutline} loading={savingOutline}
                  style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' }}>
                  保存大纲
                </Button>
                <Button size="small" onClick={cancelEditOutline}
                  style={{ ...mono, fontSize: 11 }}>
                  取消
                </Button>
                <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)',
                  marginLeft: 'auto', alignSelf: 'center' }}>
                  保存后需重新点击"生成文档"才能按新大纲重生成
                </span>
              </div>
            </div>
          ) : (
            <div style={{
              ...body, fontSize: 13, color: 'var(--ab-text)', lineHeight: 1.8,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 240, overflowY: 'auto',
              padding: '8px 12px', background: 'var(--ab-bg-3)', borderRadius: 4,
            }}>
              {outlineText || '（无大纲）'}
            </div>
          )}
          {/* 大纲评审意见 */}
          {outlineDebate && !editingOutline && (
            <div style={{ marginTop: 14 }}>
              <div style={{
                ...mono, fontSize: 10, color: 'var(--ab-copper)',
                letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 6,
              }}>
                ◇ 评审意见
              </div>
              <div style={{
                ...body, fontSize: 12.5, color: 'var(--ab-text-2)', lineHeight: 1.7,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                padding: '8px 12px',
                background: 'rgba(184, 115, 70, 0.06)',
                borderLeft: '2px solid var(--ab-copper)',
                borderRadius: 2,
              }}>
                {outlineDebate}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 主区：左侧大纲 + 右侧章节正文 ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '260px 1fr', gap: 0,
        minHeight: 400,
      }}>
        {/* 左：书纲式大纲（可点击跳转） */}
        <div style={{
          borderRight: '1px solid var(--ab-line)',
          padding: '24px 18px',
          background: 'var(--ab-bg-2)',
          maxHeight: 900, overflowY: 'auto',
        }}>
          <div style={{
            ...mono, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
            color: 'var(--ab-text-4)', marginBottom: 16,
          }}>
            · 章节目录 ·
          </div>
          {sections.map(item => (
            <div key={item.idx} style={{ marginBottom: 4 }}>
              <div
                onClick={() => scrollToSection(item.idx)}
                style={{
                  cursor: 'pointer', padding: '8px 10px', borderRadius: 4,
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  transition: 'background .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ab-bg-3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{
                  ...mono, fontSize: 10, color: 'var(--ab-copper)', minWidth: 22,
                  paddingTop: 2, letterSpacing: '0.05em',
                }}>
                  {String(item.idx + 1).padStart(2, '0')}
                </span>
                <span style={{
                  ...serif, fontSize: 13.5, color: 'var(--ab-text)', lineHeight: 1.5,
                  fontWeight: 500,
                }}>
                  {item.title}
                </span>
                {item.hasProcess && (
                  <span style={{
                    ...mono, fontSize: 8.5, color: 'var(--ab-copper)',
                    marginLeft: 'auto', paddingTop: 2,
                  }} title="本章有思考过程可查看">◆</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 右：章节正文 — 每段卡片化。默认只显示正文，点击"编辑段落"进入编辑模式 */}
        <div style={{ padding: '32px 40px', overflow: 'hidden' }}>
          {sections.map((s, i) => {
            const exp = expandedProcess[i] || {}
            const editState = sectionEditState[i] || { editing: false, editedText: '', saving: false }
            const regenState = sectionRegenState[i] || { hint: '', regenerating: false }
            // 2026-07-17: 是否可用编辑（需要 researchId 且非生成中且后端持久化了 sections）
            const canEdit = !!researchId && genStatus !== 'generating' && sectionsFromProps && sectionsFromProps.length > 0
            const isEditing = editState.editing
            return (
              <div
                key={i}
                ref={el => sectionRefs.current[`section-${i}`] = el}
                style={{
                  marginBottom: 24, scrollMarginTop: 20,
                  background: 'var(--ab-bg)',
                  // 2026-07-17: 编辑模式下边框变铜色，非编辑模式保持浅边框
                  border: `1px solid ${isEditing ? 'var(--ab-copper)' : 'var(--ab-line)'}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                  boxShadow: isEditing ? '0 2px 8px rgba(184, 115, 70, 0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'border-color .15s, box-shadow .15s',
                }}
              >
                {/* 卡片头部：序号 + 标题 + 操作按钮 */}
                <div style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--ab-line)',
                  background: 'var(--ab-bg-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}>
                  <h2 style={{
                    ...serif, fontSize: 18, color: 'var(--ab-text)',
                    fontWeight: 500, margin: 0, letterSpacing: '-0.01em',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{
                      ...mono, fontSize: 10, color: 'var(--ab-copper)',
                      letterSpacing: '0.1em',
                      padding: '2px 6px', background: 'rgba(184, 115, 70, 0.1)',
                      borderRadius: 2,
                    }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s.title}
                    {isEditing && (
                      <span style={{
                        ...mono, fontSize: 9, color: 'var(--ab-copper)',
                        marginLeft: 8, padding: '1px 6px',
                        background: 'rgba(184, 115, 70, 0.15)', borderRadius: 2,
                      }}>
                        编辑中
                      </span>
                    )}
                    {/* 2026-07-18: 修订方式徽标 — 显示 revise_method + similarity + consistency */}
                    {!isEditing && s.reviseMethod && (
                      <span style={{
                        ...mono, fontSize: 9, marginLeft: 4, padding: '1px 6px',
                        color: reviseMethodColor(s.reviseMethod),
                        background: reviseMethodBg(s.reviseMethod),
                        borderRadius: 2, letterSpacing: '0.05em',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        {reviseMethodLabel(s.reviseMethod)}
                        {typeof s.similarity === 'number' && (
                          <span style={{ color: 'var(--ab-text-4)', marginLeft: 2 }}>
                            · sim {s.similarity.toFixed(2)}
                          </span>
                        )}
                        {s.consistency && s.consistency !== 'normal' && s.consistency !== 'skipped' && (
                          <span style={{
                            marginLeft: 2, padding: '0 4px',
                            color: s.consistency === 'low_revision' ? '#dc2626' : '#d97706',
                            background: s.consistency === 'low_revision' ? 'rgba(220, 38, 38, 0.1)' : 'rgba(217, 119, 6, 0.1)',
                            borderRadius: 2,
                          }}>
                            {s.consistency === 'low_revision' ? '修订不足' : '大幅重写'}
                          </span>
                        )}
                      </span>
                    )}
                  </h2>
                  {/* 2026-07-17: 非编辑模式显示"编辑段落"按钮；编辑模式显示"保存/取消" */}
                  {canEdit && !isEditing && (
                    <Button size="small"
                      onClick={() => startEditSection(i, s.refined || s.body || '')}
                      style={{ ...mono, fontSize: 10, color: 'var(--ab-text-3)',
                        borderColor: 'var(--ab-line)', background: 'transparent' }}>
                      编辑段落
                    </Button>
                  )}
                  {isEditing && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button type="primary" size="small"
                        onClick={() => saveSection(i)}
                        loading={editState.saving}
                        style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)',
                          ...mono, fontSize: 10 }}>
                        保存
                      </Button>
                      <Button size="small"
                        onClick={() => cancelEditSection(i)}
                        disabled={editState.saving}
                        style={{ ...mono, fontSize: 10 }}>
                        取消
                      </Button>
                    </div>
                  )}
                </div>

                {/* 卡片主体 */}
                <div style={{ padding: '20px' }}>
                  {!isEditing ? (
                    // ── 非编辑模式：只显示正文 + 思考过程折叠 ──
                    <>
                      {/* 2026-07-19: 段落级渲染 — 按 \n\n+ 切分，每段独立 <div> + hover 扩展按钮 */}
                      {(() => {
                        const rawText = stripThinking(s.refined || s.body) || ''
                        if (!rawText) return <div style={{ ...body, color: 'var(--ab-text-3)' }}>（本章暂无内容）</div>
                        // 按段落切分（与后端 \n\n+ 一致），保留原段落索引映射
                        const paragraphs = []
                        rawText.split(/\n\n+/).forEach((p) => {
                          if (p.trim()) paragraphs.push(p)
                        })
                        if (paragraphs.length === 0) {
                          return <div style={{ ...body, color: 'var(--ab-text-3)' }}>（本章暂无内容）</div>
                        }
                        return paragraphs.map((p, pIdx) => {
                          // subsection 路径下 ### 子标题段落不挂扩展按钮
                          const isSubsectionTitle = p.trim().startsWith('### ')
                          const expandKey = `${i}-${pIdx}`
                          const expandSt = paragraphExpandState[expandKey]
                          // 2026-07-19: 检查 pending 预览态 — 若存在则显示扩展后内容 + 保存/取消按钮
                          const pending = s.pendingParagraphExpands
                            ? s.pendingParagraphExpands[String(pIdx)]
                            : null
                          const displayText = pending ? stripThinking(pending.expanded || '') : p
                          return (
                            <div key={pIdx}
                              className="paragraph-block"
                              style={{
                                position: 'relative',
                                marginBottom: 12,
                                ...body, fontSize: 14.5, color: 'var(--ab-text)', lineHeight: 1.9,
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                paddingRight: isSubsectionTitle ? 0 : 28,
                                // 2026-07-19: pending 预览态高亮
                                background: pending ? 'rgba(22, 163, 74, 0.04)' : 'transparent',
                                borderLeft: pending ? '3px solid #16a34a' : 'none',
                                paddingLeft: pending ? 10 : 0,
                                borderRadius: pending ? 2 : 0,
                              }}
                              onMouseEnter={(e) => {
                                if (isSubsectionTitle || pending) return
                                e.currentTarget.style.background = 'rgba(184, 115, 70, 0.03)'
                              }}
                              onMouseLeave={(e) => {
                                if (isSubsectionTitle || pending) return
                                e.currentTarget.style.background = 'transparent'
                              }}>
                              {pending && (
                                <div style={{
                                  ...mono, fontSize: 9, color: '#16a34a',
                                  marginBottom: 6, letterSpacing: '0.1em',
                                  display: 'flex', alignItems: 'center', gap: 6,
                                }}>
                                  <span style={{
                                    padding: '1px 5px',
                                    background: 'rgba(22, 163, 74, 0.12)', borderRadius: 2,
                                  }}>
                                    扩展预览
                                  </span>
                                  <span style={{ color: 'var(--ab-text-4)' }}>
                                    原段落 {p.length} 字 → 扩展后 {(pending.expanded || '').length} 字
                                  </span>
                                </div>
                              )}
                              {displayText}
                              {!isSubsectionTitle && !pending && (
                                <button
                                  onClick={() => toggleParagraphExpandInput(i, pIdx)}
                                  title="扩展补充本段落"
                                  style={{
                                    position: 'absolute',
                                    top: 2,
                                    right: 2,
                                    width: 22, height: 22,
                                    border: '1px solid var(--ab-line)',
                                    borderRadius: 4,
                                    background: 'var(--ab-bg)',
                                    color: 'var(--ab-copper)',
                                    cursor: 'pointer',
                                    fontSize: 14, lineHeight: '20px',
                                    padding: 0,
                                    opacity: 0.6,
                                    transition: 'opacity 0.15s',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.opacity = 1 }}
                                  onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.6 }}>
                                  ＋
                                </button>
                              )}
                              {pending && (
                                <div style={{
                                  marginTop: 10, padding: '8px 10px',
                                  background: 'var(--ab-bg-2)',
                                  borderRadius: 2,
                                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                                }}>
                                  <span style={{
                                    ...mono, fontSize: 10, color: 'var(--ab-text-3)',
                                  }}>
                                    是否保存此扩展？保存后覆盖原段落，取消则恢复原内容。
                                  </span>
                                  <Button type="primary" size="small"
                                    onClick={() => commitParagraphExpand(i, pIdx)}
                                    loading={expandSt?.committing}
                                    style={{ background: '#16a34a', borderColor: '#16a34a',
                                      ...mono, fontSize: 10 }}>
                                    {expandSt?.committing ? '保存中…' : '保存扩展'}
                                  </Button>
                                  <Button size="small"
                                    onClick={() => cancelPendingParagraphExpand(i, pIdx)}
                                    loading={expandSt?.cancelling}
                                    disabled={expandSt?.committing}
                                    style={{ ...mono, fontSize: 10 }}>
                                    {expandSt?.cancelling ? '取消中…' : '取消，恢复原内容'}
                                  </Button>
                                </div>
                              )}
                              {expandSt?.showInput && !pending && (
                                <div style={{
                                  marginTop: 10, padding: '10px 12px',
                                  background: 'var(--ab-bg-2)',
                                  borderLeft: '2px solid var(--ab-copper)',
                                  borderRadius: 2,
                                }}>
                                  <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-3)', marginBottom: 6 }}>
                                    扩展方向提示（可选）：
                                  </div>
                                  <textarea
                                    value={expandSt.hint || ''}
                                    onChange={(e) => setParagraphExpandHint(i, pIdx, e.target.value)}
                                    placeholder="如：补充 2024 年数据、增加案例分析、补强因果论证…"
                                    rows={2}
                                    style={{
                                      width: '100%', padding: '6px 8px',
                                      border: '1px solid var(--ab-line)',
                                      borderRadius: 2,
                                      fontSize: 12, fontFamily: 'var(--ab-font-body)',
                                      resize: 'vertical',
                                      background: 'var(--ab-bg)',
                                      color: 'var(--ab-text)',
                                    }}
                                  />
                                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                    <Button type="primary" size="small"
                                      onClick={() => expandParagraph(i, pIdx)}
                                      loading={expandSt.expanding}
                                      style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)',
                                        ...mono, fontSize: 10 }}>
                                      {expandSt.expanding ? '扩展中…' : '开始扩展'}
                                    </Button>
                                    <Button size="small"
                                      onClick={() => cancelParagraphExpandInput(i, pIdx)}
                                      disabled={expandSt.expanding}
                                      style={{ ...mono, fontSize: 10 }}>
                                      取消
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                      {/* 段落级渲染结束 */}

                      {/* 章节大纲概要 */}
                      {s.outline && (
                        <div style={{
                          ...mono, fontSize: 10, color: 'var(--ab-text-4)',
                          marginTop: 16, padding: '6px 10px',
                          background: 'var(--ab-bg-2)', borderRadius: 2,
                          letterSpacing: '0.05em',
                        }}>
                          ◆ 大纲：{s.outline.length > 200 ? s.outline.slice(0, 200) + '…' : s.outline}
                        </div>
                      )}

                      {/* 思考过程折叠面板 */}
                      {s.hasProcess && (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {s.debate && (
                              <Button size="small"
                                onClick={() => toggleProcess(i, 'debate')}
                                style={{ ...mono, fontSize: 10, color: exp.debate ? 'var(--ab-copper)' : 'var(--ab-text-3)',
                                  borderColor: exp.debate ? 'var(--ab-copper)' : 'var(--ab-line)',
                                  background: exp.debate ? 'var(--ab-bg-2)' : 'transparent' }}>
                                {exp.debate ? '▼' : '▶'} 评审意见
                              </Button>
                            )}
                            {s.draft && (
                              <Button size="small"
                                onClick={() => toggleProcess(i, 'draft')}
                                style={{ ...mono, fontSize: 10, color: exp.draft ? 'var(--ab-copper)' : 'var(--ab-text-3)',
                                  borderColor: exp.draft ? 'var(--ab-copper)' : 'var(--ab-line)',
                                  background: exp.draft ? 'var(--ab-bg-2)' : 'transparent' }}>
                                {exp.draft ? '▼' : '▶'} 章节初稿
                              </Button>
                            )}
                            {/* 2026-07-18: subsection 路径下展示"思考过程"按钮，
                                点击后展示子小节拆分说明（draft/debate 在子小节层面） */}
                            {!s.draft && !s.debate && s.subsections && s.subsections.length > 0 && (
                              <Button size="small"
                                onClick={() => toggleProcess(i, 'debate')}
                                style={{ ...mono, fontSize: 10, color: exp.debate ? '#2563eb' : 'var(--ab-text-3)',
                                  borderColor: exp.debate ? '#2563eb' : 'var(--ab-line)',
                                  background: exp.debate ? 'rgba(37, 99, 235, 0.05)' : 'transparent' }}>
                                {exp.debate ? '▼' : '▶'} 思考过程（子小节拆分）
                              </Button>
                            )}
                          </div>
                          {exp.debate && s.debate && (
                            <div style={{
                              ...body, fontSize: 12.5, color: 'var(--ab-text-2)', lineHeight: 1.7,
                              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              marginTop: 10, padding: '10px 14px',
                              background: 'rgba(184, 115, 70, 0.05)',
                              borderLeft: '2px solid var(--ab-copper)',
                              borderRadius: 2,
                            }}>
                              {stripThinking(s.debate)}
                            </div>
                          )}
                          {exp.draft && s.draft && (
                            <div style={{
                              ...body, fontSize: 12.5, color: 'var(--ab-text-3)', lineHeight: 1.7,
                              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              marginTop: 10, padding: '10px 14px',
                              background: 'rgba(0,0,0,0.02)',
                              borderLeft: '2px solid var(--ab-line)',
                              borderRadius: 2,
                            }}>
                              {stripThinking(s.draft)}
                            </div>
                          )}
                          {/* 2026-07-18: subsection 路径下，展开"思考过程"显示子小节拆分说明 */}
                          {exp.debate && !s.debate && !s.draft && s.subsections && s.subsections.length > 0 && (
                            <div style={{
                              ...body, fontSize: 12.5, color: 'var(--ab-text-2)', lineHeight: 1.7,
                              marginTop: 10, padding: '10px 14px',
                              background: 'rgba(37, 99, 235, 0.04)',
                              borderLeft: '2px solid #2563eb',
                              borderRadius: 2,
                            }}>
                              <div style={{
                                ...mono, fontSize: 10, color: '#2563eb',
                                letterSpacing: '0.1em', marginBottom: 8,
                              }}>
                                ◇ 子小节拆分生成说明
                              </div>
                              <div>本章节因篇幅较大（预估超过 {Math.round((s.refined || '').length / 100) * 100} 字），按子小节拆分生成。</div>
                              <div style={{ marginTop: 6 }}>共拆分 <strong>{s.subsections.length}</strong> 个子小节，每个子小节独立走两步 ReAct 闭环（draft → debate → revise）。</div>
                              <div style={{ marginTop: 6, color: 'var(--ab-text-3)', fontSize: 11.5 }}>
                                各子小节的初稿、评审意见、修订正文请查看下方"子小节详情"面板。
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 2026-07-18: 子小节详情折叠面板（subsection 路径才显示） */}
                      {s.subsections && s.subsections.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <Button size="small"
                            onClick={() => toggleProcess(i, 'subsections')}
                            style={{ ...mono, fontSize: 10,
                              color: exp.subsections ? '#2563eb' : 'var(--ab-text-3)',
                              borderColor: exp.subsections ? '#2563eb' : 'var(--ab-line)',
                              background: exp.subsections ? 'rgba(37, 99, 235, 0.05)' : 'transparent' }}>
                            {exp.subsections ? '▼' : '▶'} 子小节详情（{s.subsections.length}）
                          </Button>
                          {exp.subsections && (
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {s.subsections.map((sub, j) => (
                                <div key={j} style={{
                                  padding: '10px 14px',
                                  background: 'rgba(37, 99, 235, 0.03)',
                                  border: '1px solid rgba(37, 99, 235, 0.15)',
                                  borderRadius: 4,
                                }}>
                                  {/* 子小节标题 + 修订方式徽标 */}
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    marginBottom: 6,
                                  }}>
                                    <span style={{
                                      ...mono, fontSize: 9, color: '#2563eb',
                                      padding: '1px 5px',
                                      background: 'rgba(37, 99, 235, 0.1)', borderRadius: 2,
                                    }}>
                                      {String(j + 1).padStart(2, '0')}
                                    </span>
                                    <span style={{
                                      ...serif, fontSize: 14, color: 'var(--ab-text)',
                                      fontWeight: 500,
                                    }}>
                                      {sub.title}
                                    </span>
                                    {sub.revise_method && (
                                      <span style={{
                                        ...mono, fontSize: 9, padding: '1px 5px',
                                        color: reviseMethodColor(sub.revise_method),
                                        background: reviseMethodBg(sub.revise_method),
                                        borderRadius: 2,
                                        display: 'inline-flex', alignItems: 'center', gap: 3,
                                      }}>
                                        {reviseMethodLabel(sub.revise_method)}
                                        {typeof sub.similarity === 'number' && (
                                          <span style={{ color: 'var(--ab-text-4)', marginLeft: 2 }}>
                                            · sim {sub.similarity.toFixed(2)}
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                  {/* 子小节正文（refined） */}
                                  {sub.refined && (
                                    <div style={{
                                      ...body, fontSize: 13, color: 'var(--ab-text)', lineHeight: 1.8,
                                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                      marginBottom: 6,
                                    }}>
                                      {stripThinking(sub.refined)}
                                    </div>
                                  )}
                                  {/* 子小节审稿意见（折叠） */}
                                  {sub.debate && (
                                    <div style={{
                                      ...body, fontSize: 11, color: 'var(--ab-text-3)', lineHeight: 1.6,
                                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                      padding: '6px 10px',
                                      background: 'rgba(184, 115, 70, 0.04)',
                                      borderLeft: '2px solid var(--ab-copper)',
                                      borderRadius: 2,
                                    }}>
                                      <span style={{
                                        ...mono, fontSize: 9, color: 'var(--ab-copper)',
                                        letterSpacing: '0.1em', marginRight: 6,
                                      }}>
                                        ◇ 评审意见
                                      </span>
                                      {stripThinking(sub.debate)}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 2026-07-19: 段落扩展历史折叠面板 — 展示每段的扩展前后 + debate 思考过程 */}
                      {s.paragraphs && s.paragraphs.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <Button size="small"
                            onClick={() => toggleProcess(i, 'paragraphs')}
                            style={{ ...mono, fontSize: 10,
                              color: exp.paragraphs ? '#16a34a' : 'var(--ab-text-3)',
                              borderColor: exp.paragraphs ? '#16a34a' : 'var(--ab-line)',
                              background: exp.paragraphs ? 'rgba(22, 163, 74, 0.05)' : 'transparent' }}>
                            {exp.paragraphs ? '▼' : '▶'} 段落扩展历史（{s.paragraphs.length}）
                          </Button>
                          {exp.paragraphs && (
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {s.paragraphs.map((pm, j) => (
                                <div key={j} style={{
                                  padding: '10px 14px',
                                  background: 'rgba(22, 163, 74, 0.03)',
                                  border: '1px solid rgba(22, 163, 74, 0.15)',
                                  borderRadius: 4,
                                }}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    marginBottom: 6, flexWrap: 'wrap',
                                  }}>
                                    <span style={{
                                      ...mono, fontSize: 9, color: '#16a34a',
                                      padding: '1px 5px',
                                      background: 'rgba(22, 163, 74, 0.1)', borderRadius: 2,
                                    }}>
                                      段落 {(typeof pm.para_idx === 'number' ? pm.para_idx : 0) + 1}
                                    </span>
                                    {pm.expanded_at && (
                                      <span style={{
                                        ...mono, fontSize: 9, color: 'var(--ab-text-4)',
                                      }}>
                                        {pm.expanded_at.slice(0, 19).replace('T', ' ')}
                                      </span>
                                    )}
                                    {pm.expand_hint && (
                                      <span style={{
                                        ...mono, fontSize: 9, color: 'var(--ab-copper)',
                                        padding: '1px 5px',
                                        background: 'rgba(184, 115, 70, 0.08)', borderRadius: 2,
                                      }}>
                                        hint: {pm.expand_hint.length > 40 ? pm.expand_hint.slice(0, 40) + '…' : pm.expand_hint}
                                      </span>
                                    )}
                                  </div>
                                  {/* 扩展后段落正文 */}
                                  {pm.refined && (
                                    <div style={{
                                      ...body, fontSize: 13, color: 'var(--ab-text)', lineHeight: 1.8,
                                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                      marginBottom: 6,
                                    }}>
                                      {stripThinking(pm.refined)}
                                    </div>
                                  )}
                                  {/* 段落级 debate 思考过程 */}
                                  {pm.debate && (
                                    <div style={{
                                      ...body, fontSize: 11, color: 'var(--ab-text-3)', lineHeight: 1.6,
                                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                      padding: '6px 10px',
                                      background: 'rgba(22, 163, 74, 0.04)',
                                      borderLeft: '2px solid #16a34a',
                                      borderRadius: 2,
                                    }}>
                                      <span style={{
                                        ...mono, fontSize: 9, color: '#16a34a',
                                        letterSpacing: '0.1em', marginRight: 6,
                                      }}>
                                        ◇ 扩展反思
                                      </span>
                                      {stripThinking(pm.debate)}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    // ── 编辑模式：TextArea + LLM 校准输入框 ──
                    <>
                      <div style={{
                        ...mono, fontSize: 10, color: 'var(--ab-text-4)',
                        marginBottom: 8, letterSpacing: '0.1em',
                      }}>
                        ◆ 直接编辑段落内容
                      </div>
                      <TextArea
                        value={editState.editedText}
                        onChange={e => setSectionEditState(prev => ({
                          ...prev,
                          [i]: { ...prev[i], editedText: e.target.value },
                        }))}
                        autoSize={{ minRows: 10, maxRows: 40 }}
                        style={{
                          ...body, fontSize: 14, color: 'var(--ab-text)', lineHeight: 1.9,
                          background: 'var(--ab-bg-3)',
                          border: '1px solid var(--ab-copper)',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}
                      />

                      {/* LLM 校准区 — 仅编辑模式下显示 */}
                      <div style={{
                        marginTop: 16, padding: '12px 14px',
                        background: 'rgba(184, 115, 70, 0.04)',
                        border: '1px dashed var(--ab-copper)',
                        borderRadius: 4,
                      }}>
                        <div style={{
                          ...mono, fontSize: 10, color: 'var(--ab-copper)',
                          marginBottom: 8, letterSpacing: '0.1em',
                        }}>
                          ◆ LLM 校准（可选）
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <Input
                            placeholder="输入修改点，如「补充 2024 年最新数据」「删除第二段冗余」"
                            value={regenState.hint}
                            onChange={e => setSectionRegenState(prev => ({
                              ...prev,
                              [i]: { ...prev[i], hint: e.target.value },
                            }))}
                            size="small"
                            style={{
                              ...mono, fontSize: 11, flex: 1,
                              background: 'var(--ab-bg)', borderColor: 'var(--ab-line)',
                            }}
                            disabled={regenState.regenerating}
                          />
                          <Button size="small"
                            onClick={() => regenerateSection(i)}
                            loading={regenState.regenerating}
                            disabled={!regenState.hint || !regenState.hint.trim()}
                            style={{
                              ...mono, fontSize: 10,
                              background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)',
                              color: '#fff', whiteSpace: 'nowrap',
                            }}>
                            LLM 校准
                          </Button>
                        </div>
                        <div style={{
                          ...mono, fontSize: 9, color: 'var(--ab-text-4)',
                          marginTop: 6,
                        }}>
                          点击 LLM 校准后，AI 会基于修改点重写段落。如需保存请点击上方"保存"按钮。
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
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
