import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Menu, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Tabs, InputNumber, Checkbox } from 'antd'
import { ShopOutlined, AuditOutlined, EditOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import api from './auth'
import { isSuperAdmin as isSuperAdminFn, isCompanyAdmin as isCompanyAdminFn } from './utils/permissions.js'

const { Sider, Content } = Layout

export default function ErpManagement({ user, companies = [] }) {
  const [tables, setTables] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [fields, setFields] = useState([])
  const [activeTab, setActiveTab] = useState('structure')
  const [editingField, setEditingField] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLoading, setAuditLoading] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState(null)

  const isSuperAdmin = isSuperAdminFn(user)
  const effectiveCompanyId = isSuperAdmin ? (selectedCompanyId || 0) : user?.companyId

  // ── Fetch table names ──────────────────────────────────────────
  const fetchTables = useCallback(async () => {
    try {
      const params = isSuperAdmin && selectedCompanyId ? { companyId: selectedCompanyId } : {}
      const res = await api.get('/erp/admin/tables', { params })
      setTables(res.data?.data?.tables || res.data?.tables || [])
    } catch (e) { console.error('Failed to fetch tables', e) }
  }, [isSuperAdmin, selectedCompanyId])

  useEffect(() => { fetchTables() }, [fetchTables])

  // ── Fetch fields when table selected ──────────────────────────
  const fetchFields = useCallback(async (tableName) => {
    try {
      const params = isSuperAdmin && selectedCompanyId ? { companyId: selectedCompanyId } : {}
      const res = await api.get(`/erp/admin/tables/${tableName}/fields`, { params })
      setFields(res.data?.data?.fields || res.data?.fields || [])
    } catch (e) { console.error('Failed to fetch fields', e) }
  }, [isSuperAdmin, selectedCompanyId])

  // ── Fetch audit logs ───────────────────────────────────────────
  const fetchAuditLogs = useCallback(async (p = 1) => {
    setAuditLoading(true)
    try {
      const params = { limit: 50, page: p }
      const res = await api.get('/erp/admin/audit-logs/my-company', { params })
      const auditPayload = res.data?.data || res.data || {}
      setAuditLogs(auditPayload.logs || [])
      setAuditTotal(auditPayload.total || 0)
    } catch (e) { message.error('加载审计日志失败') }
    finally { setAuditLoading(false) }
  }, [])

  // ── When table changes ─────────────────────────────────────────
  const handleSelectTable = (tableName) => {
    setSelectedTable(tableName)
    fetchFields(tableName)
  }

  useEffect(() => {
    if (activeTab === 'audit') fetchAuditLogs(1)
  }, [activeTab])

  // ── Save field metadata ────────────────────────────────────────
  const handleSaveField = async (values) => {
    try {
      const payload = {
        ...values,
        id: editingField?.id || null,
        tableName: selectedTable,
        companyId: effectiveCompanyId || 0
      }
      await api.post('/erp/admin/tables/fields', payload)
      message.success('字段已保存')
      setEditingField(null)
      fetchFields(selectedTable)
    } catch (e) { message.error('保存失败') }
  }

  const handleDeleteField = async (id) => {
    try {
      await api.delete(`/erp/admin/tables/fields/${id}`)
      message.success('字段已删除')
      fetchFields(selectedTable)
    } catch (e) { message.error('删除失败') }
  }

  const isAdmin = isSuperAdminFn(user) || isCompanyAdminFn(user)

  // ── Helpers ────────────────────────────────────────────────────
  const getTableIcon = (tableName) => {
    if (tableName?.includes('audit')) return <AuditOutlined />
    if (tableName?.includes('metadata')) return <EditOutlined />
    return <EditOutlined />
  }

  // ── Audit log columns ──────────────────────────────────────────
  const auditColumns = [
    { title: '时间', dataIndex: 'createdAt', width: 160, render: v => v?.substring(0, 19) },
    { title: '表名', dataIndex: 'tableName', width: 160 },
    { title: '操作', dataIndex: 'operation', width: 100, render: v => <Tag>{v}</Tag> },
    { title: '记录ID', dataIndex: 'recordId', width: 80 },
    { title: '详情', dataIndex: 'details', ellipsis: true },
    { title: '操作员', dataIndex: 'operatorName', width: 100 },
  ]

  return (
    <Layout style={{ background: '#0d1117', height: '100%', minHeight: 0 }}>
      {/* ── Left sidebar: Tables ── */}
      <Sider width={240} style={{ background: '#111', borderRight: '1px solid #1f1f1f', overflow: 'auto' }}>
        <div style={{ padding: '12px' }}>
          {isSuperAdmin && (
            <Select
              placeholder="选择公司" allowClear style={{ width: '100%', marginBottom: 12 }}
              value={selectedCompanyId}
              onChange={(v) => { setSelectedCompanyId(v); fetchTables(); }}
              options={(companies || []).map(c => ({ label: c.name, value: c.id }))}
            />
          )}
          <div style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
            ERP 数据表
          </div>
          <Menu
            mode="inline" theme="dark"
            selectedKeys={selectedTable ? [selectedTable] : []}
            onClick={({ key }) => handleSelectTable(key)}
            items={tables.map(t => ({ key: t, icon: getTableIcon(t), label: t }))}
            style={{ background: 'transparent', border: 'none' }}
          />
          <div style={{ marginTop: 16, padding: '8px 12px', background: '#1a1a1a', borderRadius: 6, fontSize: 12, color: '#888', lineHeight: 1.6 }}>
            业务数据管理请使用左侧菜单的
            <br /><strong>物料管理 / 客户管理 / 入库单管理 / 出库单管理</strong>
            <br />页面操作。
          </div>
        </div>
      </Sider>

      {/* ── Main content ── */}
      <Content style={{ padding: '16px 24px', overflow: 'auto', background: '#0d1117' }}>
        {!selectedTable ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#555' }}>
            <ShopOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <h3 style={{ color: '#888' }}>请选择一个数据表查看表结构</h3>
            {isSuperAdmin && <p style={{ color: '#555' }}>SUPER_ADMIN 请先选择要管理的公司</p>}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ color: '#e8eaed', margin: 0 }}>{selectedTable}</h2>
              <Space>
                <Tabs
                  activeKey={activeTab} onChange={setActiveTab}
                  items={[
                    { key: 'structure', label: '🔧 表结构' },
                    { key: 'audit', label: '📝 审计日志' },
                  ]}
                  style={{ marginBottom: 0 }}
                />
              </Space>
            </div>

            {/* ── Structure tab ── */}
            {activeTab === 'structure' && (
              <>
                {isAdmin && (
                  <div style={{ marginBottom: 12 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditingField({})}>
                      添加字段描述
                    </Button>
                  </div>
                )}
                <Table
                  dataSource={fields} rowKey="id"
                  size="small" pagination={false}
                  style={{ background: '#0d1117' }}
                  columns={[
                    { title: '字段名', dataIndex: 'fieldName', width: 160 },
                    { title: '类型', dataIndex: 'fieldType', width: 120 },
                    { title: '显示标签', dataIndex: 'fieldLabel', width: 140 },
                    { title: '描述', dataIndex: 'description', ellipsis: true },
                    { title: '排序', dataIndex: 'sortOrder', width: 60 },
                    { title: '必填', dataIndex: 'required', width: 60, render: v => v ? '✅' : '' },
                    ...(isAdmin ? [{
                      title: '操作', key: 'actions', width: 120,
                      render: (_, record) => (
                        <Space>
                          <Button size="small" icon={<EditOutlined />} onClick={() => setEditingField(record)} />
                          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteField(record.id)} />
                        </Space>
                      )
                    }] : [])
                  ]}
                />

                {/* ── Field editor modal ── */}
                <Modal
                  title={editingField?.id ? '修改字段描述' : '添加字段描述'}
                  open={!!editingField}
                  onCancel={() => setEditingField(null)}
                  onOk={() => { if (editingField) handleSaveField(editingField) } }
                  okText="应用"
                >
                  {editingField && (
                    <Form layout="vertical">
                      <Form.Item label="字段名 (field_name)">
                        <Input value={editingField.fieldName || ''}
                          onChange={e => setEditingField({ ...editingField, fieldName: e.target.value })}
                          placeholder="如 part_type" />
                      </Form.Item>
                      <Form.Item label="类型 (field_type)">
                        <Input value={editingField.fieldType || ''}
                          onChange={e => setEditingField({ ...editingField, fieldType: e.target.value })}
                          placeholder="如 VARCHAR(32), JSON, DECIMAL(12,4)" />
                      </Form.Item>
                      <Form.Item label="显示标签 (field_label)">
                        <Input value={editingField.fieldLabel || ''}
                          onChange={e => setEditingField({ ...editingField, fieldLabel: e.target.value })}
                          placeholder="如 品类" />
                      </Form.Item>
                      <Form.Item label="描述 (description)">
                        <Input.TextArea rows={3} value={editingField.description || ''}
                          onChange={e => setEditingField({ ...editingField, description: e.target.value })}
                          placeholder="字段说明，供LLM理解" />
                      </Form.Item>
                      <Space>
                        <Form.Item label="排序">
                          <InputNumber value={editingField.sortOrder || 0}
                            onChange={v => setEditingField({ ...editingField, sortOrder: v })} />
                        </Form.Item>
                        <Form.Item label="必填">
                          <Checkbox checked={editingField.required || false}
                            onChange={e => setEditingField({ ...editingField, required: e.target.checked })} />
                        </Form.Item>
                      </Space>
                    </Form>
                  )}
                </Modal>
              </>
            )}

            {/* ── Audit tab ── */}
            {activeTab === 'audit' && (
              <Table
                dataSource={auditLogs} columns={auditColumns} loading={auditLoading}
                rowKey="id" size="small" scroll={{ x: 800 }}
                pagination={{
                  current: auditPage, pageSize: 50, total: auditTotal,
                  onChange: (p) => { setAuditPage(p); fetchAuditLogs(p); },
                  showTotal: t => `共 ${t} 条`
                }}
              />
            )}
          </>
        )}
      </Content>
    </Layout>
  )
}
