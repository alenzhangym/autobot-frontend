import { useEffect, useState, useCallback } from 'react';
import {
  Card, Tag, Button, Space, Typography, Table, Modal, Form, Input, InputNumber,
  Alert, Spin, Popconfirm, message
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined, ThunderboltOutlined,
  ApiOutlined, PlayCircleOutlined, PoweroffOutlined
} from '@ant-design/icons';
import api from '../auth';

const { Text, Paragraph } = Typography;

/**
 * P7-2: MCP server 配置管理面板.
 * 列出已配置的 MCP server, 支持新增 / 编辑 / 删除 (后端落盘到 ~/.autobot/mcp.json),
 * 以及启动预热 / 停止 / 刷新 tool discovery.
 */
export default function McpSettingsPanel() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // name or null (新增)
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(null); // name|action

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/mcp/servers');
      setData(r.data || []);
    } catch (e) {
      message.error('加载失败: ' + (e?.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function openAdd() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ startupTimeoutMs: 5000, initializeTimeoutMs: 10000 });
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditing(row.name);
    form.setFieldsValue({
      name: row.name,
      command: (row.command || []).join(' '),
      envText: row.env ? Object.entries(row.env).map(([k,v]) => `${k}=${v}`).join('\n') : '',
      startupTimeoutMs: row.startupTimeoutMs,
      initializeTimeoutMs: row.initializeTimeoutMs,
    });
    setModalOpen(true);
  }

  async function save() {
    try {
      const v = await form.validateFields();
      const body = {
        name: v.name.trim(),
        command: String(v.command).trim().split(/\s+/).filter(Boolean),
        env: parseEnv(v.envText),
        startupTimeoutMs: v.startupTimeoutMs || 5000,
        initializeTimeoutMs: v.initializeTimeoutMs || 10000,
      };
      if (body.command.length === 0) {
        message.error('command 不能为空'); return;
      }
      if (editing) {
        await api.put(`/mcp/servers/${encodeURIComponent(editing)}`, body);
        message.success(`已更新 ${body.name}`);
      } else {
        await api.post('/mcp/servers', body);
        message.success(`已添加 ${body.name}`);
      }
      setModalOpen(false);
      refresh();
    } catch (e) {
      if (e?.errorFields) return; // 表单校验失败, Form 自己提示
      message.error('保存失败: ' + (e?.response?.data?.error || e.message));
    }
  }

  async function remove(name) {
    try {
      await api.delete(`/mcp/servers/${encodeURIComponent(name)}`);
      message.success(`已删除 ${name}`);
      refresh();
    } catch (e) {
      message.error('删除失败: ' + (e?.response?.data?.error || e.message));
    }
  }

  async function start(name) {
    setBusy(name);
    try {
      const r = await api.post(`/mcp/servers/${encodeURIComponent(name)}/start`);
      if (r.data.started) message.success(`${name} 已预热`);
      else message.warning(`${name} 启动失败: ${r.data.error}`);
      refresh();
    } catch (e) {
      message.error('启动失败: ' + (e?.response?.data?.error || e.message));
    } finally { setBusy(null); }
  }

  async function stop(name) {
    setBusy(name);
    try {
      await api.post(`/mcp/servers/${encodeURIComponent(name)}/stop`);
      message.success(`${name} 已停止`);
      refresh();
    } catch (e) {
      message.error('停止失败: ' + (e?.response?.data?.error || e.message));
    } finally { setBusy(null); }
  }

  async function refreshTools() {
    setBusy('refresh');
    try {
      const r = await api.post('/mcp/servers/refresh');
      message.success(`已注册 ${r.data.registered} 个工具`);
    } catch (e) {
      message.error('刷新失败: ' + (e?.response?.data?.error || e.message));
    } finally { setBusy(null); }
  }

  const columns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (v, r) => (
        <Space>
          <ApiOutlined />
          <Text strong>{v}</Text>
          {r.live ? <Tag color="green">live</Tag> : <Tag>idle</Tag>}
          {r.hasToken && <Tag color="blue">OAuth</Tag>}
        </Space>
      )
    },
    {
      title: '命令', dataIndex: 'command', key: 'command', ellipsis: true,
      render: (v) => <Text code style={{ fontSize: 11 }}>{(v || []).join(' ')}</Text>
    },
    {
      title: '操作', key: 'action', width: 280,
      render: (_, row) => (
        <Space size="small">
          {!row.live && (
            <Button size="small" icon={<PlayCircleOutlined />} loading={busy === row.name} onClick={() => start(row.name)}>启动</Button>
          )}
          {row.live && (
            <Button size="small" icon={<PoweroffOutlined />} loading={busy === row.name} onClick={() => stop(row.name)}>停止</Button>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm title={`删除 ${row.name}?`} onConfirm={() => remove(row.name)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <ApiOutlined />
          <span>MCP 服务器配置</span>
          <Text type="secondary" style={{ fontSize: 12 }}>(持久化到 ~/.autobot/mcp.json)</Text>
        </Space>
      }
      extra={
        <Space>
          <Button size="small" icon={<ThunderboltOutlined />} onClick={refreshTools} loading={busy === 'refresh'}>刷新工具</Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增</Button>
        </Space>
      }
    >
      <Spin spinning={loading}>
        <Table
          size="small"
          rowKey="name"
          columns={columns}
          dataSource={data}
          pagination={false}
          locale={{ emptyText: '暂无 MCP server 配置 — 点 [新增] 添加' }}
        />
      </Spin>

      <Modal
        title={editing ? `编辑 ${editing}` : '新增 MCP server'}
        open={modalOpen}
        onOk={save}
        onCancel={() => setModalOpen(false)}
        width={560}
        okText="保存"
        cancelText="取消"
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          命令以空格分隔 (如 <Text code>npx -y @modelcontextprotocol/server-github</Text>); env 每行一个 KEY=VALUE.
        </Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '名称必填' }]}>
            <Input placeholder="如 github / filesystem / fetch" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="command" label="启动命令" rules={[{ required: true, message: '命令必填' }]}>
            <Input placeholder="npx -y @modelcontextprotocol/server-github" />
          </Form.Item>
          <Form.Item name="envText" label="环境变量 (每行 KEY=VALUE)" tooltip="敏感信息如 token 会明文保存到 ~/.autobot/mcp.json">
            <Input.TextArea rows={4} placeholder={'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx\nANOTHER_KEY=val'} />
          </Form.Item>
          <Space>
            <Form.Item name="startupTimeoutMs" label="启动超时(ms)">
              <InputNumber min={1000} max={60000} step={1000} />
            </Form.Item>
            <Form.Item name="initializeTimeoutMs" label="初始化超时(ms)">
              <InputNumber min={1000} max={60000} step={1000} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}

/** 把多行 KEY=VALUE 解析成 env map. */
function parseEnv(text) {
  const env = {};
  if (!text) return env;
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx <= 0) continue;
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return env;
}
