import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm, Row, Col, InputNumber, Typography, Upload, Statistic, Alert } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, MinusCircleOutlined, UploadOutlined, InboxOutlined } from '@ant-design/icons'
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
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFileList, setImportFileList] = useState([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState([])
  const [batchDeleting, setBatchDeleting] = useState(false)
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

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) { message.warning('请先勾选要删除的物料'); return }
    setBatchDeleting(true)
    try {
      const res = await api.post('/erp/parts/batch-delete', { partIds: selectedRowKeys })
      const result = res.data?.data || res.data || {}
      const deleted = result.deleted || 0
      const skipped = result.skipped || 0
      const errors = result.errors || []
      if (deleted > 0 && skipped === 0) {
        message.success(`已批量删除 ${deleted} 个物料`)
      } else if (deleted > 0 && skipped > 0) {
        message.warning(`已删除 ${deleted} 个, 跳过 ${skipped} 个 (存在库存关联或不存在)`)
      } else if (deleted === 0 && skipped > 0) {
        message.error(`未能删除任何物料, 跳过 ${skipped} 个`)
      }
      if (errors.length > 0) {
        Modal.info({
          title: '批量删除详情',
          width: 560,
          content: (
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              <div style={{ marginBottom: 8 }}>成功 {deleted} 个，跳过 {skipped} 个：</div>
              {errors.map((e, i) => <div key={i} style={{ color: '#faad14', fontSize: 12 }}>• {e}</div>)}
            </div>
          )
        })
      }
      setSelectedRowKeys([])
      fetchParts()
    } catch (e) {
      message.error('批量删除失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setBatchDeleting(false)
    }
  }

  const handleImport = async () => {
    if (importFileList.length === 0) { message.warning('请先上传文件'); return }
    setImporting(true)
    setImportResult(null)
    try {
      const formData = new FormData()
      formData.append('file', importFileList[0].originFileObj)
      const res = await api.post('/erp/parts/import-excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setImportResult(res.data?.data || res.data)
      message.success('导入完成')
      fetchParts()
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setImporting(false)
    }
  }

  const openImport = () => {
    setImportFileList([])
    setImportResult(null)
    setShowImportModal(true)
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
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确认批量删除选中的 ${selectedRowKeys.length} 个物料？`}
                description="存在库存关联的物料将自动跳过"
                onConfirm={handleBatchDelete}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: batchDeleting }}
              >
                <Button danger icon={<DeleteOutlined />} loading={batchDeleting}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
          </Space>
          <Space>
            <Button icon={<UploadOutlined />} onClick={openImport}>导入物料</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('erp.action.createPart')}</Button>
          </Space>
        </div>

        <Table
          dataSource={parts} columns={mergedColumns} rowKey="partId" loading={loading}
          pagination={{ current: page, pageSize, total, showSizeChanger: true,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) }}}
          components={{ header: { cell: ResizableTitle } }}
          scroll={{ x: 'max-content' }}
          style={{ background: 'transparent' }}
          locale={{ emptyText: t('erp.noData') }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
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

        {/* 导入物料 Modal — 2列格式: 料号 | 最小包装 */}
        <Modal
          title="导入物料 (料号 / 最小包装)"
          open={showImportModal} onCancel={() => setShowImportModal(false)}
          width={640}
          footer={[
            <Button key="cancel" onClick={() => setShowImportModal(false)}>关闭</Button>,
            <Button key="import" type="primary" loading={importing} icon={<UploadOutlined />}
              onClick={handleImport}>开始导入</Button>,
          ]}
        >
          <Alert
            type="info" showIcon style={{ marginBottom: 12 }}
            message="Excel 表头格式: 料号 | 最小包装"
            description={'第 1 行为表头会被跳过。料号必填；最小包装为空则录入 0；非数字或负数行会被跳过并在结果中提示。物料不存在则新建（类型默认"其他"），已存在则更新最小包装。'}
          />
          <Upload.Dragger
            accept=".xlsx,.xls"
            fileList={importFileList}
            onChange={({ fileList: fl }) => setImportFileList(fl.slice(-1))}
            beforeUpload={() => false}
            style={{ marginBottom: 16 }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 Excel 文件到此区域</p>
            <p className="ant-upload-hint">支持 .xlsx / .xls 格式</p>
          </Upload.Dragger>

          {importResult && (
            <div style={{ marginTop: 8 }}>
              <Row gutter={16} style={{ marginBottom: 12 }}>
                <Col span={6}><Statistic title="总行数" value={importResult.totalRows} valueStyle={{ color: '#ccc' }} /></Col>
                <Col span={6}><Statistic title="新建物料" value={importResult.created} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col span={6}><Statistic title="更新包装" value={importResult.updated} valueStyle={{ color: '#1677ff' }} /></Col>
                <Col span={6}><Statistic title="跳过" value={importResult.skipped} valueStyle={{ color: '#faad14' }} /></Col>
              </Row>
              {importResult.errors?.length > 0 && (
                <Alert type="warning" showIcon
                  message={importResult.errors.length + ' 个警告'}
                  description={importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                />
              )}
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  )
}
