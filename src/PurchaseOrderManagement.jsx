import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, InputNumber, Card, DatePicker, AutoComplete, Typography } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined, DeleteOutlined, EditOutlined, MinusCircleOutlined } from '@ant-design/icons'
import api from './auth'
import dayjs from 'dayjs'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const { Content } = Layout
const { Text } = Typography

const STATUS_MAP = {
  ORDERED:          { label: '已下单', color: 'blue' },
  PARTIAL_RECEIVED: { label: '部分到货', color: 'orange' },
  RECEIVED:         { label: '已到货', color: 'green' },
}

const PART_TYPES = ['电容', '电感', '磁珠', '电阻', 'PCB板材', 'IC', '二极管', '三极管', '晶振', '连接器', '继电器', '其他']

const emptyItem = () => ({ key: Date.now(), partType: null, partId: null, partLabel: '', orderedQty: null, estimatedUnitPrice: null })

export default function PurchaseOrderManagement({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState(null)
  const [supplierFilter, setSupplierFilter] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [items, setItems] = useState([emptyItem()])
  const [parts, setParts] = useState([])
  const [suppliers, setSuppliers] = useState([])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: pageSize, offset: (page - 1) * pageSize }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      if (keyword) params.keyword = keyword
      if (statusFilter) params.status = statusFilter
      if (supplierFilter) params.supplierName = supplierFilter
      const res = await api.get('/erp/purchase-orders', { params })
      // res.data is ApiResult wrapper: { code, message, data }
      const apiData = res.data?.data || res.data || {}
      setOrders(Array.isArray(apiData) ? apiData : (apiData.data || []))
      setTotal(apiData.count || 0)
    } catch (e) {
      message.error('加载采购单失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, statusFilter, supplierFilter, effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const fetchParts = useCallback(async () => {
    try {
      const params = { size: 2000 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/parts', { params })
      const partsPayload = res.data?.data || res.data || {}
      const list = (partsPayload.parts || []).map(p => {
        const model = p.userPartModel || ''
        return { value: p.partId, label: model || `物料ID:${p.partId}`, partId: p.partId, partType: p.partType || '' }
      })
      setParts(list)
    } catch (e) { /* ignore */ }
  }, [effectiveCompanyId, isSuperAdmin])

  useEffect(() => {
    fetchParts()
  }, [fetchParts])

  const fetchSuppliers = useCallback(async () => {
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/suppliers/all', { params })
      // res.data is ApiResult wrapper, actual data is in res.data.data
      const suppliersList = res.data?.data || res.data || []
      setSuppliers(Array.isArray(suppliersList) ? suppliersList.map(s => ({ value: s.name, label: s.name })) : [])
    } catch (e) { /* ignore */ }
  }, [effectiveCompanyId, isSuperAdmin])

  const openCreate = () => {
    setEditing(null); form.resetFields(); setItems([emptyItem()])
    fetchParts(); fetchSuppliers(); setShowModal(true)
  }

  const openEdit = async (record) => {
    setEditing(record); fetchParts(); fetchSuppliers()
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/purchase-orders/${record.purchase_id}`, { params })
      const detail = res.data?.data || res.data
      form.setFieldsValue({
        supplierName: detail.supplier_name,
        expectedDeliveryDate: detail.expected_delivery_date ? dayjs(detail.expected_delivery_date) : null,
        paymentStatus: detail.payment_status, notes: detail.notes
      })
      const its = (detail.items || []).map(it => ({
        key: Date.now() + Math.random(), partType: null, partId: it.part_id, partLabel: '',
        orderedQty: it.ordered_qty, estimatedUnitPrice: it.estimated_unit_price
      }))
      setItems(its.length > 0 ? its : [emptyItem()])
      setShowModal(true)
    } catch (e) { message.error('获取详情失败') }
  }

  const handlePartTypeChange = (itemKey, partType) => {
    setItems(items.map(it => it.key === itemKey ? { ...it, partType, partId: null, partLabel: '' } : it))
  }

  const handlePartSelect = (itemKey, partId) => {
    const p = parts.find(p => p.partId === partId)
    setItems(items.map(it => it.key === itemKey ? { ...it, partId, partLabel: p?.label || '' } : it))
  }

  const getFilteredPartsForItem = (item) => {
    if (!item.partType) return parts
    return parts.filter(p => p.partType === item.partType)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      // 至少 1 条物料
      if (items.length === 0) { message.error('请至少添加一行物料明细'); return }
      // 整张订单任意非空行（用户保留的）都必须字段齐
      const filledRows = items.filter(it => it.partType || it.partId || it.orderedQty || it.estimatedUnitPrice)
      if (filledRows.length === 0) { message.error('请至少填写一行完整的物料明细（物料类型 / 物料 / 订量 / 预估单价 均必填）'); return }
      const incompleteRows = filledRows.filter(it => !it.partType || !it.partId || !it.orderedQty || it.orderedQty <= 0 || it.estimatedUnitPrice == null)
      if (incompleteRows.length > 0) {
        message.error(`有 ${incompleteRows.length} 条物料字段未填全：物料类型 / 物料 / 订量 / 预估单价 均为必填`)
        return
      }
      // 数量校验：所有 partId 行的数量必须 > 0
      const rowsWithPart = items.filter(it => it.partId)
      const invalidQty = rowsWithPart.filter(it => !it.orderedQty || it.orderedQty <= 0)
      if (invalidQty.length > 0) {
        message.error(`有 ${invalidQty.length} 条物料数量为 0 或未填写，采购数量必须大于 0`)
        return
      }
      const payload = {
        supplierName: values.supplierName,
        expectedDeliveryDate: values.expectedDeliveryDate ? values.expectedDeliveryDate.format('YYYY-MM-DD') : null,
        status: editing ? editing.status : 'ORDERED',
        paymentStatus: values.paymentStatus, notes: values.notes,
        companyId: effectiveCompanyId || user?.companyId || 0,
        createdBy: user?.id, items: rowsWithPart.filter(it => it.orderedQty > 0).map(it => ({
          partId: it.partId, orderedQty: it.orderedQty, estimatedUnitPrice: it.estimatedUnitPrice || 0
        }))
      }
      if (editing) {
        await api.put(`/erp/purchase-orders/${editing.purchase_id}`, payload)
        message.success('已更新')
      } else {
        await api.post('/erp/purchase-orders', payload)
        message.success('已创建')
      }
      setShowModal(false); setEditing(null); form.resetFields(); setItems([emptyItem()])
      setPage(1); fetchOrders()
    } catch (e) {
      if (!e.errorFields) message.error('保存失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleDelete = async (id) => {
    try { await api.delete(`/erp/purchase-orders/${id}?companyId=${effectiveCompanyId || 0}`); message.success('已删除'); fetchOrders() }
    catch (e) { message.error('删除失败: ' + (e.response?.data?.error || e.message)) }
  }
  const handleStatusChange = async (id, status) => {
    try { await api.put(`/erp/purchase-orders/${id}/status?companyId=${effectiveCompanyId || 0}`, { status }); message.success('状态已更新'); fetchOrders() }
    catch (e) { message.error('操作失败: ' + (e.response?.data?.error || e.message)) }
  }

  const addItem = () => setItems([...items, emptyItem()])
  const removeItem = (key) => { if (items.length <= 1) return; setItems(items.filter(it => it.key !== key)) }
  const updateItem = (key, field, val) => setItems(items.map(it => it.key === key ? { ...it, [field]: val } : it))

  const [expandedItems, setExpandedItems] = useState({})
  const fetchExpandedItems = async (record) => {
    if (expandedItems[record.purchase_id]) return
    try {
      const res = await api.get(`/erp/purchase-orders/${record.purchase_id}`)
      const items = res.data?.data?.items || res.data?.items || []
      setExpandedItems(prev => ({ ...prev, [record.purchase_id]: items }))
    } catch (e) { /* ignore */ }
  }
  const expandedRowRender = (record) => {
    const items = expandedItems[record.purchase_id]
    if (!items || items.length === 0) return <Text type="secondary">暂无明细</Text>
    return (
      <Table size="small" dataSource={items} rowKey="item_id" pagination={false}
        columns={[
          { title: '物料编码', dataIndex: 'part_id', width: 160, render: (v, row) => { const p = parts.find(p => p.partId === v); return p?.label || row?.user_part_model || v || '-' } },
          { title: '订量', dataIndex: 'ordered_qty', width: 80 },
          { title: '已收', dataIndex: 'received_qty', width: 80 },
          { title: '估价', dataIndex: 'estimated_unit_price', width: 100, render: v => v ? Number(v).toFixed(4) : '-' },
        ]} />
    )
  }

  const columns = [
    { title: '采购单号', dataIndex: 'po_number', width: 180 },
    { title: '供应商', dataIndex: 'supplier_name', width: 130 },
    { title: '下单日期', dataIndex: 'order_date', width: 110, render: v => v || '-' },
    { title: '预计到货', dataIndex: 'expected_delivery_date', width: 110, render: v => v || '-' },
    { title: '金额', dataIndex: 'total_amount', width: 100, align: 'right', render: v => v != null ? v.toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: s => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag> },
    { title: '付款', dataIndex: 'payment_status', width: 80, render: s => s === 'PAID' ? <Tag color="green">已付</Tag> : s === 'PARTIAL' ? <Tag color="orange">部分</Tag> : <Tag>未付</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: v => v ? dayjs(v).format('MM-DD HH:mm') : '-' },
    { title: '操作', key: 'actions', width: 180, fixed: 'right', render: (_, r) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm
          title={`确认删除采购单 ${r.po_number}?`}
          description="删除后无法恢复，相关明细也会一并删除。"
          okText="确认删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() => handleDelete(r.purchase_id)}>
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
            <Input.Search placeholder="搜索采购单号/供应商" allowClear value={keyword}
              onChange={e => setKeyword(e.target.value)} onSearch={() => { setPage(1); fetchOrders() }} style={{ width: 260 }} />
            <Input placeholder="供应商" allowClear value={supplierFilter}
              onChange={e => setSupplierFilter(e.target.value)} onPressEnter={() => { setPage(1); fetchOrders() }} style={{ width: 130 }} />
            <Select placeholder="状态筛选" allowClear style={{ width: 130 }} value={statusFilter}
              onChange={v => { setStatusFilter(v); setPage(1) }}
              options={Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); fetchOrders() }}>刷新</Button>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>录入采购单</Button>
        </Space>
        <Table dataSource={orders} columns={columns} rowKey="purchase_id" loading={loading}
          expandable={{ expandedRowRender, onExpand: (expanded, record) => { if (expanded) fetchExpandedItems(record) } }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps) } }} scroll={{ x: 1100 }} />
        <Modal title={editing ? '编辑采购单' : '录入采购单'} open={showModal} onOk={handleSave} width={900} okText="保存" destroyOnClose
          onCancel={() => { setShowModal(false); setEditing(null); form.resetFields(); setItems([emptyItem()]) }}>
          <Form form={form} layout="vertical">
            <Space wrap>
              <Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请输入' }]}>
                <AutoComplete placeholder="供应商名称" style={{ width: 200 }} options={suppliers} /></Form.Item>
              <Form.Item name="expectedDeliveryDate" label="预计到货" rules={[{ required: true, message: '请选择预计到货日期' }]}><DatePicker style={{ width: 160 }} /></Form.Item>
              <Form.Item name="paymentStatus" label="付款状态" initialValue="UNPAID">
                <Select style={{ width: 120 }} options={[{ value: 'UNPAID', label: '未付款' }, { value: 'PARTIAL', label: '部分付款' }, { value: 'PAID', label: '已付款' }]} /></Form.Item>
            </Space>
            <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
            <Card size="small" title="物料明细" extra={<Button type="dashed" icon={<PlusOutlined />} onClick={addItem}>添加物料</Button>} style={{ marginTop: 16 }}>
              {items.map((it) => (
                <Space key={it.key} style={{ marginBottom: 10, width: '100%' }} align="start" wrap>
                  <Select placeholder="物料类型" style={{ width: 120 }}
                    value={it.partType} onChange={v => handlePartTypeChange(it.key, v)}
                    options={PART_TYPES.map(t => ({ value: t, label: t }))} allowClear />
                  <Select placeholder="选择物料" style={{ width: 240 }} showSearch optionFilterProp="label"
                    value={it.partId} onChange={v => handlePartSelect(it.key, v)}
                    options={getFilteredPartsForItem(it)} />
                  <Input placeholder="型号" style={{ width: 180 }} disabled value={it.partLabel || (it.partId ? '...' : '')} />
                  <InputNumber placeholder="订量" min={1} value={it.orderedQty}
                    onChange={v => updateItem(it.key, 'orderedQty', v)} style={{ width: 80 }} />
                  <InputNumber placeholder="预估单价" min={0} step={0.01} value={it.estimatedUnitPrice}
                    onChange={v => updateItem(it.key, 'estimatedUnitPrice', v)} style={{ width: 100 }} />
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
