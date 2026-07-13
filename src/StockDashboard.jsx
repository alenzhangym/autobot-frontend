import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Row, Col, Card, Statistic, Table, Tag, Spin, Empty } from 'antd'
import { ReloadOutlined, WarningOutlined, ShoppingCartOutlined, DollarOutlined, DatabaseOutlined, RiseOutlined } from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts'
import api from './auth'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js'

const { Content } = Layout

const COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2', '#f5222d', '#2f54eb', '#faad14', '#a0d911']

const STATUS_MAP = {
  DRAFT: { label: '草稿', color: 'default' },
  CONFIRMED: { label: '已确认', color: 'blue' },
  SHIPPED: { label: '已出库', color: 'orange' },
  COMPLETED: { label: '已完成', color: 'green' },
  CANCELLED: { label: '已取消', color: 'red' },
}

export default function StockDashboard({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [summary, setSummary] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [trends, setTrends] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId

      const [summaryRes, lowStockRes, ordersRes, trendRes] = await Promise.all([
        api.get('/erp/dashboard/stock-summary', { params }),
        api.get('/erp/dashboard/low-stock', { params }),
        api.get('/erp/dashboard/recent-activity', { params: { ...params, limit: 10 } }),
        api.get('/erp/dashboard/monthly-trend', { params: { ...params, months: 12 } }),
      ])

      setSummary(summaryRes.data)
      setLowStock(lowStockRes.data?.items || [])
      setRecentOrders(ordersRes.data?.orders || [])
      setTrends(trendRes.data?.trends || [])
    } catch (e) {
      console.error('Dashboard fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetchData() }, [fetchData])

  const lowStockColumns = [
    { title: '型号', dataIndex: 'user_part_model', key: 'model', width: 160 },
    { title: '品类', dataIndex: 'part_type', key: 'type', width: 80 },
    { title: '厂家', dataIndex: 'manufacturer', key: 'mfr', width: 100 },
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier', width: 100 },
    { title: '当前库存', dataIndex: 'current_stock', key: 'stock', width: 80, render: v => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{v}</span> },
    { title: '安全阈值', dataIndex: 'min_stock_alert', key: 'alert', width: 80 },
    { title: '缺口', dataIndex: 'gap', key: 'gap', width: 60, render: v => <Tag color="red">{v}</Tag> },
    { title: '库位', dataIndex: 'location', key: 'loc', width: 80 },
  ]

  const orderColumns = [
    { title: '单号', dataIndex: 'orderNumber', key: 'no', width: 160 },
    { title: '日期', dataIndex: 'orderDate', key: 'date', width: 100 },
    { title: '金额', dataIndex: 'totalAmount', key: 'amount', width: 100, render: v => v ? '¥' + Number(v).toFixed(2) : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: s => {
        const info = STATUS_MAP[s] || { label: s, color: 'default' }
        return <Tag color={info.color}>{info.label}</Tag>
      }
    },
  ]

  if (loading) {
    return (
      <Layout style={{ background: '#0d0d0d', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin size="large" tip="加载仪表盘..." />
      </Layout>
    )
  }

  const categories = summary?.categories || []

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ color: '#e3e3e3', margin: 0 }}>库存仪表盘</h2>
          <ReloadOutlined style={{ color: '#888', fontSize: 18, cursor: 'pointer' }} onClick={fetchData} />
        </div>

        {/* ── Summary Cards ── */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
              <Statistic title="SKU 数量" value={summary?.total_skus || 0} prefix={<DatabaseOutlined />} valueStyle={{ color: '#1677ff' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
              <Statistic title="库存总量" value={summary?.total_stock_qty || 0} prefix={<ShoppingCartOutlined />} valueStyle={{ color: '#52c41a' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
              <Statistic title="库存金额" value={summary?.total_stock_value || 0} prefix={<DollarOutlined />} precision={2} valueStyle={{ color: '#fa8c16' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: lowStock.length > 0 ? '#1f1414' : '#141414', border: lowStock.length > 0 ? '1px solid #4d1f1f' : '1px solid #222' }}>
              <Statistic title="低库存预警" value={lowStock.length} prefix={<WarningOutlined />} valueStyle={{ color: lowStock.length > 0 ? '#ff4d4f' : '#52c41a' }} />
            </Card>
          </Col>
        </Row>

        {/* ── Charts Row ── */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {/* Category Pie */}
          <Col span={12}>
            <Card title="品类库存金额分布" size="small" style={{ background: '#141414', border: '1px solid #222' }}
              headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
              {categories.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={categories} dataKey="total_value" nameKey="part_type" cx="50%" cy="50%" outerRadius={100} label={({ part_type, percent }) => `${part_type} ${(percent * 100).toFixed(0)}%`}>
                      {categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => '¥' + Number(v).toFixed(2)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <Empty description="暂无库存数据" />}
            </Card>
          </Col>

          {/* Category Bar - SKU count */}
          <Col span={12}>
            <Card title="品类 SKU 数量" size="small" style={{ background: '#141414', border: '1px solid #222' }}
              headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
              {categories.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categories} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis type="number" stroke="#666" />
                    <YAxis type="category" dataKey="part_type" width={60} stroke="#666" />
                    <Tooltip />
                    <Bar dataKey="sku_count" fill="#1677ff" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty description="暂无库存数据" />}
            </Card>
          </Col>
        </Row>

        {/* ── Trend Line ── */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={12}>
            <Card title="出入库月度趋势" size="small" style={{ background: '#141414', border: '1px solid #222' }}
              headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
              {trends.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                    <XAxis dataKey="month" stroke="#666" fontSize={11} />
                    <YAxis stroke="#666" />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="inbound_count" name="入库" stroke="#52c41a" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="outbound_count" name="出库" stroke="#1677ff" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty description="暂无趋势数据" />}
            </Card>
          </Col>

          {/* Recent Orders */}
          <Col span={12}>
            <Card title="最近出库单" size="small" style={{ background: '#141414', border: '1px solid #222' }}
              headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
              <Table dataSource={recentOrders} columns={orderColumns} rowKey="orderNumber" size="small" pagination={false}
                scroll={{ x: 440 }} />
            </Card>
          </Col>
        </Row>

        {/* ── Low Stock Alert ── */}
        <Card title={<span><WarningOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />低库存预警 ({lowStock.length})</span>}
          size="small" style={{ background: '#141414', border: lowStock.length > 0 ? '1px solid #4d1f1f' : '1px solid #222' }}
          headStyle={{ color: '#e3e3e3', borderBottom: '1px solid #222' }}>
          {lowStock.length > 0 ? (
            <Table dataSource={lowStock} columns={lowStockColumns} rowKey={(r) => r.user_part_model + r.supplier_name}
              size="small" pagination={false} scroll={{ x: 800 }} />
          ) : (
            <div style={{ color: '#52c41a', padding: 16, textAlign: 'center' }}>所有库存充足，暂无预警</div>
          )}
        </Card>
      </Content>
    </Layout>
  )
}
