import { Card, Tag, Typography, Descriptions, Steps, Alert, Space, Input } from 'antd'
import {
  CheckCircleOutlined, ExclamationCircleOutlined, WarningOutlined,
  SearchOutlined, EditOutlined, SafetyCertificateOutlined, FileSearchOutlined
} from '@ant-design/icons'
import { useState } from 'react'

const { Text, Paragraph } = Typography

/**
 * PlanPreviewCard — 执行前结构化预览 (§5.6.2).
 *
 * <p>渲染后端 PlanPreview record: title/explanation/steps/impactScope/riskWarning/requiresConfirmation.
 * 用于 HIGH 风险写操作确认场景, 在用户确认前展示"系统理解了什么、准备怎么做".
 *
 * <p>§9.2 差距修复: keyParams 支持局部修改 — 每个关键参数渲染为内联 Input,
 * 用户可在确认前修改参数值, 编辑后的参数随确认回复传回后端.
 *
 * @param {object} preview - PlanPreview record (后端 JSON 反序列化)
 * @param {function} onConfirm - 用户点击"确认执行"; 接收 editedParams (可为空对象)
 * @param {function} onCancel  - 用户点击"取消"
 * @param {boolean}  loading   - 确认请求进行中 (禁用按钮)
 */
export default function PlanPreviewCard({ preview, onConfirm, onCancel, loading }) {
  // §9.2 编辑后的参数: { stepIndex: { paramName: newValue } }
  const [editedParams, setEditedParams] = useState({})

  if (!preview) return null

  const {
    title = '执行前预览',
    explanation = '',
    steps = [],
    impactScope = '',
    riskWarning = '',
    requiresConfirmation = false
  } = preview

  // 步骤图标映射
  const stepIcon = (type, riskLevel) => {
    if (riskLevel === 'HIGH') return <WarningOutlined style={{ color: '#ff4d4f' }} />
    const t = (type || '').toLowerCase()
    if (t.includes('read') || t.includes('search') || t.includes('query')) return <SearchOutlined />
    if (t.includes('write') || t.includes('create') || t.includes('update')) return <EditOutlined />
    if (t.includes('verify')) return <SafetyCertificateOutlined />
    return <FileSearchOutlined />
  }

  // 风险等级标签颜色
  const riskColor = (level) => {
    if (!level) return 'default'
    const l = level.toUpperCase()
    if (l === 'HIGH') return 'red'
    if (l === 'MEDIUM') return 'orange'
    return 'green'
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: requiresConfirmation ? '#fa8c16' : '#1677ff' }} />
          <Text strong>{title}</Text>
          {requiresConfirmation && <Tag color="red">需确认</Tag>}
        </Space>
      }
      style={{ margin: '8px 0', border: requiresConfirmation ? '1px solid #ffa39e' : '1px solid #d9d9d9' }}
    >
      {/* 解释段 */}
      {explanation && (
        <Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
          {explanation}
        </Paragraph>
      )}

      {/* 步骤预览 */}
      {steps && steps.length > 0 && (
        <Steps
          size="small"
          direction="vertical"
          style={{ marginBottom: 12 }}
          items={steps.map((s, idx) => ({
            title: (
              <Space size={4}>
                <Text strong style={{ fontSize: 13 }}>{s.stepLabel || `步骤 ${idx + 1}`}</Text>
                {s.riskLevel && <Tag color={riskColor(s.riskLevel)} style={{ fontSize: 10 }}>{s.riskLevel}</Tag>}
              </Space>
            ),
            description: (
              <div style={{ fontSize: 12 }}>
                {s.operation && <div><Text type="secondary">操作:</Text> {s.operation}</div>}
                {s.target && <div><Text type="secondary">对象:</Text> {s.target}</div>}
                {s.keyParams && Object.keys(s.keyParams).length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary">参数 (可修改):</Text>
                    <div style={{ marginTop: 2 }}>
                      {Object.entries(s.keyParams).map(([k, v]) => (
                        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, marginBottom: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>{k}:</Text>
                          <Input
                            size="small"
                            defaultValue={String(v ?? '')}
                            style={{ width: 140, marginLeft: 4, fontSize: 12 }}
                            onChange={(e) => {
                              const newVal = e.target.value
                              setEditedParams(prev => ({
                                ...prev,
                                [idx]: { ...(prev[idx] || {}), [k]: newVal }
                              }))
                            }}
                          />
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ),
            icon: stepIcon(s.type, s.riskLevel)
          }))}
        />
      )}

      {/* 影响范围 */}
      {impactScope && (
        <Descriptions size="small" column={1} style={{ marginBottom: 8 }}>
          <Descriptions.Item label="影响范围">
            <Text style={{ fontSize: 12 }}>{impactScope}</Text>
          </Descriptions.Item>
        </Descriptions>
      )}

      {/* 风险提示 */}
      {riskWarning && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={<Text style={{ fontSize: 12 }}>{riskWarning}</Text>}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* 确认/取消按钮 */}
      {requiresConfirmation && onConfirm && (
        <Space style={{ marginTop: 4 }}>
          <Tag
            color="green"
            style={{ cursor: loading ? 'wait' : 'pointer', padding: '4px 16px', fontSize: 13 }}
            onClick={loading ? undefined : () => onConfirm(editedParams)}
          >
            <CheckCircleOutlined /> 确认执行
          </Tag>
          <Tag
            color="red"
            style={{ cursor: loading ? 'wait' : 'pointer', padding: '4px 16px', fontSize: 13 }}
            onClick={loading ? undefined : onCancel}
          >
            取消
          </Tag>
        </Space>
      )}
    </Card>
  )
}
