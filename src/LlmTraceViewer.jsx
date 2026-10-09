/**
 * ReAct 全链路可观测页面（仅超管可见）。
 *
 * 用途：观察每个会话、每次问话(turn)、每个阶段(agent) 的 LLM 调用——
 * 该阶段用了什么上下文(prompt)、什么配置(model/temp/maxTokens/topP)、LLM 返回了什么、
 * 耗时多少、状态如何（OK/EMPTY/ERROR/CANCELLED）。用于快速定位提示词类错误。
 *
 * 数据来源（均 SUPER_ADMIN）：
 *   - GET /admin/llm/trace/sessions                          — 有 trace 的会话列表
 *   - GET /admin/llm/trace/turns?sessionId=                  — 会话内轮次聚合
 *   - GET /admin/llm/trace/entries?sessionId=&turnId=|noTurn= — 轮次内条目（无 payload）
 *   - GET /admin/llm/trace/entry?id=                         — 单条详情（含完整 prompt/response）
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Card, Row, Col, List, Tag, Spin, Empty, Button, message, Drawer, Descriptions, Input, Space, Tabs } from 'antd'
import {
  ReloadOutlined, FileSearchOutlined, ApartmentOutlined, OrderedListOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import api from './auth'

const { Content } = Layout

const COPPER = '#d4a574'
const COPPER_DIM = 'rgba(212,165,116,0.3)'
const COPPER_GLOW = 'rgba(212,165,116,0.08)'

const MONO = "'JetBrains Mono', monospace"

function statusColor(status) {
  switch (status) {
    case 'OK': return 'green'
    case 'EMPTY': return 'orange'
    case 'ERROR': return 'red'
    case 'CANCELLED': return 'default'
    default: return 'default'
  }
}

function fmtTime(v) {
  if (v === null || v === undefined) return '—'
  const d = typeof v === 'number' ? new Date(v) : new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function MonoBlock({ text }) {
  return (
    <pre style={{
      margin: 0, padding: 12, background: '#0d0d0d', border: '1px solid #2a2620', borderRadius: 4,
      fontFamily: MONO, fontSize: 12, lineHeight: 1.55, color: '#c9c3b8',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 520, overflow: 'auto',
    }}>
      {text && text.length ? text : '（空）'}
    </pre>
  )
}

export default function LlmTraceViewer() {
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [manualSession, setManualSession] = useState('')

  const [turns, setTurns] = useState([])
  const [loadingTurns, setLoadingTurns] = useState(false)
  const [turnSelection, setTurnSelection] = useState(null) // { turnId: number|null, noTurn: bool }

  const [entries, setEntries] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(false)

  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const res = await api.get('/admin/llm/trace/sessions', { params: { limit: 100 } })
      setSessions(res.data?.sessions || [])
    } catch (err) {
      const code = err.response?.status
      if (code === 403) message.error('仅超级管理员可访问')
      else if (code === 401) message.error('未登录, 请重新登录')
      else message.error('获取会话列表失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  const fetchTurns = useCallback(async (sid) => {
    if (!sid) return
    setLoadingTurns(true)
    try {
      const res = await api.get('/admin/llm/trace/turns', { params: { sessionId: sid, limit: 500 } })
      setTurns(res.data?.turns || [])
    } catch (err) {
      message.error('获取轮次失败: ' + (err.response?.data?.error || err.message))
      setTurns([])
    } finally {
      setLoadingTurns(false)
    }
  }, [])

  const fetchEntries = useCallback(async (sid, sel) => {
    if (!sid || !sel) { setEntries([]); return }
    setLoadingEntries(true)
    try {
      const params = { sessionId: sid }
      if (sel.noTurn) params.noTurn = true
      else params.turnId = sel.turnId
      const res = await api.get('/admin/llm/trace/entries', { params })
      setEntries(res.data?.entries || [])
    } catch (err) {
      message.error('获取条目失败: ' + (err.response?.data?.error || err.message))
      setEntries([])
    } finally {
      setLoadingEntries(false)
    }
  }, [])

  const openDetail = useCallback(async (id) => {
    setDrawerOpen(true)
    setLoadingDetail(true)
    setDetail(null)
    try {
      const res = await api.get('/admin/llm/trace/entry', { params: { id } })
      setDetail(res.data)
    } catch (err) {
      message.error('获取详情失败: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions])
  useEffect(() => { fetchTurns(sessionId) }, [sessionId, fetchTurns])
  useEffect(() => { fetchEntries(sessionId, turnSelection) }, [sessionId, turnSelection, fetchEntries])

  const refreshAll = () => {
    fetchSessions()
    if (sessionId) fetchTurns(sessionId)
    if (sessionId && turnSelection) fetchEntries(sessionId, turnSelection)
  }

  const applyManualSession = () => {
    const v = manualSession.trim()
    if (!v) return
    setSessionId(v)
    setTurnSelection(null)
    setEntries([])
  }

  return (
    <Content style={{ background: '#0d0d0d', padding: '20px 24px', overflow: 'auto', height: '100%' }}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        {/* 标题 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <FileSearchOutlined style={{ fontSize: 22, color: COPPER }} />
            <span style={{ fontSize: 22, fontWeight: 500, color: '#e8e3d8', fontFamily: "'Fraunces', serif", letterSpacing: '-0.01em' }}>
              ReAct 全链路观测
            </span>
            <Tag color="gold" style={{ fontSize: 11, marginInlineEnd: 0, borderColor: COPPER_DIM, color: COPPER, background: COPPER_GLOW }}>
              SUPER ADMIN
            </Tag>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={refreshAll} loading={loadingSessions}
              style={{ color: '#888', marginLeft: 4 }} />
          </div>
          <div style={{ fontSize: 12.5, color: '#807a6e', fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
            下钻「会话 → 每轮问话 → 每个阶段」查看每次 LLM 调用的上下文(prompt)、配置、返回与状态，用于定位提示词类错误
          </div>
        </div>

        <Row gutter={12}>
          {/* 会话列表 */}
          <Col xs={24} md={7} lg={6}>
            <Card
              size="small"
              style={{ background: '#1a1a1a', borderColor: '#333' }}
              headStyle={{ borderBottomColor: '#333', color: '#e8e3d8', fontSize: 13 }}
              bodyStyle={{ padding: 0, maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}
              title={<Space size={6}><ApartmentOutlined style={{ color: COPPER }} />会话</Space>}
            >
              <div style={{ padding: 10, borderBottom: '1px solid #2a2620' }}>
                <Input.Search
                  size="small"
                  placeholder="手动输入 sessionId"
                  value={manualSession}
                  onChange={e => setManualSession(e.target.value)}
                  onSearch={applyManualSession}
                  enterButton="查"
                />
              </div>
              {loadingSessions ? (
                <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
              ) : sessions.length === 0 ? (
                <Empty style={{ padding: 20 }} description={<span style={{ color: '#807a6e', fontSize: 12 }}>暂无 trace 记录</span>} />
              ) : (
                <List
                  dataSource={sessions}
                  renderItem={s => {
                    const sid = s.sessionid || s.sessionId
                    const active = sid === sessionId
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => { setSessionId(sid); setTurnSelection(null); setEntries([]) }}
                        onKeyDown={e => { if (e.key === 'Enter') { setSessionId(sid); setTurnSelection(null) } }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #232323',
                          background: active ? COPPER_GLOW : 'transparent',
                        }}
                      >
                        <div style={{ fontFamily: MONO, fontSize: 12, color: active ? COPPER : '#a8a298', wordBreak: 'break-all' }}>
                          {sid}
                        </div>
                        <div style={{ fontSize: 11, color: '#5a554d', marginTop: 2 }}>
                          {s.entrycount ?? s.entryCount} 条 · {fmtTime(s.lastat ?? s.lastAt)}
                        </div>
                      </div>
                    )
                  }}
                />
              )}
            </Card>
          </Col>

          {/* 轮次列表 */}
          <Col xs={24} md={8} lg={8}>
            <Card
              size="small"
              style={{ background: '#1a1a1a', borderColor: '#333' }}
              headStyle={{ borderBottomColor: '#333', color: '#e8e3d8', fontSize: 13 }}
              bodyStyle={{ padding: 0, maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}
              title={<Space size={6}><OrderedListOutlined style={{ color: COPPER }} />轮次 {sessionId ? '' : '(先选会话)'}</Space>}
            >
              {loadingTurns ? (
                <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
              ) : !sessionId ? (
                <Empty style={{ padding: 20 }} description={<span style={{ color: '#807a6e', fontSize: 12 }}>请先选择会话</span>} />
              ) : turns.length === 0 ? (
                <Empty style={{ padding: 20 }} description={<span style={{ color: '#807a6e', fontSize: 12 }}>该会话暂无轮次</span>} />
              ) : (
                <List
                  dataSource={turns}
                  renderItem={t => {
                    const isNull = t.turnid === null || t.turnId === null
                    const tid = isNull ? null : (t.turnid ?? t.turnId)
                    const active = turnSelection && turnSelection.noTurn === isNull
                      && (isNull || turnSelection.turnId === tid)
                    const errCount = t.errorcount ?? t.errorCount ?? 0
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setTurnSelection({ turnId: tid, noTurn: isNull })}
                        onKeyDown={e => { if (e.key === 'Enter') setTurnSelection({ turnId: tid, noTurn: isNull }) }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #232323',
                          background: active ? COPPER_GLOW : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: MONO, fontSize: 12.5, color: active ? COPPER : '#c9c3b8' }}>
                            {isNull ? '无轮次' : `Turn ${tid}`}
                          </span>
                          {errCount > 0 && (
                            <Tag color="red" style={{ fontSize: 10, marginInlineEnd: 0 }}>{errCount} 异常</Tag>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#5a554d', marginTop: 2 }}>
                          {t.entrycount ?? t.entryCount} 条 · {fmtTime(t.startedat ?? t.startedAt)}
                          {(t.agents) ? ` · ${t.agents}` : ''}
                        </div>
                      </div>
                    )
                  }}
                />
              )}
            </Card>
          </Col>

          {/* 条目列表 */}
          <Col xs={24} md={9} lg={10}>
            <Card
              size="small"
              style={{ background: '#1a1a1a', borderColor: '#333' }}
              headStyle={{ borderBottomColor: '#333', color: '#e8e3d8', fontSize: 13 }}
              bodyStyle={{ padding: 0, maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}
              title={<Space size={6}><FileSearchOutlined style={{ color: COPPER }} />阶段调用 {turnSelection ? '' : '(先选轮次)'}</Space>}
            >
              {loadingEntries ? (
                <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
              ) : !turnSelection ? (
                <Empty style={{ padding: 20 }} description={<span style={{ color: '#807a6e', fontSize: 12 }}>请先选择轮次</span>} />
              ) : entries.length === 0 ? (
                <Empty style={{ padding: 20 }} description={<span style={{ color: '#807a6e', fontSize: 12 }}>该轮次暂无 LLM 调用</span>} />
              ) : (
                <List
                  dataSource={entries}
                  renderItem={e => (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail(e.id)}
                      onKeyDown={ev => { if (ev.key === 'Enter') openDetail(e.id) }}
                      style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #232323' }}
                      onMouseEnter={ev => { ev.currentTarget.style.background = '#20201d' }}
                      onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: MONO, fontSize: 12.5, color: COPPER }}>{e.agentname || e.agentName}</span>
                        <Tag style={{ fontSize: 10, marginInlineEnd: 0, borderColor: '#2a2620', color: '#807a6e', background: '#0d0d0d' }}>
                          {e.stage}
                        </Tag>
                        <Tag color={statusColor(e.status)} style={{ fontSize: 10, marginInlineEnd: 0 }}>{e.status}</Tag>
                        {e.latencyms !== undefined && e.latencyms !== null && (
                          <span style={{ fontSize: 11, color: '#5a554d' }}>
                            <ClockCircleOutlined /> {e.latencyms ?? e.latencyMs}ms
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#5a554d', marginTop: 3 }}>
                        {e.promptchars ?? e.promptChars ?? '—'} → {e.responsechars ?? e.responseChars ?? '—'} chars
                        {e.prompttruncated || e.promptTruncated ? ' · prompt 截断' : ''}
                        {(e.responsetruncated || e.responseTruncated) ? ' · response 截断' : ''}
                        {' · '}{fmtTime(e.createdat ?? e.createdAt)}
                      </div>
                    </div>
                  )}
                />
              )}
            </Card>
          </Col>
        </Row>
      </div>

      {/* 详情抽屉 */}
      <Drawer
        title={<Space><FileSearchOutlined style={{ color: COPPER }} />LLM 调用详情</Space>}
        placement="right"
        width={900}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { background: '#141414' }, header: { background: '#1a1a1a', borderBottom: '1px solid #333' } }}
      >
        {loadingDetail ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="加载中..." /></div>
        ) : !detail ? (
          <Empty description={<span style={{ color: '#807a6e' }}>无数据</span>} />
        ) : (
          <>
            <Descriptions
              size="small"
              column={2}
              bordered
              labelStyle={{ color: '#807a6e', background: '#1a1a1a', fontSize: 12 }}
              contentStyle={{ color: '#c9c3b8', background: '#141414', fontSize: 12, fontFamily: MONO, wordBreak: 'break-all' }}
            >
              <Descriptions.Item label="状态">
                <Tag color={statusColor(detail.status)}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="阶段 (agent)">{detail.agentName}</Descriptions.Item>
              <Descriptions.Item label="会话">{detail.sessionId}</Descriptions.Item>
              <Descriptions.Item label="轮次">{detail.turnId ?? '无轮次'}</Descriptions.Item>
              <Descriptions.Item label="路径">{detail.stage}</Descriptions.Item>
              <Descriptions.Item label="模型">{detail.model || '—'}</Descriptions.Item>
              <Descriptions.Item label="耗时">{detail.latencyMs} ms</Descriptions.Item>
              <Descriptions.Item label="时间">{fmtTime(detail.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="temperature">{detail.temperature ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="max_tokens">{detail.maxTokens ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="top_p">{detail.topP ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="traceId">{detail.traceId || '—'}</Descriptions.Item>
              <Descriptions.Item label="端点" span={2}>{detail.endpointUrl || '—'}</Descriptions.Item>
              {detail.errorMessage && (
                <Descriptions.Item label="错误" span={2}>
                  <span style={{ color: '#e07a6b' }}>{detail.errorMessage}</span>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Tabs
              style={{ marginTop: 16 }}
              items={[
                {
                  key: 'prompt',
                  label: (
                    <Space size={4}>
                      Prompt
                      <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{detail.promptChars ?? 0} chars</Tag>
                      {detail.promptTruncated && <Tag color="orange" style={{ fontSize: 10, marginInlineEnd: 0 }}>已截断</Tag>}
                    </Space>
                  ),
                  children: <MonoBlock text={detail.prompt} />,
                },
                {
                  key: 'response',
                  label: (
                    <Space size={4}>
                      Response
                      <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{detail.responseChars ?? 0} chars</Tag>
                      {detail.responseTruncated && <Tag color="orange" style={{ fontSize: 10, marginInlineEnd: 0 }}>已截断</Tag>}
                    </Space>
                  ),
                  children: <MonoBlock text={detail.response} />,
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </Content>
  )
}