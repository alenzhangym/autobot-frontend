import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Card, Tag, Typography, Space, Button, Tooltip, Table, Empty, Spin,
  Segmented, Modal, InputNumber, Input, Form, Popconfirm, Divider, message, Row, Col, Select, Switch, Alert
} from 'antd'
import {
  ReloadOutlined, CheckCircleFilled, CloseCircleFilled, CopyOutlined,
  LineChartOutlined, BellOutlined, FileSearchOutlined, RocketOutlined,
  SettingOutlined, PlusOutlined, DeleteOutlined, RobotOutlined, WalletOutlined, SendOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import api from './auth'

const { Text, Title } = Typography

/**
 * 股票监控页 — 把 E:\code\stock-monitor 的 Web 仪表盘移植进 AutoBot 前端。
 *
 * <p>数据源：Java 后端 StockMonitorService（东方财富/腾讯行情 + 本地 LLM 分析），
 * 全部经 /api/stock-monitor/* REST 接口读取。功能对齐原 Python 仪表盘：</p>
 * <ul>
 *   <li>概览条：监控标的数量 / 今日提醒 / LLM 分析报告 / 运行状态 / API 成功率</li>
 *   <li>持仓监控表：现价 / 涨跌 / PE / PB / 方向，点击行看 K 线 + 研报</li>
 *   <li>个股详情：K 线图 + 持仓编辑 + LLM 详细分析（markdown 渲染）</li>
 *   <li>今日提醒列表 + LLM 分析报告（今日 / 历史）</li>
 *   <li>后端接口调用状态（成功/失败 + 按标签统计 + 调用历史）</li>
 * </ul>
 */
export default function StockMonitorPage() {
  const [status, setStatus] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [alerts, setAlerts] = useState([])
  const [analysis, setAnalysis] = useState([])
  const [apiInfo, setApiInfo] = useState(null)
  const [portfolio, setPortfolio] = useState({})
  const [selectedCode, setSelectedCode] = useState(null)
  const [kline, setKline] = useState([])
  const [report, setReport] = useState('')
  const [analysisMode, setAnalysisMode] = useState('today')
  const [history, setHistory] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [loading, setLoading] = useState(true)
  const [reportModal, setReportModal] = useState(null)  // { title, content }
  const [analyzingCode, setAnalyzingCode] = useState('')
  // 2026-08-20: 基本面/财报分析
  const [financial, setFinancial] = useState(null)       // { periods, name, code, updated_at }
  const [finLoading, setFinLoading] = useState(false)
  const [finAnalyzing, setFinAnalyzing] = useState('')   // 正在生成财报解读的 code
  const [finReport, setFinReport] = useState(null)       // { title, content }
  const [pushingFin, setPushingFin] = useState(false)
  // 2026-08-26: 全局数据源偏好（auto|eastmoney|ths）
  const [dataSource, setDataSource] = useState('auto')
  const [posEdit, setPosEdit] = useState(null)          // { shares, cost }
  const [posSaving, setPosSaving] = useState(false)
  // 2026-08-20: 持仓盈利总结 + 买卖交易流水
  const [profit, setProfit] = useState(null)            // { summary, positions }
  const [tradeOpen, setTradeOpen] = useState(false)     // 买卖记录弹窗
  const [tradeSide, setTradeSide] = useState('buy')
  const [tradeShares, setTradeShares] = useState(undefined)
  const [tradePrice, setTradePrice] = useState(undefined)
  const [tradeSaving, setTradeSaving] = useState(false)
  const [trades, setTrades] = useState([])              // 该股买卖流水
  // 用户监控配置管理
  const [watchlist, setWatchlist] = useState([])
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfgView, setCfgView] = useState('list')  // 'list' | 'form' | 'profile'
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgForm] = Form.useForm()
  // 2026-08-16: LLM 自动配置 + 总体资金配置画像
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState(null)   // AI 生成的配置（展示用）
  const [profile, setProfile] = useState({
    total_capital: 0, max_position_pct: 20, risk_level: 'balanced', strategy: '',
    llm_vs_rule_weight: 0.5, llm_sell_threshold: 0.6, llm_buy_threshold: 0.65, slippage_rate: 0.01,
    max_liquidity_pct: 0.05, correlation_threshold: 0.7, sector_enabled: true,
  })
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileForm] = Form.useForm()
  // 2026-08-20: 个人微信推送（WxPusher 扫码绑定）
  const [pushCfg, setPushCfg] = useState({ wxpusher_configured: false, wxpusher_qrcode: '', wxpusher_app_name: '', wxpusher_error: '' })
  const [wxTestLoading, setWxTestLoading] = useState(false)

  const countdownRef = useRef(10)

  const loadWatchlist = useCallback(async () => {
    try {
      const r = await api.get('/stock-monitor/watchlist')
      setWatchlist(Array.isArray(r.data) ? r.data : [])
    } catch (e) { setWatchlist([]) }
  }, [])

  const loadProfile = useCallback(async () => {
    try {
      const r = await api.get('/stock-monitor/profile')
      setProfile(r.data || {})
    } catch (e) { /* ignore */ }
  }, [])

  // 2026-08-20: 加载个人微信推送配置（扫码二维码/绑定状态）
  const loadPushConfig = useCallback(async () => {
    try {
      const r = await api.get('/stock-monitor/push/config')
      setPushCfg(r.data || {})
    } catch (e) { /* ignore */ }
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [st, q, al, an, ap] = await Promise.all([
        api.get('/stock-monitor/status'),
        api.get('/stock-monitor/quotes'),
        api.get('/stock-monitor/alerts'),
        api.get('/stock-monitor/analysis'),
        api.get('/stock-monitor/api'),
      ])
      setStatus(st.data)
      setQuotes(q.data?.stocks || [])
      setAlerts(al.data?.alerts || [])
      setAnalysis(an.data?.reports || [])
      setApiInfo(ap.data)
      if (analysisMode === 'history') {
        const h = await api.get('/stock-monitor/analysis/history')
        setHistory(h.data?.reports || [])
      }
      setLoading(false)
    } catch (e) {
      setLoading(false)
      // 后端未就绪时静默，前端提示一次
    }
  }, [analysisMode])

  // 2026-08-26: 全局数据源偏好 —— 读取（须在 useEffect 依赖数组引用前定义，避免 TDZ）
  const loadDataSource = useCallback(async () => {
    try {
      const r = await api.get('/stock-monitor/data-source')
      if (r.data?.ok && r.data?.dataSource) setDataSource(r.data.dataSource)
    } catch (e) { /* 后端未就绪则保持默认 auto */ }
  }, [])

  useEffect(() => {
    loadAll()
    loadWatchlist()
    loadProfile()
    loadProfit()
    loadPushConfig()
    loadDataSource()
  }, [loadAll, loadWatchlist, loadProfile, loadPushConfig, loadDataSource])

  // 10s 自动刷新倒计时
  useEffect(() => {
    const timer = setInterval(() => {
      countdownRef.current -= 1
      if (countdownRef.current <= 0) {
        countdownRef.current = 10
        loadAll()
      }
      setCountdown(countdownRef.current)
    }, 1000)
    return () => clearInterval(timer)
  }, [loadAll])

  const manualRefresh = async () => {
    setRefreshing(true)
    try {
      const r = await api.post('/stock-monitor/refresh')
      if (!r.data?.ok) message.warning(r.data?.msg || '刷新失败')
      else message.success(r.data.msg || '已触发采集')
      setTimeout(() => { countdownRef.current = 10; setCountdown(10); loadAll() }, 800)
    } catch (e) {
      message.error('刷新失败: ' + (e.response?.data?.message || e.message))
    }
    setRefreshing(false)
  }

  // ── 用户监控配置管理 ────────────────────────────────────────────
  const parseJsonSafe = (s, fallback) => {
    if (!s) return fallback
    try { return JSON.parse(s) } catch (e) { return fallback }
  }

  const openConfig = (item) => {
    setAiResult(null)
    // 2026-08-16: 仅需用户输入 代码/持仓数量/持仓成本；名称经行情 API 自动获取，
    // 其余策略字段（action/买卖/做T/止损/加仓计划）由 LLM 自动生成。
    cfgForm.setFieldsValue({
      id: item?.id, code: item?.code,
      holdings_shares: item?.holdingsShares, holdings_cost: item?.holdingsCost,
    })
    setCfgView('form')
    setCfgOpen(true)
  }

  const openConfigList = () => {
    cfgForm.resetFields()
    setAiResult(null)
    setCfgView('list')
    setCfgOpen(true)
  }

  const saveDataSource = async (v) => {
    const prev = dataSource
    setDataSource(v)
    const label = v === 'ths' ? '同花顺优先' : v === 'eastmoney' ? '东方财富优先' : '自动'
    try {
      const r = await api.post('/stock-monitor/data-source', { dataSource: v })
      if (r.data?.ok && r.data?.dataSource) { setDataSource(r.data.dataSource); message.success(`数据源已设为「${label}」，失败时自动回退另一源`) }
      else { setDataSource(prev); message.warning('保存失败，已还原') }
    } catch (e) {
      setDataSource(prev)
      message.error('保存数据源失败: ' + (e.response?.data?.message || e.message))
    }
  }

  // LLM 自动配置：分析 资金画像+个股行情+大盘+消息+财报 后生成并保存策略
  const autoGenerate = async () => {
    let values
    try { values = await cfgForm.validateFields() } catch (e) { return }
    if (!values.code) { message.warning('请先填写股票代码'); return }
    setAiLoading(true)
    try {
      const r = await api.post('/stock-monitor/watchlist/auto', {
        code: values.code,
        holdings_shares: values.holdings_shares || 0,
        holdings_cost: values.holdings_cost || 0,
      })
      if (!r.data?.ok) { message.error(r.data?.msg || '自动配置失败'); return }
      setAiResult(r.data)
      message.success(`AI 已为 ${r.data.name}（${r.data.code}）生成并保存配置`)
      await Promise.all([loadWatchlist(), loadAll()])
    } catch (e) {
      message.error('自动配置失败: ' + (e.response?.data?.message || e.message))
    }
    setAiLoading(false)
  }

  // 仅保存基础信息（代码 + 持仓），不覆盖 LLM 生成的策略字段
  const saveConfig = async () => {
    let values
    try { values = await cfgForm.validateFields() } catch (e) { return }
    setCfgSaving(true)
    try {
      const payload = {
        code: values.code,
        holdings_shares: values.holdings_shares || 0,
        holdings_cost: values.holdings_cost || 0,
      }
      const r = await api.post('/stock-monitor/watchlist', payload)
      if (!r.data?.ok) { message.error(r.data?.msg || '保存失败'); return }
      message.success('基础配置已保存')
      setCfgOpen(false)
      await Promise.all([loadWatchlist(), loadAll()])
      api.get('/stock-monitor/portfolio').then(rr => setPortfolio(rr.data?.positions || {})).catch(() => {})
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.message || e.message))
    }
    setCfgSaving(false)
  }

  // ── 总体资金配置画像（LLM 自动配置的资金约束）───────────────────
  const openProfile = () => {
    profileForm.setFieldsValue({
      total_capital: profile.total_capital || 0,
      max_position_pct: profile.max_position_pct || 20,
      risk_level: profile.risk_level || 'balanced',
      strategy: profile.strategy || '',
      llm_vs_rule_weight: profile.llm_vs_rule_weight ?? 0.5,
      llm_sell_threshold: profile.llm_sell_threshold ?? 0.6,
      llm_buy_threshold: profile.llm_buy_threshold ?? 0.65,
      slippage_rate: profile.slippage_rate ?? 0.01,
      max_liquidity_pct: profile.max_liquidity_pct ?? 0.05,
      correlation_threshold: profile.correlation_threshold ?? 0.7,
      sector_enabled: profile.sector_enabled ?? true,
      push_wxpusher_uid: profile.push_wxpusher_uid || '',
    })
    setProfileOpen(true)
    loadPushConfig()
  }

  const saveProfileCfg = async () => {
    let v
    try { v = await profileForm.validateFields() } catch (e) { return }
    try {
      const r = await api.post('/stock-monitor/profile', {
        total_capital: v.total_capital || 0,
        max_position_pct: v.max_position_pct || 20,
        risk_level: v.risk_level || 'balanced',
        strategy: v.strategy || '',
        llm_vs_rule_weight: v.llm_vs_rule_weight ?? null,
        llm_sell_threshold: v.llm_sell_threshold ?? null,
        llm_buy_threshold: v.llm_buy_threshold ?? null,
        slippage_rate: v.slippage_rate ?? null,
        max_liquidity_pct: v.max_liquidity_pct ?? null,
        correlation_threshold: v.correlation_threshold ?? null,
        sector_enabled: v.sector_enabled ?? null,
        push_wxpusher_uid: v.push_wxpusher_uid || '',
      })
      if (r.data?.ok) { message.success('总体资金配置已保存'); setProfileOpen(false); loadProfile() }
      else message.error(r.data?.msg || '保存失败')
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.message || e.message))
    }
  }

  // 2026-08-20: 向个人微信发送测试消息，验证扫码绑定
  const sendWxTest = async () => {
    setWxTestLoading(true)
    try {
      const r = await api.post('/stock-monitor/push/wxpusher-test')
      if (r.data?.ok) message.success('测试消息已发送，请查看你的微信')
      else message.warning(r.data?.msg || '未绑定微信或未配置推送')
    } catch (e) {
      message.error('发送失败: ' + (e.response?.data?.message || e.message))
    }
    setWxTestLoading(false)
  }

  const deleteConfig = async (id) => {
    try {
      await api.delete(`/stock-monitor/watchlist/${id}`)
      message.success('已删除')
      await Promise.all([loadWatchlist(), loadAll()])
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.message || e.message))
    }
  }

  const selectStock = async (code) => {
    setSelectedCode(code)
    setFinancial(null)
    setReport('')
    try {
      const [k, rep] = await Promise.all([
        api.get('/stock-monitor/kline', { params: { code, days: 60 } }),
        api.get('/stock-monitor/report', { params: { code } }),
      ])
      setKline(k.data?.klines || [])
      const content = rep.data?.content || ''
      setReport(content && content.includes('详细股价分析') ? content : '')
    } catch (e) {
      setKline([]); setReport('')
    }
    loadFinancial(code)
    loadTrades(code)
  }

  // 2026-08-20: 持仓盈利总结
  const loadProfit = () => {
    api.get('/stock-monitor/portfolio/profit').then(r => {
      setProfit(r.data || null)
      setPortfolio(r.data?.positions || {})
    }).catch(() => {})
  }

  // 2026-08-20: 加载该股买卖流水
  const loadTrades = async (code) => {
    if (!code) { setTrades([]); return }
    try {
      const r = await api.get('/stock-monitor/portfolio/trades', { params: { code } })
      setTrades(r.data?.trades || [])
    } catch (e) { setTrades([]) }
  }

  const openTradeModal = (code, name) => {
    setTradeSide('buy')
    setTradeShares(undefined)
    setTradePrice(undefined)
    setTradeOpen(true)
    loadTrades(code)
  }

  const saveTrade = async () => {
    if (!selectedCode) return
    if (!tradeShares || tradeShares <= 0) { message.error('请输入大于 0 的股数'); return }
    if (!tradePrice || tradePrice <= 0) { message.error('请输入大于 0 的成交价'); return }
    setTradeSaving(true)
    try {
      const r = await api.post('/stock-monitor/portfolio/trade', {
        code: selectedCode, side: tradeSide, shares: tradeShares, price: tradePrice,
      })
      if (r.data?.ok) {
        message.success(`已记录${tradeSide === 'buy' ? '买入' : '卖出'}，当前持仓 ${r.data.held_shares} 股、均价 ${Number(r.data.avg_cost).toFixed(3)}`)
        setPortfolio(r.data.positions || {})
        loadProfit()
        loadTrades(selectedCode)
      } else {
        message.error(r.data?.msg || '记录失败')
      }
    } catch (e) {
      message.error('记录失败: ' + (e.response?.data?.message || e.message))
    }
    setTradeSaving(false)
  }

  // 2026-08-20: 加载结构化多期财报面板
  const loadFinancial = async (code) => {
    if (!code) { setFinancial(null); return }
    setFinLoading(true)
    try {
      const r = await api.get('/stock-monitor/financial', { params: { code } })
      setFinancial(r.data?.ok ? r.data : { ok: false, msg: r.data?.msg || '获取财报失败' })
    } catch (e) {
      setFinancial({ ok: false, msg: '获取财报失败: ' + (e.response?.data?.message || e.message) })
    }
    setFinLoading(false)
  }

  // 2026-08-20: 生成独立财报解读报告
  const analyzeFinancial = async (code, name) => {
    setFinAnalyzing(code)
    try {
      const r = await api.post('/stock-monitor/analyze-financial', { code })
      if (!r.data?.ok) { message.error(r.data?.msg || '财报解读失败'); return }
      message.success(`「${name || code}」财报解读完成`)
      setFinReport({ title: `${name || code} 基本面/财报解读`, content: r.data.content || '' })
      // 刷新分析报告列表
      try {
        const an = await api.get('/stock-monitor/analysis')
        setAnalysis(an.data?.reports || [])
      } catch (e) { /* ignore */ }
    } catch (e) {
      message.error('财报解读失败: ' + (e.response?.data?.message || e.message))
    } finally {
      setFinAnalyzing('')
    }
  }

  // 2026-08-20: 手动推送当日财报日报（企业微信/钉钉/飞书）
  const pushFinanceDaily = async () => {
    setPushingFin(true)
    try {
      const r = await api.post('/stock-monitor/push-financial-daily')
      if (r.data?.ok) message.success(r.data.msg || '财报日报已推送')
      else message.warning(r.data?.msg || '未配置推送渠道，推送未成功')
    } catch (e) {
      message.error('推送失败: ' + (e.response?.data?.message || e.message))
    }
    setPushingFin(false)
  }

  const loadHistory = async (mode) => {
    setAnalysisMode(mode)
    if (mode === 'history') {
      try {
        const h = await api.get('/stock-monitor/analysis/history')
        setHistory(h.data?.reports || [])
      } catch (e) { setHistory([]) }
    }
  }

  const openReport = async (code, name) => {
    try {
      const rep = await api.get('/stock-monitor/report', { params: { code } })
      setReportModal({ title: `${name || code} 详细股价分析`, content: rep.data?.content || '' })
    } catch (e) { /* ignore */ }
  }

  const openHistoryReport = async (path) => {
    try {
      const rep = await api.get('/stock-monitor/report', { params: { file: path } })
      setReportModal({ title: '历史研报', content: rep.data?.content || '' })
    } catch (e) { /* ignore */ }
  }

  // 2026-08-17: 单股立即分析（历史K线+财报+相关行业新闻 → LLM）
  const analyzeStock = async (code, name) => {
    setAnalyzingCode(code)
    try {
      const r = await api.post('/stock-monitor/analyze', { code })
      if (!r.data?.ok) { message.error(r.data?.msg || '分析失败'); return }
      message.success(`「${name || code}」分析完成`)
      // 刷新监控配置（LLM 已回写修正的仓位区间）
      loadWatchlist()
      // 刷新分析报告列表
      try {
        const an = await api.get('/stock-monitor/analysis')
        setAnalysis(an.data?.reports || [])
      } catch (e) { /* ignore */ }
      // 展示新生成的报告
      try {
        const rep = await api.get('/stock-monitor/report', { params: { code } })
        setReportModal({ title: `${name || code} 详细股价分析`, content: rep.data?.content || '（报告读取失败）' })
      } catch (e) { message.warning('分析完成，报告读取失败'); }
    } catch (e) {
      message.error('分析失败: ' + (e.response?.data?.message || e.message))
    } finally {
      setAnalyzingCode('')
    }
  }

  const copyText = (text) => {
    if (!text) return
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => message.success('已复制')).catch(() => {})
    }
  }

  const savePos = async () => {
    if (!selectedCode) return
    setPosSaving(true)
    try {
      const r = await api.post('/stock-monitor/portfolio', {
        code: selectedCode, shares: posEdit?.shares || 0, cost: posEdit?.cost || 0,
      })
      if (r.data?.ok) {
        setPortfolio(r.data.positions || {})
        setPosEdit(null)
        message.success('持仓已保存')
      } else {
        message.error(r.data?.msg || '保存失败')
      }
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.message || e.message))
    }
    setPosSaving(false)
  }

  const selQuote = quotes.find(q => q.code === selectedCode) || null
  const pos = portfolio[selectedCode] || null
  const mktVal = selQuote?.price && pos?.shares > 0 ? selQuote.price * pos.shares : 0
  const costVal = pos?.shares > 0 ? pos.cost * pos.shares : 0
  const pnl = mktVal - costVal

  const fmt = (v, d = 2) => (v === null || v === undefined || isNaN(v)) ? '--' : Number(v).toFixed(d)
  const pctCls = (v) => v > 0.0001 ? '#f6465d' : (v < -0.0001 ? '#0ecb81' : '#8b95a7')
  const pctStr = (v) => (v === null || v === undefined || isNaN(v)) ? '--' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'

  const summaryCards = [
    { k: '监控标的', v: status?.stock_count ?? '--', accent: true },
    { k: '今日提醒', v: status?.alert_count ?? '--', up: true },
    { k: 'LLM 分析报告', v: status?.analysis_count ?? '--', accent: true },
    { k: '运行状态', v: status?.running ? '运行中' : '待机', colored: status?.running },
    { k: 'API（成功/失败）', v: `${status?.api_ok ?? 0} / ${status?.api_fail ?? 0}`, fail: (status?.api_fail || 0) > 0 },
  ]

  const columns = [
    { title: '名称', key: 'name', render: (_, s) => (
      <div>
        <Text strong style={{ color: '#e8ecf3' }}>{s.name}</Text>
        {s.alerted && <Tag color="red" style={{ marginLeft: 6 }}>提醒</Tag>}
        <div style={{ color: '#5b6577', fontFamily: 'monospace', fontSize: 12 }}>{s.code}</div>
      </div>
    ) },
    { title: '现价', key: 'price', align: 'right', render: (_, s) => <span style={{ fontFamily: 'monospace' }}>{fmt(s.price)}</span> },
    { title: '涨跌', key: 'pct', align: 'right', render: (_, s) => <span style={{ color: pctCls(s.pct), fontFamily: 'monospace' }}>{pctStr(s.pct)}</span> },
    { title: 'PE', key: 'pe', align: 'right', render: (_, s) => <span style={{ fontFamily: 'monospace' }}>{fmt(s.pe_ttm)}</span> },
    { title: 'PB', key: 'pb', align: 'right', render: (_, s) => <span style={{ fontFamily: 'monospace' }}>{fmt(s.pb)}</span> },
    { title: '方向', key: 'action', render: (_, s) => {
      const color = { buy: '#f5b301', sell: '#7aa2f7', watch: '#8b95a7' }[s.action] || '#8b95a7'
      const label = { buy: '买入', sell: '卖出', watch: '观望' }[s.action] || s.action
      return <span style={{ color }}>{label}</span>
    } },
    { title: '分析', key: 'analyze', align: 'center', width: 70, render: (_, s) => (
      <Button size="small" loading={analyzingCode === s.code} icon={<RobotOutlined />}
        onClick={(e) => { e.stopPropagation(); analyzeStock(s.code, s.name) }}>
        分析
      </Button>
    ) },
  ]

  return (
    <div style={{ minHeight: '100vh', padding: 22, background: '#0b0f17', color: '#e8ecf3', fontFamily: "'Microsoft YaHei','PingFang SC',sans-serif" }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '14px 20px', marginBottom: 18, background: 'linear-gradient(180deg, rgba(18,26,40,.9), rgba(14,20,32,.9))', border: '1px solid #1e2a3c', borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontFamily: 'Consolas,monospace', fontWeight: 700, fontSize: 19, letterSpacing: 2, color: '#f5b301', textShadow: '0 0 18px rgba(245,179,1,.35)' }}>STOCK MONITOR</span>
          <span style={{ color: '#8b95a7', fontSize: 13, letterSpacing: 3 }}>股票监控台</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Tag
            color={status?.trading ? 'red' : status?.market?.includes('午间') ? 'gold' : 'green'}
            style={{ fontSize: 13, padding: '3px 12px', borderRadius: 999, margin: 0 }}
          >
            {status?.market || '连接中…'}
          </Tag>
          <div>
            <div style={{ fontSize: 11, color: '#5b6577' }}>最近更新</div>
            <div style={{ fontFamily: 'monospace', fontSize: 14 }}>{status?.last_update || '--'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#5b6577' }}>刷新倒计时</div>
            <div style={{ fontFamily: 'monospace', fontSize: 14 }}>{countdown}s</div>
          </div>
          <Button
            type="primary" icon={<ReloadOutlined />} loading={refreshing}
            onClick={manualRefresh}
            style={{ background: 'rgba(245,179,1,.9)', borderColor: '#f5b301', color: '#0b0f17', fontWeight: 600 }}
          >
            立即刷新行情
          </Button>
          <Button icon={<BellOutlined />} loading={pushingFin} onClick={pushFinanceDaily}
            style={{ background: 'rgba(7,119,3,.1)', border: '1px solid #1e2a3c', color: '#0ecb81' }}>
            推送财报日报
          </Button>
          <Button icon={<SettingOutlined />} onClick={openConfigList}>
            配置监控股票
          </Button>
          {/* 2026-08-26: 全局数据源偏好 —— 财报与股市行情下载接口选择 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip
              placement="bottomRight"
              title="财报与股市行情数据的下载接口偏好：自动（默认）= 平衡使用；东方财富优先 / 同花顺优先 = 首选源失败时自动回退另一源。保存后全局生效并持久化。"
            >
              <span style={{ fontSize: 12, color: '#8b95a7', whiteSpace: 'nowrap' }}>数据源</span>
            </Tooltip>
            <Select
              size="middle"
              value={dataSource}
              onChange={saveDataSource}
              style={{ width: 150 }}
              popupMatchSelectWidth={false}
              options={[
                { value: 'auto', label: '自动（默认）' },
                { value: 'eastmoney', label: '东方财富优先' },
                { value: 'ths', label: '同花顺优先' },
              ]}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      ) : (
        <>
          {/* 概览条 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14, marginBottom: 18 }}>
            {summaryCards.map(c => (
              <div key={c.k} style={{ background: 'linear-gradient(180deg,#121a28,#0f1622)', border: '1px solid #1e2a3c', borderRadius: 12, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ fontSize: 11, color: '#5b6577', letterSpacing: 2, marginBottom: 6 }}>{c.k}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700,
                  color: c.accent ? '#f5b301' : c.fail ? '#f6465d' : c.up ? '#f6465d' : c.colored ? '#f6465d' : '#e8ecf3' }}>
                  {c.v}
                </div>
              </div>
            ))}
          </div>

          {/* 持仓监控 + 个股详情 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 18 }}>
            <div style={{ background: 'linear-gradient(180deg,#121a28,#0f1622)', border: '1px solid #1e2a3c', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 2, color: '#f5b301', padding: '12px 16px', borderBottom: '1px solid #1e2a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 14, background: '#f5b301', borderRadius: 2 }} /> 持仓监控
              </div>
              {/* 2026-08-20: 持仓盈利总结 */}
              {profit?.summary && (
                <div style={{ display: 'flex', gap: 18, padding: '8px 16px', borderBottom: '1px solid #1e2a3c', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#8b95a7' }}>持仓数 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{profit.summary.position_count}</b> 只</span>
                  <span style={{ fontSize: 12, color: '#8b95a7' }}>市值 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{Number(profit.summary.total_mkt).toFixed(0)}</b></span>
                  <span style={{ fontSize: 12, color: '#8b95a7' }}>成本 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{Number(profit.summary.total_cost).toFixed(0)}</b></span>
                  <span style={{ fontSize: 12, color: '#8b95a7' }}>浮动盈亏 <b style={{ color: profit.summary.total_profit > 0 ? '#f6465d' : profit.summary.total_profit < 0 ? '#0ecb81' : '#8b95a7', fontFamily: 'monospace' }}>
                    {profit.summary.total_profit >= 0 ? '+' : ''}{Number(profit.summary.total_profit).toFixed(0)}
                    <span style={{ marginLeft: 4 }}>({profit.summary.total_profit_pct >= 0 ? '+' : ''}{Number(profit.summary.total_profit_pct).toFixed(2)}%)</span>
                  </b></span>
                </div>
              )}
              <Table
                size="small" rowKey="code" dataSource={quotes} columns={columns}
                pagination={false}
                onRow={(s) => ({
                  onClick: () => selectStock(s.code),
                  style: { cursor: 'pointer', background: s.code === selectedCode ? 'rgba(245,179,1,.08)' : 'transparent' }
                })}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无标的" /> }}
              />
            </div>

            <div style={{ background: 'linear-gradient(180deg,#121a28,#0f1622)', border: '1px solid #1e2a3c', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 2, color: '#f5b301', padding: '12px 16px', borderBottom: '1px solid #1e2a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 14, background: '#f5b301', borderRadius: 2 }} /> 个股详情
              </div>
              <div style={{ padding: '12px 14px' }}>
                {!selectedCode ? (
                  <div style={{ color: '#5b6577', textAlign: 'center', padding: '24px 0', fontSize: 13 }}>点击左侧股票查看 K 线与分析报告</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <span style={{ fontSize: 18, fontWeight: 700 }}>{selQuote?.name}</span>
                        <span style={{ fontFamily: 'monospace', color: '#5b6577', marginLeft: 8 }}>{selQuote?.code}</span>
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 700, color: pctCls(selQuote?.pct) }}>{fmt(selQuote?.price)}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, margin: '10px 0' }}>
                      {[
                        { k: '涨跌幅', v: pctStr(selQuote?.pct), c: pctCls(selQuote?.pct) },
                        { k: 'PE(TTM)', v: fmt(selQuote?.pe_ttm) },
                        { k: 'PB', v: fmt(selQuote?.pb) },
                        { k: '数据源', v: selQuote?.source || '-' },
                      ].map(s => (
                        <div key={s.k} style={{ background: '#0f1622', border: '1px solid #1e2a3c', borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ fontSize: 10, color: '#5b6577', letterSpacing: 1 }}>{s.k}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 600, marginTop: 2, color: s.c || '#e8ecf3' }}>{s.v}</div>
                        </div>
                      ))}
                    </div>

                    {/* 持仓编辑 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12, padding: '10px 12px', background: '#0f1622', border: '1px solid #1e2a3c', borderRadius: 8 }}>
                      {posEdit ? (
                        <>
                          <span style={{ fontSize: 12, color: '#8b95a7' }}>持仓数(股)</span>
                          <InputNumber value={posEdit.shares} step={100} min={0} onChange={v => setPosEdit(p => ({ ...p, shares: v }))} style={{ width: 110 }} />
                          <span style={{ fontSize: 12, color: '#8b95a7' }}>成本价</span>
                          <InputNumber value={posEdit.cost} step={0.001} min={0} onChange={v => setPosEdit(p => ({ ...p, cost: v }))} style={{ width: 110 }} />
                          <Button type="primary" size="small" loading={posSaving} onClick={savePos}>保存</Button>
                          <Button size="small" onClick={() => setPosEdit(null)}>取消</Button>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#8b95a7', flexWrap: 'wrap', flex: 1 }}>
                            <span>持仓 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{pos?.shares > 0 ? pos.shares : '--'}</b> 股</span>
                            <span>成本 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{pos?.shares > 0 ? Number(pos.cost).toFixed(3) : '--'}</b></span>
                            <span>市值 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{pos?.shares > 0 ? mktVal.toFixed(0) : '--'}</b></span>
                            <span>盈亏 <b style={{ color: pnl > 0 ? '#f6465d' : pnl < 0 ? '#0ecb81' : '#8b95a7', fontFamily: 'monospace' }}>
                              {pos?.shares > 0 ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)} (${costVal ? `${pnl / costVal * 100 >= 0 ? '+' : ''}${(pnl / costVal * 100).toFixed(2)}%` : '--'})` : '--'}
                            </b></span>
                          </div>
                          <Button size="small" onClick={() => setPosEdit({ shares: pos?.shares > 0 ? pos.shares : undefined, cost: pos?.shares > 0 ? pos.cost : undefined })}>编辑持仓</Button>
                          {/* 2026-08-20: 录入买卖流水，自动计算持仓与均价 */}
                          <Button size="small" type="primary" ghost onClick={() => openTradeModal(selectedCode)}>记录买卖</Button>
                        </>
                      )}
                    </div>

                    <div style={{ marginTop: 6 }}><KlineChart klines={kline} /></div>

                    {/* 2026-08-20: 基本面/财报面板 */}
                    <div style={{ marginTop: 12, background: '#0f1622', border: '1px solid #1e2a3c', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#f5b301', letterSpacing: 1 }}>基本面 / 财报</span>
                        <Space size={6}>
                          <Button size="small" onClick={() => loadFinancial(selectedCode)} icon={<ReloadOutlined />}>刷新</Button>
                          <Button size="small" icon={<RobotOutlined />}
                            loading={finAnalyzing === selectedCode} disabled={!financial?.ok}
                            onClick={() => analyzeFinancial(selectedCode, selQuote?.name)}>
                            财报解读
                          </Button>
                        </Space>
                      </div>
                      {finLoading ? (
                        <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin size="small" /></div>
                      ) : !financial?.ok ? (
                        <div style={{ color: '#5b6577', fontSize: 12 }}>{financial?.msg || '暂无财报数据'}</div>
                      ) : (financial.periods || []).length === 0 ? (
                        <div style={{ color: '#5b6577', fontSize: 12 }}>
                          {financial.raw ? String(financial.raw).slice(0, 220) : '暂无结构化财报数据'}
                          <div style={{ marginTop: 6, fontSize: 11 }}>更新于 {financial.updated_at || '-'}</div>
                        </div>
                      ) : (
                        <>
                          <Table
                            size="small" rowKey="period" pagination={false} dataSource={financial.periods}
                            columns={[
                              { title: '报告期', dataIndex: 'period', width: 110, render: v => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
                              { title: '营收', dataIndex: 'revenue', align: 'right', render: v => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{finFmt(v)}</span> },
                              { title: '净利润', dataIndex: 'net_profit', align: 'right', render: v => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{finFmt(v)}</span> },
                              { title: 'ROE', dataIndex: 'roe', align: 'right', render: v => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{finNumFmt(v, '%')}</span> },
                              { title: '毛利率', dataIndex: 'gross_margin', align: 'right', render: v => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{finNumFmt(v, '%')}</span> },
                              { title: 'EPS', dataIndex: 'eps', align: 'right', render: v => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{finNumFmt(v, '')}</span> },
                            ]}
                            locale={{ emptyText: '暂无数据' }}
                          />
                          <div style={{ marginTop: 6, fontSize: 11, color: '#5b6577' }}>数据来源：东方财富 · 更新于 {financial.updated_at || '-'}</div>
                        </>
                      )}
                    </div>

                    {report && (
                      <>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                          <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(report)}>复制</Button>
                          <Button size="small" icon={<FileSearchOutlined />} onClick={() => setReportModal({ title: `${selQuote?.name} 详细股价分析`, content: report })}>全屏查看</Button>
                        </div>
                        <div style={{ marginTop: 10, background: '#0f1622', border: '1px solid #1e2a3c', borderRadius: 8, padding: '12px 14px', maxHeight: 300, overflowY: 'auto', fontSize: 13, lineHeight: 1.7 }}>
                          <ReactMarkdown>{report}</ReactMarkdown>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 今日提醒 + LLM 分析报告 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
            <div style={{ background: 'linear-gradient(180deg,#121a28,#0f1622)', border: '1px solid #1e2a3c', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 2, color: '#f5b301', padding: '12px 16px', borderBottom: '1px solid #1e2a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 14, background: '#f5b301', borderRadius: 2 }} /> 今日提醒
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto', padding: '4px 0' }}>
                {alerts.length === 0 ? (
                  <div style={{ color: '#5b6577', textAlign: 'center', padding: '24px 0' }}>今日暂无提醒</div>
                ) : alerts.map((a, i) => (
                  <div key={i} style={{ padding: '9px 12px', borderBottom: '1px solid rgba(30,42,60,.6)', fontSize: 13, lineHeight: 1.5 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#5b6577', marginRight: 8 }}>{a.time}</span>
                    <Tag color="red" style={{ fontSize: 10, marginRight: 6 }}>{a.kind}</Tag>
                    {a.level && <Tag color="gold" style={{ fontSize: 10, marginRight: 6 }}>{a.level}</Tag>}
                    <span>{a.msg}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'linear-gradient(180deg,#121a28,#0f1622)', border: '1px solid #1e2a3c', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1e2a3c' }}>
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 2, color: '#f5b301', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 3, height: 14, background: '#f5b301', borderRadius: 2 }} /> LLM 分析报告
                </div>
                <Segmented
                  size="small" value={analysisMode} onChange={loadHistory}
                  options={[{ label: '今日', value: 'today' }, { label: '历史', value: 'history' }]}
                />
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto', padding: '4px 0' }}>
                {analysisMode === 'today' ? (
                  analysis.length === 0 ? (
                    <div style={{ color: '#5b6577', textAlign: 'center', padding: '24px 0' }}>今日暂无分析报告</div>
                  ) : analysis.map((r, i) => (
                    <div key={i} style={{ padding: '9px 12px', borderBottom: '1px solid rgba(30,42,60,.6)', fontSize: 13 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#5b6577', marginRight: 8 }}>{r.time}</span>
                      <a style={{ color: '#f5b301', textDecoration: 'none' }} onClick={() => openReport(r.code, r.name)}>{r.name}（{r.code}）</a>
                    </div>
                  ))
                ) : (
                  history.length === 0 ? (
                    <div style={{ color: '#5b6577', textAlign: 'center', padding: '24px 0' }}>暂无历史研报</div>
                  ) : groupByDate(history).map(({ date, items }) => (
                    <div key={date}>
                      <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 600, letterSpacing: 1, color: '#f5b301' }}>{date}</div>
                      {items.map((r, i) => (
                        <div key={i} style={{ padding: '7px 12px', borderBottom: '1px solid rgba(30,42,60,.6)', fontSize: 13 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#5b6577', marginRight: 6 }}>{String(r.time).slice(11)}</span>
                          <a style={{ color: '#f5b301', textDecoration: 'none' }} onClick={() => openHistoryReport(r.path)}>{r.name}{r.code ? `（${r.code}）` : ''}</a>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 后端接口调用状态 */}
          <div style={{ background: 'linear-gradient(180deg,#121a28,#0f1622)', border: '1px solid #1e2a3c', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 2, color: '#f5b301', padding: '12px 16px', borderBottom: '1px solid #1e2a3c', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 3, height: 14, background: '#f5b301', borderRadius: 2 }} /> 后端接口调用状态
            </div>
            <div style={{ padding: '12px 14px' }}>
              <Row gutter={[14, 14]}>
                <Col xs={24} md={8}>
                  <Space size={16} align="center">
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 700 }}>{apiInfo?.total ?? '--'}</div>
                      <div style={{ color: '#0ecb81', fontSize: 12 }}>成功 {apiInfo?.ok ?? 0}</div>
                      <div style={{ color: '#f6465d', fontSize: 12 }}>失败 {apiInfo?.fail ?? 0}</div>
                    </div>
                    <ApiDonut ok={apiInfo?.ok || 0} fail={apiInfo?.fail || 0} />
                  </Space>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                    {Object.entries(apiInfo?.by_tag || {}).map(([tag, v]) => (
                      <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, fontSize: 12, background: '#0f1622', border: '1px solid #1e2a3c' }}>
                        <span style={{ color: '#8b95a7' }}>{tag}</span>
                        <span style={{ color: '#0ecb81', fontFamily: 'monospace' }}>✓{v.ok}</span>
                        {v.fail > 0 && <span style={{ color: '#f6465d', fontFamily: 'monospace' }}>✗{v.fail}</span>}
                      </span>
                    ))}
                  </div>
                </Col>
                <Col xs={24} md={16}>
                  {(apiInfo?.history?.length || 0) === 0 ? (
                    <div style={{ color: '#5b6577', textAlign: 'center', padding: '24px 0' }}>暂无接口调用记录（点击「立即刷新行情」或等待下一轮采集）</div>
                  ) : (
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                      {apiInfo.history.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: '1px solid rgba(30,42,60,.6)', fontSize: 12, fontFamily: 'monospace' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: r.ok ? '#0ecb81' : '#f6465d', boxShadow: `0 0 6px ${r.ok ? 'rgba(14,203,129,.6)' : 'rgba(246,70,93,.6)'}` }} />
                          <span style={{ color: '#5b6577', flex: 'none' }}>{r.time}</span>
                          <span style={{ color: '#e8ecf3', flex: 'none' }}>{r.tag}</span>
                          {r.ok ? <span style={{ color: '#0ecb81', flex: 'none' }}>{r.latency_ms}ms</span> : <span style={{ color: '#f6465d', flex: 'none' }}>失败{r.error ? ` · ${r.error}` : ''}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </Col>
              </Row>
            </div>
          </div>
        </>
      )}

      {/* 研报全屏弹窗 */}
      <Modal
        open={!!reportModal} onCancel={() => setReportModal(null)} width={980}
        title={reportModal?.title} footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => copyText(reportModal?.content)}>复制全部</Button>,
          <Button key="close" onClick={() => setReportModal(null)}>关闭</Button>,
        ]}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ maxHeight: '72vh', overflowY: 'auto', padding: '12px 16px', fontSize: 14, lineHeight: 1.8 }}>
          {reportModal?.content ? <ReactMarkdown>{reportModal.content}</ReactMarkdown> : <Empty />}
        </div>
      </Modal>

      {/* 2026-08-20: 财报解读全屏弹窗 */}
      <Modal
        open={!!finReport} onCancel={() => setFinReport(null)} width={980}
        title={finReport?.title} footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={() => copyText(finReport?.content)}>复制全部</Button>,
          <Button key="close" onClick={() => setFinReport(null)}>关闭</Button>,
        ]}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ maxHeight: '72vh', overflowY: 'auto', padding: '12px 16px', fontSize: 14, lineHeight: 1.8 }}>
          {finReport?.content ? <ReactMarkdown>{finReport.content}</ReactMarkdown> : <Empty />}
        </div>
      </Modal>

      {/* 2026-08-20: 买卖记录弹窗 —— 录入单笔买卖，自动计算持仓与均价 */}
      <Modal
        open={tradeOpen} onCancel={() => setTradeOpen(false)} width={560}
        title={`记录买卖 · ${selectedCode || ''} ${selQuote?.name || ''}`}
        footer={[
          <Button key="cancel" onClick={() => setTradeOpen(false)}>关闭</Button>,
          <Button key="save" type="primary" loading={tradeSaving} onClick={saveTrade}>记录并重算持仓</Button>,
        ]}
      >
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <Button size="middle" style={{ flex: 1 }} type={tradeSide === 'buy' ? 'primary' : 'default'} onClick={() => setTradeSide('buy')}>买入</Button>
          <Button size="middle" style={{ flex: 1 }} type={tradeSide === 'sell' ? 'primary' : 'default'} danger onClick={() => setTradeSide('sell')}>卖出</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#8b95a7', marginBottom: 6 }}>成交股数</div>
            <InputNumber min={0} step={100} value={tradeShares} onChange={setTradeShares} style={{ width: '100%' }} placeholder="如 1000" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#8b95a7', marginBottom: 6 }}>成交价（元）</div>
            <InputNumber min={0} step={0.01} value={tradePrice} onChange={setTradePrice} style={{ width: '100%' }} placeholder="如 30.55" />
          </div>
        </div>
        <Divider style={{ margin: '16px 0 8px' }} />
        <div style={{ fontSize: 12, color: '#8b95a7', marginBottom: 6 }}>交易流水（按"累计买入 - 累计卖出"自动计算持仓与均价）</div>
        {trades.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" style={{ margin: 0 }} />
        ) : (
          <Table size="small" rowKey="id" dataSource={trades} pagination={false} columns={[
            { title: '方向', dataIndex: 'side', width: 70, render: v => <span style={{ color: v === 'buy' ? '#f6465d' : '#0ecb81' }}>{v === 'buy' ? '买入' : '卖出'}</span> },
            { title: '股数', dataIndex: 'shares', align: 'right', render: v => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
            { title: '价格', dataIndex: 'price', align: 'right', render: v => Number(v).toFixed(3) },
            { title: '金额', dataIndex: 'amount', align: 'right', render: v => Number(v).toFixed(0) },
            { title: '时间', dataIndex: 'tradeTime', width: 150, render: v => (v ? String(v).replace('T', ' ').substring(5, 16) : '-') },
          ]} />
        )}
      </Modal>

      {/* 监控配置管理（列表 / 表单） */}
      <Modal
        open={cfgOpen}
        onCancel={() => setCfgOpen(false)}
        width={cfgView === 'form' ? 720 : 720}
        title={cfgView === 'form' ? '新增/编辑监控股票' : '我的监控股票'}
        footer={cfgView === 'form' ? [
          <Button key="back" onClick={() => setCfgView('list')}>返回列表</Button>,
          <Button key="save" loading={cfgSaving} onClick={saveConfig}>仅保存持仓</Button>,
        ] : null}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {cfgView === 'list' ? (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openConfig(null)}>新增监控股票</Button>
              <Button size="small" icon={<WalletOutlined />} onClick={openProfile}>总体资金配置</Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                已配置 {watchlist.length} 只；未配置时展示 .env 默认列表
              </Text>
            </Space>
            {watchlist.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置监控股票" />
            ) : (
              <Table
                size="small" rowKey="id" pagination={false} dataSource={watchlist}
                columns={[
                  { title: '名称', dataIndex: 'name', render: (v, r) => <Text strong>{v}</Text> },
                  { title: '代码', dataIndex: 'code', width: 90, render: v => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                  { title: '方向', dataIndex: 'action', width: 64, render: v => {
                    const c = { buy: '#f5b301', sell: '#7aa2f7', watch: '#8b95a7' }[v] || '#8b95a7'
                    return <span style={{ color: c }}>{({ buy: '买入', sell: '卖出', watch: '观望' }[v] || v)}</span>
                  } },
                  { title: 'AI 策略（自动生成）', key: 'strategy', render: (_, r) => (
                    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <div style={{ color: '#8b95a7' }}>
                        止损 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{r.stopLoss ? Number(r.stopLoss).toFixed(2) : '--'}</b>
                        {' '}· 加仓 <b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{r.addFund > 0 ? `${Math.round(r.addFund)}元×${r.addBatches}批` : '--'}</b>
                      </div>
                      {fmtRangeList(parseJsonSafe(r.buyRanges, []), '买') && (
                        <div style={{ color: '#f5b301' }}>{fmtRangeList(parseJsonSafe(r.buyRanges, []), '买')}</div>
                      )}
                      {fmtRangeList(parseJsonSafe(r.sellRanges, []), '卖') && (
                        <div style={{ color: '#0ecb81' }}>{fmtRangeList(parseJsonSafe(r.sellRanges, []), '卖')}</div>
                      )}
                    </div>
                  ) },
                  { title: '操作', key: 'ops', width: 110, render: (_, r) => (
                    <Space size={4}>
                      <Button size="small" type="link" onClick={() => openConfig(r)}>编辑</Button>
                      <Popconfirm title={`删除 ${r.name}（${r.code}）？`} onConfirm={() => deleteConfig(r.id)}>
                        <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                      </Popconfirm>
                    </Space>
                  ) },
                ]}
              />
            )}
          </>
        ) : (
          <>
            <Form form={cfgForm} layout="vertical" size="small">
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item name="code" label="股票代码" rules={[{ required: true, message: '必填' }]}>
                    <Input placeholder="如 600900" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="holdings_shares" label="持有数量（股）">
                    <InputNumber min={0} step={100} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="holdings_cost" label="持仓成本价">
                    <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
            <Divider plain style={{ margin: '4px 0 12px', fontSize: 12 }}>
              仅需填写 代码 / 持仓数量 / 持仓成本；股票名称经行情 API 自动获取，买卖/做T/止损/加仓计划由 LLM 依据「总体资金配置 + 个股行情 + 大盘行情 + 消息 + 财报」自动生成
            </Divider>
            <Button
              type="primary" block icon={<RobotOutlined />} loading={aiLoading}
              onClick={autoGenerate} style={{ marginBottom: 12 }}
            >
              {aiResult ? '重新生成 AI 策略' : 'AI 自动生成策略'}
            </Button>

            {aiResult && (
              <div style={{ background: '#0f1622', border: '1px solid rgba(245,179,1,.35)', borderRadius: 8, padding: '12px 14px', fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ color: '#f5b301', fontWeight: 600, marginBottom: 6 }}>
                  AI 生成配置 — {aiResult.name}（{aiResult.code}）
                </div>
                <div style={{ color: '#8b95a7' }}>
                  方向：<b style={{ color: { buy: '#f5b301', sell: '#7aa2f7', watch: '#8b95a7' }[aiResult.action] }}>{({ buy: '买入', sell: '卖出', watch: '观望' }[aiResult.action])}</b>
                  {' '}· 止损价：<b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{aiResult.stop_loss ? Number(aiResult.stop_loss).toFixed(2) : '--'}</b>
                  {' '}· 加仓：<b style={{ color: '#e8ecf3', fontFamily: 'monospace' }}>{Math.round(aiResult.add_fund || 0)}元 × {aiResult.add_batches || 1}批</b>
                </div>
                {aiResult.buy_ranges?.length > 0 && (
                  <div style={{ color: '#f5b301' }}>买入区间：{fmtRangeList(aiResult.buy_ranges, '买')}</div>
                )}
                {aiResult.sell_ranges?.length > 0 && (
                  <div style={{ color: '#0ecb81' }}>卖出区间：{fmtRangeList(aiResult.sell_ranges, '卖')}</div>
                )}
                {aiResult.t_range && (
                  <div style={{ color: '#7aa2f7' }}>
                    做T区间：低吸 {Number(aiResult.t_range.buy_low).toFixed(2)} / 高抛 {Number(aiResult.t_range.sell_high).toFixed(2)}（比例 {Math.round((aiResult.t_range.pct || 0) * 100)}%）
                  </div>
                )}
                {aiResult.reason && <div style={{ color: '#8b95a7', marginTop: 4 }}>理由：{aiResult.reason}</div>}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* 总体资金配置画像（LLM 自动配置的资金约束） */}
      <Modal
        open={profileOpen}
        onCancel={() => setProfileOpen(false)}
        width={680}
        title="总体资金配置与监控参数"
        footer={[
          <Button key="cancel" onClick={() => setProfileOpen(false)}>取消</Button>,
          <Button key="save" type="primary" onClick={saveProfileCfg}>保存</Button>,
        ]}
      >
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
          资金与风险偏好作为 AI 生成个股买卖/止损/加仓策略的资金约束；下方监控参数用于提醒与股数计算，留空则使用全局默认值。
        </Text>
        <Form form={profileForm} layout="vertical" size="small">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="total_capital" label="总可用资金（元）">
                <InputNumber min={0} step={10000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_position_pct" label="单只最大仓位（%）">
                <InputNumber min={1} max={100} step={5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="risk_level" label="风险偏好">
            <Select
              options={[
                { value: 'conservative', label: '保守' },
                { value: 'balanced', label: '稳健' },
                { value: 'aggressive', label: '激进' },
              ]}
            />
          </Form.Item>
          <Form.Item name="strategy" label="策略偏好描述（可选）">
            <Input.TextArea rows={2} placeholder="如：偏好低估值高股息，长线持有，回调分批建仓" />
          </Form.Item>
          <Divider style={{ margin: '8px 0' }} />
          <Text type="secondary" style={{ display: 'block', fontSize: 12, margin: '4px 0 8px' }}>
            监控计算参数（0~1 比例型；行业上下文开关留空则用全局默认）
          </Text>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="llm_vs_rule_weight" label="LLM 结论权重">
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} placeholder="0.5" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="llm_sell_threshold" label="LLM 卖出置信度阈值">
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} placeholder="0.6" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="llm_buy_threshold" label="LLM 买入/加仓置信度阈值">
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} placeholder="0.65" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="slippage_rate" label="滑点率">
                <InputNumber min={0} max={0.1} step={0.01} style={{ width: '100%' }} placeholder="0.01" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="max_liquidity_pct" label="单次成交占日均成交额上限">
                <InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} placeholder="0.05" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="correlation_threshold" label="组合高相关性阈值">
                <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} placeholder="0.7" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sector_enabled" label="行业/宏观上下文" valuePropName="checked">
                <Switch checkedChildren="开" unCheckedChildren="关" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="push_wxpusher_uid" label="个人微信 UID（扫码关注后收到，保存即绑定）">
            <Input placeholder="关注后微信收到的 UID_xxxx，填入后保存" allowClear />
          </Form.Item>
        </Form>

        <Divider style={{ margin: '12px 0' }} />
        {/* 2026-08-20: 个人微信推送（WxPusher 扫码绑定） */}
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
          用微信扫描下方二维码关注「股票财报推送」，关注后微信会收到你的 UID，填入上方「个人微信 UID」并保存，即可把该用户监控股票的财报日报推送到你的微信消息。
        </Text>
        {pushCfg.wxpusher_configured ? (
          <Row gutter={16} align="middle">
            <Col span={7} style={{ textAlign: 'center' }}>
              {pushCfg.wxpusher_qrcode ? (
                <img src={pushCfg.wxpusher_qrcode} alt="微信扫码绑定" style={{ width: 132, height: 132, border: '1px solid #444', borderRadius: 6 }} />
              ) : (
                <Text type="danger" style={{ fontSize: 12 }}>二维码加载失败{pushCfg.wxpusher_error ? `：${pushCfg.wxpusher_error}` : ''}</Text>
              )}
              <div><Text type="secondary" style={{ fontSize: 11 }}>微信扫码关注{pushCfg.wxpusher_app_name || ''}</Text></div>
            </Col>
            <Col span={17}>
              {pushCfg.bound_uid && <Tag color="green" style={{ marginBottom: 8 }}>已绑定：{pushCfg.bound_uid}</Tag>}
              <Button size="small" loading={wxTestLoading} onClick={sendWxTest} icon={<SendOutlined />}>
                发送测试消息到微信（需先保存 UID）
              </Button>
              <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
                绑定成功后，点右上角「推送财报日报」即可把该用户监控股票的财报推送至个人微信。
              </Text>
            </Col>
          </Row>
        ) : (
          <Alert type="warning" showIcon message="管理员尚未配置微信推送（WxPusher AppToken）"
            description="请管理员在部署配置（.env 的 stock-monitor.push.wxpusher-app-token）中填写 WxPusher 应用令牌后，本页面即可扫码绑定。" />
        )}
      </Modal>
    </div>
  )
}

/** 按日期分组历史研报。 */
function groupByDate(reports) {
  const groups = {}
  reports.forEach(r => { (groups[r.date] = groups[r.date] || []).push(r) })
  return Object.keys(groups).sort().reverse().map(date => ({ date, items: groups[date] }))
}

/** 2026-08-20: 金额格式化（元 → 亿/万）。 */
function finFmt(v) {
  const n = Number(v)
  if (v === null || v === undefined || isNaN(n)) return '--'
  return Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(2)}亿` : (Math.abs(n) >= 1e4 ? `${(n / 1e4).toFixed(0)}万` : n.toFixed(0))
}

/** 2026-08-20: 数值格式化，suffix 如 '%'。 */
function finNumFmt(v, suffix = '') {
  const n = Number(v)
  if (v === null || v === undefined || isNaN(n)) return '--'
  return `${n.toFixed(2)}${suffix}`
}

/** 区间列表摘要（如 "买: 10.0-10.5；买: 9.5-10.0"）。 */
function fmtRangeList(ranges, prefix) {
  if (!Array.isArray(ranges) || ranges.length === 0) return ''
  const parts = ranges
    .filter(r => r && (r.low !== undefined || r.high !== undefined))
    .map(r => `${r.level ? r.level + ' ' : ''}${r.low ?? '-'}-${r.high ?? '-'}${r.pct != null ? `(${Math.round(r.pct * 100)}%)` : ''}`)
  return parts.length ? `${prefix}: ${parts.join('；')}` : ''
}

/** API 成功率圆环。 */
function ApiDonut({ ok, fail }) {
  const total = ok + fail
  if (!total) return <div style={{ width: 96, height: 96 }} />
  const r = 42
  const c = 2 * Math.PI * r
  const frac = ok / total
  return (
    <svg viewBox="0 0 100 100" width={96} height={96}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(246,70,93,.25)" strokeWidth="12" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#0ecb81" strokeWidth="12"
        strokeDasharray={`${frac * c} ${c}`} strokeLinecap="butt" transform="rotate(-90 50 50)" />
      <text x="50" y="48" textAnchor="middle" fill="#e8ecf3" fontSize="18" fontFamily="Consolas,monospace" fontWeight="700">{Math.round(frac * 100)}%</text>
      <text x="50" y="66" textAnchor="middle" fill="#8b95a7" fontSize="9" fontFamily="Consolas,monospace">成功率</text>
    </svg>
  )
}

/** 简易 K 线图（SVG，复刻 Python 仪表盘 drawKline）。 */
function KlineChart({ klines }) {
  if (!klines || klines.length === 0) {
    return <div style={{ color: '#5b6577', textAlign: 'center', padding: 24 }}>暂无K线数据</div>
  }
  const W = 760, CH = 220, VH = 50, PAD = 12
  const H = CH + VH + 30
  let hi = -Infinity, lo = Infinity, maxVol = 0
  klines.forEach(k => {
    hi = Math.max(hi, k.high); lo = Math.min(lo, k.low); maxVol = Math.max(maxVol, k.volume || 0)
  })
  const span = (hi - lo) || 1
  const n = klines.length
  const cw = (W - PAD * 2) / n
  const y = v => PAD + (hi - v) / span * (CH - PAD * 2)
  const yv = v => CH + 8 + (1 - v / maxVol) * (VH - 12)
  const elements = []
  for (let i = 0; i <= 4; i++) {
    const yy = PAD + i * (CH - PAD * 2) / 4
    const pv = hi - i * span / 4
    elements.push(<line key={`g${i}`} x1={PAD} y1={yy} x2={W - PAD} y2={yy} stroke="rgba(255,255,255,.05)" />)
    elements.push(<text key={`gt${i}`} x={W - PAD + 4} y={yy + 4} fill="#5b6577" fontSize={10} fontFamily="Consolas,monospace">{pv.toFixed(2)}</text>)
  }
  elements.push(<line key="volbase" x1={PAD} y1={CH + 6} x2={W - PAD} y2={CH + 6} stroke="rgba(255,255,255,.08)" />)
  klines.forEach((k, i) => {
    const x = PAD + i * cw + cw / 2
    const up = k.close >= k.open
    const col = up ? '#f6465d' : '#0ecb81'
    const wickW = Math.max(1, cw * 0.08)
    elements.push(<line key={`w${i}`} x1={x} y1={y(k.high)} x2={x} y2={y(k.low)} stroke={col} strokeWidth={wickW} />)
    const bw = Math.max(2, cw * 0.55)
    const y1 = y(Math.max(k.open, k.close)), y2 = y(Math.min(k.open, k.close))
    elements.push(<rect key={`c${i}`} x={x - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)} fill={col} rx={1} />)
    const vh = (1 - (k.volume || 0) / maxVol) * (VH - 12)
    elements.push(<rect key={`v${i}`} x={x - bw / 2} y={CH + 8 + vh} width={bw} height={Math.max(1, VH - 12 - vh)} fill={col} opacity={0.35} rx={1} />)
    if (i % Math.ceil(n / 8) === 0) {
      elements.push(<text key={`d${i}`} x={x} y={H - 6} fill="#5b6577" fontSize={9} fontFamily="Consolas,monospace" textAnchor="middle">{String(k.date).slice(5)}</text>)
    }
  })
  return (
    <div style={{ width: '100%', overflowX: 'auto', marginTop: 6 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', minWidth: 520 }}>{elements}</svg>
    </div>
  )
}
