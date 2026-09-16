import { Card, Tag, Typography, Space } from 'antd'
import { AimOutlined, PartitionOutlined, SwapOutlined } from '@ant-design/icons'

const { Text } = Typography

/**
 * ParamSourceCard — 参数来源结构化卡片 (§7.6 方案七 P2 + G9 参数级解释).
 *
 * <p>渲染后端 AgentResult.metadata.paramSources:
 * <ul>
 *   <li>List<{stepId, action, params: [{name, source, mappedFrom?, dependsOnSteps?}]}> — 写步骤参数来源列表</li>
 *   <li>source 取值: grounding (语义解析+实体解析) / llm (LLM 生成的 plan) / cross-domain (跨域回传)
 *       / dataflow (读步骤输出映射, G9)</li>
 *   <li>mappedFrom — 字段映射说明 (如 "part_model → part_id"), 仅 dataflow 参数携带</li>
 *   <li>dependsOnSteps — 依赖的前置步骤 ID 列表 (依赖链)</li>
 * </ul>
 *
 * @param {Array} paramSources — 写步骤参数来源列表
 */
export default function ParamSourceCard({ paramSources }) {
  if (!paramSources || !Array.isArray(paramSources) || paramSources.length === 0) return null

  const sourceColor = (src) => {
    if (src === 'grounding') return 'green'
    if (src === 'llm') return 'blue'
    if (src === 'cross-domain') return 'purple'
    if (src === 'dataflow') return 'cyan'
    return 'default'
  }

  const sourceLabel = (src) => {
    if (src === 'grounding') return '语义解析'
    if (src === 'llm') return 'LLM 推断'
    if (src === 'cross-domain') return '跨域回传'
    if (src === 'dataflow') return '读步骤映射'
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
        以下写步骤的参数来自语义解析、跨域回传、读步骤输出映射或 LLM 推断, 帮助理解 AI 决策依据.
      </Text>
      {paramSources.map((entry, idx) => (
        <div key={idx} style={{ marginBottom: idx < paramSources.length - 1 ? 12 : 0 }}>
          <Space style={{ marginBottom: 4 }}>
            <Tag color="orange" style={{ fontSize: 12 }}>{entry.stepId}</Tag>
            <Text strong style={{ fontSize: 12 }}>{entry.action}</Text>
          </Space>
          <div style={{ paddingLeft: 8 }}>
            {entry.params.map((p, pidx) => (
              <div key={pidx} style={{ marginBottom: 2 }}>
                <Tag
                  color={sourceColor(p.source)}
                  style={{ fontSize: 12, marginBottom: 2 }}
                >
                  {p.name}: {sourceLabel(p.source)}
                </Tag>
                {p.mappedFrom && (
                  <Tag color="geekblue" icon={<SwapOutlined />} style={{ fontSize: 12, marginBottom: 2 }}>
                    {p.mappedFrom}
                  </Tag>
                )}
                {p.dependsOnSteps && Array.isArray(p.dependsOnSteps) && p.dependsOnSteps.length > 0 && (
                  <Tag color="volcano" icon={<PartitionOutlined />} style={{ fontSize: 12, marginBottom: 2 }}>
                    依赖 {p.dependsOnSteps.join(', ')}
                  </Tag>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </Card>
  )
}
