import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Pagination, Button, Tabs, Tag, Space, message, Popconfirm, Typography, InputNumber, Tooltip, Modal, Form, DatePicker, Input, Select } from 'antd'
import { CheckOutlined, ReloadOutlined, InboxOutlined, SendOutlined, SaveOutlined, DeleteOutlined, HistoryOutlined, DownloadOutlined, ExportOutlined } from '@ant-design/icons'
import api from './auth'
import dayjs from 'dayjs'

const { Content } = Layout
const { Text } = Typography

export default function ReconciliationManagement({ user, companies = [] }) {
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [activeTab, setActiveTab] = useState('OUTBOUND')
  const [records, setRecords] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [pendingCount, setPendingCount] = useState(0)
  const [expandedDetails, setExpandedDetails] = useState({})
  const [batchDraft, setBatchDraft] = useState({})
  const [savingBatch, setSavingBatch] = useState(false)
  const [historyOpen, setHistoryOpen] = useState({})
  const [exportOpen, setExportOpen] = useState(false)
  const [exportForm] = Form.useForm()
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState(null)
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [partyFilter, setPartyFilter] = useState(null)

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const params = { recType: activeTab, limit: pageSize, offset: (page - 1) * pageSize }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      if (statusFilter) params.status = statusFilter
      if (partyFilter) {
        if (activeTab === 'OUTBOUND') params.customerId = partyFilter
        else params.supplierName = partyFilter
      }
      const res = await api.get('/erp/reconciliations', { params })
      // Handle ApiResult wrapper: { code, message, data }
      const apiData = res.data?.data || res.data || {}
      setRecords(Array.isArray(apiData) ? apiData : (apiData.data || []))
      setTotal(apiData.count || 0)
    } catch (e) {
      message.error('加载对账单失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, activeTab, statusFilter, partyFilter, effectiveCompanyId, isSuperAdmin])

  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await api.get('/erp/reconciliations/pending-count', {
        params: { recType: activeTab, companyId: effectiveCompanyId || 0 }
      })
      setPendingCount(res.data.pending_count || 0)
    } catch (e) { /* ignore */ }
  }, [activeTab, effectiveCompanyId])

  useEffect(() => { fetchRecords() }, [fetchRecords])
  useEffect(() => { fetchPendingCount() }, [fetchPendingCount])

  // 列表刷新后，自动预加载所有对账单的明细（用于在卡片中直接展示物料行）
  useEffect(() => {
    if (!records || records.length === 0) return
    const params = {}
    if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
    const refreshExpandedDetail = async (recId) => {
      if (missing.length === 0) return
      try {
        const results = await Promise.all(missing.map(r =>
          api.get(`/erp/reconciliations/${r.reconciliation_id}`, { params })
            .then(res => ({ key: r.reconciliation_id, data: res.data }))
            .catch(() => null)
        ))
        const updates = {}
        for (const r of results) if (r && r.data) updates[r.key] = r.data
        if (Object.keys(updates).length > 0) {
          setExpandedDetails(prev => ({ ...prev, ...updates }))
        }
      } catch (e) {
        message.error('刷新对账明细失败: ' + (e.response?.data?.message || e.response?.data?.error || e.message))
      }
    }
  }, [records])

  // 加载客户/供应商清单 (供选择器使用)
  useEffect(() => {
    const params = {}
    if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
    Promise.all([
      api.get('/erp/customers', { params }).then(r => {
        const customersData = r.data?.data || r.data || []
        setCustomers(Array.isArray(customersData) ? customersData : (customersData.customers || []))
      }).catch(() => {}),
      api.get('/erp/suppliers/all', { params }).then(r => {
        const suppliersData = r.data?.data || r.data || []
        setSuppliers(Array.isArray(suppliersData) ? suppliersData : (suppliersData.data || []))
      }).catch(() => {}),
    ])
  }, [effectiveCompanyId, isSuperAdmin])

  // 切 tab / 换分页时清空 party 过滤，避免不同类型之间的脏数据
  useEffect(() => { setPartyFilter(null) }, [activeTab])

  const handleComplete = async (recId) => {
    try {
      await api.put(`/erp/reconciliations/${recId}/complete?companyId=${effectiveCompanyId || 0}`, {
        completedBy: user?.id || 0
      })
      message.success('对账完成')
      fetchRecords()
      fetchPendingCount()
      await refreshExpandedDetail(recId)
    } catch (e) {
      message.error('操作失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const fetchExpandedDetail = async (record) => {
    const key = record.reconciliation_id
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get(`/erp/reconciliations/${record.reconciliation_id}`, { params })
      setExpandedDetails(prev => ({ ...prev, [key]: res.data }))
    } catch (e) {
      message.error('加载对账明细失败: ' + (e.response?.data?.message || e.response?.data?.error || e.message))
    }
  }

  const refreshExpandedDetail = async (recId) => {
    const record = records.find(r => r.reconciliation_id === recId)
    if (record) await fetchExpandedDetail(record)
  }

  const draftKey = (recId, orderId, idx) => `${recId}:${orderId}:${idx}`
  const setDraftValue = (recId, orderId, idx, field, value) => {
    const key = draftKey(recId, orderId, idx)
    setBatchDraft(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: value } }))
  }
  const getDraftValue = (recId, orderId, idx, field) => {
    const key = draftKey(recId, orderId, idx)
    return batchDraft[key] ? batchDraft[key][field] : undefined
  }

  const handleSaveBatch = async (recId, order) => {
    const items = order.items || []
    const collected = []
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx]
      const orderedQty = Number(it.qty || 0)
      const remaining = Math.max(0, orderedQty - Number(it.reconciledQty || 0))
      // 默认值 = 剩余未对账数量；用户清空(dq === null)表示跳过该行
      const rawQty = getDraftValue(recId, order.orderId, idx, 'qty')
      const rawPrice = getDraftValue(recId, order.orderId, idx, 'price')
      const qty = rawQty === undefined ? remaining : rawQty
      const price = rawPrice === undefined ? (it.unitPrice != null ? Number(it.unitPrice) : 0) : rawPrice
      if (qty == null || qty === '' || qty === 0) continue
      if (price == null || price === '' || price === 0) continue
      if (Number(qty) - remaining > 0.0001) {
        message.error(`型号 ${it.model || it.partType} 本次数量 (${qty}) 超过剩余 ${remaining}`)
        return
      }
      collected.push({
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        partType: it.partType || '',
        model: it.model || '',
        manufacturer: it.manufacturer || '',
        customerPartNo: it.customerPartNo || '',
        reconciledQty: Number(qty),
        reconciledUnitPrice: Number(price),
      })
    }
    if (collected.length === 0) { message.warning('请至少录入一个物料的本次对账数量和单价'); return }
    setSavingBatch(true)
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      await api.post(`/erp/reconciliations/${recId}/items`, { items: collected }, { params })
      message.success(`已录入 ${collected.length} 条对账明细`)
      for (let idx = 0; idx < items.length; idx++) {
        const k = draftKey(recId, order.orderId, idx)
        if (batchDraft[k]) {
          setBatchDraft(prev => { const c = { ...prev }; delete c[k]; return c })
        }
      }
      await refreshExpandedDetail(recId)
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.error || e.message))
    } finally { setSavingBatch(false) }
  }

  const handleDeleteItem = async (recId, itemId) => {
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      await api.delete(`/erp/reconciliations/${recId}/items/${itemId}`, { params })
      message.success('已删除对账明细')
      await refreshExpandedDetail(recId)
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const openExportModal = () => {
    exportForm.resetFields()
    setExportResult(null)
    setExportOpen(true)
  }

  const handleExport = async () => {
    try {
      const values = await exportForm.validateFields()
      if (!values.dateRange || values.dateRange.length !== 2) {
        message.error('请选择日期范围')
        return
      }
      setExporting(true)
      setExportResult(null)
      const params = {
        recType: activeTab,
        dateFrom: values.dateRange[0].format('YYYY-MM-DD'),
        dateTo: values.dateRange[1].format('YYYY-MM-DD'),
      }
      if (effectiveCompanyId) params.companyId = effectiveCompanyId
      if (activeTab === 'OUTBOUND' && values.customerName) params.customerName = values.customerName
      if (activeTab === 'INBOUND' && values.supplierName) params.supplierName = values.supplierName
      const res = await api.get('/erp/reconciliations/export', { params })
      setExportResult(res.data)
    } catch (e) {
      if (e?.errorFields) return
      message.error('导出失败: ' + (e.response?.data?.error || e.message))
    } finally { setExporting(false) }
  }

  const handleExportFile = async (format) => {
    try {
      const values = await exportForm.validateFields()
      if (!values.dateRange || values.dateRange.length !== 2) {
        message.error('请选择日期范围')
        return
      }
      setExporting(true)
      const params = {
        recType: activeTab,
        dateFrom: values.dateRange[0].format('YYYY-MM-DD'),
        dateTo: values.dateRange[1].format('YYYY-MM-DD'),
        format,
      }
      if (effectiveCompanyId) params.companyId = effectiveCompanyId
      if (activeTab === 'OUTBOUND' && values.customerName) params.customerName = values.customerName
      if (activeTab === 'INBOUND' && values.supplierName) params.supplierName = values.supplierName
      const res = await api.get('/erp/reconciliations/export/file', {
        params,
        responseType: 'blob',
      })
      const disposition = res.headers?.['content-disposition'] || ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]) : `reconciliations.${format}`
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      message.success(`已下载 ${format.toUpperCase()} 文件`)
    } catch (e) {
      if (e?.errorFields) return
      const msg = e?.response?.data?.error || e.message
      message.error('下载失败: ' + (e.response?.data instanceof Blob ? '服务器错误' : msg))
    } finally { setExporting(false) }
  }

  const renderItemRow = (rec, order, it, idx, isCompleted) => {
    const orderedQty = Number(it.qty || 0)
    const reconciledQty = Number(it.reconciledQty || 0)
    const remaining = Math.max(0, orderedQty - reconciledQty)
    const fully = !!it.itemFullyReconciled
    // 默认本次对账数量 = 剩余未对账数量，用户可手工修改
    const defaultQty = remaining
    const defaultPrice = it.unitPrice != null ? Number(it.unitPrice) : null
    const dq = getDraftValue(rec.reconciliation_id, order.orderId, idx, 'qty')
    const dp = getDraftValue(rec.reconciliation_id, order.orderId, idx, 'price')
    const dqVal = dq === undefined ? defaultQty : dq
    const dpVal = dp === undefined ? defaultPrice : dp
    const draftBatchTotal = (dqVal && dpVal) ? Number(dqVal) * Number(dpVal) : 0
    return (
      <tr key={idx} style={{ borderBottom: '1px solid #1a1a1a', background: fully ? '#0a1a0a' : 'transparent' }}>
        <td style={{ padding: 4, color: '#666' }}>{idx + 1}</td>
        <td style={{ padding: 4 }}>{it.partType || '-'}</td>
        <td style={{ padding: 4, color: it.substituted ? '#faad14' : '#ccc' }}>{it.model || '-'}</td>
        {order.orderType === 'OUTBOUND' && <td style={{ padding: 4 }}>{it.customerPartNo || '-'}</td>}
        {order.orderType === 'INBOUND' && <td style={{ padding: 4, color: '#888' }}>{it.manufacturer || '-'}</td>}
        <td style={{ padding: 4, textAlign: 'right' }}>{it.qty != null ? it.qty : '-'}</td>
        <td style={{ padding: 4, textAlign: 'right' }}>{it.unitPrice != null ? '¥' + Number(it.unitPrice).toFixed(4) : '-'}</td>
        <td style={{ padding: 4, textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            <span style={{ color: fully ? '#52c41a' : '#faad14' }}>{reconciledQty} / {orderedQty}</span>
            {fully
              ? <Tag color="green" style={{ margin: 0, fontSize: 10 }}>✓</Tag>
              : <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>剩 {remaining}</Tag>}
          </div>
        </td>
        <td style={{ padding: 4 }}>
          {isCompleted || fully
            ? <span style={{ color: '#52c41a' }}>已对完</span>
            : <InputNumber size="small" style={{ width: '100%' }} min={0} max={remaining} placeholder="0"
                value={dqVal}
                onChange={v => setDraftValue(rec.reconciliation_id, order.orderId, idx, 'qty', v)} />}
        </td>
        <td style={{ padding: 4 }}>
          {isCompleted || fully
            ? <span style={{ color: '#666' }}>-</span>
            : <InputNumber size="small" style={{ width: '100%' }} min={0} step={0.0001} placeholder="0.0000"
                value={dpVal}
                onChange={v => setDraftValue(rec.reconciliation_id, order.orderId, idx, 'price', v)} />}
        </td>
        <td style={{ padding: 4, textAlign: 'right', color: draftBatchTotal > 0 ? '#69b1ff' : '#666', fontSize: 11 }}>
          {draftBatchTotal > 0 ? '¥' + draftBatchTotal.toFixed(2) : '-'}
        </td>
      </tr>
    )
  }

  const renderOrderBlock = (rec, order) => {
    const isCompleted = rec.status === 'COMPLETED'
    const items = order.items || []
    const orderFully = !!order.orderFullyReconciled
    const orderItems = items.filter(it => Number(it.qty || 0) > 0)
    const filledCount = orderItems.filter(it => !!it.itemFullyReconciled).length
    const historyKey = `${rec.reconciliation_id}:${order.orderId}`
    const orderHistory = (rec.reconciliationItems || []).filter(it => Number(it.orderId) === Number(order.orderId))
    const historyVisible = historyOpen[historyKey] !== false
    return (
      <div key={order.orderId} style={{ marginBottom: 16, background: '#0d0d0d', border: `1px solid ${orderFully ? '#234d23' : '#222'}`, borderRadius: 4, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, color: '#ccc', fontSize: 12, flexWrap: 'wrap', gap: 8 }}>
          <Space size="middle" wrap>
            <span><Text type="secondary">单号:</Text> <Text code style={{ color: '#69b1ff' }}>{order.orderNumber}</Text></span>
            <span><Text type="secondary">{order.orderType === 'OUTBOUND' ? '客户' : '供应商'}:</Text> {order.party || '-'}</span>
            <span><Text type="secondary">订单金额:</Text> ¥{Number(order.totalAmount || 0).toFixed(2)}</span>
            {order.status && <Tag color={order.status === 'COMPLETED' || order.status === 'RECEIVED' || order.status === 'SHIPPED' ? 'green' : 'default'}>{order.status}</Tag>}
            <Tag color={orderFully ? 'green' : 'orange'}>
              {orderFully ? '已完全对账' : `部分对账 ${filledCount}/${orderItems.length}`}
            </Tag>
          </Space>
          {!isCompleted && orderHistory.length > 0 && (
            <Button size="small" type="text" icon={<HistoryOutlined />}
              onClick={() => setHistoryOpen(prev => ({ ...prev, [historyKey]: prev[historyKey] === false }))}>
              {historyVisible ? '隐藏' : '查看'}已对账明细 ({orderHistory.length})
            </Button>
          )}
        </div>
        {orderHistory.length > 0 && historyVisible && (
          <div style={{ marginBottom: 8, padding: 8, background: '#111', border: '1px solid #222', borderRadius: 4 }}>
            <div style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>已录入的对账明细 (按批次):</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 11 }}>
              <thead><tr style={{ borderBottom: '1px solid #333' }}>
                <th style={{ padding: 4, textAlign: 'left', width: 60 }}>批次</th>
                <th style={{ padding: 4, textAlign: 'left' }}>型号</th>
                <th style={{ padding: 4, textAlign: 'right', width: 80 }}>本次数量</th>
                <th style={{ padding: 4, textAlign: 'right', width: 90 }}>本次单价</th>
                <th style={{ padding: 4, textAlign: 'right', width: 90 }}>小计</th>
                <th style={{ padding: 4, textAlign: 'left', width: 130 }}>录入时间</th>
                {!isCompleted && <th style={{ padding: 4, width: 50 }}></th>}
              </tr></thead>
              <tbody>{orderHistory.map(h => (
                <tr key={h.itemId} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ padding: 4, color: '#69b1ff' }}>#{h.batchIndex}</td>
                  <td style={{ padding: 4 }}>{h.model || h.partType || '-'}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{h.reconciledQty}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>¥{Number(h.reconciledUnitPrice).toFixed(4)}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>¥{Number(h.reconciledSubtotal).toFixed(2)}</td>
                  <td style={{ padding: 4, color: '#888' }}>{h.createdAt ? dayjs(h.createdAt).format('MM-DD HH:mm') : '-'}</td>
                  {!isCompleted && (
                    <td style={{ padding: 4 }}>
                      <Popconfirm title="删除此条对账明细?" onConfirm={() => handleDeleteItem(rec.reconciliation_id, h.itemId)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </td>
                  )}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {items.length > 0 ? (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ padding: 4, textAlign: 'left', width: 30 }}>#</th>
                  <th style={{ padding: 4, textAlign: 'left', width: 80 }}>品类</th>
                  <th style={{ padding: 4, textAlign: 'left' }}>型号</th>
                  {order.orderType === 'OUTBOUND' && <th style={{ padding: 4, textAlign: 'left', width: 110 }}>客户料号</th>}
                  {order.orderType === 'INBOUND' && <th style={{ padding: 4, textAlign: 'left', width: 90 }}>厂家</th>}
                  <th style={{ padding: 4, textAlign: 'right', width: 60 }}>订单数</th>
                  <th style={{ padding: 4, textAlign: 'right', width: 80 }}>订单单价</th>
                  <th style={{ padding: 4, textAlign: 'right', width: 130 }}>已对账/剩余</th>
                  <th style={{ padding: 4, textAlign: 'left', width: 90 }}>本次数量</th>
                  <th style={{ padding: 4, textAlign: 'left', width: 110 }}>本次单价</th>
                  <th style={{ padding: 4, textAlign: 'right', width: 80 }}>本批小计</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => renderItemRow(rec, order, it, idx, isCompleted))}
              </tbody>
            </table>
            {!isCompleted && (
              <div style={{ marginTop: 8, textAlign: 'right' }}>
                <Button type="primary" size="small" icon={<SaveOutlined />} loading={savingBatch}
                  onClick={() => handleSaveBatch(rec.reconciliation_id, order)}>
                  保存本批对账
                </Button>
              </div>
            )}
          </>
        ) : (
          <div style={{ color: '#888', fontSize: 12, padding: 8, textAlign: 'center' }}>该订单暂无物料明细</div>
        )}
      </div>
    )
  }

  // 渲染对账单完整卡片 (header + 物料明细)
  const renderReconciliationCard = (record) => {
    const detail = expandedDetails[record.reconciliation_id]
    const refs = detail?.references || []
    const linkedOrders = detail?.linkedOrders || []
    const reconciledSubtotal = Number(detail?.reconciledSubtotal || 0)
    const fully = !!detail?.isFullyReconciled
    const isCompleted = record.status === 'COMPLETED'
    const orderNums = record.orderNumbers || []
    const linkedNos = activeTab === 'OUTBOUND' ? (record.soNumbers || []) : (record.poNumbers || [])
    // 客户/供应商名称解析
    const party = activeTab === 'OUTBOUND'
      ? (record.customer_id != null
          ? (customers.find(c => Number(c.customerId) === Number(record.customer_id))?.name || record.customer_id)
          : '-')
      : (record.supplier_name || '-')
    const totalAmount = Number(record.total_amount || 0)
    const partyLabel = activeTab === 'OUTBOUND' ? '客户' : '供应商'
    return (
      <div style={{ marginBottom: 12, background: '#0d0d0d', border: `1px solid ${isCompleted ? '#234d23' : (fully ? '#1f3a4d' : '#222')}`, borderRadius: 6, padding: 12 }}>
        {/* Header: 汇总信息 (原有字段全部在头部展示) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, paddingBottom: 10, borderBottom: '1px dashed #222' }}>
          <div style={{ minWidth: 180 }}>
            <div style={{ color: '#888', fontSize: 11 }}>对账单号</div>
            <div><Text code style={{ color: '#69b1ff', fontSize: 13 }}>{record.rec_number}</Text></div>
          </div>
          <div style={{ minWidth: 200 }}>
            <div style={{ color: '#888', fontSize: 11 }}>{partyLabel}</div>
            <div style={{ color: '#ccc' }}>{party}</div>
          </div>
          <div style={{ minWidth: 220 }}>
            <div style={{ color: '#888', fontSize: 11 }}>{activeTab === 'OUTBOUND' ? '出库单号 / 销售单号' : '入库单号 / 采购单号'}</div>
            <div>
              {orderNums.length > 0 ? orderNums.map((n, i) => <Tag key={'o'+i} color="blue" style={{marginBottom:2}}>{n}</Tag>) : <span style={{ color: '#666' }}>-</span>}
              {linkedNos.length > 0 && (
                <span style={{ marginLeft: 4, color: '#666' }}>·</span>
              )}
              {linkedNos.map((n, i) => <Tag key={'l'+i} color="geekblue" style={{marginBottom:2, marginLeft: 2}}>{n}</Tag>)}
            </div>
          </div>
          <div style={{ minWidth: 110 }}>
            <div style={{ color: '#888', fontSize: 11 }}>订单总额</div>
            <div style={{ color: '#ccc' }}>¥{totalAmount.toLocaleString()}</div>
          </div>
          <div style={{ minWidth: 110 }}>
            <div style={{ color: '#888', fontSize: 11 }}>已对账金额</div>
            <div style={{ color: '#52c41a' }}>¥{reconciledSubtotal.toFixed(2)}</div>
          </div>
          <div style={{ minWidth: 90 }}>
            <div style={{ color: '#888', fontSize: 11 }}>关联订单</div>
            <div style={{ color: '#ccc' }}>{refs.length} 条</div>
          </div>
          <div style={{ minWidth: 110 }}>
            <div style={{ color: '#888', fontSize: 11 }}>对账状态</div>
            <div>
              {isCompleted
                ? <Tag color="green" style={{ margin: 0 }}>已完成</Tag>
                : fully
                  ? <Tag color="cyan" style={{ margin: 0 }}>可完成</Tag>
                  : <Tag color="orange" style={{ margin: 0 }}>部分对账</Tag>}
            </div>
          </div>
          <div style={{ minWidth: 130 }}>
            <div style={{ color: '#888', fontSize: 11 }}>创建时间</div>
            <div style={{ color: '#ccc', fontSize: 12 }}>{record.created_at ? dayjs(record.created_at).format('YYYY-MM-DD HH:mm') : '-'}</div>
          </div>
          <div style={{ minWidth: 130 }}>
            <div style={{ color: '#888', fontSize: 11 }}>完成时间</div>
            <div style={{ color: '#ccc', fontSize: 12 }}>{record.completed_at ? dayjs(record.completed_at).format('YYYY-MM-DD HH:mm') : '-'}</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {isCompleted
              ? <Text type="secondary">已完成</Text>
              : (
                <Popconfirm title="确认对账完成?" disabled={!fully}
                  onConfirm={() => handleComplete(record.reconciliation_id)}>
                  {fully
                    ? <Button type="primary" size="small" icon={<CheckOutlined />}>对账完成</Button>
                    : <Tooltip title="请先录入所有物料的对账明细"><Button size="small" icon={<CheckOutlined />} disabled>对账完成</Button></Tooltip>}
                </Popconfirm>
              )}
          </div>
        </div>
        {/* Body: 关联订单 + 物料明细 */}
        {linkedOrders.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            {linkedOrders.map(o => renderOrderBlock(detail, o))}
          </div>
        ) : detail ? (
          <div style={{ color: '#888', fontSize: 12, padding: 12, textAlign: 'center' }}>暂无关联订单</div>
        ) : (
          <div style={{ color: '#888', fontSize: 12, padding: 12, textAlign: 'center' }}>加载中...</div>
        )}
      </div>
    )
  }

  const columns = [
    { key: 'reconciliation_card', render: (_, r) => renderReconciliationCard(r) }
  ]

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <Tabs activeKey={activeTab} onChange={k => { setActiveTab(k); setPage(1); setStatusFilter(null) }}
          items={[
            { key: 'OUTBOUND', label: <span><SendOutlined /> 出库对账单 {pendingCount > 0 && activeTab === 'OUTBOUND' ?
              <Tag color="orange" style={{ marginLeft: 4 }}>{pendingCount} 待对账</Tag> : null}</span> },
            { key: 'INBOUND', label: <span><InboxOutlined /> 入库对账单 {pendingCount > 0 && activeTab === 'INBOUND' ?
              <Tag color="orange" style={{ marginLeft: 4 }}>{pendingCount} 待对账</Tag> : null}</span> }
          ]} />

        <Space style={{ marginBottom: 16 }} wrap>
          <Space>
            <Tag.CheckableTag checked={statusFilter === null} onChange={() => { setStatusFilter(null); setPage(1) }}>
              全部
            </Tag.CheckableTag>
            <Tag.CheckableTag checked={statusFilter === 'PENDING'} onChange={() => { setStatusFilter('PENDING'); setPage(1) }}>
              待对账
            </Tag.CheckableTag>
            <Tag.CheckableTag checked={statusFilter === 'COMPLETED'} onChange={() => { setStatusFilter('COMPLETED'); setPage(1) }}>
              已完成
            </Tag.CheckableTag>
          </Space>
          {activeTab === 'OUTBOUND' ? (
            <Select
              placeholder="选择客户 (留空 = 全部)"
              allowClear
              style={{ width: 220 }}
              value={partyFilter}
              onChange={v => { setPartyFilter(v || null); setPage(1) }}
              showSearch
              optionFilterProp="children"
              filterOption={(input, option) => (option?.children || '').toString().toLowerCase().includes(input.toLowerCase())}
            >
              {customers.map(c => <Select.Option key={c.customerId} value={c.customerId}>{c.name}</Select.Option>)}
            </Select>
          ) : (
            <Select
              placeholder="选择供应商 (留空 = 全部)"
              allowClear
              style={{ width: 220 }}
              value={partyFilter}
              onChange={v => { setPartyFilter(v || null); setPage(1) }}
              showSearch
              optionFilterProp="children"
              filterOption={(input, option) => (option?.children || '').toString().toLowerCase().includes(input.toLowerCase())}
            >
              {suppliers.map(s => <Select.Option key={s.supplierId || s.name} value={s.name}>{s.name}</Select.Option>)}
            </Select>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); fetchRecords(); fetchPendingCount() }}>刷新</Button>
          <Button icon={<DownloadOutlined />} onClick={openExportModal}>导出</Button>
        </Space>

        <Table dataSource={records} columns={columns} rowKey="reconciliation_id" loading={loading}
          pagination={false}
          size="small"
          showHeader={false}
          locale={{ emptyText: '暂无对账单。出库/入库完成后会自动生成对账单。' }} />

        {total > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={['10', '20', '50', '100']}
              onChange={(p, ps) => { setPage(p); setPageSize(ps) }}
              showTotal={t => `共 ${t} 条`}
            />
          </div>
        )}

        <Modal
          title={<span><ExportOutlined /> 导出{activeTab === 'OUTBOUND' ? '出库' : '入库'}对账单</span>}
          open={exportOpen}
          onCancel={() => setExportOpen(false)}
          footer={[
            <Button key="cancel" onClick={() => setExportOpen(false)}>取消</Button>,
            <Button key="csv" icon={<DownloadOutlined />} loading={exporting}
              onClick={() => handleExportFile('csv')}>下载 CSV</Button>,
            <Button key="xlsx" type="primary" icon={<DownloadOutlined />} loading={exporting}
              onClick={() => handleExportFile('xlsx')}>下载 Excel</Button>,
            <Button key="preview" loading={exporting} onClick={handleExport}>窗口中预览</Button>,
          ]}
          width={520}
          destroyOnClose
        >
          <Form form={exportForm} layout="vertical" preserve={false}>
            <Form.Item
              name="dateRange"
              label="日期范围 (必填)"
              rules={[{ required: true, message: '请选择起止日期' }]}
            >
              <DatePicker.RangePicker
                style={{ width: '100%' }}
                placeholder={['开始日期', '结束日期']}
                format="YYYY-MM-DD"
              />
            </Form.Item>
            {activeTab === 'OUTBOUND' ? (
              <Form.Item name="customerName" label="客户 (可选)">
                <Select
                  allowClear
                  showSearch
                  placeholder="请选择客户 (留空 = 全部客户)"
                  optionFilterProp="label"
                  options={customers.map(c => ({ value: c.name, label: c.name }))}
                />
              </Form.Item>
            ) : (
              <Form.Item name="supplierName" label="供应商 (可选)">
                <Select
                  allowClear
                  showSearch
                  placeholder="请选择供应商 (留空 = 全部供应商)"
                  optionFilterProp="label"
                  options={suppliers.map(s => ({ value: s.name, label: s.name }))}
                />
              </Form.Item>
            )}
            <div style={{ color: '#888', fontSize: 12 }}>
              范围: 该日期范围内所有对账单 (PENDING + COMPLETED),按创建时间筛选。
            </div>
          </Form>
        </Modal>

        <Modal
          title={exportResult
            ? <span><ExportOutlined /> 导出结果 — {exportResult.dateFrom} 至 {exportResult.dateTo}
                {(exportResult.customerName || exportResult.supplierName)
                  ? ` (${exportResult.customerName ? '客户: ' + exportResult.customerName : '供应商: ' + exportResult.supplierName})`
                  : ''}</span>
            : '导出结果'}
          open={!!exportResult}
          onCancel={() => setExportResult(null)}
          footer={[
            <Button key="close" onClick={() => setExportResult(null)}>关闭</Button>
          ]}
          width={1100}
          destroyOnClose
        >
          {exportResult && (
            <ExportResultView data={exportResult} />
          )}
        </Modal>
      </Content>
    </Layout>
  )
}

function ExportResultView({ data }) {
  const recs = data.reconciliations || []
  if (recs.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>该日期范围内无对账单记录</div>
  }
  const fmtMoney = v => v != null ? '¥' + Number(v).toFixed(2) : '-'
  const fmtQty = v => v != null ? Number(v).toLocaleString() : '-'
  return (
    <div>
      <div style={{ marginBottom: 16, padding: '10px 12px', background: '#1a1a2e', borderRadius: 8, color: '#ccc' }}>
        📊 合计: <b style={{ color: '#69b1ff' }}>{data.totalReconciliations}</b> 个对账单,
        <b style={{ color: '#69b1ff' }}> {data.totalItems}</b> 条录入批次明细,
        总金额 <b style={{ color: '#52c41a' }}>{fmtMoney(data.grandTotal)}</b>
      </div>
      {recs.map(rec => {
        const rows = rec.itemRows || []
        // 按订单分组,便于在预览里分块显示
        const grouped = {}
        rows.forEach(r => {
          const key = r.orderId || '-'
          if (!grouped[key]) grouped[key] = { order: r, items: [] }
          grouped[key].items.push(r)
        })
        const groups = Object.values(grouped)
        return (
          <div key={rec.reconciliationId} style={{ marginBottom: 18, background: '#0d0d0d', border: '1px solid #222', borderRadius: 6, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 10, color: '#ccc', fontSize: 13 }}>
              <Text code style={{ color: '#69b1ff' }}>{rec.recNumber}</Text>
              <Tag color={rec.status === 'COMPLETED' ? 'green' : 'orange'}>{rec.status}</Tag>
              {rec.customerName && <span>客户: {rec.customerName}</span>}
              {rec.supplierName && <span>供应商: {rec.supplierName}</span>}
              <span>对账单金额: {fmtMoney(rec.totalAmount)}</span>
              <span style={{ color: '#888' }}>创建: {rec.createdAt ? dayjs(rec.createdAt).format('YYYY-MM-DD HH:mm') : '-'}</span>
              {rec.completedAt && <span style={{ color: '#888' }}>完成: {dayjs(rec.completedAt).format('YYYY-MM-DD HH:mm')}</span>}
            </div>
            {groups.map(g => (
              <div key={g.order.orderId} style={{ marginBottom: 10 }}>
                <div style={{ color: '#888', fontSize: 11, marginBottom: 4 }}>
                  单号: <Text code style={{ color: '#69b1ff' }}>{g.order.orderNumber}</Text>
                  {g.order.orderDate && <span> · 订单日期: {g.order.orderDate}</span>}
                  {g.order.shipDate && <span> · 发货日期: {g.order.shipDate}</span>}
                  {g.order.receivedDate && <span> · 收货日期: {g.order.receivedDate}</span>}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ccc', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#141414', color: '#9aa0a6' }}>
                      <th style={{ padding: 6, textAlign: 'left', width: 60 }}>批次</th>
                      <th style={{ padding: 6, textAlign: 'left', width: 80 }}>品类</th>
                      <th style={{ padding: 6, textAlign: 'left' }}>型号</th>
                      <th style={{ padding: 6, textAlign: 'left', width: 100 }}>客户料号</th>
                      <th style={{ padding: 6, textAlign: 'left', width: 100 }}>厂家</th>
                      <th style={{ padding: 6, textAlign: 'right', width: 80 }}>对账数量</th>
                      <th style={{ padding: 6, textAlign: 'right', width: 90 }}>对账单价</th>
                      <th style={{ padding: 6, textAlign: 'right', width: 100 }}>小计</th>
                      <th style={{ padding: 6, textAlign: 'left', width: 150 }}>对账时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={{ padding: 6, color: '#69b1ff' }}>#{it.itemIndex}</td>
                        <td style={{ padding: 6 }}>{it.partType || '-'}</td>
                        <td style={{ padding: 6, fontFamily: 'monospace' }}>{it.model || '-'}</td>
                        <td style={{ padding: 6 }}>{it.customerPartNo || '-'}</td>
                        <td style={{ padding: 6 }}>{it.manufacturer || '-'}</td>
                        <td style={{ padding: 6, textAlign: 'right' }}>{fmtQty(it.qty)}</td>
                        <td style={{ padding: 6, textAlign: 'right' }}>¥{Number(it.unitPrice).toFixed(4)}</td>
                        <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(it.subtotal)}</td>
                        <td style={{ padding: 6, color: '#9aa0a6' }}>{it.reconciledAt ? dayjs(it.reconciledAt).format('YYYY-MM-DD HH:mm:ss') : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {groups.length === 0 && (
              <div style={{ color: '#888', fontSize: 12, padding: 8 }}>无关联订单</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
