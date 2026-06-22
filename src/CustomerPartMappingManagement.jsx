import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, Row, Col, Card, Switch } from 'antd'
import { PlusOutlined, ReloadOutlined, SearchOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import api from './auth'

const { Content } = Layout

export default function CustomerPartMappingManagement({ user, companies = [] }) {
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [mappings, setMappings] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [filterCustomerId, setFilterCustomerId] = useState(null)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()

  const [customers, setCustomers] = useState([])
  const [parts, setParts] = useState([])

  useEffect(() => {
    (async () => {
      try {
        const params = {}
        if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
        const [custRes, partRes] = await Promise.all([
          api.get('/erp/customers', { params }),
          api.get('/erp/parts', { params: { ...params, size: 999 } }),
        ])
        setCustomers(custRes.data.customers || [])
        setParts(partRes.data.parts || [])
      } catch (e) { /* ignore */ }
    })()
  }, [isSuperAdmin, effectiveCompanyId])

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, size: pageSize, keyword: keyword || undefined, customerId: filterCustomerId || undefined }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/customer-part-mappings', { params })
      const mapPayload = res.data?.data || res.data || {}
      setMappings(mapPayload.mappings || [])
      setTotal(mapPayload.total || 0)
    } catch (e) {
      message.error('加载失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, filterCustomerId, effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetch() }, [fetch])

  const openCreate = () => { setEditing(null); form.resetFields(); setShowModal(true) }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      customerId: record.customerId,
      customerPartNo: record.customerPartNo,
      customerPartDesc: record.customerPartDesc || '',
      partId: record.partId,
      isPreferred: record.isPreferred !== false,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const body = {
        customerId: values.customerId,
        customerPartNo: values.customerPartNo,
        customerPartDesc: values.customerPartDesc || '',
        partId: values.partId,
        isPreferred: values.isPreferred !== false,
      }
      if (editing) {
        await api.put(`/erp/customer-part-mappings/${editing.mappingId}`, body)
        message.success('已更新')
      } else {
        await api.post('/erp/customer-part-mappings', body)
        message.success('已创建')
      }
      setShowModal(false); setEditing(null); fetch()
    } catch (e) { if (!e.errorFields) message.error('操作失败: ' + (e.response?.data?.error || e.message)) }
  }

  const handleDelete = async (id) => {
    try { await api.delete(`/erp/customer-part-mappings/${id}`); message.success('已删除'); fetch() }
    catch (e) { message.error(e.response?.data?.error || '删除失败') }
  }

  const columns = [
    { title: '客户名称', dataIndex: 'customerName', key: 'cust', width: 120, render: v => v || '-' },
    { title: '客户料号', dataIndex: 'customerPartNo', key: 'no', width: 140 },
    { title: '客户描述', dataIndex: 'customerPartDesc', key: 'desc', width: 150, render: v => v || '-' },
    { title: '物料型号', dataIndex: 'partModel', key: 'model', width: 140, render: v => v || '-' },
    { title: '品类', dataIndex: 'partType', key: 'type', width: 80, render: v => v ? <Tag>{v}</Tag> : '-' },
    { title: '厂家', dataIndex: 'manufacturer', key: 'mfr', width: 100, render: v => v || '-' },
    { title: '优先', dataIndex: 'isPreferred', key: 'pref', width: 60, render: v => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
    { title: '操作', key: 'act', width: 120, fixed: 'right',
      render: (_, r) => (<Space size="small">
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="删除此映射?" onConfirm={() => handleDelete(r.mappingId)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>)
    },
  ]

  return (<Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}><Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
    <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
      <Col><h2 style={{ color: '#e3e3e3', margin: 0 }}>客户料号映射管理</h2></Col>
      <Col><Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建映射</Button>
        <Button icon={<ReloadOutlined />} onClick={fetch}>刷新</Button>
      </Space></Col>
    </Row>
    <Card size="small" style={{ marginBottom: 16, background: '#141414', border: '1px solid #222' }}>
      <Row gutter={12}>
        <Col><Select placeholder="选择客户" allowClear style={{ width: 160 }} value={filterCustomerId}
          onChange={v => { setFilterCustomerId(v); setPage(1) }}
          options={customers.map(c => ({ value: c.customerId, label: c.name }))} /></Col>
        <Col><Input placeholder="客户料号" allowClear style={{ width: 160 }} value={keyword}
          onChange={e => setKeyword(e.target.value)} /></Col>
        <Col><Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); fetch() }}>搜索</Button></Col>
      </Row>
    </Card>
    <Table dataSource={mappings} columns={columns} rowKey="mappingId" loading={loading}
      pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'], onChange: (p, ps) => { setPage(p); setPageSize(ps) } }}
      scroll={{ x: 900 }} size="small" style={{ background: '#141414' }} />

    <Modal title={editing ? '编辑客户料号映射' : '新建客户料号映射'} open={showModal} onOk={handleSave}
      onCancel={() => { setShowModal(false); setEditing(null) }} okText={editing ? '保存' : '创建'} width={520} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
          <Select showSearch placeholder="选择客户" filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}>
            {customers.map(c => <Select.Option key={c.customerId} value={c.customerId}>{c.name}</Select.Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="customerPartNo" label="客户料号" rules={[{ required: true, message: '请输入客户料号' }]}>
          <Input placeholder="客户使用的物料编号" />
        </Form.Item>
        <Form.Item name="customerPartDesc" label="客户描述">
          <Input placeholder="料号描述或规格（可选）" />
        </Form.Item>
        <Form.Item name="partId" label="我方物料编码" rules={[{ required: true, message: '请选择物料' }]}>
          <Select showSearch placeholder="选择物料编码 (型号/品类/厂家)" filterOption={(input, option) => option?.children?.toLowerCase().includes(input.toLowerCase())}>
            {parts.map(p => <Select.Option key={p.partId} value={p.partId}>{p.userPartModel || '#' + p.partId} {p.partType ? '(' + p.partType + ')' : ''} {p.manufacturer || ''}</Select.Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="isPreferred" label="优先推荐" valuePropName="checked">
          <Switch checkedChildren="是" unCheckedChildren="否" />
        </Form.Item>
      </Form>
    </Modal>
  </Content></Layout>)
}
