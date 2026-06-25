import React, { useEffect, useState, useMemo } from 'react'
import { Modal, Input, List, Tag, Empty, Spin, Typography, Button, Space } from 'antd'
import { SearchOutlined, ApiOutlined, FileOutlined } from '@ant-design/icons'
import api from '../auth'

const { Text } = Typography

/**
 * S5: 拓扑索引搜索 —— 后端
 * {@code GET /api/topology/{workspaceId}} 的前端薄包装。
 *
 * <p>UI 行为：</p>
 * <ol>
 *   <li>打开 modal → 自动 fetch topology（不传 workspaceId 时不 fetch）</li>
 *   <li>用户输入 FQCN 关键字 → 实时过滤 fqcns 列表</li>
 *   <li>点击某条 → 调 onPick(filePath) 回调（一般用于跳转到 WorkspacePanel）</li>
 * </ol>
 *
 * <p>后端未索引该 workspace → 提示 "No index yet"，不报错。</p>
 */
export default function WorkspaceTopologySearch({ open, onClose, workspaceId, onPick }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open || !workspaceId) return
    let cancelled = false
    setLoading(true)
    setData(null)
    api.get(`/api/topology/${encodeURIComponent(workspaceId)}`)
      .then(r => {
        if (cancelled) return
        setData(r && r.data ? r.data : null)
      })
      .catch(e => {
        if (cancelled) return
        setData({ status: 'ERROR', error: e && e.message })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, workspaceId])

  const filtered = useMemo(() => {
    if (!data || !Array.isArray(data.fqcns)) return []
    if (!q || !q.trim()) return data.fqcns.slice(0, 50)
    const needle = q.toLowerCase()
    return data.fqcns.filter(f => String(f).toLowerCase().includes(needle)).slice(0, 200)
  }, [data, q])

  return (
    <Modal
      title={<Space><ApiOutlined /> 工作区拓扑索引 — {workspaceId || '?'}</Space>}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={620}
      destroyOnClose
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="输入 FQCN / 类名 / 关键字 (e.g. OrderController)"
        value={q}
        onChange={e => setQ(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      {loading && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
      {!loading && data && data.status === 'EMPTY' && (
        <Empty description="No index yet for this workspace (read some files first)" />
      )}
      {!loading && data && data.status === 'ERROR' && (
        <Empty description={`加载失败: ${data.error || 'unknown'}`} />
      )}
      {!loading && data && data.status === 'OK' && (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color="blue">file: {data.fileCount}</Tag>
            <Tag color="green">controller: {data.controllerCount}</Tag>
            <Tag color="purple">service: {data.serviceCount}</Tag>
            <Tag color="orange">mapper: {data.mapperCount}</Tag>
            <Tag>total fqcn: {data.totalFqcn}</Tag>
          </Space>
          <List
            size="small"
            dataSource={filtered}
            locale={{ emptyText: '无匹配' }}
            renderItem={(item) => (
              <List.Item
                style={{ cursor: onPick ? 'pointer' : 'default' }}
                onClick={() => onPick && onPick(item)}
              >
                <FileOutlined style={{ marginRight: 6, color: '#888' }} />
                <Text code style={{ fontSize: 12 }}>{item}</Text>
              </List.Item>
            )}
            style={{ maxHeight: 360, overflowY: 'auto' }}
          />
        </>
      )}
    </Modal>
  )
}
