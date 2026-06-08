import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Layout, Table, Button, Modal, Form, Input, InputNumber, Select, AutoComplete, Tag, Space, message, DatePicker, Upload, Descriptions, Popconfirm, Row, Col, Card } from 'antd'
import { PlusOutlined, CameraOutlined, SendOutlined, ReloadOutlined, EyeOutlined, CheckOutlined, CloseOutlined, TruckOutlined, SearchOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import api from './auth'

const { Content } = Layout
const { RangePicker } = DatePicker

const STATUS_MAP = {
  SHIPPED:     { label: '已出库', color: 'orange' },
  COMPLETED:   { label: '已完成', color: 'green' },
  CANCELLED:   { label: '已取消', color: 'red' },
}

const STATUS_OPTIONS = Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))

const emptyItem = () => ({ key: Date.now(), customerPartNo: '', model: '', orderedQty: 0, shippedQty: 0, qty: null, unitPrice: null })

export default function OutboundOrderManagement({ user, companies = [] }) {
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ customerName: '', keyword: '', dateFrom: '', dateTo: '' })
  const [expandedRowKeys, setExpandedRowKeys] = useState([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm] = Form.useForm()
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrPreview, setOcrPreview] = useState(null)
  const [customers, setCustomers] = useState([])
  const [items, setItems] = useState([emptyItem()])
  const [parts, setParts] = useState([])
  const [custMappings, setCustMappings] = useState([])
  const [selectedCustId, setSelectedCustId] = useState(null)
  const [salesOrders, setSalesOrders] = useState([])
  const [soLoading, setSoLoading] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [editingReconciled, setEditingReconciled] = useState(false)
  const [editItems, setEditItems] = useState([])

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
          api.get('/erp/customers', { params }),
          api.get('/erp/parts', { params: { ...params, size: 999 } }),
        ])
        setCustomers(cRes.data.customers || [])
        setParts(pRes.data.parts || [])
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
  const updateItem = (key, field, value) => setItems(prev => prev.map(it => it.key === key ? { ...it, [field]: value } : it))

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
      const params = { customerId, limit: 50 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/sales-orders', { params })
      setSalesOrders(res.data.data || [])
    } catch (e) { /* ignore */ }
    setSoLoading(false)
  }

  const handleSoSelect = async (soId) => {
    if (!soId) { setItems([emptyItem()]); return }
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/sales-orders/${soId}`, { params })
      const soData = res.data
      const soItems = soData?.items || []

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
          customerPartNo: it.customer_part_no || it.customerPartNo || '',
          model,
          partId: partIdNum,
          partType: it.partType || null,
          manufacturer: it.manufacturer || null,
          inventoryId: null,
          orderedQty: it.ordered_qty ?? it.orderedQty ?? 0,
          shippedQty: it.shipped_qty ?? it.shippedQty ?? 0,
          qty: 0,
          unitPrice: it.unit_price ?? it.unitPrice ?? 0,
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

      const unresolved = mapped.filter(it => !it.model)
      if (unresolved.length > 0 && typeof window !== 'undefined' && window.console) {
        console.warn('[OutboundOrder] 销售单物料未能解析到型号, part_id 列表:', unresolved.map(u => u.partId))
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

      setItems(mapped.length > 0 ? mapped : [emptyItem()])
    } catch (e) { /* ignore */ }
  }

  const handleCustomerChange = (customerId) => {
    setSelectedCustId(customerId)
    createForm.setFieldValue('salesOrderId', undefined)
    setItems([emptyItem()])
    setCustMappings([])
    fetchSalesOrders(customerId)
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
      setEditingReconciled(!!detail.reconciled)
      const its = (detail.items || []).map(it => ({
        key: Date.now() + Math.random(),
        customerPartNo: it.customerPartNo || '',
        model: it.model || '',
        partId: it.partId || null,
        inventoryId: it.inventoryId || null,
        orderedQty: it.orderedQty || 0,
        shippedQty: it.shippedQty || 0,
        qty: it.qty || 0,
        unitPrice: it.unitPrice || 0,
        currentStock: it.currentStock != null ? it.currentStock : null,
        originalModel: it.originalModel || undefined,
        substituted: !!it.substituted,
        substitutes: it.substitutes || [],
        substituteCount: it.substituteCount != null ? it.substituteCount : (it.substitutes ? it.substitutes.length : 0),
        substituteMaxStock: it.substituteMaxStock != null ? it.substituteMaxStock : null,
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
      const orderItems = editItems.filter(it => it.customerPartNo || it.model || it.qty).map(it => ({
        customerPartNo: it.customerPartNo,
        model: it.model,
        partId: it.partId || null,
        inventoryId: it.inventoryId || null,
        qty: it.qty || 0,
        unitPrice: it.unitPrice || 0,
        subtotal: (it.qty || 0) * (it.unitPrice || 0),
        substituted: !!it.substituted,
        originalModel: it.originalModel || null,
      }))
      await api.put(`/erp/outbound-orders/${editingOrder.orderId}`, { items: orderItems })
      message.success('已更新')
      setShowEditModal(false)
      setEditingOrder(null)
      setEditItems([])
      fetchOrders()
    } catch (e) {
      if (e.errorFields) return
      message.error('更新失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields()
      const orderItems = items.filter(it => it.customerPartNo || it.model || it.qty).map(it => ({
        customerPartNo: it.customerPartNo,
        model: it.model,
        partId: it.partId || null,
        inventoryId: it.inventoryId || null,
        qty: it.qty || 0,
        unitPrice: it.unitPrice || 0,
        subtotal: (it.qty || 0) * (it.unitPrice || 0),
        substituted: !!it.substituted,
        originalModel: it.originalModel || null,
      }))
      const body = {
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
      message.error('创建失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleOcrUpload = async (file) => {
    setOcrLoading(true)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1]
        const res = await api.post('/erp/outbound-orders/ocr', { image: base64 })
        setOcrPreview(res.data)
        message.success('图片识别完成, 请确认后创建')
      }
      reader.readAsDataURL(file)
    } catch (e) {
      message.error('OCR识别失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setOcrLoading(false)
    }
    return false
  }

  const confirmOcrCreate = async () => {
    if (!ocrPreview?.parsed_data) return
    const parsed = ocrPreview.parsed_data
    const items = []
    if (parsed.part_type) {
      items.push({
        partType: parsed.part_type,
        model: parsed.user_part_model || '',
        qty: parsed.quantity || 0,
        unitPrice: parsed.unit_price || 0,
      })
    }
    try {
      await api.post('/erp/outbound-orders', {
        customerName: parsed.customer_name,
        orderDate: new Date().toISOString().split('T')[0],
        items,
      })
      message.success('已从图片创建出库单')
      setOcrPreview(null)
      fetchOrders()
    } catch (e) {
      message.error('创建失败: ' + (e.response?.data?.error || e.message))
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
      title: '对账状态', dataIndex: 'reconciled', key: 'reconciled', width: 95,
      render: (v) => v
        ? <Tag color="green">已对账</Tag>
        : <Tag color="default">未对账</Tag>,
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
              <Upload accept="image/*" showUploadList={false} beforeUpload={handleOcrUpload}>
                <Button icon={<CameraOutlined />} loading={ocrLoading}>拍照识别</Button>
              </Upload>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { setShowCreateModal(true); setItems([emptyItem()]); setSelectedCustId(null); setSalesOrders([]) }}>新建出库单</Button>
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
          const reconciledCount = orders.filter(o => o.reconciled).length
          return (
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
                  <div style={{ color: '#888', fontSize: 12 }}>出库单数</div>
                  <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>{orders.length}</div>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
                  <div style={{ color: '#888', fontSize: 12 }}>总金额</div>
                  <div style={{ color: '#e3e3e3', fontSize: 22, fontWeight: 600 }}>¥{totalAmt.toFixed(2)}</div>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" style={{ background: '#141414', border: '1px solid #222', textAlign: 'center' }}>
                  <div style={{ color: '#888', fontSize: 12 }}>已对账数</div>
                  <div style={{ color: reconciledCount > 0 ? '#52c41a' : '#e3e3e3', fontSize: 22, fontWeight: 600 }}>{reconciledCount} / {orders.length}</div>
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
          onCancel={() => { setShowCreateModal(false); setItems([emptyItem()]); setSelectedCustId(null); setSalesOrders([]) }}
          okText="创建"
          width={900}
          destroyOnClose
        >
          <Form form={createForm} layout="vertical">
            <Row gutter={16}>
              <Col span={8}><Form.Item label="客户" rules={[{ required: true, message: '请选择客户' }]}>
                <Select showSearch placeholder="选择客户" value={selectedCustId}
                  onChange={handleCustomerChange}
                  filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}>
                  {customers.map(c => <Select.Option key={c.customerId} value={c.customerId}>{c.name}</Select.Option>)}
                </Select>
              </Form.Item></Col>
              <Col span={16}><Form.Item name="salesOrderId" label="销售单" rules={[{ required: true, message: '请选择销售单' }]}>
                <Select placeholder="先选择客户" loading={soLoading} onChange={handleSoSelect}
                  notFoundContent={soLoading ? '加载中...' : '该客户暂无销售单'}
                  options={salesOrders.map(so => ({ value: so.sales_id, label: `${so.so_number} - ${so.customer_po || '无PO'}` }))}
                />
              </Form.Item></Col>
            </Row>
          </Form>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: 13, fontWeight: 500 }}>物料明细</span>
          </div>
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
                <th style={{ padding: 4, width: 55 }}>小计</th>
              </tr></thead>
              <tbody>{items.map((it, idx) => (
                <tr key={it.key} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: 2, color: '#666' }}>{idx + 1}</td>
                  <td style={{ padding: 2 }}><span style={{ color: '#ccc' }}>{it.customerPartNo || '-'}</span></td>
                  <td style={{ padding: 2 }}><span style={{ color: it.substituted ? '#faad14' : '#ccc' }}>{it.model || '-'}</span></td>
                  <td style={{ padding: 2, textAlign: 'center' }}>
                    {it.substituted
                      ? <a onClick={() => clearSubstitute(setItems, idx)} style={{ color: '#ff7875', fontSize: 11 }}>还原</a>
                      : <a onClick={() => openSubstituteSelector({ setter: setItems, index: idx, originalModel: it.model, currentQty: it.qty || 0, currentStock: it.currentStock }, it.model)}
                           style={{ color: it.substituteCount > 0 ? '#69b1ff' : '#888', fontSize: 11 }}>{it.substituteCount > 0 ? '选择' : '选替'}</a>}
                  </td>
                  <td style={{ padding: 2, textAlign: 'center', color: it.currentStock != null && it.currentStock < (it.qty || 0) ? '#ff4d4f' : '#52c41a' }}>{it.currentStock != null ? it.currentStock : '-'}</td>
                  <td style={{ padding: 2, textAlign: 'center', color: it.substituted && it.currentStock != null ? (it.currentStock < (it.qty || 0) ? '#ff4d4f' : '#52c41a') : '#666' }} title={it.substituted ? `已选替代: ${it.model}` : '尚未选择替代物料'}>
                    {it.substituted && it.currentStock != null ? it.currentStock : '-'}
                  </td>
                  <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.orderedQty || '-'}</td>
                  <td style={{ padding: 2, textAlign: 'center', color: '#e3e3e3' }}>{it.shippedQty || '-'}</td>
                  <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0" min={0} value={it.qty}
                    onChange={v => updateItem(it.key, 'qty', v)} /></td>
                  <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.unitPrice}
                    onChange={v => updateItem(it.key, 'unitPrice', v)} /></td>
                  <td style={{ padding: 2, textAlign: 'right', color: '#888', fontSize: 11 }}>{it.qty && it.unitPrice ? '¥' + (it.qty * it.unitPrice).toFixed(2) : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
            选择销售单后自动带入物料明细，录入本次出库数量后立即出库。
          </div>
        </Modal>

        {/* ── Edit Modal ── */}
        <Modal
          title={`编辑出库单 ${editingOrder?.orderNumber || ''}`}
          open={showEditModal}
          onOk={handleEditSave}
          onCancel={() => { setShowEditModal(false); setEditingOrder(null); setEditItems([]); setEditingReconciled(false) }}
          okText="保存"
          width={900}
          destroyOnClose
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
              {editingReconciled && (
                <div style={{ background: '#3a2a14', border: '1px solid #faad14', color: '#faad14', padding: 8, borderRadius: 4, marginBottom: 12, fontSize: 12 }}>
                  ⚠ 该出库单已对账完成，单价不可修改。
                </div>
              )}
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
                        onChange={v => setEditItems(prev => prev.map(x => x.key === it.key ? { ...x, qty: v } : x))} /></td>
                      <td style={{ padding: 2 }}><InputNumber size="small" style={{ width: '100%' }} placeholder="0.00" min={0} step={0.01} value={it.unitPrice}
                        disabled={editingReconciled}
                        onChange={v => setEditItems(prev => prev.map(x => x.key === it.key ? { ...x, unitPrice: v } : x))} /></td>
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
          destroyOnClose
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

        {/* ── OCR Preview Modal ── */}
        <Modal
          title="OCR识别结果预览"
          open={!!ocrPreview}
          onOk={confirmOcrCreate}
          onCancel={() => setOcrPreview(null)}
          okText="确认创建"
          width={600}
        >
          {ocrPreview && (
            <div>
              <div style={{ color: '#888', marginBottom: 8 }}>识别文本:</div>
              <pre style={{ background: '#111', padding: 12, borderRadius: 8, color: '#ccc', maxHeight: 150, overflow: 'auto', fontSize: 12 }}>
                {(ocrPreview.raw_text || '').substring(0, 500)}
              </pre>
              {ocrPreview.parsed_data && (
                <Descriptions bordered size="small" column={2} style={{ marginTop: 12 }}>
                  <Descriptions.Item label="类型">{ocrPreview.parsed_data.intent || '-'}</Descriptions.Item>
                  <Descriptions.Item label="客户">{ocrPreview.parsed_data.customer_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="品类">{ocrPreview.parsed_data.part_type || '-'}</Descriptions.Item>
                  <Descriptions.Item label="型号">{ocrPreview.parsed_data.user_part_model || '-'}</Descriptions.Item>
                  <Descriptions.Item label="数量">{ocrPreview.parsed_data.quantity || '-'}</Descriptions.Item>
                  <Descriptions.Item label="单价">{ocrPreview.parsed_data.unit_price || '-'}</Descriptions.Item>
                </Descriptions>
              )}
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  )
}
