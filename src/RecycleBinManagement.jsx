import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Pagination, Button, Tabs, Tag, Space, message, Popconfirm, Typography, Select } from 'antd'
import { ReloadOutlined, RestOutlined, DeleteOutlined } from '@ant-design/icons'
import api from './auth'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js'

const { Content } = Layout
const { Text } = Typography

const TYPE_TABS = [
  { key: 'sales', label: '销售单' },
  { key: 'purchase', label: '采购单' },
  { key: 'outbound', label: '出库单' },
  { key: 'inbound', label: '入库单' },
]

const STATUS_COLORS = {
  DRAFT: 'default', CONFIRMED: 'blue', SHIPPED: 'geekblue', COMPLETED: 'green',
  RECEIVED: 'cyan', CANCELLED: 'red',
}

export default function RecycleBinManagement({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)
  const effectiveCompanyId = isSuperAdmin ? (selectedCompanyId || 0) : user?.companyId

  const [activeType, setActiveType] = useState('sales')
  const [records, setRecords] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [actingId, setActingId] = useState(null)

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const params = { type: activeType, limit: pageSize, offset: (page - 1) * pageSize }
      if (effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/recycle-bin', { params })
      const apiData = res.data?.data || res.data || {}
      setRecords(Array.isArray(apiData) ? apiData : (apiData.data || []))
      setTotal(apiData.count || 0)
    } catch (e) {
      message.error('加载回收站失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [activeType, page, pageSize, effectiveCompanyId])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  useEffect(() => { setPage(1) }, [activeType, selectedCompanyId])

  const handleRestore = async (id) => {
    setActingId(String(id))
    try {
      const params = {}
      if (effectiveCompanyId) params.companyId = effectiveCompanyId
      await api.post(`/erp/recycle-bin/${activeType}/${id}/restore`, null, { params })
      message.success('已恢复')
      fetchRecords()
    } catch (e) {
      message.error('恢复失败: ' + (e.response?.data?.error || e.message))
    } finally { setActingId(null) }
  }

  const handlePurge = async (id) => {
    setActingId(String(id))
    try {
      const params = {}
      if (effectiveCompanyId) params.companyId = effectiveCompanyId
      await api.post(`/erp/recycle-bin/${activeType}/${id}/purge`, null, { params })
      message.success('已彻底删除')
      fetchRecords()
    } catch (e) {
      message.error('彻底删除失败: ' + (e.response?.data?.error || e.message))
    } finally { setActingId(null) }
  }

  const renderActions = (record) => {
    const id = record.sales_id || record.purchase_id || record.orderId || record.inboundId
    if (id == null) return <Text type="secondary">-</Text>
    const busy = actingId === String(id)
    return (
      <Space>
        <Popconfirm title="确认恢复该订单及其关联单据？" onConfirm={() => handleRestore(id)} okText="恢复" cancelText="取消">
          <Button size="small" icon={<RestOutlined />} loading={busy}>恢复</Button>
        </Popconfirm>
        <Popconfirm title="彻底删除不可逆，将回滚库存并清理关联对账单，确认？" onConfirm={() => handlePurge(id)} okText="彻底删除" cancelText="取消"
          okButtonProps={{ danger: true }}>
          <Button size="small" danger icon={<DeleteOutlined />} loading={busy}>彻底删除</Button>
        </Popconfirm>
      </Space>
    )
  }

  const columnsByType = {
    sales: [
      { title: '销售单号', dataIndex: 'so_number', width: 140 },
      { title: '客户', dataIndex: 'customer_name', width: 140 },
      { title: '下单日期', dataIndex: 'order_date', width: 110, render: v => v?.substring(0, 10) },
      { title: '状态', dataIndex: 'status', width: 100, render: v => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
      { title: '总金额', dataIndex: 'total_amount', width: 110 },
      { title: '删除时间', dataIndex: 'deleted_at', width: 170, render: v => v?.substring(0, 19) },
      { title: '操作', key: 'actions', width: 180, render: (_, r) => renderActions(r) },
    ],
    purchase: [
      { title: '采购单号', dataIndex: 'po_number', width: 140 },
      { title: '供应商', dataIndex: 'supplier_name', width: 180 },
      { title: '下单日期', dataIndex: 'order_date', width: 110, render: v => v?.substring(0, 10) },
      { title: '状态', dataIndex: 'status', width: 100, render: v => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
      { title: '总金额', dataIndex: 'total_amount', width: 110 },
      { title: '删除时间', dataIndex: 'deleted_at', width: 170, render: v => v?.substring(0, 19) },
      { title: '操作', key: 'actions', width: 180, render: (_, r) => renderActions(r) },
    ],
    outbound: [
      { title: '出库单号', dataIndex: 'orderNumber', width: 160 },
      { title: '客户', dataIndex: 'customerName', width: 140 },
      { title: '出库日期', dataIndex: 'shipDate', width: 110, render: v => v?.substring(0, 10) },
      { title: '状态', dataIndex: 'status', width: 100, render: v => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
      { title: '总金额', dataIndex: 'totalAmount', width: 110 },
      { title: '删除时间', dataIndex: 'deletedAt', width: 170, render: v => v?.substring(0, 19) },
      { title: '操作', key: 'actions', width: 180, render: (_, r) => renderActions(r) },
    ],
    inbound: [
      { title: '入库单号', dataIndex: 'orderNumber', width: 160 },
      { title: '供应商', dataIndex: 'supplierName', width: 180 },
      { title: '入库日期', dataIndex: 'receivedDate', width: 110, render: v => v?.substring(0, 10) },
      { title: '状态', dataIndex: 'status', width: 100, render: v => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
      { title: '总金额', dataIndex: 'totalAmount', width: 110 },
      { title: '删除时间', dataIndex: 'deletedAt', width: 170, render: v => v?.substring(0, 19) },
      { title: '操作', key: 'actions', width: 180, render: (_, r) => renderActions(r) },
    ],
  }

  return (
    <Layout style={{ background: '#0d1117', height: '100%', minHeight: 0 }}>
      <Content style={{ padding: '16px 24px', overflow: 'auto', background: '#0d1117' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ color: '#e8eaed', margin: 0 }}>回收站</h2>
            <Text type="secondary" style={{ fontSize: 12 }}>
              管理已软删除的订单（销售单 / 采购单 / 出库单 / 入库单）。恢复会连同关联单据与对账单一起恢复；彻底删除不可逆。
            </Text>
          </div>
          <Space>
            {isSuperAdmin && (
              <Select
                placeholder="选择公司" allowClear style={{ width: 180 }}
                value={selectedCompanyId}
                onChange={(v) => setSelectedCompanyId(v)}
                options={(companies || []).map(c => ({ label: c.name, value: c.id }))}
              />
            )}
            <Button icon={<ReloadOutlined />} onClick={fetchRecords}>刷新</Button>
          </Space>
        </div>

        <Tabs activeKey={activeType} onChange={setActiveType} items={TYPE_TABS} />

        <Table
          dataSource={records} columns={columnsByType[activeType]} loading={loading}
          rowKey={(r) => r.sales_id || r.purchase_id || r.orderId || r.inboundId}
          size="small" scroll={{ x: 900 }} style={{ background: '#0d1117' }}
          pagination={false}
        />
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Pagination
            current={page} pageSize={pageSize} total={total}
            showSizeChanger showTotal={t => `共 ${t} 条`}
            onChange={(p) => setPage(p)}
            onShowSizeChange={(p, s) => { setPageSize(s); setPage(1) }}
          />
        </div>
      </Content>
    </Layout>
  )
}