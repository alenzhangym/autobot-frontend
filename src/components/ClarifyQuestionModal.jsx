import { Modal, Input, Radio, Checkbox, Space, Typography, Tag, Alert, Button, Divider } from 'antd'
import { QuestionCircleOutlined, WarningOutlined, FormOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import DiffViewer from './DiffViewer'
import { MarkdownContent } from '../utils/helpers.jsx'

const { Text, Paragraph } = Typography
const { TextArea } = Input

/**
 * 把确认卡文本按 ```diff 围栏切成 [普通 markdown 段, diff 段, ...]，
 * 让"方案说明"走 MarkdownContent、"逐文件改动"走 DiffViewer（F15）。
 */
function splitDiffSegments(text) {
  const out = []
  const re = /```(?:diff|diff-git)?\n?([\s\S]*?)```/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'md', text: text.slice(last, m.index) })
    out.push({ kind: 'diff', text: m[1].replace(/\n$/, '') })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ kind: 'md', text: text.slice(last) })
  return out
}

/**
 * ClarifyQuestionModal — 结构化澄清 (§5.5.4) + G7 多轮补参 (2026-09 收口)
 * + LLM 选项式澄清 (输入Mode: 单选/多选/自定义, 2026-09-17).
 *
 * <p>渲染后端 ClarifyQuestion record, 支持四种形态:
 * <ul>
 *   <li>FREE_TEXT — 缺失必填参数, 显示输入框让用户补充 (旧 MISSING_SLOT)</li>
 *   <li>SINGLE_SELECT — 单选候选 (Radio; 旧 AMBIGUITY) + 可选"其他/自定义"</li>
 *   <li>MULTI_SELECT — 多选候选 (Checkbox) + 可选"其他/自定义"</li>
 *   <li>POLICY_CONFIRMATION — 高风险确认, 显示确认/取消按钮</li>
 * </ul>
 *
 * <p>渲染模式优先级: {@code clarify.inputMode} 显式值优先; 为空时按
 * {@code clarifyType} 推导 (AMBIGUITY→SINGLE_SELECT, 其余→FREE_TEXT) 以保持旧行为不变。</p>
 *
 * <p>G7 多轮补参: 后端仍缺槽位时返回 {@code stillMissing=true} + {@code missingSlots},
 * 本组件在同会话内连续重弹(不新开会话), 并展示"还需补充"进度供用户感知.</p>
 *
 * @param {object} clarify - ClarifyQuestion record (后端 JSON 反序列化)
 * @param {function} onResolve - 用户完成澄清后回调, 参数为 {slot, value, text} 或 {confirmed}
 *         单选/自定义 value 为标量; 多选 value 为数组; text 为用户可读拼接串(供聊天气泡/后端续接)
 * @param {function} onCancel  - 用户关闭弹窗
 * @param {boolean}  loading   - 提交请求进行中
 */
export default function ClarifyQuestionModal({ clarify, onResolve, onCancel, loading }) {
  const [inputValue, setInputValue] = useState('')
  const [selectedOption, setSelectedOption] = useState(null)
  const [multiValues, setMultiValues] = useState([])
  const [customEnabled, setCustomEnabled] = useState(false)
  // F15: 确认卡的「修改意见 → 重新出方案」回路状态
  const [reviseOpen, setReviseOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')

  useEffect(() => {
    // 每次澄清问题变化时重置状态 (G7: 多轮连续追问时新问题到来即重置输入)
    setInputValue('')
    setSelectedOption(null)
    setMultiValues([])
    setCustomEnabled(false)
    setReviseOpen(false)
    setFeedbackText('')
  }, [clarify])

  if (!clarify) return null

  const {
    clarifyType = 'MISSING_SLOT',
    question = '请补充信息',
    options = [],
    blockingSlot = '',
    stillMissing = false,
    missingSlots = [],
    inputMode,
    allowCustomInput = false,
    allowRevise = false
  } = clarify

  // F15: 高风险确认卡文本含 ```diff 段 → 切段渲染 (方案说明 markdown + 逐文件 diff)
  const isPolicy = clarifyType === 'POLICY_CONFIRMATION'
  const segments = useMemo(
    () => (isPolicy ? splitDiffSegments(question || '') : null),
    [isPolicy, question]
  )
  const hasDiff = !!(segments && segments.some(s => s.kind === 'diff'))

  // 有效渲染模式: 显式 inputMode 优先; 缺省按 clarifyType 推导 (保持旧行为)
  const mode = inputMode || (clarifyType === 'AMBIGUITY' ? 'SINGLE_SELECT' : 'FREE_TEXT')
  // 2026-09-20 (合并一步): POLICY_CONFIRMATION 携带 options = HIGH 风险确认 + 选项式选择
  // (如确认卡片内直接选供应商/客户), 按 SINGLE_SELECT 渲染选项, 确认时同时回传 {confirmed, slot, value, text}.
  const withPolicyOptions = clarifyType === 'POLICY_CONFIRMATION' && options.length > 0
  const effMode = withPolicyOptions ? 'SINGLE_SELECT' : mode
  const isSelect = effMode === 'SINGLE_SELECT' || effMode === 'MULTI_SELECT'
  const canCustom = !!allowCustomInput && isSelect
  const hasCustomValue = customEnabled && !!inputValue.trim()

  const labelOf = (v) => {
    const opt = options.find(o => o.value === v)
    return opt ? opt.label : String(v)
  }

  // 组装回传结果 { slot, value, text }: value 单选/自定义为标量, 多选为数组; text 供气泡与后端续接
  const buildResult = () => {
    if (effMode === 'FREE_TEXT') {
      const val = inputValue.trim()
      return { slot: blockingSlot, value: val, text: val }
    }
    if (effMode === 'MULTI_SELECT') {
      const chosen = [...multiValues]
      if (hasCustomValue) chosen.push(inputValue.trim())
      return { slot: blockingSlot, value: chosen, text: chosen.map(labelOf).join('、') }
    }
    // SINGLE_SELECT
    if (hasCustomValue) {
      return { slot: blockingSlot, value: inputValue.trim(), text: inputValue.trim() }
    }
    return { slot: blockingSlot, value: selectedOption, text: labelOf(selectedOption) }
  }

  const handleConfirm = () => {
    if (clarifyType === 'POLICY_CONFIRMATION') {
      onResolve(withPolicyOptions ? { confirmed: true, ...buildResult() } : { confirmed: true })
      return
    }
    onResolve(buildResult())
  }

  // 2026-09-23 (防误触): 高风险确认只有"取消操作"按钮显式触发取消;
  // 弹窗右上角 X / ESC 键走 handleCancel(false) → 保持弹窗打开, 不取消, 防止手滑取消整单.
  const handleCancel = (explicit = false) => {
    if (clarifyType !== 'POLICY_CONFIRMATION') {
      onCancel()
      return
    }
    if (explicit) onResolve({ confirmed: false })
    // X/ESC → 忽略, 不清除/不取消 (HIGH 风险必须显式二选一)
  }

  const canSubmit =
    clarifyType === 'POLICY_CONFIRMATION'
      ? (withPolicyOptions ? (hasCustomValue || selectedOption !== null) : true)
      : effMode === 'FREE_TEXT'
        ? !!inputValue.trim()
        : effMode === 'MULTI_SELECT'
          ? multiValues.length > 0 || hasCustomValue
          : hasCustomValue || selectedOption !== null

  // F15: 提交修改意见 → 后端带探索上下文重出方案 (不落盘)。载荷必须带 verdict,
  // 否则 {confirmed:false} 会被 resume 的取消判定吃掉。
  const handleRevise = () => {
    const fb = feedbackText.trim()
    if (!fb) return
    onResolve({ confirmed: false, verdict: 'revise', feedback: fb, text: `修改意见，${fb}` })
  }

  const titleMap = {
    MISSING_SLOT: stillMissing ? '请继续补充信息' : '请补充信息',
    AMBIGUITY: '请选择',
    POLICY_CONFIRMATION: '需要确认'
  }

  const iconMap = {
    MISSING_SLOT: <QuestionCircleOutlined style={{ color: '#1677ff' }} />,
    AMBIGUITY: <QuestionCircleOutlined style={{ color: '#fa8c16' }} />,
    POLICY_CONFIRMATION: <WarningOutlined style={{ color: '#ff4d4f' }} />
  }

  const footerButtons = [
    <Button key="cancel" onClick={() => handleCancel(true)} disabled={loading}>
      {clarifyType === 'POLICY_CONFIRMATION' ? '取消操作' : '稍后再说'}
    </Button>,
    <Button
      key="ok"
      type="primary"
      onClick={handleConfirm}
      loading={loading}
      disabled={!canSubmit}
    >
      {clarifyType === 'POLICY_CONFIRMATION' ? '确认执行' : '提交'}
    </Button>
  ]
  if (isPolicy && allowRevise) {
    footerButtons.unshift(
      <Button key="revise" icon={<FormOutlined />} disabled={loading}
        onClick={() => setReviseOpen(v => !v)}>
        提交修改意见
      </Button>
    )
  }

  return (
    <Modal
      open={true}
      title={
        <Space>
          {iconMap[clarifyType]}
          <span>{titleMap[clarifyType]}</span>
          {stillMissing && (
            <Tag color="blue" style={{ marginInlineStart: 4 }}>
              还需 {missingSlots.length} 项
            </Tag>
          )}
        </Space>
      }
      onCancel={handleCancel}
      keyboard={clarifyType !== 'POLICY_CONFIRMATION'}
      footer={footerButtons}
      width={hasDiff ? 860 : 480}
      maskClosable={false}
    >
      {/* 问题文本 — F15: 含 ```diff 的方案卡按段渲染 (方案说明 markdown + 逐文件 diff)；
          其余形态(含旧的高风险确认文案)保持纯文本 Paragraph 不变 (零回归) */}
      {isPolicy && hasDiff && segments ? (
        <div style={{ marginBottom: 16, maxHeight: '58vh', overflow: 'auto' }}>
          {segments.map((seg, i) => seg.kind === 'diff'
            ? <div key={i} style={{ margin: '8px 0' }}><DiffViewer diff={seg.text} maxHeight={260} /></div>
            : <div key={i}>{seg.text.trim() ? <MarkdownContent content={seg.text.trim()} /> : null}</div>
          )}
        </div>
      ) : (
        <Paragraph style={{ marginBottom: 16, fontSize: 14 }}>
          {question}
        </Paragraph>
      )}

      {/* G7: 多轮补参进度 — 同会话内仍需补齐的槽位列表 */}
      {stillMissing && missingSlots.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            还需补充: {missingSlots.join('、')}
          </Text>
        </div>
      )}

      {/* FREE_TEXT: 输入框 (HIGH 风险确认不计入, 仅保留确认/取消按钮) */}
      {mode === 'FREE_TEXT' && clarifyType !== 'POLICY_CONFIRMATION' && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            参数: {blockingSlot}
          </Text>
          <Input
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder={`请输入 ${blockingSlot} 的值`}
            onPressEnter={handleConfirm}
            autoFocus
            style={{ marginTop: 4 }}
          />
        </div>
      )}

      {/* SINGLE_SELECT: 单选选项列表 (含 POLICY_CONFIRMATION+options 合并一步: 确认卡片内直接选往来方) */}
      {(mode === 'SINGLE_SELECT' || withPolicyOptions) && (
        <div>
          <Radio.Group
            value={selectedOption}
            onChange={e => setSelectedOption(e.target.value)}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {options.map((opt, idx) => (
                <Radio key={idx} value={opt.value} style={{ padding: '4px 0' }}>
                  <Space>
                    <Text strong>{opt.label}</Text>
                    {opt.description && <Text type="secondary" style={{ fontSize: 12 }}>({opt.description})</Text>}
                  </Space>
                </Radio>
              ))}
            </Space>
          </Radio.Group>

          {canCustom && (
            <div style={{ marginTop: 8 }}>
              <Checkbox checked={customEnabled} onChange={e => setCustomEnabled(e.target.checked)}>
                <Text type="secondary" style={{ fontSize: 13 }}>其他 / 自定义输入</Text>
              </Checkbox>
              {customEnabled && (
                <Input
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  placeholder="请输入补充信息"
                  onPressEnter={handleConfirm}
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* MULTI_SELECT: 多选选项列表 */}
      {mode === 'MULTI_SELECT' && (
        <div>
          <Checkbox.Group
            value={multiValues}
            onChange={values => setMultiValues(values)}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {options.map((opt, idx) => (
                <Checkbox key={idx} value={opt.value} style={{ padding: '4px 0' }}>
                  <Space>
                    <Text strong>{opt.label}</Text>
                    {opt.description && <Text type="secondary" style={{ fontSize: 12 }}>({opt.description})</Text>}
                  </Space>
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>

          {canCustom && (
            <div style={{ marginTop: 8 }}>
              <Checkbox checked={customEnabled} onChange={e => setCustomEnabled(e.target.checked)}>
                <Text type="secondary" style={{ fontSize: 13 }}>其他 / 自定义输入</Text>
              </Checkbox>
              {customEnabled && (
                <Input
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  placeholder="请输入补充信息（将附加到已选项）"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* POLICY_CONFIRMATION: 确认提示 */}
      {clarifyType === 'POLICY_CONFIRMATION' && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={isPolicy && allowRevise
            ? '确认后才写入文件；对方案有异议可点「提交修改意见」重新出方案（不会落盘）。'
            : '此操作为高风险或不可逆操作, 请确认后执行.'}
          style={{ marginBottom: 8 }}
        />
      )}

      {/* F15: 修改意见回路 — 只在后端 allowRevise=true 时提供 (开关关时不显示, 免输入不被受理的意见) */}
      {isPolicy && allowRevise && reviseOpen && (
        <div style={{ marginTop: 8 }}>
          <Divider style={{ margin: '8px 0' }} orientation="left" plain>
            <Text type="secondary" style={{ fontSize: 12 }}>对方案的修改意见</Text>
          </Divider>
          <TextArea
            rows={3}
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="例如：先只改后端 Service，前端这轮不动；或 第 2 个文件的包路径不对"
            autoFocus
          />
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" ghost onClick={handleRevise}
              disabled={loading || !feedbackText.trim()}>
              按意见重新出方案
            </Button>
            <Button onClick={() => setReviseOpen(false)} disabled={loading}>收起</Button>
          </Space>
        </div>
      )}
    </Modal>
  )
}