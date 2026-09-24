import { Modal, Space, Typography, Button, Alert, AutoComplete, Input, Tag } from 'antd'
import { useEffect, useState } from 'react'
import PlanPreviewCard, { fetchLookup } from './PlanPreviewCard'

const { Text } = Typography

/** 后端候选中的哨兵值 (非库内记录), 不进入"已有记录"下拉. */
const SENTINEL_VALUES = new Set(['NEW', '__CUSTOM__', 'CUSTOM'])

/**
 * PartyConfirmWithPreview — 2026-09-23 (销售单/采购单确认卡无明细修复).
 *
 * <p>合并一步确认: HIGH 风险写操作同时携带 partyQuestion (选供应商/客户候选) 与
 * planPreview (明细表格+参数) 时, 在一个居中 Modal 里同时渲染:
 * <ul>
 *   <li><b>PlanPreviewCard</b> — 待写入明细表格 (可编辑) + 参数 (可修改) + 补充参数;</li>
 *   <li><b>往来方选择区</b> — 可搜索下拉选已有客户/供应商, 也可直接输入新名称 (2026-09-24 改造).</li>
 * </ul>
 * 确认时把 {@code {confirmed:true, slot, value, text}} 与明细编辑一起回传, 后端守卫收敛直达建单.
 * 不再丢弃明细 (此前 partyQuestion 分支直接渲染 ClarifyQuestionModal, 明细表格不可见).
 *
 * <p>value 语义对齐后端 (见 ERPOrchestrator 往来方恢复协议):
 * 命中库内候选 → 传候选 id (Number); 否则传名称字符串 (后端精确复用同名记录, 无同名则新建).
 *
 * @param {object} partyQuestion - 后端生成的 ClarifyQuestion (含 options/blockingSlot)
 * @param {string} reason       - HIGH 风险原因文本
 * @param {object} preview      - PlanPreview (明细表格等); null 时退化为纯选项确认
 * @param {string} resumeContext- 结构化恢复上下文
 * @param {boolean} loading     - 提交进行中
 * @param {function} onConfirmReply(replyText, clarifyResponse) - 确认回传
 * @param {function} onCancelReply() - 取消回传
 */
export default function PartyConfirmWithPreview({
  partyQuestion, reason, preview, resumeContext, loading,
  onConfirmReply, onCancelReply
}) {
  // 2026-09-24: 往来方输入框文本 (选中已有记录 → 记录显示名; 也可直接输入新名称)
  const [partyText, setPartyText] = useState('')
  // 已有主数据候选 (客户/供应商全量) — 取数失败 fail-open 退化为纯输入
  const [masterOptions, setMasterOptions] = useState([])
  // 2026-09-23: PlanPreviewCard 的明细编辑结果 (stepIndex → editedParams), 确认时合并回传
  const [editedParams, setEditedParams] = useState({})

  const blockingSlot = (partyQuestion && partyQuestion.blockingSlot) || 'party'
  const slotLabel = blockingSlot === 'supplier' ? '供应商' : '客户'

  // 加载该 slot 的全部已有记录, 供"选择已有" (与明细表格同一套候选接口)
  useEffect(() => {
    if (!partyQuestion) return
    let cancelled = false
    fetchLookup(blockingSlot === 'supplier' ? 'supplier_name' : 'customer_name')
      .then(opts => { if (!cancelled) setMasterOptions(opts || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [partyQuestion, blockingSlot])

  if (!partyQuestion) return null

  const options = partyQuestion.options || []
  const question = partyQuestion.question || '请选择往来方'
  const fullQuestion = reason ? `${reason}\n\n${question}` : question

  // 显示名 → 库内候选 id (仅后端候选有 id; 主数据全量按名称字符串回传即可精确复用)
  const labelToId = new Map()
  const acOptions = []
  const pushOption = (label, id) => {
    const l = String(label == null ? '' : label).trim()
    if (!l || labelToId.has(l) || acOptions.some(o => o.value === l)) return
    if (id != null) labelToId.set(l, id)
    acOptions.push({ value: l, label: l })
  }
  // 1) 后端候选 (含单证文本命中/近期往来, 最相关, 排前)
  options.forEach(o => {
    if (SENTINEL_VALUES.has(String(o && o.value))) return
    pushOption(o && o.label, o && o.value)
  })
  // 2) 已有主数据全量 (客户/供应商)
  masterOptions.forEach(o => pushOption(o && o.value, null))
  // 3) 后端识别的"新建"名称 (来自单证), 作为可选项, 选中即按该名称新建
  const newOpt = options.find(o => String(o && o.value) === 'NEW')
  const newNameMatch = newOpt ? String(newOpt.label || '').match(/[「『"']([^」』"']+)[」』"']/) : null
  const newName = newNameMatch ? newNameMatch[1].trim() : ''
  if (newName && !labelToId.has(newName)) {
    acOptions.unshift({ value: newName, label: `新建：${newName}` })
  }

  const text = partyText.trim()
  const matchedId = labelToId.has(text) ? labelToId.get(text) : null
  const canConfirm = text.length > 0

  const handleConfirm = (editsOverride) => {
    if (!canConfirm) return
    const edits = editsOverride || editedParams
    const hasEdits = Object.keys(edits).length > 0
    const clarifyResponse = {
      confirmed: true,
      slot: blockingSlot,
      // 命中库内候选 → id; 否则传名称字符串 (后端精确复用同名记录, 无同名则新建)
      value: matchedId != null ? matchedId : text,
      text,
      editedParams: hasEdits ? edits : null
    }
    onConfirmReply(hasEdits ? `确认编辑 ${JSON.stringify(edits)}` : '确认', clarifyResponse)
  }

  const handleCancel = () => {
    onCancelReply()
  }

  return (
    <Modal
      open
      title="执行前确认"
      width={760}
      centered
      onCancel={handleCancel}
      footer={null}
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
    >
      {/* 明细表格 + 参数 (可编辑) */}
      {preview && (
        <PlanPreviewCard
          preview={preview}
          loading={loading}
          onConfirm={(edits) => { setEditedParams(edits || {}); handleConfirm(edits || {}) }}
          onCancel={handleCancel}
        />
      )}

      {/* 往来方选择区: 下拉选已有 + 直接输入新名称 */}
      <div style={{ marginTop: preview ? 12 : 0, padding: '12px 4px' }}>
        <Alert
          type="warning"
          showIcon
          message={<Text style={{ fontSize: 13 }}>{fullQuestion}</Text>}
          style={{ marginBottom: 8 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{slotLabel}:</Text>
          <AutoComplete
            style={{ width: 320 }}
            value={partyText}
            options={acOptions}
            onChange={v => setPartyText(v == null ? '' : v)}
            filterOption={(input, opt) =>
              String((opt && opt.value) || '').toLowerCase().includes(String(input).toLowerCase())}
            popupMatchSelectWidth={380}
            notFoundContent={
              <Text type="secondary" style={{ fontSize: 12 }}>未匹配到已有记录，将按新名称创建</Text>
            }
          >
            <Input allowClear placeholder={`下拉选已有${slotLabel}，或直接输入新名称`} />
          </AutoComplete>
          {text && (matchedId != null
            ? <Tag color="green">已匹配已有{slotLabel}</Tag>
            : <Tag color="blue">将新建{slotLabel}「{text}」</Tag>)}
        </div>
        <Text type="secondary" style={{ fontSize: 11 }}>
          可选已有 {acOptions.length} 条（含单证命中与近期往来），也可直接输入新名称后确认。
        </Text>
      </div>

      {/* 操作按钮 */}
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" danger loading={loading} disabled={!canConfirm} onClick={() => handleConfirm()}>
          确认执行
        </Button>
        <Button onClick={handleCancel} disabled={loading}>取消</Button>
      </Space>
    </Modal>
  )
}
