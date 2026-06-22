import React, { useState } from 'react';
import { Modal, Form, Input, Button, Space, Tag, Divider, Checkbox, Select } from 'antd';
import { DeleteOutlined, EditOutlined, CheckOutlined, PlusOutlined, CrownOutlined, BranchesOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { CHANNELS } from './constants/taskTypes.jsx';

function CompanyManagement({ open, onClose, companies, onAddCompany, onUpdateCompany, onDeleteCompany }) {
  const { t } = useTranslation()
  const [companyForm] = Form.useForm()
  const [editingCompanyId, setEditingCompanyId] = useState(null)
  const [editChannels, setEditChannels] = useState([])

  return (
    <Modal
      title={<span><CrownOutlined style={{ marginRight: 8 }} />公司管理</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      styles={{ body: { background: '#1a1a1a', padding: '24px' }, header: { background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', padding: '16px 24px' } }}
    >
      <div style={{ marginBottom: 16 }}>
        <span style={{ color: '#888', fontSize: 12 }}>创建并管理系统中的公司。必须先创建公司，才能为其创建用户。</span>
      </div>

      {/* Company List */}
      <div style={{ marginBottom: 20, maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
        {(!companies || companies.length === 0) ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#555' }}>
            <BranchesOutlined style={{ fontSize: 40, display: 'block', marginBottom: 12, opacity: 0.3 }} />
            <span style={{ fontSize: 13 }}>暂无公司，请添加第一个公司</span>
          </div>
        ) : (
          companies.map(c => (
            <div key={c.id} style={{ padding: '12px 14px', border: '1px solid #2a2a2a', borderRadius: 8, marginBottom: 8, background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#e3e3e3', fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                    <Tag color="default" style={{ fontSize: 10, opacity: 0.6 }}>ID: {c.id}</Tag>
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(c.channelAccess || []).map(ch => {
                      const def = CHANNELS.find(d => d.key === ch)
                      return <Tag key={ch} color="blue" style={{ fontSize: 10 }}>{def ? def.label : ch}</Tag>
                    })}
                    {(!c.channelAccess || c.channelAccess.length === 0) && (
                      <Tag color="green" style={{ fontSize: 10 }}>全部频道可用</Tag>
                    )}
                  </div>
                </div>
                <Space>
                  <Button size="small" type="text" icon={<EditOutlined />}
                    onClick={() => {
                      setEditingCompanyId(editingCompanyId === c.id ? null : c.id)
                      setEditChannels(c.channelAccess || [])
                    }}
                    style={{ color: '#1677ff' }} />
                  <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteCompany(c.id)} />
                </Space>
              </div>
              {editingCompanyId === c.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
                  <span style={{ color: '#aaa', fontSize: 12, display: 'block', marginBottom: 6 }}>可用频道（不选则全部可用）</span>
                  <Checkbox.Group value={editChannels} onChange={(values) => setEditChannels(values)}>
                    <Space direction="vertical" style={{ gap: 4 }}>
                      {CHANNELS.map(ch => (
                        <Checkbox key={ch.key} value={ch.key} style={{ color: '#ccc' }}>
                          <span style={{ color: '#ccc' }}>{ch.label}</span>
                          <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>{ch.desc}</span>
                        </Checkbox>
                      ))}
                    </Space>
                  </Checkbox.Group>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <Button size="small" type="primary" icon={<CheckOutlined />}
                      onClick={async () => {
                        await onUpdateCompany(c.id, { name: c.name, channelAccess: editChannels })
                        setEditingCompanyId(null)
                      }}>保存频道设置</Button>
                    <Button size="small" onClick={() => setEditingCompanyId(null)}>取消</Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add New Company */}
      <Divider style={{ borderColor: '#2a2a2a' }} />
      <span style={{ color: '#888', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
        <PlusOutlined style={{ marginRight: 6 }} />添加新公司
      </span>
      <Form
        form={companyForm}
        layout="vertical"
        onFinish={async (values) => {
          await onAddCompany(values)
          companyForm.resetFields()
        }}
        style={{ marginTop: 12 }}
      >
        <div style={{ display: 'flex', gap: '12px' }}>
          <Form.Item name="name" rules={[{ required: true, message: '请输入公司名称' }]} style={{ flex: 1, marginBottom: 12 }}>
            <Input placeholder="公司名称" style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
          </Form.Item>
        </div>
        <Form.Item name="channelAccess" label={<span style={{ color: '#aaa', fontSize: 12 }}>可用频道（不选则全部可用）</span>} style={{ marginBottom: 12 }}>
          <Checkbox.Group>
            <Space direction="vertical" style={{ gap: 4 }}>
              {CHANNELS.map(ch => (
                <Checkbox key={ch.key} value={ch.key} style={{ color: '#ccc' }}>
                  <span style={{ color: '#ccc' }}>{ch.label}</span>
                  <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>{ch.desc}</span>
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Form.Item>
        <Button type="primary" htmlType="submit" block icon={<PlusOutlined />}>创建公司</Button>
      </Form>
    </Modal>
  );
}

export default CompanyManagement;
