import { Modal, Input, Radio, Space, Typography, Tag, Alert, Button } from 'antd'
import { QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useState, useEffect } from 'react'

const { Text, Paragraph } = Typography

/**
 * ClarifyQuestionModal — 结构化澄清 (§5.5.4).
 *
 * <p>渲染后端 ClarifyQuestion record, 支持三种类型:
 * <ul>
 *   <li>MISSING_SLOT — 缺失必填参数, 显示输入框让用户补充</li>
 *   <li>AMBIGUITY    — 同名歧义, 显示候选选项列表让用户选择</li>
 *   <li>POLICY_CONFIRMATION — 高风险确认, 显示确认/取消按钮</li>
 * </ul>
 *
 * @param {object} clarify - ClarifyQuestion record (后端 JSON 反序列化)
 * @param {function} onResolve - 用户完成澄清后回调, 参数为 {slot, value} 或 {confirmed: true/false}
 * @param {function} onCancel  - 用户关闭弹窗
 * @param {boolean}  loading   - 提交请求进行中
 */
export default function ClarifyQuestionModal({ clarify, onResolve, onCancel, loading }) {
  const [inputValue, setInputValue] = useState('')
  const [selectedOption, setSelectedOption] = useState(null)

  useEffect(() => {
    // 每次澄清问题变化时重置状态
    setInputValue('')
    setSelectedOption(null)
  }, [clarify])

  if (!clarify) return null

  const {
    clarifyType = 'MISSING_SLOT',
    question = '请补充信息',
    options = [],
    blockingSlot = ''
  } = clarify

  const handleConfirm = () => {
    if (clarifyType === 'MISSING_SLOT') {
      if (!inputValue.trim()) return
      onResolve({ slot: blockingSlot, value: inputValue.trim() })
    } else if (clarifyType === 'AMBIGUITY') {
      if (selectedOption === null) return
      onResolve({ slot: blockingSlot, value: selectedOption })
    } else if (clarifyType === 'POLICY_CONFIRMATION') {
      onResolve({ confirmed: true })
    }
  }

  const handleCancel = () => {
    if (clarifyType === 'POLICY_CONFIRMATION') {
      onResolve({ confirmed: false })
    } else {
      onCancel()
    }
  }

  const titleMap = {
    MISSING_SLOT: '请补充信息',
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
          disabled={
            (clarifyType === 'MISSING_SLOT' && !inputValue.trim()) ||
            (clarifyType === 'AMBIGUITY' && selectedOption === null)
          }
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

      {/* MISSING_SLOT: 输入框 */}
      {clarifyType === 'MISSING_SLOT' && (
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

      {/* AMBIGUITY: 选项列表 */}
      {clarifyType === 'AMBIGUITY' && (
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
