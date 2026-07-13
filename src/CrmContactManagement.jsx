import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Switch, message, Space, Tag, Popconfirm, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from './auth';
import EntityPicker from './components/EntityPicker';
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const ENTITY = 'contacts';

export default function CrmContactManagement({ user, companies = [] }) {
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
      customer_id: record.customer_id,
      name: record.name,
      phone: record.phone,
      email: record.email,
      position: record.position,
      is_decision_maker: !!record.is_decision_maker,
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
    { title: '所属客户', dataIndex: 'customer_id', width: 120, render: v => v ? <Tag color="blue">客户#{v}</Tag> : '-' },
    { title: '姓名', dataIndex: 'name', width: 120 },
    { title: '电话', dataIndex: 'phone', width: 140, render: v => v || '-' },
    { title: '邮箱', dataIndex: 'email', width: 200, ellipsis: true, render: v => v || '-' },
    { title: '职位', dataIndex: 'position', width: 120, render: v => v || '-' },
    { title: '决策人', dataIndex: 'is_decision_maker', width: 90, render: v => v ? <Tag color="gold">是</Tag> : <Tag>否</Tag> },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: v => v || '-' },
    { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (_, r) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title={`确认删除联系人 ${r.name}?`} okText="确认" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title="联系人管理" extra={isSuperAdmin && (
      <Select placeholder="选择公司" style={{ width: 180 }} value={selectedCompanyId}
        onChange={v => { setSelectedCompanyId(v); setPage(1); }}
        options={(companies || []).map(c => ({ label: c.name, value: c.id }))} />
    )}>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="搜索姓名/电话/邮箱" value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={fetchData} style={{ width: 240 }} allowClear />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: size, total, showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setSize(ps); } }}
        scroll={{ x: 'max-content' }} />
      <Modal title={editing ? '编辑联系人' : '新增联系人'} open={modalOpen} onOk={handleSave} width={640}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}>
        <Form form={form} layout="vertical" initialValues={{ is_decision_maker: false }}>
          <Space wrap>
            <Form.Item name="customer_id" label="所属客户" rules={[{ required: true, message: '请选择客户' }]}>
              <EntityPicker entity="customers" companyId={effectiveCompanyId || 0} placeholder="搜索客户名称" width={280} />
            </Form.Item>
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
              <Input style={{ width: 200 }} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="phone" label="电话"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="email" label="邮箱"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="position" label="职位"><Input style={{ width: 200 }} /></Form.Item>
          </Space>
          <Form.Item name="is_decision_maker" label="决策人" valuePropName="checked">
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
