import { useState } from 'react'
import { Steps, Tag, Collapse, Typography, Badge, Button, Input, Select, Space, message, theme, Tooltip } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, ClockCircleOutlined, UnorderedListOutlined,
  EditOutlined, SaveOutlined, CalendarOutlined, ToolOutlined, WarningOutlined
} from '@ant-design/icons'
import { motion, AnimatePresence } from 'framer-motion'
import ScheduleModal from './ScheduleModal'
import DocumentPreviewModal from './DocumentPreviewModal'
import InsightPanel from './InsightPanel'
import { useUIStore } from './store/useUIStore'
import type { PlanProps, AgentStep, Document } from './types/plan'

const { Text, Paragraph } = Typography
const { TextArea } = Input

const AGENT_COLORS = {
  LLMAgent: 'blue', CommandAgent: 'orange', CodeAgent: 'green',
  FileAgent: 'cyan', BrowserAgent: 'purple', SummaryAgent: 'magenta',
  SelfAgent: 'geekblue', SkillsAgent: 'gold', PlannerService: 'red',
  UIAgent: 'teal'
}

const AGENT_OPTIONS = Object.keys(AGENT_COLORS).map(a => ({ value: a, label: a }))

function statusIcon(status?: string) {
  switch (status) {
    case 'completed': 
      return (
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4, ease: "easeOut" }}>
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
        </motion.div>
      )
    case 'running':   
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <LoadingOutlined style={{ color: '#1677ff' }} spin />
        </motion.div>
      )
    case 'failed':    return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
    default:          return <ClockCircleOutlined style={{ color: '#555' }} />
  }
}

export default function PlanView({ plan, editable = false, onConfirm }: PlanProps) {
  const { token } = theme.useToken();
  const { currentDoc, setCurrentDoc, previewOpen, setPreviewOpen } = useUIStore()
  
  // Safe parsing logic depending on whether `plan` is a string or an object
  let parsedPlanSteps: AgentStep[] = [];
  let parsedUsedDocuments: Document[] = [];
  
  try {
    const rawObj = typeof plan === 'string' ? JSON.parse(plan || '{}') : (plan || {})
    // Handle both { steps: [] } and { plan: [] } formats which backend might send
    parsedPlanSteps = Array.isArray(rawObj.steps) ? rawObj.steps : (Array.isArray(rawObj.plan) ? rawObj.plan : [])
    parsedUsedDocuments = Array.isArray(rawObj.used_documents) ? rawObj.used_documents : []
  } catch (e) {
    console.error("Failed to parse plan JSON", e)
  }

  const [editedPlan, setEditedPlan] = useState<AgentStep[]>(parsedPlanSteps.length ? JSON.parse(JSON.stringify(parsedPlanSteps)) : [])
  const [editingStep, setEditingStep] = useState<number | null>(null)
  const [jsonError, setJsonError] = useState<{ stepIdx: number, message: string } | null>(null)
  
  // Modals state
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false)

  if (!parsedPlanSteps.length && !editedPlan.length) return null
  const steps = editable ? editedPlan : parsedPlanSteps
  const usedDocuments = parsedUsedDocuments

  const openPreview = (doc: Document) => {
    setCurrentDoc(doc)
    setPreviewOpen(true)
  }

  const handleSaveStep = (stepIdx: number, updatedStep: AgentStep) => {
    const newPlan = [...editedPlan]
    newPlan[stepIdx] = updatedStep
    setEditedPlan(newPlan)
    setEditingStep(null)
  }

  const items = steps.map((step: AgentStep, idx: number) => {
    const isEditing = editingStep === idx
    const agent = step.agent || 'UNKNOWN'
    const agentColor = AGENT_COLORS[agent as keyof typeof AGENT_COLORS] || 'default'
    const hasDetail = step.args || step.result || step.step_context || step.output_file

    const description = isEditing ? (
      <div style={{ marginTop: 8, background: token.colorFillAlter, padding: 12, borderRadius: 8 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>Agent</Text>
            <Select 
              value={step.agent} 
              options={AGENT_OPTIONS} 
              style={{ width: '100%', marginTop: 4 }} 
              onChange={val => handleSaveStep(idx, { ...step, agent: val })}
            />
          </div>
          <div>
            <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>Skill</Text>
            <Input 
              value={step.skill || ''} 
              placeholder="Skill name (optional)"
              style={{ marginTop: 4 }}
              onChange={e => handleSaveStep(idx, { ...step, skill: e.target.value })}
            />
          </div>
          <div>
            <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>Goal</Text>
            <TextArea 
              value={step.goal || step.description || ''} 
              autoSize={{ minRows: 2, maxRows: 6 }}
              style={{ marginTop: 4 }}
              onChange={e => handleSaveStep(idx, { ...step, goal: e.target.value })}
            />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>Args (JSON)</Text>
              {jsonError && jsonError.stepIdx === idx && (
                <Tooltip title="Try to auto-fix formatting">
                  <Button type="link" size="small" icon={<ToolOutlined />} style={{ fontSize: 11, padding: 0 }} onClick={() => {
                     try {
                        // Very naive fix attempt: parse and re-stringify
                        // Or at least replace single quotes with double quotes
                        let str = typeof step.args === 'string' ? step.args : JSON.stringify(step.args);
                        str = str.replace(/'/g, '"').replace(/(\w+)\s*:/g, '"$1":');
                        const fixed = JSON.parse(str);
                        handleSaveStep(idx, { ...step, args: fixed });
                        setJsonError(null);
                        message.success("Format auto-fixed");
                     } catch(e) {
                        message.error("Cannot auto-fix, please check manually.");
                     }
                  }}>Fix Format</Button>
                </Tooltip>
              )}
            </div>
            <TextArea 
              value={typeof step.args === 'object' ? JSON.stringify(step.args, null, 2) : step.args || ''} 
              autoSize={{ minRows: 2, maxRows: 10 }}
              style={{ marginTop: 4, fontFamily: 'monospace', borderColor: jsonError && jsonError.stepIdx === idx ? token.colorError : undefined }}
              onChange={e => {
                let newArgs: string | Record<string, any> = e.target.value
                try { 
                  newArgs = JSON.parse(newArgs as string) 
                  handleSaveStep(idx, { ...step, args: newArgs })
                  setJsonError(null)
                } catch (err: any) {
                  // Keep it as string if invalid
                  handleSaveStep(idx, { ...step, args: newArgs })
                  setJsonError({ stepIdx: idx, message: err.message })
                }
              }}
            />
            {jsonError && jsonError.stepIdx === idx && (
              <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} style={{ color: token.colorError, fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <WarningOutlined />
                {jsonError.message}
              </motion.div>
            )}
          </div>
          <div>
            <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>Step Context</Text>
            <TextArea 
              value={step.step_context || ''} 
              autoSize={{ minRows: 2, maxRows: 4 }}
              style={{ marginTop: 4 }}
              onChange={e => handleSaveStep(idx, { ...step, step_context: e.target.value })}
            />
          </div>
          <div>
            <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>Output File</Text>
            <Input 
              value={step.output_file || ''} 
              style={{ marginTop: 4 }}
              onChange={e => handleSaveStep(idx, { ...step, output_file: e.target.value })}
            />
          </div>
          <Button type="primary" size="small" icon={<SaveOutlined />} onClick={() => setEditingStep(null)}>
            Done Editing
          </Button>
        </Space>
      </div>
    ) : (
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag color={agentColor} style={{ fontSize: 11, margin: 0 }}>{agent.toUpperCase()}</Tag>
          {step.skill && <Tag color="volcano" style={{ fontSize: 11, margin: 0 }}>{step.skill}</Tag>}
          {editable && (
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { setEditingStep(idx); setJsonError(null); }} style={{ color: token.colorTextSecondary }} />
          )}
        </div>
        <AnimatePresence>
          {step.status === 'running' && step.thought && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ marginTop: 8, padding: 8, background: token.colorFillTertiary, borderRadius: 6, overflow: 'hidden' }}
            >
              <Text style={{ color: token.colorPrimary, fontSize: 11, display: 'block', marginBottom: 4 }}>
                <LoadingOutlined style={{ marginRight: 4 }} />
                Thinking...
              </Text>
              <pre style={{ 
                margin: 0, 
                fontSize: 12, 
                color: token.colorTextSecondary,
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-all',
                maxHeight: 200,
                overflowY: 'auto'
              }}>
                {step.thought}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>
        {hasDetail && (
          <Collapse ghost size="small" style={{ marginTop: 6 }}
            items={[{
              key: '1',
              label: <Text style={{ color: token.colorTextSecondary, fontSize: 12 }}>Details</Text>,
              children: (
                <div style={{ fontSize: 12 }}>
                  {step.args && (
                    <div style={{ marginBottom: 8 }}>
                      <Text style={{ color: token.colorTextSecondary, fontSize: 11 }}>ARGS</Text>
                      <pre style={{
                        background: token.colorBgContainerDisabled, color: token.colorWarning, padding: '8px 10px',
                        borderRadius: 6, fontSize: 11, margin: '4px 0 0', overflow: 'auto', maxHeight: 120
                      }}>
                        {typeof step.args === 'object' ? JSON.stringify(step.args, null, 2) : step.args}
                      </pre>
                    </div>
                  )}
                  {step.step_context && (
                    <div style={{ marginBottom: 8 }}>
                      <Text style={{ color: token.colorTextSecondary, fontSize: 11 }}>CONTEXT</Text>
                      <pre style={{
                        background: token.colorBgContainerDisabled, color: token.colorPrimary, padding: '8px 10px',
                        borderRadius: 6, fontSize: 11, margin: '4px 0 0', overflow: 'auto', maxHeight: 120,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                      }}>
                        {step.step_context}
                      </pre>
                    </div>
                  )}
                  {step.output_file && (
                    <div style={{ marginBottom: 8 }}>
                      <Text style={{ color: token.colorTextSecondary, fontSize: 11 }}>OUTPUT FILE</Text>
                      <pre style={{
                        background: token.colorBgContainerDisabled, color: token.colorSuccess, padding: '8px 10px',
                        borderRadius: 6, fontSize: 11, margin: '4px 0 0', overflow: 'auto', maxHeight: 60,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                      }}>
                        {step.output_file}
                      </pre>
                    </div>
                  )}
                  {step.result && (
                    <div>
                      <Text style={{ color: token.colorTextSecondary, fontSize: 11 }}>RESULT</Text>
                      <pre style={{
                        background: token.colorBgContainerDisabled,
                        color: step.status === 'failed' ? token.colorError : token.colorSuccess,
                        padding: '8px 10px', borderRadius: 6, fontSize: 11,
                        margin: '4px 0 0', overflow: 'auto', maxHeight: 160,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                      }}>
                        {step.result}
                      </pre>
                      {step.status === 'completed' && (
                        <InsightPanel resultStr={step.result} />
                      )}
                    </div>
                  )}
                </div>
              )
            }]}
          />
        )}
      </div>
    )

    return {
      key: step.step || idx,
      title: (
        <Text style={{ color: token.colorText, fontSize: 13 }}>
          {step.description || step.goal}
        </Text>
      ),
      description,
      icon: statusIcon(step.status),
      status: step.status === 'running' ? 'process'
            : step.status === 'completed' ? 'finish'
            : step.status === 'failed' ? 'error'
            : 'wait',
    }
  })

  const completedCount = steps.filter(s => s.status === 'completed').length
  const runningStep = steps.find(s => s.status === 'running')
  const allCompleted = steps.length > 0 && completedCount === steps.length

  return (
    <div style={{
      background: token.colorBgContainer, border: `1px solid ${token.colorBorder}`,
      borderRadius: 12, padding: '16px 20px', maxWidth: '90%', marginTop: 8
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UnorderedListOutlined style={{ color: token.colorPrimary }} />
          <Text style={{ color: token.colorTextSecondary, fontSize: 12, fontFamily: 'monospace', fontWeight: 600, letterSpacing: 1 }}>
            EXECUTION PLAN
          </Text>
          <Badge
            count={`${completedCount}/${steps.length}`}
            style={{ backgroundColor: completedCount === steps.length ? token.colorSuccess : token.colorPrimary, fontSize: 11 }}
          />
          {runningStep && (
            <Tag color="processing" style={{ fontSize: 11 }}>
              Running: Step {runningStep.step}
            </Tag>
          )}
        </div>
        <Space>
          {allCompleted && !editable && (
            <Button 
              type="dashed" 
              size="small" 
              icon={<CalendarOutlined />} 
              onClick={() => setScheduleModalVisible(true)}
            >
              Add to Schedule
            </Button>
          )}
          {editable && (
            <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => onConfirm(editedPlan)}>
              Confirm & Execute
            </Button>
          )}
        </Space>
      </div>
      {usedDocuments.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text style={{ color: token.colorTextSecondary, fontSize: 12, display: 'block', marginBottom: 6 }}>
            USED DOCUMENTS
          </Text>
          <Space size={[8, 8]} wrap>
            {usedDocuments.map((d: Document) => (
              <Tag key={d.id} style={{ margin: 0 }}>
                <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => openPreview(d)}>
                  {d.filename || d.id}
                </Button>
              </Tag>
            ))}
          </Space>
        </div>
      )}
      <Steps
        direction="vertical"
        size="small"
        items={items}
        style={{
          '--steps-icon-size': '20px',
          marginTop: 12,
          '--ant-color-text-description': token.colorTextSecondary
        } as React.CSSProperties}
      />

      <DocumentPreviewModal 
        doc={currentDoc} 
        open={previewOpen} 
        onCancel={() => setPreviewOpen(false)} 
      />

      <ScheduleModal 
        visible={scheduleModalVisible} 
        onCancel={() => setScheduleModalVisible(false)}
        plan={plan}
        steps={steps}
        onConfirm={onConfirm}
      />
    </div>
  )
}
