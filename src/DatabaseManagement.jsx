import React, { useState, useEffect } from 'react'
import { Layout, Menu, Button, Input, List, Typography, Space, Table, message, Modal, Form, Select, InputNumber } from 'antd'
import { PlusOutlined, DatabaseOutlined, TableOutlined, SaveOutlined, EditOutlined } from '@ant-design/icons'
import api, { getLocalAgentBaseUrl } from './auth'

const { Sider, Content } = Layout
const { Text, Title } = Typography
const { TextArea } = Input

export default function DatabaseManagement({ dbConfigs, fetchDbConfigs, onAddDbConfig, onUpdateDbConfig, user }) {
  const safeDbConfigs = Array.isArray(dbConfigs) ? dbConfigs : []
  const [selectedConfigId, setSelectedConfigId] = useState(null)
  const [tables, setTables] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [columns, setColumns] = useState([])
  const [descriptions, setDescriptions] = useState({ tables: {}, columns: {}, db: '' })
  const [loading, setLoading] = useState(false)
  const [isAddDbModalVisible, setIsAddDbModalVisible] = useState(false)
  const [isEditDbModalVisible, setIsEditDbModalVisible] = useState(false)
  const [dbForm] = Form.useForm()
  const [editDbForm] = Form.useForm()

  const selectedConfig = safeDbConfigs.find(c => String(c.id) === String(selectedConfigId))

  useEffect(() => {
    // Refresh DB configs list when DatabaseManagement mounts
    if (fetchDbConfigs) {
      console.log('Refreshing DB configs list on mount...')
      fetchDbConfigs()
    }
  }, [])

  useEffect(() => {
    if (fetchDbConfigs && safeDbConfigs.length === 0) {
      fetchDbConfigs()
    }
  }, [])

  useEffect(() => {
    if (selectedConfigId) {
      loadTables(selectedConfigId)
      loadDescriptions(selectedConfigId)
      setSelectedTable(null)
      setColumns([])
    }
  }, [selectedConfigId, safeDbConfigs.length > 0]) // Add length check to dependency to retry if configs load later

  useEffect(() => {
    if (selectedTable && selectedConfigId) {
      loadColumns(selectedConfigId, selectedTable)
    }
  }, [selectedTable])

  const loadTables = async (configId) => {
    try {
      setLoading(true)
      console.log('Loading tables for configId:', configId)
      // Use loose equality or string conversion for ID comparison
      const config = safeDbConfigs.find(c => String(c.id) === String(configId))
      if (!config) {
        console.warn('Config not found for ID:', configId, 'in', safeDbConfigs)
        return
      }

      const reqBody = {
        type: config.type,
        config: {
          host: config.host,
          port: config.port,
          user: config.username,
          password: config.password,
          database: config.database
        },
        operation: 'list_tables'
      }

      const url = `${getLocalAgentBaseUrl()}/api/local/db`
      console.log('Fetching tables from:', url, reqBody)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      })
      const data = await res.json()
      console.log('Tables data received:', data)
      if (data.status === 'success' && data.data) {
        const tbs = []
        for (let t of data.data) {
          if (t.table_name) tbs.push(t.table_name)
          else if (t.TABLE_NAME) tbs.push(t.TABLE_NAME)
          else if (t[`Tables_in_${config.database}`]) tbs.push(t[`Tables_in_${config.database}`])
          else {
            const keys = Object.keys(t)
            if (keys.length > 0) tbs.push(t[keys[0]])
          }
        }
        setTables(tbs)
      } else {
        message.error('Failed to load tables from local agent: ' + (data.message || data.error || 'Unknown error'))
      }
    } catch (error) {
      console.error(e)
      message.error('Failed to load tables: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadColumns = async (configId, tableName) => {
    try {
      setLoading(true)
      console.log('Loading columns for table:', tableName, 'configId:', configId)
      const config = safeDbConfigs.find(c => String(c.id) === String(configId))
      if (!config) return

      const reqBody = {
        type: config.type,
        config: {
          host: config.host,
          port: config.port,
          user: config.username,
          password: config.password,
          database: config.database
        },
        operation: 'describe_table',
        table: tableName
      }

      const url = `${getLocalAgentBaseUrl()}/api/local/db`
      console.log('Fetching columns from:', url, reqBody)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      })
      const data = await res.json()
      console.log('Columns data received:', data)
      if (data.status === 'success' && data.data) {
        try {
          let cols = []
          // Check if data is already structured array (from local agent raw response)
          if (Array.isArray(data.data) && data.data.length > 0 && typeof data.data[0] === 'object') {
            for (let row of data.data) {
              const colName = row.Field || row.column_name || row.COLUMN_NAME || row.name;
              const colType = row.Type || row.data_type || row.DATA_TYPE || row.type;
              if (colName && colType) {
                cols.push({ name: colName, type: colType });
              }
            }
          } else if (typeof data.data === 'string') {
            // Fallback for string parsing if local agent returns string format
            const lines = data.data.split('\n')
            for (let line of lines) {
              if (line.includes('|')) {
                const parts = line.split('|').map(p => p.trim())
                if (parts.length >= 3 && parts[1] !== 'Column' && !parts[1].includes('---')) {
                  cols.push({ name: parts[1], type: parts[2] })
                }
              }
            }
          }
          setColumns(cols)
        } catch (err) {
          console.error('Parse error', err)
        }
      } else {
        message.error('Failed to load columns from local agent: ' + (data.message || data.error || 'Unknown error'))
      }
    } catch (error) {
      console.error(e)
      message.error('Failed to load columns: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadDescriptions = async (configId) => {
    try {
      const res = await api.get(`/db-schemas/${configId}/descriptions`)
      setDescriptions(res.data || { tables: {}, columns: {}, db: '' })
    } catch (error) {
      console.error('Failed to load descriptions', e)
    }
  }

  const handleSaveDescriptions = async () => {
    if (!selectedConfigId) return
    try {
      setLoading(true)
      await api.post(`/db-schemas/${selectedConfigId}/descriptions`, descriptions)
      message.success('Descriptions saved successfully')
    } catch (error) {
      message.error('Failed to save descriptions')
    } finally {
      setLoading(false)
    }
  }

  const handleDescChange = (type, key1, key2, value) => {
    const newDesc = { ...descriptions }
    if (type === 'db') {
      newDesc.db = value
    } else if (type === 'table') {
      if (!newDesc.tables) newDesc.tables = {}
      newDesc.tables[key1] = value
    } else if (type === 'column') {
      if (!newDesc.columns) newDesc.columns = {}
      if (!newDesc.columns[key1]) newDesc.columns[key1] = {}
      newDesc.columns[key1][key2] = value
    }
    setDescriptions(newDesc)
  }

  const columnsDef = [
    { title: 'Column Name', dataIndex: 'name', key: 'name', width: 200 },
    { title: 'Data Type', dataIndex: 'type', key: 'type', width: 150 },
    {
      title: 'Description',
      key: 'description',
      render: (_, record) => (
        <Input
          placeholder="Enter column description"
          value={descriptions.columns?.[selectedTable]?.[record.name] || ''}
          onChange={(e) => handleDescChange('column', selectedTable, record.name, e.target.value)}
        />
      )
    }
  ]

  const dbMenuItems = safeDbConfigs.map(c => ({
    key: String(c.id),
    icon: <DatabaseOutlined />,
    label: c.name
  }));

  const tableMenuItems = tables.map(t => ({
    key: t,
    icon: <TableOutlined />,
    label: t
  }));

  return (
    <Layout style={{ height: '100%', background: '#111' }}>
      <Sider width={250} style={{ background: '#161616', borderRight: '1px solid #2a2a2a', overflow: 'auto' }}>
        <div style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: '#e3e3e3', fontWeight: 'bold' }}>Databases</Text>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setIsAddDbModalVisible(true)} />
        </div>
        {safeDbConfigs.length === 0 ? (
          <div style={{ padding: 16, color: '#888' }}>No databases</div>
        ) : (
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedConfigId ? [String(selectedConfigId)] : []}
          onClick={({ key }) => setSelectedConfigId(key)}
          style={{ background: 'transparent', borderRight: 0 }}
          items={safeDbConfigs.map(c => ({
            key: c.id,
            icon: <DatabaseOutlined />,
            label: c.name
          }))}
        />
        )}
      </Sider>
      <Content style={{ padding: 24, overflow: 'auto' }}>
        {selectedConfigId ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Title level={4} style={{ color: '#e3e3e3', margin: 0 }}>{selectedConfig?.name}</Title>
                {user && (user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN') && (
                  <Button type="text" icon={<EditOutlined />} onClick={() => {
                    editDbForm.setFieldsValue(selectedConfig)
                    setIsEditDbModalVisible(true)
                  }} style={{ color: '#1677ff' }} />
                )}
              </Space>
              <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveDescriptions} loading={loading}>
                Save Descriptions
              </Button>
            </div>
            
            <div style={{ background: '#1a1a1a', padding: 16, borderRadius: 8 }}>
              <Text style={{ color: '#888', display: 'block', marginBottom: 8 }}>Database Description</Text>
              <TextArea
                rows={3}
                placeholder="Enter basic database description"
                value={descriptions.db || selectedConfig?.description || ''}
                onChange={(e) => handleDescChange('db', null, null, e.target.value)}
              />
            </div>

            <Layout style={{ background: 'transparent', minHeight: 400 }}>
              <Sider width={200} style={{ background: '#1a1a1a', borderRadius: 8, marginRight: 16, overflow: 'auto' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
                  <Text style={{ color: '#888' }}>Tables</Text>
                </div>
                <Menu
                  theme="dark"
                  mode="inline"
                  selectedKeys={selectedTable ? [selectedTable] : []}
                  onClick={({ key }) => setSelectedTable(key)}
                  style={{ background: 'transparent', borderRight: 0 }}
                  items={tables.map(t => ({ key: t, icon: <TableOutlined />, label: t }))}
                />
              </Sider>
              <Content style={{ background: '#1a1a1a', borderRadius: 8, padding: 16 }}>
                {selectedTable ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Text style={{ color: '#888', display: 'block' }}>Table Description ({selectedTable})</Text>
                    <TextArea
                      rows={2}
                      placeholder="Enter table description"
                      value={descriptions.tables?.[selectedTable] || ''}
                      onChange={(e) => handleDescChange('table', selectedTable, null, e.target.value)}
                    />
                    <Table
                      dataSource={columns}
                      columns={columnsDef}
                      rowKey="name"
                      pagination={false}
                      size="small"
                      style={{ marginTop: 16 }}
                      loading={loading}
                    />
                  </Space>
                ) : (
                  <div style={{ textAlign: 'center', marginTop: 100, color: '#555' }}>
                    Select a table to view and edit its columns
                  </div>
                )}
              </Content>
            </Layout>
          </Space>
        ) : (
          <div style={{ textAlign: 'center', marginTop: 100, color: '#555' }}>
            Select a database from the sidebar
          </div>
        )}
      </Content>

      <Modal
        title="Add Database Config"
        open={isAddDbModalVisible}
        onCancel={() => setIsAddDbModalVisible(false)}
        footer={null}
        styles={{ content: { background: '#161616', border: '1px solid #2a2a2a' }, header: { background: '#161616', borderBottom: '1px solid #2a2a2a' } }}
      >
        <Form form={dbForm} layout="vertical" style={{ marginTop: 16 }} onFinish={async (values) => {
          const success = await onAddDbConfig(values)
          if (success) {
            dbForm.resetFields()
            setIsAddDbModalVisible(false)
            fetchDbConfigs()
          }
        }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="name" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Name (e.g. Prod DB)" />
            </Form.Item>
            <Form.Item name="type" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Select placeholder="Type" options={[{ value: 'mysql', label: 'MySQL' }, { value: 'sqlserver', label: 'SQL Server' }, { value: 'postgres', label: 'PostgreSQL' }]} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="host" style={{ flex: 2, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Host (e.g. localhost)" />
            </Form.Item>
            <Form.Item name="port" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <InputNumber placeholder="Port" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="username" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Username" />
            </Form.Item>
            <Form.Item name="password" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input.Password placeholder="Password" />
            </Form.Item>
          </div>
          <Form.Item name="database" style={{ marginBottom: 12 }} rules={[{ required: true }]}>
            <Input placeholder="Database Name" />
          </Form.Item>
          <Form.Item name="description" style={{ marginBottom: 12 }}>
            <TextArea rows={3} placeholder="Description (Purpose/Read-only, main tables, business logic, etc.)" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block style={{ marginTop: 4 }}>Add Database</Button>
        </Form>
      </Modal>

      <Modal
        title="Edit Database Config"
        open={isEditDbModalVisible}
        onCancel={() => setIsEditDbModalVisible(false)}
        footer={null}
        styles={{ content: { background: '#161616', border: '1px solid #2a2a2a' }, header: { background: '#161616', borderBottom: '1px solid #2a2a2a' } }}
      >
        <Form form={editDbForm} layout="vertical" style={{ marginTop: 16 }} onFinish={async (values) => {
          const success = await onUpdateDbConfig(selectedConfigId, values)
          if (success) {
            setIsEditDbModalVisible(false)
            fetchDbConfigs()
            loadTables(selectedConfigId) // Reload tables after update
          }
        }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="name" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Name (e.g. Prod DB)" />
            </Form.Item>
            <Form.Item name="type" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Select placeholder="Type" options={[{ value: 'mysql', label: 'MySQL' }, { value: 'sqlserver', label: 'SQL Server' }, { value: 'postgres', label: 'PostgreSQL' }]} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="host" style={{ flex: 2, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Host (e.g. localhost)" />
            </Form.Item>
            <Form.Item name="port" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <InputNumber placeholder="Port" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="username" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Username" />
            </Form.Item>
            <Form.Item name="password" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input.Password placeholder="Password" />
            </Form.Item>
          </div>
          <Form.Item name="database" style={{ marginBottom: 12 }} rules={[{ required: true }]}>
            <Input placeholder="Database Name" />
          </Form.Item>
          <Form.Item name="description" style={{ marginBottom: 12 }}>
            <TextArea rows={3} placeholder="Description (Purpose/Read-only, main tables, business logic, etc.)" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block style={{ marginTop: 4 }}>Save Changes</Button>
        </Form>
      </Modal>
    </Layout>
  )
}
