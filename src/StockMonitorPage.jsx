import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Card, Tag, Typography, Space, Button, Tooltip, Table, Empty, Spin,
  Segmented, Modal, InputNumber, Input, Form, Popconfirm, Divider, message, Row, Col
} from 'antd'
import {
  ReloadOutlined, CheckCircleFilled, CloseCircleFilled, CopyOutlined,
  LineChartOutlined, BellOutlined, FileSearchOutlined, RocketOutlined,
  SettingOutlined, PlusOutlined, DeleteOutlined
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
  const [posEdit, setPosEdit] = useState(null)          // { shares, cost }
  const [posSaving, setPosSaving] = useState(false)
  // 用户监控配置管理
  const [watchlist, setWatchlist] = useState([])
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfgView, setCfgView] = useState('list')  // 'list' | 'form'
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgForm] = Form.useForm()

  const countdownRef = useRef(10)

  const loadWatchlist = useCallback(async () => {
    try {
      const r = await api.get('/stock-monitor/watchlist')
      setWatchlist(Array.isArray(r.data) ? r.data : [])
    } catch (e) { setWatchlist([]) }
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

  useEffect(() => {
    loadAll()
    loadWatchlist()
    api.get('/stock-monitor/portfolio').then(r => setPortfolio(r.data?.positions || {})).catch(() => {})
  }, [loadAll, loadWatchlist])

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
    const buyRanges = item ? parseJsonSafe(item.buyRanges, []) : []
    const sellRanges = item ? parseJsonSafe(item.sellRanges, []) : []
    const tRange = item ? parseJsonSafe(item.tRange, null) : null
    cfgForm.setFieldsValue({
      id: item?.id, code: item?.code, name: item?.name, action: item?.action || 'watch',
      holdings_shares: item?.holdingsShares, holdings_cost: item?.holdingsCost,
      add_fund: item?.addFund, add_batches: item?.addBatches,
      stop_loss: item?.stopLoss,
      buy_ranges: Array.isArray(buyRanges) ? buyRanges : [],
      sell_ranges: Array.isArray(sellRanges) ? sellRanges : [],
      t_buy_low: tRange?.buy_low, t_sell_high: tRange?.sell_high, t_pct: tRange?.pct,
    })
    setCfgView('form')
    setCfgOpen(true)
  }

  const openConfigList = () => {
    cfgForm.resetFields()
    setCfgView('list')
    setCfgOpen(true)
  }

  const saveConfig = async () => {
    let values
    try { values = await cfgForm.validateFields() } catch (e) { return }
    setCfgSaving(true)
    try {
      const payload = {
        code: values.code,
        name: values.name || values.code,
        action: values.action || 'watch',
        holdings_shares: values.holdings_shares || 0,
        holdings_cost: values.holdings_cost || 0,
        add_fund: values.add_fund || 0,
        add_batches: values.add_batches || 1,
        stop_loss: values.stop_loss ?? null,
        buy_ranges: JSON.stringify(Array.isArray(values.buy_ranges) ? values.buy_ranges.filter(r => r && r.low) : []),
        sell_ranges: JSON.stringify(Array.isArray(values.sell_ranges) ? values.sell_ranges.filter(r => r && r.low) : []),
        t_range: (values.t_buy_low || values.t_sell_high)
          ? JSON.stringify({ buy_low: values.t_buy_low, sell_high: values.t_sell_high, pct: values.t_pct || 0.3 })
          : null,
      }
      const r = await api.post('/stock-monitor/watchlist', payload)
      if (!r.data?.ok) { message.error(r.data?.msg || '保存失败'); return }
      message.success('监控配置已保存')
      setCfgOpen(false)
      await Promise.all([loadWatchlist(), loadAll()])
      api.get('/stock-monitor/portfolio').then(rr => setPortfolio(rr.data?.positions || {})).catch(() => {})
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.message || e.message))
    }
    setCfgSaving(false)
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
          <Button icon={<SettingOutlined />} onClick={openConfigList}>
            配置监控股票
          </Button>
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
                        </>
                      )}
                    </div>

                    <div style={{ marginTop: 6 }}><KlineChart klines={kline} /></div>

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
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', fontSize: 14, lineHeight: 1.8 } }}
      >
        {reportModal?.content ? <ReactMarkdown>{reportModal.content}</ReactMarkdown> : <Empty />}
      </Modal>

      {/* 监控配置管理（列表 / 表单） */}
      <Modal
        open={cfgOpen}
        onCancel={() => setCfgOpen(false)}
        width={cfgView === 'form' ? 760 : 640}
        title={cfgView === 'form' ? '监控股票配置' : '我的监控股票'}
        footer={cfgView === 'form' ? [
          <Button key="back" onClick={() => setCfgView('list')}>返回列表</Button>,
          <Button key="save" type="primary" loading={cfgSaving} onClick={saveConfig}>保存</Button>,
        ] : null}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {cfgView === 'list' ? (
          <>
            <Space style={{ marginBottom: 12 }}>
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openConfig(null)}>新增监控股票</Button>
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
                  { title: '代码', dataIndex: 'code', render: v => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                  { title: '方向', dataIndex: 'action', width: 60, render: v => {
                    const c = { buy: '#f5b301', sell: '#7aa2f7', watch: '#8b95a7' }[v] || '#8b95a7'
                    return <span style={{ color: c }}>{({ buy: '买入', sell: '卖出', watch: '观望' }[v] || v)}</span>
                  } },
                  { title: '持有', key: 'holdings', width: 110, render: (_, r) => (
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {r.holdingsShares > 0 ? `${r.holdingsShares}股 @${Number(r.holdingsCost).toFixed(3)}` : '--'}
                    </span>
                  ) },
                  { title: '操作', key: 'ops', width: 120, render: (_, r) => (
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
          <Form form={cfgForm} layout="vertical" size="small">
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item name="code" label="股票代码" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="如 600900" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="name" label="股票名称">
                  <Input placeholder="如 长江电力（留空则用代码）" />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="action" label="操作方向">
                  <Input placeholder="buy/sell/watch" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
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
              <Col span={8}>
                <Form.Item name="stop_loss" label="止损价">
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="add_fund" label="计划新增资金（元）">
                  <InputNumber min={0} step={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="add_batches" label="加仓分批次数">
                  <InputNumber min={1} step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Divider plain style={{ margin: '8px 0', fontSize: 12 }}>买入区间（可多行）</Divider>
            <Form.List name="buy_ranges">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 4 }} {...rest}>
                      <Form.Item name={[name, 'low']} noStyle><InputNumber placeholder="low" step={0.01} style={{ width: 110 }} /></Form.Item>
                      <Form.Item name={[name, 'high']} noStyle><InputNumber placeholder="high" step={0.01} style={{ width: 110 }} /></Form.Item>
                      <Form.Item name={[name, 'level']} noStyle><Input placeholder="备注（如 首配加仓）" style={{ width: 160 }} /></Form.Item>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                    </Space>
                  ))}
                  <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>加一行买入区间</Button>
                </>
              )}
            </Form.List>

            <Divider plain style={{ margin: '12px 0 8px', fontSize: 12 }}>卖出区间（可多行）</Divider>
            <Form.List name="sell_ranges">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...rest }) => (
                    <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 4 }} {...rest}>
                      <Form.Item name={[name, 'low']} noStyle><InputNumber placeholder="low" step={0.01} style={{ width: 100 }} /></Form.Item>
                      <Form.Item name={[name, 'high']} noStyle><InputNumber placeholder="high" step={0.01} style={{ width: 100 }} /></Form.Item>
                      <Form.Item name={[name, 'pct']} noStyle><InputNumber placeholder="卖出比例" step={0.01} style={{ width: 100 }} /></Form.Item>
                      <Form.Item name={[name, 'level']} noStyle><Input placeholder="备注" style={{ width: 120 }} /></Form.Item>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                    </Space>
                  ))}
                  <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>加一行卖出区间</Button>
                </>
              )}
            </Form.List>

            <Divider plain style={{ margin: '12px 0 8px', fontSize: 12 }}>做T区间（箱体高抛低吸）</Divider>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="t_buy_low" label="做T下沿（低吸）">
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="t_sell_high" label="做T上沿（高抛）">
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="t_pct" label="做T比例">
                  <InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
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
