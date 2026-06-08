import React, { useState, useEffect, useCallback } from 'react'
import { Table, Button, Modal, Form, Input, Space, message, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import api from './auth'

export default function SupplierManagement({ user, companies = [] }) {
  const [suppliers, setSuppliers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()

  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? (null) : user?.companyId

  const fetchSuppliers = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params = { page: p, size: 20 }
      if (keyword) params.keyword = keyword
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/suppliers', { params })
      setSuppliers(res.data.suppliers || [])
      setTotal(res.data.total || 0)
    } catch (e) { message.error('加载供应商列表失败') }
    finally { setLoading(false) }
  }, [keyword, isSuperAdmin, effectiveCompanyId])

  useEffect(() => { fetchSuppliers(page) }, [page, fetchSuppliers])

  const handleSearch = (value) => {
    setKeyword(value)
    setPage(1)
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setShowModal(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue(record)
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      if (editing) {
        await api.put(`/erp/suppliers/${editing.supplierId}`, values)
        message.success('已更新')
      } else {
        await api.post('/erp/suppliers', values)
        message.success('已创建')
      }
      setShowModal(false)
      setEditing(null)
      form.resetFields()
      fetchSuppliers(page)
    } catch (e) {
      if (!e.errorFields) message.error('保存失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/erp/suppliers/${id}`)
      message.success('已删除')
      fetchSuppliers(page)
    } catch (e) { message.error('删除失败') }
  }

  const columns = [
    { title: '供应商名称', dataIndex: 'name', width: 180 },
    { title: '联系人', dataIndex: 'contactPerson', width: 120 },
    { title: '电话', dataIndex: 'phone', width: 140 },
    { title: '邮箱', dataIndex: 'email', width: 180, ellipsis: true },
    { title: '地址', dataIndex: 'address', ellipsis: true },
    {
      title: '操作', key: 'actions', width: 100,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="确定删除此供应商?" onConfirm={() => handleDelete(record.supplierId)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    },
  ]

  return (
    <div style={{ padding: '16px 24px', height: '100%', display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: '#e8eaed', margin: 0 }}>供应商管理</h2>
        <Space>
          <Input.Search placeholder="搜索供应商" allowClear onSearch={handleSearch} style={{ width: 220 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加供应商</Button>
          <Button icon={<ReloadOutlined />} onClick={() => fetchSuppliers(page)}>刷新</Button>
        </Space>
      </div>
      <Table
        dataSource={suppliers} columns={columns} rowKey="supplierId" loading={loading}
        size="small" scroll={{ x: 800 }}
        pagination={{
          current: page, pageSize: 20, total,
          onChange: setPage,
          showTotal: t => `共 ${t} 条`
        }}
        style={{ background: 'transparent' }}
      />
      <Modal
        title={editing ? '修改供应商' : '添加供应商'}
        open={showModal}
        onOk={handleSave}
        onCancel={() => { setShowModal(false); setEditing(null); form.resetFields() }}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="如 台电、村田、国巨" />
          </Form.Item>
          <Form.Item name="contactPerson" label="联系人">
            <Input placeholder="联系人姓名" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="联系电话" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="电子邮箱" />
          </Form.Item>
          <Form.Item name="address" label="地址">
            <Input placeholder="详细地址" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
