import { Space, Tag, Dropdown, Divider, Typography } from 'antd'
import {
  TeamOutlined, RiseOutlined, FileDoneOutlined, ThunderboltOutlined,
  DownOutlined, CheckOutlined, CloseOutlined, SolutionOutlined,
  PhoneOutlined, DollarOutlined, BarChartOutlined
} from '@ant-design/icons'

const { Text } = Typography

/**
 * CRM 快速操作栏 — 选中后显示 chip, 用户输入内容后点发送.
 *
 * 对标 ErpQuickActions: 标签作为"意图声明"前缀拼到用户输入前,
 * 后端 CRMIntentDetector 看到关键词立即命中 (0 LLM 意图调用).
 *
 * 3 类入口:
 *   - 查询: 查客户 / 查商机 / 查合同 / 查回款
 *   - 跟进: 加跟进记录
 *   - 推进: 推进商机阶段
 *
 * Props: 同 ErpQuickActions
 */
const CATEGORIES = [
  {
    key: 'query',
    label: '查询',
    icon: <BarChartOutlined />,
    color: '#1677ff',
    items: [
      { key: 'QUERY_CUSTOMER',     label: '查客户',   text: '查询客户', icon: <TeamOutlined />,        desc: '可附加: 客户名/简称' },
      { key: 'QUERY_OPPORTUNITY',  label: '查商机',   text: '查询商机', icon: <RiseOutlined />,         desc: '可附加: 商机名/客户名' },
      { key: 'QUERY_CONTRACT',     label: '查合同',   text: '查询合同', icon: <FileDoneOutlined />,     desc: '可附加: 合同号/客户名; 加"明细"看回款' },
      { key: 'QUERY_FOLLOW_UP',    label: '查跟进',   text: '查询跟进记录', icon: <SolutionOutlined />, desc: '可附加: 客户名/商机名' }
    ]
  },
  {
    key: 'followUp',
    label: '跟进',
    icon: <PhoneOutlined />,
    color: '#52c41a',
    items: [
      { key: 'CREATE_FOLLOW_UP_CUSTOMER',    label: '给客户加跟进',   text: '给客户加一条跟进:', icon: <PhoneOutlined />,    desc: '选完后输入 客户名 + 跟进内容后发送' },
      { key: 'CREATE_FOLLOW_UP_OPPORTUNITY', label: '给商机加跟进',   text: '给商机加一条跟进:', icon: <PhoneOutlined />,    desc: '选完后输入 商机名 + 跟进内容后发送' }
    ]
  },
  {
    key: 'advance',
    label: '推进',
    icon: <ThunderboltOutlined />,
    color: '#faad14',
    items: [
      { key: 'ADVANCE_REQUIREMENT',  label: '推进到需求确认', text: '把商机推进到需求确认:', icon: <RiseOutlined />,   desc: '选完后输入 商机名 后发送' },
      { key: 'ADVANCE_PROPOSAL',     label: '推进到方案报价', text: '把商机推进到方案报价:', icon: <RiseOutlined />,   desc: '选完后输入 商机名 后发送' },
      { key: 'ADVANCE_NEGOTIATION',  label: '推进到谈判',     text: '把商机推进到谈判:',     icon: <RiseOutlined />,   desc: '选完后输入 商机名 后发送' },
      { key: 'ADVANCE_WON',          label: '标记赢单',       text: '把商机推进到赢单:',     icon: <DollarOutlined />, desc: '选完后输入 商机名 后发送' }
    ]
  }
]

export function CrmQuickActions({ selected, onSelect, onClear, currentInput, onSend, disabled = false, inputRef }) {
  const handleItemClick = (item, cat) => {
    if (disabled) return
    onSelect && onSelect({
      key: item.key,
      label: item.label,
      text: item.text,
      category: cat.key,
      color: cat.color,
      icon: item.icon,
      desc: item.desc
    })
    setTimeout(() => inputRef?.current?.focus?.(), 50)
  }

  return (
    <div
      style={{
        background: '#0d0d0d',
        borderTop: '1px solid #1f1f1f',
        borderBottom: selected ? '1px solid #2a2a2a' : '1px solid #1f1f1f',
        padding: '6px 24px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }}
    >
      {/* ── 顶部: 标签栏 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <ThunderboltOutlined style={{ color: '#faad14', fontSize: 12, marginRight: 4 }} />
        <Text style={{ color: '#888', fontSize: 11, marginRight: 4 }}>快速操作</Text>
        {CATEGORIES.map(cat => (
          <Dropdown
            key={cat.key}
            trigger={['click']}
            placement="topRight"
            menu={{
              items: cat.items.map(it => ({
                key: it.key,
                label: (
                  <div
                    onClick={() => handleItemClick(it, cat)}
                    style={{ minWidth: 200, padding: '2px 0' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: cat.color, fontSize: 14 }}>{it.icon}</span>
                      <Text style={{ color: '#e3e3e3', fontSize: 13 }}>{it.label}</Text>
                      {selected?.key === it.key && (
                        <CheckOutlined style={{ color: cat.color, fontSize: 12 }} />
                      )}
                    </div>
                    <Text style={{ color: '#888', fontSize: 11, marginTop: 2, display: 'block' }}>
                      {it.desc}
                    </Text>
                  </div>
                )
              }))
            }}
          >
            <Tag
              color="default"
              style={{
                cursor: 'pointer',
                userSelect: 'none',
                padding: '2px 10px',
                background: selected?.category === cat.key ? cat.color : '#1a1a1a',
                borderColor: selected?.category === cat.key ? cat.color : '#2a2a2a',
                color: selected?.category === cat.key ? '#fff' : '#bbb',
                fontSize: 12
              }}
            >
              <Space size={4}>
                <span style={{ color: selected?.category === cat.key ? '#fff' : cat.color }}>{cat.icon}</span>
                <span>{cat.label}</span>
                <DownOutlined style={{ fontSize: 9 }} />
              </Space>
            </Tag>
          </Dropdown>
        ))}
        <Divider orientation="vertical" style={{ background: '#1f1f1f', height: 18, margin: '0 4px' }} />
        <Text style={{ color: '#666', fontSize: 11 }}>
          {selected ? '👇 继续输入内容, 然后点发送' : '选标签声明意图, 不直接发送'}
        </Text>
      </div>

      {/* ── 选中后: 显示当前 chip + 预览 ── */}
      {selected && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 8px',
            background: 'rgba(22, 119, 255, 0.08)',
            border: `1px solid ${selected.color}40`,
            borderRadius: 4,
            marginTop: 2
          }}
        >
          <Text style={{ color: '#888', fontSize: 11 }}>当前操作</Text>
          <Tag
            closable
            closeIcon={<CloseOutlined style={{ fontSize: 10 }} />}
            onClose={(e) => { e.preventDefault(); onClear && onClear() }}
            color={selected.color}
            style={{ margin: 0, fontSize: 12, padding: '1px 8px' }}
          >
            <Space size={4}>
              {selected.icon}
              <span>{selected.label}</span>
            </Space>
          </Tag>
          <Text style={{ color: '#aaa', fontSize: 11, flex: 1 }}>{selected.desc}</Text>
        </div>
      )}
    </div>
  )
}

export default CrmQuickActions
