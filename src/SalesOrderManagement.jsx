import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, AutoComplete, Tag, Space, message, Popconfirm, Typography, InputNumber, Card, DatePicker, Upload, Alert, Row, Col, Statistic, Checkbox } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined, DeleteOutlined, EditOutlined, MinusCircleOutlined, UploadOutlined, InboxOutlined, DownloadOutlined } from '@ant-design/icons'
import api from './auth'
import dayjs from 'dayjs'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const { Content } = Layout
const { Text } = Typography

const STATUS_MAP = {
  PARTIAL_SHIPPED: { label: '部分出库', color: 'orange' },
  SHIPPED:         { label: '已出库', color: 'green' },
}

const PART_TYPES = ['电容', '电感', '磁珠', '电阻', 'PCB板材', 'IC', '二极管', '三极管', '晶振', '连接器', '继电器', '其他']

const emptyItem = () => ({ key: Date.now(), partType: null, customerPartNo: '', partId: null, partLabel: '', orderedQty: null, unitPrice: null, taxInclusiveUnitPrice: null, totalPrice: null, dirty: true })

export default function SalesOrderManagement({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState(null)
  const [customerFilter, setCustomerFilter] = useState(null)
  const [modelFilter, setModelFilter] = useState(null)
  const [modelOptions, setModelOptions] = useState([])

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportForm] = Form.useForm()
  const [exporting, setExporting] = useState(false)
  const [form] = Form.useForm()
  const [items, setItems] = useState([emptyItem()])
  const [customers, setCustomers] = useState([])
  const [customerPartMappings, setCustomerPartMappings] = useState([])
  const [parts, setParts] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)

  // ── Simplified Import state ──
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFileList, setImportFileList] = useState([])
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: pageSize, offset: (page - 1) * pageSize }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      if (keyword) params.keyword = keyword
      if (statusFilter) params.status = statusFilter
      if (customerFilter) params.customerId = customerFilter
      if (modelFilter) params.model = modelFilter
      const res = await api.get('/erp/sales-orders', { params })
      // Handle ApiResult wrapper: { code, message, data }
      const apiData = res.data?.data || res.data || {}
      setOrders(Array.isArray(apiData) ? apiData : (apiData.data || []))
      setTotal(apiData.count || 0)
    } catch (e) {
      message.error('加载销售单失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, statusFilter, customerFilter, modelFilter, effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const fetchModelOptions = useCallback(async (text) => {
    try {
      const params = { keyword: text || '', size: 100 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/parts', { params })
      const partsPayload = res.data?.data || res.data || {}
      const list = (partsPayload.parts || []).map(p => {
        const model = p.userPartModel || ''
        return model ? { value: model, label: model } : null
      }).filter(Boolean)
      setModelOptions(list)
    } catch (e) { setModelOptions([]) }
  }, [effectiveCompanyId, isSuperAdmin])

  const fetchCustomers = useCallback(async () => {
    try {
      const params = { size: 500 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/customers', { params })
      // Handle ApiResult wrapper: { code, message, data }
      const customersData = res.data?.data || res.data || []
      setCustomers(Array.isArray(customersData) ? customersData.map(c => ({ value: c.customerId, label: c.name })) : (customersData.customers || []).map(c => ({ value: c.customerId, label: c.name })))
    } catch (e) { /* ignore */ }
  }, [effectiveCompanyId, isSuperAdmin])
  useEffect(() => { fetchCustomers() }, [fetchCustomers])

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
        // Handle ApiResult wrapper: { code, message, data }
        const partsData = res.data?.data || res.data || []
        const partsList = Array.isArray(partsData) ? partsData : (partsData.parts || [])
        setParts(partsList.map(p => ({
          partId: p.partId,
          userPartModel: p.userPartModel || '',
          partType: p.partType || '',
          manufacturer: p.manufacturer || '',
          label: p.userPartModel || `物料 ID:${p.partId}`
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
      const detail = res.data?.data || res.data
      form.setFieldsValue({
        customerId: detail.customer_id,
        soNumber: detail.so_number,
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
        originalItemId: it.item_id || it.itemId || null,
        partType: null, customerPartNo: it.customer_part_no || '',
        partId: it.part_id, partLabel: it.model || '',
        orderedQty: it.ordered_qty, unitPrice: it.unit_price, taxInclusiveUnitPrice: it.tax_inclusive_unit_price, totalPrice: it.total_price,
        dirty: false,
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
      ...it, partType, customerPartNo: '', partId: null, partLabel: '', dirty: true
    } : it))
  }

  const handleCustomerPartNoChange = (itemKey, value) => {
    const matchedPart = parts.find(p => p.userPartModel && p.userPartModel === value)
    setItems(items.map(it => it.key === itemKey ? {
      ...it,
      customerPartNo: value || '',
      partId: matchedPart ? matchedPart.partId : null,
      partLabel: matchedPart ? matchedPart.userPartModel : '',
      dirty: true
    } : it))
  }

  const handleCustomerPartNoSelect = (itemKey, option) => {
    setItems(items.map(it => it.key === itemKey ? {
      ...it,
      customerPartNo: option.value,
      partId: option.partId || null,
      partLabel: option.partLabel || '',
      dirty: true
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
      // 至少 1 条物料
      if (items.length === 0) { message.error('请至少添加一行物料明细'); return }
      // 整张订单任意非空行（用户保留的）都必须字段齐
      const filledRows = items.filter(it => it.partType || it.customerPartNo || it.orderedQty || it.unitPrice)
      if (filledRows.length === 0) { message.error('请至少填写一行完整的物料明细（物料类型 / 客户料号 / 订量 / 单价 均必填）'); return }
      const incompleteRows = filledRows.filter(it => !it.partType || !it.customerPartNo || !it.partId || !it.orderedQty || it.orderedQty <= 0 || it.unitPrice == null)
      if (incompleteRows.length > 0) {
        message.error(`有 ${incompleteRows.length} 条物料字段未填全：物料类型 / 客户料号 / 订量 / 单价 均为必填`)
        return
      }
      const unresolved = items.filter(it => it.customerPartNo && !it.partId)
      if (unresolved.length > 0) {
        message.error(`有 ${unresolved.length} 条物料的客户料号未匹配到内部物料，请从下拉中选择`)
        return
      }
      // 部分提交：只取用户实际改过的行；未改的 (dirty=false) 不进后端
      const dirty = items.filter(it => it.dirty)
      const invalidQty = dirty.filter(it => it.partId && (!it.orderedQty || it.orderedQty <= 0))
      if (invalidQty.length > 0) {
        message.error(`有 ${invalidQty.length} 条已修改物料数量为 0 或未填写，销售数量必须大于 0`)
        return
      }
      const validItems = dirty.filter(it => it.partId && it.orderedQty > 0)
      if (validItems.length === 0) { message.error('请至少修改一条物料明细'); return }
      const payload = {
        customerId: values.customerId,
        soNumber: values.soNumber,
        orderDate: values.orderDate ? values.orderDate.format('YYYY-MM-DD') : null,
        expectedShipDate: values.expectedShipDate ? values.expectedShipDate.format('YYYY-MM-DD') : null,
        paymentStatus: values.paymentStatus, notes: values.notes,
        companyId: effectiveCompanyId || user?.companyId || 0,
        createdBy: user?.id,
        items: validItems.map(it => ({
          originalItemId: it.originalItemId || null,
          partId: it.partId, customerPartNo: it.customerPartNo || '',
          orderedQty: it.orderedQty,
          unitPrice: it.unitPrice || 0, taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || 0, totalPrice: (it.orderedQty || 0) * (it.unitPrice || 0)
        })),
      }
      if (editing) {
        payload.partial = true
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

  const returnStockRef = useRef(false)

  const handleDelete = async (id, restock) => {
    try {
      await api.delete(`/erp/sales-orders/${id}?companyId=${effectiveCompanyId || 0}`, { params: { restock: !!restock } })
      message.success(restock ? '已删除并返还库存' : '已删除')
      fetchOrders()
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.error || e.message))
      throw e
    }
  }
  const openDeleteConfirm = (r) => {
    returnStockRef.current = false
    Modal.confirm({
      title: `确认删除销售单 ${r.so_number || ('#' + r.sales_id)}?`,
      width: 500,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div>
          <Alert type="warning" showIcon message="删除后无法恢复，关联出库单也会一并删除" description="勾选'返还库存'后，将把关联出库单已出库的物料数量加回库存并更新库存数量。" style={{ marginBottom: 16 }} />
          <Checkbox defaultChecked={false} onChange={e => { returnStockRef.current = e.target.checked }}>
            返还库存（将关联出库单已出库数量加回库存并更新库存数量）
          </Checkbox>
        </div>
      ),
      onOk: () => handleDelete(r.sales_id, returnStockRef.current),
    })
  }
  const handleBatchDelete = async (restock) => {
    if (selectedRowKeys.length === 0) { message.warning('请先勾选要删除的销售单'); return }
    setBatchDeleting(true)
    try {
      const res = await api.post(`/erp/sales-orders/batch-delete?companyId=${effectiveCompanyId || 0}`, { salesIds: selectedRowKeys, ...(restock ? { restock: true } : {}) })
      const result = res.data?.data || res.data || {}
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (deleted > 0 && skipped === 0) message.success(restock ? `已批量删除 ${deleted} 个销售单并返还库存` : `已批量删除 ${deleted} 个销售单`)
      else if (deleted > 0 && skipped > 0) message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个`)
      else if (deleted === 0 && skipped > 0) message.error(`未能删除任何销售单, 跳过 ${skipped} 个`)
      if (errors.length > 0) {
        Modal.info({
          title: '批量删除详情', width: 560,
          content: (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {errors.map((e, i) => <div key={i} style={{ marginBottom: 4 }}>{e}</div>)}
            </div>
          )
        })
      }
      setSelectedRowKeys([])
      fetchOrders()
    } catch (e) {
      message.error('批量删除失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setBatchDeleting(false)
    }
  }
  const openBatchDeleteConfirm = () => {
    if (selectedRowKeys.length === 0) { message.warning('请先勾选要删除的销售单'); return }
    returnStockRef.current = false
    Modal.confirm({
      title: `确认批量删除选中的 ${selectedRowKeys.length} 个销售单？将级联删除关联的出库单`,
      width: 500,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div>
          <Alert type="warning" showIcon message="批量删除销售单" description="勾选'返还库存'后，将把关联出库单已出库的物料数量加回库存并更新库存数量。" style={{ marginBottom: 16 }} />
          <Checkbox defaultChecked={false} onChange={e => { returnStockRef.current = e.target.checked }}>
            返还库存（将关联出库单已出库数量加回库存并更新库存数量）
          </Checkbox>
        </div>
      ),
      onOk: () => handleBatchDelete(returnStockRef.current),
    })
  }
  const handleStatusChange = async (id, status) => { try { await api.put(`/erp/sales-orders/${id}/status?companyId=${effectiveCompanyId || 0}`, { status }); message.success('状态已更新'); fetchOrders() } catch (e) { message.error('操作失败: ' + (e.response?.data?.error || e.message)) } }
  const handleRecalcAmount = async (id) => {
    try {
      const res = await api.post(`/erp/sales-orders/${id}/recalc-amount?companyId=${effectiveCompanyId || 0}`)
      const r = res.data?.data || res.data || {}
      const total = r.total_amount != null ? Number(r.total_amount).toLocaleString() : '-'
      message.success(`已重新计算金额: ${total}`)
      fetchOrders()
    } catch (e) {
      message.error('重算金额失败: ' + (e.response?.data?.error || e.message))
    }
  }
  const handleRecalcAll = async () => {
    setClearingAll(true)
    try {
      const res = await api.post(`/erp/sales-orders/recalc-all-amount?companyId=${effectiveCompanyId || 0}`)
      const r = res.data?.data || res.data || {}
      const matched = r.matched || 0
      const updated = r.updated || 0
      const errors = r.errors || []
      if (updated > 0) message.success(`已重算 ${updated}/${matched} 张销售单金额`)
      else message.info('没有需要重算的销售单')
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
  const handleClearAll = async (restock) => {
    setClearingAll(true)
    try {
      const payload = {}
      if (statusFilter) payload.status = statusFilter
      if (customerFilter) payload.customerId = customerFilter
      if (keyword) payload.keyword = keyword
      if (restock) payload.restock = true
      const res = await api.post(`/erp/sales-orders/clear-all?companyId=${effectiveCompanyId || 0}`, payload)
      const result = res.data?.data || res.data || {}
      const matched = result.matched || 0
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (matched === 0) { message.info('没有匹配的销售单可清空') }
      else if (deleted > 0 && skipped === 0) message.success(`已清空 ${deleted} 个销售单`)
      else if (deleted > 0 && skipped > 0) message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个`)
      else if (deleted === 0 && skipped > 0) message.error(`未能删除任何销售单, 跳过 ${skipped} 个`)
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
      setSelectedRowKeys([])
      fetchOrders()
    } catch (e) {
      message.error('一键清空失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setClearingAll(false)
    }
  }
  const openClearAllConfirm = () => {
    returnStockRef.current = false
    const parts = []
    if (statusFilter) parts.push(`状态=${STATUS_MAP[statusFilter]?.label || statusFilter}`)
    if (customerFilter) parts.push(`客户=${customers.find(c => c.value === customerFilter)?.label || customerFilter}`)
    if (keyword) parts.push(`关键词≈${keyword}`)
    const cond = parts.length > 0 ? `（筛选: ${parts.join(', ')}）` : '（无筛选, 清空全部）'
    Modal.confirm({
      title: '一键清空销售单',
      width: 500,
      okText: '确认清空',
      okButtonProps: { danger: true, loading: clearingAll },
      cancelText: '取消',
      content: (
        <div>
          <Alert type="warning" showIcon message={`将删除所有匹配的销售单并级联删除关联的出库单${cond}`} description="勾选'返还库存'后，将把关联出库单已出库的物料数量加回库存并更新库存数量。" style={{ marginBottom: 16 }} />
          <Checkbox defaultChecked={false} onChange={e => { returnStockRef.current = e.target.checked }}>
            返还库存（将关联出库单已出库数量加回库存并更新库存数量）
          </Checkbox>
        </div>
      ),
      onOk: () => handleClearAll(returnStockRef.current),
    })
  }
  const handleExportFile = async (format) => {
    try {
      const values = await exportForm.validateFields()
      setExporting(true)
      const params = { format }
      params.companyId = effectiveCompanyId || 0
      if (values.customerName) params.customerName = values.customerName
      if (values.dateRange && values.dateRange.length === 2) {
        params.dateFrom = values.dateRange[0].format('YYYY-MM-DD')
        params.dateTo = values.dateRange[1].format('YYYY-MM-DD')
      }
      const res = await api.get('/erp/sales-orders/export/file', { params, responseType: 'blob' })
      const disposition = res.headers?.['content-disposition'] || ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]) : `销售单明细.${format}`
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
  const addItem = () => setItems([...items, emptyItem()])
  const removeItem = (key) => { if (items.length <= 1) return; setItems(items.filter(it => it.key !== key)) }
  const updateItem = (key, field, val) => setItems(items.map(it => it.key === key ? { ...it, [field]: val, dirty: true } : it))

  // ── Simplified Import ──
  const openImport = () => {
    setImportFileList([])
    setImportText('')
    setImportResult(null)
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
        res = await api.post('/erp/sales-orders/import-simple', { text: importText })
      } else {
        const formData = new FormData()
        formData.append('file', importFileList[0].originFileObj)
        res = await api.post('/erp/sales-orders/import-simple-file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      }
      setImportResult(res.data?.data || res.data)
      message.success('导入完成')
      setPage(1); fetchOrders()
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setImporting(false)
    }
  }

  const [expandedItems, setExpandedItems] = useState({})
  const fetchExpandedItems = async (record) => {
    if (expandedItems[record.sales_id]) return
    try {
      const res = await api.get(`/erp/sales-orders/${record.sales_id}`)
      const items = res.data?.data?.items || []
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
          { title: '含税单价', dataIndex: 'tax_inclusive_unit_price', width: 90, render: v => v ? Number(v).toFixed(4) : '-' },
          { title: '小计', dataIndex: 'total_price', width: 90, render: v => v ? Number(v).toFixed(2) : '-' },
        ]} />
    )
  }

  const columns = [
    { title: '销售单号', dataIndex: 'so_number', width: 180 },
    { title: '客户', dataIndex: 'customer_name', width: 120 },
    { title: '订单日期', dataIndex: 'order_date', width: 110, render: v => v || '-' },
    { title: '预计出货', dataIndex: 'expected_ship_date', width: 110, render: v => v || '-' },
    { title: '金额', dataIndex: 'total_amount', width: 100, align: 'right', render: v => v != null ? v.toLocaleString() : '-' },
    { title: '已付金额', dataIndex: 'paid_amount', width: 100, align: 'right', render: v => v != null ? v.toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: s => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: v => v ? dayjs(v).format('MM-DD HH:mm') : '-' },
    { title: '创建人', dataIndex: 'createdBy_name', key: 'createdBy', width: 90, render: v => v || '-' },
    { title: '操作', key: 'actions', width: 240, fixed: 'right', render: (_, r) => (
      <Space>
        <Popconfirm
          title="确认重新计算金额？"
          description="将按明细行的单价/含税单价 × 数量重新计算并覆盖该销售单金额。"
          okText="重算" cancelText="取消"
          onConfirm={() => handleRecalcAmount(r.sales_id)}>
          <Button size="small" icon={<ReloadOutlined />}>重算金额</Button>
        </Popconfirm>
        {r.status !== 'CANCELLED' && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>}
        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => openDeleteConfirm(r)}>删除</Button>
      </Space>
    )}
  ]

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Input.Search placeholder="搜索销售单号/料号" allowClear value={keyword}
              onChange={e => setKeyword(e.target.value)} onSearch={() => { setPage(1); fetchOrders() }} style={{ width: 260 }} />
            <Select placeholder="状态筛选" allowClear style={{ width: 130 }} value={statusFilter}
              onChange={v => { setStatusFilter(v); setPage(1) }}
              options={Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            <Select placeholder="客户筛选" allowClear showSearch optionFilterProp="label"
              style={{ width: 180 }} value={customerFilter}
              onChange={v => { setCustomerFilter(v); setPage(1) }}
              options={customers} />
            <Select placeholder="物料筛选" allowClear showSearch filterOption={false} style={{ width: 200 }} value={modelFilter}
              onSearch={fetchModelOptions}
              onFocus={() => fetchModelOptions('')}
              onChange={v => { setModelFilter(v); setPage(1) }}
              options={modelOptions} />
            <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); fetchOrders() }}>刷新</Button>
          </Space>
          <Space>
            {selectedRowKeys.length > 0 && (
              <Button danger icon={<DeleteOutlined />} loading={batchDeleting} onClick={openBatchDeleteConfirm}>
                  批量删除 ({selectedRowKeys.length})
              </Button>
            )}
            <Button danger icon={<DeleteOutlined />} loading={clearingAll} onClick={openClearAllConfirm}>一键清空</Button>
            <Popconfirm
              title="确认批量重算全部销售单金额？"
              description="将按明细行的单价/含税单价 × 数量重新计算并覆盖所有销售单金额，用于修复历史单据金额为0的问题。"
              okText="重算" cancelText="取消"
              onConfirm={handleRecalcAll}
              okButtonProps={{ loading: clearingAll }}
            >
              <Button icon={<ReloadOutlined />} loading={clearingAll}>批量重算金额</Button>
            </Popconfirm>
            <Button icon={<DownloadOutlined />} onClick={() => { exportForm.resetFields(); setExportOpen(true) }}>导出</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>录入销售单</Button>
            <Button icon={<UploadOutlined />} onClick={openImport}>导入</Button>
          </Space>
        </Space>
        <Table dataSource={orders} columns={columns} rowKey="sales_id" loading={loading}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          expandable={{ expandedRowRender, onExpand: (expanded, record) => { if (expanded) fetchExpandedItems(record) } }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps) } }} scroll={{ x: 1100 }} />
        <Modal title={editing ? '编辑销售单' : '录入销售单'} open={showModal} onOk={handleSave} width={950} okText="保存" destroyOnHidden
          onCancel={() => { setShowModal(false); setEditing(null); form.resetFields(); setItems([emptyItem()]); setSelectedCustomerId(null); setCustomerPartMappings([]) }}>
          <Form form={form} layout="vertical">
            <Space wrap>
              <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择' }]}>
                <Select placeholder="先选择客户" style={{ width: 200 }} showSearch optionFilterProp="label" options={customers} onChange={handleCustomerChange} /></Form.Item>
              <Form.Item name="soNumber" label="销售单号" rules={[{ required: false }]}>
                <Input placeholder="客户单号，不填则系统自动生成" style={{ width: 200 }} /></Form.Item>
              <Form.Item name="orderDate" label="订单日期" rules={[{ required: true, message: '请选择订单日期' }]}><DatePicker style={{ width: 160 }} /></Form.Item>
              <Form.Item name="expectedShipDate" label="预计出货" rules={[{ required: true, message: '请选择预计出货日期' }]}><DatePicker style={{ width: 160 }} /></Form.Item>
              <Form.Item name="paymentStatus" label="付款状态" initialValue="UNPAID">
                <Select style={{ width: 120 }} options={[{ value: 'UNPAID', label: '未付款' }, { value: 'PARTIAL', label: '部分付款' }, { value: 'PAID', label: '已付款' }]} /></Form.Item>
            </Space>
            <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
            <Card size="small" title={<span>物料明细 {!selectedCustomerId && <Text type="secondary" style={{fontSize:12}}>（请先选择客户）</Text>}</span>}
              extra={<Button type="dashed" icon={<PlusOutlined />} onClick={addItem} disabled={!selectedCustomerId}>添加物料</Button>} style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, color: '#888', fontSize: 12, paddingLeft: 4 }}>
                <span style={{ width: 120 }}>物料类型</span>
                <span style={{ width: 240 }}>客户料号 / 物料号</span>
                <span style={{ width: 220 }}>物料编码</span>
                <span style={{ width: 80 }}>订量</span>
                <span style={{ width: 100 }}>单价</span>
                <span style={{ width: 100 }}>含税单价</span>
                <span style={{ width: 100 }}>小计</span>
                <span style={{ width: 32 }}> </span>
              </div>
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
                  <InputNumber placeholder="含税单价" min={0} step={0.01} value={it.taxInclusiveUnitPrice}
                    onChange={v => updateItem(it.key, 'taxInclusiveUnitPrice', v)} style={{ width: 100 }} />
                  <span style={{ color: '#888', fontSize: 11, width: 100, textAlign: 'right', display: 'inline-block' }}>
                    {it.orderedQty && it.unitPrice ? '¥' + (it.orderedQty * it.unitPrice).toFixed(2) : ''}
                  </span>
                  {items.length > 1 && <Button icon={<MinusCircleOutlined />} danger size="small" onClick={() => removeItem(it.key)} />}
                </Space>
              ))}
            </Card>
          </Form>
        </Modal>

        {/* ── Simplified Import Modal ── */}
        <Modal
          title="导入销售单"
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
            description="表格需包含以下列：客户名称、销售单号、下单日期、物料号、数量、单价。可选列：客户料号、含税单价。系统按列名自动识别（列顺序不限）。一个销售单号对应多行物料记录时合并为一张销售单；客户不存在时自动创建。"
          />
          <Input.TextArea
            rows={5}
            placeholder={"在此粘贴表格内容（列头 + 数据行），例如：\n客户名称\t销售单号\t下单日期\t客户料号\t物料号\t数量\t单价\t含税单价\n深圳市华芯电子有限公司\tSO20260801-01\t2026/08/01\tHPC6021\tHPC6045BMV-221M\t1000\t0.85\t0.93"}
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
                <Col span={8}><Statistic title="明细行数" value={importResult.imported || 0} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col span={8}><Statistic title="新建销售单数" value={importResult.salesOrdersCreated || 0} valueStyle={{ color: '#1677ff' }} /></Col>
                <Col span={8}><Statistic title="失败单数" value={importResult.failed || 0} valueStyle={{ color: importResult.failed ? '#ff4d4f' : '#52c41a' }} /></Col>
              </Row>
              {importResult.orders && importResult.orders.length > 0 && (
                <Alert
                  type={importResult.failed ? 'warning' : 'success'} showIcon
                  message={`共处理 ${importResult.orders.length} 张销售单`}
                  description={
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {importResult.orders.map((o, i) => (
                        <div key={i}>
                          {i + 1}. 销售单号: {o.orderNumber} | 状态: {o.status} {o.error ? `| 错误: ${o.error}` : ''}
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
          title="导出销售单"
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
                {customers.map(c => <Select.Option key={c.value} value={c.label}>{c.label}</Select.Option>)}
              </Select>
            </Form.Item>
            <Form.Item name="dateRange" label="订单日期范围">
              <DatePicker.RangePicker style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
