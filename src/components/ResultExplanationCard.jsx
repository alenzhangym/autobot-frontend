import { Card, Tag, Typography, Space, Divider } from 'antd'
import {
  InfoCircleOutlined, FilterOutlined, StopOutlined, DatabaseOutlined
} from '@ant-design/icons'

const { Text } = Typography

/**
 * ResultExplanationCard — 结构化结果解释卡片 (§9.6 P2-3).
 *
 * <p>渲染后端 AgentResult.metadata.explanation:
 * <ul>
 *   <li>appliedConditions — 应用的筛选条件列表</li>
 *   <li>excludedObjects — 排除的对象列表</li>
 *   <li>dataSource — 数据来源 (ERP/CRM)</li>
 * </ul>
 *
 * <p>取代之前追加到 payload 文本的 "📋 结果说明: ..." 行,
 * 提升为独立可视化卡片, 前端可自行控制排版与交互.
 *
 * @param {object} explanation — 结构化解释 { appliedConditions?, excludedObjects?, dataSource? }
 */
export default function ResultExplanationCard({ explanation }) {
  if (!explanation) return null

  const {
    appliedConditions = [],
    excludedObjects = [],
    dataSource = null
  } = explanation

  const hasAny = appliedConditions.length > 0 || excludedObjects.length > 0 || dataSource

  if (!hasAny) return null

  return (
    <Card
      size="small"
      style={{ marginTop: 8, marginBottom: 8, background: '#faffaf' }}
      title={
        <Space>
          <InfoCircleOutlined style={{ color: '#1677ff' }} />
          <Text strong style={{ fontSize: 13 }}>结果说明</Text>
        </Space>
      }
    >
      {appliedConditions.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Space align="start">
            <FilterOutlined style={{ color: '#52c41a', marginTop: 2 }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>应用条件</Text>
              <div style={{ marginTop: 2 }}>
                {appliedConditions.map((cond, i) => (
                  <Tag key={i} color="green" style={{ marginBottom: 2, fontSize: 12 }}>
                    {cond}
                  </Tag>
                ))}
              </div>
            </div>
          </Space>
        </div>
      )}

      {excludedObjects.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Space align="start">
            <StopOutlined style={{ color: '#ff4d4f', marginTop: 2 }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>已排除</Text>
              <div style={{ marginTop: 2 }}>
                {excludedObjects.map((obj, i) => (
                  <Tag key={i} color="red" style={{ marginBottom: 2, fontSize: 12 }}>
                    {obj}
                  </Tag>
                ))}
              </div>
            </div>
          </Space>
        </div>
      )}

      {dataSource && (
        <div>
          <Space>
            <DatabaseOutlined style={{ color: '#722ed1' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>数据来源:</Text>
            <Tag color="purple" style={{ fontSize: 12 }}>{dataSource}</Tag>
          </Space>
        </div>
      )}
    </Card>
  )
}
