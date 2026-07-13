import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Space, Tag, Popconfirm, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from './auth';
import dayjs from 'dayjs';
import EntityPicker from './components/EntityPicker';
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const ENTITY = 'contracts';

const STATUS_MAP = {
  draft:     { label: '草稿', color: 'default' },
  approving: { label: '审批中', color: 'gold' },
  signed:    { label: '已签订', color: 'green' },
  archived:  { label: '已归档', color: 'blue' },
  void:      { label: '已作废', color: 'red' },
};

export default function CrmContractManagement({ user, companies = [] }) {
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
      contract_number: record.contract_number,
      name: record.name,
      customer_id: record.customer_id,
      opportunity_id: record.opportunity_id,
      amount: record.amount,
      status: record.status,
      signed_date: record.signed_date ? dayjs(record.signed_date) : null,
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
        signed_date: values.signed_date ? values.signed_date.format('YYYY-MM-DD') : null,
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
    { title: '合同编号', dataIndex: 'contract_number', width: 160 },
    { title: '合同名称', dataIndex: 'name', width: 180 },
    { title: '客户', dataIndex: 'customer_id', width: 120, render: v => v ? <Tag color="blue">客户#{v}</Tag> : '-' },
    { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: v => v != null ? Number(v).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 100, render: v => v ? <Tag color={STATUS_MAP[v]?.color}>{STATUS_MAP[v]?.label || v}</Tag> : '-' },
    { title: '签订日期', dataIndex: 'signed_date', width: 120, render: v => v || '-' },
    { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (_, r) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title={`确认删除合同 ${r.name}?`} okText="确认" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title="合同管理" extra={isSuperAdmin && (
      <Select placeholder="选择公司" style={{ width: 180 }} value={selectedCompanyId}
        onChange={v => { setSelectedCompanyId(v); setPage(1); }}
        options={(companies || []).map(c => ({ label: c.name, value: c.id }))} />
    )}>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="搜索合同编号/名称" value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={fetchData} style={{ width: 240 }} allowClear />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: size, total, showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setSize(ps); } }}
        scroll={{ x: 'max-content' }} />
      <Modal title={editing ? '编辑合同' : '新增合同'} open={modalOpen} onOk={handleSave} width={640}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}>
        <Form form={form} layout="vertical" initialValues={{ status: 'draft' }}>
          <Space wrap>
            <Form.Item name="contract_number" label="合同编号"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="name" label="合同名称" rules={[{ required: true, message: '请输入合同名称' }]}>
              <Input style={{ width: 280 }} placeholder="必填" />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="customer_id" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
              <EntityPicker entity="customers" companyId={effectiveCompanyId || 0} placeholder="搜索客户名称" width={280} />
            </Form.Item>
            <Form.Item name="opportunity_id" label="商机"><EntityPicker entity="opportunities" companyId={effectiveCompanyId || 0} placeholder="搜索商机" width={280} /></Form.Item>
            <Form.Item name="amount" label="金额"><InputNumber style={{ width: 200 }} min={0} step={0.01} /></Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="status" label="状态">
              <Select style={{ width: 200 }} options={Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Form.Item>
            <Form.Item name="signed_date" label="签订日期">
              <DatePicker style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="owner_user_id" label="负责人ID"><InputNumber style={{ width: 200 }} /></Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
