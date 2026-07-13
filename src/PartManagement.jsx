import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, Row, Col, InputNumber, Typography } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { Resizable } from 'react-resizable'
import 'react-resizable/css/styles.css'
import api from './auth'
import { useTranslation } from 'react-i18next'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js'

const { Content } = Layout
const { Text } = Typography
const { TextArea } = Input

const DEFAULT_PART_TYPES = ['电容', '电感', '磁珠', '电阻', 'PCB板材', 'IC', '二极管', '三极管', '晶振', '连接器', '继电器', '保险丝', '传感器', '变压器', '其他']

const ResizableTitle = (props) => {
  const { onResize, width, ...restProps } = props
  if (!width) return <th {...restProps} />
  return (
    <Resizable width={width} height={0} onResize={onResize} draggableOpts={{ enableUserSelectHack: false }}>
      <th {...restProps} />
    </Resizable>
  )
}

export default function PartManagement({ user, companies = [] }) {
  const { t } = useTranslation()
  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [parts, setParts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form] = Form.useForm()
  const [editing, setEditing] = useState(null)
  const [partTypes, setPartTypes] = useState(DEFAULT_PART_TYPES)
  const [colWidths, setColWidths] = useState({
    partType: 100, userPartModel: 180, manufacturer: 140,
    specsJson: 200, description: 160, minPackageQty: 80, action: 120,
  })

  const fetchParts = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, size: pageSize, keyword: keyword || undefined }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/parts', { params })
      const partPayload = res.data?.data || res.data || {}
      const fetched = partPayload.parts || []
      setParts(fetched)
      setTotal(partPayload.total || 0)
      const types = [...new Set([...DEFAULT_PART_TYPES, ...fetched.map(p => p.partType).filter(Boolean)])]
      setPartTypes(types)
    } catch (e) {
      message.error('加载物料失败: ' + (e.response?.data?.error || e.message))
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, effectiveCompanyId, isSuperAdmin])

  useEffect(() => { fetchParts() }, [fetchParts])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ specsEntries: [{ key: '', value: '' }] })
    setShowModal(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    let specsEntries = [{ key: '', value: '' }]
    if (record.specsJson) {
      try {
        const obj = JSON.parse(record.specsJson)
        specsEntries = Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }))
      } catch (e) {
        specsEntries = [{ key: '', value: '' }]
      }
    }
    form.setFieldsValue({
      partType: record.partType,
      userPartModel: record.userPartModel,
      manufacturer: record.manufacturer,
      specsEntries: specsEntries,
      description: record.description,
      minPackageQty: record.minPackageQty,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const specsObj = {}
      const entries = values.specsEntries || []
      entries.forEach(e => {
        if (e && e.key) {
          specsObj[e.key] = e.value || ''
        }
      })
      const specsJson = Object.keys(specsObj).length > 0 ? JSON.stringify(specsObj) : null
      const body = {
        partType: values.partType,
        userPartModel: values.userPartModel,
        manufacturer: values.manufacturer,
        specsJson: specsJson,
        description: values.description || null,
        minPackageQty: values.minPackageQty || 0,
      }
      if (editing) {
        await api.put(`/erp/parts/${editing.partId}`, body)
        message.success('已更新')
      } else {
        await api.post('/erp/parts', body)
        message.success('已创建')
      }
      setShowModal(false)
      fetchParts()
    } catch (e) {
      if (e.errorFields) return
      message.error(e.response?.data?.error || '操作失败')
    }
  }

  const handleDelete = async (id) => {
    try {
      const params = {}
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      await api.delete(`/erp/parts/${id}`, { params })
      message.success('已删除')
      fetchParts()
    } catch (e) {
      message.error(e.response?.data?.error || '删除失败')
    }
  }

  const handleResize = (key) => (e, { size }) => {
    setColWidths(prev => ({ ...prev, [key]: size.width }))
  }

  const mergedColumns = [
    { title: t('erp.partType'), dataIndex: 'partType', key: 'partType', width: colWidths.partType,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('partType') }),
      render: v => <Tag>{v}</Tag> },
    { title: t('erp.partModel'), dataIndex: 'userPartModel', key: 'userPartModel', width: colWidths.userPartModel,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('userPartModel') }) },
    { title: t('erp.manufacturer'), dataIndex: 'manufacturer', key: 'manufacturer', width: colWidths.manufacturer,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('manufacturer') }) },
    { title: t('erp.specs'), dataIndex: 'specsJson', key: 'specsJson', width: colWidths.specsJson, ellipsis: true,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('specsJson') }),
      render: v => v ? <Text code style={{ fontSize: 12 }}>{v.length > 60 ? v.slice(0, 60) + '...' : v}</Text> : '-' },
    { title: t('erp.description'), dataIndex: 'description', key: 'description', width: colWidths.description, ellipsis: true,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('description') }) },
    { title: '最小包装', dataIndex: 'minPackageQty', key: 'minPackageQty', width: colWidths.minPackageQty,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('minPackageQty') }),
      render: v => v ? v + ' pcs' : '-' },
    {
      title: t('erp.action.title'), key: 'action', width: colWidths.action,
      onHeaderCell: (col) => ({ width: col.width, onResize: handleResize('action') }),
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>{t('erp.action.edit')}</Button>
          <Popconfirm title={t('erp.action.confirmDelete')} onConfirm={() => handleDelete(record.partId)}>
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
              placeholder={t('erp.searchPart')}
              value={keyword} onChange={e => setKeyword(e.target.value)}
              onSearch={() => { setPage(1); fetchParts() }}
              style={{ width: 320 }} allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={fetchParts}>{t('erp.action.refresh')}</Button>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('erp.action.createPart')}</Button>
        </div>

        <Table
          dataSource={parts} columns={mergedColumns} rowKey="partId" loading={loading}
          pagination={{ current: page, pageSize, total, showSizeChanger: true,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) }}}
          components={{ header: { cell: ResizableTitle } }}
          scroll={{ x: 'max-content' }}
          style={{ background: 'transparent' }}
          locale={{ emptyText: t('erp.noData') }}
        />

        <Modal
          title={editing ? t('erp.action.editPart') : t('erp.action.createPart')}
          open={showModal} onCancel={() => setShowModal(false)} onOk={handleSave}
          width={600}
        >
          <Form form={form} layout="vertical">
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="partType" label={t('erp.partType')} rules={[{ required: true }]}>
                  <Select>
                    {partTypes.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="userPartModel" label={t('erp.partModel')} rules={[{ required: true }]}>
                  <Input placeholder="e.g. CL21A106KAYNNNE" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="manufacturer" label={t('erp.manufacturer')}>
                  <Input placeholder="e.g. Samsung" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label={t('erp.specs')}>
              <Form.List name="specsEntries">
                {(fields, { add, remove }) => (
                  <div>
                    {fields.map(({ key, name, ...restField }) => (
                      <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                        <Form.Item {...restField} name={[name, 'key']} rules={[{ required: true, message: '请输入规格名' }]} style={{ marginBottom: 0 }}>
                          <Input placeholder="规格名" style={{ width: 140, background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
                        </Form.Item>
                        <span style={{ color: '#555' }}>=</span>
                        <Form.Item {...restField} name={[name, 'value']} style={{ marginBottom: 0 }}>
                          <Input placeholder="规格值" style={{ width: 200, background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
                        </Form.Item>
                        <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                      </Space>
                    ))}
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ borderColor: '#333', color: '#888' }}>
                      添加规格
                    </Button>
                  </div>
                )}
              </Form.List>
            </Form.Item>
            <Form.Item name="minPackageQty" label="最小包装数量">
              <InputNumber min={0} style={{ width: 200 }} placeholder="0" />
            </Form.Item>
            <Form.Item name="description" label={t('erp.description')}>
              <TextArea rows={2} />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
