import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, InputNumber, Card, DatePicker, AutoComplete, Typography, Upload, Alert, Statistic, Row, Col } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined, DeleteOutlined, EditOutlined, MinusCircleOutlined, UploadOutlined, InboxOutlined, DownloadOutlined } from '@ant-design/icons'
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

const emptyItem = () => ({ key: Date.now(), partType: '其他', partId: null, partLabel: '', orderedQty: null, estimatedUnitPrice: null, taxInclusiveUnitPrice: null })

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
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportForm] = Form.useForm()
  const [exporting, setExporting] = useState(false)
  const [form] = Form.useForm()
  const [items, setItems] = useState([emptyItem()])
  const [parts, setParts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [existingPo, setExistingPo] = useState(null)
  const [existingPoItems, setExistingPoItems] = useState([])
  const [poLookupLoading, setPoLookupLoading] = useState(false)

  const [showImportModal, setShowImportModal] = useState(false)
  const [importFileList, setImportFileList] = useState([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importText, setImportText] = useState('')

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
    setExistingPo(null); setExistingPoItems([])
    fetchParts(); fetchSuppliers(); setShowModal(true)
  }

  // ── 用户输入采购单号 → 查询是否已存在, 存在则拉出原物料明细供追加 ──
  const handlePoLookup = async () => {
    const poNumber = form.getFieldValue('poNumber')
    if (!poNumber || !poNumber.trim()) { message.warning('请先输入采购单号'); return }
    setPoLookupLoading(true)
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/purchase-orders/by-number/${encodeURIComponent(poNumber.trim())}`, { params })
      const detail = res.data?.data || res.data || {}
      if (detail.exists) {
        setExistingPo(detail)
        setExistingPoItems(detail.items || [])
        // 自动带出原采购单的供应商与预计到货日期, 简化追加录入
        form.setFieldsValue({
          supplierName: detail.supplier_name || form.getFieldValue('supplierName'),
          expectedDeliveryDate: detail.expected_delivery_date ? dayjs(detail.expected_delivery_date) : form.getFieldValue('expectedDeliveryDate'),
        })
        message.success(`采购单 ${poNumber.trim()} 已存在，将追加物料（原明细 ${(detail.items || []).length} 条）`)
      } else {
        setExistingPo(null); setExistingPoItems([])
        message.info(`采购单号 ${poNumber.trim()} 不存在，将新建采购单`)
      }
    } catch (e) {
      message.error('查询采购单失败: ' + (e.response?.data?.error || e.message))
    } finally { setPoLookupLoading(false) }
  }

  // ── 一键导入 ──
  const openImport = () => {
    setImportFileList([])
    setImportText('')
    setImportResult(null)
    setShowImportModal(true)
  }

  const handleImport = async () => {
    if (importFileList.length === 0) { message.warning('请先上传文件'); return }
    setImporting(true)
    setImportResult(null)
    try {
      const formData = new FormData()
      formData.append('file', importFileList[0].originFileObj)
      const res = await api.post('/erp/purchase-orders/import-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setImportResult(res.data?.data || res.data)
      message.success('导入完成')
      fetchOrders()
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setImporting(false)
    }
  }

  const handleTextImport = async () => {
    if (!importText || !importText.trim()) { message.warning('请先粘贴表格内容'); return }
    setImporting(true)
    setImportResult(null)
    try {
      const res = await api.post('/erp/purchase-orders/import', { text: importText })
      setImportResult(res.data?.data || res.data)
      message.success('导入完成')
      fetchOrders()
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setImporting(false)
    }
  }

  const openEdit = async (record) => {
    setEditing(record); fetchParts(); fetchSuppliers()
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/purchase-orders/${record.purchase_id}`, { params })
      const detail = res.data?.data || res.data
      form.setFieldsValue({
        poNumber: detail.po_number,
        supplierName: detail.supplier_name,
        expectedDeliveryDate: detail.expected_delivery_date ? dayjs(detail.expected_delivery_date) : null,
        paymentStatus: detail.payment_status, notes: detail.notes
      })
      setExistingPo(null); setExistingPoItems([])
      const its = (detail.items || []).map(it => ({
        key: Date.now() + Math.random(), partType: it.part_type || '其他', partId: it.part_id, partLabel: it.user_part_model || '',
        orderedQty: it.ordered_qty, estimatedUnitPrice: it.estimated_unit_price,
        taxInclusiveUnitPrice: it.tax_inclusive_unit_price
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
        poNumber: values.poNumber ? values.poNumber.trim() : undefined,
        supplierName: values.supplierName,
        expectedDeliveryDate: values.expectedDeliveryDate ? values.expectedDeliveryDate.format('YYYY-MM-DD') : null,
        status: editing ? editing.status : 'ORDERED',
        paymentStatus: values.paymentStatus, notes: values.notes,
        companyId: effectiveCompanyId || user?.companyId || 0,
        createdBy: user?.id, items: rowsWithPart.filter(it => it.orderedQty > 0).map(it => ({
          partId: it.partId, orderedQty: it.orderedQty, estimatedUnitPrice: it.estimatedUnitPrice || 0,
          taxInclusiveUnitPrice: it.taxInclusiveUnitPrice || 0
        }))
      }
      if (editing) {
        await api.put(`/erp/purchase-orders/${editing.purchase_id}`, payload)
        message.success('已更新')
      } else {
        await api.post('/erp/purchase-orders', payload)
        message.success(existingPo ? '已追加物料' : '已创建')
      }
      setShowModal(false); setEditing(null); form.resetFields(); setItems([emptyItem()])
      setExistingPo(null); setExistingPoItems([])
      setPage(1); fetchOrders()
    } catch (e) {
      if (!e.errorFields) message.error('保存失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleDelete = async (id) => {
    try { await api.delete(`/erp/purchase-orders/${id}?companyId=${effectiveCompanyId || 0}`); message.success('已删除'); fetchOrders() }
    catch (e) { message.error('删除失败: ' + (e.response?.data?.error || e.message)) }
  }
  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) { message.warning('请先勾选要删除的采购单'); return }
    setBatchDeleting(true)
    try {
      const res = await api.post(`/erp/purchase-orders/batch-delete?companyId=${effectiveCompanyId || 0}`, { purchaseIds: selectedRowKeys })
      const result = res.data?.data || res.data || {}
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (deleted > 0 && skipped === 0) message.success(`已批量删除 ${deleted} 个采购单`)
      else if (deleted > 0 && skipped > 0) message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个`)
      else if (deleted === 0 && skipped > 0) message.error(`未能删除任何采购单, 跳过 ${skipped} 个`)
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
  const handleStatusChange = async (id, status) => {
    try { await api.put(`/erp/purchase-orders/${id}/status?companyId=${effectiveCompanyId || 0}`, { status }); message.success('状态已更新'); fetchOrders() }
    catch (e) { message.error('操作失败: ' + (e.response?.data?.error || e.message)) }
  }
  const handleClearAll = async () => {
    setClearingAll(true)
    try {
      const payload = {}
      if (statusFilter) payload.status = statusFilter
      if (supplierFilter) payload.supplierName = supplierFilter
      if (keyword) payload.keyword = keyword
      const res = await api.post(`/erp/purchase-orders/clear-all?companyId=${effectiveCompanyId || 0}`, payload)
      const result = res.data?.data || res.data || {}
      const matched = result.matched || 0
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (matched === 0) { message.info('没有匹配的采购单可清空') }
      else if (deleted > 0 && skipped === 0) message.success(`已清空 ${deleted} 个采购单`)
      else if (deleted > 0 && skipped > 0) message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个`)
      else if (deleted === 0 && skipped > 0) message.error(`未能删除任何采购单, 跳过 ${skipped} 个`)
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

  const handleExportFile = async (format) => {
    try {
      const values = await exportForm.validateFields()
      setExporting(true)
      const params = { format }
      params.companyId = effectiveCompanyId || 0
      if (values.supplierName) params.supplierName = values.supplierName
      if (values.dateRange && values.dateRange.length === 2) {
        params.dateFrom = values.dateRange[0].format('YYYY-MM-DD')
        params.dateTo = values.dateRange[1].format('YYYY-MM-DD')
      }
      const res = await api.get('/erp/purchase-orders/export/file', { params, responseType: 'blob' })
      const disposition = res.headers?.['content-disposition'] || ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]) : `采购单明细.${format}`
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
          { title: '含税单价', dataIndex: 'tax_inclusive_unit_price', width: 100, render: v => v ? Number(v).toFixed(4) : '-' },
        ]} />
    )
  }

  const columns = [
    { title: '采购单号', dataIndex: 'po_number', width: 180 },
    { title: '供应商', dataIndex: 'supplier_name', width: 130 },
    { title: '下单日期', dataIndex: 'order_date', width: 110, render: v => v || '-' },
    { title: '预计到货', dataIndex: 'expected_delivery_date', width: 110, render: v => v || '-' },
    { title: '金额', dataIndex: 'total_amount', width: 100, align: 'right', render: v => v != null ? v.toLocaleString() : '-' },
    { title: '已付金额', dataIndex: 'paid_amount', width: 100, align: 'right', render: v => v != null ? v.toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: s => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.label || s}</Tag> },
    { title: '付款', dataIndex: 'payment_status', width: 80, render: s => s === 'PAID' ? <Tag color="green">已付</Tag> : s === 'PARTIAL' ? <Tag color="orange">部分</Tag> : <Tag>未付</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: v => v ? dayjs(v).format('MM-DD HH:mm') : '-' },
    { title: '创建人', dataIndex: 'createdBy_name', key: 'createdBy', width: 90, render: v => v || '-' },
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
          <Space>
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确认批量删除选中的 ${selectedRowKeys.length} 个采购单？将级联删除关联的入库单`}
                onConfirm={handleBatchDelete}
                okText="删除" cancelText="取消"
                okButtonProps={{ danger: true, loading: batchDeleting }}
              >
                <Button danger icon={<DeleteOutlined />} loading={batchDeleting}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
            <Popconfirm
              title="一键清空采购单"
              description={() => {
                const parts = []
                if (statusFilter) parts.push(`状态=${STATUS_MAP[statusFilter]?.label || statusFilter}`)
                if (supplierFilter) parts.push(`供应商≈${supplierFilter}`)
                if (keyword) parts.push(`关键词≈${keyword}`)
                const cond = parts.length > 0 ? `（筛选: ${parts.join(', ')}）` : '（无筛选, 清空全部）'
                return `将删除所有匹配的采购单并级联删除关联的入库单${cond}, 删除后无法恢复.`
              }}
              onConfirm={handleClearAll}
              okText="清空" cancelText="取消"
              okButtonProps={{ danger: true, loading: clearingAll }}
            >
              <Button danger icon={<DeleteOutlined />} loading={clearingAll}>一键清空</Button>
            </Popconfirm>
            <Button icon={<DownloadOutlined />} onClick={() => { exportForm.resetFields(); fetchSuppliers(); setExportOpen(true) }}>导出</Button>
            <Button icon={<UploadOutlined />} onClick={openImport}>一键导入</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>录入采购单</Button>
          </Space>
        </Space>
        <Table dataSource={orders} columns={columns} rowKey="purchase_id" loading={loading}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
          expandable={{ expandedRowRender, onExpand: (expanded, record) => { if (expanded) fetchExpandedItems(record) } }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps) } }} scroll={{ x: 1100 }} />
        <Modal title={editing ? '编辑采购单' : '录入采购单'} open={showModal} onOk={handleSave} width={900} okText="保存" destroyOnHidden
          onCancel={() => { setShowModal(false); setEditing(null); form.resetFields(); setItems([emptyItem()]) }}>
          <Form form={form} layout="vertical">
            <Space wrap>
              <Form.Item name="poNumber" label="采购单号"
                tooltip="留空则系统自动生成；输入已存在的单号将追加物料到原采购单">
                <Space.Compact style={{ width: 260 }}>
                  <Input placeholder="留空自动生成" disabled={!!editing}
                    onPressEnter={handlePoLookup} />
                  {!editing && <Button type="primary" loading={poLookupLoading} onClick={handlePoLookup}>查询</Button>}
                </Space.Compact>
              </Form.Item>
              <Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请输入' }]}>
                <AutoComplete placeholder="供应商名称" style={{ width: 200 }} options={suppliers} /></Form.Item>
              <Form.Item name="expectedDeliveryDate" label="预计到货" rules={[{ required: true, message: '请选择预计到货日期' }]}><DatePicker style={{ width: 160 }} /></Form.Item>
              <Form.Item name="paymentStatus" label="付款状态" initialValue="UNPAID">
                <Select style={{ width: 120 }} options={[{ value: 'UNPAID', label: '未付款' }, { value: 'PARTIAL', label: '部分付款' }, { value: 'PAID', label: '已付款' }]} /></Form.Item>
            </Space>
            <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
            {existingPo && (
              <Card size="small" title={<>原采购单 <Text strong>{existingPo.po_number}</Text> 已有明细（下方录入将追加到该采购单）</>}
                style={{ marginTop: 16, borderColor: '#f0b90b' }}>
                <Table size="small" dataSource={existingPoItems} rowKey="item_id" pagination={false}
                  columns={[
                    { title: '物料型号', dataIndex: 'user_part_model', render: (v, r) => v || r.part_id || '-' },
                    { title: '订量', dataIndex: 'ordered_qty', width: 80 },
                    { title: '已收', dataIndex: 'received_qty', width: 80 },
                    { title: '估价', dataIndex: 'estimated_unit_price', width: 100, render: v => v != null ? Number(v).toFixed(4) : '-' },
                    { title: '含税单价', dataIndex: 'tax_inclusive_unit_price', width: 100, render: v => v != null ? Number(v).toFixed(4) : '-' },
                  ]} />
              </Card>
            )}
            <Card size="small" title={existingPo ? '追加物料明细' : '物料明细'} extra={<Button type="dashed" icon={<PlusOutlined />} onClick={addItem}>添加物料</Button>} style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, color: '#888', fontSize: 12, paddingLeft: 4 }}>
                <span style={{ width: 120 }}>物料类型</span>
                <span style={{ width: 240 }}>物料</span>
                <span style={{ width: 180 }}>型号</span>
                <span style={{ width: 80 }}>订量</span>
                <span style={{ width: 100 }}>预估单价</span>
                <span style={{ width: 100 }}>含税单价</span>
                <span style={{ width: 32 }}> </span>
              </div>
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
                  <InputNumber placeholder="含税单价" min={0} step={0.01} value={it.taxInclusiveUnitPrice}
                    onChange={v => updateItem(it.key, 'taxInclusiveUnitPrice', v)} style={{ width: 100 }} />
                  {items.length > 1 && <Button icon={<MinusCircleOutlined />} danger size="small" onClick={() => removeItem(it.key)} />}
                </Space>
              ))}
            </Card>
          </Form>
        </Modal>

        {/* ── 一键导入 Modal ── */}
        <Modal
          title="一键导入采购单"
          open={showImportModal}
          onCancel={() => setShowImportModal(false)}
          width={640}
          footer={[
            <Button key="cancel" onClick={() => setShowImportModal(false)}>关闭</Button>,
            <Button key="import" type="primary" loading={importing} icon={<UploadOutlined />}
              onClick={handleImport}>上传文件导入</Button>,
            <Button key="textimport" type="primary" loading={importing} icon={<InboxOutlined />}
              onClick={handleTextImport}>粘贴内容导入</Button>,
          ]}
        >
          <Alert
            type="info" showIcon style={{ marginBottom: 12 }}
            message="支持 Excel (.xlsx/.xls)、CSV 文件，或直接粘贴表格内容，按列名自动识别"
            description="约定格式（顺序不限）：供应商名称、采购单号、订单日期、数量、物料号/料号/型号/品名、单价。可选列：含税单价。系统自动按采购单号分组创建采购单，物料不存在时自动创建，供应商名称自动带出。"
          />
          <Upload.Dragger
            accept=".xlsx,.xls,.csv"
            fileList={importFileList}
            onChange={({ fileList: fl }) => { setImportFileList(fl.slice(-1)); setImportText('') }}
            beforeUpload={() => false}
            style={{ marginBottom: 16 }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽文件到此区域</p>
            <p className="ant-upload-hint">支持 .xlsx / .xls / .csv 格式</p>
          </Upload.Dragger>
          <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>或直接粘贴表格内容（Tab / 空格 / 逗号分隔，含表头）：</div>
          <Input.TextArea
            rows={6}
            value={importText}
            onChange={e => { setImportText(e.target.value); setImportFileList([]) }}
            placeholder={'供应商名称\t采购单号\t订单日期\t数量\t物料号\t单价\t含税单价\n供应商A\tPO-001\t2026-08-01\t100\tC-001\t1.25\t1.35'}
            style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }}
          />

          {importResult && (
            <div style={{ marginTop: 8 }}>
              <Row gutter={16} style={{ marginBottom: 12 }}>
                <Col span={8}><Statistic title="导入采购单数" value={importResult.imported || 0} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col span={8}><Statistic title="新建采购单数" value={importResult.purchaseOrdersCreated || 0} valueStyle={{ color: '#1677ff' }} /></Col>
                <Col span={8}><Statistic title="导入明细数" value={importResult.itemsImported || 0} valueStyle={{ color: '#faad14' }} /></Col>
              </Row>
              {importResult.orders && importResult.orders.length > 0 && (
                <Alert
                  type="success" showIcon
                  message={`共创建 ${importResult.orders.length} 张采购单`}
                  description={
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {importResult.orders.map((o, i) => (
                        <div key={i}>
                          {i + 1}. 采购单号: {o.orderNumber} | 状态: {o.status} | 明细数: {o.itemCount}
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
          title="导出采购单"
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
              <Select placeholder="按供应商筛选（可选）" allowClear showSearch optionFilterProp="label"
                style={{ width: '100%' }} options={suppliers} />
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
