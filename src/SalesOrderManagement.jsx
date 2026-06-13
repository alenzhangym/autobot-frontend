import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, AutoComplete, Tag, Space, message, Popconfirm, Typography, InputNumber, Card, DatePicker } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined, DeleteOutlined, EditOutlined, MinusCircleOutlined } from '@ant-design/icons'
import api from './auth'
import dayjs from 'dayjs'

const { Content } = Layout
const { Text } = Typography

const STATUS_MAP = {
  PARTIAL_SHIPPED: { label: '部分出库', color: 'orange' },
  SHIPPED:         { label: '已出库', color: 'green' },
}

const PART_TYPES = ['电容', '电感', '磁珠', '电阻', 'PCB板材', 'IC', '二极管', '三极管', '晶振', '连接器', '继电器', '其他']

const emptyItem = () => ({ key: Date.now(), partType: null, customerPartNo: '', partId: null, partLabel: '', orderedQty: null, unitPrice: null, totalPrice: null })

export default function SalesOrderManagement({ user, companies = [] }) {
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState(null)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [items, setItems] = useState([emptyItem()])
  const [customers, setCustomers] = useState([])
  const [customerPartMappings, setCustomerPartMappings] = useState([])
  const [parts, setParts] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: pageSize, offset: (page - 1) * pageSize }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      if (keyword) params.keyword = keyword
      if (statusFilter) params.status = statusFilter
      const res = await api.get('/erp/sales-orders', { params })
      setOrders(res.data.data || [])
      setTotal(res.data.count || 0)
    } catch (e) {
      message.error('加载销售单失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, statusFilter, effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const fetchCustomers = useCallback(async () => {
    try {
      const params = { size: 500 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/customers', { params })
      setCustomers((res.data.customers || []).map(c => ({ value: c.customerId, label: c.name })))
    } catch (e) { /* ignore */ }
  }, [effectiveCompanyId, isSuperAdmin])

  const fetchCustomerPartMappings = useCallback(async (customerId) => {
    if (!customerId) { setCustomerPartMappings([]); return }
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/customer-part-mappings/by-customer/${customerId}`, { params })
      const list = (res.data || []).map(m => ({
        customerPartNo: m.customerPartNo,
        customerPartDesc: m.customerPartDesc || '',
        partId: m.partId,
        partType: m.partType || '',
        partModel: m.partModel || '',
        manufacturer: m.manufacturer || ''
      }))
      setCustomerPartMappings(list)
    } catch (e) {
      setCustomerPartMappings([])
    }
  }, [effectiveCompanyId, isSuperAdmin])

  useEffect(() => {
    const loadParts = async () => {
      try {
        const params = { size: 2000 }
        if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/parts', { params })
        setParts((res.data.parts || []).map(p => ({
          partId: p.partId,
          userPartModel: p.userPartModel || '',
          partType: p.partType || '',
          manufacturer: p.manufacturer || '',
          label: p.userPartModel || `物料ID:${p.partId}`
        })))
      } catch (e) { /* ignore */ }
    }
    loadParts()
  }, [effectiveCompanyId, isSuperAdmin])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setItems([emptyItem()])
    setSelectedCustomerId(null)
    setCustomerPartMappings([])
    fetchCustomers()
    setShowModal(true)
  }

  const openEdit = async (record) => {
    setEditing(record)
    fetchCustomers()
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/sales-orders/${record.sales_id}`, { params })
      const detail = res.data
      form.setFieldsValue({
        customerPo: detail.customer_po, customerId: detail.customer_id,
        orderDate: detail.order_date ? dayjs(detail.order_date) : null,
        expectedShipDate: detail.expected_ship_date ? dayjs(detail.expected_ship_date) : null,
        paymentStatus: detail.payment_status, notes: detail.notes
      })
      if (detail.customer_id) {
        setSelectedCustomerId(detail.customer_id)
        fetchCustomerPartMappings(detail.customer_id)
      }
      const its = (detail.items || []).map(it => ({
        key: Date.now() + Math.random(),
        partType: null, customerPartNo: it.customer_part_no || '',
        partId: it.part_id, partLabel: '',
        orderedQty: it.ordered_qty, unitPrice: it.unit_price, totalPrice: it.total_price
      }))
      setItems(its.length > 0 ? its : [emptyItem()])
      setShowModal(true)
    } catch (e) {
      message.error('获取详情失败')
    }
  }

  const handleCustomerChange = (customerId) => {
    setSelectedCustomerId(customerId)
    fetchCustomerPartMappings(customerId)
    setItems([emptyItem()])
  }

  const handlePartTypeChange = (itemKey, partType) => {
    setItems(items.map(it => it.key === itemKey ? {
      ...it, partType, customerPartNo: '', partId: null, partLabel: ''
    } : it))
  }

  const handleCustomerPartNoChange = (itemKey, value) => {
    const matchedPart = parts.find(p => p.userPartModel && p.userPartModel === value)
    setItems(items.map(it => it.key === itemKey ? {
      ...it,
      customerPartNo: value || '',
      partId: matchedPart ? matchedPart.partId : null,
      partLabel: matchedPart ? matchedPart.userPartModel : ''
    } : it))
  }

  const handleCustomerPartNoSelect = (itemKey, option) => {
    setItems(items.map(it => it.key === itemKey ? {
      ...it,
      customerPartNo: option.value,
      partId: option.partId || null,
      partLabel: option.partLabel || ''
    } : it))
  }

  const getCustomerPartOptionsForItem = (item) => {
    const mappingOptions = customerPartMappings
      .filter(m => !item.partType || m.partType === item.partType)
      .map(m => ({
        value: m.customerPartNo,
        label: (
          <span>
            <Tag color="blue" style={{ marginRight: 4 }}>映射</Tag>
            {m.customerPartNo}
            {m.customerPartDesc ? ' - ' + m.customerPartDesc : ''}
          </span>
        ),
        partId: m.partId,
        partLabel: m.partModel || (m.partId ? `物料ID: ${m.partId}` : ''),
        source: 'mapping'
      }))
    const partOptions = parts
      .filter(p => !item.partType || p.partType === item.partType)
      .map(p => ({
        value: p.userPartModel,
        label: (
          <span>
            <Tag color="green" style={{ marginRight: 4 }}>物料</Tag>
            {p.userPartModel || `物料ID:${p.partId}`}
            {p.partType ? ` (${p.partType})` : ''}
          </span>
        ),
        partId: p.partId,
        partLabel: p.userPartModel || `物料ID:${p.partId}`,
        source: 'part'
      }))
    const groups = []
    if (mappingOptions.length > 0) {
      groups.push({ label: '客户料号映射', options: mappingOptions })
    }
    groups.push({ label: '内部物料 (无映射客户可直接选用)', options: partOptions })
    return groups
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const unresolved = items.filter(it => it.customerPartNo && !it.partId)
      if (unresolved.length > 0) {
        message.error(`有 ${unresolved.length} 条物料的客户料号未匹配到内部物料，请从下拉中选择`)
        return
      }
      // 数量校验：所有 partId 行的数量必须 > 0
      const rowsWithPart = items.filter(it => it.partId)
      const invalidQty = rowsWithPart.filter(it => !it.orderedQty || it.orderedQty <= 0)
      if (invalidQty.length > 0) {
        message.error(`有 ${invalidQty.length} 条物料数量为 0 或未填写，销售数量必须大于 0`)
        return
      }
      const validItems = rowsWithPart.filter(it => it.orderedQty > 0)
      if (validItems.length === 0) { message.error('请至少添加一条物料明细'); return }
      const payload = {
        customerPo: values.customerPo, customerId: values.customerId,
        orderDate: values.orderDate ? values.orderDate.format('YYYY-MM-DD') : null,
        expectedShipDate: values.expectedShipDate ? values.expectedShipDate.format('YYYY-MM-DD') : null,
        paymentStatus: values.paymentStatus, notes: values.notes,
        companyId: effectiveCompanyId || user?.companyId || 0,
        createdBy: user?.id, items: validItems.map(it => ({
          partId: it.partId, customerPartNo: it.customerPartNo || '', orderedQty: it.orderedQty,
          unitPrice: it.unitPrice || 0, totalPrice: (it.orderedQty || 0) * (it.unitPrice || 0)
        }))
      }
      if (editing) {
        await api.put(`/erp/sales-orders/${editing.sales_id}`, payload)
        message.success('已更新')
      } else {
        await api.post('/erp/sales-orders', payload)
        message.success('已创建')
      }
      setShowModal(false); setEditing(null); form.resetFields(); setItems([emptyItem()])
      setSelectedCustomerId(null); setCustomerPartMappings([])
      setPage(1); fetchOrders()
    } catch (e) {
      if (!e.errorFields) message.error('保存失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleDelete = async (id) => { try { await api.delete(`/erp/sales-orders/${id}?companyId=${effectiveCompanyId || 0}`); message.success('已删除'); fetchOrders() } catch (e) { message.error('删除失败: ' + (e.response?.data?.error || e.message)) } }
  const handleStatusChange = async (id, status) => { try { await api.put(`/erp/sales-orders/${id}/status?companyId=${effectiveCompanyId || 0}`, { status }); message.success('状态已更新'); fetchOrders() } catch (e) { message.error('操作失败: ' + (e.response?.data?.error || e.message)) } }
  const addItem = () => setItems([...items, emptyItem()])
  const removeItem = (key) => { if (items.length <= 1) return; setItems(items.filter(it => it.key !== key)) }
  const updateItem = (key, field, val) => setItems(items.map(it => it.key === key ? { ...it, [field]: val } : it))

  const [expandedItems, setExpandedItems] = useState({})
  const fetchExpandedItems = async (record) => {
    if (expandedItems[record.sales_id]) return
    try {
      const res = await api.get(`/erp/sales-orders/${record.sales_id}`)
      const items = res.data?.items || []
      setExpandedItems(prev => ({ ...prev, [record.sales_id]: items }))
    } catch (e) { /* ignore */ }
  }
  const expandedRowRender = (record) => {
    const items = expandedItems[record.sales_id]
    if (!items || items.length === 0) return <Text type="secondary">暂无明细</Text>
    return (
      <Table size="small" dataSource={items} rowKey="item_id" pagination={false}
        columns={[
          { title: '客户料号', dataIndex: 'customer_part_no', width: 130, render: v => v || '-' },
          { title: '物料编码', dataIndex: 'part_id', width: 140, render: v => { const p = parts.find(p => p.partId === v); return p?.label || v } },
          { title: '订量', dataIndex: 'ordered_qty', width: 70 },
          { title: '已出', dataIndex: 'shipped_qty', width: 70 },
          { title: '单价', dataIndex: 'unit_price', width: 80, render: v => v ? Number(v).toFixed(4) : '-' },
          { title: '小计', dataIndex: 'total_price', width: 90, render: v => v ? Number(v).toFixed(2) : '-' },
        ]} />
    )
  }

  const columns = [
    { title: '销售单号', dataIndex: 'so_number', width: 180 },
    { title: '客户PO号', dataIndex: 'customer_po', width: 150, render: v => v ? <Text code>{v}</Text> : '-' },
    { title: '客户', dataIndex: 'customer_name', width: 120 },
    { title: '订单日期', dataIndex: 'order_date', width: 110, render: v => v || '-' },
    { title: '预计出货', dataIndex: 'expected_ship_date', width: 110, render: v => v || '-' },
    { title: '金额', dataIndex: 'total_amount', width: 100, align: 'right', render: v => v != null ? v.toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: s => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: v => v ? dayjs(v).format('MM-DD HH:mm') : '-' },
    { title: '操作', key: 'actions', width: 180, fixed: 'right', render: (_, r) => (
      <Space>
        {r.status !== 'CANCELLED' && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>}
        <Popconfirm
          title={`确认删除销售单 ${r.so_number || ('#' + r.sales_id)}?`}
          description="删除后无法恢复，相关明细也会一并删除。"
          okText="确认删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() => handleDelete(r.sales_id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )}
  ]

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Input.Search placeholder="搜索销售单号/客户PO" allowClear value={keyword}
              onChange={e => setKeyword(e.target.value)} onSearch={() => { setPage(1); fetchOrders() }} style={{ width: 260 }} />
            <Select placeholder="状态筛选" allowClear style={{ width: 130 }} value={statusFilter}
              onChange={v => { setStatusFilter(v); setPage(1) }}
              options={Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); fetchOrders() }}>刷新</Button>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>录入销售单</Button>
        </Space>
        <Table dataSource={orders} columns={columns} rowKey="sales_id" loading={loading}
          expandable={{ expandedRowRender, onExpand: (expanded, record) => { if (expanded) fetchExpandedItems(record) } }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps) } }} scroll={{ x: 1100 }} />
        <Modal title={editing ? '编辑销售单' : '录入销售单'} open={showModal} onOk={handleSave} width={950} okText="保存" destroyOnClose
          onCancel={() => { setShowModal(false); setEditing(null); form.resetFields(); setItems([emptyItem()]); setSelectedCustomerId(null); setCustomerPartMappings([]) }}>
          <Form form={form} layout="vertical">
            <Space wrap>
              <Form.Item name="customerPo" label="客户订单号 (PO)" rules={[{ required: true, message: '客户订单号为必填项' }]}><Input placeholder="客户给的PO号，必填" style={{ width: 200 }} /></Form.Item>
              <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择' }]}>
                <Select placeholder="先选择客户" style={{ width: 200 }} showSearch optionFilterProp="label" options={customers} onChange={handleCustomerChange} /></Form.Item>
              <Form.Item name="orderDate" label="订单日期"><DatePicker style={{ width: 160 }} /></Form.Item>
              <Form.Item name="expectedShipDate" label="预计出货"><DatePicker style={{ width: 160 }} /></Form.Item>
              <Form.Item name="paymentStatus" label="付款状态" initialValue="UNPAID">
                <Select style={{ width: 120 }} options={[{ value: 'UNPAID', label: '未付款' }, { value: 'PARTIAL', label: '部分付款' }, { value: 'PAID', label: '已付款' }]} /></Form.Item>
            </Space>
            <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
            <Card size="small" title={<span>物料明细 {!selectedCustomerId && <Text type="secondary" style={{fontSize:12}}>（请先选择客户）</Text>}</span>}
              extra={<Button type="dashed" icon={<PlusOutlined />} onClick={addItem} disabled={!selectedCustomerId}>添加物料</Button>} style={{ marginTop: 16 }}>
              {items.map((it) => (
                <Space key={it.key} style={{ marginBottom: 10, width: '100%' }} align="start" wrap>
                  <Select placeholder="物料类型" style={{ width: 120 }} disabled={!selectedCustomerId}
                    value={it.partType} onChange={v => handlePartTypeChange(it.key, v)}
                    options={PART_TYPES.map(t => ({ value: t, label: t }))} allowClear />
                  <AutoComplete
                    placeholder={selectedCustomerId ? "客户料号 / 物料号" : "请先选择客户"}
                    style={{ width: 240 }}
                    disabled={!selectedCustomerId}
                    value={it.customerPartNo || undefined}
                    onChange={v => handleCustomerPartNoChange(it.key, v)}
                    onSelect={(_, option) => handleCustomerPartNoSelect(it.key, option)}
                    options={getCustomerPartOptionsForItem(it)}
                    filterOption={(input, option) => {
                      if (!option || !option.value) return false
                      return option.value.toLowerCase().includes(input.toLowerCase())
                    }}
                    notFoundContent={selectedCustomerId ? '未找到匹配项' : '请先选择客户'} />
                  <Input placeholder="物料编码" style={{ width: 220 }} disabled value={it.partLabel} />
                  <InputNumber placeholder="订量" min={1} value={it.orderedQty}
                    onChange={v => updateItem(it.key, 'orderedQty', v)} style={{ width: 80 }} />
                  <InputNumber placeholder="单价" min={0} step={0.01} value={it.unitPrice}
                    onChange={v => updateItem(it.key, 'unitPrice', v)} style={{ width: 100 }} />
                  <span style={{ color: '#888', fontSize: 11, width: 100, textAlign: 'right', display: 'inline-block' }}>
                    {it.orderedQty && it.unitPrice ? '¥' + (it.orderedQty * it.unitPrice).toFixed(2) : ''}
                  </span>
                  {items.length > 1 && <Button icon={<MinusCircleOutlined />} danger size="small" onClick={() => removeItem(it.key)} />}
                </Space>
              ))}
            </Card>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
