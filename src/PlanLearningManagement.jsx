import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Table, Button, Modal, Tag, Space, message, Card, Row, Col, Tooltip, Typography, Input, Statistic, Descriptions, Collapse } from 'antd'
import { ReloadOutlined, EyeOutlined, WarningOutlined, CheckOutlined, CloseOutlined, ExportOutlined, ExperimentOutlined } from '@ant-design/icons'
import { Resizable } from 'react-resizable'
import 'react-resizable/css/styles.css'
import api from './auth'
import { isSuperAdmin as isSuperAdminFn } from './utils/permissions.js'

const { Content } = Layout
const { Text, Paragraph } = Typography

const ResizableTitle = (props) => {
  const { onResize, width, ...restProps } = props
  if (!width) return <th {...restProps} />
  return (
    <Resizable width={width} height={0} onResize={onResize} draggableOpts={{ enableUserSelectHack: false }}>
      <th {...restProps} />
    </Resizable>
  )
}

const STATUS_COLORS = {
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
}

export default function PlanLearningManagement({ user }) {
  const isSuperAdmin = isSuperAdminFn(user)

  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({ PENDING: 0, APPROVED: 0, REJECTED: 0 })
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selected, setSelected] = useState(null)
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [colWidths, setColWidths] = useState({
    createdAt: 160, userGoal: 300, schemaMode: 90, stepCount: 70,
    username: 100, status: 90, action: 160,
  })

  const fetchPending = useCallback(async () => {
    if (!isSuperAdmin) return
    setLoading(true)
    try {
      const res = await api.get('/erp/learning/pending', { params: { page, size: pageSize } })
      const payload = res.data?.data || res.data || {}
      setRows(payload.data || [])
    } catch (e) {
      if (e.response?.status === 403) {
        message.error('需要 SUPER_ADMIN 权限')
      } else {
        message.error('加载失败: ' + (e.response?.data?.error || e.message))
      }
      setRows([])
    } finally { setLoading(false) }
  }, [page, pageSize, isSuperAdmin])

  const fetchStats = useCallback(async () => {
    if (!isSuperAdmin) return
    try {
      const res = await api.get('/erp/learning/statistics')
      const payload = res.data?.data || res.data || {}
      setStats(payload)
    } catch (e) {
      // 静默
    }
  }, [isSuperAdmin])

  useEffect(() => {
    fetchPending()
    fetchStats()
  }, [fetchPending, fetchStats])

  const handleApprove = async (id) => {
    try {
      await api.post(`/erp/learning/${id}/approve`, { note: '' })
      message.success(`Plan #${id} 已确认, 训练样本已生成`)
      fetchPending()
      fetchStats()
    } catch (e) {
      message.error('确认失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleReject = async () => {
    if (!rejectModal) return
    try {
      await api.post(`/erp/learning/${rejectModal.id}/reject`, { note: rejectNote })
      message.success(`Plan #${rejectModal.id} 已标记错误`)
      setRejectModal(null)
      setRejectNote('')
      fetchPending()
      fetchStats()
    } catch (e) {
      message.error('操作失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const handleExport = async () => {
    try {
      const res = await api.post('/erp/learning/export')
      const payload = res.data?.data || res.data || {}
      message.success(`已导出 ${payload.exported || 0} 条训练样本`)
      fetchStats()
    } catch (e) {
      message.error('导出失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const openDetail = async (r) => {
    try {
      const res = await api.get(`/erp/learning/${r.id}`)
      const payload = res.data?.data || res.data || {}
      setSelected(payload)
      setShowDetailModal(true)
    } catch (e) {
      message.error('加载详情失败: ' + (e.response?.data?.error || e.message))
    }
  }

  const columns = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: colWidths.createdAt,
      render: v => v ? <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleString('zh-CN')}</Text> : '-',
    },
    { title: '用户问题', dataIndex: 'userGoal', key: 'userGoal', width: colWidths.userGoal,
      ellipsis: true,
      render: v => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Schema', dataIndex: 'schemaMode', key: 'schemaMode', width: colWidths.schemaMode,
      render: v => <Tag>{v || '-'}</Tag>,
    },
    { title: '步数', dataIndex: 'stepCount', key: 'stepCount', width: colWidths.stepCount,
      render: v => v || '-',
    },
    { title: '用户', dataIndex: 'username', key: 'username', width: colWidths.username,
      render: v => v || '-',
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: colWidths.status,
      render: v => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag>,
    },
    { title: '操作', key: 'action', width: colWidths.action, fixed: 'right',
      render: (_, r) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)}>详情</Button>
          {r.status === 'PENDING' && (
            <>
              <Tooltip title="确认 plan 正确, 生成训练样本">
                <Button size="small" type="primary" icon={<CheckOutlined />}
                  onClick={() => handleApprove(r.id)}>确认</Button>
              </Tooltip>
              <Button size="small" danger icon={<CloseOutlined />}
                onClick={() => { setRejectModal(r); setRejectNote('') }}>拒绝</Button>
            </>
          )}
        </Space>
      ),
    },
  ]

  const components = { header: { cell: ResizableTitle } }
  const handleResize = (key) => (e, { size }) => {
    setColWidths(prev => ({ ...prev, [key]: size.width }))
  }
  const colsWithResize = columns.map((col, idx) => ({
    ...col,
    onHeaderCell: () => ({
      width: col.width,
      onResize: handleResize(Object.keys(colWidths)[idx]),
    }),
  }))

  if (!isSuperAdmin) {
    return (
      <Layout style={{ background: '#0d0d0d', height: '100%' }}>
        <Content style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: '#ff4d4f', fontSize: 16, marginTop: 60 }}>
            <WarningOutlined style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            模型在线学习审核仅对 SUPER_ADMIN 开放
            <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>当前角色: {user?.role || '未知'}</div>
          </div>
        </Content>
      </Layout>
    )
  }

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%', overflow: 'hidden' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <h2 style={{ color: '#e3e3e3', margin: 0 }}>
              <ExperimentOutlined style={{ marginRight: 8 }} />
              模型在线学习审核
            </h2>
          </Col>
          <Col>
            <Space>
              <Button icon={<ExportOutlined />} onClick={handleExport}>批量导出</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { fetchPending(); fetchStats() }}>刷新</Button>
            </Space>
          </Col>
        </Row>

        {/* 统计卡片 */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
              <Statistic
                title="待审核"
                value={stats.PENDING || 0}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
              <Statistic
                title="已确认 (生成训练样本)"
                value={stats.APPROVED || 0}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small" style={{ background: '#141414', border: '1px solid #222' }}>
              <Statistic
                title="已拒绝"
                value={stats.REJECTED || 0}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
        </Row>

        <Card size="small" style={{ marginBottom: 12, background: '#1a1a1a', border: '1px solid #333' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            执行成功的 ERP/CRM plan 会自动进入待审核队列。确认正确后系统会生成 LoRA 训练样本，
            积累足够样本后可离线重训模型，让模型越用越准确。
          </Text>
        </Card>

        <Table
          dataSource={rows}
          columns={colsWithResize}
          rowKey="id"
          loading={loading}
          components={components}
          scroll={{ x: 1100 }}
          size="small"
          pagination={{
            current: page, pageSize, total: rows.length,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100'],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />

        {/* 详情 Modal */}
        <Modal
          title={`Plan #${selected?.id || ''} 详情`}
          open={showDetailModal}
          onCancel={() => setShowDetailModal(false)}
          footer={selected?.status === 'PENDING' ? [
            <Button key="reject" danger icon={<CloseOutlined />}
              onClick={() => { setRejectModal(selected); setRejectNote(''); setShowDetailModal(false) }}>
              拒绝
            </Button>,
            <Button key="approve" type="primary" icon={<CheckOutlined />}
              onClick={() => { handleApprove(selected.id); setShowDetailModal(false) }}>
              确认正确
            </Button>,
          ] : [<Button key="close" onClick={() => setShowDetailModal(false)}>关闭</Button>]}
          width={900}
        >
          {selected && (
            <div style={{ fontSize: 13 }}>
              <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
                <Descriptions.Item label="状态" span={1}>
                  <Tag color={STATUS_COLORS[selected.status]}>{selected.status}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Schema 模式" span={1}>
                  <Tag>{selected.schemaMode}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="用户" span={1}>{selected.username || '-'}</Descriptions.Item>
                <Descriptions.Item label="步数" span={1}>{selected.stepCount}</Descriptions.Item>
                <Descriptions.Item label="会话 ID" span={2}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{selected.sessionId}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="创建时间" span={1}>
                  {selected.createdAt ? new Date(selected.createdAt).toLocaleString('zh-CN') : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="审核人" span={1}>{selected.reviewedBy || '-'}</Descriptions.Item>
                {selected.reviewNote && (
                  <Descriptions.Item label="审核备注" span={2}>{selected.reviewNote}</Descriptions.Item>
                )}
              </Descriptions>

              <Text strong>用户问题:</Text>
              <div style={{ margin: '4px 0 12px', padding: 8, background: '#0d0d0d', border: '1px solid #222', borderRadius: 4 }}>
                {selected.userGoal}
              </div>

              <Text strong>LLM 生成的 Plan:</Text>
              <pre style={{
                margin: '4px 0 12px', padding: 12, background: '#0d0d0d',
                border: '1px solid #222', borderRadius: 4,
                fontFamily: 'monospace', fontSize: 12,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 300, overflow: 'auto',
              }}>
                {(() => {
                  try { return JSON.stringify(JSON.parse(selected.planJson), null, 2) }
                  catch { return selected.planJson }
                })()}
              </pre>

              <Text strong>执行步骤结果:</Text>
              <Collapse size="small" style={{ marginTop: 4 }}
                items={[{
                  key: 'steps',
                  label: `${selected.stepCount} 个步骤`,
                  children: (
                    <pre style={{
                      padding: 8, background: '#0d0d0d', borderRadius: 4,
                      fontFamily: 'monospace', fontSize: 12,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      maxHeight: 200, overflow: 'auto',
                    }}>
                      {(() => {
                        try { return JSON.stringify(JSON.parse(selected.stepResults), null, 2) }
                        catch { return selected.stepResults }
                      })()}
                    </pre>
                  ),
                }]}
              />

              {selected.systemPrompt && (
                <>
                  <Text strong style={{ marginTop: 12, display: 'block' }}>System Prompt (训练样本上下文):</Text>
                  <Collapse size="small" style={{ marginTop: 4 }}
                    items={[{
                      key: 'sysprompt',
                      label: '展开查看 (用于 LoRA 重训)',
                      children: (
                        <pre style={{
                          padding: 8, background: '#0d0d0d', borderRadius: 4,
                          fontFamily: 'monospace', fontSize: 11,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                          maxHeight: 300, overflow: 'auto',
                        }}>
                          {selected.systemPrompt}
                        </pre>
                      ),
                    }]}
                  />
                </>
              )}
            </div>
          )}
        </Modal>

        {/* 拒绝 Modal */}
        <Modal
          title={`拒绝 Plan #${rejectModal?.id || ''}`}
          open={!!rejectModal}
          onCancel={() => { setRejectModal(null); setRejectNote('') }}
          footer={[
            <Button key="cancel" onClick={() => { setRejectModal(null); setRejectNote('') }}>取消</Button>,
            <Button key="reject" type="primary" danger icon={<CloseOutlined />} onClick={handleReject}>
              确认拒绝
            </Button>,
          ]}
        >
          <Input.TextArea
            placeholder="拒绝原因 (可选)"
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            rows={3}
          />
        </Modal>
      </Content>
    </Layout>
  )
}
