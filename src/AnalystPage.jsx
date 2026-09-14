import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  Card, Typography, Space, Button, Empty, Spin, message,
  Input, Select, InputNumber, Tag
} from 'antd'
import {
  RocketOutlined, HistoryOutlined, CopyOutlined, PlusOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import api from './auth'

const { Text, Title } = Typography

/**
 * 定制分析师独立页。
 *
 * <ul>
 *   <li>选择预设角色（可留空需求直接按该角色筛选框架一键运行）</li>
 *   <li>输出 markdown 研究报告（简体中文、不编造、标待核实）</li>
 *   <li>历史分析记录：点击回看全文；每条记录可「补充财报数据」——输入股票代码，直连同花顺
 *       完整财报（利润表/资产负债表/现金流量表）并追加到该记录</li>
 * </ul>
 */
export default function AnalystPage() {
  const [personas, setPersonas] = useState([])
  const [persona, setPersona] = useState('')
  const [query, setQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState('')
  const [reportTitle, setReportTitle] = useState('')
  const [currentId, setCurrentId] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  // 补充财报
  const [suppCode, setSuppCode] = useState('')
  const [suppPeriods, setSuppPeriods] = useState(4)
  const [supplying, setSupplying] = useState(false)
  // 后台『待核实项核查』状态（true=核查进行中）
  const [verifying, setVerifying] = useState(false)
  const verifyTimer = useRef(null)

  const clearVerifyTimer = () => { if (verifyTimer.current) { clearTimeout(verifyTimer.current); verifyTimer.current = null } }
  useEffect(() => clearVerifyTimer, [])

  // 主报告即时展示后，后台子代理核查『待核实』项；轮询状态，核查完成自动刷新报告
  const pollVerify = useCallback((id) => {
    if (!id) return
    const deadline = Date.now() + 120000
    const tick = async () => {
      let done = false; let failed = false
      try {
        const r = await api.get('/stock-monitor/analyst/verify-status', { params: { id } })
        const st = r.data?.status
        done = st === 'done'
        failed = st === 'failed'
      } catch (_) { /* 网络抖动忽略，继续轮询 */ }
      if (done || failed || Date.now() >= deadline) {
        setVerifying(false); verifyTimer.current = null
        try {
          const rr = await api.get('/stock-monitor/analyst/record', { params: { id } })
          if (rr.data?.ok) {
            setReport(rr.data.text)
            if (done) message.success('待核实项核查完成，报告已更新')
            else if (failed) message.info('待核实项核查未完成（部分信息仍待核实）')
          }
        } catch (_) { /* 读取失败不阻断 */ }
        return
      }
      verifyTimer.current = setTimeout(tick, 4000)
    }
    tick()
  }, [])

  const loadPersonas = useCallback(async () => {
    try {
      const r = await api.get('/stock-monitor/analyst/personas')
      const list = r.data || []
      setPersonas(list)
      if (list.length) setPersona((cur) => cur || list[0].id)
    } catch (e) {
      message.error('加载分析师角色失败: ' + (e.response?.data?.message || e.message))
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const r = await api.get('/stock-monitor/analyst/history')
      setHistory(r.data?.records || [])
    } catch (e) {
      message.error('加载历史记录失败: ' + (e.response?.data?.message || e.message))
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadPersonas(); loadHistory() }, [loadPersonas, loadHistory])

  const runAnalyst = async () => {
    if (!persona) { message.warning('请先选择分析师角色'); return }
    setRunning(true)
    setReport('')
    setReportTitle('正在生成报告…')
    try {
      const r = await api.post('/stock-monitor/analyst/run', { personaId: persona, query })
      const data = r.data || {}
      if (data.ok) {
        setReport(data.text || '')
        setCurrentId(data.id || null)
        setReportTitle(data.createdAt
          ? `${personas.find(p => p.id === persona)?.name || persona} · ${data.createdAt}`
          : `${personas.find(p => p.id === persona)?.name || persona}`)
        setSuppCode('')
        clearVerifyTimer()
        if (data.verifyPending && data.id) { setVerifying(true); pollVerify(data.id) }
        else setVerifying(false)
      } else {
        setReport('>>> ' + (data.text || '分析失败'))
        setReportTitle('')
        setCurrentId(null)
        setVerifying(false)
      }
      loadHistory()
    } catch (e) {
      setReport('>>> 分析失败: ' + (e.response?.data?.message || e.message))
    } finally {
      setRunning(false)
    }
  }

  const openRecord = async (id, item) => {
    setCurrentId(id)
    setReportTitle(item.time ? `${item.personaId} · ${item.time}` : item.personaId)
    setSuppCode('')
    try {
      const r = await api.get('/stock-monitor/analyst/record', { params: { id } })
      setReport(r.data?.ok ? r.data.text : (r.data?.error || '记录不存在'))
    } catch (e) {
      setReport('>>> 读取记录失败: ' + (e.response?.data?.message || e.message))
    }
  }

  const supplement = async () => {
    if (!currentId) { message.warning('请先运行分析或打开一条历史记录，再补充财报'); return }
    if (!suppCode.trim()) { message.warning('请输入股票代码'); return }
    setSupplying(true)
    try {
      const r = await api.post('/stock-monitor/analyst/supplement', {
        id: currentId, code: suppCode.trim(), periods: suppPeriods, name: ''
      })
      const data = r.data || {}
      if (data.ok) {
        setReport(data.text)
        message.success(`已补充 ${suppCode.trim()} 的同花顺财报`)
      } else {
        message.error(data.error || '补充失败')
      }
    } catch (e) {
      message.error('补充失败: ' + (e.response?.data?.message || e.message))
    } finally {
      setSupplying(false)
    }
  }

  const copy = async () => {
    if (!report) return
    try { await navigator.clipboard.writeText(report); message.success('已复制全文') }
    catch { message.error('复制失败') }
  }

  // ── 历史记录展示优化：角色名映射 + 按人物过滤 + 按日期分组 + 相对时间 ──
  const personaMap = useMemo(() => new Map(personas.map(p => [p.id, p])), [personas])
  const personaName = (id) => personaMap.get(id)?.name || id || '未知角色'
  const [filterPersona, setFilterPersona] = useState('')

  const formatRelTime = (ms) => {
    if (!ms) return ''
    const diff = Date.now() - ms
    const m = Math.floor(diff / 60000)
    if (m < 1) return '刚刚'
    if (m < 60) return `${m} 分钟前`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} 小时前`
    if (h < 24 * 7) return `${Math.floor(h / 24)} 天前`
    return new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }
  const formatAbsolute = (ms) => {
    if (!ms) return ''
    return new Date(ms).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })
  }

  // history 已按创建时间倒序；把毫秒解析出来并归入 今天/昨天/近7天/更早 分桶
  const historyGroups = useMemo(() => {
    const list = (filterPersona ? history.filter(h => h.personaId === filterPersona) : history).slice()
    const now = new Date(); const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const yesterdayStart = new Date(todayStart.getTime() - 86400000)
    const weekStart = new Date(todayStart.getTime() - 7 * 86400000)
    const order = ['今天', '昨天', '近 7 天', '更早']
    const buckets = new Map()
    for (const h of list) {
      const ms = Number(h.date)
      const d = new Date(isNaN(ms) ? 0 : ms)
      let label
      if (isNaN(ms) || ms === 0) label = '更早'
      else if (d >= todayStart) label = '今天'
      else if (d >= yesterdayStart) label = '昨天'
      else if (d >= weekStart) label = '近 7 天'
      else label = '更早'
      if (!buckets.has(label)) buckets.set(label, [])
      buckets.get(label).push({ ...h, ms: isNaN(ms) ? 0 : ms })
    }
    return order.filter(l => buckets.has(l)).map(l => ({ label: l, items: buckets.get(l) }))
  }, [history, filterPersona])

  return (
    <div style={{ padding: 16, minHeight: '100%', boxSizing: 'border-box' }}>
      <Space style={{ marginBottom: 12 }} size={16} align="center">
        <Title level={4} style={{ margin: 0 }}>定制分析师</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>独立研究页 · 历史记录可回看与补充同花顺财报</Text>
      </Space>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左：运行 */}
        <Card size="small" style={{ width: 360, flexShrink: 0 }}
          title={<Space><RocketOutlined />运行分析师</Space>}>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Select
              placeholder="选择分析师角色" style={{ width: '100%' }} value={persona}
              onChange={setPersona} options={personas.map(p => ({ value: p.id, label: p.name }))}
            />
            {personas.find(p => p.id === persona)?.description && (
              <div style={{ fontSize: 11, color: '#8b94a7', lineHeight: 1.5 }}>
                {personas.find(p => p.id === persona).description}
              </div>
            )}
            <Input.TextArea
              placeholder="补充需求（可选）：留空则直接按所选角色的筛选框架一键执行"
              value={query} onChange={e => setQuery(e.target.value)}
              autoSize={{ minRows: 1, maxRows: 4 }}
            />
            <Button type="primary" icon={<RocketOutlined />} loading={running} onClick={runAnalyst}
              style={{ width: '100%' }}>
              {running ? '分析师采集中…' : '开始分析'}
            </Button>
            {running && <Text type="secondary" style={{ fontSize: 11 }}>正在收集行情/财报/新闻数据并生成结构化报告…</Text>}
          </Space>
        </Card>

        {/* 中：报告 */}
        <Card size="small" style={{ flex: 1, minWidth: 0 }}
          title={<Space>{reportTitle || '研究报告'}{verifying && <Tag icon={<Spin size="small" />} color="processing">后台核查待核实项…</Tag>}</Space>} extra={
            report && !report.startsWith('>>>') ? (
              <Space size={8}>
                <Button size="small" icon={<CopyOutlined />} onClick={copy}>复制全文</Button>
              </Space>
            ) : null
          }>
          {report ? <ReactMarkdown>{report}</ReactMarkdown>
            : <Empty description={running ? undefined : '选择角色后点击「开始分析」生成报告，或从右侧历史记录打开一则'} />}
        </Card>

        {/* 右：历史 + 补充 */}
        <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card size="small"
            title={<Space><HistoryOutlined />历史记录</Space>}
            extra={<Text type="secondary" style={{ fontSize: 11 }}>{history.length} 条</Text>}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Select
                allowClear placeholder="全部角色" style={{ width: '100%' }} size="small"
                value={filterPersona || undefined} onChange={v => setFilterPersona(v || '')}
                options={personas.map(p => ({ value: p.id, label: p.name }))}
              />
              {historyLoading ? <Spin /> : historyGroups.length ? (
                <div style={{ maxHeight: 400, overflow: 'auto' }}>
                  {historyGroups.map(g => (
                    <div key={g.label} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#5b6577', fontWeight: 600, padding: '2px 4px' }}>
                        {g.label}
                      </div>
                      {g.items.map(it => (
                        <div key={it.id} onClick={() => openRecord(it.id, it)}
                          style={{
                            padding: '6px 8px', borderRadius: 6, cursor: 'pointer', marginTop: 2,
                            background: currentId === it.id ? '#1f2d3d' : 'transparent',
                            border: currentId === it.id ? '1px solid #15324e' : '1px solid transparent',
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Tag color="blue" style={{ marginInlineEnd: 4, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {personaName(it.personaId)}
                            </Tag>
                            <Text style={{ fontSize: 11, color: '#5b6577', flexShrink: 0 }}
                              title={it.time || formatAbsolute(it.ms)}>
                              {it.ms ? formatRelTime(it.ms) : (it.time || '')}
                            </Text>
                          </div>
                          <div style={{ fontSize: 12, color: '#8892a6', marginTop: 2,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {it.snippet || '(空报告)'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : <Empty description={filterPersona ? '该角色暂无记录' : '暂无历史记录'} />}
            </Space>
          </Card>

          <Card size="small"
            title={<Space><PlusOutlined />补充财报数据（同花顺）</Space>}>
            <Space direction="vertical" style={{ width: '100%' }} size={6}>
              <Input placeholder="股票代码，如 300750" value={suppCode}
                onChange={e => setSuppCode(e.target.value)} />
              <Space size={8}>
                <Text style={{ fontSize: 12 }}>期数</Text>
                <InputNumber min={1} max={10} value={suppPeriods} onChange={setSuppPeriods} size="small" />
                <Button size="small" type="primary" loading={supplying} onClick={supplement}
                  disabled={!suppCode.trim()}>补充</Button>
              </Space>
              <Text type="secondary" style={{ fontSize: 11 }}>
                直连同花顺利润表/资产负债表/现金流量表，追加到当前报告记录。
              </Text>
            </Space>
          </Card>
        </div>
      </div>
    </div>
  )
}