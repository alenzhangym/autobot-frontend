import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layout, Table, Button, Modal, Form, Input, InputNumber, Select, AutoComplete, Tag, Space, message, DatePicker, Upload, Descriptions, Popconfirm, Row, Col, Card, Alert, Statistic, Checkbox } from 'antd'
import { PlusOutlined, SendOutlined, ReloadOutlined, EyeOutlined, CheckOutlined, CloseOutlined, TruckOutlined, SearchOutlined, DeleteOutlined, EditOutlined, UploadOutlined, InboxOutlined, DownloadOutlined } from '@ant-design/icons'
import api from './auth'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js'

const { Content } = Layout
const { RangePicker } = DatePicker

const STATUS_MAP = {
  SHIPPED:     { label: '已出库', color: 'orange' },
  COMPLETED:   { label: '已完成', color: 'green' },
  CANCELLED:   { label: '已取消', color: 'red' },
}

const STATUS_OPTIONS = Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))

const emptyItem = () => ({ key: Date.now(), customerPartNo: '', model: '', orderedQty: 0, shippedQty: 0, qty: null, unitPrice: null, taxInclusiveUnitPrice: null, dirty: true })

export default function OutboundOrderManagement({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ customerName: '', keyword: '', dateFrom: '', dateTo: '' })
  const [exportOpen, setExportOpen] = useState(false)
  const [exportForm] = Form.useForm()
  const [exporting, setExporting] = useState(false)
  const [expandedRowKeys, setExpandedRowKeys] = useState([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm] = Form.useForm()
  const [customers, setCustomers] = useState([])
  const [items, setItems] = useState([emptyItem()])
  const [itemFilter, setItemFilter] = useState('')

  // 按客户料号 / 型号过滤物料明细 (不区分大小写, 匹配任一即显示)
  const filteredItems = useMemo(() => {
    const kw = itemFilter.trim().toLowerCase()
    if (!kw) return items
    return items.filter(it => {
      const cpn = (it.customerPartNo || '').toString().toLowerCase()
      const mdl = (it.model || '').toString().toLowerCase()
      return cpn.includes(kw) || mdl.includes(kw)
    })
  }, [items, itemFilter])
  const [parts, setParts] = useState([])
  const [custMappings, setCustMappings] = useState([])
  const [selectedCustId, setSelectedCustId] = useState(null)
  const [salesOrders, setSalesOrders] = useState([])
  const [soLoading, setSoLoading] = useState(false)
  const [selectedSoId, setSelectedSoId] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [editItems, setEditItems] = useState([])

  // ── Historical Import state ──
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFileList, setImportFileList] = useState([])
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importUpdateStock, setImportUpdateStock] = useState(true)
  const [clearingAll, setClearingAll] = useState(false)

  // ── Substitute (替代物料) selector modal state ──
  const [subModal, setSubModal] = useState({ visible: false, target: null, model: '', subs: [], manual: [], sameType: [], partType: '', loading: false, query: '', freeQuery: '', freeResults: [], freeLoading: false })

  // Cache for parts fetched on-demand from /api/erp/parts/{id} (handles stale/truncated local catalog)
  const partsByIdCacheRef = useRef(new Map())

  useEffect(() => {
    (async () => {
      try {
        const params = {}
        if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
        const [cRes, pRes] = await Promise.all([
          api.get('/erp/customers/all', { params }),
          api.get('/erp/parts', { params: { ...params, size: 999 } }),
        ])
        // Handle ApiResult wrapper: { code, message, data }
        const customersData = cRes.data?.data || cRes.data || []
        const partsData = pRes.data?.data || pRes.data || []
        setCustomers(Array.isArray(customersData) ? customersData : (customersData.customers || []))
        setParts(Array.isArray(partsData) ? partsData : (partsData.parts || []))
      } catch (e) { /* ignore */ }
    })()
  }, [isSuperAdmin, effectiveCompanyId])

  useEffect(() => {
    if (!selectedCustId) { setCustMappings([]); return }
    (async () => {
      try {
        const res = await api.get(`/erp/customer-part-mappings/by-customer/${selectedCustId}`)
        setCustMappings(res.data || [])
      } catch (e) { setCustMappings([]) }
    })()
  }, [selectedCustId])

  const addItem = () => setItems(prev => [...prev, emptyItem()])
  const removeItem = (key) => { if (items.length <= 1) return; setItems(prev => prev.filter(it => it.key !== key)) }
  const updateItem = (key, field, value) => setItems(prev => prev.map(it => it.key === key ? { ...it, [field]: value, dirty: true } : it))

  const openSubstituteSelector = async (target, model) => {
    if (!model) { message.warning('请先选择物料型号'); return }
    setSubModal({ visible: true, target, model, subs: [], manual: [], sameType: [], partType: '', loading: true, query: '', freeQuery: '', freeResults: [], freeLoading: false })
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/outbound-orders/substitutes', { params: { model, ...params } })
      const data = res.data || {}
      setSubModal({
        visible: true, target, model,
        subs: data.data || [],
        manual: data.manual || [],
        sameType: data.sameType || [],
        partType: data.fromPartType || '',
        loading: false, query: '',
        freeQuery: '', freeResults: [], freeLoading: false
      })
    } catch (e) {
      message.error('查询替代物料失败: ' + (e.response?.data?.error || e.message))
      setSubModal({ visible: false, target: null, model: '', subs: [], manual: [], sameType: [], partType: '', loading: false, query: '', freeQuery: '', freeResults: [], freeLoading: false })
    }
  }

  const applySubstitute = (sub) => {
    const { target } = subModal
    if (!target || !sub) return
    const originalModel = target.originalModel
    target.setter(prev => prev.map((it, idx) => idx === target.index ? {
      ...it,
      originalModel: it.originalModel || originalModel,
      substituted: true,
      model: sub.to_model || sub.toModel || it.model,
      partId: sub.to_part_id || sub.toPartId || null,
      inventoryId: sub.inventory_id || sub.inventoryId || null,
      currentStock: sub.current_stock != null ? Number(sub.current_stock) : (sub.currentStock != null ? sub.currentStock : null),
      unitPrice: sub.unit_price != null ? Number(sub.unit_price) : (sub.unitPrice != null ? sub.unitPrice : it.unitPrice),
      dirty: true,
    } : it))
    setSubModal({ visible: false, target: null, model: '', subs: [], manual: [], sameType: [], partType: '', loading: false, query: '', freeQuery: '', freeResults: [], freeLoading: false })
    message.success(`已选择替代物料: ${sub.to_model || sub.toModel}`)
  }

  const clearSubstitute = (setter, index) => {
    setter(prev => prev.map((it, idx) => idx === index ? {
      ...it,
      model: it.originalModel || it.model,
      currentStock: null,
      substituted: false,
      originalModel: undefined,
      dirty: true,
    } : it))
  }

  const searchFreeSubstitute = async (query) => {
    if (!query || query.trim().length < 2) {
      setSubModal(prev => ({ ...prev, freeQuery: query, freeResults: [], freeLoading: false }))
      return
    }
    setSubModal(prev => ({ ...prev, freeQuery: query, freeLoading: true }))
    try {
      const params = { keyword: query.trim(), size: 20 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/parts', { params })
      const parts = res.data?.parts || []
      const enriched = await Promise.all(parts.map(async p => {
        const partId = p.partId
        let stock = null
        let inventoryId = null
        let unitPrice = null
        let supplierName = null
        try {
          const stockRes = await api.get('/erp/outbound-orders/stock-info', { params: { models: p.userPartModel } })
          stock = stockRes.data?.stockMap?.[p.userPartModel] != null ? Number(stockRes.data.stockMap[p.userPartModel]) : null
        } catch (e) { /* ignore */ }
        return {
          to_part_id: partId,
          to_model: p.userPartModel,
          to_manufacturer: p.manufacturer,
          to_part_type: p.partType,
          to_description: p.description,
          inventory_id: inventoryId,
          current_stock: stock,
          unit_price: unitPrice,
          supplier_name: supplierName,
          candidate_type: 'FREE_SEARCH',
        }
      }))
      setSubModal(prev => ({ ...prev, freeResults: enriched, freeLoading: false }))
    } catch (e) {
      message.error('搜索物料失败: ' + (e.response?.data?.error || e.message))
      setSubModal(prev => ({ ...prev, freeResults: [], freeLoading: false }))
    }
  }

  const fetchSalesOrders = async (customerId) => {
    if (!customerId) { setSalesOrders([]); return }
    setSoLoading(true)
    try {
      const params = { customerId, limit: 100 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/sales-orders', { params })
      const soPayload = res.data?.data || res.data || {}
      setSalesOrders((soPayload.data || []).filter(so => so.status !== 'SHIPPED'))
    } catch (e) { /* ignore */ }
    setSoLoading(false)
  }

  const fetchSoItems = async (soId) => {
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/sales-orders/${soId}`, { params })
      return res.data?.data?.items || res.data?.items || []
    } catch (e) { return [] }
  }

  // 单条销售单明细 → 入库物料行（复用原 handleSoSelect 中的解析与补全逻辑）
  const mapSoItemsToRows = async (soItems) => {
    const mapped = soItems.map(it => {
      const partIdRaw = it.part_id ?? it.partId
      const partIdNum = partIdRaw != null ? Number(partIdRaw) : null
      const model = it.model || ''
      const hasModel = model && model.trim().length > 0
      if (!hasModel && partIdNum != null) {
        partsByIdCacheRef.current.set(partIdNum, null)
      } else if (hasModel) {
        partsByIdCacheRef.current.set(partIdNum, { partId: partIdNum, userPartModel: model, partType: it.partType || null, manufacturer: it.manufacturer || null })
      }
      return {
        key: Date.now() + Math.random(),
        dirty: false,
        customerPartNo: it.customer_part_no || it.customerPartNo || '',
        model,
        partId: partIdNum,
        soItemId: it.item_id != null ? Number(it.item_id) : (it.soItemId != null ? Number(it.soItemId) : null),
        partType: it.partType || null,
        manufacturer: it.manufacturer || null,
        inventoryId: null,
        orderedQty: it.ordered_qty ?? it.orderedQty ?? 0,
        shippedQty: it.shipped_qty ?? it.shippedQty ?? 0,
        qty: 0,
        unitPrice: it.unit_price ?? it.unitPrice ?? 0,
        taxInclusiveUnitPrice: it.tax_inclusive_unit_price ?? it.taxInclusiveUnitPrice ?? null,
        currentStock: it.currentStock != null ? Number(it.currentStock) : null,
        substitutes: it.substitutes || [],
        substituteCount: it.substituteCount != null ? Number(it.substituteCount) : (it.substitutes ? it.substitutes.length : 0),
        substituteMaxStock: it.substituteMaxStock != null ? Number(it.substituteMaxStock) : null,
      }
    })

    const missing = mapped.filter(it => !it.model && it.partId != null && !partsByIdCacheRef.current.get(it.partId))
    if (missing.length > 0) {
      await Promise.all(missing.map(async it => {
        try {
          const pParams = {}
          if (isSuperAdmin && effectiveCompanyId) pParams.companyId = effectiveCompanyId
          const partRes = await api.get(`/erp/parts/${it.partId}`, { params: pParams })
          const p = partRes.data
          if (p && (p.partId != null)) {
            partsByIdCacheRef.current.set(Number(p.partId), p)
            it.model = p.userPartModel || p.user_part_model || ''
            it.partType = it.partType || p.partType || p.part_type || null
            it.manufacturer = it.manufacturer || p.manufacturer || null
            try {
              const stockRes = await api.get('/erp/outbound-orders/stock-info', { params: { models: it.model } })
              const stockMap = stockRes.data.stockMap || {}
              it.currentStock = stockMap[it.model] != null ? Number(stockMap[it.model]) : null
            } catch (e) { /* ignore */ }
            try {
              const sParams = { model: it.model }
              if (isSuperAdmin && effectiveCompanyId) sParams.companyId = effectiveCompanyId
              const subRes = await api.get('/erp/outbound-orders/substitutes', { params: sParams })
              const subs = subRes.data?.data || []
              it.substitutes = subs
              it.substituteCount = subs.length
              it.substituteMaxStock = subs.reduce((mx, s) => {
                const cs = s.current_stock ?? s.currentStock
                return Math.max(mx, cs != null ? Number(cs) : 0)
              }, 0)
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      }))
    }

    const noSub = mapped.filter(it => it.model && (it.substituteCount == null || it.substituteCount === 0))
    if (noSub.length > 0) {
      await Promise.all(noSub.map(async it => {
        try {
          const sParams = { model: it.model }
          if (isSuperAdmin && effectiveCompanyId) sParams.companyId = effectiveCompanyId
          const subRes = await api.get('/erp/outbound-orders/substitutes', { params: sParams })
          const subs = subRes.data?.data || []
          it.substitutes = subs
          it.substituteCount = subs.length
          it.substituteMaxStock = subs.reduce((mx, s) => {
            const cs = s.current_stock ?? s.currentStock
            return Math.max(mx, cs != null ? Number(cs) : 0)
          }, 0)
        } catch (e) { /* ignore */ }
      }))
    }
    return mapped
  }

  const buildItemsFromSalesOrders = async (soList) => {
    if (!soList || soList.length === 0) { setItems([emptyItem()]); return }
    const allRows = []
    for (const so of soList) {
      const soItems = await fetchSoItems(so.sales_id)
      const rows = await mapSoItemsToRows(soItems)
      for (const r of rows) {
        allRows.push({
          ...r,
          key: Date.now() + Math.random() + allRows.length,
          soId: so.sales_id,
          soNumber: so.so_number || '',
        })
      }
    }
    setItems(allRows.length > 0 ? allRows : [emptyItem()])
  }

  // 加载销售单列表: 优先按当前客户, 支持按销售单号关键字搜索(供直接粘贴单号检索)
  const loadSalesOrders = async (keyword) => {
    const customerId = createForm.getFieldValue('customerId')
    setSoLoading(true)
    try {
      const params = { limit: 100 }
      const kw = (keyword || '').trim()
      if (kw) params.keyword = kw
      else if (customerId) params.customerId = customerId
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/sales-orders', { params })
      const soPayload = res.data?.data || res.data || {}
      setSalesOrders((soPayload.data || []).filter(so => so.status !== 'SHIPPED'))
    } catch (e) { /* ignore */ }
    setSoLoading(false)
  }

  const soSearchTimer = useRef(null)
  const handleSoSearch = (value) => {
    if (soSearchTimer.current) clearTimeout(soSearchTimer.current)
    soSearchTimer.current = setTimeout(() => loadSalesOrders(value), 300)
  }

  const handleCustomerChange = async (customerId) => {
    setSelectedCustId(customerId)
    setItems([emptyItem()])
    setCustMappings([])
    setItemFilter('')
    setSalesOrders([])
    setSelectedSoId(null)
    createForm.setFieldValue('salesOrderId', null)
    if (!customerId) return
    // 选择客户后，仅列出该客户的销售单供选择（不自动带入全部物料）
    loadSalesOrders('')
  }

  // 选择销售单后，带入该销售单的物料明细作为参考
  const handleSoChange = async (soId) => {
    setSelectedSoId(soId)
    setItemFilter('')
    if (!soId) { setItems([emptyItem()]); return }
    const so = salesOrders.find(s => s.sales_id === soId)
    if (so) await buildItemsFromSalesOrders([so])
  }

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        page, size: pageSize,
        customerName: filters.customerName || undefined,
        keyword: filters.keyword || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/outbound-orders', { params })
      setOrders(res.data.orders || [])
      setTotal(res.data.total || 0)
    } catch (e) {
      message.error('加载出库单失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filters, effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const handleStatusAction = async (orderId, action, extraData = {}) => {
    try {
      await api.post(`/erp/outbound-orders/${orderId}/${action}`, extraData)
      message.success(`${action === 'confirm' ? '确认' : action === 'ship' ? '出库' : action === 'complete' ? '完成' : '取消'}成功`)
      fetchOrders()
    } catch (e) {
      message.error('操作失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleDeleteDraft = async (orderId) => {
    try {
      await api.delete(`/erp/outbound-orders/${orderId}`)
      message.success('已删除')
      fetchOrders()
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const openEdit = async (record) => {
    setEditingOrder(record)
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/outbound-orders/${record.orderId}`, { params })
      const detail = res.data
      const its = (detail.items || []).map((it, idx) => ({
        key: Date.now() + Math.random(),
        originalIndex: idx,
        customerPartNo: it.customerPartNo || '',
        model: it.model || '',
        partId: it.partId || null,
        inventoryId: it.inventoryId || null,
        orderedQty: it.orderedQty || 0,
        shippedQty: it.shippedQty || 0,
        qty: it.qty || 0,
        unitPrice: it.unitPrice || 0,
        taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || null,
        currentStock: it.currentStock != null ? it.currentStock : null,
        originalModel: it.originalModel || undefined,
        substituted: !!it.substituted,
        substitutes: it.substitutes || [],
        substituteCount: it.substituteCount != null ? it.substituteCount : (it.substitutes ? it.substitutes.length : 0),
        substituteMaxStock: it.substituteMaxStock != null ? it.substituteMaxStock : null,
        dirty: false,
      }))
      setEditItems(its.length > 0 ? its : [])
      setShowEditModal(true)
    } catch (e) {
      message.error('加载详情失败')
    }
  }

  const handleEditSave = async () => {
    if (!editingOrder) return
    try {
      // 数量校验：所有 dirty 条目的 qty 必须 > 0
      const dirtyItems = editItems.filter(it => it.dirty)
      const invalidQty = dirtyItems.filter(it => !it.qty || it.qty <= 0)
      if (invalidQty.length > 0) {
        message.error(`有 ${invalidQty.length} 条已修改物料数量为 0，本次出库数量必须大于 0`)
        return
      }
      // 只发送用户实际修改过的条目，未修改的不动
      const orderItems = dirtyItems.map(it => ({
        originalIndex: it.originalIndex,
        customerPartNo: it.customerPartNo,
        model: it.model,
        partId: it.partId || null,
        inventoryId: it.inventoryId || null,
        qty: it.qty || 0,
        unitPrice: it.unitPrice || 0,
        taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || 0,
        subtotal: (it.qty || 0) * (it.unitPrice || 0),
        substituted: !!it.substituted,
        originalModel: it.originalModel || null,
      }))
      await api.put(`/erp/outbound-orders/${editingOrder.orderId}`, { items: orderItems, partial: true })
      message.success(`已更新 ${orderItems.length} 条记录`)
      setShowEditModal(false)
      setEditingOrder(null)
      setEditItems([])
      fetchOrders()
    } catch (e) {
      if (e.errorFields) return
      message.error('更新失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const getInsufficientStockItems = (list) => (
    list.filter(it => it.currentStock != null && Number(it.qty || 0) > Number(it.currentStock))
  )

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      // 只发送用户实际修改过的物料条目，未触碰的（auto-load）不算入本次出库
      const dirty = items.filter(it => it.dirty)
      if (dirty.length === 0) {
        message.warning('请至少修改一条物料（点击数量/单价输入框或选择替代料）以确认本次出库')
        return
      }
      const invalidQty = dirty.filter(it => !it.qty || it.qty <= 0)
      if (invalidQty.length > 0) {
        message.error(`有 ${invalidQty.length} 条已修改物料数量为 0 或未填写，本次出库数量必须大于 0`)
        return
      }
      const insufficientStockItems = getInsufficientStockItems(dirty)
      if (insufficientStockItems.length > 0) {
        const firstItem = insufficientStockItems[0]
        message.error(
          `库存不足：共有 ${insufficientStockItems.length} 条物料的本次出库数量大于库存，` +
          `请修改后再创建。首条物料型号：${firstItem.model || '-'}，库存：${firstItem.currentStock}，本次出库：${firstItem.qty}`
        )
        return
      }
      const orderItems = dirty.map(it => ({
        customerPartNo: it.customerPartNo,
        model: it.model,
        partId: it.partId || null,
        inventoryId: it.inventoryId || null,
        qty: it.qty || 0,
        unitPrice: it.unitPrice || 0,
        taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || 0,
        subtotal: (it.qty || 0) * (it.unitPrice || 0),
        substituted: !!it.substituted,
        originalModel: it.originalModel || null,
        soId: it.soId || null,
        soItemId: it.soItemId || null,
      }))
      const body = {
        customerId: values.customerId,
        salesOrderId: values.salesOrderId,
        items: orderItems,
      }
      await api.post('/erp/outbound-orders', body)
      message.success('出库单已出库')
      setShowCreateModal(false)
      setItems([emptyItem()])
      setSelectedCustId(null)
      setSalesOrders([])
      fetchOrders()
    } catch (e) {
      if (e.errorFields) return
      const errData = e.response?.data
      if (errData?.code === 'INVENTORY_INSUFFICIENT') {
        Modal.error({
          title: '库存不足',
          content: errData.message || '当前库存不足以完成本次出库，请调整数量后重试。',
          okText: '我知道了',
        })
        return
      }
      message.error('创建失败: ' + (errData?.message || e.message))
    }
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
        res = await api.post('/erp/outbound-orders/import-simple', { text: importText, updateStock: importUpdateStock })
      } else {
        const formData = new FormData()
        formData.append('file', importFileList[0].originFileObj)
        formData.append('updateStock', String(importUpdateStock))
        res = await api.post('/erp/outbound-orders/import-simple-file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      }
      setImportResult(res.data || res.data?.data)
      message.success('导入完成')
      fetchOrders()
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    {
      title: '出库单号', dataIndex: 'orderNumber', key: 'orderNumber', width: 180,
    },
    {
      title: '销售单号', dataIndex: 'soNumber', key: 'soNumber', width: 180,
      render: (v) => v ? <span style={{ fontFamily: 'monospace', color: '#69b1ff' }}>{v}</span> : '-',
    },
    {
      title: '客户', dataIndex: 'customer_name', key: 'customer_name', width: 120,
      render: (name) => name || (<>-</>),
    },
    {
      title: '出库日期', dataIndex: 'orderDate', key: 'orderDate', width: 110,
    },
    {
      title: '总金额', dataIndex: 'totalAmount', key: 'totalAmount', width: 100,
      render: (v) => v != null ? '¥' + Number(v).toFixed(2) : '-',
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s) => {
        const info = STATUS_MAP[s] || { label: s, color: 'default' }
        return <Tag color={info.color}>{info.label}</Tag>
      },
    },
    {
      title: '发货日期', dataIndex: 'shipDate', key: 'shipDate', width: 110,
      render: (v) => v || '-',
    },
    {
      title: '创建人', dataIndex: 'createdByName', key: 'createdBy', width: 90,
      render: (v) => v || '-',
    },
    {
      title: '操作', key: 'actions', width: 180, fixed: 'right',
      render: (_, record) => {
        const s = record.status
        const wasShipped = s === 'CONFIRMED' || s === 'SHIPPED' || s === 'COMPLETED'
        const editable = s === 'DRAFT' || s === 'SHIPPED'
        return (
          <Space size="small">
            {editable && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>修改</Button>}
            <Popconfirm
              title={`确认删除出库单 ${record.orderNumber}?`}
              description={wasShipped
                ? '此单已扣减库存，删除将自动回补对应库存、撤销关联销售单发货数量。'
                : '删除后无法恢复。'}
              okText="确认删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => handleDeleteDraft(record.orderId)}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const renderExpandedRow = (record) => {
    const items = record.items || []
    return (
      <div style={{ padding: '16px 24px', background: '#111' }}>
        <Descriptions bordered size="small" column={3} labelStyle={{ color: '#888' }} contentStyle={{ color: '#ccc' }}>
          <Descriptions.Item label="客户名称">{record.customer_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系人">{record.customer_contact || '-'}</Descriptions.Item>
          <Descriptions.Item label="电话">{record.customer_phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="出库单号">{record.orderNumber}</Descriptions.Item>
          <Descriptions.Item label="出库日期">{record.orderDate}</Descriptions.Item>
          <Descriptions.Item label="发货日期">{record.shipDate || '-'}</Descriptions.Item>
        </Descriptions>

        {items.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>物料明细</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ padding: 8, textAlign: 'left' }}>序号</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>客户料号</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>物料编码</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>原库存</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>数量</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>单价</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>小计</th>
                  <th style={{ padding: 8, textAlign: 'left' }}>替代物料</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: 8 }}>{idx + 1}</td>
                    <td style={{ padding: 8 }}>{item.customerPartNo || '-'}</td>
                    <td style={{ padding: 8 }}>{item.originalModel || item.model || `Part#${item.partId}`}</td>
                    <td style={{ padding: 8, textAlign: 'right', color: item.currentStock != null && item.currentStock < item.qty ? '#ff4d4f' : '#52c41a' }}>{item.currentStock != null ? item.currentStock : '-'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{item.qty}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{item.unitPrice != null ? '¥' + Number(item.unitPrice).toFixed(4) : '-'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{item.subtotal != null ? '¥' + Number(item.subtotal).toFixed(2) : '-'}</td>
                    <td style={{ padding: 8 }}>
                      {item.substituted
                        ? <span style={{ color: '#faad14', fontSize: 12 }}>{item.model}</span>
                        : <span style={{ color: '#666', fontSize: 11 }}>-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  const handleClearAll = async () => {
    setClearingAll(true)
    try {
      const payload = {}
      if (filters.keyword) payload.keyword = filters.keyword
      const res = await api.post('/erp/outbound-orders/clear-all', payload)
      const result = res.data?.data || res.data || {}
      const matched = result.matched || 0
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (matched === 0) { message.info('没有匹配的出库单可清空') }
      else if (deleted > 0 && skipped === 0) message.success(`已清空 ${deleted} 个出库单`)
      else if (deleted > 0 && skipped > 0) message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个`)
      else if (deleted === 0 && skipped > 0) message.error(`未能删除任何出库单, 跳过 ${skipped} 个`)
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

  const handleExportFile = async (format) => {
    try {
      const values = await exportForm.validateFields()
      setExporting(true)
      const params = { format }
      if (effectiveCompanyId) params.companyId = effectiveCompanyId
      if (values.customerName) params.customerName = values.customerName
      if (values.dateRange && values.dateRange.length === 2) {
        params.dateFrom = values.dateRange[0].format('YYYY-MM-DD')
        params.dateTo = values.dateRange[1].format('YYYY-MM-DD')
      }
      const res = await api.get('/erp/outbound-orders/export/file', { params, responseType: 'blob' })
      const disposition = res.headers?.['content-disposition'] || ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]) : `出库单明细.${format}`
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

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        {/* ── Header ── */}
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <h2 style={{ color: '#e3e3e3', margin: 0 }}>出库单管理</h2>
          </Col>
          <Col>
            <Space>
              <Button icon={<UploadOutlined />} onClick={openImport}>导入</Button>
              <Popconfirm
                title="一键清空出库单"
                description={() => {
                  const parts = []
                  if (filters.keyword) parts.push(`客户料号≈${filters.keyword}`)
                  const cond = parts.length > 0 ? `（筛选: ${parts.join(', ')}）` : '（无筛选, 清空全部）'
                  return `将删除所有匹配的出库单并回退库存/销售单数量${cond}, 删除后无法恢复.`
                }}
                onConfirm={handleClearAll}
                okText="清空" cancelText="取消"
                okButtonProps={{ danger: true, loading: clearingAll }}
              >
                <Button danger icon={<DeleteOutlined />} loading={clearingAll}>一键清空</Button>
              </Popconfirm>
              <Button icon={<DownloadOutlined />} onClick={() => { exportForm.resetFields(); setExportOpen(true) }}>导出</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { setShowCreateModal(true); setItems([emptyItem()]); setSelectedCustId(null); setSalesOrders([]); setSelectedSoId(null) }}>新建出库单</Button>
              <Button icon={<ReloadOutlined />} onClick={fetchOrders}>刷新</Button>
            </Space>
          </Col>
        </Row>

        {/* ── Filter bar ── */}
        <Card size="small" style={{ marginBottom: 16, background: '#141414', border: '1px solid #222' }}>
          <Row gutter={12} align="middle">
            <Col>
              <Input
                placeholder="客户名称" allowClear style={{ width: 140 }}
                value={filters.customerName}
                onChange={(e) => setFilters(f => ({ ...f, customerName: e.target.value }))}
              />
            </Col>
            <Col>
              <Input
                placeholder="客户料号" allowClear style={{ width: 140 }}
                value={filters.keyword}
                onChange={(e) => setFilters(f => ({ ...f, keyword: e.target.value }))}
              />
            </Col>
            <Col>
              <RangePicker
                style={{ width: 240 }}
                onChange={(dates) => {
                  setFilters(f => ({
                    ...f,
                    dateFrom: dates?.[0]?.format('YYYY-MM-DD') || '',
                    dateTo: dates?.[1]?.format('YYYY-MM-DD') || '',
                  }))
                }}
              />
            </Col>
            <Col>
              <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); fetchOrders() }}>搜索</Button>
            </Col>
          </Row>
        </Card>

        {/* ── Stats ── */}
        {(() => {
          const totalAmt = orders.reduce((s, o) => s + (o.totalAmount || 0), 0)
          return (
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
                  <div style={{ color: '#888', fontSize: 12 }}>出库单数</div>
                  <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>{orders.length}</div>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
                  <div style={{ color: '#888', fontSize: 12 }}>总金额</div>
                  <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>¥{totalAmt.toFixed(2)}</div>
                </Card>
              </Col>
            </Row>
          )
        })()}

        {/* ── Order table ── */}
        <Table
          dataSource={orders}
          columns={columns}
          rowKey="orderId"
          loading={loading}
          expandable={{
            expandedRowRender: renderExpandedRow,
            expandedRowKeys,
            onExpandedRowsChange: setExpandedRowKeys,
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps) },
          }}
          scroll={{ x: 900 }}
          size="small"
          style={{ background: '#141414' }}
        />

        {/* ── Create Modal ── */}
        <Modal
          title="新建出库单"
          open={showCreateModal}
          onOk={handleCreate}
          onCancel={() => { setShowCreateModal(false); setItems([emptyItem()]); setSelectedCustId(null); setSalesOrders([]); setItemFilter('') }}
          okText="创建"
          width={900}
          destroyOnHidden
        >
          <Form form={createForm} layout="vertical">
            <Row gutter={16}>
              <Col span={24}><Form.Item label="客户" name="customerId" rules={[{ required: true, message: '请选择客户' }]}>
                <Select showSearch placeholder="选择客户" value={selectedCustId}
                  onChange={handleCustomerChange}
                  filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}>
                  {customers.map(c => <Select.Option key={c.customerId} value={c.customerId}>{c.name}</Select.Option>)}
                </Select>
              </Form.Item></Col>
              <Col span={24}><Form.Item label="销售单" name="salesOrderId" rules={[{ required: true, message: '请选择销售单（必须先建立销售单才能新建出库单）' }]}>
                <Select showSearch placeholder="选择销售单（可输入销售单号搜索）" loading={soLoading} allowClear
                  onChange={handleSoChange}
                  onSearch={handleSoSearch}
                  onFocus={() => { if (!salesOrders.length && createForm.getFieldValue('customerId')) loadSalesOrders('') }}
                  notFoundContent={soLoading ? '加载中...' : '该客户暂无销售单，请先创建销售单'}
                  filterOption={false}>
                  {salesOrders.map(so => <Select.Option key={so.sales_id} value={so.sales_id}>{so.so_number}（{so.status}）</Select.Option>)}
                </Select>
              </Form.Item></Col>
            </Row>
          </Form>
          {selectedSoId && salesOrders.find(s => s.sales_id === selectedSoId) ? (
            <div style={{ color: '#69b1ff', fontSize: 12, marginBottom: 8 }}>已选择销售单，下方物料明细已自动带入，可编辑本次出库数量与单价。</div>
          ) : (
            <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>选择客户后请选择一张销售单，未选择销售单无法新建出库单。</div>
          )}
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>
              物料明细 {itemFilter && <span style={{ color: '#69b1ff' }}>（{filteredItems.length} / {items.length}）</span>}
            </span>
            <Input
              size="small"
              prefix={<SearchOutlined style={{ color: '#888' }} />}
              placeholder="按客户料号 / 型号过滤"
              value={itemFilter}
              onChange={e => setItemFilter(e.target.value)}
              allowClear
              style={{ width: 240 }}
            />
          </div>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 12 }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                <th style={{ padding: 4, width: 26 }}>#</th>
                <th style={{ padding: 4, width: 80 }}>销售单</th>
                <th style={{ padding: 4, width: 90 }}>客户料号</th>
                <th style={{ padding: 4, width: 100 }}>型号</th>
                <th style={{ padding: 4, width: 50 }}>替代</th>
                <th style={{ padding: 4, width: 40 }}>原库存</th>
                    <th style={{ padding: 4, width: 45 }}>替代库存</th>
                <th style={{ padding: 4, width: 35 }}>订量</th>
                <th style={{ padding: 4, width: 35 }}>已出</th>
                <th style={{ padding: 4, width: 55 }}>本次出库</th>
                <th style={{ padding: 4, width: 55 }}>单价</th>
                <th style={{ padding: 4, width: 55 }}>含税单价</th>
                <th style={{ padding: 4, width: 50 }}>小计</th>
              </tr></thead>
              <tbody>{filteredItems.map((it) => {
                const origIdx = items.indexOf(it)
                return (
                <tr key={it.key} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: 2, color: '#666' }}>{origIdx + 1}</td>
                  <td style={{ padding: 2, color: '#69b1ff', fontSize: 11 }}>{it.soNumber || '-'}</td>
                  <td style={{ padding: 2 }}><span style={{ color: '#ccc' }}>{it.customerPartNo || '-'}</span></td>
                  <td style={{ padding: 2 }}><span style={{ color: it.substituted ? '#faad14' : '#ccc' }}>{it.model || '-'}</span></td>
                  <td style={{ padding: 2, textAlign: 'center' }}>
                    {it.substituted
                      ? <a onClick={() => clearSubstitute(setItems, origIdx)} style={{ color: '#ff7875', fontSize: 11 }}>还原</a>
                      : <a onClick={() => openSubstituteSelector({ setter: setItems, index: origIdx, originalModel: it.model, currentQty: it.qty || 0, currentStock: it.currentStock }, it.model)}
                           style={{ color: it.substituteCount > 0 ? '#69b1ff' : '#888', fontSize: 11 }}>{it.substituteCount > 0 ? '选择' : '选替'}</a>}
                  </td>
                  <td style={{ padding: 2, textAlign: 'center', color: it.currentStock != null && it.currentStock < (it.qty || 0) ? '#ff4d4f' : '#52c41a' }}>{it.currentStock != null ? it.currentStock : '-'}</td>
                  <td style={{ padding: 2, textAlign: 'center', color: it.substituted && it.currentStock != null ? (it.currentStock < (it.qty || 0) ? '#ff4d4f' : '#52c41a') : '#666' }} title={it.substituted ? `已选替代: ${it.model}` : '尚未选择替代物料'}>
                    {it.substituted && it.currentStock != null ? it.currentStock : '-'}
                  </td>
                  <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.orderedQty || '-'}</td>
                  <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.shippedQty || '-'}</td>
                  <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0" min={1} precision={0} value={it.qty}
                    onChange={v => updateItem(it.key, 'qty', v)} /></td>
                  <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.unitPrice}
                    onChange={v => updateItem(it.key, 'unitPrice', v)} /></td>
                  <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.taxInclusiveUnitPrice}
                    onChange={v => updateItem(it.key, 'taxInclusiveUnitPrice', v)} /></td>
                  <td style={{ padding: 2, textAlign: 'right', color: '#888', fontSize: 11 }}>{it.qty && it.unitPrice ? '¥' + (it.qty * it.unitPrice).toFixed(2) : ''}</td>
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
            选择客户后，必须选择一张销售单才能新建出库单；未选择销售单时系统会提示先建立销售单。
          </div>
        </Modal>

        {/* ── Edit Modal ── */}
        <Modal
          title={`编辑出库单 ${editingOrder?.orderNumber || ''}`}
          open={showEditModal}
          onOk={handleEditSave}
          onCancel={() => { setShowEditModal(false); setEditingOrder(null); setEditItems([]) }}
          okText="保存"
          width={900}
          destroyOnHidden
        >
          {editingOrder && (
            <>
              <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}>
                <Descriptions.Item label="出库单号">{editingOrder.orderNumber}</Descriptions.Item>
                <Descriptions.Item label="客户">{editingOrder.customer_name || '-'}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag color={STATUS_MAP[editingOrder.status]?.color}>{STATUS_MAP[editingOrder.status]?.label}</Tag></Descriptions.Item>
                <Descriptions.Item label="出库日期">{editingOrder.orderDate || '-'}</Descriptions.Item>
                <Descriptions.Item label="发货日期">{editingOrder.shipDate || '-'}</Descriptions.Item>
                <Descriptions.Item label="总金额">¥{Number(editingOrder.totalAmount || 0).toFixed(2)}</Descriptions.Item>
              </Descriptions>
              <div style={{ marginBottom: 8, color: '#888', fontSize: 13, fontWeight: 500 }}>物料明细</div>
              <div style={{ maxHeight: 280, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid #333' }}>
                    <th style={{ padding: 4, width: 26 }}>#</th>
                    <th style={{ padding: 4, width: 100 }}>客户料号</th>
                    <th style={{ padding: 4, width: 110 }}>型号</th>
                    <th style={{ padding: 4, width: 60 }}>替代</th>
                    <th style={{ padding: 4, width: 45 }}>原库存</th>
                <th style={{ padding: 4, width: 50 }}>替代库存</th>
                    <th style={{ padding: 4, width: 40 }}>订量</th>
                    <th style={{ padding: 4, width: 40 }}>已出</th>
                    <th style={{ padding: 4, width: 60 }}>本次出库</th>
                    <th style={{ padding: 4, width: 60 }}>单价</th>
                    <th style={{ padding: 4, width: 60 }}>含税单价</th>
                    <th style={{ padding: 4, width: 55 }}>小计</th>
                  </tr></thead>
                  <tbody>{editItems.map((it, idx) => (
                    <tr key={it.key} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: 2, color: '#666' }}>{idx + 1}</td>
                      <td style={{ padding: 2 }}><span style={{ color: '#ccc' }}>{it.customerPartNo || '-'}</span></td>
                      <td style={{ padding: 2 }}><span style={{ color: it.substituted ? '#faad14' : '#ccc' }}>{it.model || '-'}</span></td>
                      <td style={{ padding: 2, textAlign: 'center' }}>
                        {it.substituted
                          ? <a onClick={() => clearSubstitute(setEditItems, idx)} style={{ color: '#ff7875', fontSize: 11 }}>还原</a>
                          : <a onClick={() => openSubstituteSelector({ setter: setEditItems, index: idx, originalModel: it.model, currentQty: it.qty || 0, currentStock: it.currentStock }, it.model)}
                               style={{ color: it.substituteCount > 0 ? '#69b1ff' : '#888', fontSize: 11 }}>{it.substituteCount > 0 ? '选择' : '选替'}</a>}
                      </td>
                      <td style={{ padding: 2, textAlign: 'center', color: it.currentStock != null && it.currentStock < (it.qty || 0) ? '#ff4d4f' : '#52c41a' }}>{it.currentStock != null ? it.currentStock : '-'}</td>
                      <td style={{ padding: 2, textAlign: 'center', color: it.substituted && it.currentStock != null ? (it.currentStock < (it.qty || 0) ? '#ff4d4f' : '#52c41a') : '#666' }} title={it.substituted ? `已选替代: ${it.model}` : '尚未选择替代物料'}>
                        {it.substituted && it.currentStock != null ? it.currentStock : '-'}
                      </td>
                      <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.orderedQty || '-'}</td>
                      <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.shippedQty || '-'}</td>
                      <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0" min={0} value={it.qty}
                        onChange={v => setEditItems(prev => prev.map(x => x.key === it.key ? { ...x, qty: v, dirty: true } : x))} /></td>
                      <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.unitPrice}
                        onChange={v => setEditItems(prev => prev.map(x => x.key === it.key ? { ...x, unitPrice: v, dirty: true } : x))} /></td>
                      <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.taxInclusiveUnitPrice}
                        onChange={v => setEditItems(prev => prev.map(x => x.key === it.key ? { ...x, taxInclusiveUnitPrice: v, dirty: true } : x))} /></td>
                      <td style={{ padding: 2, textAlign: 'right', color: '#888', fontSize: 11 }}>{it.qty && it.unitPrice ? '¥' + (it.qty * it.unitPrice).toFixed(2) : ''}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </Modal>

        {/* ── Substitute Selector Modal ── */}
        <Modal
          title={`选择替代物料 - ${subModal.model}`}
          open={subModal.visible}
          onCancel={() => setSubModal({ visible: false, target: null, model: '', subs: [], manual: [], sameType: [], partType: '', loading: false, query: '', freeQuery: '', freeResults: [], freeLoading: false })}
          footer={null}
          width={760}
          destroyOnHidden
        >
          <div style={{ marginBottom: 10, padding: '8px 12px', background: '#1a1a1a', borderRadius: 4, color: '#888', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
            <span>原型号 <span style={{ color: '#69b1ff' }}>{subModal.model}</span> 库存: <span style={{ color: '#52c41a' }}>{subModal.target?.currentStock ?? '-'}</span>　需求: <span style={{ color: '#faad14' }}>{subModal.target?.currentQty ?? 0}</span></span>
            <span>类型: <span style={{ color: '#69b1ff' }}>{subModal.partType || '-'}</span>　替代 {subModal.manual.length} 个 + 同类备选 {subModal.sameType.length} 个</span>
          </div>
          <div style={{ marginBottom: 10 }}>
            <Input
              placeholder="输入 3 个字符以上按型号/厂家前缀过滤"
              allowClear
              value={subModal.query}
              onChange={e => setSubModal(prev => ({ ...prev, query: e.target.value }))}
              style={{ background: '#1a1a1a', borderColor: '#333' }}
            />
            {subModal.query && subModal.query.length < 3 && (
              <div style={{ color: '#faad14', fontSize: 11, marginTop: 4 }}>再输入 {3 - subModal.query.length} 个字符开始过滤</div>
            )}
          </div>
          {subModal.loading ? (
            <div style={{ textAlign: 'center', padding: 30, color: '#888' }}>查询替代物料中…</div>
          ) : (() => {
            const q = (subModal.query || '').trim().toLowerCase()
            const matches = (s) => {
              if (q.length < 3) return true
              const tm = (s.to_model || s.toModel || '').toLowerCase()
              const mf = (s.to_manufacturer || s.toManufacturer || '').toLowerCase()
              return tm.startsWith(q) || mf.startsWith(q)
            }
            const manualF = subModal.manual.filter(matches)
            const sameTypeF = subModal.sameType.filter(matches)
            if (subModal.manual.length === 0 && subModal.sameType.length === 0 && subModal.freeResults.length === 0 && !subModal.freeQuery) {
              return <div style={{ textAlign: 'center', padding: 20, color: '#888' }}>该型号暂无已定义替代物料，请使用下方"自由搜索"挑选</div>
            }
            if (q.length >= 3 && manualF.length === 0 && sameTypeF.length === 0 && subModal.freeResults.length === 0) {
              return <div style={{ textAlign: 'center', padding: 20, color: '#888' }}>没有匹配的物料</div>
            }
            const renderRow = (s, i) => {
              const subStock = s.current_stock ?? s.currentStock
              const insufficient = subStock != null && (subModal.target?.currentQty || 0) > 0 && subStock < subModal.target.currentQty
              return (
                <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: 6 }}>{s.to_model || s.toModel}</td>
                  <td style={{ padding: 6, color: '#888' }}>{s.to_manufacturer || s.toManufacturer || '-'}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: (subModal.target?.currentStock ?? 0) > 0 ? '#888' : '#666' }}>{subModal.target?.currentStock ?? '-'}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: insufficient ? '#ff4d4f' : '#52c41a' }}>{subStock ?? '-'}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{s.unit_price != null ? '¥' + Number(s.unit_price).toFixed(2) : (s.unitPrice != null ? '¥' + Number(s.unitPrice).toFixed(2) : '-')}</td>
                  <td style={{ padding: 6 }}>{(() => {
                    const ct = s.candidate_type || s.candidateType
                    if (ct === 'MANUAL' || s.sub_type === 'PRIMARY' || s.sub_type === 'DIRECT_EQUIVALENT') {
                      return <Tag color="blue" style={{ fontSize: 11 }}>已定义</Tag>
                    }
                    if (ct === 'SAME_MODEL') {
                      return <Tag color="cyan" style={{ fontSize: 11 }}>同型号</Tag>
                    }
                    return <Tag color="orange" style={{ fontSize: 11 }}>同类备选</Tag>
                  })()}</td>
                  <td style={{ padding: 6, textAlign: 'center' }}>
                    <Button type="primary" size="small" onClick={() => applySubstitute(s)}>选用</Button>
                  </td>
                </tr>
              )
            }
            const renderTable = (rows) => (
              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 12 }}>
                <thead><tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>型号</th>
                  <th style={{ padding: 6, textAlign: 'left' }}>厂家</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>原库存</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>替库存</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>单价</th>
                  <th style={{ padding: 6, textAlign: 'left' }}>来源</th>
                  <th style={{ padding: 6, textAlign: 'center', width: 70 }}>操作</th>
                </tr></thead>
                <tbody>{rows.map((s, i) => renderRow(s, i))}</tbody>
              </table>
            )
            return (
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                {manualF.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ color: '#69b1ff', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      已定义替代 ({manualF.length})
                    </div>
                    {renderTable(manualF)}
                  </div>
                )}
                {sameTypeF.length > 0 && (
                  <div>
                    <div style={{ color: '#faad14', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      同类备选 (类型: {subModal.partType || '-'}) ({sameTypeF.length})
                    </div>
                    {renderTable(sameTypeF)}
                  </div>
                )}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #333' }}>
                  <div style={{ color: '#b37feb', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                    自由搜索 (从本企业物料库任意挑选)
                  </div>
                  <Input.Search
                    placeholder="输入型号/厂家关键字 (≥2 字符)"
                    allowClear
                    value={subModal.freeQuery}
                    onChange={e => setSubModal(prev => ({ ...prev, freeQuery: e.target.value }))}
                    onSearch={v => searchFreeSubstitute(v)}
                    style={{ marginBottom: 8 }}
                  />
                  {subModal.freeLoading ? (
                    <div style={{ textAlign: 'center', padding: 16, color: '#888' }}>搜索中…</div>
                  ) : subModal.freeResults.length > 0 ? (
                    <div style={{ maxHeight: 220, overflow: 'auto' }}>
                      {renderTable(subModal.freeResults)}
                    </div>
                  ) : subModal.freeQuery && subModal.freeQuery.length >= 2 ? (
                    <div style={{ textAlign: 'center', padding: 16, color: '#888' }}>无匹配物料</div>
                  ) : null}
                </div>
              </div>
            )
          })()}
        </Modal>

        {/* ── Historical Import Modal ── */}
        <Modal
          title="导入出库单"
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
            description="表格需包含以下列：销售单号、物料号、数量、单价、日期，可选列：替代料号、客户料号、含税单价。系统按列名自动识别（列顺序不限）。一个销售单可分批多次出库：按（销售单号, 日期）分组生成多张出库单。有替代料号时扣减替代料号库存并记录替代料号。销售单号必须已存在（请先用销售单导入创建销售单）。"
          />
          <Checkbox
            checked={importUpdateStock}
            onChange={e => setImportUpdateStock(e.target.checked)}
            style={{ marginBottom: 12 }}
          >
            修改库存数据（勾选则按数量扣减库存，不勾选仅记录出库单、不修改库存计数）
          </Checkbox>
          <Input.TextArea
            rows={5}
            placeholder={"在此粘贴表格内容（列头 + 数据行），例如：\n销售单号\t物料号\t数量\t单价\t含税单价\t日期\nSO20260801-01\tHPC6045BMV-221M\t500\t0.85\t0.93\t2026/08/05\nSO20260801-01\tHPC6045BMV-221M\t300\t0.85\t0.93\t2026/08/10"}
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
                <Col span={12}><Statistic title="明细行数" value={importResult.imported || 0} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col span={12}><Statistic title="新建出库单数" value={importResult.outboundOrdersCreated || 0} valueStyle={{ color: '#1677ff' }} /></Col>
              </Row>
              {importResult.orders && importResult.orders.length > 0 && (
                <Alert
                  type="success" showIcon
                  message={`共创建 ${importResult.orders.length} 张出库单`}
                  description={
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {importResult.orders.map((o, i) => (
                        <div key={i}>
                          {i + 1}. 出库单号: {o.orderNumber} | 状态: {o.status} | 明细数: {o.itemCount}
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
          title="导出出库单"
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
            <Form.Item name="customerName" label="客户">
              <Select showSearch placeholder="按客户筛选（可选）" allowClear
                filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}
              >
                {customers.map(c => <Select.Option key={c.customerId} value={c.name}>{c.name}</Select.Option>)}
              </Select>
            </Form.Item>
            <Form.Item name="dateRange" label="订单日期范围">
              <RangePicker style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
