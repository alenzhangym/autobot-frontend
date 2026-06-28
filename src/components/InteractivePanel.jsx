import { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Radio, Checkbox, Space, Tag, Progress, List, Card, Tooltip, Empty, Spin } from 'antd'
import { QuestionCircleOutlined, CheckSquareOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useInteractiveState } from '../hooks/useInteractiveState.js'

/**
 * v5 N-8: 把 LLM 跟用户的实时互动收到一个面板：
 *
 * <ul>
 *   <li>Pending question 弹窗（按 FIFO 处理）</li>
 *   <li>TODO 清单（status / priority / 勾选）</li>
 * </ul>
 *
 * 状态机：挂个 useInteractiveState 就够，自己负责渲染。
 */
export function InteractivePanel({ sessionId, style }) {
  const {
    pendingQuestions, todos, connected,
    answerQuestion, updateTodo, clearTodos,
  } = useInteractiveState({ sessionId, enabled: !!sessionId })

  const [currentQ, setCurrentQ] = useState(null)
  const [singleSel, setSingleSel] = useState(null)
  const [multiSel, setMultiSel] = useState(new Set())

  // FIFO：拿队首
  useEffect(() => {
    if (!currentQ && pendingQuestions.length > 0) {
      setCurrentQ(pendingQuestions[0])
      const q = pendingQuestions[0]
      if (q.multiSelect) {
        setMultiSel(new Set(q.default ? [q.default] : []))
      } else {
        setSingleSel(q.default || null)
      }
    }
  }, [pendingQuestions, currentQ])

  const submit = async () => {
    if (!currentQ) return
    let ans
    if (currentQ.multiSelect) {
      ans = Array.from(multiSel)
      if (ans.length === 0 && currentQ.options && currentQ.options.length > 0) ans = [currentQ.default || currentQ.options[0]]
    } else {
      ans = singleSel || currentQ.default || (currentQ.options && currentQ.options[0])
    }
    if (!ans) return
    const ok = await answerQuestion(currentQ.id, Array.isArray(ans) ? ans.join(',') : ans)
    if (ok) {
      setCurrentQ(null)
      setSingleSel(null)
      setMultiSel(new Set())
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ padding: 8, ...style }}>
      <Modal
        title={
          <Space>
            <QuestionCircleOutlined />
            {currentQ?.header || 'LLM 在问你'}
          </Space>
        }
        open={!!currentQ}
        onCancel={() => {
          // 取消 = 暂不答，关掉当前 question 等下次进来再问
          setCurrentQ(null)
        }}
        footer={[
          <Button key="ok" type="primary" onClick={submit} disabled={!currentQ}>
            回答
          </Button>,
        ]}
        destroyOnClose
      >
        {currentQ ? (
          <div>
            <p style={{ fontSize: 14, marginBottom: 12 }}>{currentQ.question}</p>
            {currentQ.multiSelect ? (
              <Checkbox.Group
                value={Array.from(multiSel)}
                onChange={(vals) => setMultiSel(new Set(vals))}
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                {(currentQ.options || []).map((opt) => (
                  <Checkbox key={opt} value={opt}>{opt}</Checkbox>
                ))}
              </Checkbox.Group>
            ) : (
              <Radio.Group
                value={singleSel}
                onChange={(e) => setSingleSel(e.target.value)}
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                {(currentQ.options || []).map((opt) => (
                  <Radio key={opt} value={opt}>{opt}</Radio>
                ))}
              </Radio.Group>
            )}
          </div>
        ) : null}
      </Modal>

      <Card
        size="small"
        title={
          <Space>
            <CheckSquareOutlined />
            <span>TODO ({todos.items.length})</span>
            <Tooltip title={connected ? 'WS 已连' : 'WS 未连'}>
              <Tag color={connected ? 'green' : 'orange'}>
                {connected ? 'online' : 'offline'}
              </Tag>
            </Tooltip>
          </Space>
        }
        extra={
          todos.items.length > 0 ? (
            <Button size="small" type="text" danger onClick={clearTodos}>清空</Button>
          ) : null
        }
      >
        {todos.items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 TODO" />
        ) : (
          <>
            <Progress
              percent={Math.round(progressPercent(todos.items) * 100)}
              size="small"
              showInfo
            />
            <List
              size="small"
              dataSource={todos.items}
              renderItem={(it) => (
                <List.Item
                  key={it.id}
                  actions={[
                    <Tag key="p" color={priorityColor(it.priority)}>{it.priority}</Tag>,
                    <Button
                      key="c"
                      size="small"
                      type={it.status === 'completed' ? 'default' : 'primary'}
                      onClick={() =>
                        updateTodo(it.id, {
                          status: it.status === 'completed' ? 'pending' : 'completed',
                        })
                      }
                    >
                      {it.status === 'completed' ? '重做' : '完成'}
                    </Button>,
                    it.status !== 'in_progress' && it.status !== 'completed' && it.status !== 'cancelled' ? (
                      <Button
                        key="s"
                        size="small"
                        onClick={() => updateTodo(it.id, { status: 'in_progress' })}
                      >
                        启动
                      </Button>
                    ) : null,
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    avatar={statusIcon(it.status)}
                    title={it.content}
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </Card>
    </div>
  )
}

function progressPercent(items) {
  if (items.length === 0) return 0
  const done = items.filter((i) => i.status === 'completed' || i.status === 'cancelled').length
  return done / items.length
}

function priorityColor(p) {
  switch (p) {
    case 'urgent': return 'red'
    case 'high': return 'volcano'
    case 'medium': return 'gold'
    case 'low': return 'green'
    default: return 'default'
  }
}

function statusIcon(s) {
  if (s === 'completed') return <CheckSquareOutlined style={{ color: '#52c41a' }} />
  if (s === 'in_progress') return <ClockCircleOutlined style={{ color: '#1677ff' }} />
  if (s === 'cancelled') return <span style={{ color: '#999' }}>✕</span>
  return <span style={{ color: '#bbb' }}>○</span>
}

export default InteractivePanel
