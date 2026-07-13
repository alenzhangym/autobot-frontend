import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Space, Tag, Popconfirm, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from './auth';
import dayjs from 'dayjs';
import EntityPicker from './components/EntityPicker';
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const ENTITY = 'follow-ups';

const TARGET_TYPE_MAP = {
  customer:     { label: '客户', color: 'blue' },
  opportunity:  { label: '商机', color: 'gold' },
  lead:         { label: '线索', color: 'cyan' },
  contract:     { label: '合同', color: 'green' },
};

const FOLLOW_METHODS = ['电话', '微信', '邮件', '上门拜访', '视频会议'];

export default function CrmFollowUpManagement({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user);
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id || user?.companyId || 0);
  const effectiveCompanyId = isSuperAdmin ? (selectedCompanyId || 0) : user?.companyId;

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { keyword: keyword || undefined, page, size, companyId: effectiveCompanyId || 0 };
      if (typeFilter) params.target_type = typeFilter;
      const res = await api.get(`/crm/${ENTITY}`, { params });
      const body = res.data?.data || res.data;
      setData(body?.data || []);
      setTotal(body?.total || 0);
    } catch (e) {
      message.error('加载失败: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page, size, effectiveCompanyId, keyword, typeFilter]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      target_type: record.target_type,
      target_id: record.target_id,
      content: record.content,
      follow_method: record.follow_method,
      next_follow_time: record.next_follow_time ? dayjs(record.next_follow_time) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        next_follow_time: values.next_follow_time ? values.next_follow_time.format('YYYY-MM-DD HH:mm:ss') : null,
      };
      if (editing) {
        await api.put(`/crm/${ENTITY}/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await api.post(`/crm/${ENTITY}`, { ...payload, companyId: effectiveCompanyId || 0 });
        message.success('新增成功');
      }
      setModalOpen(false);
      fetchData();
    } catch (e) {
      if (e.response) message.error('保存失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/crm/${ENTITY}/${id}?companyId=${effectiveCompanyId || 0}`);
      message.success('已删除');
      fetchData();
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const columns = [
    { title: '对象类型', dataIndex: 'target_type', width: 100, render: v => v ? <Tag color={TARGET_TYPE_MAP[v]?.color}>{TARGET_TYPE_MAP[v]?.label || v}</Tag> : '-' },
    { title: '对象', dataIndex: 'target_id', width: 120, render: (v, r) => v ? <Tag color={TARGET_TYPE_MAP[r.target_type]?.color}>{TARGET_TYPE_MAP[r.target_type]?.label || r.target_type}#{v}</Tag> : '-' },
    { title: '跟进内容', dataIndex: 'content', ellipsis: true },
    { title: '跟进方式', dataIndex: 'follow_method', width: 110, render: v => v ? <Tag>{v}</Tag> : '-' },
    { title: '下次跟进', dataIndex: 'next_follow_time', width: 160, render: v => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 150, render: v => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (_, r) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="确认删除该跟进记录?" okText="确认" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title="跟进记录管理" extra={isSuperAdmin && (
      <Select placeholder="选择公司" style={{ width: 180 }} value={selectedCompanyId}
        onChange={v => { setSelectedCompanyId(v); setPage(1); }}
        options={(companies || []).map(c => ({ label: c.name, value: c.id }))} />
    )}>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="搜索跟进内容" value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={fetchData} style={{ width: 240 }} allowClear />
        <Select placeholder="对象类型筛选" allowClear style={{ width: 150 }} value={typeFilter}
          onChange={v => { setTypeFilter(v); setPage(1); }}
          options={Object.entries(TARGET_TYPE_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: size, total, showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setSize(ps); } }}
        scroll={{ x: 'max-content' }} />
      <Modal title={editing ? '编辑跟进记录' : '新增跟进记录'} open={modalOpen} onOk={handleSave} width={640}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}>
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item name="target_type" label="对象类型" rules={[{ required: true, message: '请选择对象类型' }]}>
              <Select style={{ width: 200 }} options={Object.entries(TARGET_TYPE_MAP).map(([k, v]) => ({ value: k, label: v.label }))}
                onChange={(v) => { form.setFieldValue('target_id', undefined); }} />
            </Form.Item>
            <Form.Item shouldUpdate={(prev, cur) => prev.target_type !== cur.target_type} noStyle>
              {({ getFieldValue }) => {
                const tt = getFieldValue('target_type');
                const entityMap = { customer: 'customers', opportunity: 'opportunities', lead: 'leads', contract: 'contracts' };
                const ent = entityMap[tt];
                return (
                  <Form.Item name="target_id" label="关联对象" rules={[{ required: true, message: '请选择关联对象' }]}>
                    {ent
                      ? <EntityPicker entity={ent} companyId={effectiveCompanyId || 0} placeholder={`搜索${TARGET_TYPE_MAP[tt]?.label || ''}`} width={280} />
                      : <Select disabled style={{ width: 280 }} placeholder="请先选择对象类型" />}
                  </Form.Item>
                );
              }}
            </Form.Item>
            <Form.Item name="follow_method" label="跟进方式">
              <Select style={{ width: 200 }} allowClear options={FOLLOW_METHODS.map(m => ({ value: m, label: m }))} />
            </Form.Item>
            <Form.Item name="next_follow_time" label="下次跟进时间">
              <DatePicker showTime style={{ width: 220 }} />
            </Form.Item>
          </Space>
          <Form.Item name="content" label="跟进内容" rules={[{ required: true, message: '请输入跟进内容' }]}>
            <Input.TextArea rows={4} placeholder="必填" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
