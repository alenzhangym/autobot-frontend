import { Card, Tag, Typography, Descriptions, Steps, Alert, Space, Input, InputNumber, Button, Table, AutoComplete } from 'antd'
import {
  CheckCircleOutlined, ExclamationCircleOutlined, WarningOutlined,
  SearchOutlined, EditOutlined, SafetyCertificateOutlined, FileSearchOutlined, PlusOutlined, CloseOutlined
} from '@ant-design/icons'
import { useState, useEffect } from 'react'
import api from '../auth'

const { Text, Paragraph } = Typography

// ── 明细 items 表格常量 (模块级, 供主组件与 ItemTable 共用) ─────────
const NUMERIC_SUFFIX = /_(qty|price|amount)$/
const LABEL_MAP = {
  user_part_model: '型号', model: '型号', manufacturer: '品牌', customer_part_no: '客户料号',
  ordered_qty: '数量', received_qty: '收货数量', shipped_qty: '出库数量', qty: '数量',
  estimated_unit_price: '估价单价', unit_price: '单价', amount: '金额',
  delivery_date: '交货日期', remarks: '备注', notes: '备注'
}
const labelOf = (k) => LABEL_MAP[k] || k
const isNumericKey = (k) => NUMERIC_SUFFIX.test(k) || ['amount', 'unit_price'].includes(k)

// ── 实体字段 lookup (2026-09-24) ────────────────────────────────────
// 确认卡内的客户/供应商/料号/客户料号 支持"下拉选已有 + 直接输入新值", 而非只能手输.
// 候选来自主数据接口; 取数失败 fail-open 退化为普通输入框 (不阻断确认).
const ENTITY_LOOKUP_KEYS = ['user_part_model', 'model', 'customer_part_no', 'customer_name', 'supplier_name']

/** 从 preview 步骤中收集出现的实体字段 key (明细列 + 标量参数). */
function collectEntityKeys(preview) {
  const found = new Set()
  for (const s of (preview && preview.steps) || []) {
    const kp = (s && s.keyParams) || {}
    if (Array.isArray(kp.items)) {
      kp.items.forEach(it => it && typeof it === 'object' && Object.keys(it).forEach(k => found.add(k)))
    }
    Object.keys(kp).forEach(k => { if (k !== 'items') found.add(k) })
  }
  return ENTITY_LOOKUP_KEYS.filter(k => found.has(k))
}

/** 兼容 ApiResult 包装 ({code,data:[...]} / {data:{parts:[...]}}) 取数组. */
function extractRows(res, listKey) {
  const body = res && res.data
  if (!body) return []
  const d = body.data !== undefined ? body.data : body
  if (Array.isArray(d)) return d
  if (d && Array.isArray(d[listKey])) return d[listKey]
  return []
}

/** 去重 + 去空 + 归一为 {value,label}. */
function uniqueOptions(opts) {
  const seen = new Set()
  const out = []
  for (const o of opts || []) {
    const v = o && o.value != null ? String(o.value).trim() : ''
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push({ value: v, label: String(o.label == null ? v : o.label) })
  }
  return out
}

/** 拉取某实体字段的候选 (fail-open: 失败返回空数组). 供本组件与 PartyConfirmWithPreview 复用. */
export async function fetchLookup(key) {
  if (key === 'user_part_model' || key === 'model') {
    const res = await api.get('/erp/parts/all')
    return uniqueOptions(extractRows(res, 'parts').map(p => ({
      value: p && p.userPartModel,
      label: p && p.manufacturer ? `${p.userPartModel} · ${p.manufacturer}` : (p && p.userPartModel)
    })))
  }
  if (key === 'customer_part_no') {
    const res = await api.get('/erp/customer-part-mappings', { params: { page: 1, size: 999 } })
    return uniqueOptions(extractRows(res, 'mappings').map(m => ({
      value: m && m.customerPartNo,
      label: m && m.partModel ? `${m.customerPartNo} → ${m.partModel}` : (m && m.customerPartNo)
    })))
  }
  if (key === 'customer_name') {
    const res = await api.get('/erp/customers/all')
    return uniqueOptions(extractRows(res, 'customers').map(c => ({
      value: c && c.name, label: c && c.name
    })))
  }
  if (key === 'supplier_name') {
    const res = await api.get('/erp/suppliers/all')
    return uniqueOptions(extractRows(res, 'suppliers').map(s => ({
      value: s && s.name, label: s && s.name
    })))
  }
  return []
}

/**
 * 实体字段输入框: 有候选 → AutoComplete (可搜索选择已有 / 也可直接输入新值);
 * 无候选 → 普通 Input. 受控传 value, 非受控传 defaultValue.
 */
function EntityInput({ value, defaultValue, options, onChange, placeholder, style, maxLength }) {
  const opts = options || []
  const valueProp = value !== undefined ? { value: value == null ? '' : value } : { defaultValue }
  if (opts.length === 0) {
    return (
      <Input size="small" {...valueProp} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} style={style} maxLength={maxLength} />
    )
  }
  return (
    <AutoComplete
      size="small"
      {...valueProp}
      options={opts}
      onChange={v => onChange(v == null ? '' : v)}
      filterOption={(input, opt) => String((opt && opt.value) || '').toLowerCase().includes(String(input).toLowerCase())}
      style={style}
      popupMatchSelectWidth={320}
      notFoundContent={null}
    >
      <Input size="small" placeholder={placeholder || '下拉选已有 / 输入新值'} style={style} maxLength={maxLength} />
    </AutoComplete>
  )
}

/**
 * PlanPreviewCard — 执行前结构化预览 (§5.6.2).
 *
 * <p>渲染后端 PlanPreview record: title/explanation/steps/impactScope/riskWarning/requiresConfirmation.
 * 用于 HIGH 风险写操作确认场景, 在用户确认前展示"系统理解了什么、准备怎么做".
 *
 * <p>2026-09-23 (展示待写入内容): 对写步骤:
 * <ul>
 *   <li>若 keyParams.items 为明细数组 → 渲染为<b>可编辑表格</b> (改型号/数量/单价, 增/删行);</li>
 *   <li>标量参数渲染为内联 Input (可改);</li>
 *   <li>支持"补充业务参数" (增补任意键值对).</li>
 * </ul>
 * 编辑结果以 {@code editedParams} (key = StepPreview.stepIndex, 即完整执行计划下标) 经 "确认编辑 {json}" 回传,
 * 后端 restoreExecSteps 按该下标 putAll 应用 (见 ERPOrchestrator#restoreExecSteps).
 */
export default function PlanPreviewCard({ preview, onConfirm, onCancel, loading }) {
  // §9.2 §2026-09-23: 编辑后的参数: { stepIndex: { paramName: value } }
  const [editedParams, setEditedParams] = useState({})
  // 2026-09-24: 实体字段候选 (客户/供应商/料号/客户料号) — 供单元格下拉选择
  const [lookups, setLookups] = useState({})

  // 按 preview 实际出现的实体字段按需取候选 (取数失败 fail-open, 单元格退化为输入框)
  useEffect(() => {
    if (!preview) return
    const keys = collectEntityKeys(preview)
    if (keys.length === 0) return
    let cancelled = false
    Promise.all(keys.map(k => fetchLookup(k).then(opts => [k, opts]).catch(() => [k, []])))
      .then(pairs => { if (!cancelled) setLookups(Object.fromEntries(pairs)) })
    return () => { cancelled = true }
  }, [preview])

  if (!preview) return null

  const {
    title = '执行前预览',
    explanation = '',
    steps = [],
    impactScope = '',
    riskWarning = '',
    requiresConfirmation = false
  } = preview

  const stepIcon = (type, riskLevel) => {
    if (riskLevel === 'HIGH') return <WarningOutlined style={{ color: '#ff4d4f' }} />
    const t = (type || '').toLowerCase()
    if (t.includes('read') || t.includes('search') || t.includes('query')) return <SearchOutlined />
    if (t.includes('write') || t.includes('create') || t.includes('update')) return <EditOutlined />
    if (t.includes('verify')) return <SafetyCertificateOutlined />
    return <FileSearchOutlined />
  }

  const riskColor = (level) => {
    if (!level) return 'default'
    const l = level.toUpperCase()
    if (l === 'HIGH') return 'red'
    if (l === 'MEDIUM') return 'orange'
    return 'green'
  }

  /** 从 step 提取明细行数组 (keyParams.items 为对象数组时返回其引用). */
  const itemsOf = (step) => {
    const items = step && step.keyParams && Array.isArray(step.keyParams.items) ? step.keyParams.items : null
    if (!items || items.length === 0) return null
    return items.every(it => it && typeof it === 'object') ? items : null
  }

  /** 读取某步骤当前渲染的 items (编辑态优先). */
  const currentItems = (stepIndex, step) => {
    const edited = editedParams[stepIndex] && Array.isArray(editedParams[stepIndex].items)
      ? editedParams[stepIndex].items : null
    return edited || itemsOf(step)
  }

  /** 写回该步骤的 items 数组. */
  const setItems = (stepIndex, items) => {
    setEditedParams(prev => ({
      ...prev,
      [stepIndex]: { ...(prev[stepIndex] || {}), items }
    }))
  }

  /** 写回单个参数 (空值移除). */
  const setParam = (stepIndex, key, value) => {
    setEditedParams(prev => {
      const step = { ...(prev[stepIndex] || {}) }
      const isBlank = value === undefined || value === null || value === ''
      if (isBlank) delete step[key]
      else step[key] = value
      return { ...prev, [stepIndex]: step }
    })
  }

  const updateCell = (stepIndex, step, rowIdx, key, value) => {
    const rows = currentItems(stepIndex, step)
    if (!rows) return
    const next = rows.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r))
    setItems(stepIndex, next)
  }

  const addRow = (stepIndex, step) => {
    const rows = currentItems(stepIndex, step) || []
    const keys = itemKeysFor(step, rows)
    const blank = Object.fromEntries(keys.map(k => [k, isNumericKey(k) ? 0 : '']))
    setItems(stepIndex, [...rows, blank])
  }

  const removeRow = (stepIndex, step, rowIdx) => {
    const rows = currentItems(stepIndex, step) || []
    setItems(stepIndex, rows.filter((_, i) => i !== rowIdx))
  }

  const collectColumns = (rows) => {
    const keys = new Set()
    ;(rows || []).forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)))
    return Array.from(keys)
  }

  /**
   * 明细表格列: 现有行字段 ∪ 必要列.
   * 2026-09-24: 销售单 (含客户) 即使明细里没有"客户料号", 也保留该列 — 用户可下拉选已有映射或录入新料号.
   */
  const itemKeysFor = (step, rows) => {
    const keys = collectColumns(rows)
    const kp = (step && step.keyParams) || {}
    const isSales = Object.prototype.hasOwnProperty.call(kp, 'customer_name')
      || Object.prototype.hasOwnProperty.call(kp, 'customer_id')
    if (isSales && !keys.includes('customer_part_no')) keys.push('customer_part_no')
    return keys
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
      {explanation && (
        <Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
          {explanation}
        </Paragraph>
      )}

      {steps && steps.length > 0 && (
        <Steps
          size="small"
          direction="vertical"
          style={{ marginBottom: 12 }}
          items={steps.map((s, idx) => {
            const stepIndex = s.stepIndex !== undefined && s.stepIndex != null ? s.stepIndex : idx
            const items = itemsOf(s)
            const scalarKeys = s.keyParams
              ? Object.keys(s.keyParams).filter(k => !(k === 'items' && items))
              : []
            // 2026-09-23: 补充参数 = 该步骤已编辑但非"原标量参数"、非 items 的键 (新增的额外参数, 需可见)
            const supplements = Object.entries((editedParams[stepIndex] || {}))
              .filter(([k]) => k !== 'items' && !scalarKeys.includes(k))
              .reduce((acc, [k, v]) => { acc[k] = v; return acc }, {})
            return {
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

                  {/* 明细表格 (可编辑) */}
                  {items && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>明细 (可编辑, 按 {labelOf('ordered_qty')}/单价数据写入):</Text>
                      <ItemTable
                        rows={currentItems(stepIndex, s) || []}
                        keys={itemKeysFor(s, currentItems(stepIndex, s) || [])}
                        lookups={lookups}
                        onCell={(ri, k, v) => updateCell(stepIndex, s, ri, k, v)}
                        onRemoveRow={(ri) => removeRow(stepIndex, s, ri)}
                        onAddRow={() => addRow(stepIndex, s)}
                      />
                    </div>
                  )}

                  {/* 标量参数 (可编辑) */}
                  {scalarKeys.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary">参数 (可修改):</Text>
                      <div style={{ marginTop: 2 }}>
                        {scalarKeys.map(k => (
                          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, marginBottom: 4 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>{labelOf(k)}:</Text>
                            <EntityInput
                              options={lookups[k]}
                              defaultValue={String((s.keyParams[k] ?? ''))}
                              placeholder={labelOf(k)}
                              style={{ width: 140, marginLeft: 4, fontSize: 12 }}
                              maxLength={k === 'customer_part_no' ? 128 : undefined}
                              onChange={(v) => setParam(stepIndex, k, v)}
                            />
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 补充业务参数 (已补充列表可见可改可删 + 新增入口, 每步独立) */}
                  <SupplementSection
                    supplements={supplements}
                    onSet={(k, v) => setParam(stepIndex, k, v)}
                    onRemove={(k) => setParam(stepIndex, k, '')}
                  />
                </div>
              ),
              icon: stepIcon(s.type, s.riskLevel)
            }
          })}
        />
      )}

      {impactScope && (
        <Descriptions size="small" column={1} style={{ marginBottom: 8 }}>
          <Descriptions.Item label="影响范围">
            <Text style={{ fontSize: 12 }}>{impactScope}</Text>
          </Descriptions.Item>
        </Descriptions>
      )}

      {riskWarning && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={<Text style={{ fontSize: 12 }}>{riskWarning}</Text>}
          style={{ marginBottom: 12 }}
        />
      )}

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

/** 明细 items 可编辑表格 (型号/客户料号支持下拉选已有 + 输入新值; 数量/单价数字输入; 增删行). */
function ItemTable({ rows, keys: keysProp, lookups, onCell, onRemoveRow, onAddRow }) {
  const keys = keysProp && keysProp.length > 0
    ? keysProp
    : Array.from(new Set(rows.flatMap(r => r ? Object.keys(r) : [])))
  const columns = [
    ...keys.map(k => ({
      title: labelOf(k),
      dataIndex: k,
      key: k,
      width: k === 'user_part_model' ? 200 : 120,
      render: (_, row, ri) => (
        isNumericKey(k)
          ? <InputNumber size="small" style={{ width: 110, fontSize: 12 }} value={row[k] ?? 0}
              onChange={(v) => onCell(ri, k, v == null ? 0 : v)} />
          : <EntityInput value={row[k] ?? ''} options={lookups && lookups[k]}
              placeholder={labelOf(k)}
              style={{ width: '100%', fontSize: 12 }}
              maxLength={k === 'customer_part_no' ? 128 : undefined}
              onChange={(v) => onCell(ri, k, v)} />
      )
    })),
    {
      title: '', key: '__op', width: 40,
      render: (_, __, ri) => <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => onRemoveRow(ri)} />
    }
  ]
  const dataSource = rows.map((r, i) => (typeof r === 'object' ? { ...r, __rowKey: i } : { __rowKey: i }))
  return (
    <div style={{ marginTop: 4 }}>
      <Table
        size="small"
        rowKey="__rowKey"
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
      <Button size="small" icon={<PlusOutlined />} onClick={onAddRow} style={{ marginTop: 4, fontSize: 12 }}>新增明细行</Button>
    </div>
  )
}

/**
 * 补充业务参数区块 (每步骤独立实例).
 *
 * <p>2026-09-23: 修复"补充参数不可见": 已补充的参数列出并可改可删;
 * 新增输入的状态为本组件自有(state), 不再跨步骤共享. 补充的键值非空才添加 (空值 no-op, 避免静默无反馈).
 */
function SupplementSection({ supplements, onSet, onRemove }) {
  const [key, setKey] = useState('')
  const [val, setVal] = useState('')

  const add = () => {
    const k = key.trim()
    const v = val.trim()
    if (!k || !v) return   // 参数名或值为空 → 不添加, 无副作用
    onSet(k, v)
    setKey('')
    setVal('')
  }

  const entries = Object.entries(supplements || {})

  return (
    <div style={{ marginTop: 8 }}>
      <Text type="secondary" style={{ fontSize: 11 }}>补充参数:</Text>

      {/* 已补充参数列表 (可改值 / 可删除) */}
      {entries.length > 0 && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(([k, v]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Input
                size="small" style={{ width: 110, fontSize: 12 }}
                defaultValue={labelOf(k)} disabled
                title={k}
              />
              <Input
                size="small" style={{ width: 140, fontSize: 12 }}
                defaultValue={String(v ?? '')}
                onChange={(e) => onSet(k, e.target.value)}
              />
              <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => onRemove(k)} />
            </span>
          ))}
        </div>
      )}

      {/* 新增补充参数入口 */}
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <Input
          size="small" placeholder="参数名" value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ width: 110, fontSize: 12 }}
          onPressEnter={add}
        />
        <Input
          size="small" placeholder="值" value={val}
          onChange={(e) => setVal(e.target.value)}
          style={{ width: 140, fontSize: 12 }}
          onPressEnter={add}
        />
        <Button size="small" icon={<PlusOutlined />} onClick={add} style={{ fontSize: 12 }}>添加</Button>
      </div>
    </div>
  )
}