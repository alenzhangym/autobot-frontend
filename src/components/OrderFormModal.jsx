import { useEffect, useState, useMemo, useCallback } from 'react'
import { Modal, Form, Input, InputNumber, Table, Button, Space, Tag, Tooltip, Divider, Typography, message, Alert, Tabs, Progress, Empty, AutoComplete, Spin } from 'antd'
import { PlusOutlined, MinusCircleOutlined, ExclamationCircleOutlined, CheckOutlined, WarningOutlined, FormOutlined, ProfileOutlined, AppstoreOutlined, DatabaseOutlined, DownOutlined } from '@ant-design/icons'
import api from '../auth'

/**
 * 阶段5: 弹窗式订单表单.
 * 后端 ERPOrchestrator 在 doCreate* 检测到缺字段时,通过 clarify 路径
 * 把 form_spec 传给 ChatController → 前端. 这个组件直接渲染 form_spec.
 *
 * 设计要点:
 *   1. 缺字段用红色/橙色 Tag 标出,required=true 字段必填
 *   2. items 是可编辑的表格,用户可增删行
 *   3. 提交时把 formData 序列化为 LLM 友好的文本,作为新一条 user message 发回
 *   4. 后端再次进入 ERPOrchestrator.handleXxxOrder,被解析后走 doCreateXxx
 *      (这一轮若仍缺字段,会再次弹窗)
 */
const { Text, Paragraph } = Typography

// 颜色:头部缺字段 → 橙红;item 缺字段 → 黄
const REQUIRED_TAG = <Tag color="red" style={{ marginLeft: 4, fontSize: 11 }}>必填</Tag>
const OPTIONAL_TAG = <Tag style={{ marginLeft: 4, fontSize: 11 }}>可选</Tag>

export function OrderFormModal({ open, onClose, onSubmit, formSpec, hintText, companyId }) {
  const [form] = Form.useForm()
  const [rows, setRows] = useState([])
  const [submitting, setSubmitting] = useState(false)
  // 当前激活的 Tab; 缺主数据时默认切到 masterData
  const [activeTab, setActiveTab] = useState('header')
  // 表单头部值快照 — 供 Progress 完成度计算使用(onValuesChange 同步)
  const [headerValues, setHeaderValues] = useState({})

  // ── Lookup 选项 (供应商/客户/物料) ──
  // 按 formSpec 实际需要的字段按需拉 — 减少无意义请求
  const [supplierOptions, setSupplierOptions] = useState([])
  const [customerOptions, setCustomerOptions] = useState([])
  const [partOptions, setPartOptions] = useState([])
  const [lookupsLoading, setLookupsLoading] = useState(false)

  // 拉取 lookup 列表; 哪个字段在 formSpec 出现才拉哪个.
  // 注: 这三个 useState + useEffect 都必须在 early return 之前(见 #310 修复).
  useEffect(() => {
    if (!open || !formSpec || !companyId) return
    const headerNames = new Set((formSpec.headerFields || []).map(f => f.name))
    const itemCols = formSpec.itemColumns || []
    const needSuppliers = headerNames.has('supplier_name')
    const needCustomers = headerNames.has('customer_name')
    const needParts = itemCols.includes('user_part_model')
    if (!needSuppliers && !needCustomers && !needParts) return

    setLookupsLoading(true)
    const tasks = []
    if (needSuppliers) tasks.push(api.get('/erp/suppliers/all').then(r => setSupplierOptions(extractLookupList(r, 'name'))).catch(() => setSupplierOptions([])))
    if (needCustomers) tasks.push(api.get('/erp/customers/all').then(r => setCustomerOptions(extractLookupList(r, 'name'))).catch(() => setCustomerOptions([])))
    if (needParts) tasks.push(api.get('/erp/parts/all').then(r => setPartOptions(extractLookupList(r, 'userPartModel', 'manufacturer'))).catch(() => setPartOptions([])))
    Promise.allSettled(tasks).finally(() => setLookupsLoading(false))
  }, [open, formSpec, companyId])

  // formSpec 变化时重置表单
  useEffect(() => {
    if (!open || !formSpec) return
    // 头部字段预填
    const initial = {}
    for (const f of formSpec.headerFields || []) {
      if (f.defaultValue) initial[f.name] = f.defaultValue
    }
    form.setFieldsValue(initial)
    setHeaderValues(initial)
    // items 行 — 标记 prefilled=true 供行级底色使用
    setRows((formSpec.itemRows || []).map((r, i) => ({
      key: String(i),
      values: r,
      prefilled: true,
    })))
    // 默认 Tab: 缺主数据时切到 masterData, 让用户先看到要新增什么
    const hasMissing = (formSpec.missingNewParts?.length || 0) > 0
      || (formSpec.missingNewCustomers?.length || 0) > 0
      || (formSpec.missingNewSuppliers?.length || 0) > 0
    setActiveTab(hasMissing ? 'masterData' : 'header')
  }, [open, formSpec, form])

  // ── 所有 hooks 必须在 early return 之前调用, 否则 React 会检测到
  //    "Rendered more hooks than during the previous render" (#310).
  //    父组件传入的 formSpec 可能 null→非空, 渲染次数变化时 hooks 数量必须稳定.

  // 物料表列定义
  const columns = useMemo(
    () => formSpec ? buildColumns(formSpec.itemColumns || []) : [],
    [formSpec]
  )

  // 主数据缺失列表(供 masterData Tab 渲染)
  const newParts = formSpec?.missingNewParts || []
  const newCustomers = formSpec?.missingNewCustomers || []
  const newSuppliers = formSpec?.missingNewSuppliers || []

  // 头部必填字段 + 已填数(供 Tab 角标 + Progress 使用)
  const headerRequired = useMemo(
    () => (formSpec?.headerFields || []).filter(f => f.required),
    [formSpec]
  )
  const headerFilled = useMemo(
    () => headerRequired.filter(f => {
      const v = headerValues[f.name]
      return v !== undefined && v !== null && String(v).trim() !== ''
    }).length,
    [headerRequired, headerValues]
  )
  // 至少 1 个有效明细行(每个必填列都填了)即视为明细完成
  const validRows = useMemo(() => rows.filter(r => {
    const v = r.values || []
    if (!v[0] || String(v[0]).trim() === '') return false
    for (let i = 1; i < v.length; i++) {
      if (!v[i] || String(v[i]).trim() === '') return false
    }
    return true
  }), [rows])
  // 完成度: 头部必填字段数 + 1(明细) = 总单元; 已完成单元数 / 总单元
  const progress = useMemo(() => {
    const totalUnits = headerRequired.length + 1
    const filledUnits = headerFilled + (validRows.length > 0 ? 1 : 0)
    return totalUnits > 0 ? Math.round((filledUnits / totalUnits) * 100) : 100
  }, [headerRequired.length, headerFilled, validRows.length])

  // ── 所有 hooks 调用完毕, 此时方可 early return ──
  if (!formSpec) return null

  const addRow = () => {
    setRows(prev => [...prev, {
      key: 'k' + Date.now(),
      values: new Array((formSpec.itemColumns || []).length).fill(''),
      prefilled: false,
    }])
  }
  const removeRow = (key) => {
    setRows(prev => prev.filter(r => r.key !== key))
  }
  const updateCell = (key, colIdx, val) => {
    setRows(prev => prev.map(r => r.key === key
      ? { ...r, values: r.values.map((v, i) => i === colIdx ? val : v) }
      : r))
  }

  const handleOk = async () => {
    try {
      await form.validateFields()
    } catch (_) {
      message.warning('请补全必填字段')
      return
    }
    // 校验 items: 每行第一个 cell (model) 必填
    const cleanedRows = rows
      .map(r => r.values)
      .filter(v => v[0] && String(v[0]).trim() !== '')
    if (cleanedRows.length === 0) {
      message.warning('请至少填写一行物料明细')
      return
    }
    // 行级必填校验 (除 model 外)
    for (let i = 0; i < cleanedRows.length; i++) {
      for (let j = 1; j < cleanedRows[i].length; j++) {
        if (!cleanedRows[i][j] || String(cleanedRows[i][j]).trim() === '') {
          message.warning(`第 ${i + 1} 行缺${columns[j].title}`)
          return
        }
      }
    }
    setSubmitting(true)
    try {
      const headerValues = form.getFieldsValue()
      // 序列化为 LLM 友好的文本:
      //   新建销售单
      //   customer_name: 华强
      //   customer_po: PO-2024
      //   items:
      //   - user_part_model: ABC | ordered_qty: 1000 | unit_price: 0.5
      const text = serializeAsText(formSpec, headerValues, cleanedRows)
      onSubmit && onSubmit(text)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={
        <Space>
          <FormOutlined style={{ color: '#1677ff' }} />
          <span>{formSpec.title || '补全订单信息'}</span>
          {formSpec.orderType && <Tag color="blue">{formSpec.orderType}</Tag>}
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={760}
      okText="提交"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={handleOk}
      destroyOnClose
      styles={{
        body: { background: '#1a1a1a', padding: '20px 24px' },
        header: { background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', padding: '16px 24px' },
        footer: { background: '#1a1a1a', borderTop: '1px solid #2a2a2a' }
      }}
    >
      {/* 完成度条 — 头部必填字段 + 1(明细)= 总单元, 实时反映用户已补到哪一步 */}
      <Progress
        percent={progress}
        size="small"
        status={progress === 100 ? 'success' : 'active'}
        format={p => `${p}% · 还需补 ${100 - p}%`}
        strokeColor={progress === 100 ? '#52c41a' : '#1677ff'}
        style={{ marginBottom: 12 }}
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="small"
        items={[
          {
            key: 'header',
            label: (
              <Space size={4}>
                <ProfileOutlined />
                <span>基础信息</span>
                <Tag color={headerRequired.length === 0 || headerRequired.length === headerFilled ? 'green' : 'orange'}>
                  {headerFilled}/{headerRequired.length}
                </Tag>
              </Space>
            ),
            children: headerRequired.length === 0 ? (
              <Empty description="无基础信息需补充" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Form
                form={form}
                layout="vertical"
                onValuesChange={(_, all) => setHeaderValues(all)}
              >
                {headerRequired.map(f => {
                  const lookupOptions = f.name === 'supplier_name' ? supplierOptions
                    : f.name === 'customer_name' ? customerOptions
                    : []
                  return (
                    <Form.Item
                      key={f.name}
                      name={f.name}
                      label={<span style={{ color: '#e3e3e3' }}>{f.label || f.name}{REQUIRED_TAG}</span>}
                      style={{ marginBottom: 12 }}
                      rules={[{ required: true, message: `请填写 ${f.label || f.name}` }]}
                    >
                      {renderHeaderInput(f, lookupOptions)}
                    </Form.Item>
                  )
                })}
              </Form>
            )
          },
          {
            key: 'items',
            label: (
              <Space size={4}>
                <AppstoreOutlined />
                <span>物料明细</span>
                <Tag color={validRows.length > 0 ? 'green' : 'orange'}>
                  {validRows.length} 行有效
                </Tag>
              </Space>
            ),
            children: (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: '#bbb', fontSize: 12 }}>
                    预填行有 <Tag color="warning" style={{ margin: 0 }}>浅黄底</Tag> 标识, 逐行填写料号和数量/单价
                  </div>
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={addRow}
                  >添加一行</Button>
                </div>
                <Table
                  size="small"
                  dataSource={rows}
                  pagination={false}
                  onRow={(record) => ({
                    style: record.prefilled
                      ? { background: 'rgba(250, 173, 20, 0.10)' }
                      : {}
                  })}
                  columns={columns.map((c, ci) => ({
                    ...c,
                    render: (_, record) => {
                      // 第一列(物料型号)有 lookup 选项时用 AutoComplete
                      if (ci === 0 && c.key === 'user_part_model' && partOptions.length > 0) {
                        return renderModelInput(
                          record.values[ci] || '',
                          (val) => updateCell(record.key, ci, val),
                          partOptions
                        )
                      }
                      // 数字列(数量 / 单价)用 InputNumber
                      const numericCols = ['ordered_qty', 'received_qty', 'shipped_qty',
                                           'estimated_unit_price', 'unit_price']
                      if (numericCols.includes(c.key)) {
                        const hint = ci === 1 && c.key === 'ordered_qty'
                          ? (formSpec.itemHints || {})[record.values[0]]
                          : null
                        return (
                          <div>
                            <InputNumber
                              size="small"
                              placeholder={c.title}
                              value={record.values[ci] !== '' && record.values[ci] != null ? Number(record.values[ci]) : null}
                              onChange={(v) => updateCell(record.key, ci, v == null ? '' : v)}
                              style={{ width: '100%', background: '#252525', borderColor: '#3a3a3a' }}
                              min={0}
                            />
                            {hint && (
                              <div style={{ fontSize: 11, color: '#888', marginTop: 2, lineHeight: 1.3 }}>
                                {hint.gap != null && <span>缺口 <b style={{ color: '#faad14' }}>{hint.gap}</b></span>}
                                {hint.gap != null && hint.suggested_qty != null && <span> · </span>}
                                {hint.suggested_qty != null && <span>建议 <b style={{ color: '#52c41a' }}>{hint.suggested_qty}</b></span>}
                              </div>
                            )}
                          </div>
                        )
                      }
                      return (
                        <Input
                          size="small"
                          placeholder={c.title}
                          value={record.values[ci] || ''}
                          onChange={e => updateCell(record.key, ci, e.target.value)}
                          style={{ background: '#252525', borderColor: '#3a3a3a', color: '#fff' }}
                        />
                      )
                    }
                  })).concat([{
                    title: '',
                    key: 'op',
                    width: 50,
                    render: (_, record) => (
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => removeRow(record.key)}
                      />
                    )
                  }])}
                  rowKey="key"
                  locale={{ emptyText: '暂无明细, 点"添加一行"' }}
                  style={{ background: '#1a1a1a' }}
                />
              </>
            )
          },
          {
            key: 'masterData',
            label: (
              <Space size={4}>
                <DatabaseOutlined />
                <span>待新增主数据</span>
                {(newParts.length + newCustomers.length + newSuppliers.length) > 0 && (
                  <Tag color="red">{newParts.length + newCustomers.length + newSuppliers.length}</Tag>
                )}
              </Space>
            ),
            children: (newParts.length === 0 && newCustomers.length === 0 && newSuppliers.length === 0) ? (
              <Empty description="所有主数据已存在" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Alert
                type="warning"
                showIcon
                message="以下主数据不存在, 需先新增"
                description={
                  <Space direction="vertical" size={4}>
                    {newParts.length > 0 && (
                      <div>物料: {newParts.map(p => <Tag color="orange" key={p}>{p}</Tag>)}</div>
                    )}
                    {newCustomers.length > 0 && (
                      <div>客户: {newCustomers.map(c => <Tag color="orange" key={c}>{c}</Tag>)}</div>
                    )}
                    {newSuppliers.length > 0 && (
                      <div>供应商: {newSuppliers.map(s => <Tag color="orange" key={s}>{s}</Tag>)}</div>
                    )}
                  </Space>
                }
              />
            )
          }
        ]}
      />

      {hintText && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ color: '#888', fontSize: 12, cursor: 'pointer' }}>查看原始提示文本</summary>
          <pre style={{ color: '#aaa', fontSize: 11, whiteSpace: 'pre-wrap', background: '#0d0d0d', padding: 8, borderRadius: 4, marginTop: 6, maxHeight: 200, overflow: 'auto' }}>{hintText}</pre>
        </details>
      )}
    </Modal>
  )
}

function buildColumns(itemColumns) {
  if (itemColumns.length === 0) return []
  return itemColumns.map((c, i) => ({
    title: <span>
      {c === 'user_part_model' ? '物料型号' : columnToLabel(c)}
      {c !== 'user_part_model' && <span style={{ color: '#ff4d4f' }}> *</span>}
    </span>,
    dataIndex: c,
    key: c,
    width: i === 0 ? 180 : 120
  }))
}

function columnToLabel(col) {
  switch (col) {
    case 'ordered_qty': return '数量'
    case 'received_qty': return '入库数量'
    case 'shipped_qty': return '出库数量'
    case 'estimated_unit_price': return '采购单价'
    case 'unit_price': return '销售单价'
    default: return col
  }
}

function serializeAsText(formSpec, headerValues, rows) {
  const lines = []
  const orderLabel = formSpec.title || '订单'
  lines.push(`新建${orderLabel.replace('新建', '')}`)

  for (const f of formSpec.headerFields || []) {
    if (f.required) {
      lines.push(`${f.label || f.name}: ${headerValues[f.name] || ''}`)
    } else if (headerValues[f.name]) {
      lines.push(`${f.label || f.name}: ${headerValues[f.name]}`)
    }
  }
  lines.push('')
  lines.push('物料明细:')
  rows.forEach((r, i) => {
    const cells = r.map((v, ci) => {
      const col = (formSpec.itemColumns || [])[ci] || ''
      const label = ci === 0 ? '物料型号' : columnToLabel(col)
      return `${label}=${v || ''}`
    }).join(', ')
    lines.push(`  ${i + 1}. ${cells}`)
  })
  return lines.join('\n')
}

export default OrderFormModal

/**
 * 从 ApiResult 包装的响应里取数组. 后端 ApiResult.ok(list) →
 * {code:0, message:"ok", data: list}. 同时兼容 { data: {suppliers:[...]} } 形式.
 */
function extractLookupList(response, primaryField, secondaryField) {
  const payload = response?.data
  if (!payload) return []
  // 直接是数组(我们的 /all 路径)
  let arr = Array.isArray(payload) ? payload
    : Array.isArray(payload.data) ? payload.data
    : Array.isArray(payload[primaryField + 's']) ? payload[primaryField + 's']  // suppliers/customers/parts
    : []
  return arr
    .map(item => {
      if (typeof item === 'string') return { value: item, label: item }
      const value = item?.[primaryField]
      if (!value) return null
      const extra = secondaryField && item[secondaryField] ? ` · ${item[secondaryField]}` : ''
      return { value, label: `${value}${extra}` }
    })
    .filter(Boolean)
}

/**
 * 决定一个 header 字段是否应该用 AutoComplete(可下拉选已有客户/供应商).
 */
function isLookupField(fieldName) {
  return fieldName === 'supplier_name' || fieldName === 'customer_name'
}

/**
 * 头部字段的渲染 — supplier_name / customer_name → AutoComplete, 其他 → 普通 Input
 */
function renderHeaderInput(field, lookupOptions) {
  const baseStyle = { background: '#252525', borderColor: '#3a3a3a', color: '#fff' }
  if (isLookupField(field.name) && lookupOptions.length > 0) {
    return (
      <AutoComplete
        options={lookupOptions}
        placeholder={field.defaultValue ? `已自动填入"${field.defaultValue}", 可下拉选已存在项或继续编辑` : `下拉选择已存在的${field.label || field.name}, 或直接输入新值`}
        filterOption={(input, opt) =>
          String(opt?.value || '').toLowerCase().includes(input.toLowerCase())}
        style={{ width: '100%' }}
        popupMatchSelectWidth={480}
        notFoundContent={null}
        allowClear
      >
        <Input style={baseStyle} suffix={<DownOutlined style={{ color: '#888' }} />} />
      </AutoComplete>
    )
  }
  return (
    <Input
      placeholder={field.defaultValue ? `已自动填入"${field.defaultValue}",可修改` : `请输入 ${field.label || field.name}`}
      style={baseStyle}
    />
  )
}

/**
 * 明细表物料型号单元格 — AutoComplete, 选已有型号 / 输入新值都支持
 */
function renderModelInput(value, onChange, lookupOptions) {
  if (lookupOptions.length === 0) {
    return (
      <Input
        size="small"
        placeholder="物料型号"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={{ background: '#252525', borderColor: '#3a3a3a', color: '#fff' }}
      />
    )
  }
  return (
    <AutoComplete
      size="small"
      value={value || ''}
      options={lookupOptions}
      onChange={onChange}
      filterOption={(input, opt) =>
        String(opt?.value || '').toLowerCase().includes(input.toLowerCase())}
      style={{ width: '100%' }}
      popupMatchSelectWidth={420}
      notFoundContent={null}
    >
      <Input
        size="small"
        placeholder="物料型号(下拉选已有 / 输入新值)"
        style={{ background: '#252525', borderColor: '#3a3a3a', color: '#fff' }}
      />
    </AutoComplete>
  )
}
