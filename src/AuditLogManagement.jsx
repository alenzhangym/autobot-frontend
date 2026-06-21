import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Card, Row, Col, Tooltip, Typography } from 'antd'
import { ReloadOutlined, SearchOutlined, EyeOutlined, WarningOutlined } from '@ant-design/icons'
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

// Map of common operation types → color
const OP_COLORS = {
  CREATE: 'green', CREATED: 'green', INSERT: 'green',
  UPDATE: 'blue', UPDATED: 'blue', EDIT: 'blue',
  DELETE: 'red', DELETED: 'red',
  INBOUND: 'cyan', OUTBOUND: 'orange',
  SHIP: 'gold', SHIPPED: 'gold', CONFIRMED: 'lime',
  RECEIVED: 'cyan', CANCELLED: 'red', CANCELLED_RECEIVED: 'red',
  COMPLETED: 'green', MANUAL_UPDATE: 'purple',
}

export default function AuditLogManagement({ user }) {
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isCompanyAdmin = user?.role === 'COMPANY_ADMIN' || (user?.role || '').toLowerCase() === 'company_admin'
  const canView = isSuperAdmin || isCompanyAdmin
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [tableName, setTableName] = useState(undefined)
  const [operation, setOperation] = useState(undefined)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selected, setSelected] = useState(null)
  const [colWidths, setColWidths] = useState({
    createdAt: 160, tableName: 200, operation: 110,
    recordId: 100, operatorName: 110, details: 360, action: 80,
  })

  const TABLE_OPTIONS = [
    { value: 'erp_part_master', label: 'erp_part_master' },
    { value: 'erp_supplier_inventory', label: 'erp_supplier_inventory' },
    { value: 'erp_purchase_order', label: 'erp_purchase_order' },
    { value: 'erp_sales_order', label: 'erp_sales_order' },
    { value: 'erp_inbound_order', label: 'erp_inbound_order' },
    { value: 'erp_outbound_order', label: 'erp_outbound_order' },
    { value: 'erp_customer_profile', label: 'erp_customer_profile' },
    { value: 'erp_supplier', label: 'erp_supplier' },
    { value: 'erp_reconciliation', label: 'erp_reconciliation' },
  ]

  const OP_OPTIONS = [
    { value: 'CREATED', label: 'CREATED' },
    { value: 'UPDATED', label: 'UPDATED' },
    { value: 'DELETED', label: 'DELETED' },
    { value: 'INBOUND', label: 'INBOUND' },
    { value: 'OUTBOUND', label: 'OUTBOUND' },
    { value: 'RECEIVED', label: 'RECEIVED' },
    { value: 'SHIPPED', label: 'SHIPPED' },
    { value: 'CONFIRMED', label: 'CONFIRMED' },
    { value: 'COMPLETED', label: 'COMPLETED' },
    { value: 'CANCELLED', label: 'CANCELLED' },
    { value: 'MANUAL_UPDATE', label: 'MANUAL_UPDATE' },
  ]

  const fetchLogs = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    try {
      const params = {
        page, size: pageSize,
        keyword: keyword || undefined,
        tableName, operation,
      }
      if (isSuperAdmin && effectiveCompanyId) params.companyId = effectiveCompanyId
      const res = await api.get('/erp/audit-logs', { params })
      // Handle ApiResult wrapper: { code, message, data }
      const apiData = res.data?.data || res.data || {}
      setRows(Array.isArray(apiData) ? apiData : (apiData.data || []))
      setTotal(apiData.count || 0)
    } catch (e) {
      if (e.response?.status === 403) {
        message.error('需要管理员权限才能访问')
      } else {
        message.error('加载审计日志失败: ' + (e.response?.data?.error || e.message))
      }
      setRows([])
    } finally { setLoading(false) }
  }, [page, pageSize, keyword, tableName, operation, effectiveCompanyId, isSuperAdmin, canView])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const openDetail = (r) => {
    setSelected(r)
    setShowDetailModal(true)
  }

  const columns = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: colWidths.createdAt,
      render: v => v ? <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleString('zh-CN')}</Text> : '-',
      sorter: false, defaultSortOrder: 'descend',
    },
    { title: '表', dataIndex: 'tableName', key: 'tableName', width: colWidths.tableName,
      render: v => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : '-' },
    { title: '操作', dataIndex: 'operation', key: 'operation', width: colWidths.operation,
      render: v => <Tag color={OP_COLORS[v] || 'default'}>{v || '-'}</Tag> },
    { title: '记录ID', dataIndex: 'recordId', key: 'recordId', width: colWidths.recordId,
      render: v => v || '-' },
    { title: '操作人', dataIndex: 'operatorName', key: 'operatorName', width: colWidths.operatorName,
      render: v => v || '-' },
    { title: '详情', dataIndex: 'details', key: 'details', width: colWidths.details,
      ellipsis: true,
      render: v => v ? <Text style={{ fontSize: 12 }}>{v}</Text> : '-' },
    { title: '操作', key: 'action', width: colWidths.action, fixed: 'right',
      render: (_, r) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)}>详情</Button>
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

  if (!canView) {
    return (
      <Layout style={{ background: '#0d0d0d', height: '100%' }}>
        <Content style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: '#ff4d4f', fontSize: 16, marginTop: 60 }}>
            <WarningOutlined style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            审计日志仅对公司管理员 (COMPANY_ADMIN) 开放
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
          <Col><h2 style={{ color: '#e3e3e3', margin: 0 }}>审计日志</h2></Col>
          <Col><Space>
            <Button icon={<ReloadOutlined />} onClick={fetchLogs}>刷新</Button>
          </Space></Col>
        </Row>

        <Card size="small" style={{ marginBottom: 16, background: '#141414', border: '1px solid #222' }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Input
                placeholder="搜索详情/记录ID/操作人"
                allowClear
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onPressEnter={() => { setPage(1); fetchLogs() }}
              />
            </Col>
            <Col xs={12} md={6}>
              <Select
                placeholder="按表名过滤"
                allowClear
                value={tableName}
                onChange={v => { setTableName(v); setPage(1); }}
                options={TABLE_OPTIONS}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} md={6}>
              <Select
                placeholder="按操作类型过滤"
                allowClear
                value={operation}
                onChange={v => { setOperation(v); setPage(1); }}
                options={OP_OPTIONS}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} md={4}>
              <Button type="primary" icon={<SearchOutlined />} block onClick={() => { setPage(1); fetchLogs() }}>搜索</Button>
            </Col>
          </Row>
        </Card>

        <Table
          dataSource={rows}
          columns={colsWithResize}
          rowKey="id"
          loading={loading}
          components={components}
          scroll={{ x: 1200 }}
          size="small"
          pagination={{
            current: page, pageSize, total, showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100', '200'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />

        <Modal
          title="审计日志详情"
          open={showDetailModal}
          onCancel={() => setShowDetailModal(false)}
          footer={[<Button key="close" onClick={() => setShowDetailModal(false)}>关闭</Button>]}
          width={760}
        >
          {selected && (
            <div style={{ fontSize: 13 }}>
              <Row gutter={[12, 8]}>
                <Col span={6}><Text type="secondary">时间</Text></Col>
                <Col span={18}>{selected.createdAt ? new Date(selected.createdAt).toLocaleString('zh-CN') : '-'}</Col>
                <Col span={6}><Text type="secondary">表</Text></Col>
                <Col span={18}><Text code>{selected.tableName}</Text></Col>
                <Col span={6}><Text type="secondary">操作</Text></Col>
                <Col span={18}><Tag color={OP_COLORS[selected.operation] || 'default'}>{selected.operation}</Tag></Col>
                <Col span={6}><Text type="secondary">记录ID</Text></Col>
                <Col span={18}>{selected.recordId || '-'}</Col>
                <Col span={6}><Text type="secondary">操作人</Text></Col>
                <Col span={18}>{selected.operatorName || '-'} (ID: {selected.operatorId || '-'})</Col>
                <Col span={6}><Text type="secondary">Session</Text></Col>
                <Col span={18}><Text type="secondary" style={{ fontSize: 11 }}>{selected.sessionId || '-'}</Text></Col>
              </Row>
              <div style={{ marginTop: 12, padding: 12, background: '#0d0d0d', border: '1px solid #222', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {selected.details || '(无详情)'}
              </div>
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  )
}
