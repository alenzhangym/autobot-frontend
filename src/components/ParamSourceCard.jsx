import { Card, Tag, Typography, Space, Table } from 'antd'
import { AimOutlined } from '@ant-design/icons'

const { Text } = Typography

/**
 * ParamSourceCard — 参数来源结构化卡片 (§7.6 方案七 P2).
 *
 * <p>渲染后端 AgentResult.metadata.paramSources:
 * <ul>
 *   <li>List<{stepId, action, params: [{name, source}]}> — 写步骤参数来源列表</li>
 *   <li>source 取值: grounding (语义解析+实体解析) / llm (LLM 生成的 plan)</li>
 * </ul>
 *
 * <p>取代之前追加到 payload 文本的 "🔍 参数来源: ..." 行,
 * 提升为独立可视化卡片, 按步骤分组渲染每个参数的来源标签.
 *
 * @param {Array} paramSources — 写步骤参数来源列表
 */
export default function ParamSourceCard({ paramSources }) {
  if (!paramSources || !Array.isArray(paramSources) || paramSources.length === 0) return null

  const sourceColor = (src) => {
    if (src === 'grounding') return 'green'
    if (src === 'llm') return 'blue'
    if (src === 'default') return 'default'
    return 'default'
  }

  const sourceLabel = (src) => {
    if (src === 'grounding') return '语义解析'
    if (src === 'llm') return 'LLM 推断'
    if (src === 'default') return '默认值'
    return src
  }

  return (
    <Card
      size="small"
      style={{ marginTop: 8, marginBottom: 8, background: '#f6ffed' }}
      title={
        <Space>
          <AimOutlined style={{ color: '#52c41a' }} />
          <Text strong style={{ fontSize: 13 }}>参数来源追踪</Text>
        </Space>
      }
    >
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        以下写步骤的参数来自语义解析或 LLM 推断, 帮助理解 AI 决策依据.
      </Text>
      {paramSources.map((entry, idx) => (
        <div key={idx} style={{ marginBottom: idx < paramSources.length - 1 ? 12 : 0 }}>
          <Space style={{ marginBottom: 4 }}>
            <Tag color="orange" style={{ fontSize: 12 }}>{entry.stepId}</Tag>
            <Text strong style={{ fontSize: 12 }}>{entry.action}</Text>
          </Space>
          <div style={{ paddingLeft: 8 }}>
            {entry.params.map((p, pidx) => (
              <Tag
                key={pidx}
                color={sourceColor(p.source)}
                style={{ marginBottom: 2, fontSize: 12 }}
              >
                {p.name}: {sourceLabel(p.source)}
              </Tag>
            ))}
          </div>
        </div>
      ))}
    </Card>
  )
}
