import React, { useState, useEffect } from 'react'
import { Layout, Upload, Button, Table, message, Card, Row, Col, Select, Space, Statistic, Alert } from 'antd'
import { UploadOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons'
import api from './auth'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const { Content } = Layout
const { Dragger } = Upload

export default function ImportProductRelation({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState(null)
  const [fileList, setFileList] = useState([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const params = {}
        if (effectiveCompanyId) params.companyId = effectiveCompanyId
        const res = await api.get('/erp/customers', { params })
        const custPayload = res.data?.data || res.data || {}
        setCustomers(custPayload.customers || [])
      } catch (e) { /* ignore */ }
    })()
  }, [effectiveCompanyId])

  const handleImport = async () => {
    if (!customerId) { message.warning('请先选择客户'); return }
    if (fileList.length === 0) { message.warning('请先上传文件'); return }

    setImporting(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', fileList[0].originFileObj)
      formData.append('customerId', customerId)
      const res = await api.post('/erp/customer-part-mappings/import-excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setResult(res.data)
      message.success('导入完成')
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    { title: '客户料号', dataIndex: 'customerPartNo', key: 'no' },
    { title: '物料型号', dataIndex: 'partModel', key: 'model' },
    { title: '品类', dataIndex: 'partType', key: 'type' },
    { title: '厂家', dataIndex: 'manufacturer', key: 'mfr' },
  ]

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, maxWidth: 800, margin: '0 auto', height: '100%', overflow: 'auto' }}>
        <h2 style={{ color: '#e3e3e3', marginBottom: 24 }}>导入客户料号关系表</h2>

        <Card size="small" style={{ marginBottom: 16, background: '#141414', border: '1px solid #222' }}>
          <div style={{ color: '#ccc', marginBottom: 12, fontSize: 13 }}>
            上传 <b>product_relation.xlsx</b> 文件，系统将自动匹配物料型号并建立客户料号映射关系。
          </div>
          <div style={{ color: '#888', marginBottom: 16, fontSize: 12 }}>
            表头格式要求: 物料编码(客户料号) | 物料型号(原厂型号) | 产品类别 | 最小包装
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <div style={{ color: '#aaa', marginBottom: 4, fontSize: 12 }}>选择客户</div>
              <Select
                placeholder="选择目标客户"
                style={{ width: '100%' }}
                value={customerId}
                onChange={setCustomerId}
                options={customers.map(c => ({ value: c.customerId, label: c.name }))}
              />
            </Col>
          </Row>
        </Card>

        <Dragger
          accept=".xlsx,.xls"
          fileList={fileList}
          onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
          beforeUpload={() => false}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 Excel 文件到此区域</p>
          <p className="ant-upload-hint">支持 .xlsx / .xls 格式</p>
        </Dragger>

        <Space>
          <Button type="primary" loading={importing} icon={<UploadOutlined />} onClick={handleImport}>
            开始导入
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => { setResult(null); setFileList([]) }}>
            重置
          </Button>
        </Space>

        {result && (
          <Card size="small" style={{ marginTop: 24, background: '#141414', border: '1px solid #222' }}>
            <h3 style={{ color: '#e3e3e3', marginBottom: 12 }}>导入结果</h3>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={4}><Statistic title="总行数" value={result.totalRows} valueStyle={{ color: '#ccc' }} /></Col>
              <Col span={5}><Statistic title="成功匹配" value={result.matched} valueStyle={{ color: '#52c41a' }} /></Col>
              <Col span={5}><Statistic title="新建物料" value={result.partsCreated} valueStyle={{ color: '#1677ff' }} /></Col>
              <Col span={5}><Statistic title="跳过重复" value={result.skipped} valueStyle={{ color: '#faad14' }} /></Col>
              <Col span={5}><Statistic title="更新包装数" value={result.qtyUpdated} valueStyle={{ color: '#1677ff' }} /></Col>
            </Row>
            {result.errors?.length > 0 && (
              <Alert type="warning" showIcon message={result.errors.length + ' 个警告'}
                description={result.errors.map((e, i) => <div key={i}>{e}</div>)}
                style={{ marginBottom: 12 }} />
            )}
          </Card>
        )}
      </Content>
    </Layout>
  )
}
