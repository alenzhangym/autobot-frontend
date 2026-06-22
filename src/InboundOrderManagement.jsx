import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, AutoComplete, Tag, Space, message, DatePicker, Upload, Popconfirm, Row, Col, Card, InputNumber, Typography } from 'antd'
import { PlusOutlined, CameraOutlined, InboxOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, SearchOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import api from './auth'
import dayjs from 'dayjs'

const { Content } = Layout
const { RangePicker } = DatePicker
const { Text } = Typography

const PART_TYPES = ['电容', '电感', '磁珠', '电阻', 'PCB板材', 'IC', '二极管', '三极管', '晶振', '连接器', '继电器', '保险丝', '传感器', '变压器', '其他']

const STATUS_MAP = {
  RECEIVED:  { label: '已到货', color: 'blue' },
  CANCELLED: { label: '已取消', color: 'red' },
}

const STATUS_OPTIONS = Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))

const emptyItem = () => ({ key: Date.now(), partType: '', model: '', manufacturer: '', orderedQty: 0, receivedQty: 0, qty: null, unitPrice: null, location: '', notes: '', dirty: true })

export default function InboundOrderManagement({ user, companies = [] }) {
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ supplierName: '', dateFrom: '', dateTo: '' })
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm] = Form.useForm()
  const [items, setItems] = useState([emptyItem()])
  const [itemFilter, setItemFilter] = useState('')

  // 按型号过滤物料明细 (不区分大小写, 包含匹配)
  const filteredItems = useMemo(() => {
    const kw = itemFilter.trim().toLowerCase()
    if (!kw) return items
    return items.filter(it => (it.model || '').toString().toLowerCase().includes(kw))
  }, [items, itemFilter])
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrPreview, setOcrPreview] = useState(null)
  const [parts, setParts] = useState([])
  const [partTypes, setPartTypes] = useState(PART_TYPES)
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [poLoading, setPoLoading] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm] = Form.useForm()
  const [editItems, setEditItems] = useState([])
  const [editingOrder, setEditingOrder] = useState(null)
  const [editingReconciled, setEditingReconciled] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [modalKey, setModalKey] = useState(0)

  useEffect(() => {
    (async () => {
      try {
        const params = {}
        if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
        const [sRes, pRes] = await Promise.all([
          api.get('/erp/suppliers/all', { params }),
          api.get('/erp/parts', { params: { ...params, size: 999 } }),
        ])
        // Handle ApiResult wrapper: { code, message, data }
        const suppliersData = sRes.data?.data || sRes.data || []
        const partsData = pRes.data?.data || pRes.data || []
        setSuppliers(Array.isArray(suppliersData) ? suppliersData : (suppliersData.data || []))
        const fetchedParts = Array.isArray(partsData) ? partsData : (partsData.parts || [])
        setParts(fetchedParts)
        const types = [...new Set([...PART_TYPES, ...fetchedParts.map(p => p.partType).filter(Boolean)])]
        setPartTypes(types)
      } catch (e) { /* ignore */ }
    })()
  }, [isSuperAdmin, effectiveCompanyId])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, size: pageSize,
        supplierName: filters.supplierName || undefined, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/inbound-orders', { params })
      // Handle ApiResult wrapper: { code, message, data }
      const apiData = res.data?.data || res.data || {}
      setOrders(Array.isArray(apiData) ? apiData : (apiData.orders || []))
      setTotal(apiData.total || 0)
    } catch (e) {
      message.error('加载入库单失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, filters, effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const handleAction = async (id, action, extra = {}) => {
    try { await api.post(`/erp/inbound-orders/${id}/${action}`, extra); message.success('操作成功'); fetchOrders() }
    catch (e) { message.error(e.response?.data?.error || '操作失败') }
  }

  const handleDelete = async (id) => { try { await api.delete(`/erp/inbound-orders/${id}`); message.success('已删除'); fetchOrders() } catch (e) { message.error(e.response?.data?.error || '删除失败') } }

  const openEdit = async (order) => {
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/inbound-orders/${order.inboundId}`, { params })
      const detail = res.data
      setEditingOrder(order)
      editForm.setFieldsValue({
        supplierName: detail.supplierName,
        orderDate: detail.orderDate ? dayjs(detail.orderDate) : null,
      })
      setEditingReconciled(!!detail.reconciled)
      // Ensure current supplierName is in Select options even if not in master list
      if (detail.supplierName && !suppliers.some(s => s.name === detail.supplierName)) {
        setSuppliers(prev => [...prev, { supplierId: -Date.now(), name: detail.supplierName }])
      }
      const its = (detail.items || []).map((it, idx) => ({
        key: Date.now() + Math.random(),
        originalIndex: idx,
        partType: it.partType || '',
        model: it.model || '',
        manufacturer: it.manufacturer || '',
        qty: it.qty || null,
        unitPrice: it.unitPrice || null,
        location: it.location || '',
        notes: it.notes || '',
        dirty: false,
      }))
      setEditItems(its.length > 0 ? its : [emptyItem()])
      setShowEditModal(true)
    } catch (e) { message.error('加载入库单详情失败') }
  }

  const addEditItem = () => setEditItems(prev => [...prev, { ...emptyItem(), dirty: true }])
  const removeEditItem = (key) => { if (editItems.length <= 1) return; setEditItems(prev => prev.filter(it => it.key !== key)) }
  const updateEditItem = (key, field, value) => {
    setEditItems(prev => prev.map(it => it.key === key ? { ...it, [field]: value, dirty: true } : it))
  }

  const handleEditSave = async () => {
    try {
      const values = await editForm.validateFields()
      // 数量校验：只校验 dirty 行
      const dirtyItems = editItems.filter(it => it.dirty)
      const invalidQty = dirtyItems.filter(it => !it.qty || it.qty <= 0)
      if (invalidQty.length > 0) {
        message.error(`有 ${invalidQty.length} 条已修改物料数量为 0，本次入库数量必须大于 0`)
        return
      }
      // 只发送被用户实际修改过的条目
      const orderItems = dirtyItems.map(it => ({
        originalIndex: it.originalIndex,
        partType: it.partType, model: it.model, manufacturer: it.manufacturer,
        qty: it.qty || 0, unitPrice: it.unitPrice || 0,
        subtotal: (it.qty || 0) * (it.unitPrice || 0),
        location: it.location, notes: it.notes || '',
      }))
      await api.put(`/erp/inbound-orders/${editingOrder.inboundId}`, {
        supplierName: values.supplierName,
        orderDate: values.orderDate?.format('YYYY-MM-DD'),
        items: orderItems,
        partial: true,
      })
      message.success(`已更新 ${orderItems.length} 条记录`)
      setShowEditModal(false); setEditItems([]); setEditingOrder(null); fetchOrders()
    } catch (e) { if (!e.errorFields) message.error('更新失败: ' + (e.response?.data?.error || e.message)) }
  }

  const fetchPurchaseOrders = async (supplierName) => {
    if (!supplierName) { setPurchaseOrders([]); return }
    setPoLoading(true)
    try {
      const params = { supplierName, limit: 100 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/purchase-orders', { params })
      const poPayload = res.data?.data || res.data || {}
      setPurchaseOrders((poPayload.data || []).filter(po => po.status !== 'RECEIVED'))
    } catch (e) { /* ignore */ }
    setPoLoading(false)
  }

  const fetchPoItems = async (poId) => {
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/purchase-orders/${poId}`, { params })
      return res.data?.data?.items || res.data?.items || []
    } catch (e) { return [] }
  }

  // 将采购单明细填充为入库单的物料参考行
  const buildItemsFromPurchaseOrders = async (poList) => {
    if (!poList || poList.length === 0) { setItems([emptyItem()]); return }
    const allRows = []
    for (const po of poList) {
      const poItems = await fetchPoItems(po.purchase_id)
      for (const it of poItems) {
        const p = parts.find(x => x.partId === it.part_id)
        allRows.push({
          key: Date.now() + Math.random() + allRows.length,
          dirty: false,
          partType: p?.partType || '',
          model: p?.userPartModel || '',
          manufacturer: p?.manufacturer || '',
          orderedQty: it.ordered_qty || 0,
          receivedQty: it.received_qty || 0,
          poItemId: it.item_id,
          poId: po.purchase_id,
          poNumber: po.po_number || '',
          qty: 0,
          unitPrice: it.estimated_unit_price || 0,
          location: '',
          notes: '',
        })
      }
    }
    setItems(allRows.length > 0 ? allRows : [emptyItem()])
  }

  const handleSupplierChange = async (supplierName) => {
    setItems([emptyItem()])
    setPurchaseOrders([])
    setItemFilter('')
    if (!supplierName) return
    // 拉取该供应商全部采购单，并自动带入物料明细作为参考
    setPoLoading(true)
    try {
      const params = { supplierName, limit: 100 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/purchase-orders', { params })
      const poPayload = res.data?.data || res.data || {}
      const list = (poPayload.data || []).filter(po => po.status !== 'RECEIVED')
      setPurchaseOrders(list)
      await buildItemsFromPurchaseOrders(list)
    } catch (e) { /* ignore */ }
    setPoLoading(false)
  }

  const openCreate = () => {
    createForm.resetFields()
    setItems([emptyItem()])
    setPurchaseOrders([])
    setModalKey(prev => prev + 1)
    setShowCreateModal(true)
  }

  const removeItem = (key) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter(it => it.key !== key))
  }

  const updateItem = (key, field, value) => {
    setItems(prev => prev.map(it => it.key === key ? { ...it, [field]: value, dirty: true } : it))
  }

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      // 只发送用户实际修改过的物料条目，未触碰的（auto-load）不算入本次入库
      const dirty = items.filter(it => it.dirty)
      if (dirty.length === 0) {
        message.warning('请至少修改一条物料（点击数量/单价输入框）以确认本次入库')
        return
      }
      const invalidQty = dirty.filter(it => !it.qty || it.qty <= 0)
      if (invalidQty.length > 0) {
        message.error(`有 ${invalidQty.length} 条已修改物料数量为 0 或未填写，本次入库数量必须大于 0`)
        return
      }
      const orderItems = dirty.map(it => ({
        partType: it.partType, model: it.model, manufacturer: it.manufacturer,
        qty: it.qty || 0, unitPrice: it.unitPrice || 0,
        subtotal: (it.qty || 0) * (it.unitPrice || 0),
        location: it.location, notes: it.notes || '',
        poItemId: it.poItemId || null,
        poId: it.poId || null,
      }))
      await api.post('/erp/inbound-orders', {
        supplierName: values.supplierName,
        items: orderItems,
      })
      message.success(`入库单已到货 (${orderItems.length} 项物料)`)
      setShowCreateModal(false); setItems([emptyItem()]); setPurchaseOrders([]); fetchOrders()
    } catch (e) { if (!e.errorFields) message.error('创建失败: ' + (e.response?.data?.error || e.message)) }
  }

  const handleOcr = async (file) => {
    setOcrLoading(true)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const res = await api.post('/erp/inbound-orders/ocr', { image: e.target.result.split(',')[1] })
        const parsed = res.data.parsed_data
        if (parsed) {
          createForm.setFieldsValue({ supplierName: parsed.supplier_name || parsed.manufacturer || '' })
          setItems([{ key: Date.now(), partType: parsed.part_type || '', model: parsed.user_part_model || '',
            manufacturer: parsed.manufacturer || '', qty: parsed.quantity || null,
            unitPrice: parsed.purchase_price || parsed.unit_price || null, location: '', notes: '' }])
        }
        setOcrPreview(res.data); message.success('图片识别完成，已填入表单')
      } catch (err) { message.error('OCR失败: ' + (err.response?.data?.error || err.message)) }
      setOcrLoading(false)
    }
    reader.readAsDataURL(file)
    return false
  }

  const confirmOcr = async () => {
    if (!ocrPreview?.parsed_data) return
    const p = ocrPreview.parsed_data
    try {
      await api.post('/erp/inbound-orders', { supplierName: p.supplier_name || p.manufacturer, orderDate: new Date().toISOString().split('T')[0],
        items: [{ partType: p.part_type, model: p.user_part_model, qty: p.quantity || 0,
          unitPrice: p.purchase_price || p.unit_price || 0, manufacturer: p.manufacturer || '' }] })
      message.success('已从图片创建入库单'); setOcrPreview(null); fetchOrders()
    } catch (e) { message.error('创建失败') }
  }

  const itemsSummary = (r) => {
    const its = r.items || []
    if (!its.length) return '-'
    const types = [...new Set(its.map(i => i.partType).filter(Boolean))]
    const totalQty = its.reduce((s, i) => s + (i.qty || 0), 0)
    return (types.length ? types.join('/') + ' ' : '') + totalQty + '件'
  }

  const columns = [
    { title: '入库单号', dataIndex: 'orderNumber', key: 'no', width: 170 },
    { title: '采购单号', dataIndex: 'poNumber', key: 'poNo', width: 170, render: v => v ? <Text code>{v}</Text> : '-' },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplier', width: 110, render: v => v || '-' },
    { title: '采购日期', dataIndex: 'orderDate', key: 'odate', width: 100 },
    { title: '物料摘要', key: 'summary', width: 160, render: (_, r) => itemsSummary(r) },
    { title: '金额', dataIndex: 'totalAmount', key: 'amount', width: 90, render: v => v ? '¥' + Number(v).toFixed(2) : '-' },
    { title: '对账状态', dataIndex: 'reconciled', key: 'reconciled', width: 95, render: v => v
        ? <Tag color="green">已对账</Tag>
        : <Tag color="default">未对账</Tag> },
    { title: '到货', dataIndex: 'receivedDate', key: 'rdate', width: 100, render: v => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 65, render: s => { const i = STATUS_MAP[s] || { label: s, color: 'default' }; return <Tag color={i.color}>{i.label}</Tag> } },
    { title: '操作', key: 'act', width: 180, fixed: 'right',
      render: (_, r) => {
        const s = r.status
        return (<Space size="small">
          {s === 'DRAFT' && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>}
          <Popconfirm
            title={`确认删除入库单 ${r.orderNumber}?`}
            description={(s === 'RECEIVED' || s === 'COMPLETED')
              ? '入库单已到货，删除将自动扣减对应库存、撤销关联采购单收货数量。'
              : '删除后无法恢复。'}
            okText="确认删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete(r.inboundId)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>)
      }},
  ]

  const [expandedItems, setExpandedItems] = useState({})
  const fetchExpandedItems = async (record) => {
    if (expandedItems[record.inboundId]) return
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/inbound-orders/${record.inboundId}`, { params })
      const items = res.data?.items || []
      setExpandedItems(prev => ({ ...prev, [record.inboundId]: items }))
    } catch (e) { /* ignore */ }
  }
  const renderExpand = (record) => {
    const items = expandedItems[record.inboundId] || record.items || []
    if (!items || items.length === 0) return <Text type="secondary">暂无明细</Text>
    return (<div style={{ padding: '12px 24px', background: '#111' }}>
      <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>入库明细 ({items.length} 项)</div>
      <Table size="small" dataSource={items} rowKey={(_, i) => i} pagination={false}
        columns={[
          { title: '#', width: 40, render: (_, __, i) => i + 1 },
          { title: '品类', dataIndex: 'partType', width: 80, render: v => v || '-' },
          { title: '型号', dataIndex: 'model', width: 160, render: v => v || '-' },
          { title: '厂家', dataIndex: 'manufacturer', width: 100, render: v => v || '-' },
          { title: '数量', dataIndex: 'qty', width: 70, align: 'right' },
          { title: '单价', dataIndex: 'unitPrice', width: 90, align: 'right', render: v => v != null ? '¥' + Number(v).toFixed(4) : '-' },
          { title: '小计', dataIndex: 'subtotal', width: 90, align: 'right', render: v => v != null ? '¥' + Number(v).toFixed(2) : '-' },
          { title: '库位', dataIndex: 'location', width: 80, render: v => v || '-' },
          { title: '备注', dataIndex: 'notes', width: 120, render: v => v || '-' },
        ]} />
    </div>)
  }

  return (<Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}><Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
      <Col><h2 style={{ color: '#e3e3e3', margin: 0 }}>采购入库单管理</h2></Col>
      <Col><Space>
        <Upload accept="image/*" showUploadList={false} beforeUpload={handleOcr}><Button icon={<CameraOutlined />} loading={ocrLoading}>拍照识别</Button></Upload>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建入库单</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchOrders}>刷新</Button>
      </Space></Col>
    </Row>
    <Card size="small" style={{ marginBottom: 16, background: '#141414', border: '1px solid #222' }}>
      <Row gutter={12}>
        <Col><Select placeholder="供应商" allowClear style={{ width: 160 }} value={filters.supplierName || undefined}
          showSearch onChange={v => setFilters(f => ({ ...f, supplierName: v || '' }))}
          filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}>
          {suppliers.map(s => <Select.Option key={s.supplierId||s.name} value={s.name}>{s.name}</Select.Option>)}
        </Select></Col>
        <Col><RangePicker style={{ width: 240 }} onChange={dates => setFilters(f => ({ ...f, dateFrom: dates?.[0]?.format('YYYY-MM-DD') || '', dateTo: dates?.[1]?.format('YYYY-MM-DD') || '' }))} /></Col>
        <Col><Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); fetchOrders() }}>搜索</Button></Col></Row>
    </Card>
    {(() => {
      const totalAmt = orders.reduce((s, o) => s + (o.totalAmount || 0), 0)
      const reconciledCount = orders.filter(o => o.reconciled).length
      return (<Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
          <div style={{ color: '#888', fontSize: 12 }}>入库单数</div>
          <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>{orders.length}</div>
        </Card></Col>
        <Col span={8}><Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
          <div style={{ color: '#888', fontSize: 12 }}>总金额</div>
          <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>¥{totalAmt.toFixed(2)}</div>
        </Card></Col>
        <Col span={8}><Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
          <div style={{ color: '#888', fontSize: 12 }}>已对账数</div>
          <div style={{ color: reconciledCount > 0 ? '#52c41a' : '#e3e3e3', fontSize: 22, fontWeight: 600 }}>{reconciledCount} / {orders.length}</div>
        </Card></Col>
      </Row>)
    })()}
    <Table dataSource={orders} columns={columns} rowKey="inboundId" loading={loading}
      expandable={{ expandedRowRender: renderExpand, onExpand: (expanded, record) => { if (expanded) fetchExpandedItems(record) } }}
      pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'], onChange: (p, ps) => { setPage(p); setPageSize(ps) } }}
      scroll={{ x: 1000 }} size="small" style={{ background: '#141414' }} />

    {/* ── Create Modal with items table ── */}
    <Modal key={modalKey} title="新建入库单" open={showCreateModal} onOk={handleCreate} onCancel={() => { setShowCreateModal(false); setItemFilter('') }}
      okText="保存" width={1000} destroyOnClose>
      <Form form={createForm} layout="vertical">
        <Row gutter={16}>
          <Col span={24}><Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
            <Select showSearch placeholder="选择供应商" allowClear
              onChange={handleSupplierChange}
              filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}
            >
              {suppliers.map(s => <Select.Option key={s.supplierId} value={s.name}>{s.name}</Select.Option>)}
            </Select>
          </Form.Item></Col>
        </Row>
      </Form>
      {/* 参考采购单列表 - 仅供用户参考采购单信息，非必选 */}
      {purchaseOrders.length > 0 && (
        <div style={{ background: '#0d1a26', border: '1px solid #1f3a52', borderRadius: 4, padding: 8, marginBottom: 8 }}>
          <div style={{ color: '#69b1ff', fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📋 该供应商的全部采购单（参考信息，共 {purchaseOrders.length} 单）</span>
            <span style={{ color: '#666', fontSize: 11, fontWeight: 'normal' }}>下方物料明细已自动带入</span>
          </div>
          <div style={{ maxHeight: 80, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 11 }}>
              <thead><tr style={{ borderBottom: '1px solid #1f3a52' }}>
                <th style={{ padding: 3, textAlign: 'left' }}>采购单号</th>
                <th style={{ padding: 3, textAlign: 'left' }}>采购日期</th>
                <th style={{ padding: 3, textAlign: 'left' }}>状态</th>
                <th style={{ padding: 3, textAlign: 'right' }}>金额</th>
              </tr></thead>
              <tbody>{purchaseOrders.map(po => (
                <tr key={po.purchase_id} style={{ borderBottom: '1px solid #162a3a' }}>
                  <td style={{ padding: 3, color: '#69b1ff' }}>{po.po_number || '-'}</td>
                  <td style={{ padding: 3 }}>{po.order_date || '-'}</td>
                  <td style={{ padding: 3 }}>{po.status || '-'}</td>
                  <td style={{ padding: 3, textAlign: 'right' }}>{po.total_amount != null ? '¥' + Number(po.total_amount).toFixed(2) : '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {poLoading && <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>正在加载该供应商的采购单...</div>}
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>
          物料明细 {itemFilter && <span style={{ color: '#69b1ff' }}>（{filteredItems.length} / {items.length}）</span>}
        </span>
        <Input
          size="small"
          prefix={<SearchOutlined style={{ color: '#888' }} />}
          placeholder="按型号过滤"
          value={itemFilter}
          onChange={e => setItemFilter(e.target.value)}
          allowClear
          style={{ width: 200 }}
        />
      </div>
      <div style={{ maxHeight: 280, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ padding: 4, width: 30 }}>#</th>
            <th style={{ padding: 4, width: 70 }}>采购单</th>
            <th style={{ padding: 4, width: 70 }}>品类</th>
            <th style={{ padding: 4, width: 140 }}>型号</th>
            <th style={{ padding: 4, width: 70 }}>厂家</th>
            <th style={{ padding: 4, width: 45 }}>采购量</th>
            <th style={{ padding: 4, width: 45 }}>已入库</th>
            <th style={{ padding: 4, width: 60 }}>本次入库</th>
            <th style={{ padding: 4, width: 60 }}>单价</th>
            <th style={{ padding: 4, width: 50 }}>小计</th>
            <th style={{ padding: 4, width: 60 }}>库位</th>
            <th style={{ padding: 4 }}>备注</th>
            <th style={{ padding: 4, width: 30 }}></th>
          </tr></thead>
          <tbody>{filteredItems.map((it) => {
            const origIdx = items.indexOf(it)
            return (
            <tr key={it.key} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <td style={{ padding: 2, color: '#666' }}>{origIdx + 1}</td>
              <td style={{ padding: 2, color: '#69b1ff', fontSize: 11 }}>{it.poNumber || '-'}</td>
              <td style={{ padding: 2 }}><Select size="small" style={{ width: '100%' }} value={it.partType || undefined} placeholder="品类"
                onChange={v => { updateItem(it.key, 'partType', v); updateItem(it.key, 'model', '') }} options={partTypes.map(t => ({ value: t, label: t }))} /></td>
              <td style={{ padding: 2 }}><AutoComplete size="small" style={{ width: '100%' }} placeholder="型号" value={it.model}
                options={parts.filter(p => !it.partType || p.partType === it.partType).map(p => ({ value: p.userPartModel, label: p.userPartModel }))}
                onChange={v => updateItem(it.key, 'model', v)}
                onSelect={v => { const p = parts.find(x => x.userPartModel === v); if (p) updateItem(it.key, 'manufacturer', p.manufacturer || '') }}
                filterOption={(input, option) => option?.value?.toLowerCase().includes(input.toLowerCase())} /></td>
              <td style={{ padding: 2 }}><Input size="small" style={{ width: '100%' }} placeholder="厂家" value={it.manufacturer}
                onChange={e => updateItem(it.key, 'manufacturer', e.target.value)} /></td>
              <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.orderedQty || '-'}</td>
              <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.receivedQty || '-'}</td>
              <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0" min={1} precision={0} value={it.qty}
                onChange={v => updateItem(it.key, 'qty', v)} /></td>
              <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.unitPrice}
                onChange={v => updateItem(it.key, 'unitPrice', v)} /></td>
              <td style={{ padding: 2, textAlign: 'right', color: '#888', fontSize: 11 }}>{it.qty && it.unitPrice ? '¥' + (it.qty * it.unitPrice).toFixed(2) : ''}</td>
              <td style={{ padding: 2 }}><Input size="small" style={{ width: '100%' }} placeholder="库位" value={it.location}
                onChange={e => updateItem(it.key, 'location', e.target.value)} /></td>
              <td style={{ padding: 2 }}><Input size="small" style={{ width: '100%' }} placeholder="备注" value={it.notes}
                onChange={e => updateItem(it.key, 'notes', e.target.value)} /></td>
              <td style={{ padding: 2 }}><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeItem(it.key)} /></td>
            </tr>
            )
          })}</tbody>
        </table>
        {filteredItems.length === 0 && items.length > 0 && (
          <div style={{ color: '#888', fontSize: 12, textAlign: 'center', padding: 20 }}>
            没有匹配 "{itemFilter}" 的物料明细
          </div>
        )}
      </div>
      <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
         选择供应商后自动列出其全部采购单并带入物料明细，可直接编辑本次入库数量与单价后保存。
      </div>
    </Modal>

    {/* ── Edit Modal ── */}
    <Modal title="编辑入库单草稿" open={showEditModal} onOk={handleEditSave} onCancel={() => { setShowEditModal(false); setEditItems([]); setEditingOrder(null); setEditingReconciled(false) }}
      okText="保存" width={1000} destroyOnClose>
      <Form form={editForm} layout="vertical">
        <Row gutter={16}>
          <Col span={12}><Form.Item name="supplierName" label="供应商" rules={[{ required: true }]}>
            <Select showSearch placeholder="选择或输入供应商" allowClear
              filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}
            >
              {suppliers.map(s => <Select.Option key={s.supplierId} value={s.name}>{s.name}</Select.Option>)}
            </Select>
          </Form.Item></Col>
          <Col span={12}><Form.Item name="orderDate" label="采购日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        {editingReconciled && (
          <div style={{ background: '#3a2a14', border: '1px solid #faad14', color: '#faad14', padding: 8, borderRadius: 4, marginBottom: 12, fontSize: 12 }}>
            ⚠ 该入库单已对账完成，单价不可修改。
          </div>
        )}
      </Form>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>物料明细</span>
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addEditItem}>添加行</Button>
      </div>
      <div style={{ maxHeight: 280, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ padding: 4, width: 30 }}>#</th>
            <th style={{ padding: 4, width: 100 }}>品类</th>
            <th style={{ padding: 4, width: 210 }}>型号</th>
            <th style={{ padding: 4, width: 110 }}>厂家</th>
            <th style={{ padding: 4, width: 60 }}>数量</th>
            <th style={{ padding: 4, width: 80 }}>单价</th>
            <th style={{ padding: 4, width: 60 }}>小计</th>
            <th style={{ padding: 4, width: 80 }}>库位</th>
            <th style={{ padding: 4 }}>备注</th>
            <th style={{ padding: 4, width: 30 }}></th>
          </tr></thead>
          <tbody>{editItems.map((it, idx) => (
            <tr key={it.key} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <td style={{ padding: 2, color: '#666' }}>{idx + 1}</td>
              <td style={{ padding: 2 }}><Select size="small" style={{ width: '100%' }} value={it.partType || undefined} placeholder="品类"
                onChange={v => { updateEditItem(it.key, 'partType', v); updateEditItem(it.key, 'model', '') }} options={partTypes.map(t => ({ value: t, label: t }))} /></td>
              <td style={{ padding: 2 }}><AutoComplete size="small" style={{ width: '100%' }} placeholder="型号" value={it.model}
                options={parts.filter(p => !it.partType || p.partType === it.partType).map(p => ({ value: p.userPartModel, label: p.userPartModel }))}
                onChange={v => updateEditItem(it.key, 'model', v)}
                onSelect={v => { const p = parts.find(x => x.userPartModel === v); if (p) updateEditItem(it.key, 'manufacturer', p.manufacturer || '') }}
                filterOption={(input, option) => option?.value?.toLowerCase().includes(input.toLowerCase())} /></td>
              <td style={{ padding: 2 }}><Input size="small" style={{ width: '100%' }} placeholder="厂家" value={it.manufacturer}
                onChange={e => updateEditItem(it.key, 'manufacturer', e.target.value)} /></td>
              <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0" min={0} value={it.qty}
                onChange={v => updateEditItem(it.key, 'qty', v)} /></td>
              <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.unitPrice}
                disabled={editingReconciled}
                onChange={v => updateEditItem(it.key, 'unitPrice', v)} /></td>
              <td style={{ padding: 2, textAlign: 'right', color: '#888', fontSize: 11 }}>{it.qty && it.unitPrice ? '¥' + (it.qty * it.unitPrice).toFixed(2) : ''}</td>
              <td style={{ padding: 2 }}><Input size="small" style={{ width: '100%' }} placeholder="库位" value={it.location}
                onChange={e => updateEditItem(it.key, 'location', e.target.value)} /></td>
              <td style={{ padding: 2 }}><Input size="small" style={{ width: '100%' }} placeholder="备注" value={it.notes}
                onChange={e => updateEditItem(it.key, 'notes', e.target.value)} /></td>
              <td style={{ padding: 2 }}><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeEditItem(it.key)} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>

    {/* ── OCR Preview ── */}
    <Modal title="OCR识别预览" open={!!ocrPreview} onOk={confirmOcr} onCancel={() => setOcrPreview(null)} okText="确认创建" width={550}>
      {ocrPreview && <div><pre style={{ background: '#111', padding: 12, borderRadius: 8, color: '#ccc', maxHeight: 100, overflow: 'auto', fontSize: 12 }}>{(ocrPreview.raw_text || '').substring(0, 400)}</pre>
        {ocrPreview.parsed_data && <table style={{ width: '100%', marginTop: 12, color: '#ccc', fontSize: 12 }}><tbody>
          <tr><td style={{ color: '#888', padding: 2 }}>类型</td><td>{ocrPreview.parsed_data.intent || '-'}</td></tr>
          <tr><td style={{ color: '#888', padding: 2 }}>供应商</td><td>{ocrPreview.parsed_data.supplier_name || ocrPreview.parsed_data.manufacturer || '-'}</td></tr>
          <tr><td style={{ color: '#888', padding: 2 }}>品类</td><td>{ocrPreview.parsed_data.part_type || '-'}</td></tr>
          <tr><td style={{ color: '#888', padding: 2 }}>型号</td><td>{ocrPreview.parsed_data.user_part_model || '-'}</td></tr>
          <tr><td style={{ color: '#888', padding: 2 }}>数量</td><td>{ocrPreview.parsed_data.quantity || '-'}</td></tr>
          <tr><td style={{ color: '#888', padding: 2 }}>单价</td><td>{ocrPreview.parsed_data.purchase_price || ocrPreview.parsed_data.unit_price || '-'}</td></tr>
        </tbody></table>}</div>}
    </Modal>
  </Content></Layout>)
}
