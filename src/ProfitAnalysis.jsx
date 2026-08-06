import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Row, Col, Card, Statistic, Table, Tag, Spin, Empty, Tabs, Space, DatePicker, Button, Typography, Tooltip } from 'antd'
import { ReloadOutlined, DollarOutlined, AccountBookOutlined, PercentageOutlined, ShoppingOutlined, BarChartOutlined } from '@ant-design/icons'
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
            出入库价差利润分析仅对公司管理员 (COMPANY_ADMIN) 开放
            <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>当前角色: {user?.role || '未知'}</div>
          </div>
        </Content>
      </Layout>
    )
  }

  const totals = data?.totals || {}

  const partColumns = [
    { title: '品类', dataIndex: 'partType', key: 'partType', width: 90, render: v => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '型号', dataIndex: 'model', key: 'model', width: 200, ellipsis: true, render: v => <Text code style={{ fontSize: 12 }}>{v || '-'}</Text> },
    { title: '厂家', dataIndex: 'manufacturer', key: 'manufacturer', width: 120, render: v => v || '-' },
    { title: '数量', dataIndex: 'qty', key: 'qty', width: 90, align: 'right', render: v => num(v) },
    { title: '营收', dataIndex: 'revenue', key: 'revenue', width: 110, align: 'right', render: v => money(v) },
    { title: '成本', dataIndex: 'cost', key: 'cost', width: 110, align: 'right', render: v => money(v) },
    { title: '毛利', dataIndex: 'profit', key: 'profit', width: 110, align: 'right', render: v => <span style={{ color: profitColor(v), fontWeight: 600 }}>{money(v)}</span> },
    { title: '毛利率', dataIndex: 'margin', key: 'margin', width: 90, align: 'right', render: v => <Tag color={Number(v) >= 0 ? 'green' : 'red'}>{pct(v)}</Tag> },
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

  const byPart = data?.byPart || []
  const byCustomer = data?.byCustomer || []
  const byMonth = data?.byMonth || []

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <h2 style={{ color: '#e3e3e3', margin: 0 }}>出入库价差利润分析</h2>
          <Space wrap>
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
            {/* ── 汇总卡片 ── */}
            <Row gutter={16} style={{ marginBottom: 20 }}>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="出库单数" value={totals.orderCount || 0} prefix={<ShoppingOutlined />} valueStyle={{ color: '#1677ff' }} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="总营收" value={totals.revenue || 0} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: '#1677ff' }} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="总成本" value={totals.cost || 0} prefix={<AccountBookOutlined />} precision={2} valueStyle={{ color: '#fa8c16' }} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
                  <Statistic title="总毛利" value={totals.profit || 0} prefix={<BarChartOutlined />} precision={2}
                    valueStyle={{ color: profitColor(totals.profit) }}
                    suffix={<Tooltip title="毛利率"><PercentageOutlined style={{ color: '#888', fontSize: 14 }} /></Tooltip>} />
                  <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>毛利率: <span style={{ color: Number(totals.margin) >= 0 ? '#52c41a' : '#ff4d4f' }}>{pct(totals.margin)}</span></div>
                </Card>
              </Col>
            </Row>

            {/* ── 月度趋势图 ── */}
            <Card
              title="月度营收 / 成本 / 毛利趋势"
              size="small"
              style={{ background: '#141414', border: '1px solid #222', marginBottom: 20 }}
              headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}
            >
              {byMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
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

            {/* ── 多维统计 ── */}
            <Tabs
              defaultActiveKey="part"
              items={[
                { key: 'part', label: '按物料', children: <Table dataSource={byPart} columns={partColumns} rowKey={(r) => r.model || r.partKey} size="small" pagination={false} scroll={{ x: 900 }} /> },
                { key: 'customer', label: '按客户', children: <Table dataSource={byCustomer} columns={customerColumns} rowKey={(r) => r.customerName} size="small" pagination={false} scroll={{ x: 700 }} /> },
                { key: 'month', label: '按月明细', children: <Table dataSource={byMonth} columns={monthColumns} rowKey={(r) => r.month} size="small" pagination={false} scroll={{ x: 700 }} /> },
              ]}
              style={{ color: '#e3e3e3' }}
            />
          </>
        )}
      </Content>
    </Layout>
  )
}