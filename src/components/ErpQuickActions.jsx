import { useState } from 'react'
import { Space, Tag, Dropdown, Divider, Typography } from 'antd'
import {
  ShoppingCartOutlined, ShoppingOutlined, ImportOutlined, ExportOutlined,
  RiseOutlined, SendOutlined, AuditOutlined, UserAddOutlined, ShopOutlined,
  PartitionOutlined, ThunderboltOutlined, DownOutlined, BarChartOutlined,
  FileDoneOutlined, HistoryOutlined, CloseOutlined, CheckOutlined
} from '@ant-design/icons'

const { Text } = Typography

/**
 * ERP 快速操作栏 — 选中后显示 chip, 用户输入内容后点发送.
 *
 * 设计动机: 用户粘贴大量 CSV/Excel 内容时, 不应该让 LLM 先做意图识别.
 * 这里提供 3 类快捷入口, 选标签只是"声明意图" (类似 reply_context 标记),
 * 标签会作为前缀拼到用户最终发送的文本前:
 *   "[标签]\n[用户输入的内容]"
 *
 * 后端 ERPIntentDetector 的 keyword 路径会立即命中 (hasXxxKw + hasManageVerb),
 * 0 LLM 意图分类. 选标签 ≠ 立刻发送, 让用户先看清自己选了什么, 再输入内容.
 *
 * Props:
 *   - selected: {key, label, text, category, color} | null  当前选中的标签
 *   - onSelect(action)     选中回调
 *   - onClear()            清除选中回调
 *   - currentInput         输入框当前内容 (用于 chip 预览)
 *   - onSend()             用户点发送的回调 — App.jsx 在这里做"标签 + 内容"拼装
 *   - disabled             全局 loading 状态
 *   - inputRef             父组件 textarea ref — 选中后自动 focus
 */

const CATEGORIES = [
  {
    key: 'orderEntry',
    label: '订单录入',
    icon: <FileDoneOutlined />,
    color: '#1677ff',
    items: [
      { key: 'SALES_ORDER', label: '新建销售单', text: '新建销售单', icon: <ShoppingCartOutlined />, desc: '选完后, 输入客户名+物料明细后发送' },
      { key: 'PURCHASE_ORDER', label: '新建采购单', text: '新建采购单', icon: <ShoppingOutlined />, desc: '粘贴上次采购建议表, 自动取缺口数量' },
      { key: 'INBOUND_ORDER', label: '新建入库单', text: '新建入库单', icon: <ImportOutlined />, desc: '选完后, 输入供应商+入库明细后发送' },
      { key: 'OUTBOUND_ORDER', label: '新建出库单', text: '新建出库单', icon: <ExportOutlined />, desc: '选完后, 输入出库明细后发送' }
    ]
  },
  {
    key: 'analysis',
    label: '数据分析',
    icon: <BarChartOutlined />,
    color: '#52c41a',
    items: [
      { key: 'PROCUREMENT_SUGGEST', label: '采购建议', text: '请分析现在的库存和未结订单, 给出需要采购的物料建议', icon: <RiseOutlined />, desc: '可附加: 关注哪些料, 限制金额' },
      { key: 'SHIP_RECOMMEND', label: '可发货订单', text: '请分析现在的销售单, 给出可以立即发货的订单推荐', icon: <SendOutlined />, desc: '可附加: 优先级, 截止日期' },
      { key: 'STOCK_QUERY', label: '库存查询', text: '查询当前所有物料的库存情况, 列出缺料物料', icon: <AuditOutlined />, desc: '可附加: 料号, 客户' }
    ]
  },
  {
    key: 'masterData',
    label: '主数据',
    icon: <PartitionOutlined />,
    color: '#faad14',
    items: [
      { key: 'NEW_SUPPLIER', label: '新增供应商', text: '新增供应商:', icon: <ShopOutlined />, desc: '选完后, 输入 名称 地址 联系人 后发送' },
      { key: 'NEW_CUSTOMER', label: '新增客户', text: '新增客户:', icon: <UserAddOutlined />, desc: '选完后, 输入 名称 地址 联系人 后发送' },
      { key: 'NEW_PART', label: '新增物料', text: '新增物料:', icon: <PartitionOutlined />, desc: '选完后, 输入 型号 厂家 规格 后发送' },
      { key: 'HISTORY', label: '历史订单', text: '查询最近的销售单和采购单', icon: <HistoryOutlined />, desc: '可附加: 客户, 时间范围' }
    ]
  }
]

export function ErpQuickActions({ selected, onSelect, onClear, currentInput, onSend, disabled = false, inputRef }) {
  const [activeCat, setActiveCat] = useState(null)

  const handleItemClick = (item, cat) => {
    if (disabled) return
    // 选中标签: 写入 selected 状态 (不发送, 不动 input, 让用户看清再输入)
    onSelect && onSelect({
      key: item.key,
      label: item.label,
      text: item.text,
      category: cat.key,
      color: cat.color,
      icon: item.icon,
      desc: item.desc
    })
    // 选中后自动聚焦输入框, 让用户可以立刻输入
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
              onMouseEnter={() => setActiveCat(cat.key)}
              onMouseLeave={() => setActiveCat(null)}
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

export default ErpQuickActions
