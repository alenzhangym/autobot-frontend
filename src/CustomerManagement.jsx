import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, Typography } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { Resizable } from 'react-resizable'
import 'react-resizable/css/styles.css'
import api from './auth'
import { useTranslation } from 'react-i18next'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const { Content } = Layout

const ResizableTitle = (props) => {
  const { onResize, width, ...restProps } = props
  if (!width) return <th {...restProps} />
  return (
    <Resizable width={width} height={0} onResize={onResize} draggableOpts={{ enableUserSelectHack: false }}>
      <th {...restProps} />
    </Resizable>
  )
}

// 2026-07-08: 合并 CRM 客户模型 — 统一使用 crm_customer 表
// 后端 /api/erp/customers 已改为查 crm_customer (CustomerProfileController 委托 CrmMapper)
// 字段: id, name, phone, address, industry, source, level, status, remark, owner_user_id
// 联系人信息已迁移到 crm_contact 表 (独立的"联系人管理"页面维护)
const LEVEL_TAG = { normal: 'default', vip: 'gold', strategic: 'magenta' }
const STATUS_TAG = { active: 'green', inactive: 'default' }

export default function CustomerManagement({ user, companies = [] }) {
  const { t } = useTranslation()
  const isSuperAdmin = isSuperAdminFn(user)
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id || user?.companyId || 0)
  const effectiveCompanyId = isSuperAdmin ? (selectedCompanyId || 0) : user?.companyId

  const [customers, setCustomers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form] = Form.useForm()
  const [editing, setEditing] = useState(null)
  const [colWidths, setColWidths] = useState({
    name: 160, industry: 120, source: 100, level: 90, status: 90, phone: 140, address: 200, action: 160,
  })
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [batchDeleting, setBatchDeleting] = useState(false)

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, size: pageSize, keyword: keyword || undefined, companyId: effectiveCompanyId || 0 }
      const res = await api.get('/erp/customers', { params })
      // 后端返回 {data:{data:[...], total}} 或 {data:{customers:[...], total}}
      const body = res.data?.data || res.data || {}
      setCustomers(body.data || body.customers || [])
      setTotal(body.total || 0)
    } catch (e) {
      message.error('加载客户失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, effectiveCompanyId])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setShowModal(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      name: record.name,
      industry: record.industry,
      source: record.source,
      level: record.level,
      status: record.status,
      phone: record.phone,
      address: record.address,
      remark: record.remark,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const body = { ...values, companyId: effectiveCompanyId || 0 }
      if (editing) {
        // 兼容: editing.id 或 editing.customerId (后端返回可能含两者)
        const id = editing.id || editing.customerId
        await api.put(`/erp/customers/${id}`, body)
        message.success('已更新')
      } else {
        await api.post('/erp/customers', body)
        message.success('已创建')
      }
      setShowModal(false)
      fetchCustomers()
    } catch (e) {
      if (e.errorFields) return
      message.error(e.response?.data?.error || '操作失败')
    }
  }

  const handleDelete = async (record) => {
    try {
      const id = record.id || record.customerId
      await api.delete(`/erp/customers/${id}`, { params: { companyId: effectiveCompanyId || 0 } })
      message.success('已删除')
      fetchCustomers()
    } catch (e) {
      message.error(e.response?.data?.error || '删除失败')
    }
  }

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) { message.warning('请先勾选要删除的客户'); return }
    setBatchDeleting(true)
    try {
      const res = await api.post('/erp/customers/batch-delete', { customerIds: selectedRowKeys })
      const result = res.data?.data || res.data || {}
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (deleted > 0 && skipped === 0) message.success(`已批量删除 ${deleted} 个客户`)
      else if (deleted > 0 && skipped > 0) message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个`)
      else if (deleted === 0 && skipped > 0) message.error(`未能删除任何客户, 跳过 ${skipped} 个`)
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
      fetchCustomers()
    } catch (e) {
      message.error('批量删除失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setBatchDeleting(false)
    }
  }

  const handleResize = (key) => (e, { size }) => {
    setColWidths(prev => ({ ...prev, [key]: size.width }))
  }

  const mergedColumns = [
    { title: '客户名称', dataIndex: 'name', key: 'name', width: colWidths.name,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('name') }) },
    { title: '行业', dataIndex: 'industry', key: 'industry', width: colWidths.industry,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('industry') }) },
    { title: '来源', dataIndex: 'source', key: 'source', width: colWidths.source,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('source') }) },
    { title: '等级', dataIndex: 'level', key: 'level', width: colWidths.level,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('level') }),
      render: v => v ? <Tag color={LEVEL_TAG[v] || 'default'}>{v}</Tag> : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: colWidths.status,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('status') }),
      render: v => v ? <Tag color={STATUS_TAG[v] || 'default'}>{v}</Tag> : '-' },
    { title: '电话', dataIndex: 'phone', key: 'phone', width: colWidths.phone,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('phone') }) },
    { title: '地址', dataIndex: 'address', key: 'address', width: colWidths.address, ellipsis: true,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('address') }) },
    {
      title: '操作', key: 'action', width: colWidths.action,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('action') }),
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除该客户?" onConfirm={() => handleDelete(record)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Space>
            <Input.Search
              placeholder="搜索客户名称/电话"
              value={keyword} onChange={e => setKeyword(e.target.value)}
              onSearch={() => { setPage(1); fetchCustomers() }}
              style={{ width: 320 }} allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={fetchCustomers}>刷新</Button>
            {isSuperAdmin && companies.length > 0 && (
              <Select
                value={selectedCompanyId}
                onChange={v => { setSelectedCompanyId(v); setPage(1) }}
                style={{ width: 180 }}
                placeholder="选择公司"
              >
                {companies.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
              </Select>
            )}
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确认批量删除选中的 ${selectedRowKeys.length} 个客户？`}
                onConfirm={handleBatchDelete}
                okText="删除" cancelText="取消"
                okButtonProps={{ danger: true, loading: batchDeleting }}
              >
                <Button danger icon={<DeleteOutlined />} loading={batchDeleting}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增客户</Button>
        </div>

        <Table
          dataSource={customers} columns={mergedColumns} rowKey={r => r.id || r.customerId} loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) }}}
          components={{ header: { cell: ResizableTitle } }}
          scroll={{ x: 'max-content' }}
          style={{ background: 'transparent' }}
          locale={{ emptyText: '暂无数据' }}
        />

        <Modal
          title={editing ? '编辑客户' : '新增客户'}
          open={showModal} onCancel={() => setShowModal(false)} onOk={handleSave}
          width={560}
        >
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="客户名称" rules={[{ required: true, message: '请输入客户名称' }]}>
              <Input />
            </Form.Item>
            <Space style={{ display: 'flex' }} >
              <Form.Item name="industry" label="行业" style={{ flex: 1, marginRight: 8 }}>
                <Input placeholder="如: 电子/汽车/医疗" />
              </Form.Item>
              <Form.Item name="source" label="来源" style={{ flex: 1 }}>
                <Input placeholder="如: 展会/转介绍/广告" />
              </Form.Item>
            </Space>
            <Space style={{ display: 'flex' }} >
              <Form.Item name="level" label="等级" style={{ flex: 1, marginRight: 8 }}>
                <Select placeholder="选择等级" allowClear>
                  <Select.Option value="normal">普通</Select.Option>
                  <Select.Option value="vip">VIP</Select.Option>
                  <Select.Option value="strategic">战略</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="status" label="状态" style={{ flex: 1 }}>
                <Select placeholder="选择状态" allowClear>
                  <Select.Option value="active">活跃</Select.Option>
                  <Select.Option value="inactive">停用</Select.Option>
                </Select>
              </Form.Item>
            </Space>
            <Form.Item name="phone" label="电话">
              <Input />
            </Form.Item>
            <Form.Item name="address" label="地址">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
