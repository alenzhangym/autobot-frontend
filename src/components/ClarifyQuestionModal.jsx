import { Modal, Input, Radio, Checkbox, Space, Typography, Tag, Alert, Button } from 'antd'
import { QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useState, useEffect } from 'react'

const { Text, Paragraph } = Typography

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

  useEffect(() => {
    // 每次澄清问题变化时重置状态 (G7: 多轮连续追问时新问题到来即重置输入)
    setInputValue('')
    setSelectedOption(null)
    setMultiValues([])
    setCustomEnabled(false)
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
    allowCustomInput = false
  } = clarify

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

  const handleCancel = () => {
    if (clarifyType === 'POLICY_CONFIRMATION') {
      onResolve({ confirmed: false })
    } else {
      onCancel()
    }
  }

  const canSubmit =
    clarifyType === 'POLICY_CONFIRMATION'
      ? (withPolicyOptions ? (hasCustomValue || selectedOption !== null) : true)
      : effMode === 'FREE_TEXT'
        ? !!inputValue.trim()
        : effMode === 'MULTI_SELECT'
          ? multiValues.length > 0 || hasCustomValue
          : hasCustomValue || selectedOption !== null

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
      footer={[
        <Button key="cancel" onClick={handleCancel} disabled={loading}>
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
      ]}
      width={480}
      maskClosable={false}
    >
      {/* 问题文本 */}
      <Paragraph style={{ marginBottom: 16, fontSize: 14 }}>
        {question}
      </Paragraph>

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
          message="此操作为高风险或不可逆操作, 请确认后执行."
          style={{ marginBottom: 8 }}
        />
      )}
    </Modal>
  )
}