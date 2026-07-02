import React, { useState, useEffect, useCallback } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Tabs, Popconfirm, Tooltip, InputNumber, Switch, Alert } from 'antd'
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, ApiOutlined, ApartmentOutlined, DeploymentUnitOutlined, ThunderboltOutlined } from '@ant-design/icons'
import api from './auth'

const { TextArea } = Input

const STATUS_COLORS = {
  DRAFT: 'default', CONFIRMED: 'processing', SHIPPED: 'success',
  COMPLETED: 'green', CANCELLED: 'red', RECEIVED: 'blue',
  ORDERED: 'cyan', PARTIAL_SHIPPED: 'orange', PARTIAL_RECEIVED: 'gold',
  PENDING: 'default'
}

export default function ErpMetadataManagement({ user, companies = [] }) {
  const [activeTab, setActiveTab] = useState('entities')
  const [loading, setLoading] = useState(false)
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const effectiveCompanyId = isSuperAdmin ? null : user?.companyId

  // ── Entity Registry ───────────────────────────────────────────
  const [entities, setEntities] = useState([])
  const [entityModal, setEntityModal] = useState(false)
  const [editingEntity, setEditingEntity] = useState(null)
  const [entityForm] = Form.useForm()

  const fetchEntities = useCallback(async () => {
    setLoading(true)
    try {
      const params = isSuperAdmin ? {} : { companyId: effectiveCompanyId }
      const res = await api.get('/erp/admin/meta/entities', { params, headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      setEntities(res.data?.data?.entities || [])
    } catch (e) { message.error('加载实体列表失败') }
    finally { setLoading(false) }
  }, [effectiveCompanyId, isSuperAdmin])

  // ── State Machine ─────────────────────────────────────────────
  const [transitions, setTransitions] = useState([])
  const [transitionModal, setTransitionModal] = useState(false)
  const [editingTransition, setEditingTransition] = useState(null)
  const [transitionForm] = Form.useForm()
  const [transitionEntityFilter, setTransitionEntityFilter] = useState(null)

  const fetchTransitions = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      if (transitionEntityFilter) params.entityCode = transitionEntityFilter
      const res = await api.get('/erp/admin/meta/state-machines', { params, headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      setTransitions(res.data?.data?.transitions || [])
    } catch (e) { message.error('加载状态机失败') }
    finally { setLoading(false) }
  }, [transitionEntityFilter])

  // ── Entity Relations ──────────────────────────────────────────
  const [relations, setRelations] = useState([])
  const [relationModal, setRelationModal] = useState(false)
  const [editingRelation, setEditingRelation] = useState(null)
  const [relationForm] = Form.useForm()

  const fetchRelations = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/erp/admin/meta/relations', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      setRelations(res.data?.data?.relations || [])
    } catch (e) { message.error('加载实体关系失败') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (activeTab === 'entities') fetchEntities()
    else if (activeTab === 'stateMachine') fetchTransitions()
    else if (activeTab === 'relations') fetchRelations()
  }, [activeTab, fetchEntities, fetchTransitions, fetchRelations])

  // ── Entity CRUD ────────────────────────────────────────────────
  const handleSaveEntity = async (values) => {
    try {
      const payload = {
        ...values,
        entityId: editingEntity?.entityId || null,
        isActive: values.isActive ?? true
      }
      if (editingEntity) {
        await api.put(`/erp/admin/meta/entities/${editingEntity.entityId}`, payload, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      } else {
        await api.post('/erp/admin/meta/entities', payload, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      }
      message.success('实体已保存')
      setEntityModal(false)
      entityForm.resetFields()
      setEditingEntity(null)
      fetchEntities()
    } catch (e) { message.error('保存失败: ' + (e.response?.data?.message || e.message)) }
  }

  // ── Transition CRUD ────────────────────────────────────────────
  const handleSaveTransition = async (values) => {
    try {
      const payload = { ...values, id: editingTransition?.id || null }
      if (editingTransition) {
        await api.put(`/erp/admin/meta/state-machines/${editingTransition.id}`, payload, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      } else {
        await api.post('/erp/admin/meta/state-machines', payload, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      }
      message.success('状态转换规则已保存')
      setTransitionModal(false)
      transitionForm.resetFields()
      setEditingTransition(null)
      fetchTransitions()
    } catch (e) { message.error('保存失败: ' + (e.response?.data?.message || e.message)) }
  }

  const handleDeleteTransition = async (id) => {
    try {
      await api.delete(`/erp/admin/meta/state-machines/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      message.success('已删除')
      fetchTransitions()
    } catch (e) { message.error('删除失败') }
  }

  // ── Relation CRUD ─────────────────────────────────────────────
  const handleSaveRelation = async (values) => {
    try {
      const payload = { ...values, id: editingRelation?.id || null }
      if (editingRelation) {
        await api.put(`/erp/admin/meta/relations/${editingRelation.id}`, payload, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      } else {
        await api.post('/erp/admin/meta/relations', payload, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      }
      message.success('实体关系已保存')
      setRelationModal(false)
      relationForm.resetFields()
      setEditingRelation(null)
      fetchRelations()
    } catch (e) { message.error('保存失败: ' + (e.response?.data?.message || e.message)) }
  }

  const handleDeleteRelation = async (id) => {
    try {
      await api.delete(`/erp/admin/meta/relations/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      message.success('已删除')
      fetchRelations()
    } catch (e) { message.error('删除失败') }
  }

  // ── Metadata reinit/reset ─────────────────────────────────────
  const [reinitLoading, setReinitLoading] = useState(false)
  const handleReinit = async () => {
    setReinitLoading(true)
    try {
      await api.post('/erp/admin/meta/reinit', {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      message.success('元数据已重新初始化（仅插入缺失数据）')
      fetchEntities()
    } catch (e) { message.error('初始化失败: ' + (e.response?.data?.message || e.message)) }
    finally { setReinitLoading(false) }
  }
  const handleReset = async () => {
    setReinitLoading(true)
    try {
      await api.post('/erp/admin/meta/reset', {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      message.success('元数据已重置')
      fetchEntities()
      fetchTransitions()
      fetchRelations()
    } catch (e) { message.error('重置失败: ' + (e.response?.data?.message || e.message)) }
    finally { setReinitLoading(false) }
  }

  // ── Column definitions ────────────────────────────────────────
  const entityColumns = [
    { title: '实体编码', dataIndex: 'entityCode', key: 'entityCode', width: 140,
      render: (v) => <Tag color="blue">{v}</Tag> },
    { title: '实体名称', dataIndex: 'entityName', key: 'entityName', width: 120 },
    { title: '表名', dataIndex: 'tableName', key: 'tableName', width: 200,
      render: (v) => <code style={{ fontSize: 12 }}>{v}</code> },
    { title: '主键', dataIndex: 'primaryKey', key: 'primaryKey', width: 100 },
    { title: '关键词', dataIndex: 'keywords', key: 'keywords', ellipsis: true,
      render: (v) => {
        if (!v) return '-'
        const arr = typeof v === 'string' ? (() => { try { return JSON.parse(v) } catch { return [v] } })() : v
        return Array.isArray(arr) ? arr.map(k => <Tag key={k}>{k}</Tag>) : String(v)
      } },
    { title: '状态', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '禁用'}</Tag> },
    { title: '操作', key: 'action', width: 100, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            setEditingEntity(record)
            entityForm.setFieldsValue(record)
            setEntityModal(true)
          }} />
        </Space>
      ) }
  ]

  const transitionColumns = [
    { title: '实体', dataIndex: 'entityCode', key: 'entityCode', width: 120,
      render: (v) => <Tag color="blue">{v}</Tag> },
    { title: '转换名称', dataIndex: 'transitionName', key: 'transitionName', width: 120 },
    { title: '起始状态', dataIndex: 'fromStatus', key: 'fromStatus', width: 120,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
    { title: '目标状态', dataIndex: 'toStatus', key: 'toStatus', width: 120,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
    { title: '前置条件', dataIndex: 'preconditions', key: 'preconditions', ellipsis: true,
      render: (v) => v && v !== '{}' ? <code style={{ fontSize: 11 }}>{String(v).substring(0, 60)}</code> : '-' },
    { title: '入口动作', dataIndex: 'onEntryActions', key: 'onEntryActions', ellipsis: true,
      render: (v) => {
        if (!v || v === '[]') return '-'
        try {
          const arr = typeof v === 'string' ? JSON.parse(v) : v
          if (Array.isArray(arr)) return arr.map((a, i) => <Tag key={i} color="purple">{a.action || JSON.stringify(a).substring(0, 20)}</Tag>)
        } catch {}
        return String(v).substring(0, 40)
      } },
    { title: '必填字段', dataIndex: 'requiredFields', key: 'requiredFields', width: 150,
      render: (v) => {
        if (!v || v === '[]') return '-'
        try {
          const arr = typeof v === 'string' ? JSON.parse(v) : v
          return Array.isArray(arr) ? arr.join(', ') : String(v)
        } catch { return String(v) }
      } },
    { title: '操作', key: 'action', width: 120, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            setEditingTransition(record)
            transitionForm.setFieldsValue(record)
            setTransitionModal(true)
          }} />
          <Popconfirm title="确认删除此转换规则？" onConfirm={() => handleDeleteTransition(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) }
  ]

  const relationColumns = [
    { title: '源实体', dataIndex: 'sourceEntity', key: 'sourceEntity', width: 140,
      render: (v) => <Tag color="blue">{v}</Tag> },
    { title: '目标实体', dataIndex: 'targetEntity', key: 'targetEntity', width: 140,
      render: (v) => <Tag color="geekblue">{v}</Tag> },
    { title: '关系类型', dataIndex: 'relationType', key: 'relationType', width: 120,
      render: (v) => <Tag color="purple">{v}</Tag> },
    { title: '源字段', dataIndex: 'sourceField', key: 'sourceField', width: 100 },
    { title: '目标字段', dataIndex: 'targetField', key: 'targetField', width: 100 },
    { title: '中间表', dataIndex: 'junctionTable', key: 'junctionTable', width: 120,
      render: (v) => v ? <code style={{ fontSize: 11 }}>{v}</code> : '-' },
    { title: '自动加载', dataIndex: 'autoLoad', key: 'autoLoad', width: 80,
      render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? '是' : '否'}</Tag> },
    { title: '级联删除', dataIndex: 'cascadeDelete', key: 'cascadeDelete', width: 80,
      render: (v) => v ? <Tag color="red">是</Tag> : '-' },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '操作', key: 'action', width: 120, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            setEditingRelation(record)
            relationForm.setFieldsValue(record)
            setRelationModal(true)
          }} />
          <Popconfirm title="确认删除此关系？" onConfirm={() => handleDeleteRelation(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) }
  ]

  const entityOptions = entities.map(e => ({ label: `${e.entityName} (${e.entityCode})`, value: e.entityCode }))

  return (
    <div style={{ padding: '0px' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'entities', label: <span><ApiOutlined /> 实体注册</span> },
          { key: 'stateMachine', label: <span><DeploymentUnitOutlined /> 状态机</span> },
          { key: 'relations', label: <span><ApartmentOutlined /> 实体关系</span> },
          { key: 'tools', label: <span><ThunderboltOutlined /> 工具</span> },
        ]}
      />

      {activeTab === 'entities' && (
        <Card
          title="ERP 实体注册表"
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchEntities} loading={loading}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                setEditingEntity(null)
                entityForm.resetFields()
                setEntityModal(true)
              }}>新增实体</Button>
            </Space>
          }
        >
          <Table
            columns={entityColumns}
            dataSource={entities}
            rowKey="entityId"
            loading={loading}
            size="small"
            scroll={{ x: 1000 }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        </Card>
      )}

      {activeTab === 'stateMachine' && (
        <Card
          title="状态机转换规则"
          extra={
            <Space>
              <Select
                allowClear
                placeholder="筛选实体"
                style={{ width: 200 }}
                options={entityOptions}
                value={transitionEntityFilter}
                onChange={setTransitionEntityFilter}
              />
              <Button icon={<ReloadOutlined />} onClick={fetchTransitions} loading={loading}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                setEditingTransition(null)
                transitionForm.resetFields()
                setTransitionModal(true)
              }}>新增规则</Button>
            </Space>
          }
        >
          <Table
            columns={transitionColumns}
            dataSource={transitions}
            rowKey="id"
            loading={loading}
            size="small"
            scroll={{ x: 1100 }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        </Card>
      )}

      {activeTab === 'relations' && (
        <Card
          title="实体关系配置"
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchRelations} loading={loading}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                setEditingRelation(null)
                relationForm.resetFields()
                setRelationModal(true)
              }}>新增关系</Button>
            </Space>
          }
        >
          <Table
            columns={relationColumns}
            dataSource={relations}
            rowKey="id"
            loading={loading}
            size="small"
            scroll={{ x: 1100 }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        </Card>
      )}

      {activeTab === 'tools' && (
        <Card title="元数据工具">
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <h3>重新初始化元数据</h3>
              <p style={{ color: '#888' }}>插入缺失的默认实体、状态机和关系数据（不会删除已有数据）</p>
              <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleReinit} loading={reinitLoading}>
                执行重新初始化
              </Button>
            </div>
            <div>
              <h3 style={{ color: '#ff4d4f' }}>重置元数据</h3>
              <Alert
                type="error"
                message="危险操作"
                description="将删除所有 company_id=0 的默认元数据并重新创建。自定义数据（company_id>0）不受影响。"
                style={{ marginBottom: 12 }}
              />
              <Popconfirm
                title="确认重置所有默认元数据？"
                description="此操作不可撤销！"
                onConfirm={handleReset}
                okText="确认重置"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />} loading={reinitLoading}>
                  重置默认元数据
                </Button>
              </Popconfirm>
            </div>
          </Space>
        </Card>
      )}

      {/* Entity Modal */}
      <Modal
        title={editingEntity ? '编辑实体' : '新增实体'}
        open={entityModal}
        onCancel={() => { setEntityModal(false); setEditingEntity(null) }}
        onOk={() => entityForm.submit()}
        width={640}
      >
        <Form form={entityForm} layout="vertical" onFinish={handleSaveEntity}>
          <Form.Item name="entityCode" label="实体编码" rules={[{ required: true }]}>
            <Input placeholder="如 OUTBOUND" disabled={!!editingEntity} />
          </Form.Item>
          <Form.Item name="entityName" label="实体名称" rules={[{ required: true }]}>
            <Input placeholder="如 出库单" />
          </Form.Item>
          <Form.Item name="tableName" label="表名" rules={[{ required: true }]}>
            <Input placeholder="如 erp_outbound_order" />
          </Form.Item>
          <Form.Item name="primaryKey" label="主键字段">
            <Input placeholder="如 outbound_id（默认id）" />
          </Form.Item>
          <Form.Item name="keywords" label="关键词（逗号分隔）">
            <Input placeholder="如 出库,发货,outbound,ship" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="实体描述" />
          </Form.Item>
          <Form.Item name="isActive" label="启用" valuePropName="checked">
            <Switch defaultChecked />
          </Form.Item>
        </Form>
      </Modal>

      {/* Transition Modal */}
      <Modal
        title={editingTransition ? '编辑状态转换' : '新增状态转换'}
        open={transitionModal}
        onCancel={() => { setTransitionModal(false); setEditingTransition(null) }}
        onOk={() => transitionForm.submit()}
        width={700}
      >
        <Form form={transitionForm} layout="vertical" onFinish={handleSaveTransition}>
          <Form.Item name="entityCode" label="实体编码" rules={[{ required: true }]}>
            <Select options={entityOptions} placeholder="选择实体" />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="fromStatus" label="起始状态" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="如 DRAFT" />
            </Form.Item>
            <Form.Item name="toStatus" label="目标状态" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="如 CONFIRMED" />
            </Form.Item>
          </Space>
          <Form.Item name="transitionName" label="转换名称" rules={[{ required: true }]}>
            <Input placeholder="如 确认出库" />
          </Form.Item>
          <Form.Item name="preconditions" label="前置条件 (JSON)">
            <TextArea rows={3} placeholder='{"requiredFields":["items_json","customer_id"]}' />
          </Form.Item>
          <Form.Item name="onEntryActions" label="入口动作 (JSON数组)">
            <TextArea rows={4} placeholder='[{"action":"reserveInventory"},{"action":"generateOrderNumber","prefix":"OUT","field":"order_number"}]' />
          </Form.Item>
          <Form.Item name="requiredFields" label="必填字段 (JSON数组)">
            <Input placeholder='["items_json","customer_id"]' />
          </Form.Item>
        </Form>
      </Modal>

      {/* Relation Modal */}
      <Modal
        title={editingRelation ? '编辑实体关系' : '新增实体关系'}
        open={relationModal}
        onCancel={() => { setRelationModal(false); setEditingRelation(null) }}
        onOk={() => relationForm.submit()}
        width={640}
      >
        <Form form={relationForm} layout="vertical" onFinish={handleSaveRelation}>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="sourceEntity" label="源实体" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={entityOptions} placeholder="选择源实体" />
            </Form.Item>
            <Form.Item name="targetEntity" label="目标实体" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={entityOptions} placeholder="选择目标实体" />
            </Form.Item>
          </Space>
          <Form.Item name="relationType" label="关系类型" rules={[{ required: true }]}>
            <Select options={[
              { label: '一对多 (one-to-many)', value: 'one-to-many' },
              { label: '多对一 (many-to-one)', value: 'many-to-one' },
              { label: '多对多 (many-to-many)', value: 'many-to-many' },
              { label: '一对一 (one-to-one)', value: 'one-to-one' },
            ]} placeholder="选择关系类型" />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="sourceField" label="源字段" style={{ flex: 1 }}>
              <Input placeholder="如 outbound_id" />
            </Form.Item>
            <Form.Item name="targetField" label="目标字段" style={{ flex: 1 }}>
              <Input placeholder="如 id" />
            </Form.Item>
          </Space>
          <Form.Item name="junctionTable" label="中间表（多对多时使用）">
            <Input placeholder="如 erp_order_items" />
          </Form.Item>
          <Space>
            <Form.Item name="autoLoad" label="自动加载" valuePropName="checked">
              <Switch defaultChecked={false} />
            </Form.Item>
            <Form.Item name="cascadeDelete" label="级联删除" valuePropName="checked">
              <Switch defaultChecked={false} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="关系说明" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
