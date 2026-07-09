import { Card, Tag, Typography, Space, Divider } from 'antd'
import {
  ApartmentOutlined, ShoppingCartOutlined, TrophyOutlined, LinkOutlined
} from '@ant-design/icons'

const { Text } = Typography

/**
 * CrossDomainEntityCard — 跨域实体聚合卡片 (§7.6 方案七 P2).
 *
 * <p>渲染后端 AgentResult.metadata.crossDomainEntities:
 * <ul>
 *   <li>customers: string[] — CRM 客户名列表</li>
 *   <li>orders: string[] — ERP 订单号列表 (PO-/SO-/REC-)</li>
 *   <li>opportunities: string[] — CRM 商机名列表</li>
 *   <li>hasCrossDomainRelation: bool — 是否存在跨域关联 (客户 ↔ 订单)</li>
 * </ul>
 *
 * <p>取代之前追加到 payload 文本的 "### 关联实体聚合视图" 块,
 * 提升为独立可视化卡片, 展示跨 CRM/ERP 实体关联关系.
 *
 * @param {object} entities — 跨域实体聚合数据
 */
export default function CrossDomainEntityCard({ entities }) {
  if (!entities) return null

  const {
    customers = [],
    orders = [],
    opportunities = [],
    hasCrossDomainRelation = false
  } = entities

  const hasAny = customers.length > 0 || orders.length > 0 || opportunities.length > 0
  if (!hasAny) return null

  return (
    <Card
      size="small"
      style={{ marginTop: 8, marginBottom: 8, background: '#e6f4ff' }}
      title={
        <Space>
          <ApartmentOutlined style={{ color: '#1677ff' }} />
          <Text strong style={{ fontSize: 13 }}>跨域关联实体</Text>
        </Space>
      }
    >
      {customers.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Space align="start">
            <ApartmentOutlined style={{ color: '#722ed1', marginTop: 2 }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>客户 (CRM)</Text>
              <div style={{ marginTop: 2 }}>
                {customers.map((c, i) => (
                  <Tag key={i} color="purple" style={{ marginBottom: 2, fontSize: 12 }}>
                    {c}
                  </Tag>
                ))}
              </div>
            </div>
          </Space>
        </div>
      )}

      {opportunities.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Space align="start">
            <TrophyOutlined style={{ color: '#fa8c16', marginTop: 2 }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>商机 (CRM)</Text>
              <div style={{ marginTop: 2 }}>
                {opportunities.map((o, i) => (
                  <Tag key={i} color="orange" style={{ marginBottom: 2, fontSize: 12 }}>
                    {o}
                  </Tag>
                ))}
              </div>
            </div>
          </Space>
        </div>
      )}

      {orders.length > 0 && (
        <div style={{ marginBottom: hasCrossDomainRelation ? 8 : 0 }}>
          <Space align="start">
            <ShoppingCartOutlined style={{ color: '#52c41a', marginTop: 2 }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>订单 (ERP)</Text>
              <div style={{ marginTop: 2 }}>
                {orders.map((o, i) => (
                  <Tag key={i} color="green" style={{ marginBottom: 2, fontSize: 12 }}>
                    {o}
                  </Tag>
                ))}
              </div>
            </div>
          </Space>
        </div>
      )}

      {hasCrossDomainRelation && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Space>
            <LinkOutlined style={{ color: '#1677ff' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              上述客户与订单跨 CRM/ERP 两域关联, 可结合客户关系与订单履约状态做综合决策.
            </Text>
          </Space>
        </>
      )}
    </Card>
  )
}
