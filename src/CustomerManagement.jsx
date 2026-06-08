import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Tag, Space, message, Popconfirm, Typography } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { Resizable } from 'react-resizable'
import 'react-resizable/css/styles.css'
import api from './auth'
import { useTranslation } from 'react-i18next'

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

export default function CustomerManagement({ user, companies = [] }) {
  const { t } = useTranslation()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

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
    name: 160, contactPerson: 120, phone: 140, email: 200, address: 200, action: 160,
  })

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, size: pageSize, keyword: keyword || undefined }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/customers', { params })
      setCustomers(res.data.customers || [])
      setTotal(res.data.total || 0)
    } catch (e) {
      message.error('加载客户失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, effectiveCompanyId, isSuperAdmin])

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
      contactPerson: record.contactPerson,
      phone: record.phone,
      email: record.email,
      address: record.address,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const body = {
        name: values.name,
        contactPerson: values.contactPerson || null,
        phone: values.phone || null,
        email: values.email || null,
        address: values.address || null,
      }
      if (editing) {
        await api.put(`/erp/customers/${editing.customerId}`, body)
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

  const handleDelete = async (id) => {
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      await api.delete(`/erp/customers/${id}`, { params })
      message.success('已删除')
      fetchCustomers()
    } catch (e) {
      message.error(e.response?.data?.error || '删除失败')
    }
  }

  const handleResize = (key) => (e, { size }) => {
    setColWidths(prev => ({ ...prev, [key]: size.width }))
  }

  const mergedColumns = [
    { title: t('erp.customerName'), dataIndex: 'name', key: 'name', width: colWidths.name,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('name') }) },
    { title: t('erp.contactPerson'), dataIndex: 'contactPerson', key: 'contactPerson', width: colWidths.contactPerson,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('contactPerson') }) },
    { title: t('erp.phone'), dataIndex: 'phone', key: 'phone', width: colWidths.phone,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('phone') }) },
    { title: t('erp.email'), dataIndex: 'email', key: 'email', width: colWidths.email, ellipsis: true,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('email') }) },
    { title: t('erp.address'), dataIndex: 'address', key: 'address', width: colWidths.address, ellipsis: true,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('address') }) },
    {
      title: t('erp.action.title'), key: 'action', width: colWidths.action,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('action') }),
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>{t('erp.action.edit')}</Button>
          <Popconfirm title={t('erp.action.confirmDelete')} onConfirm={() => handleDelete(record.customerId)}>
            <Button size="small" danger icon={<DeleteOutlined />}>{t('erp.action.delete')}</Button>
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
              placeholder={t('erp.searchCustomer')}
              value={keyword} onChange={e => setKeyword(e.target.value)}
              onSearch={() => { setPage(1); fetchCustomers() }}
              style={{ width: 320 }} allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={fetchCustomers}>{t('erp.action.refresh')}</Button>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('erp.action.createCustomer')}</Button>
        </div>

        <Table
          dataSource={customers} columns={mergedColumns} rowKey="customerId" loading={loading}
          pagination={{ current: page, pageSize, total, showSizeChanger: true,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) }}}
          components={{ header: { cell: ResizableTitle } }}
          scroll={{ x: 'max-content' }}
          style={{ background: 'transparent' }}
          locale={{ emptyText: t('erp.noData') }}
        />

        <Modal
          title={editing ? t('erp.action.editCustomer') : t('erp.action.createCustomer')}
          open={showModal} onCancel={() => setShowModal(false)} onOk={handleSave}
          width={500}
        >
          <Form form={form} layout="vertical">
            <Form.Item name="name" label={t('erp.customerName')} rules={[{ required: true, message: t('erp.validation.required') }]}>
              <Input />
            </Form.Item>
            <Form.Item name="contactPerson" label={t('erp.contactPerson')}>
              <Input />
            </Form.Item>
            <Form.Item name="phone" label={t('erp.phone')}>
              <Input />
            </Form.Item>
            <Form.Item name="email" label={t('erp.email')}>
              <Input type="email" />
            </Form.Item>
            <Form.Item name="address" label={t('erp.address')}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
