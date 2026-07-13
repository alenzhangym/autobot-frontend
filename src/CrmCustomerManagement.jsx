import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, message, Space, Tag, Popconfirm, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from './auth';
import dayjs from 'dayjs';
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const ENTITY = 'customers';

const LEVEL_MAP = {
  normal:     { label: '普通', color: 'default' },
  vip:        { label: 'VIP', color: 'gold' },
  strategic:  { label: '战略', color: 'magenta' },
};

const STATUS_MAP = {
  active:   { label: '启用', color: 'green' },
  inactive: { label: '停用', color: 'default' },
};

export default function CrmCustomerManagement({ user, companies = [] }) {
  const isSuperAdmin = isSuperAdminFn(user);
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id || user?.companyId || 0);
  const effectiveCompanyId = isSuperAdmin ? (selectedCompanyId || 0) : user?.companyId;

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/crm/${ENTITY}`, {
        params: { keyword: keyword || undefined, page, size, companyId: effectiveCompanyId || 0 }
      });
      const body = res.data?.data || res.data;
      setData(body?.data || []);
      setTotal(body?.total || 0);
    } catch (e) {
      message.error('加载失败: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page, size, effectiveCompanyId, keyword]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      industry: record.industry,
      source: record.source,
      phone: record.phone,
      address: record.address,
      level: record.level,
      status: record.status,
      owner_user_id: record.owner_user_id,
      remark: record.remark,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await api.put(`/crm/${ENTITY}/${editing.id}`, values);
        message.success('更新成功');
      } else {
        await api.post(`/crm/${ENTITY}`, { ...values, companyId: effectiveCompanyId || 0 });
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
    { title: '客户名称', dataIndex: 'name', width: 160 },
    { title: '行业', dataIndex: 'industry', width: 110, render: v => v || '-' },
    { title: '来源', dataIndex: 'source', width: 100, render: v => v || '-' },
    { title: '电话', dataIndex: 'phone', width: 130, render: v => v || '-' },
    { title: '等级', dataIndex: 'level', width: 80, render: v => v ? <Tag color={LEVEL_MAP[v]?.color}>{LEVEL_MAP[v]?.label || v}</Tag> : '-' },
    { title: '状态', dataIndex: 'status', width: 80, render: v => v ? <Tag color={STATUS_MAP[v]?.color}>{STATUS_MAP[v]?.label || v}</Tag> : '-' },
    { title: '负责人', dataIndex: 'owner_user_id', width: 90, render: v => v != null ? v : '-' },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: v => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 150, render: v => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (_, r) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title={`确认删除客户 ${r.name}?`} okText="确认" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title="客户管理" extra={isSuperAdmin && (
      <Select placeholder="选择公司" style={{ width: 180 }} value={selectedCompanyId}
        onChange={v => { setSelectedCompanyId(v); setPage(1); }}
        options={(companies || []).map(c => ({ label: c.name, value: c.id }))} />
    )}>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="搜索客户名称/电话" value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={fetchData} style={{ width: 240 }} allowClear />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: size, total, showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setSize(ps); } }}
        scroll={{ x: 'max-content' }} />
      <Modal title={editing ? '编辑客户' : '新增客户'} open={modalOpen} onOk={handleSave} width={640}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}>
        <Form form={form} layout="vertical" initialValues={{ level: 'normal', status: 'active' }}>
          <Form.Item name="name" label="客户名称" rules={[{ required: true, message: '请输入客户名称' }]}>
            <Input placeholder="必填" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="industry" label="行业"><Input style={{ width: 180 }} /></Form.Item>
            <Form.Item name="source" label="来源"><Input style={{ width: 180 }} /></Form.Item>
            <Form.Item name="phone" label="电话"><Input style={{ width: 180 }} /></Form.Item>
          </Space>
          <Form.Item name="address" label="地址"><Input /></Form.Item>
          <Space wrap>
            <Form.Item name="level" label="等级">
              <Select style={{ width: 180 }} options={Object.entries(LEVEL_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select style={{ width: 180 }} options={Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Form.Item>
            <Form.Item name="owner_user_id" label="负责人ID">
              <InputNumber style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
