import { useMemo, useState } from 'react'
import { Button, Slider, Switch, Tag } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'

/**
 * P4 (2026-09-01): 澄清策略配置面板。
 *
 * <p>允许用户配置：
 * <ul>
 *   <li><b>clarifyType 默认优先级</b> — MISSING_SLOT / AMBIGUITY / POLICY_CONFIRMATION
 *       的默认决策顺序（上移/下移调整），后端 GroundingConfidenceGate 可据此决定先走哪类澄清；</li>
 *   <li><b>高风险触发阈值</b> — 当判定风险/置信度达到该阈值时，走「暂停确认 (pause)」，
 *       否则仅走「澄清 (clarify)」；</li>
 *   <li><b>是否随消息下发</b> — 开关将当前策略作为 {@code clarify_strategy} 附加到聊天 payload，
 *       供后端按需消费（非破坏性扩展，默认关闭）。</li>
 * </ul>
 *
 * <p>配置以 JSON 持久化到 localStorage（key: {@code autobot.clarify.strategy}），
 * 仅前端偏好，后端未识别时忽略，不影响既有流程。</p>
 */
const STORAGE_KEY = 'autobot.clarify.strategy'

const DEFAULT_ORDER = ['MISSING_SLOT', 'AMBIGUITY', 'POLICY_CONFIRMATION']

const TYPE_LABEL = {
  MISSING_SLOT: 'MISSING_SLOT',
  AMBIGUITY: 'AMBIGUITY',
  POLICY_CONFIRMATION: 'POLICY_CONFIRMATION',
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { order: [...DEFAULT_ORDER], riskThreshold: 70, attachToPayload: false }
    const parsed = JSON.parse(raw)
    return {
      order: Array.isArray(parsed.order) && parsed.order.length === 3 ? parsed.order : [...DEFAULT_ORDER],
      riskThreshold: typeof parsed.riskThreshold === 'number' ? parsed.riskThreshold : 70,
      attachToPayload: !!parsed.attachToPayload,
    }
  } catch (e) {
    return { order: [...DEFAULT_ORDER], riskThreshold: 70, attachToPayload: false }
  }
}

export default function ClarifyStrategyConfigPanel() {
  const [cfg, setCfg] = useState(load)

  const persist = (next) => {
    const merged = { ...cfg, ...next }
    setCfg(merged)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    } catch (e) { /* 忽略 localStorage 不可用 */ }
  }

  const move = (index, dir) => {
    const order = [...cfg.order]
    const target = index + dir
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    persist({ order })
  }

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 6, background: '#212121', marginBottom: 8 }

  return (
    <div>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
        澄清决策策略 — 调整默认澄清类型优先级与高风险触发阈值。配置仅保存在本机，后端未识别时不影响既有流程。
      </p>

      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#e3e3e3', marginBottom: 8 }}>clarifyType 默认优先级</div>
        {cfg.order.map((type, idx) => (
          <div key={type} style={rowStyle}>
            <Tag color="geekblue" style={{ width: 200, textAlign: 'center', margin: 0 }}>{TYPE_LABEL[type] || type}</Tag>
            <Button size="small" disabled={idx === 0} onClick={() => move(idx, -1)} icon={<UpOutlined />} />
            <Button size="small" disabled={idx === cfg.order.length - 1} onClick={() => move(idx, 1)} icon={<DownOutlined />} />
          </div>
        ))}
        <div style={{ color: '#777', fontSize: 12 }}>
          优先按此顺序尝试澄清类型：缺槽位信息 → 多候选歧义 → 策略/风险确认。
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#e3e3e3', marginBottom: 4 }}>高风险触发阈值</div>
        <div style={{ color: '#777', fontSize: 12, marginBottom: 8 }}>
          风险/置信度判定达到该阈值时「暂停确认 (pause + preview)」，否则仅「澄清 (clarify)」。
        </div>
        <Slider
          min={0}
          max={100}
          value={cfg.riskThreshold}
          onChange={(v) => persist({ riskThreshold: v })}
          tooltip={{ formatter: (v) => `${v}%` }}
        />
        <div style={{ color: '#999', fontSize: 12 }}>当前阈值：{cfg.riskThreshold}%</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Switch checked={cfg.attachToPayload} onChange={(v) => persist({ attachToPayload: v })} />
        <span style={{ color: '#e3e3e3' }}>随消息下发 clarify_strategy</span>
        <span style={{ color: '#777', fontSize: 12 }}>（附加到聊天请求，供后端按需消费）</span>
      </div>
    </div>
  )
}

/** 供 App 读取当前澄清策略（用于附加到 payload）。 */
export function getClarifyStrategy() {
  const cfg = load()
  if (!cfg.attachToPayload) return null
  return {
    order: cfg.order,
    riskThreshold: cfg.riskThreshold,
  }
}

/** useMemo 便捷读取（避免每次渲染触发 JSON.parse）。 */
export function useClarifyStrategy() {
  return useMemo(() => getClarifyStrategy(), [])
}