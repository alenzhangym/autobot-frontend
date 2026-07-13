import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Space, Tag, Popconfirm, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from './auth';
import dayjs from 'dayjs';
import EntityPicker from './components/EntityPicker';
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const ENTITY = 'opportunities';

const STAGE_MAP = {
  '初步接触': { color: 'blue' },
  '需求确认': { color: 'cyan' },
  '方案报价': { color: 'gold' },
  '谈判':     { color: 'orange' },
  '赢单':     { color: 'green' },
  '输单':     { color: 'red' },
};

export default function CrmOpportunityManagement({ user, companies = [] }) {
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
      customer_id: record.customer_id,
      amount: record.amount,
      stage: record.stage,
      possibility: record.possibility,
      expected_close_date: record.expected_close_date ? dayjs(record.expected_close_date) : null,
      owner_user_id: record.owner_user_id,
      remark: record.remark,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        expected_close_date: values.expected_close_date ? values.expected_close_date.format('YYYY-MM-DD') : null,
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
    { title: '商机名称', dataIndex: 'name', width: 180 },
    { title: '客户', dataIndex: 'customer_id', width: 120, render: v => v ? <Tag color="blue">客户#{v}</Tag> : '-' },
    { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: v => v != null ? Number(v).toLocaleString() : '-' },
    { title: '阶段', dataIndex: 'stage', width: 110, render: v => v ? <Tag color={STAGE_MAP[v]?.color}>{v}</Tag> : '-' },
    { title: '赢单概率', dataIndex: 'possibility', width: 100, align: 'right', render: v => v != null ? `${v}%` : '-' },
    { title: '预计成交日期', dataIndex: 'expected_close_date', width: 120, render: v => v || '-' },
    { title: '最后跟进', dataIndex: 'last_follow_time', width: 150, render: v => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (_, r) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title={`确认删除商机 ${r.name}?`} okText="确认" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title="商机管理" extra={isSuperAdmin && (
      <Select placeholder="选择公司" style={{ width: 180 }} value={selectedCompanyId}
        onChange={v => { setSelectedCompanyId(v); setPage(1); }}
        options={(companies || []).map(c => ({ label: c.name, value: c.id }))} />
    )}>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="搜索商机名称" value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={fetchData} style={{ width: 240 }} allowClear />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: size, total, showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setSize(ps); } }}
        scroll={{ x: 'max-content' }} />
      <Modal title={editing ? '编辑商机' : '新增商机'} open={modalOpen} onOk={handleSave} width={640}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}>
        <Form form={form} layout="vertical" initialValues={{ stage: '初步接触', possibility: 0 }}>
          <Form.Item name="name" label="商机名称" rules={[{ required: true, message: '请输入商机名称' }]}>
            <Input placeholder="必填" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="customer_id" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
              <EntityPicker entity="customers" companyId={effectiveCompanyId || 0} placeholder="搜索客户名称" width={280} />
            </Form.Item>
            <Form.Item name="amount" label="金额">
              <InputNumber style={{ width: 200 }} min={0} step={0.01} />
            </Form.Item>
            <Form.Item name="possibility" label="赢单概率(%)">
              <InputNumber style={{ width: 200 }} min={0} max={100} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="stage" label="阶段">
              <Select style={{ width: 200 }} options={Object.keys(STAGE_MAP).map(k => ({ value: k, label: k }))} />
            </Form.Item>
            <Form.Item name="expected_close_date" label="预计成交日期">
              <DatePicker style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="owner_user_id" label="负责人ID">
              <InputNumber style={{ width: 200 }} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
