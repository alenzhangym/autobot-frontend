import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, InputNumber, Tag, Space, message, Popconfirm, Card, Row, Col, Tooltip, Typography, Switch, AutoComplete, Divider } from 'antd'
import { EditOutlined, ReloadOutlined, SearchOutlined, WarningOutlined, PlusOutlined } from '@ant-design/icons'
import { Resizable } from 'react-resizable'
import 'react-resizable/css/styles.css'
import api from './auth'

const { Content } = Layout
const { Text } = Typography

const ResizableTitle = (props) => {
  const { onResize, width, ...restProps } = props
  if (!width) return <th {...restProps} />
  return (
    <Resizable width={width} height={0} onResize={onResize} draggableOpts={{ enableUserSelectHack: false }}>
      <th {...restProps} />
    </Resizable>
  )
}

export default function InventoryManagement({ user, companies = [] }) {
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isCompanyAdmin = user?.role === 'COMPANY_ADMIN' || (user?.role || '').toLowerCase() === 'company_admin'
  const canEdit = isSuperAdmin || isCompanyAdmin
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  // ── New inventory modal state ──
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [formCreate] = Form.useForm()
  const [creating, setCreating] = useState(false)
  const [partOptions, setPartOptions] = useState([])
  const [partsSearching, setPartsSearching] = useState(false)
  const [selectedPartInfo, setSelectedPartInfo] = useState(null)
  const [colWidths, setColWidths] = useState({
    partType: 80, userPartModel: 180, manufacturer: 110,
    supplierName: 130, supplierModel: 130, currentStock: 90,
    minStockAlert: 80, unitPrice: 100, purchasePrice: 100,
    location: 100, action: 100,
  })

  const fetchInventory = useCallback(async () => {
    if (!canEdit) return
    setLoading(true)
    try {
      const params = { page, size: pageSize, keyword: keyword || undefined, lowStockOnly }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/inventory', { params })
      setRows(res.data.data || [])
      setTotal(res.data.count || 0)
    } catch (e) {
      if (e.response?.status === 403) {
        message.error('需要管理员权限才能访问')
      } else {
        message.error('加载库存失败: ' + (e.response?.data?.error || e.message))
      }
      setRows([])
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, lowStockOnly, effectiveCompanyId, isSuperAdmin, canEdit])

  useEffect(() => { fetchInventory() }, [fetchInventory])

  const openEdit = (row) => {
    setEditing(row)
    form.setFieldsValue({
      currentStock: row.currentStock ?? 0,
      minStockAlert: row.minStockAlert ?? 0,
      unitPrice: row.unitPrice ?? 0,
      purchasePrice: row.purchasePrice ?? 0,
      location: row.location || '',
      supplierName: row.supplierName || '',
    })
    setShowEditModal(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const params = { ...values }
      await api.put(`/erp/inventory/${editing.inventoryId}`, params)
      message.success('库存已更新')
      setShowEditModal(false)
      setEditing(null)
      fetchInventory()
    } catch (e) {
      if (e.errorFields) return
      message.error('更新失败: ' + (e.response?.data?.error || e.message))
    } finally { setSubmitting(false) }
  }

  // ── Create new inventory ──

  const searchParts = useCallback(async (kw) => {
    if (!canEdit) return
    setPartsSearching(true)
    try {
      const params = { keyword: kw || undefined, page: 1, size: 20 }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/parts', { params })
      // response shape: { data: { parts: [...] } } or { data: [...] }
      const list = res.data?.parts || res.data?.data?.parts || res.data?.data || res.data || []
      const opts = (Array.isArray(list) ? list : []).map(p => ({
        value: `${p.userPartModel || ''} | ${p.manufacturer || ''} | ID:${p.partId}`,
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span><Text code style={{ fontSize: 12 }}>{p.userPartModel}</Text> · {p.manufacturer}</span>
            <Tag color="blue" style={{ marginRight: 0 }}>{p.partType || '其他'}</Tag>
          </div>
        ),
        part: p,
      }))
      setPartOptions(opts)
    } catch (e) {
      message.error('加载物料列表失败: ' + (e.response?.data?.error || e.message))
      setPartOptions([])
    } finally { setPartsSearching(false) }
  }, [canEdit, isSuperAdmin, effectiveCompanyId])

  const openCreate = () => {
    formCreate.resetFields()
    formCreate.setFieldsValue({
      currentStock: 0,
      minStockAlert: 0,
      unitPrice: 0,
      purchasePrice: 0,
    })
    setSelectedPartInfo(null)
    setPartOptions([])
    setShowCreateModal(true)
    searchParts('')
  }

  const handlePartSelect = (value, option) => {
    const p = option?.part
    if (p) {
      setSelectedPartInfo(p)
      formCreate.setFieldsValue({
        supplierName: p.manufacturer || '',
        supplierModel: p.userPartModel || '',
      })
    }
  }

  const handleCreate = async () => {
    try {
      const values = await formCreate.validateFields()
      if (!selectedPartInfo) {
        message.error('请先从下拉中选择一个物料')
        return
      }
      setCreating(true)
      await api.post('/erp/inventory', {
        partId: selectedPartInfo.partId,
        currentStock: values.currentStock || 0,
        minStockAlert: values.minStockAlert || 0,
        unitPrice: values.unitPrice || 0,
        purchasePrice: values.purchasePrice || 0,
        supplierName: values.supplierName || selectedPartInfo.manufacturer,
        supplierModel: values.supplierModel || selectedPartInfo.userPartModel,
        location: values.location || '',
      })
      message.success('库存已新增')
      setShowCreateModal(false)
      setSelectedPartInfo(null)
      fetchInventory()
    } catch (e) {
      if (e.errorFields) return
      message.error('新增失败: ' + (e.response?.data?.error || e.message))
    } finally { setCreating(false) }
  }

  const columns = [
    { title: '品类', dataIndex: 'partType', key: 'partType', width: colWidths.partType,
      render: v => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '型号', dataIndex: 'userPartModel', key: 'userPartModel', width: colWidths.userPartModel,
      ellipsis: true, render: v => <Text code style={{ fontSize: 12 }}>{v || '-'}</Text> },
    { title: '厂家', dataIndex: 'manufacturer', key: 'manufacturer', width: colWidths.manufacturer,
      render: v => v || '-' },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: colWidths.supplierName,
      render: v => v || '-' },
    { title: '供应商型号', dataIndex: 'supplierModel', key: 'supplierModel', width: colWidths.supplierModel,
      ellipsis: true, render: v => v || '-' },
    { title: '当前库存', dataIndex: 'currentStock', key: 'currentStock', width: colWidths.currentStock,
      align: 'right',
      render: (v, r) => {
        const isLow = (r.minStockAlert || 0) > 0 && (v || 0) < (r.minStockAlert || 0)
        return (
          <span style={{ color: isLow ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>
            {v != null ? v.toLocaleString() : '-'}
            {isLow && <Tooltip title={`低于预警值 ${r.minStockAlert}`}><WarningOutlined style={{ marginLeft: 6, color: '#faad14' }} /></Tooltip>}
          </span>
        )
      },
      sorter: (a, b) => (a.currentStock || 0) - (b.currentStock || 0),
    },
    { title: '预警值', dataIndex: 'minStockAlert', key: 'minStockAlert', width: colWidths.minStockAlert,
      align: 'right', render: v => v || '-' },
    { title: '单价 (¥)', dataIndex: 'unitPrice', key: 'unitPrice', width: colWidths.unitPrice,
      align: 'right', render: v => v != null ? Number(v).toFixed(4) : '-' },
    { title: '采购价 (¥)', dataIndex: 'purchasePrice', key: 'purchasePrice', width: colWidths.purchasePrice,
      align: 'right', render: v => v != null ? Number(v).toFixed(4) : '-' },
    { title: '库位', dataIndex: 'location', key: 'location', width: colWidths.location,
      render: v => v || '-' },
    { title: '操作', key: 'action', width: colWidths.action, fixed: 'right',
      render: (_, r) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>修改</Button>
      ),
    },
  ]

  const components = { header: { cell: ResizableTitle } }
  const handleResize = (key) => (e, { size }) => {
    setColWidths(prev => ({ ...prev, [key]: size.width }))
  }
  const colsWithResize = columns.map((col, idx) => ({
    ...col,
    onHeaderCell: () => ({
      width: col.width,
      onResize: handleResize(Object.keys(colWidths)[idx]),
    }),
  }))

  if (!canEdit) {
    return (
      <Layout style={{ background: '#0d0d0d', height: '100%' }}>
        <Content style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: '#ff4d4f', fontSize: 16, marginTop: 60 }}>
            <WarningOutlined style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            库存管理仅对公司管理员 (COMPANY_ADMIN) 开放
            <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>当前角色: {user?.role || '未知'}</div>
          </div>
        </Content>
      </Layout>
    )
  }

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col><h2 style={{ color: '#e3e3e3', margin: 0 }}>库存管理</h2></Col>
          <Col><Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增库存</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchInventory}>刷新</Button>
          </Space></Col>
        </Row>

        <Card size="small" style={{ marginBottom: 16, background: '#141414', border: '1px solid #222' }}>
          <Row gutter={12} align="middle">
            <Col flex="auto">
              <Input
                placeholder="搜索型号/厂家/供应商"
                allowClear
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onPressEnter={() => { setPage(1); fetchInventory() }}
              />
            </Col>
            <Col>
              <Space size={8} align="center">
                <span style={{ color: '#888' }}>仅低库存</span>
                <Switch checked={lowStockOnly} onChange={v => { setLowStockOnly(v); setPage(1); }} />
                <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); fetchInventory() }}>搜索</Button>
              </Space>
            </Col>
          </Row>
        </Card>

        <Table
          dataSource={rows}
          columns={colsWithResize}
          rowKey="inventoryId"
          loading={loading}
          components={components}
          scroll={{ x: 1300 }}
          size="small"
          pagination={{
            current: page, pageSize, total, showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />

        <Modal
          title={`修改库存 - ${editing?.userPartModel || ''}`}
          open={showEditModal}
          onOk={handleSubmit}
          onCancel={() => { setShowEditModal(false); setEditing(null); }}
          confirmLoading={submitting}
          okText="保存"
          cancelText="取消"
          width={520}
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
              ID: {editing?.inventoryId} · 供应商: {editing?.supplierName || '-'}
            </div>
            <Form.Item name="currentStock" label="当前库存" rules={[{ required: true, message: '请输入当前库存' }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={1} />
            </Form.Item>
            <Form.Item name="minStockAlert" label="预警值" tooltip="低于此值会显示告警图标">
              <InputNumber style={{ width: '100%' }} min={0} step={1} />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="unitPrice" label="单价 (¥)">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.0001} precision={4} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="purchasePrice" label="采购价 (¥)">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.0001} precision={4} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="supplierName" label="供应商名称">
              <Input placeholder="供应商" />
            </Form.Item>
            <Form.Item name="location" label="库位">
              <Input placeholder="库位" />
            </Form.Item>
            <div style={{ color: '#faad14', fontSize: 12, padding: 8, background: '#1f1a0a', borderRadius: 4 }}>
              ⚠️ 修改库存会直接写入数据库，操作将记录在审计日志中。
            </div>
          </Form>
        </Modal>

        <Modal
          title="新增库存"
          open={showCreateModal}
          onOk={handleCreate}
          onCancel={() => { setShowCreateModal(false); setSelectedPartInfo(null); }}
          confirmLoading={creating}
          okText="创建"
          cancelText="取消"
          width={620}
        >
          <Form form={formCreate} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item label="选择物料" required>
              <AutoComplete
                placeholder="输入型号/厂家搜索"
                options={partOptions}
                onSelect={handlePartSelect}
                onSearch={searchParts}
                filterOption={false}
                notFoundContent={partsSearching ? '搜索中…' : '无匹配物料'}
                style={{ width: '100%' }}
              >
                <Input.Search
                  placeholder="输入型号/厂家搜索"
                  enterButton
                  onSearch={v => searchParts(v)}
                />
              </AutoComplete>
              {selectedPartInfo ? (
                <div style={{ marginTop: 8, padding: 8, background: '#0d3a2a', borderRadius: 4, fontSize: 12 }}>
                  <Tag color="green">已选</Tag>
                  <Text code>{selectedPartInfo.userPartModel}</Text> · {selectedPartInfo.manufacturer} ·
                  <Tag color="blue" style={{ marginLeft: 4 }}>{selectedPartInfo.partType || '其他'}</Tag>
                  <span style={{ color: '#888', marginLeft: 8 }}>ID: {selectedPartInfo.partId}</span>
                </div>
              ) : (
                <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
                  请从下拉中选择物料（自动关联型号和厂家）
                </div>
              )}
            </Form.Item>

            <Divider style={{ margin: '12px 0' }} />

            <Form.Item name="currentStock" label="初始库存量" rules={[{ required: true, message: '请输入库存量' }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={1} />
            </Form.Item>
            <Form.Item name="minStockAlert" label="预警值" tooltip="低于此值会显示告警图标">
              <InputNumber style={{ width: '100%' }} min={0} step={1} />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="purchasePrice" label="采购价 (¥)">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.0001} precision={4} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="unitPrice" label="单价 (¥)" rules={[{ required: true, message: '请输入单价' }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.0001} precision={4} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="supplierName" label="供应商名称">
                  <Input placeholder="默认使用物料厂家" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="supplierModel" label="供应商型号">
                  <Input placeholder="默认使用用户型号" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="location" label="库位">
              <Input placeholder="库位" />
            </Form.Item>
            <div style={{ color: '#faad14', fontSize: 12, padding: 8, background: '#1f1a0a', borderRadius: 4 }}>
              ⚠️ 新增库存会向 erp_supplier_inventory 表插入新记录，操作将记录在审计日志中。
            </div>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
