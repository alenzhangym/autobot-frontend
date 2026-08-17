import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Row, Col, Card, Statistic, Table, Tag, Spin, Empty, Tabs, Space, DatePicker, Button, Typography } from 'antd'
import { ReloadOutlined, DollarOutlined, AccountBookOutlined, PercentageOutlined, ShoppingOutlined, BarChartOutlined, ShoppingCartOutlined, InboxOutlined, DatabaseOutlined, RiseOutlined } from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend } from 'recharts'
import api from './auth'
import { isSuperAdmin as isSuperAdminFn, isCompanyAdmin as isCompanyAdminFn } from './utils/permissions.js'

const { Content } = Layout
const { Text } = Typography
const { RangePicker } = DatePicker

const money = (v) => (v != null ? '¥' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')
const num = (v) => (v != null ? Number(v).toLocaleString('zh-CN') : '—')
const pct = (v) => (v != null ? Number(v).toFixed(2) + '%' : '—')

const profitColor = (v) => {
  const n = Number(v)
  if (n > 0) return '#52c41a'
  if (n < 0) return '#ff4d4f'
  return '#e3e3e3'
}
const subText = (color) => ({ color, fontSize: 12, marginTop: 4 })

function StatCard({ title, value, sub, color = '#e3e3e3', prefix, precision = 2 }) {
  return (
    <Card size="small" style={{ background: '#141414', border: '1px solid #222', height: '100%' }}>
      <Statistic title={title} value={value} prefix={prefix} precision={precision}
        valueStyle={{ color, fontWeight: 600, fontSize: 22 }} />
      {sub && <div style={subText('#888')}>{sub}</div>}
    </Card>
  )
}

export default function ProfitAnalysis({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const isCompanyAdmin = isCompanyAdminFn(user)
  const canView = isSuperAdmin || isCompanyAdmin
  const [effectiveCompanyId, setEffectiveCompanyId] = useState(isSuperAdmin ? 0 : (user?.companyId || 0))

  const [range, setRange] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      if (range && range[0]) params.dateFrom = range[0].format('YYYY-MM-DD')
      if (range && range[1]) params.dateTo = range[1].format('YYYY-MM-DD')
      const res = await api.get('/erp/profit/summary', { params })
      setData(res.data?.data || null)
    } catch (e) {
      setError(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }, [effectiveCompanyId, isSuperAdmin, range])

  useEffect(() => { if (canView) fetchData() }, [fetchData, canView])

  if (!canView) {
    return (
      <Layout style={{ background: '#0d0d0d', height: '100%' }}>
        <Content style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: '#ff4d4f', fontSize: 16, marginTop: 60 }}>
            <DollarOutlined style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            经销存利润分析仅对公司管理员 (COMPANY_ADMIN) 开放
            <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>当前角色: {user?.role || '未知'}</div>
          </div>
        </Content>
      </Layout>
    )
  }

  const totals = data?.totals || {}
  const overview = data?.overview || {}
  const byPart = data?.byPart || []
  const byCustomer = data?.byCustomer || []
  const byMonth = data?.byMonth || []
  const inventory = data?.inventory || []

  const partColumns = [
    { title: '品类', dataIndex: 'partType', key: 'partType', width: 90, render: v => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '型号', dataIndex: 'model', key: 'model', width: 180, ellipsis: true, render: v => <Text code style={{ fontSize: 12 }}>{v || '-'}</Text> },
    { title: '厂家', dataIndex: 'manufacturer', key: 'manufacturer', width: 100, ellipsis: true, render: v => v || '-' },
    { title: '预期销售', dataIndex: 'expectedSales', key: 'expectedSales', width: 110, align: 'right', render: v => money(v) },
    { title: '预期采购', dataIndex: 'expectedPurchase', key: 'expectedPurchase', width: 110, align: 'right', render: v => money(v) },
    {
      title: '预期毛利', dataIndex: 'expectedProfit', key: 'expectedProfit', width: 110, align: 'right',
      render: v => <span style={{ color: profitColor(v), fontWeight: 600 }}>{money(v)}</span>,
    },
    { title: '真实入库', dataIndex: 'actualInboundCost', key: 'actualInboundCost', width: 110, align: 'right', render: v => money(v) },
    { title: '出库数量', dataIndex: 'qty', key: 'qty', width: 90, align: 'right', render: v => num(v) },
    { title: '出库收入', dataIndex: 'revenue', key: 'revenue', width: 110, align: 'right', render: v => money(v) },
    { title: '出库成本', dataIndex: 'cost', key: 'cost', width: 110, align: 'right', render: v => money(v) },
    {
      title: '已实现毛利', dataIndex: 'profit', key: 'profit', width: 110, align: 'right',
      render: v => <span style={{ color: profitColor(v), fontWeight: 600 }}>{money(v)}</span>,
    },
    { title: '毛利率', dataIndex: 'margin', key: 'margin', width: 90, align: 'right', render: v => <Tag color={Number(v) >= 0 ? 'green' : 'red'}>{pct(v)}</Tag> },
    { title: '库存', dataIndex: 'onHandQty', key: 'onHandQty', width: 90, align: 'right', render: v => num(v) },
    { title: '库存成本', dataIndex: 'inventoryCostValue', key: 'inventoryCostValue', width: 110, align: 'right', render: v => money(v) },
    { title: '库存销售', dataIndex: 'inventorySalesValue', key: 'inventorySalesValue', width: 110, align: 'right', render: v => money(v) },
    {
      title: '库存潜在毛利', dataIndex: 'inventoryProfit', key: 'inventoryProfit', width: 120, align: 'right',
      render: v => <span style={{ color: profitColor(v), fontWeight: 600 }}>{money(v)}</span>,
    },
  ]

  const customerColumns = [
    { title: '客户', dataIndex: 'customerName', key: 'customerName', width: 200, ellipsis: true },
    { title: '数量', dataIndex: 'qty', key: 'qty', width: 90, align: 'right', render: v => num(v) },
    { title: '营收', dataIndex: 'revenue', key: 'revenue', width: 110, align: 'right', render: v => money(v) },
    { title: '成本', dataIndex: 'cost', key: 'cost', width: 110, align: 'right', render: v => money(v) },
    { title: '毛利', dataIndex: 'profit', key: 'profit', width: 110, align: 'right', render: v => <span style={{ color: profitColor(v), fontWeight: 600 }}>{money(v)}</span> },
    { title: '毛利率', dataIndex: 'margin', key: 'margin', width: 90, align: 'right', render: v => <Tag color={Number(v) >= 0 ? 'green' : 'red'}>{pct(v)}</Tag> },
  ]

  const monthColumns = [
    { title: '月份', dataIndex: 'month', key: 'month', width: 100 },
    { title: '数量', dataIndex: 'qty', key: 'qty', width: 90, align: 'right', render: v => num(v) },
    { title: '营收', dataIndex: 'revenue', key: 'revenue', width: 110, align: 'right', render: v => money(v) },
    { title: '成本', dataIndex: 'cost', key: 'cost', width: 110, align: 'right', render: v => money(v) },
    { title: '毛利', dataIndex: 'profit', key: 'profit', width: 110, align: 'right', render: v => <span style={{ color: profitColor(v), fontWeight: 600 }}>{money(v)}</span> },
    { title: '毛利率', dataIndex: 'margin', key: 'margin', width: 90, align: 'right', render: v => <Tag color={Number(v) >= 0 ? 'green' : 'red'}>{pct(v)}</Tag> },
  ]

  const invColumns = [
    { title: '品类', dataIndex: 'partType', key: 'partType', width: 90, render: v => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '型号', dataIndex: 'model', key: 'model', width: 220, ellipsis: true, render: v => <Text code style={{ fontSize: 12 }}>{v || '-'}</Text> },
    { title: '厂家', dataIndex: 'manufacturer', key: 'manufacturer', width: 120, ellipsis: true, render: v => v || '-' },
    { title: '库存数量', dataIndex: 'onHandQty', key: 'onHandQty', width: 100, align: 'right', render: v => num(v) },
    { title: '单位成本', dataIndex: 'unitCost', key: 'unitCost', width: 100, align: 'right', render: v => money(v) },
    { title: '单位售价', dataIndex: 'unitSale', key: 'unitSale', width: 100, align: 'right', render: v => money(v) },
    { title: '库存成本价值', dataIndex: 'inventoryCostValue', key: 'inventoryCostValue', width: 120, align: 'right', render: v => money(v) },
    { title: '库存销售价值', dataIndex: 'inventorySalesValue', key: 'inventorySalesValue', width: 120, align: 'right', render: v => money(v) },
    {
      title: '库存潜在毛利', dataIndex: 'inventoryProfit', key: 'inventoryProfit', width: 130, align: 'right',
      render: v => <span style={{ color: profitColor(v), fontWeight: 600 }}>{money(v)}</span>,
    },
  ]

  const sectionTitle = (text) => (
    <div style={{ color: '#e3e3e3', fontWeight: 600, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 4, height: 16, background: '#1677ff', borderRadius: 2 }} />{text}
    </div>
  )

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <h2 style={{ color: '#e3e3e3', margin: 0 }}>经销存利润分析</h2>
          <Space wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>日期范围仅影响「出库期间趋势 / 客户 / 月度」；预期销售·预期采购·真实出入库·库存为全期口径</Text>
            <RangePicker
              value={range}
              onChange={setRange}
              allowClear
              style={{ background: '#141414', borderColor: '#333' }}
              placeholder={['出库日期起', '出库日期止']}
            />
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>刷新</Button>
          </Space>
        </div>

        {error && (
          <Card size="small" style={{ marginBottom: 16, background: '#1f1414', border: '1px solid #4d1f1f' }}>
            <div style={{ color: '#ff4d4f' }}>加载失败: {error}</div>
          </Card>
        )}

        {loading ? (
          <Layout style={{ background: '#0d0d0d', height: '60vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Spin size="large" tip="统计分析中..." />
          </Layout>
        ) : (
          <>
            {/* ── 1. 四项基础：预期销售/预期采购/真实出库/真实入库 ── */}
            <Card size="small" style={{ background: '#111318', border: '1px solid #222', marginBottom: 16 }} headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
              {sectionTitle('一、经营金额总览（预期 vs 真实）')}
              <Row gutter={16}>
                <Col xs={12} md={6}>
                  <StatCard title="预期销售" value={overview.expectedSales || 0} prefix={<DollarOutlined />} color="#1677ff"
                    sub={`数量 ${num(overview.expectedSalesQty)}`} />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="预期采购" value={overview.expectedPurchase || 0} prefix={<ShoppingCartOutlined />} color="#fa8c16"
                    sub={`数量 ${num(overview.expectedPurchaseQty)}`} />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="真实出库收入" value={overview.actualOutboundRevenue || 0} prefix={<ShoppingOutlined />} color="#52c41a"
                    sub={`数量 ${num(overview.actualOutboundQty)}`} />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="真实入库花费" value={overview.actualInboundCost || 0} prefix={<InboxOutlined />} color="#722ed1"
                    sub={`数量 ${num(overview.actualInboundQty)}`} />
                </Col>
              </Row>
              <div style={{ marginTop: 12, color: '#888', fontSize: 12 }}>
                预期销售 = 全部销售单订购量×单价；预期采购 = 全部采购单订购量×预计单价；真实出库收入 = 已出库单销售额；真实入库花费 = 已入库单采购额。
              </div>
            </Card>

            {/* ── 2. 利润角度 ── */}
            <Card size="small" style={{ background: '#111318', border: '1px solid #222', marginBottom: 16 }} headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
              {sectionTitle('二、多角度利润')}
              <Row gutter={16}>
                <Col xs={12} md={6}>
                  <StatCard title="预期毛利" value={overview.expectedProfit || 0} prefix={<RiseOutlined />} color={profitColor(overview.expectedProfit)}
                    sub={<span>预期毛利率 <span style={{ color: profitColor(overview.expectedMargin) }}>{pct(overview.expectedMargin)}</span></span>} />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="实际毛利" value={overview.actualProfit || 0} prefix={<BarChartOutlined />} color={profitColor(overview.actualProfit)}
                    sub={<span>实际毛利率 <span style={{ color: profitColor(overview.actualMargin) }}>{pct(overview.actualMargin)}</span></span>} />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="已实现毛利" value={overview.realizedProfit || 0} prefix={<AccountBookOutlined />} color={profitColor(overview.realizedProfit)}
                    sub={<span>毛利率 <span style={{ color: profitColor(overview.realizedMargin) }}>{pct(overview.realizedMargin)}</span></span>} />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="出库完成率" value={overview.completionRate || 0} prefix={<PercentageOutlined />} color="#13c2c2"
                    sub="真实出库收入 / 预期销售" precision={2} />
                </Col>
              </Row>
              <div style={{ marginTop: 12, color: '#888', fontSize: 12 }}>
                预期毛利 = 预期销售 − 预期采购；实际毛利 = 真实出库收入 − 真实入库花费；已实现毛利 = 真实出库收入 − 出库数量×加权平均采购价。
              </div>
            </Card>

            {/* ── 3. 库存角度 ── */}
            <Card size="small" style={{ background: '#111318', border: '1px solid #222', marginBottom: 20 }} headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
              {sectionTitle('三、库存角度')}
              <Row gutter={16}>
                <Col xs={12} md={6}>
                  <StatCard title="库存数量" value={overview.inventoryQty || 0} prefix={<DatabaseOutlined />} color="#1677ff" precision={0} />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="库存成本价值" value={overview.inventoryCostValue || 0} prefix={<AccountBookOutlined />} color="#fa8c16"
                    sub="库存 × 加权平均采购价" />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="库存销售价值" value={overview.inventorySalesValue || 0} prefix={<DollarOutlined />} color="#52c41a"
                    sub="库存 × 平均售价" />
                </Col>
                <Col xs={12} md={6}>
                  <StatCard title="库存潜在毛利" value={overview.inventoryPotentialProfit || 0} prefix={<RiseOutlined />} color={profitColor(overview.inventoryPotentialProfit)}
                    sub="库存销售价值 − 库存成本价值" />
                </Col>
              </Row>
            </Card>

            {/* ── 4. 所选期间已出库汇总 ── */}
            <Row gutter={16} style={{ marginBottom: 20 }}>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="期间出库单数" value={totals.orderCount || 0} prefix={<ShoppingOutlined />} valueStyle={{ color: '#1677ff' }} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="期间营收" value={totals.revenue || 0} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: '#1677ff' }} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="期间成本" value={totals.cost || 0} prefix={<AccountBookOutlined />} precision={2} valueStyle={{ color: '#fa8c16' }} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="期间已实现毛利" value={totals.profit || 0} prefix={<BarChartOutlined />} precision={2} valueStyle={{ color: profitColor(totals.profit) }} />
                  <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>毛利率: <span style={{ color: Number(totals.margin) >= 0 ? '#52c41a' : '#ff4d4f' }}>{pct(totals.margin)}</span></div>
                </Card>
              </Col>
            </Row>

            {/* ── 5. 月度趋势图 ── */}
            <Card
              title="月度营收 / 成本 / 毛利趋势"
              size="small"
              style={{ background: '#141414', border: '1px solid #222', marginBottom: 20 }}
              headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}
            >
              {byMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="month" stroke="#666" fontSize={11} />
                    <YAxis stroke="#666" />
                    <RTooltip formatter={(v) => '¥' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} />
                    <Legend />
                    <Bar dataKey="revenue" name="营收" fill="#1677ff" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="cost" name="成本" fill="#fa8c16" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="profit" name="毛利" fill="#52c41a" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty description="暂无出库数据" />}
            </Card>

            {/* ── 6. 多维统计 ── */}
            <Tabs
              defaultActiveKey="part"
              style={{ color: '#e3e3e3' }}
              items={[
                { key: 'part', label: '按物料(全期)', children: <Table dataSource={byPart} columns={partColumns} rowKey={(r) => r.model || r.partKey} size="small" pagination={{ pageSize: 15 }} scroll={{ x: 1900 }} /> },
                { key: 'customer', label: '按客户', children: <Table dataSource={byCustomer} columns={customerColumns} rowKey={(r) => r.customerName} size="small" pagination={{ pageSize: 15 }} scroll={{ x: 700 }} /> },
                { key: 'month', label: '按月明细', children: <Table dataSource={byMonth} columns={monthColumns} rowKey={(r) => r.month} size="small" pagination={false} scroll={{ x: 700 }} /> },
                { key: 'inventory', label: `库存明细(${num(overview.inventoryQty)}件)`, children: <Table dataSource={inventory} columns={invColumns} rowKey={(r) => r.model} size="small" pagination={{ pageSize: 15 }} scroll={{ x: 1100 }} /> },
              ]}
            />
          </>
        )}
      </Content>
    </Layout>
  )
}