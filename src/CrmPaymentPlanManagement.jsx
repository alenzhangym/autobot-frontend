import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, DatePicker, message, Space, Tag, Popconfirm, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from './auth';
import dayjs from 'dayjs';
import EntityPicker from './components/EntityPicker';
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js';

const ENTITY = 'payment-plans';

const STATUS_MAP = {
  pending:   { label: '待回款', color: 'orange' },
  completed: { label: '已回款', color: 'green' },
};

export default function CrmPaymentPlanManagement({ user, companies = [] }) {
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
      contract_id: record.contract_id,
      stage_name: record.stage_name,
      plan_amount: record.plan_amount,
      plan_date: record.plan_date ? dayjs(record.plan_date) : null,
      status: record.status,
      remark: record.remark,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        plan_date: values.plan_date ? values.plan_date.format('YYYY-MM-DD') : null,
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
    { title: '合同', dataIndex: 'contract_id', width: 120, render: v => v ? <Tag color="green">合同#{v}</Tag> : '-' },
    { title: '阶段名称', dataIndex: 'stage_name', width: 160, render: v => v || '-' },
    { title: '计划金额', dataIndex: 'plan_amount', width: 130, align: 'right', render: v => v != null ? Number(v).toLocaleString() : '-' },
    { title: '计划日期', dataIndex: 'plan_date', width: 120, render: v => v || '-' },
    { title: '状态', dataIndex: 'status', width: 100, render: v => v ? <Tag color={STATUS_MAP[v]?.color}>{STATUS_MAP[v]?.label || v}</Tag> : '-' },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: v => v || '-' },
    { title: '操作', key: 'actions', width: 150, fixed: 'right', render: (_, r) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="确认删除该回款计划?" okText="确认" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title="回款计划管理" extra={isSuperAdmin && (
      <Select placeholder="选择公司" style={{ width: 180 }} value={selectedCompanyId}
        onChange={v => { setSelectedCompanyId(v); setPage(1); }}
        options={(companies || []).map(c => ({ label: c.name, value: c.id }))} />
    )}>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder="搜索阶段名称" value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={fetchData} style={{ width: 240 }} allowClear />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize: size, total, showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setSize(ps); } }}
        scroll={{ x: 'max-content' }} />
      <Modal title={editing ? '编辑回款计划' : '新增回款计划'} open={modalOpen} onOk={handleSave} width={560}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}>
        <Form form={form} layout="vertical" initialValues={{ status: 'pending' }}>
          <Space wrap>
            <Form.Item name="contract_id" label="合同" rules={[{ required: true, message: '请选择合同' }]}>
              <EntityPicker entity="contracts" companyId={effectiveCompanyId || 0} placeholder="搜索合同名称/编号" width={280} subLabelField="contract_number" />
            </Form.Item>
            <Form.Item name="stage_name" label="阶段名称"><Input style={{ width: 200 }} /></Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="plan_amount" label="计划金额"><InputNumber style={{ width: 200 }} min={0} step={0.01} /></Form.Item>
            <Form.Item name="plan_date" label="计划日期"><DatePicker style={{ width: 200 }} /></Form.Item>
            <Form.Item name="status" label="状态">
              <Select style={{ width: 200 }} options={Object.entries(STATUS_MAP).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
