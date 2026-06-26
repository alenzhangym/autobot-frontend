import React, { useState, useCallback, useEffect } from 'react'
import { Alert, Button, Input, Modal, Space, Tag, Typography, message } from 'antd'
import { QuestionCircleOutlined, BulbOutlined, SendOutlined } from '@ant-design/icons'
import api from '../auth'

const { Text } = Typography

/**
 * S6: 意图纠正浮层。
 *
 * <p>"closed-loop learning" 的入口：当 IntentAnalyzer 误判时，用户告诉后端
 * "我其实想问的是 X"。S6 在 chat 流上挂一个"🤔 你是不是想问 X？" 浮层。</p>
 *
 * <ul>
 *   <li>父组件通过 {@code visible} / {@code onClose} 控制显示</li>
 *   <li>{@code query} —— 用户的原始问题</li>
 *   <li>{@code predictedIntent} —— 后端预测的意图</li>
 *   <li>用户填写 {@code correctedIntent} + 可选 {@code reason} → 提交</li>
 * </ul>
 *
 * <p>提交走 {@code POST /api/intent/correct}（后端
 * {@code com.autobot.controller.CodeAnalysisController#correctIntent}）。
 * 注意：前端 {@code api} 实例 baseURL 已是 {@code /api}，调用时不要再加
 * {@code /api} 前缀，否则会拼成 {@code /api/api/intent/correct} 返回 404。</p>
 *
 * <p>使用方式（父组件）：</p>
 * <pre>
 *   &lt;IntentCorrectionFloater
 *     visible={floaterOpen}
 *     onClose={() => setFloaterOpen(false)}
 *     query={lastUserQuery}
 *     predictedIntent={lastPredictedIntent}
 *     onResult={(replayResult) =&gt; { ... 把 final 注入聊天流并标记 plan 为 executed ... }}
 *   /&gt;
 * </pre>
 */
export default function IntentCorrectionFloater({ visible, onClose, onResult, query, predictedIntent, sessionId }) {
  const [corrected, setCorrected] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [alternatives, setAlternatives] = useState([])

  // A 方案：code 会话意图候选，4 档来自后端 CodeSessionIntent 枚举。
  // 后端会从 ANALYZE/FIX/BUILD/QUERY 中选一作为 predictedIntent；用户纠错时也用同一集合。
  useEffect(() => {
    if (!visible) return
    setCorrected('')
    setReason('')
    setAlternatives([
      'ANALYZE',
      'FIX',
      'BUILD',
      'QUERY',
    ])
  }, [visible])

  const submit = useCallback(async () => {
    if (!corrected || !corrected.trim()) {
      message.warning('请填写正确的意图')
      return
    }
    if (!query || !predictedIntent) {
      message.error('缺少 query / predictedIntent')
      return
    }
    // 异步化: 点提交立刻关 modal + 清表单，不阻塞用户后续操作。
    // 后端 /intent/correct 同步 chatExecute (enforce-final 模式) 跑完可能要几十秒，
    // 之前整段 await 会让 modal 转圈圈卡住, 用户体验差。
    // 现在: 关 modal 释放 UI → 后台跑 api.post → 响应到达时调 onResult 注入聊天流。
    const finalCorrected = corrected.trim()
    const finalReason = reason.trim() || null
    setCorrected('')
    setReason('')
    onClose && onClose()

    // 后台异步处理: 不再 await, fire-and-forget 处理响应
    ;(async () => {
      try {
        // baseURL 已是 /api，path 直接给 intent/correct——不能再加 /api/ 前缀
        const r = await api.post('/intent/correct', {
          query,
          predicted_intent: predictedIntent,
          corrected_intent: finalCorrected,
          reason: finalReason,
          // 带 session_id 让后端用 corrected 意图重放分析，避免"前端一轮停止"
          session_id: sessionId || null,
        })
        const ok = r && r.data && r.data.status === 'success'
        if (ok) {
          // 方案 A: 后端 /intent/correct 同步返回了 replay_result (内含 final conclusion)，
          // 通过 onResult 回调把 final 注入聊天流 + 标记 plan 为 executed。
          // 聊天流里出现 assistant 消息 + plan 切到 executed 即为"成功"反馈，
          // 这里不再弹 message.success 避免和聊天注入重复打扰。
          //
          // 路线 B: 把整条响应 (含 re_verify 标志 + replay_result) 透出,
          // 父组件 App.jsx 拿到 re_verify=true 时挂 ReVerifyProgressToast。
          if (typeof onResult === 'function') {
            try {
              onResult(r.data)
            } catch (cbErr) {
              // 父组件 callback 出错不能让 floater 卡死 (modal 已关, 这里只 console)
              console.error('[IntentCorrectionFloater] onResult callback threw:', cbErr)
            }
          }
        } else {
          message.error((r && r.data && r.data.message) || '提交失败')
        }
      } catch (e) {
        message.error(e && e.response && e.response.data && e.response.data.message
          ? e.response.data.message
          : (e && e.message) || '网络错误')
      }
    })()
  }, [corrected, reason, query, predictedIntent, sessionId, onClose, onResult])

  return (
    <Modal
      title={<Space><QuestionCircleOutlined /> 意图纠正</Space>}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={520}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        icon={<BulbOutlined />}
        message="后端可能误判了您的意图"
        description={
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">原问题：</Text>
              <Text strong>{query || '(空)'}</Text>
            </div>
            <div>
              <Text type="secondary">后端预测：</Text>
              <Tag color="processing">{predictedIntent || '(未给出)'}</Tag>
            </div>
          </Space>
        }
        style={{ marginBottom: 12 }}
      />
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <div>
          <Text>正确的意图（可手填或点候选）</Text>
          <Input
            value={corrected}
            placeholder="e.g. SYSTEM_OPERATION"
            onChange={e => setCorrected(e.target.value)}
            style={{ marginTop: 4 }}
          />
          <Space wrap style={{ marginTop: 6 }}>
            {alternatives.map(a => (
              <Tag
                key={a}
                color={corrected === a ? 'success' : 'default'}
                style={{ cursor: 'pointer' }}
                onClick={() => setCorrected(a)}
              >
                {a}
              </Tag>
            ))}
          </Space>
        </div>
        <div>
          <Text>补充原因（可选）</Text>
          <Input.TextArea
            value={reason}
            rows={2}
            placeholder="为什么不是预测的那个意图？"
            onChange={e => setReason(e.target.value)}
            style={{ marginTop: 4 }}
          />
        </div>
        <div style={{ textAlign: 'right' }}>
          <Button onClick={onClose} style={{ marginRight: 8 }}>取消</Button>
          <Button type="primary" icon={<SendOutlined />} loading={submitting} onClick={submit}>
            提交纠正
          </Button>
        </div>
      </Space>
    </Modal>
  )
}
