import React from 'react'
import { Timeline, Tag, Typography, Space, Empty, Tooltip, Card, Spin } from 'antd'
import {
  CheckCircleFilled, CloseCircleFilled, LoadingOutlined,
  RollbackOutlined, MinusCircleOutlined, ClockCircleOutlined
} from '@ant-design/icons'

const { Text } = Typography

/**
 * Visualise the fix-task state-machine trajectory as a vertical
 * timeline. Driven by the per-phase transitions streamed by the
 * backend's `fix-task.phase` events, plus a single-entry seed
 * from `fix-task.snapshot` so a tab that connects mid-flight at
 * least sees the current phase.
 *
 * Why Timeline (not Steps):
 *   - Steps is a linear "you are here" pointer; Timeline is an
 *     ordered log. REPLAN events make the trajectory non-linear
 *     (the LLM can hop back to ANALYZING from LOCATING /
 *     GENERATING_PATCH), and the user wants to see each step
 *     individually — not a single "current state" pill.
 *   - Timeline lets us colour REPLAN rollbacks differently
 *     (magenta dot + rollback icon) so the user can spot them at
 *     a glance.
 *
 * Props:
 *   phases — array of `{ phase, status, ts, note }` in chronological
 *     order (oldest first). `phase` is the upper-case phase name
 *     (ANALYZING, LOCATING, ...). `note` is the human-readable
 *     context the backend passed to setPhase; REPLAN notes start
 *     with "REPLAN (" which is how we detect rollbacks.
 *   compact — render in a tighter layout for inline use. Default
 *     false (used by the modal).
 *   loading — when true, show a spinner in place of the
 *     empty-state copy if there are no phases to render yet.
 *     The parent uses this to signal that the canonical
 *     timeline is being fetched from the backend (the GET
 *     triggered when the modal opens). Once either the
 *     fetch resolves or any live WS event lands, the spinner
 *     yields to the real timeline.
 *
 * The component is purely presentational — no WebSocket, no
 * fetching. The parent (IssuesSidePanel) accumulates the events
 * and just hands us the array. This keeps the component easy to
 * unit-test and reusable from other places (e.g. a future
 * post-completion detail view) by passing in a phases array
 * fetched from a different source.
 */

// Canonical fix-task phase order for the linear progress trail.
// REPLAN events roll back to ANALYZING, so the trail shows the
// 5 main phases while the timeline (FixTaskStateMachine) records
// every transition individually.
export const PHASE_ORDER = [
  'ANALYZING',
  'LOCATING',
  'GENERATING_PATCH',
  'EXECUTING',
  'VERIFYING'
]

// Phase → Timeline dot colour. Matches the Ant Design preset
// palette and reads well on the dark (#0d0d0d) panel background.
export const PHASE_COLOR = {
  ANALYZING:        'blue',
  LOCATING:         'cyan',
  GENERATING_PATCH: 'purple',
  EXECUTING:        'orange',
  VERIFYING:        'gold',
  COMPLETED:        'green',
  FAILED:           'red'
}

// Phase → short Chinese label. Keeps the timeline rows compact
// even with longer note strings.
export const PHASE_LABEL = {
  ANALYZING:        '分析根因',
  LOCATING:         '定位文件',
  GENERATING_PATCH: '生成补丁',
  EXECUTING:        '应用补丁',
  VERIFYING:        '校验',
  COMPLETED:        '已完成',
  FAILED:           '失败'
}

// Recognise a REPLAN rollback. The backend's FixPhaseDriver sets
// the note to "REPLAN (n/2): <reason>" when it processes a
// [FIX_REPLAN: <reason>] marker from the LLM, so this regex is
// the source of truth — we don't try to infer REPLAN from the
// phase value (which is just "ANALYZING" after the rollback,
// indistinguishable from the initial ANALYZING).
const REPLAN_RE = /^\s*REPLAN\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*:?\s*(.*)$/s

// Render the leading dot for a timeline row. We override the
// default solid circle for REPLAN events (rollback icon,
// magenta) and terminal events (filled check / cross) so they
// pop in the visual.
function phaseIcon(phase, isReplan) {
  if (isReplan) return <RollbackOutlined style={{ fontSize: 14 }} />
  if (phase === 'COMPLETED') return <CheckCircleFilled style={{ fontSize: 14 }} />
  if (phase === 'FAILED') return <CloseCircleFilled style={{ fontSize: 14 }} />
  return <ClockCircleOutlined style={{ fontSize: 14 }} />
}

// Format a millisecond timestamp as HH:MM:SS for the timeline
// gutter. Showing seconds (not just minutes) is important when
// the user looks at rapid-fire EXECUTING / VERIFYING transitions
// and wants to see the order.
function formatTime(ts) {
  if (!ts || typeof ts !== 'number') return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// Light relative-time label (e.g. "+1.2s", "+3.4s") measuring
// from the first event. Helps the user eyeball how long each
// phase took. Hidden for the very first event (no anchor yet).
function relativeLabel(ts, anchorTs) {
  if (!ts || !anchorTs || ts === anchorTs) return null
  const deltaMs = ts - anchorTs
  if (deltaMs < 1000) return `+${deltaMs}ms`
  return `+${(deltaMs / 1000).toFixed(1)}s`
}

export default function FixTaskStateMachine({ phases, compact = false, loading = false }) {
  // Show a spinner instead of the empty-state copy when the
  // parent is still fetching the canonical timeline from the
  // backend. This is the cold-open case (tab opened after the
  // fix task started; the live phaseLogs are also empty until
  // the first WS event lands). Once we have anything — live
  // or backend — we render it immediately so the user isn't
  // staring at a blank modal while the GET is in flight.
  if (loading && (!Array.isArray(phases) || phases.length === 0)) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin tip="正在加载状态机轨迹..." />
      </div>
    )
  }
  if (!Array.isArray(phases) || phases.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="尚无状态机事件（任务刚开始或快照尚未到达）"
      />
    )
  }

  // The first event is the temporal anchor for relative time
  // labels. We compute it once per render so the gutter is
  // stable.
  const anchorTs = phases[0].ts

  // Roll-up counts for the header so the user can see at a
  // glance how many rounds and how many REPLAN events
  // happened. Cheap to compute; no memoisation needed for
  // typical phase-list sizes (tens of entries).
  const replanCount = phases.reduce(
    (acc, p) => acc + (p.note && REPLAN_RE.test(p.note) ? 1 : 0), 0)
  const totalRounds = phases.length

  return (
    <div className="fix-state-machine">
      <Card
        size="small"
        style={{ marginBottom: 12, background: '#141414', borderColor: '#2a2a2a' }}
        bodyStyle={{ padding: 8 }}
      >
        <Space size="middle" wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>
            阶段数
          </Text>
          <Tag color="blue">{totalRounds}</Tag>
          {replanCount > 0 && (
            <>
              <Text type="secondary" style={{ fontSize: 12 }}>
                REPLAN 回退
              </Text>
              <Tag color="magenta" icon={<RollbackOutlined />}>
                {replanCount}
              </Tag>
            </>
          )}
          {phases[phases.length - 1].phase && (
            <>
              <Text type="secondary" style={{ fontSize: 12 }}>
                当前阶段
              </Text>
              <Tag color={PHASE_COLOR[phases[phases.length - 1].phase] || 'default'}>
                {phases[phases.length - 1].phase}
              </Tag>
            </>
          )}
        </Space>
      </Card>

      <Timeline
        mode={compact ? 'left' : 'left'}
        style={{ marginTop: 4, paddingLeft: 4 }}
      >
        {phases.map((p, i) => {
          const phase = (p.phase || 'UNKNOWN').toUpperCase()
          const isReplan = !!(p.note && REPLAN_RE.test(p.note))
          const replanMatch = isReplan ? p.note.match(REPLAN_RE) : null
          const color = isReplan
            ? 'magenta'
            : (PHASE_COLOR[phase] || 'gray')
          const label = PHASE_LABEL[phase] || phase
          const time = formatTime(p.ts)
          const rel = relativeLabel(p.ts, anchorTs)

          return (
            <Timeline.Item
              key={`${p.ts || 't'}-${i}`}
              color={color}
              dot={phaseIcon(phase, isReplan)}
            >
              <Space size={6} wrap style={{ width: '100%' }}>
                <Tag
                  color={color}
                  style={{ margin: 0, fontWeight: 500 }}
                >
                  {label}
                </Tag>
                {time && (
                  <Text code style={{ fontSize: 11, color: '#888' }}>
                    {time}
                  </Text>
                )}
                {rel && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {rel}
                  </Text>
                )}
                {p.status && p.status !== 'RUNNING' && (
                  <Tag
                    color={p.status === 'COMPLETED' ? 'success'
                      : p.status === 'FAILED' ? 'error' : 'default'}
                    style={{ margin: 0, fontSize: 10 }}
                  >
                    {p.status}
                  </Tag>
                )}
                {p.status === 'RUNNING' && (
                  <Tag
                    color="processing"
                    icon={<LoadingOutlined spin />}
                    style={{ margin: 0, fontSize: 10 }}
                  >
                    进行中
                  </Tag>
                )}
              </Space>

              {isReplan && replanMatch && (
                <Tooltip title="LLM 通过 [FIX_REPLAN: ...] 主动回退到 ANALYZING，通常是因为 CROSS-ROUND DIFF 暴露了与早期分析结论的矛盾。">
                  <div
                    style={{
                      marginTop: 4,
                      padding: '6px 10px',
                      background: 'rgba(245, 34, 45, 0.08)',
                      border: '1px solid rgba(245, 34, 45, 0.3)',
                      borderRadius: 4,
                      fontSize: 12,
                      color: '#ffccc7',
                    }}
                  >
                    <Space size={4} wrap>
                      <Text strong style={{ color: '#ff7875', fontSize: 12 }}>
                        REPLAN #{replanMatch[1]}/{replanMatch[2]}
                      </Text>
                      {replanMatch[3] && (
                        <Text style={{ color: '#ffccc7', fontSize: 12 }}>
                          — {replanMatch[3].trim()}
                        </Text>
                      )}
                    </Space>
                  </div>
                </Tooltip>
              )}

              {!isReplan && p.note && (
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 11,
                    color: '#888',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {p.note}
                </div>
              )}
            </Timeline.Item>
          )
        })}
      </Timeline>
    </div>
  )
}
