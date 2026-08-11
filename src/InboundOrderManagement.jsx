import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, AutoComplete, Tag, Space, message, DatePicker, Upload, Popconfirm, Row, Col, Card, InputNumber, Typography, Alert, Statistic, Checkbox } from 'antd'
import { PlusOutlined, InboxOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, SearchOutlined, DeleteOutlined, EditOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons'
import api from './auth'
import dayjs from 'dayjs'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const { Content } = Layout
const { RangePicker } = DatePicker
const { Text } = Typography

const PART_TYPES = ['电容', '电感', '磁珠', '电阻', 'PCB板材', 'IC', '二极管', '三极管', '晶振', '连接器', '继电器', '保险丝', '传感器', '变压器', '其他']

const STATUS_MAP = {
  RECEIVED:  { label: '已入库', color: 'blue' },
  CANCELLED: { label: '已取消', color: 'red' },
}

const STATUS_OPTIONS = Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))

const emptyItem = () => ({ key: Date.now(), partType: '', model: '', manufacturer: '', orderedQty: 0, receivedQty: 0, qty: null, unitPrice: null, taxInclusiveUnitPrice: null, location: '', notes: '', dirty: true })

export default function InboundOrderManagement({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ supplierName: '', dateFrom: '', dateTo: '' })
  const [exportOpen, setExportOpen] = useState(false)
  const [exportForm] = Form.useForm()
  const [exporting, setExporting] = useState(false)
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
  const [parts, setParts] = useState([])
  const [partTypes, setPartTypes] = useState(PART_TYPES)
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [poLoading, setPoLoading] = useState(false)
  const [selectedPoId, setSelectedPoId] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm] = Form.useForm()
  const [editItems, setEditItems] = useState([])
  const [editingOrder, setEditingOrder] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [modalKey, setModalKey] = useState(0)

  // ── Historical Import state ──
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFileList, setImportFileList] = useState([])
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importUpdateStock, setImportUpdateStock] = useState(true)
  const [clearingAll, setClearingAll] = useState(false)

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
        taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || null,
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
        qty: it.qty || 0, unitPrice: it.unitPrice || 0, taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || 0,
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
          taxInclusiveUnitPrice: it.tax_inclusive_unit_price || 0,
          location: '',
          notes: '',
        })
      }
    }
    setItems(allRows.length > 0 ? allRows : [emptyItem()])
  }

  // 加载采购单列表: 优先按当前供应商, 支持按采购单号关键字搜索(供直接粘贴单号检索)
  const loadPurchaseOrders = async (keyword) => {
    const supplierName = createForm.getFieldValue('supplierName')
    setPoLoading(true)
    try {
      const params = { limit: 100 }
      const kw = (keyword || '').trim()
      if (kw) params.keyword = kw
      else if (supplierName) params.supplierName = supplierName
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/purchase-orders', { params })
      const poPayload = res.data?.data || res.data || {}
      setPurchaseOrders((poPayload.data || []).filter(po => po.status !== 'RECEIVED'))
    } catch (e) { /* ignore */ }
    setPoLoading(false)
  }

  const poSearchTimer = useRef(null)
  const handlePoSearch = (value) => {
    if (poSearchTimer.current) clearTimeout(poSearchTimer.current)
    poSearchTimer.current = setTimeout(() => loadPurchaseOrders(value), 300)
  }

  const handleSupplierChange = async (supplierName) => {
    setItems([emptyItem()])
    setPurchaseOrders([])
    setSelectedPoId(null)
    createForm.setFieldValue('purchaseOrderId', null)
    setItemFilter('')
    if (!supplierName) return
    // 选择供应商后，仅列出该供应商的采购单供选择（不自动带入全部物料）
    loadPurchaseOrders('')
  }

  // 选择采购单后，带入该采购单的物料明细作为参考
  const handlePoChange = async (poId) => {
    setSelectedPoId(poId)
    setItemFilter('')
    if (!poId) { setItems([emptyItem()]); return }
    const po = purchaseOrders.find(p => p.purchase_id === poId)
    if (po) await buildItemsFromPurchaseOrders([po])
  }

  const openCreate = () => {
    createForm.resetFields()
    setItems([emptyItem()])
    setPurchaseOrders([])
    setSelectedPoId(null)
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
        qty: it.qty || 0, unitPrice: it.unitPrice || 0, taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || 0,
        subtotal: (it.qty || 0) * (it.unitPrice || 0),
        location: it.location, notes: it.notes || '',
        poItemId: it.poItemId || null,
        poId: it.poId || null,
      }))
      await api.post('/erp/inbound-orders', {
        supplierName: values.supplierName,
        purchaseOrderId: values.purchaseOrderId,
        items: orderItems,
      })
      message.success(`入库单已到货 (${orderItems.length} 项物料)`)
      setShowCreateModal(false); setItems([emptyItem()]); setPurchaseOrders([]); fetchOrders()
    } catch (e) { if (!e.errorFields) message.error('创建失败: ' + (e.response?.data?.error || e.message)) }
  }

  // ── Historical Import ──
  const openImport = () => {
    setImportFileList([])
    setImportText('')
    setImportResult(null)
    setImportUpdateStock(true)
    setShowImportModal(true)
  }

  const handleImport = async () => {
    const hasText = importText.trim().length > 0
    if (!hasText && importFileList.length === 0) { message.warning('请上传文件或粘贴内容'); return }
    setImporting(true)
    setImportResult(null)
    try {
      let res
      if (hasText) {
        res = await api.post('/erp/inbound-orders/import-simple', { text: importText, updateStock: importUpdateStock })
      } else {
        const formData = new FormData()
        formData.append('file', importFileList[0].originFileObj)
        formData.append('updateStock', String(importUpdateStock))
        res = await api.post('/erp/inbound-orders/import-simple-file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      }
      setImportResult(res.data?.data || res.data)
      message.success('导入完成')
      fetchOrders()
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setImporting(false)
    }
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
    { title: '到货', dataIndex: 'receivedDate', key: 'rdate', width: 100, render: v => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 65, render: s => { const i = STATUS_MAP[s] || { label: s, color: 'default' }; return <Tag color={i.color}>{i.label}</Tag> } },
    { title: '创建人', dataIndex: 'createdByName', key: 'createdBy', width: 90, render: v => v || '-' },
    { title: '操作', key: 'act', width: 240, fixed: 'right',
      render: (_, r) => {
        const s = r.status
        return (<Space size="small">
          {s === 'DRAFT' && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>}
          <Popconfirm
            title="确认重新计算金额？"
            description="将按明细行的单价/含税单价 × 数量重新计算并覆盖该入库单金额。"
            okText="重算" cancelText="取消"
            onConfirm={() => handleRecalcAmount(r.inboundId)}>
            <Button size="small" icon={<ReloadOutlined />}>重算金额</Button>
          </Popconfirm>
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

  const handleClearAll = async () => {
    setClearingAll(true)
    try {
      const payload = {}
      if (filters.supplierName) payload.supplierName = filters.supplierName
      const res = await api.post('/erp/inbound-orders/clear-all', payload)
      const result = res.data?.data || res.data || {}
      const matched = result.matched || 0
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (matched === 0) { message.info('没有匹配的入库单可清空') }
      else if (deleted > 0 && skipped === 0) message.success(`已清空 ${deleted} 个入库单`)
      else if (deleted > 0 && skipped > 0) message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个`)
      else if (deleted === 0 && skipped > 0) message.error(`未能删除任何入库单, 跳过 ${skipped} 个`)
      if (errors.length > 0) {
        Modal.info({
          title: '清空详情', width: 560,
          content: (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {errors.map((e, i) => <div key={i} style={{ marginBottom: 4 }}>{e}</div>)}
            </div>
          )
        })
      }
      fetchOrders()
    } catch (e) {
      message.error('一键清空失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setClearingAll(false)
    }
  }

  const handleRecalcAll = async () => {
    setClearingAll(true)
    try {
      const res = await api.post(`/erp/inbound-orders/recalc-all-amount?companyId=${effectiveCompanyId || 0}`)
      const r = res.data?.data || res.data || {}
      const matched = r.matched || 0
      const updated = r.updated || 0
      const errors = r.errors || []
      if (updated > 0) message.success(`已重算 ${updated}/${matched} 张入库单金额`)
      else message.info('没有需要重算的入库单')
      if (errors.length > 0) {
        Modal.info({
          title: '批量重算详情', width: 560,
          content: (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {errors.map((e, i) => <div key={i} style={{ marginBottom: 4 }}>{e}</div>)}
            </div>
          )
        })
      }
      fetchOrders()
    } catch (e) {
      message.error('批量重算失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setClearingAll(false)
    }
  }

  const handleRecalcAmount = async (id) => {
    try {
      const res = await api.post(`/erp/inbound-orders/${id}/recalc-amount?companyId=${effectiveCompanyId || 0}`)
      const r = res.data?.data || res.data || {}
      const total = r.total_amount != null ? Number(r.total_amount).toLocaleString() : '-'
      message.success(`已重新计算金额: ${total}`)
      fetchOrders()
    } catch (e) {
      message.error('重算金额失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleExportFile = async (format) => {
    try {
      const values = await exportForm.validateFields()
      setExporting(true)
      const params = { format }
      if (effectiveCompanyId) params.companyId = effectiveCompanyId
      if (values.supplierName) params.supplierName = values.supplierName
      if (values.dateRange && values.dateRange.length === 2) {
        params.dateFrom = values.dateRange[0].format('YYYY-MM-DD')
        params.dateTo = values.dateRange[1].format('YYYY-MM-DD')
      }
      const res = await api.get('/erp/inbound-orders/export/file', { params, responseType: 'blob' })
      const disposition = res.headers?.['content-disposition'] || ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]) : `入库单明细.${format}`
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      message.success(`已下载 ${format.toUpperCase()} 文件`)
      setExportOpen(false)
    } catch (e) {
      if (e?.errorFields) return
      const msg = e?.response?.data?.error || e.message
      message.error('下载失败: ' + (e.response?.data instanceof Blob ? '服务器错误' : msg))
    } finally { setExporting(false) }
  }

  return (<Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}><Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
      <Col><h2 style={{ color: '#e3e3e3', margin: 0 }}>采购入库单管理</h2></Col>
      <Col><Space>
        <Button icon={<UploadOutlined />} onClick={openImport}>历史导入</Button>
        <Popconfirm
          title="一键清空入库单"
          description={() => {
            const parts = []
            if (filters.supplierName) parts.push(`供应商=${filters.supplierName}`)
            const cond = parts.length > 0 ? `（筛选: ${parts.join(', ')}）` : '（无筛选, 清空全部）'
            return `将删除所有匹配的入库单并回退库存/采购单数量${cond}, 删除后无法恢复.`
          }}
          onConfirm={handleClearAll}
          okText="清空" cancelText="取消"
          okButtonProps={{ danger: true, loading: clearingAll }}
        >
          <Button danger icon={<DeleteOutlined />} loading={clearingAll}>一键清空</Button>
        </Popconfirm>
        <Button icon={<DownloadOutlined />} onClick={() => { exportForm.resetFields(); setExportOpen(true) }}>导出</Button>
        <Popconfirm
          title="确认批量重算全部入库单金额？"
          description="将按明细行的单价/含税单价 × 数量重新计算并覆盖所有入库单金额，用于修复历史单据金额为0的问题。"
          okText="重算" cancelText="取消"
          onConfirm={handleRecalcAll}
          okButtonProps={{ loading: clearingAll }}
        >
          <Button icon={<ReloadOutlined />} loading={clearingAll}>批量重算金额</Button>
        </Popconfirm>
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
      return (<Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}><Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
          <div style={{ color: '#888', fontSize: 12 }}>入库单数</div>
          <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>{orders.length}</div>
        </Card></Col>
        <Col span={12}><Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
          <div style={{ color: '#888', fontSize: 12 }}>总金额</div>
          <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>¥{totalAmt.toFixed(2)}</div>
        </Card></Col>
      </Row>)
    })()}
    <Table dataSource={orders} columns={columns} rowKey="inboundId" loading={loading}
      expandable={{ expandedRowRender: renderExpand, onExpand: (expanded, record) => { if (expanded) fetchExpandedItems(record) } }}
      pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'], onChange: (p, ps) => { setPage(p); setPageSize(ps) } }}
      scroll={{ x: 1000 }} size="small" style={{ background: '#141414' }} />

    {/* ── Create Modal with items table ── */}
    <Modal key={modalKey} title="新建入库单" open={showCreateModal} onOk={handleCreate} onCancel={() => { setShowCreateModal(false); setItemFilter('') }}
      okText="保存" width={1000} destroyOnHidden>
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
          <Col span={24}><Form.Item name="purchaseOrderId" label="采购单" rules={[{ required: true, message: '请选择采购单（必须先建立采购单才能新建入库单）' }]}>
            <Select showSearch placeholder="选择采购单（可输入采购单号搜索）" loading={poLoading} allowClear
              onChange={handlePoChange}
              onSearch={handlePoSearch}
              onFocus={() => { if (!purchaseOrders.length && createForm.getFieldValue('supplierName')) loadPurchaseOrders('') }}
              notFoundContent={poLoading ? '加载中...' : '该供应商暂无采购单，请先创建采购单'}
              filterOption={false}
            >
              {purchaseOrders.map(po => <Select.Option key={po.purchase_id} value={po.purchase_id}>{po.po_number}（{po.status}）</Select.Option>)}
            </Select>
          </Form.Item></Col>
        </Row>
      </Form>
      {selectedPoId && purchaseOrders.find(p => p.purchase_id === selectedPoId) ? (
        <div style={{ color: '#69b1ff', fontSize: 12, marginBottom: 8 }}>已选择采购单，下方物料明细已自动带入，可编辑本次入库数量与单价。</div>
      ) : (
        <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>选择供应商后请选择一张采购单，未选择采购单无法新建入库单。</div>
      )}
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
            <th style={{ padding: 4, width: 60 }}>含税单价</th>
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
              <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.taxInclusiveUnitPrice}
                onChange={v => updateItem(it.key, 'taxInclusiveUnitPrice', v)} /></td>
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
        选择供应商后，必须选择一张采购单才能新建入库单；未选择采购单时系统会提示先建立采购单。
      </div>
    </Modal>

    {/* ── Edit Modal ── */}
    <Modal title="编辑入库单草稿" open={showEditModal} onOk={handleEditSave} onCancel={() => { setShowEditModal(false); setEditItems([]); setEditingOrder(null) }}
      okText="保存" width={1000} destroyOnHidden>
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
            <th style={{ padding: 4, width: 80 }}>含税单价</th>
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
                onChange={v => updateEditItem(it.key, 'unitPrice', v)} /></td>
              <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.taxInclusiveUnitPrice}
                onChange={v => updateEditItem(it.key, 'taxInclusiveUnitPrice', v)} /></td>
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

    {/* ── Historical Import Modal ── */}
    <Modal
      title="导入历史入库单"
      open={showImportModal}
      onCancel={() => setShowImportModal(false)}
      width={640}
      footer={[
        <Button key="cancel" onClick={() => setShowImportModal(false)}>关闭</Button>,
        <Button key="import" type="primary" loading={importing} icon={<UploadOutlined />}
          onClick={handleImport}>开始导入</Button>,
      ]}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="支持 Excel (.xlsx/.xls)、CSV 或直接粘贴文本导入"
        description="表格需包含以下列：采购单号、到货日期、物料号、数量、单价。可选列：含税单价。系统按列名自动识别（列顺序不限），供应商通过采购单号自动关联已存在的采购单获取，无需手动选择。"
      />
      <Checkbox
        checked={importUpdateStock}
        onChange={e => setImportUpdateStock(e.target.checked)}
        style={{ marginBottom: 12 }}
      >
        修改库存数据（勾选则按数量增加库存，不勾选仅记录入库单、不修改库存计数）
      </Checkbox>
      <Input.TextArea
        rows={5}
        placeholder="在此粘贴表格内容（列头 + 数据行），例如：&#10;采购单号\t到货日期\t物料号\t数量\t单价\t含税单价&#10;PO20260001\t2026/08/08\tHPC6045BMV-221M\t1000\t0.85\t0.93"
        value={importText}
        onChange={e => setImportText(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      <div style={{ textAlign: 'center', color: '#666', fontSize: 12, marginBottom: 12 }}>或上传文件</div>
      <Upload.Dragger
        accept=".xlsx,.xls,.csv"
        fileList={importFileList}
        onChange={({ fileList: fl }) => setImportFileList(fl.slice(-1))}
        beforeUpload={() => false}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">点击或拖拽文件到此区域</p>
        <p className="ant-upload-hint">支持 .xlsx / .xls / .csv 格式</p>
      </Upload.Dragger>

      {importResult && (
        <div style={{ marginTop: 8 }}>
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={12}><Statistic title="导入入库单数" value={importResult.imported || 0} valueStyle={{ color: '#52c41a' }} /></Col>
          </Row>
          {importResult.orders && importResult.orders.length > 0 && (
            <Alert
              type="success" showIcon
              message={`共创建 ${importResult.orders.length} 张入库单`}
              description={
                <div style={{ maxHeight: 200, overflow: 'auto' }}>
                  {importResult.orders.map((o, i) => (
                    <div key={i}>
                      {i + 1}. 入库单号: {o.orderNumber} | 状态: {o.status} | 明细数: {o.itemCount}
                    </div>
                  ))}
                </div>
              }
            />
          )}
        </div>
      )}
    </Modal>

    {/* ── Export Modal ── */}
    <Modal
      title="导出入库单"
      open={exportOpen}
      onCancel={() => setExportOpen(false)}
      width={520}
      footer={[
        <Button key="cancel" onClick={() => setExportOpen(false)}>取消</Button>,
        <Button key="csv" loading={exporting} onClick={() => handleExportFile('csv')}>导出 CSV</Button>,
        <Button key="xlsx" type="primary" loading={exporting} icon={<DownloadOutlined />}
          onClick={() => handleExportFile('xlsx')}>导出 Excel</Button>,
      ]}
    >
      <Form form={exportForm} layout="vertical">
        <Form.Item name="supplierName" label="供应商">
          <Select showSearch placeholder="按供应商筛选（可选）" allowClear
            filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}
          >
            {suppliers.map(s => <Select.Option key={s.supplierId} value={s.name}>{s.name}</Select.Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="dateRange" label="订单日期范围">
          <RangePicker style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  </Content></Layout>)
}
