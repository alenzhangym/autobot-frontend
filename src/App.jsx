import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Layout, Menu, Button, Input, Avatar, Typography, Space, Tooltip,
  Modal, Form, Tabs, Tag, Dropdown, Divider, ConfigProvider, theme, Badge, Select, InputNumber, TimePicker, message, Checkbox,
  List, Spin
} from 'antd'
import dayjs from 'dayjs'
import {
  SendOutlined, PlusOutlined, SettingOutlined, DeleteOutlined,
  MessageOutlined, LogoutOutlined,
  CheckCircleOutlined, SyncOutlined, PlayCircleOutlined,
  CodeOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RobotOutlined,
  StopOutlined, LoadingOutlined, ThunderboltOutlined, UserOutlined, TeamOutlined,
  DownOutlined, RightOutlined, CheckOutlined, EditOutlined, ClockCircleOutlined,
  FileTextOutlined, PaperClipOutlined, AudioOutlined, CloseOutlined, FileImageOutlined, DownloadOutlined, DatabaseOutlined, GlobalOutlined,
  FolderOpenOutlined, HomeOutlined
} from '@ant-design/icons'
import api, { logout, isAuthenticated, getCurrentUser, fetchMe, getWsBaseUrl, getLocalAgentBaseUrl, getBackendHost } from './auth'
import Login from './Login'
import LogPanel from './LogPanel'
import PlanView from './PlanView'
import MonitorPanel from './components/MonitorPanel'
import Documents from './Documents'
import DatabaseManagement from './DatabaseManagement'
import ErpManagement from './ErpManagement'
import OutboundOrderManagement from './OutboundOrderManagement'
import InboundOrderManagement from './InboundOrderManagement'
import StockDashboard from './StockDashboard'
import PartManagement from './PartManagement'
import CustomerPartMappingManagement from './CustomerPartMappingManagement'
import ImportProductRelation from './ImportProductRelation'
import CustomerManagement from './CustomerManagement'
import SupplierManagement from './SupplierManagement'
import SalesOrderManagement from './SalesOrderManagement'
import PurchaseOrderManagement from './PurchaseOrderManagement'
import ReconciliationManagement from './ReconciliationManagement'
import CompanyManagement from './CompanyManagement'
import InventoryManagement from './InventoryManagement'
import AuditLogManagement from './AuditLogManagement'
import DocumentPreviewModal from './DocumentPreviewModal'
import SessionSidebar from './components/SessionSidebar'
import { executeAgentCommands, appendStreamToken, tryStreamDispatch, resetStreamBuffer } from './components/WorkspacePanel'
import MessageBubble from './components/MessageBubble'
import { useAppStore } from './store/useAppStore'
import { useTranslation } from 'react-i18next'
import { probeToolchain, getClientInfo, clearToolchainCache } from './utils/probeTools'
import zhCN from 'antd/es/locale/zh_CN'
import enUS from 'antd/es/locale/en_US'
import { Virtuoso } from 'react-virtuoso'
import { extractTrailingStateJson, stripTrailingStateJson, stripAgentMarkers, tryParseAnalysisResult } from './utils/helpers.jsx'
import { createHealthPoller, probeHttp } from './utils/healthPoller.js'

// ── Web Worker for async profileData ─────────────────────────────────────────
const profileDataWorker = new Worker(new URL('./workers/profileData.worker.js', import.meta.url), { type: 'module' });
let _profileRequestId = 0;
const _profilePending = new Map();
profileDataWorker.onmessage = (e) => {
  const { id, result } = e.data;
  const resolve = _profilePending.get(id);
  if (resolve) {
    resolve(result || { columns: [], summary: {} });
    _profilePending.delete(id);
  }
};
const profileDataAsync = (rows) => new Promise((resolve) => {
  const id = ++_profileRequestId;
  _profilePending.set(id, resolve);
  profileDataWorker.postMessage({ id, rows });
});

const { Sider, Header, Content } = Layout
const { Text, Title } = Typography
const { TextArea } = Input

function extractTrailingAnalysisStateJson(content) {
  // Delegate to the shared depth-tracking utility in helpers.jsx.
  // Avoids the previous `lastIndexOf('{"__state"')` heuristic which
  // could match the wrong occurrence on nested content.
  return extractTrailingStateJson(content) || ''
}

function parseAnalysisState(content) {
  const stateJson = extractTrailingAnalysisStateJson(content)
  if (!stateJson) return null
  try {
    const parsed = JSON.parse(stateJson)
    return parsed && parsed.__state ? parsed : null
  } catch (e) {
    return null
  }
}

function decodeStateStringList(encoded) {
  if (!encoded || typeof encoded !== 'string') return []
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
    const decoded = atob(padded)
    const bytes = Uint8Array.from(decoded, ch => ch.charCodeAt(0))
    const text = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(text)
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item === 'string' && item.trim())
      : []
  } catch (e) {
    return []
  }
}

function encodeStateStringList(values) {
  try {
    const json = JSON.stringify(Array.from(new Set((values || []).filter(v => typeof v === 'string' && v.trim()))))
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    bytes.forEach(byte => {
      binary += String.fromCharCode(byte)
    })
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  } catch (e) {
    return ''
  }
}

function extractCommandSignature(content) {
  if (!content || typeof content !== 'string' || !content.includes('__CMD__')) return ''
  const signatures = []
  let searchStart = 0
  while (true) {
    const idx = content.indexOf('__CMD__', searchStart)
    if (idx < 0) break
    const jsonStart = idx + '__CMD__'.length
    if (jsonStart >= content.length || content[jsonStart] !== '{') {
      searchStart = jsonStart
      continue
    }
    let depth = 0
    let i = jsonStart
    let inString = false
    let escaping = false
    while (i < content.length) {
      const ch = content[i]
      if (escaping) {
        escaping = false
        i += 1
        continue
      }
      if (ch === '\\' && inString) {
        escaping = true
        i += 1
        continue
      }
      if (ch === '"') {
        inString = !inString
        i += 1
        continue
      }
      if (inString) {
        i += 1
        continue
      }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) break
      }
      i += 1
    }
    if (depth === 0) {
      signatures.push(content.substring(jsonStart, i + 1))
      searchStart = i + 1
    } else {
      searchStart = jsonStart + 1
    }
  }
  return signatures.join('\n')
}

function replaceTrailingAnalysisState(content, state) {
  if (!content || typeof content !== 'string' || !state) return content
  // Use the shared depth-tracking utility to strip the existing state
  // JSON (instead of the previous `lastIndexOf(stateJson)` heuristic
  // which could match the wrong occurrence).
  const stripped = stripTrailingStateJson(content).trimEnd()
  const serialized = JSON.stringify(state)
  return `${stripped}\n\n${serialized}`
}

function mergeAnalysisStateContent(previousContent, nextContent) {
  if (typeof previousContent !== 'string' || typeof nextContent !== 'string') return nextContent
  const previousState = parseAnalysisState(previousContent)
  const nextState = parseAnalysisState(nextContent)
  if (!previousState || !nextState) return nextContent

  const mergedCompletedFiles = [
    ...decodeStateStringList(previousState.__completed_read_files),
    ...decodeStateStringList(nextState.__completed_read_files)
  ]
  const mergedReadFiles = [
    ...decodeStateStringList(previousState.__read),
    ...decodeStateStringList(nextState.__read)
  ]
  const mergedFocusedFiles = [
    ...decodeStateStringList(previousState.__focused_files),
    ...decodeStateStringList(nextState.__focused_files)
  ]

  const mergedState = {
    ...nextState,
    __round: Math.max(Number(previousState.__round || 0), Number(nextState.__round || 0)),
    __max_rounds: Math.max(Number(previousState.__max_rounds || 0), Number(nextState.__max_rounds || 0)),
    __bytes: Math.max(Number(previousState.__bytes || 0), Number(nextState.__bytes || 0)),
    __read_count: Math.max(
      Number(previousState.__read_count || 0),
      Number(nextState.__read_count || 0),
      new Set(mergedCompletedFiles).size
    ),
    __retained_context_count: Math.max(
      Number(previousState.__retained_context_count || 0),
      Number(nextState.__retained_context_count || 0)
    ),
    __read: encodeStateStringList(mergedReadFiles),
    __completed_read_files: encodeStateStringList(mergedCompletedFiles),
    __focused_files: encodeStateStringList(mergedFocusedFiles)
  }

  return replaceTrailingAnalysisState(nextContent, mergedState)
}

// ── Users Management Modal ───────────────────────────────────────────────────
function UsersManagementModal({ open, onClose, users, companies, onAddUser, onDeleteUser, onApproveUser, onRejectUser, user }) {
  const { t } = useTranslation()
  const [userForm] = Form.useForm()
  const role = user?.role
  const isSuperAdmin = role === 'SUPER_ADMIN' || role?.toLowerCase() === 'admin' || role?.toLowerCase() === 'superadmin'
  const isCompanyAdmin = role === 'COMPANY_ADMIN' || role?.toLowerCase() === 'company_admin'
  
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState('all')

  const filteredUsers = useMemo(() => {
    if (selectedCompanyFilter === 'all') return users
    return users.filter(u => u.companyId === selectedCompanyFilter)
  }, [users, selectedCompanyFilter])

  return (
    <Modal
      title={t('users.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      styles={{ body: { background: '#1a1a1a', padding: '24px' }, header: { background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', padding: '16px 24px' } }}
    >
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: '#888', fontSize: 12 }}>Manage users in the system.</Text>
        {isSuperAdmin && (
          <Select 
            value={selectedCompanyFilter}
            onChange={setSelectedCompanyFilter}
            style={{ width: 200 }}
            options={[
              { value: 'all', label: 'All Companies' },
              ...(companies || []).map(c => ({ value: c.id, label: c.name }))
            ]}
          />
        )}
      </div>
      <div style={{ marginBottom: 20, maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
        {(!users || users.length === 0) ? (
          <Text style={{ color: '#555', fontSize: 13 }}>No users configured</Text>
        ) : (
          filteredUsers.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid #2a2a2a', borderRadius: 8, marginBottom: 8 }}>
              <div>
                <Text style={{ color: '#e3e3e3', fontWeight: 600, fontSize: 13 }}>{u.username}</Text>
                <Tag color={u.role === 'SUPER_ADMIN' ? 'red' : u.role === 'COMPANY_ADMIN' ? 'blue' : 'default'} style={{ marginLeft: 8 }}>{u.role}</Tag>
                {u.approvalStatus && (
                  <Tag color={u.approvalStatus === 'APPROVED' ? 'green' : u.approvalStatus === 'REJECTED' ? 'red' : 'orange'} style={{ marginLeft: 8 }}>
                    {u.approvalStatus}
                  </Tag>
                )}
                <br />
                        <Text style={{ color: '#666', fontSize: 11 }}>Company: {(companies || []).find(c => c.id === u.companyId)?.name || u.companyId || 'N/A'}</Text>
                        {u.requestedCompanyName && (
                          <><br /><Text style={{ color: '#faad14', fontSize: 11 }}>Requested Company: {u.requestedCompanyName}</Text></>
                        )}
                      </div>
              <Space>
                {u.approvalStatus === 'PENDING' && (isSuperAdmin || (isCompanyAdmin && user.companyId === u.companyId)) && (
                  <>
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => onApproveUser(u.id)}>Approve</Button>
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => onRejectUser(u.id)}>Reject</Button>
                  </>
                )}
                <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteUser(u.id)} />
              </Space>
            </div>
          ))
        )}
      </div>
      <Divider style={{ borderColor: '#2a2a2a' }} />
      <Text style={{ color: '#888', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
        Add New User
      </Text>

      {isSuperAdmin && (!companies || companies.length === 0) && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#2a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, marginBottom: 12 }}>
          <Text style={{ color: '#e88585', fontSize: 12 }}>
            暂无公司，请先在「公司管理」中创建公司后再添加用户。
          </Text>
        </div>
      )}

      <Form
        form={userForm}
        layout="vertical"
        onFinish={async (values) => {
          const { confirmPassword, ...payload } = values
          await onAddUser(payload)
          userForm.resetFields()
        }}
        style={{ marginTop: 12 }}
      >
        <div style={{ display: 'flex', gap: '12px' }}>
          <Form.Item name="username" rules={[{ required: true, message: 'Please input username' }]} style={{ flex: 1 }}>
            <Input placeholder="Username" style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Form.Item name="password" rules={[{ required: true, message: 'Please input password' }, { min: 6, message: 'Password must be at least 6 characters' }]} style={{ flex: 1 }}>
            <Input.Password placeholder="Password" style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            dependencies={['password']}
            style={{ flex: 1 }}
            rules={[
              { required: true, message: 'Please confirm password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('The two passwords that you enter do not match!'))
                },
              }),
            ]}
          >
            <Input.Password placeholder="Confirm Password" style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Form.Item name="role" rules={[{ required: true, message: 'Please select role' }]} initialValue="USER" style={{ flex: 1 }}>
            <Select options={[
              ...(isSuperAdmin ? [{ value: 'SUPER_ADMIN', label: 'Super Admin' }] : []),
              { value: 'COMPANY_ADMIN', label: 'Company Admin' },
              { value: 'USER', label: 'User' }
            ]} />
          </Form.Item>
          {isSuperAdmin && (
            <Form.Item name="companyId" rules={[{ required: true, message: 'Please select company' }]} style={{ flex: 1 }}>
              <Select placeholder={(!companies || companies.length === 0) ? '请先创建公司' : 'Select Company'} options={(companies || []).map(c => ({ value: c.id, label: c.name }))} disabled={!companies || companies.length === 0} />
            </Form.Item>
          )}
        </div>
        <Button type="primary" htmlType="submit" block disabled={isSuperAdmin && (!companies || companies.length === 0)}>Add User</Button>
      </Form>
    </Modal>
  )
}

// ── Settings Modal ─────────────────────────────────────────────────────────
const CHANNELS = [
  { key: 'general', label: '普通会话', desc: '通用AI助手' },
  { key: 'document_qa', label: '文档问答', desc: '基于知识库的文档检索问答' },
  { key: 'code', label: '代码任务', desc: '代码分析/生成/审查' },
  { key: 'document_generation', label: '文档生成', desc: '创建文档/报告' },
  { key: 'erp', label: 'ERP 进销存', desc: '库存/订单/客户管理' },
  { key: 'database_analysis', label: '数据库分析', desc: '查询公司数据库' },
]

function SettingsModal({ open, onClose, user, dbConfigs, onDeleteDbConfig, onAddDbConfig, onUpdateDbConfig, skills, onToggleSkill, companies, onAddCompany, onUpdateCompany, onDeleteCompany, users, onAddUser, onDeleteUser, onUpdateUser }) {
  const { t } = useTranslation()
  const role = user?.role
  const isSuperAdmin = role === 'SUPER_ADMIN' || role?.toLowerCase() === 'admin' || role?.toLowerCase() === 'superadmin'
  const isCompanyAdmin = role === 'COMPANY_ADMIN' || role?.toLowerCase() === 'company_admin'
  const canManageDb = isSuperAdmin || isCompanyAdmin

  const [form] = Form.useForm()
  const [dbForm] = Form.useForm()
  const [editDbForm] = Form.useForm()
  const [companyForm] = Form.useForm()
  const [userForm] = Form.useForm()
  const [profileForm] = Form.useForm()
  const [expanded, setExpanded] = useState('')
  const [editDb, setEditDb] = useState(null)
  const [editVisible, setEditVisible] = useState(false)
  const [skillSortBy, setSkillSortBy] = useState('name')
  const [skillSortOrder, setSkillSortOrder] = useState('asc')
  const [skillFilterText, setSkillFilterText] = useState('')
  const [skillSourceFilter, setSkillSourceFilter] = useState('all')
  const [editingCompanyId, setEditingCompanyId] = useState(null)
  const [editChannels, setEditChannels] = useState([])

  const handleAddDb = async (values) => {
    const success = await onAddDbConfig(values)
    if (success) {
      dbForm.resetFields()
    }
  }
  
  const openEdit = (db) => {
    setEditDb(db)
    editDbForm.setFieldsValue({
      name: db.name,
      type: db.type,
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.database,
      description: db.description
    })
    setEditVisible(true)
  }
  const saveEdit = async () => {
    if (!editDb) return
    try {
      const values = await editDbForm.validateFields()
      const success = await onUpdateDbConfig(editDb.id, values)
      if (success) {
        setEditVisible(false)
        setEditDb(null)
      }
    } catch (e) {
      // validation failed
    }
  }


    const tabItems = []

  tabItems.push({
    key: 'profile',
    label: t('settings.profile'),
    children: (
      <div>
        <Text style={{ color: '#888', fontSize: 12, marginBottom: 16, display: 'block' }}>
          Update your personal information and password.
        </Text>
        <Form form={profileForm} layout="vertical" initialValues={{ username: user?.username }} style={{ marginTop: 12 }} onFinish={async (values) => {
          const payload = { username: values.username };
          if (values.password) payload.password = values.password;
          await onUpdateUser(user.id, payload);
          profileForm.setFieldsValue({ password: '', confirmPassword: '' });
        }}>
          <Form.Item name="username" label={<span style={{ color: '#e3e3e3' }}>Username</span>}>
            <Input disabled placeholder="Username" style={{ background: '#111', borderColor: '#333', color: '#666' }} />
          </Form.Item>
          <Form.Item name="password" label={<span style={{ color: '#e3e3e3' }}>New Password</span>} rules={[{ min: 6, message: 'Password must be at least 6 characters' }]}>
            <Input.Password placeholder="Leave blank to keep current password" style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={<span style={{ color: '#e3e3e3' }}>Confirm New Password</span>}
            dependencies={['password']}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!getFieldValue('password') || getFieldValue('password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('The two passwords that you entered do not match!'))
                },
              }),
            ]}
          >
            <Input.Password placeholder="Confirm New Password" style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">Save Changes</Button>
        </Form>
      </div>
    )
  })

  if (isSuperAdmin) {
    tabItems.push({
      key: 'skills',
      label: t('settings.skills'),
      children: (
        <div>
          <Text style={{ color: '#888', fontSize: 12, marginBottom: 16, display: 'block' }}>
            Enable or disable external skills. Disabled skills will not be referenced by the planner or used by agents.
          </Text>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input.Search
              allowClear
              placeholder="Search by name/desc/path"
              onSearch={v => setSkillFilterText(v)}
              onChange={e => setSkillFilterText(e.target.value)}
              style={{ width: 220 }}
              value={skillFilterText}
              size="small"
            />
            <Select
              size="small"
              value={skillSourceFilter}
              style={{ width: 140 }}
              onChange={setSkillSourceFilter}
              options={[
                { value: 'all', label: 'All Sources' },
                { value: 'lock', label: 'Lock' },
                { value: 'local', label: 'Local' },
              ]}
            />
            <Select
              size="small"
              value={skillSortBy}
              style={{ width: 150 }}
              onChange={setSkillSortBy}
              options={[
                { value: 'name', label: 'Sort: Name' },
                { value: 'updatedAt', label: 'Sort: Updated' },
                { value: 'source', label: 'Sort: Source' },
              ]}
            />
            <Select
              size="small"
              value={skillSortOrder}
              style={{ width: 120 }}
              onChange={setSkillSortOrder}
              options={[
                { value: 'asc', label: 'Asc' },
                { value: 'desc', label: 'Desc' },
              ]}
            />
          </div>
          {(!skills || skills.length === 0) ? (
            <Text style={{ color: '#555', fontSize: 13 }}>No skills discovered.</Text>
          ) : (
            [...skills]
              .filter(s => {
                if (skillSourceFilter !== 'all' && (s.source || 'unknown') !== skillSourceFilter) return false
                const t = (skillFilterText || '').toLowerCase()
                if (!t) return true
                const blob = `${s.name || ''} ${s.description || ''} ${s.path || ''}`.toLowerCase()
                return blob.includes(t)
              })
              .sort((a, b) => {
                const order = skillSortOrder === 'asc' ? 1 : -1
                if (skillSortBy === 'name') {
                  return a.name.localeCompare(b.name) * order
                }
                if (skillSortBy === 'source') {
                  return (a.source || '').localeCompare(b.source || '') * order
                }
                const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
                const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
                return (ta - tb) * order
              })
              .map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: 10, background: '#1a1a1a', borderRadius: 8, border: '1px solid #2a2a2a' }}>
                <div style={{ maxWidth: '70%' }}>
                  <Text style={{ color: '#e3e3e3', fontSize: 13, fontWeight: 600 }}>{s.name}</Text>
                  <br />
                  <Text style={{ color: '#888', fontSize: 11 }}>{s.path}</Text>
                  <br />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Tag color={s.source === 'lock' ? 'blue' : 'gold'}>{s.source || 'unknown'}</Tag>
                    <Text style={{ color: '#777', fontSize: 11 }}>{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : ''}</Text>
                  </div>
                  <Text style={{ color: '#666', fontSize: 11 }}>{s.description}</Text>
                </div>
                <div>
                  <Space>
                    <Tag color={s.enabled ? 'green' : 'red'}>{s.enabled ? 'Enabled' : 'Disabled'}</Tag>
                    <Button size="small" type={s.enabled ? 'default' : 'primary'} onClick={() => onToggleSkill(s.name, !s.enabled)}>
                      {s.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </Space>
                </div>
              </div>
            ))
          )}
        </div>
      )
    })
  }

  if (isSuperAdmin) {
    tabItems.push({
      key: 'companies',
      label: t('settings.companies'),
      children: (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Text style={{ color: '#888', fontSize: 12 }}>Manage companies in the system.</Text>
          </div>
          <div style={{ marginBottom: 20 }}>
            {companies.length === 0 ? (
              <Text style={{ color: '#555', fontSize: 13 }}>No companies configured</Text>
            ) : (
              companies.map(c => (
                <div key={c.id} style={{ padding: '10px 14px', border: '1px solid #2a2a2a', borderRadius: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <Text style={{ color: '#e3e3e3', fontWeight: 600, fontSize: 13 }}>{c.name}</Text>
                      <br />
                      <Text style={{ color: '#666', fontSize: 11 }}>ID: {c.id}</Text>
                      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(c.channelAccess || []).map(ch => {
                          const def = CHANNELS.find(d => d.key === ch)
                          return <Tag key={ch} color="blue" style={{ fontSize: 10 }}>{def ? def.label : ch}</Tag>
                        })}
                        {(!c.channelAccess || c.channelAccess.length === 0) && (
                          <Tag color="green" style={{ fontSize: 10 }}>全部可用</Tag>
                        )}
                      </div>
                    </div>
                    <Space>
                      <Button size="small" type="text" icon={<EditOutlined />}
                        onClick={() => {
                          setEditingCompanyId(editingCompanyId === c.id ? null : c.id)
                          setEditChannels(c.channelAccess || [])
                        }}
                        style={{ color: '#1677ff' }} />
                      <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteCompany(c.id)} />
                    </Space>
                  </div>
                  {editingCompanyId === c.id && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #2a2a2a' }}>
                      <Text style={{ color: '#aaa', fontSize: 12, display: 'block', marginBottom: 6 }}>可用频道（不选则全部可用）</Text>
                      <Checkbox.Group value={editChannels} onChange={(values) => setEditChannels(values)}>
                        <Space direction="vertical" style={{ gap: 4 }}>
                          {CHANNELS.map(ch => (
                            <Checkbox key={ch.key} value={ch.key} style={{ color: '#ccc' }}>
                              <span style={{ color: '#ccc' }}>{ch.label}</span>
                              <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>{ch.desc}</span>
                            </Checkbox>
                          ))}
                        </Space>
                      </Checkbox.Group>
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <Button size="small" type="primary" icon={<CheckOutlined />}
                          onClick={async () => {
                            await onUpdateCompany(c.id, { name: c.name, channelAccess: editChannels })
                            setEditingCompanyId(null)
                          }}>保存</Button>
                        <Button size="small" onClick={() => setEditingCompanyId(null)}>取消</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <Divider style={{ borderColor: '#2a2a2a' }} />
          <Text style={{ color: '#888', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            Add New Company
          </Text>
          <Form form={companyForm} layout="vertical" onFinish={async (values) => { await onAddCompany(values); companyForm.resetFields(); }} style={{ marginTop: 12 }}>
            <Form.Item name="name" rules={[{ required: true, message: 'Please input company name' }]}>
              <Input placeholder="Company Name" style={{ background: '#111', borderColor: '#333', color: '#e3e3e3' }} />
            </Form.Item>
            <Form.Item name="channelAccess" label={<span style={{ color: '#aaa', fontSize: 12 }}>可用频道（不选则全部可用）</span>}>
              <Checkbox.Group>
                <Space direction="vertical" style={{ gap: 4 }}>
                  {CHANNELS.map(ch => (
                    <Checkbox key={ch.key} value={ch.key} style={{ color: '#ccc' }}>
                      <span style={{ color: '#ccc' }}>{ch.label}</span>
                      <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>{ch.desc}</span>
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            </Form.Item>
            <Button type="primary" htmlType="submit" block>Add Company</Button>
          </Form>
        </div>
      )
    })
  }



  if (canManageDb) {
    tabItems.push({
      key: 'databases',
      label: t('settings.databases'),
      children: (
        <div>
          <div style={{ marginBottom: 20 }}>
            <Text style={{ color: '#888', fontSize: 12, marginBottom: 16, display: 'block' }}>
              Saved database configurations for DBAgent.
            </Text>
          {!Array.isArray(dbConfigs) || dbConfigs.length === 0 ? (
            <Text style={{ color: '#555', fontSize: 13 }}>No database configurations saved.</Text>
          ) : (
            dbConfigs.map(db => (
              <div key={db.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: 10, background: '#1a1a1a', borderRadius: 8, border: '1px solid #2a2a2a' }}>
                <div style={{ maxWidth: '70%' }}>
                  <Text style={{ color: '#e3e3e3', fontSize: 13, fontWeight: 600 }}>{db.name}</Text>
                  <br />
                  <Text style={{ color: '#888', fontSize: 11 }}>{db.type} • {db.host}:{db.port} • {db.database}</Text>
                  {db.description && (
                    <>
                      <br />
                      <Text style={{ color: '#666', fontSize: 11 }}>Desc: {db.description}</Text>
                    </>
                  )}
                  <div style={{ marginTop: 8 }}>
                    {db.connectionStatus === 'success' ? (
                      <Tag color="success" style={{ margin: 0 }}>Connected</Tag>
                    ) : db.connectionStatus === 'error' ? (
                      <Tooltip title={db.connectionMessage}>
                        <Tag color="error" style={{ margin: 0, cursor: 'pointer' }}>Connection Failed</Tag>
                      </Tooltip>
                    ) : db.connectionStatus === 'testing' ? (
                      <Tag color="default" style={{ margin: 0 }} icon={<LoadingOutlined />}>Testing...</Tag>
                    ) : (
                      <Tag color="default" style={{ margin: 0 }}>Not Tested</Tag>
                    )}
                  </div>
                </div>
                <Space>
                  <Button size="small" onClick={() => openEdit(db)}>Edit</Button>
                  <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteDbConfig(db.id)} />
                </Space>
              </div>
            ))
          )}
        </div>
        <Divider style={{ borderColor: '#2a2a2a' }} />
        <Text style={{ color: '#888', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
          Add New Database
        </Text>
        <Form form={dbForm} layout="vertical" onFinish={handleAddDb} style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="name" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Name (e.g. Prod DB)" />
            </Form.Item>
            <Form.Item name="type" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Select placeholder="Type" options={[{ value: 'mysql', label: 'MySQL' }, { value: 'sqlserver', label: 'SQL Server' }, { value: 'postgres', label: 'PostgreSQL' }]} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="host" style={{ flex: 2, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Host (e.g. localhost)" />
            </Form.Item>
            <Form.Item name="port" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <InputNumber placeholder="Port" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Form.Item name="username" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Username" />
            </Form.Item>
            <Form.Item name="password" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
              <Input.Password placeholder="Password" />
            </Form.Item>
          </div>
          <Form.Item name="database" style={{ marginBottom: 12 }} rules={[{ required: true }]}>
            <Input placeholder="Database Name" />
          </Form.Item>
          <Form.Item name="description" style={{ marginBottom: 12 }}>
            <TextArea rows={3} placeholder="Description (Purpose/Read-only, main tables, business logic, etc.)" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block style={{ marginTop: 4 }}>Add Database</Button>
        </Form>
        <Modal title="Edit Database Config" open={editVisible} onOk={saveEdit} onCancel={() => setEditVisible(false)}
          styles={{ content: { background: '#161616', border: '1px solid #2a2a2a' }, header: { background: '#161616', borderBottom: '1px solid #2a2a2a' } }}>
          <Form form={editDbForm} layout="vertical" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <Form.Item name="name" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
                <Input placeholder="Name (e.g. Prod DB)" />
              </Form.Item>
              <Form.Item name="type" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
                <Select placeholder="Type" options={[{ value: 'mysql', label: 'MySQL' }, { value: 'sqlserver', label: 'SQL Server' }, { value: 'postgres', label: 'PostgreSQL' }]} />
              </Form.Item>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Form.Item name="host" style={{ flex: 2, marginBottom: 12 }} rules={[{ required: true }]}>
                <Input placeholder="Host (e.g. localhost)" />
              </Form.Item>
              <Form.Item name="port" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
                <InputNumber placeholder="Port" style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Form.Item name="username" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
                <Input placeholder="Username" />
              </Form.Item>
              <Form.Item name="password" style={{ flex: 1, marginBottom: 12 }} rules={[{ required: true }]}>
                <Input.Password placeholder="Password" />
              </Form.Item>
            </div>
            <Form.Item name="database" style={{ marginBottom: 12 }} rules={[{ required: true }]}>
              <Input placeholder="Database Name" />
            </Form.Item>
            <Form.Item name="description" style={{ marginBottom: 12 }}>
              <TextArea rows={3} placeholder="Description (Purpose/Read-only, main tables, business logic, etc.)" />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    )
  })
  }

  return (
    <Modal title={t('settings.title')} open={open} onCancel={onClose} footer={null} 
      width="100vw"
      style={{ top: 0, padding: 0, margin: 0, maxWidth: '100vw', height: '100vh' }}
      styles={{ 
        content: { background: '#161616', border: 'none', borderRadius: 0, height: '100vh', display: 'flex', flexDirection: 'column' }, 
        header: { background: '#161616', borderBottom: '1px solid #2a2a2a', padding: '16px 24px', margin: 0 }, 
        body: { flex: 1, overflow: 'auto', padding: '24px' },
        mask: { backdropFilter: 'blur(4px)' } 
      }}>
      <Tabs items={tabItems} />
    </Modal>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const { t, i18n } = useTranslation()
  const {
    user, setUser,
    siderCollapsed, setSiderCollapsed,
    showLogs, setShowLogs,
    showSettings, setShowSettings,
    showUsersManagement, setShowUsersManagement,
    showCompanyManagement, setShowCompanyManagement,
    dbConfigs, setDbConfigs,
    companies, setCompanies,
    users, setUsers,
    skills, setSkills,
    localAgentStatus, setLocalAgentStatus,
    companyChannels, setCompanyChannels
  } = useAppStore()

  const isSuperAdmin = user?.role === 'SUPER_ADMIN' || user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'superadmin'

  // ── Cross-platform workspace directory helpers ──
  const isWindows = () => {
    if (typeof window !== 'undefined') {
      return window.navigator.userAgent.includes('Windows')
    }
    return false
  }

  const getDefaultWorkspaceDir = () => {
    if (typeof window !== 'undefined') {
      if (isWindows()) {
        // Try to find the project in common Windows locations
        const homedir = window.os?.homedir?.() || 'C:\\Users\\' + (window.require ? window.require('os').homedir().split('\\').pop() : 'user')
        return homedir
      } else {
        return '/Users/' + (window.os?.homedir?.()?.split('/').pop() || 'user') + '/code/autobot'
      }
    }
    return '/Users/user/code/autobot'
  }

  const getInitialBrowsePath = () => {
    if (typeof window !== 'undefined') {
      if (isWindows()) {
        return ''
      }
      return '/'
    }
    return '/'
  }

  const [messages, setMessages] = useState([])
  const msgIdCounter = useRef(Date.now())
  const nextMsgId = () => { msgIdCounter.current += 1; return msgIdCounter.current }
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [workspaceDir, setWorkspaceDir] = useState('')
  const [showWsPicker, setShowWsPicker] = useState(false)
  const [wsPickerChannel, setWsPickerChannel] = useState(null)
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false)
  const [isParsingHistory, setIsParsingHistory] = useState(false)
  const [wsBrowsePath, setWsBrowsePath] = useState(getInitialBrowsePath())
  const [wsBrowseEntries, setWsBrowseEntries] = useState([])
  const [wsBrowseLoading, setWsBrowseLoading] = useState(false)
  const wsDriveEntries = isWindows()
    ? wsBrowseEntries.filter(entry => entry?.isDir && /^[A-Za-z]:$/.test(entry.name))
    : []
  const [wsInvalid, setWsInvalid] = useState(false) // True when workspace_dir is invalid/inaccessible
  const [sessions, setSessions] = useState([])
  const [scheduledTasks, setScheduledTasks] = useState([])
  const [localTerminalOutput, setLocalTerminalOutput] = useState('')
  const [liveLogActive, setLiveLogActive] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [editTaskData, setEditTaskData] = useState({})
  const [updateAvailable, setUpdateAvailable] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [activeTab, setActiveTab] = useState('chat')
  const [uploadedDocuments, setUploadedDocuments] = useState([])
  const [probeResult, setProbeResult] = useState(null)
  const [currentChannel, setCurrentChannel] = useState('general')

  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedImageBase64, setSelectedImageBase64] = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])


  const fileInputRef = useRef(null)
  const chatWsRef = useRef(null)
  const liveLogActiveRef = useRef(false)

  const sessionCacheRef = useRef(new Map())

  // Keep session cache in sync with live messages so tab switches don't lose content
  useEffect(() => {
    if (sessionId && messages.length > 0) {
      sessionCacheRef.current.set(sessionId, messages)
      if (sessionCacheRef.current.size > 20) {
        const firstKey = sessionCacheRef.current.keys().next().value
        sessionCacheRef.current.delete(firstKey)
      }
    }
  }, [messages, sessionId])

  useEffect(() => {
    const bootstrap = async () => {
      const tokenExists = isAuthenticated()
      const cachedUser = getCurrentUser()
      if (tokenExists && cachedUser) {
        setUser(cachedUser)
        initSessions()
        checkFrontendUpdate()
        // background verify
        const me = await fetchMe()
        if (!me) { 
          logout() 
        } else {
          setUser({ id: me.id, username: me.username, role: me.role, companyId: me.companyId })
        }
      } else if (tokenExists) {
        const me = await fetchMe()
        if (me) {
          setUser({ id: me.id, username: me.username, role: me.role, companyId: me.companyId })
          initSessions()
          checkFrontendUpdate()
        } else {
          logout()
        }
      }
    }
    bootstrap()
  }, [])

  // Probe toolchain once on mount (non-blocking, fire-and-forget, 1h cache)
  useEffect(() => {
    probeToolchain().then(data => {
      if (data) setProbeResult(data);
    });
  }, []);

  const checkFrontendUpdate = async () => {
    try {
      const res = await api.get('/frontend/update/version')
      if (res.data && res.data.version) {
        const remoteVersion = res.data.version
        const localVersion = import.meta.env.VITE_APP_VERSION || '1.0.0'
        
        if (remoteVersion !== '0.0.0' && remoteVersion !== localVersion) {
          // Compare versions (simple string comparison for semantic versioning assuming standard formats)
          const remoteParts = remoteVersion.split('.').map(Number)
          const localParts = localVersion.split('.').map(Number)
          
          let isNewer = false
          for (let i = 0; i < Math.max(remoteParts.length, localParts.length); i++) {
            const r = remoteParts[i] || 0
            const l = localParts[i] || 0
            if (r > l) {
              isNewer = true
              break
            } else if (r < l) {
              break
            }
          }
          
          if (isNewer) {
            setUpdateAvailable(res.data)
          }
        }
      }
    } catch (e) {
      console.log('Failed to check frontend update', e)
    }
  }

  const checkLocalAgentStatus = () => {
    // Use the robust health poller: AbortController-based timeout,
    // exponential backoff on failure, and automatic in-flight
    // cancellation when the user logs out. The legacy implementation
    // used a naked setInterval that would leak sockets on hung
    // backends and never backed off on sustained failures.
    //
    // Synchronous factory: the useEffect cleanup needs the poller
    // object directly, not a Promise. The probe itself is async but
    // is invoked inside the poller, not here.
    const poller = createHealthPoller({
      probe: () => probeHttp(`${getLocalAgentBaseUrl()}/api/local/status`, 5000),
      onStateChange: (state) => {
        setLocalAgentStatus(state === 'ok' ? 'ok' : 'missing')
      },
      intervalMs: 30000,
      maxBackoffMs: 300000,
      requestTimeoutMs: 5000,
    })
    poller.start()
    return poller
  }

  useEffect(() => {
    if (!user) return
    const poller = checkLocalAgentStatus()
    return () => poller.stop()
  }, [user])

  useEffect(() => {
    const openDataStoreDb = () => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('autobot_data_store', 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('store')) db.createObjectStore('store')
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }

    const idbGet = async (key) => {
      try {
        const db = await openDataStoreDb()
        return await new Promise((resolve) => {
          const tx = db.transaction('store', 'readonly')
          const store = tx.objectStore('store')
          const r = store.get(key)
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => resolve(undefined)
        })
      } catch (e) {
        return undefined
      }
    }

    const idbSet = async (key, value) => {
      try {
        const db = await openDataStoreDb()
        await new Promise((resolve) => {
          const tx = db.transaction('store', 'readwrite')
          const store = tx.objectStore('store')
          const r = store.put(value, key)
          r.onsuccess = () => resolve(true)
          r.onerror = () => resolve(false)
        })
      } catch (e) {
      }
    }

    const handleIframeMessage = async (event) => {
      if (event.data && event.data.type === 'iframe_ready' && event.data.stored_id) {
        const requestedId = event.data.stored_id;
        let storedData = await idbGet(requestedId);
        
        if (storedData === undefined) {
          try {
            const res = await api.get('/data-store/' + requestedId);
            if (res.data) {
              storedData = res.data;
              await idbSet(requestedId, storedData);
            }
          } catch (e) {
            storedData = await idbGet(requestedId)
            if (storedData !== undefined) {
              // already in IDB
            } else {
              const latestId = window.__latestDbStoredId
              const latestData = latestId ? await idbGet(latestId) : undefined
              if (latestData !== undefined) {
                storedData = latestData
                await idbSet(requestedId, latestData)
                try {
                  await api.post('/data-store/save', { stored_id: requestedId, data: latestData })
                } catch (saveErr) {
                  console.error('Failed to backfill data store alias to backend:', saveErr)
                }
              } else {
                console.error('Failed to fetch data store from backend:', e);
              }
            }
          }
        }

        if (storedData) {
          event.source.postMessage({ type: 'render_data', data: storedData }, '*');
        } else {
          console.warn('No data found for stored_id:', requestedId);
        }
      }
    };
    window.addEventListener('message', handleIframeMessage);
    return () => window.removeEventListener('message', handleIframeMessage);
  }, []);

  const handleUpdateFrontend = async () => {
    if (!updateAvailable) return
    setUpdating(true)
    try {
      // Get backend host to form download URL
      const backendHost = window.localStorage.getItem('backend_host') || import.meta.env.VITE_BACKEND_HOST || `${window.location.hostname}:8000`
      const downloadUrl = `http://${backendHost}/api/frontend/update/download`
      
      console.log('Sending update request to local agent:', downloadUrl);
      const res = await fetch(`${getLocalAgentBaseUrl()}/api/local/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadUrl })
      })
      
      const contentType = res.headers.get("content-type");
      let data;
      if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await res.json()
      } else {
        const text = await res.text()
        throw new Error(`Unexpected response from server: ${text.substring(0, 100)}...`)
      }
      if (data.status === 'success') {
        Modal.success({
          title: 'Update Successful',
          content: 'Frontend updated successfully. Click OK to refresh the page.',
          onOk: () => window.location.reload()
        })
      } else {
        Modal.error({
          title: 'Update Failed',
          content: data.message || 'Unknown Error'
        })
      }
    } catch (e) {
      Modal.error({
        title: 'Update Error',
        content: e.message
      })
    } finally {
      setUpdating(false)
      setUpdateAvailable(null)
    }
  }

  useEffect(() => {
    if (user) {
      const isSuper = user?.role === 'SUPER_ADMIN' || user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'superadmin'
      const isCompany = user?.role === 'COMPANY_ADMIN' || user?.role?.toLowerCase() === 'company_admin'
      
      if (isSuper) {
        fetchSkills()
        fetchCompanies()
      }
      if (isSuper || isCompany) {
        fetchDbConfigs()
        fetchUsers()
      }
      fetchCompanyChannels()
    }
  }, [user])

  useEffect(() => {
    if (activeTab === 'databases') {
      fetchDbConfigs()
    }
  }, [activeTab])

  const handleLoginSuccess = () => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    initSessions()
  }

  const initSessions = async () => {
    fetchScheduledTasks()
    try {
      const res = await api.get('/sessions')
      const loaded = res.data.sessions || []
      setSessions(loaded)
      if (loaded.length > 0) loadSession(loaded[0].id)
      else startNewSession()
    } catch (e) {
      if (e.response?.status === 401) { logout(); return }
      setSessions([])
      startNewSession()
    }
  }

  const connectChatWs = () => {
    return new Promise((resolve) => {
      if (!sessionId) {
        resolve(false)
        return
      }
      if (chatWsRef.current && chatWsRef.current.readyState === WebSocket.OPEN) {
        resolve(true)
        return
      }
      if (chatWsRef.current) {
        const ws = chatWsRef.current
        ws.onclose = null
        ws.readyState === WebSocket.CONNECTING ? (ws.onopen = () => ws.close()) : ws.close()
      }
      const token = localStorage.getItem('token')
      const ws = new WebSocket(`${getWsBaseUrl()}/ws/logs?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token || '')}`)
      chatWsRef.current = ws
      
      ws.onopen = () => {
        resolve(true)
      }
      
      ws.onerror = () => {
        resolve(false)
      }

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)

          // Intercept local execution requests and call Node.js service
          if (data.type === 'local_command' || data.type === 'local_db') {
            console.log('[ChatWS] Received local_db/local_command:', data.type, data.operation || data.command, data.command_id);
            try {
              const endpoint = data.type === 'local_command' ? `${getLocalAgentBaseUrl()}/api/local/execute` : `${getLocalAgentBaseUrl()}/api/local/db`;
              const body = data.type === 'local_command' 
                ? { command: data.command, cwd: data.cwd }
                : { type: data.db_type, config: data.config, query: data.query, operation: data.operation, table: data.table };
                
              let displayCmd = data.type === 'local_command' 
                ? `> ${data.command}\n` 
                : `> [DB ${data.db_type}] ${data.operation || 'query'} ${data.query || data.table || ''}\n`;
              appendLiveLog(displayCmd);

              const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              });
              
              // Parse response safely: might not be valid JSON
              const textResult = await res.text();
              let result;
              try {
                result = textResult ? JSON.parse(textResult) : {};
              } catch (e) {
                result = { status: 'error', error: `Failed to parse response: ${textResult || 'Empty response'}` };
              }
              
              if (!res.ok && !result.error) {
                result.error = `HTTP ${res.status} ${res.statusText}. ${!textResult ? '(Local agent server.js might not be running on port 3000)' : ''}`;
              }

              let responseDataToBackend = result;
              
              const normalizeDbDatasets = (payload) => {
                if (!payload) return []
                if (Array.isArray(payload)) {
                  const isRows = payload.length === 0 || (payload[0] && typeof payload[0] === 'object' && !Array.isArray(payload[0]))
                  if (isRows) return [{ name: 'Result', rows: payload }]
                  const sets = payload
                    .filter(x => Array.isArray(x))
                    .map((rows, idx) => ({ name: `Result Set ${idx + 1}`, rows }))
                    .filter(ds => Array.isArray(ds.rows) && (ds.rows.length === 0 || (ds.rows[0] && typeof ds.rows[0] === 'object' && !Array.isArray(ds.rows[0]))))
                  return sets
                }
                if (typeof payload === 'object') {
                  const keys = Object.keys(payload)
                  const arrKeys = keys.filter(k => Array.isArray(payload[k]))
                  if (arrKeys.length >= 2) {
                    return arrKeys.map(k => ({ name: k, rows: payload[k] }))
                  }
                }
                return []
              }

              const isDbSqlAgent = data.type === 'local_db' && data.agent_name === 'DBSqlAgent'
              const datasets = isDbSqlAgent ? normalizeDbDatasets(result.data) : []
              const isMultiDataset = datasets.length > 1
              const isLargeSingleDataset = datasets.length === 1 && Array.isArray(datasets[0].rows) && datasets[0].rows.length > 5

              if (isDbSqlAgent && (isMultiDataset || isLargeSingleDataset)) {
                const rand = Math.random().toString(36).slice(2, 11)
                const baseId = 'data_' + Date.now() + '_' + rand

                const idbPut = (key, val) => {
                  try {
                    const req = indexedDB.open('autobot_data_store', 1)
                    req.onupgradeneeded = () => {
                      const db = req.result
                      if (!db.objectStoreNames.contains('store')) db.createObjectStore('store')
                    }
                    req.onsuccess = () => {
                      const db = req.result
                      const tx = db.transaction('store', 'readwrite')
                      tx.objectStore('store').put(val, key)
                    }
                  } catch (e) {
                  }
                }

                const saveToBackend = async (key, val) => {
                  try {
                    await api.post('/data-store/save', { stored_id: key, data: val })
                  } catch (err) {
                    console.error('Failed to save data store to backend', err)
                  }
                }

                if (isMultiDataset) {
                  const manifestId = baseId + '_manifest'
                  const datasetMetas = []

                  for (let i = 0; i < datasets.length; i++) {
                    const rows = datasets[i]?.rows
                    if (!Array.isArray(rows)) continue

                    const dataId = baseId + '_d' + (i + 1)
                    idbPut(dataId, rows)
                    await saveToBackend(dataId, rows)

                    const sample = rows.slice(0, 5)
                    const cols = Object.keys(sample[0] || {})
                    const schemaData = await profileDataAsync(rows)
                    datasetMetas.push({
                      id: dataId,
                      name: datasets[i]?.name || `Result Set ${i + 1}`,
                      total_rows: rows.length,
                      cols,
                      schema_injected: `【DATA_SCHEMA】${JSON.stringify(schemaData)}【END_SCHEMA】`
                    })
                  }

                  const manifest = {
                    type: 'data_store_manifest',
                    created_at: new Date().toISOString(),
                    datasets: datasetMetas
                  }

                  idbPut(manifestId, manifest)
                  await saveToBackend(manifestId, manifest)

                  window.__latestDbStoredId = manifestId

                  responseDataToBackend = {
                    status: result.status,
                    data: {
                      _meta: {
                        note: 'Multiple result sets have been stored as multiple json files with a manifest.',
                        stored_id: manifestId,
                        manifest_id: manifestId,
                        dataset_count: datasetMetas.length
                      },
                      datasets: datasetMetas.map(x => ({
                        name: x.name,
                        total_rows: x.total_rows,
                        cols: x.cols
                      }))
                    }
                  }
                } else {
                  const rows = datasets[0]?.rows || []
                  const storedId = baseId
                  idbPut(storedId, rows)
                  await saveToBackend(storedId, rows)
                  window.__latestDbStoredId = storedId

                  const sample = rows.slice(0, 5)
                  const keys = Object.keys(sample[0] || {})
                  const schemaData = await profileDataAsync(rows)

                  responseDataToBackend = {
                    status: result.status,
                    data: {
                      _meta: {
                        note: "Data is too large and has been stored locally in the frontend.",
                        stored_id: storedId,
                        total_rows: rows.length,
                        columns: keys,
                        data_schema_injected: `【DATA_SCHEMA】${JSON.stringify(schemaData)}【END_SCHEMA】`
                      },
                      sample_data: sample
                    }
                  }
                }
              }

              let displayResult = '';
              if (data.type === 'local_command') {
                if (result.stdout) displayResult += result.stdout + (result.stdout.endsWith('\n') ? '' : '\n');
                if (result.stderr) displayResult += result.stderr + (result.stderr.endsWith('\n') ? '' : '\n');
                if (result.error) displayResult += `Error: ${result.error}\n`;
              } else {
                if (result.data) {
                  displayResult += (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)) + '\n';
                } else if (result.error) {
                  displayResult += `Error: ${result.error}\n`;
                  if (result._stack) displayResult += `${result._stack}\n`;
                } else {
                  displayResult += JSON.stringify(result, null, 2) + '\n';
                }
              }
              appendLiveLog(displayResult);

              await api.post('/chat/local_result', { session_id: sessionId, command_id: data.command_id, result: responseDataToBackend });
            } catch (err) {
              appendLiveLog(`Fetch Error: ${err.message}\n`);
              await api.post('/chat/local_result', { session_id: sessionId, command_id: data.command_id, result: { status: 'error', error: err.message } });
            }
            return;
          }

          if (data.type === 'plan') {
            setMessages(prev => [...prev, { role: 'plan', content: data.message }])
          } else if (data.type === 'ui_render') {
            const localId = data.id || Date.now()
            setMessages(prev => [...prev, { id: data.id || null, _localId: localId, role: 'ui_render', content: data.message }])
          } else if (data.type === 'AGENT_STREAM' || data.type === 'AGENT_THOUGHT') {
            // Also show stream/thought output in terminal (skip HTML generation streaming)
            if (data.type === 'AGENT_STREAM' && data.token && data.agent !== 'UIAgent') {
              appendLiveLog(data.token)
              // Accumulate tokens for early __CMD__ dispatch
              appendStreamToken(data.token)
              if (workspaceDir && data.token.includes('__CMD__')) {
                tryStreamDispatch(workspaceDir, (line) => appendLiveLog(line), sessionId)
              }
            } else if (data.type === 'AGENT_THOUGHT' && data.thought) {
              appendLiveLog(`[${data.agent || 'agent'}] ${data.thought}\n`)
            }
            setMessages(prev => {
              const newMsgs = [...prev]
              let planIdx = -1
              for (let i = newMsgs.length - 1; i >= 0; i--) {
                if (newMsgs[i].role === 'plan') { planIdx = i; break }
              }
              if (planIdx !== -1 && newMsgs[planIdx].content?.plan) {
                const planMsg = { ...newMsgs[planIdx] }
                const newPlan = { ...planMsg.content }
                const newSteps = [...newPlan.plan]
                // Find the currently running step
                const stepIdx = newSteps.findIndex(s => s && s.status === 'running')
                if (stepIdx !== -1) {
                  const currentStep = newSteps[stepIdx];
                  const newText = data.type === 'AGENT_STREAM' ? (data.token || '') : ((data.thought || '') + '\n');
                  newSteps[stepIdx] = { 
                    ...currentStep, 
                    thought: (currentStep.thought || '') + newText 
                  }
                  newPlan.plan = newSteps
                  planMsg.content = newPlan
                  newMsgs[planIdx] = planMsg
                }
              }
              return newMsgs
            })
          } else if (data.type === 'log') {
            // Backend broadcastLog → show in terminal panel
            const logMsg = data.message
            if (logMsg && typeof logMsg === 'object') {
              appendLiveLog(`[${logMsg.log_type || 'info'}] ${logMsg.message}\n`)
            } else if (typeof logMsg === 'string') {
              appendLiveLog(logMsg + '\n')
            }
          } else if (data.type === 'agent_step') {
            console.log('[ChatWS] agent_step:', data.message?.step, data.message?.status, data.message?.agent)
            setMessages(prev => {
              const newMsgs = [...prev]
              let planIdx = -1
              for (let i = newMsgs.length - 1; i >= 0; i--) {
                if (newMsgs[i].role === 'plan') { planIdx = i; break }
              }
              if (planIdx !== -1 && newMsgs[planIdx].content?.plan && data.message && data.message.step !== undefined) {
                const planMsg = { ...newMsgs[planIdx] }
                const newPlan = { ...planMsg.content }
                const newSteps = [...newPlan.plan]
                // Match by step number or fallback to index
                const stepIdx = newSteps.findIndex((s, idx) => 
                  s && (Number(s.step) === Number(data.message.step) || idx + 1 === Number(data.message.step))
                )
                if (stepIdx !== -1) {
                  newSteps[stepIdx] = { ...newSteps[stepIdx], ...data.message }
                  newPlan.plan = newSteps
                  planMsg.content = newPlan
                  newMsgs[planIdx] = planMsg
                  // If UIAgent completed, inject a ui_render message so the HTML renders inline
                  if (data.message.agent === 'UIAgent' && data.message.status === 'completed' && data.message.result) {
                    const localId = Date.now()
                    newMsgs.push({
                      id: null, _localId: localId,
                      role: 'ui_render',
                      content: data.message.result,
                      timestamp: new Date().toISOString()
                    })
                  }
                }
              }
              return newMsgs
            })
          }
        } catch (e) {}
      }
    })
  }

  useEffect(() => {
    connectChatWs()
    return () => {
      if (chatWsRef.current) {
        const ws = chatWsRef.current
        ws.onclose = null
        ws.readyState === WebSocket.CONNECTING ? (ws.onopen = () => ws.close()) : ws.close()
        chatWsRef.current = null
      }
    }
  }, [sessionId])

  const fetchDbConfigs = async () => {
    try {
      const res = await api.get('/db-configs')
      const configs = res.data?.configs || []
      setDbConfigs(configs)
    } catch (e) {
      console.error('Failed to fetch DB configs:', e)
    }
  }

  const deleteDbConfig = async (id) => {
    try {
      await api.delete(`/db-configs/${id}`)
      fetchDbConfigs()
      message.success('DB config deleted successfully')
    } catch (e) {
      message.error('Failed to delete DB config: ' + (e.response?.data || e.message))
    }
  }

  const addDbConfig = async (config) => {
    try {
      // Test connection
      const testRes = await fetch(`${getLocalAgentBaseUrl()}/api/local/db/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: config.type,
          config: {
            host: config.host,
            port: config.port,
            user: config.username,
            password: config.password,
            database: config.database
          }
        })
      });
      
      const responseText = await testRes.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        if (!testRes.ok) {
          throw new Error(`Local Agent Error (${testRes.status}): ${responseText || 'Empty response. Is server.js running?'}`);
        }
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
      
      if (result.status !== 'success') {
        message.error('Database connection test failed:\n' + (result.message || 'Unknown error'));
        return false; // do not save if test fails
      }

      await api.post('/db-configs', config)
      fetchDbConfigs()
      message.success('DB config added successfully')
      return true;
    } catch (e) {
      message.error('Failed to add DB config: ' + (e.response?.data || e.message))
      return false;
    }
  }

  const updateDbConfig = async (id, config) => {
    try {
      // Test connection
      const testRes = await fetch(`${getLocalAgentBaseUrl()}/api/local/db/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: config.type,
          config: {
            host: config.host,
            port: config.port,
            user: config.username,
            password: config.password,
            database: config.database
          }
        })
      });
      
      const responseText = await testRes.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        if (!testRes.ok) {
          throw new Error(`Local Agent Error (${testRes.status}): ${responseText || 'Empty response. Is server.js running?'}`);
        }
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
      
      if (result.status !== 'success') {
        message.error('Database connection test failed:\n' + (result.message || 'Unknown error'));
        return false; // do not save if test fails
      }

      await api.put(`/db-configs/${id}`, config)
      fetchDbConfigs()
      message.success('DB config updated successfully')
      return true;
    } catch (e) {
      message.error('Failed to update DB config: ' + (e.response?.data || e.message))
      return false;
    }
  }

  const fetchCompanies = async () => {
    try {
      const res = await api.get('/companies')
      setCompanies(res.data || [])
    } catch (e) {}
  }

  const fetchCompanyChannels = async () => {
    if (!user?.companyId) return
    try {
      const res = await api.get(`/companies/${user.companyId}/channels`)
      setCompanyChannels(res.data || [])
    } catch (e) {}
  }

  const addCompany = async (values) => {
    try {
      await api.post('/companies', values)
      fetchCompanies()
      message.success('Company added successfully')
    } catch (e) {
      message.error('Failed to add company: ' + (e.response?.data || e.message))
    }
  }

  const deleteCompany = async (id) => {
    try {
      await api.delete(`/companies/${id}`)
      fetchCompanies()
      message.success('Company deleted successfully')
    } catch (e) {
      message.error('Failed to delete company: ' + (e.response?.data || e.message))
    }
  }

  const updateCompany = async (id, values) => {
    try {
      await api.put(`/companies/${id}`, values)
      fetchCompanies()
      message.success('Company updated successfully')
    } catch (e) {
      message.error('Failed to update company: ' + (e.response?.data || e.message))
    }
  }

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users')
      setUsers(res.data || [])
    } catch (e) {}
  }

  const addUser = async (values) => {
    try {
      await api.post('/users', values)
      fetchUsers()
      message.success('User added successfully')
    } catch (e) {
      message.error('Failed to add user: ' + (e.response?.data || e.message))
    }
  }

  const updateUser = async (id, values) => {
    try {
      await api.put(`/users/${id}`, values)
      if (id === user?.id) {
        message.success('Profile updated successfully. Please log in again.')
        setTimeout(() => logout(), 1500)
      } else {
        message.success('User updated successfully')
        fetchUsers()
      }
    } catch (e) {
      message.error('Failed to update user: ' + (e.response?.data || e.message))
    }
  }

  const deleteUser = async (id) => {
    try {
      await api.delete(`/users/${id}`)
      message.success('User deleted successfully')
      fetchUsers()
    } catch (e) {
      message.error('Failed to delete user: ' + (e.response?.data || e.message))
    }
  }

  const approveUser = async (id) => {
    try {
      await api.post(`/users/${id}/approve`)
      message.success('User approved successfully')
      fetchUsers()
    } catch (e) {
      message.error('Failed to approve user: ' + (e.response?.data || e.message))
    }
  }

  const rejectUser = async (id) => {
    try {
      await api.post(`/users/${id}/reject`)
      message.success('User rejected successfully')
      fetchUsers()
    } catch (e) {
      message.error('Failed to reject user: ' + (e.response?.data || e.message))
    }
  }

  const fetchSkills = async () => {
    try {
      const res = await api.get('/skills')
      setSkills(res.data?.skills || [])
    } catch (e) {}
  }
  
  const toggleSkill = async (name, enabled) => {
    try {
      await api.put(`/skills/${encodeURIComponent(name)}/enabled`, { enabled })
      fetchSkills()
      message.success(`Skill ${enabled ? 'enabled' : 'disabled'} successfully`)
    } catch (e) {
      message.error('Failed to toggle skill: ' + (e.response?.data || e.message))
    }
  }




  const fetchSessions = async () => {
    try {
      const res = await api.get('/sessions')
      setSessions(res.data.sessions || [])
    } catch (e) {
      if (e.response?.status === 401) logout()
    }
  }

  useEffect(() => {
    const handleScheduledTaskAdded = () => {
      fetchScheduledTasks();
    };
    window.addEventListener('scheduledTaskAdded', handleScheduledTaskAdded);
    return () => {
      window.removeEventListener('scheduledTaskAdded', handleScheduledTaskAdded);
    };
  }, []);

  const fetchScheduledTasks = async () => {
    try {
      const res = await api.get('/scheduled-tasks')
      setScheduledTasks(res.data || [])
    } catch (e) {
      // ignore
    }
  }

  const loadSession = async (id, instantSwitch = true) => {
    if (!id) return

    const isSameSession = id === sessionId

    endLiveLogSession()
    setActiveTab('chat')

    if (!isSameSession) {
      if (instantSwitch) {
        setSessionId(id)

        if (chatWsRef.current) {
          try { chatWsRef.current.close() } catch (e) {}
          chatWsRef.current = null
        }
        setTimeout(() => connectChatWs(), 50)
      }
      setIsLoading(true)
    }

    // ── Fast path: cache hit ──
    const cached = sessionCacheRef.current.get(id)
    if (cached) {
      if (!isSameSession) setSessionId(id)
      setMessages(cached)
      setIsLoading(false)
      return
    }

    // ── Cache miss: load from DB ──
    if (isSameSession) setIsLoading(true)

    try {
      const res = await api.get(`/session/${id}`)
      let history = res.data.history || []
      const sessionChannel = res.data.channel
      const sessionWorkspaceDir = res.data.workspaceDir

      // ── Restore session metadata and validate workspace for code sessions ──
      if (sessionChannel === 'code' && sessionWorkspaceDir) {
        setWorkspaceDir(sessionWorkspaceDir)
        const valid = await validateWorkspaceDir(sessionWorkspaceDir)
        if (!valid) {
          console.warn('[Workspace] Stored workspace is invalid:', sessionWorkspaceDir)
          setWsInvalid(true)
          setWsPickerChannel('code')
          setShowWsPicker(true)
          loadWsBrowse(sessionWorkspaceDir)
        } else {
          setWsInvalid(false)
        }
      } else if (sessionChannel === 'code') {
        // Code session but no workspace set - prompt user to select one
        setWsInvalid(true)
        setWsPickerChannel('code')
        setShowWsPicker(true)
        loadWsBrowse(getInitialBrowsePath())
      }

      history = history
        .filter(m =>
          !isCommandResultsMessage(m?.content)
          && !isIntermediateCmdMessage(m?.content)
          && !isCommandResultsPlanMessage(m)
        )
        .map(m => {
        if (m.role === 'plan' && typeof m.content === 'string') {
          try {
            const parsedContent = JSON.parse(m.content)
            if (!parsedContent.status) {
              parsedContent.status = 'pending'
            }
            return { ...m, content: parsedContent }
          } catch (e) {
            return m;
          }
        }
        return m;
      })

      history.sort((a, b) => {
        const tA = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() :
                  (typeof a.timestamp === 'number' ? a.timestamp * 1000 : new Date(a.timestamp || 0).getTime())
        const tB = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() :
                  (typeof b.timestamp === 'number' ? b.timestamp * 1000 : new Date(b.timestamp || 0).getTime())
        return tA - tB
      })

      // Re-inject ui_render messages from completed UIAgent plan steps
      const enriched = []
      for (const m of history) {
        enriched.push(m)
        if (m.role === 'plan' && m.content && m.content.plan) {
          for (const step of m.content.plan) {
            if (step.agent === 'UIAgent' && step.status === 'completed' && step.result) {
              const localId = Date.now() + Math.random()
              enriched.push({ id: null, _localId: localId, role: 'ui_render', content: step.result })
            }
          }
        }
      }
      history = enriched

      sessionCacheRef.current.set(id, history)
      if (sessionCacheRef.current.size > 20) {
        const firstKey = sessionCacheRef.current.keys().next().value
        sessionCacheRef.current.delete(firstKey)
      }

      if (!isSameSession) setSessionId(id)
      const batchThreshold = 10
      if (history.length > batchThreshold) {
        setIsParsingHistory(true)
        const worker = new Worker(new URL('./workers/messageNormalizer.worker.js', import.meta.url), { type: 'module' })
        worker.onmessage = (e) => {
          if (e.data.error) {
            console.warn('[Worker] messageNormalizer failed:', e.data.error)
            setMessages(history.map(normalizeMessage))
          } else {
            setMessages(e.data.normalized)
          }
          setIsParsingHistory(false)
          worker.terminate()
        }
        worker.onerror = (err) => {
          console.warn('[Worker] messageNormalizer error:', err)
          setMessages(history.map(normalizeMessage))
          setIsParsingHistory(false)
          worker.terminate()
        }
        worker.postMessage({ messages: history })
      } else {
        setMessages(history.map(normalizeMessage))
      }
    } catch (e) {
      setMessages([{ role: 'error', content: 'Failed to load session history' }])
    } finally { setIsLoading(false) }
  }

  const SessionSkeleton = () => (
    <div style={{ padding: '16px 0' }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 20, animation: `fadeIn 0.3s ease ${i * 0.1}s both` }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#2a2a2a', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: 80, height: 12, background: '#2a2a2a', borderRadius: 4, marginBottom: 8, opacity: 0.6 }} />
            <div style={{ width: '60%', height: 16, background: '#2a2a2a', borderRadius: 4, marginBottom: 6 }} />
            <div style={{ width: '80%', height: 16, background: '#2a2a2a', borderRadius: 4, opacity: 0.8 }} />
          </div>
        </div>
      ))}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )

  const startNewSession = (channelType) => {
    const ch = channelType || currentChannel
    setCurrentChannel(ch)
    if (ch === 'code') {
      // For code sessions: show workspace picker first, then create session
      setWsPickerChannel(ch)
      setShowWsPicker(true)
      loadWsBrowse(getInitialBrowsePath())
      return
    }
    createSessionDirect(ch)
  }

  const loadWsBrowse = async (path) => {
    setWsBrowsePath(path || (isWindows() ? '磁盘根目录' : '/'))
    setWsBrowseLoading(true)
    try {
      const baseUrl = `http://localhost:${window.location.port}`
      const res = await fetch(baseUrl + '/api/local/workspace/browse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      const data = await res.json()
      setWsBrowseEntries(data.entries || [])
    } catch (e) {
      setWsBrowseEntries([])
    }
    setWsBrowseLoading(false)
  }

  const validateWorkspaceDir = async (dirPath) => {
    try {
      const baseUrl = `http://localhost:${window.location.port}`
      const res = await fetch(baseUrl + '/api/local/workspace/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      })
      const data = await res.json()
      return data.valid === true
    } catch (e) {
      console.warn('[Workspace] Validation failed:', e)
      return false
    }
  }

  const normalizeMessage = (msg) => {
    if (msg.role !== 'assistant' || typeof msg.content !== 'string') return msg
    if (msg.__cmd) return msg
    let state = null, analysisResult = null, displayContent = null
    try {
      const stateJson = extractTrailingStateJson(msg.content)
      if (stateJson) state = JSON.parse(stateJson)
    } catch (e) { /* ignore parse errors */ }
    try {
      analysisResult = tryParseAnalysisResult(msg.content)
    } catch (e) { /* ignore parse errors */ }
    try {
      displayContent = stripAgentMarkers(msg.content)
    } catch (e) { /* ignore parse errors */ }
    return { ...msg, __cmd: { state, analysisResult, displayContent, hasCommands: msg.content.includes('__CMD__') } }
  }

  const syncWorkspaceTreeSilently = async (dirPath, reason = 'auto') => {
    if (!dirPath) return false
    const syncKey = `${sessionId}:${dirPath}`
    if (syncedWorkspaceTreesRef.current.has(syncKey)) {
      return true
    }

    try {
      appendLiveLog(`[WorkspaceTree] start path=${dirPath} reason=${reason}\n`)
      const localRes = await fetch(`${getLocalAgentBaseUrl()}/api/local/workspace/tree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: dirPath,
          maxDepth: 12,
          maxEntries: 30000,
          extensions: '.java,.jsx,.js,.tsx,.ts,.py,.sql,.xml,.json,.yml,.yaml,.properties,.md,.sh,.gradle,.toml'
        })
      })
      const localData = await localRes.json()
      if (!localRes.ok) {
        throw new Error(localData?.error || 'local workspace tree failed')
      }

      const syncRes = await api.post('/workspace/tree/sync', {
        session_id: sessionId,
        workspace_dir: dirPath,
        root: localData.root || dirPath,
        scanned_at: localData.scannedAt,
        truncated: localData.truncated === true,
        entries: localData.entries || []
      })
      if (syncRes.data?.status !== 'success') {
        throw new Error(syncRes.data?.message || 'backend workspace tree sync failed')
      }

      syncedWorkspaceTreesRef.current.add(syncKey)
      appendLiveLog(`[WorkspaceTree] ok entries=${syncRes.data.entry_count || 0} truncated=${syncRes.data.truncated === true}\n`)
      return true
    } catch (e) {
      appendLiveLog(`[WorkspaceTree] failed ${e.message}\n`)
      return false
    }
  }

  const createSessionDirect = (ch, wsDir) => {
    const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    endLiveLogSession()
    setActiveTab('chat')
    setSessionId(newId)
    setMessages([])
    if (wsDir) {
      setWorkspaceDir(wsDir)
      setWsInvalid(false) // Workspace is now valid
    }
    setSessions(prev => {
      const withoutTemp = prev.filter(s => s.title !== 'New Chat')
      return [{ id: newId, title: 'New Chat', channel: ch, createdAt: new Date().toISOString() }, ...withoutTemp]
    })
  }

  const changeWorkspaceDir = async (newDir) => {
    if (!newDir || newDir === workspaceDir) return
    setWorkspaceDir(newDir)
    setWsInvalid(false)
    await syncWorkspaceTreeSilently(newDir, 'workspace-change')
  }

  const handleExecutePlan = async (editedPlanArray, msg) => {
    try {
      endLiveLogSession()
      setIsLoading(true);
      
      const newPlanContent = { ...msg.content, plan: editedPlanArray, status: 'executed' };
      setMessages(prev => {
        // Try to find the exact message or match by id
        const idx = prev.findIndex(m => m === msg || (m.id && msg.id && m.id === msg.id));
        if (idx !== -1) {
          const newMsgs = [...prev];
          newMsgs[idx] = { ...newMsgs[idx], content: newPlanContent };
          return newMsgs;
        }
        // Fallback: update the last plan message
        const newMsgs = [...prev];
        for (let i = newMsgs.length - 1; i >= 0; i--) {
          if (newMsgs[i].role === 'plan') {
            newMsgs[i] = { ...newMsgs[i], content: newPlanContent };
            break;
          }
        }
        return newMsgs;
      });
      
      // Find the most recent user message as the actual goal
      let actualGoal = 'Execute the plan';
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          actualGoal = messages[i].content;
          break;
        }
      }
      
      const res = await api.post('/chat/execute', { 
        session_id: sessionId, 
        message: actualGoal, 
        plan: editedPlanArray,
        message_id: msg.content?.message_id || msg.id
      });
      
      if (res.data.status === 'success') {
        setMessages(prev => [...prev, normalizeMessage({ role: 'assistant', content: res.data.response })]);
        fetchSessions();
      } else {
        setMessages(prev => [...prev, { role: 'error', content: `Error: ${res.data.message}` }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', content: `Execution Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  }

  const deleteSession = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Delete this session?')) return
    try {
      await api.delete(`/sessions/${id}`)
      setSessions(prev => prev.filter(s => s.id !== id))
      sessionCacheRef.current.delete(id)
      if (sessionId === id) startNewSession()
    } catch (e) {}
  }

  const sendMessage = async (presetText) => {
    let text = typeof presetText === 'string' ? presetText : input;
    if ((!text.trim() && !selectedImageBase64 && uploadedDocuments.length === 0) || isLoading) return

    // Reset the streaming __CMD__ buffer for the new response
    resetStreamBuffer()

    // ── Block chat if workspace is invalid for code sessions ──
    const currentSession = sessions.find(s => s.id === sessionId)
    if (currentSession?.channel === 'code' && wsInvalid) {
      setShowWsPicker(true)
      return
    }

    setInput('')
    endLiveLogSession()
    setIsLoading(true)

    // 1. Check if token is expired
    try {
      const me = await fetchMe()
      if (!me) {
        logout()
        setIsLoading(false)
        return
      }
    } catch (e) {
      logout()
      setIsLoading(false)
      return
    }

    // 2. Check and reconnect WebSocket if disconnected
    const wsConnected = await connectChatWs()
    if (!wsConnected) {
      setMessages(prev => [...prev, { role: 'error', content: 'Failed to connect to the server via WebSocket.' }])
      setIsLoading(false)
      return
    }

    let contentToDisplay = text;
    if (selectedImage) {
      contentToDisplay = `[Image: ${selectedImage}]\n${text}`;
    } else if (uploadedDocuments.length > 0) {
      const docNames = uploadedDocuments.map(d => d.name).join(', ');
      contentToDisplay = `[Document context: ${docNames}]\n${text}`;
    }
    setMessages(prev => [...prev, { id: nextMsgId(), role: 'user', content: contentToDisplay }])
    
    if (!sessions.find(s => s.id === sessionId)) {
      setSessions(prev => [{ id: sessionId, title: text || selectedImage || (uploadedDocuments.length > 0 ? uploadedDocuments[0].name : 'New Session'), timestamp: new Date().toISOString() }, ...prev])
    }
    try {
      if (currentSession?.channel === 'code' && workspaceDir) {
        await syncWorkspaceTreeSilently(workspaceDir, 'before-chat')
      }

      const payload = { message: text, session_id: sessionId };
      if (selectedImageBase64) {
        payload.image_base64 = selectedImageBase64;
      }
      if (uploadedDocuments.length > 0) {
        payload.document_ids = uploadedDocuments.map(d => d.id);
      }
      // Include channel for new sessions (first message determines the channel)
      const session = sessions.find(s => s.id === sessionId);
      if (session && session.channel) {
        payload.channel = session.channel;
      }
      // Include workspace directory for code sessions
      if (workspaceDir) {
        payload.workspace_dir = workspaceDir;
      }
      // Include client platform/tool info so the backend adapts commands per OS
      if (probeResult) {
        payload.client_info = getClientInfo(probeResult);
      }
      const res = await api.post('/chat', payload)
      if (res.data.status === 'success') {
        setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: res.data.response })])
        fetchSessions()
      } else if (res.data.status === 'plan_generated') {
        const planData = { ...res.data.plan, status: 'executing' }
        setMessages(prev => [...prev, { id: nextMsgId(), role: 'plan', content: planData }])

        try {
          const execRes = await api.post('/chat/execute', {
            session_id: sessionId,
            message: text,
            plan: planData.plan,
            message_id: planData.message_id
          })
          if (execRes.data.status === 'success') {
            setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: execRes.data.response })])
            setMessages(prev => {
              const newMsgs = [...prev]
              for (let i = newMsgs.length - 1; i >= 0; i--) {
                if (newMsgs[i].role === 'plan') {
                  newMsgs[i] = { ...newMsgs[i], content: { ...newMsgs[i].content, status: 'executed' } }
                  break
                }
              }
              return newMsgs
            })
            fetchSessions()
          } else {
            setMessages(prev => [...prev, { role: 'error', content: `Error: ${execRes.data.message}` }])
          }
        } catch (err) {
          setMessages(prev => [...prev, { role: 'error', content: `Execution Error: ${err.message}` }])
        }
      } else {
        setMessages(prev => [...prev, { role: 'error', content: `Error: ${res.data.message}` }])
      }
    } catch (err) {
      if (err.response?.status === 401) {
        logout()
        return
      }
      setMessages(prev => [...prev, { role: 'error', content: `Network Error: ${err.message}` }])
    } finally { 
      setIsLoading(false);
      setSelectedImage(null);
      setSelectedImageBase64(null);
    }
  }

  // ── Agent command detection: auto-execute __CMD__ markers ──
  const processedCmdMsgs = useRef(new Set())
  const processingCmdMsgs = useRef(new Set())
  const syncedWorkspaceTreesRef = useRef(new Set())
  const silentResponseVersionRef = useRef(new Map())

  const isCommandResultsMessage = (content) =>
    typeof content === 'string' && content.trim().startsWith('[COMMAND_RESULTS]')

  const isIntermediateCmdMessage = (content) =>
    typeof content === 'string' && content.includes('__CMD__')

  const isCommandResultsPlanMessage = (msg) => {
    if (!msg || msg.role !== 'plan') return false
    const content = msg.content
    if (typeof content === 'object' && content?.plan?.length) {
      return typeof content.plan[0]?.goal === 'string' && content.plan[0].goal.startsWith('[COMMAND_RESULTS]')
    }
    if (typeof content !== 'string') return false
    try {
      const parsed = JSON.parse(content)
      return Array.isArray(parsed?.plan)
        && typeof parsed.plan[0]?.goal === 'string'
        && parsed.plan[0].goal.startsWith('[COMMAND_RESULTS]')
    } catch (e) {
      return false
    }
  }

  const startLiveLogSession = (reset = false) => {
    if (reset || !liveLogActiveRef.current) {
      setLocalTerminalOutput('')
    }
    liveLogActiveRef.current = true
    setLiveLogActive(true)
    setShowLogs(true)
  }

  const appendLiveLog = (chunk) => {
    if (!chunk) return
    if (!liveLogActiveRef.current) {
      startLiveLogSession(true)
      setLocalTerminalOutput(chunk)
      return
    }
    setLocalTerminalOutput(prev => prev + chunk)
  }

  const endLiveLogSession = () => {
    liveLogActiveRef.current = false
    setLiveLogActive(false)
    setLocalTerminalOutput('')
    setShowLogs(false)
  }

  useEffect(() => {
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
    if (!lastMsg || lastMsg.role !== 'assistant') return
    if (!lastMsg.content || !lastMsg.content.includes('__CMD__')) return
    if (!lastMsg.id) return

    const commandExecutionKey = `${lastMsg.id}:${lastMsg.content}`
    if (processedCmdMsgs.current.has(commandExecutionKey)) return
    if (processingCmdMsgs.current.has(commandExecutionKey)) return

    processingCmdMsgs.current.add(commandExecutionKey)
    if (processingCmdMsgs.current.size > 50) {
      const arr = [...processingCmdMsgs.current]
      processingCmdMsgs.current = new Set(arr.slice(-30))
    }

    const wsDir = workspaceDir || getDefaultWorkspaceDir()
    startLiveLogSession(true)
    executeAgentCommands(lastMsg.content, wsDir, (line) => {
      appendLiveLog(line)
    }, sessionId).then(results => {
      if (!results) {
        processingCmdMsgs.current.delete(commandExecutionKey)
        return
      }
      processedCmdMsgs.current.add(commandExecutionKey)
      processingCmdMsgs.current.delete(commandExecutionKey)
      // Limit set size to prevent memory leak
      if (processedCmdMsgs.current.size > 50) {
        const arr = [...processedCmdMsgs.current]
        processedCmdMsgs.current = new Set(arr.slice(-30))
      }
      sendCommandResultsSilently(results, lastMsg.id)
    }).catch(e => {
      processingCmdMsgs.current.delete(commandExecutionKey)
      console.warn('Agent command execution failed:', e)
    })
  }, [messages, workspaceDir])

  useEffect(() => {
    if (!liveLogActive) return
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
    if (!lastMsg || lastMsg.role !== 'assistant') return
    if (typeof lastMsg.content !== 'string' || lastMsg.content.includes('__CMD__')) return
    if (lastMsg._isComplete === false) return
    const timer = setTimeout(() => {
      endLiveLogSession()
    }, 250)
    return () => clearTimeout(timer)
  }, [messages, liveLogActive])

  /**
   * Send command results directly to backend without creating a user message.
   * Updates the target assistant message in place with the new response.
   */
  const sendCommandResultsSilently = async (results, targetMsgId) => {
    const nextVersion = (silentResponseVersionRef.current.get(targetMsgId) || 0) + 1
    silentResponseVersionRef.current.set(targetMsgId, nextVersion)
    try {
      const payload = { message: results, session_id: sessionId }
      const session = sessions.find(s => s.id === sessionId)
      if (session && session.channel) payload.channel = session.channel
      if (workspaceDir) payload.workspace_dir = workspaceDir
      if (probeResult) payload.client_info = getClientInfo(probeResult)
      appendLiveLog('[CodeAnalysis] 回传本地命令结果到 /chat\n')

      const res = await api.post('/chat', payload)
      appendLiveLog(`[CodeAnalysis] /chat status=${res.data?.status || 'unknown'}\n`)

      let finalContent = null
      let failureReason = null

      if (res.data.status === 'success') {
        finalContent = typeof res.data.response === 'string' ? res.data.response : null
        if (!finalContent || !finalContent.trim()) {
          failureReason = '后端 /chat 返回 success，但 response 为空。'
          appendLiveLog('[CodeAnalysis] /chat 返回空 response\n')
        } else {
          appendLiveLog('[CodeAnalysis] /chat 直接返回最终分析结论\n')
        }
      } else if (res.data.status === 'plan_generated') {
        // Execute the plan silently
        const planData = res.data.plan
        appendLiveLog('[CodeAnalysis] /chat 返回 plan_generated，开始调用 /chat/execute\n')
        try {
          const execRes = await api.post('/chat/execute', {
            session_id: sessionId,
            message: results,
            plan: planData.plan,
            message_id: planData.message_id
          })
          appendLiveLog(`[CodeAnalysis] /chat/execute status=${execRes.data?.status || 'unknown'}\n`)
          if (execRes.data.status === 'success') {
            finalContent = typeof execRes.data.response === 'string' ? execRes.data.response : null
            if (!finalContent || !finalContent.trim()) {
              failureReason = '后端执行完成，但没有返回可显示的分析结论。'
              appendLiveLog('[CodeAnalysis] /chat/execute 返回空 response\n')
            } else if (finalContent.includes('__CMD__')) {
              appendLiveLog('[CodeAnalysis] /chat/execute 返回新的中间态命令，继续等待下一轮本地执行\n')
            } else {
              appendLiveLog('[CodeAnalysis] /chat/execute 返回最终分析结论\n')
            }
          } else {
            failureReason = execRes.data?.message || execRes.data?.error || '计划执行失败。'
            appendLiveLog(`[CodeAnalysis] /chat/execute 失败: ${failureReason}\n`)
          }
        } catch (e) {
          console.warn('Plan execution failed:', e)
          failureReason = e?.message || '计划执行请求失败。'
          appendLiveLog(`[CodeAnalysis] /chat/execute 异常: ${failureReason}\n`)
        }
      } else {
        failureReason = res.data?.message || res.data?.error || '后端未返回可执行结果。'
        appendLiveLog(`[CodeAnalysis] /chat 非成功返回: ${failureReason}\n`)
      }

      if (!finalContent || !finalContent.trim()) {
        appendLiveLog(`[CodeAnalysis] 使用兜底提示替换消息: ${failureReason || '未收到最终分析结论'}\n`)
        finalContent = `【Code Analysis】\n\n本轮文件读取已完成，但没有收到最终分析结论。${failureReason ? `\n\n原因: ${failureReason}` : ''}\n\n请重试一次；如果持续出现，请检查后端日志。`
      }

      if (silentResponseVersionRef.current.get(targetMsgId) !== nextVersion) {
        appendLiveLog('[CodeAnalysis] 检测到更晚的静默回传，忽略当前旧响应\n')
        return
      }

      const currentMessage = messages.find(m => m.id === targetMsgId)
      let hasCmd = finalContent.includes('__CMD__')
      if (hasCmd) {
        const previousSignature = extractCommandSignature(currentMessage?.content)
        const nextSignature = extractCommandSignature(finalContent)
        if (previousSignature && nextSignature && previousSignature === nextSignature) {
          appendLiveLog('[CodeAnalysis] 后端重复返回同一组中间态命令，停止自动重放以避免死循环\n')
          const repeatedState = parseAnalysisState(finalContent)
          const repeatedWarning = '【Code Analysis】\n\n后端重复返回了与上一轮完全相同的本地读取命令，前端已停止自动重复执行，以避免死循环。\n\n请检查后端 focused/iterative 规划是否没有推进，或根据实时日志继续排查。'
          finalContent = repeatedState
            ? replaceTrailingAnalysisState(`${repeatedWarning}\n\n${JSON.stringify(repeatedState)}`, repeatedState)
            : repeatedWarning
          hasCmd = false
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === targetMsgId
          ? normalizeMessage({ ...m, __cmd: undefined, content: mergeAnalysisStateContent(m.content, finalContent), _isComplete: !hasCmd })
          : m
      ))
    } catch (e) {
      console.warn('Command results send failed:', e)
      appendLiveLog(`[CodeAnalysis] 回传异常: ${e?.message || '网络或服务异常'}\n`)
      const fallbackContent = `【Code Analysis】\n\n本轮文件读取已完成，但回传最终分析结果失败。\n\n原因: ${e?.message || '网络或服务异常'}`
      if (silentResponseVersionRef.current.get(targetMsgId) !== nextVersion) {
        appendLiveLog('[CodeAnalysis] 检测到更晚的静默回传，忽略当前异常响应\n')
        return
      }
      setMessages(prev => prev.map(m =>
        m.id === targetMsgId
          ? normalizeMessage({ ...m, __cmd: undefined, content: mergeAnalysisStateContent(m.content, fallbackContent), _isComplete: true })
          : m
      ))
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Data = event.target.result.split(',')[1]; // Extract base64 part
        setSelectedImage(file.name);
        setSelectedImageBase64(base64Data);
      };
      reader.readAsDataURL(file);
      return;
    }

    // Handle document uploads
    const formData = new FormData()
    formData.append('file', file)
    
    // Give user immediate feedback that document is uploading
    const msgId = Date.now();
    setMessages(prev => [...prev, { id: msgId, role: 'user', content: `[Uploading Document: ${file.name}...]` }]);
    setIsLoading(true);

    try {
      const res = await api.post('/documents/upload', formData, {
        headers: { 
          'Content-Type': 'multipart/form-data'
        },
        baseURL: getBackendHost().startsWith('http') ? getBackendHost() : `http://${getBackendHost()}`
      })
      if (res.data.status === 'success') {
        const docId = res.data.document.id;
        setUploadedDocuments(prev => [...prev, { id: docId, name: file.name }]);
        message.success(`${file.name} uploaded successfully and is being parsed.`);
        
        // Start polling for parsing progress
        let checkCount = 0;
        const intervalId = setInterval(async () => {
          checkCount++;
          try {
            const baseURL = getBackendHost().startsWith('http') ? getBackendHost() : `http://${getBackendHost()}`;
            const docRes = await api.get('/documents/my', { baseURL });
            if (docRes.data && docRes.data.data) {
              const doc = docRes.data.data.find(d => d.id === docId);
              if (doc) {
                if (doc.status === 'COMPLETED') {
                  clearInterval(intervalId);
                  setMessages(prev => prev.map(msg => msg.id === msgId ? { ...msg, content: `[Document Parsed: ${file.name}]\nI have added this document to the knowledge base. Your next question will be answered using this document as context.` } : msg));
                } else if (doc.status === 'FAILED') {
                  clearInterval(intervalId);
                  setMessages(prev => prev.map(msg => msg.id === msgId ? { ...msg, content: `[Document Parsing Failed: ${file.name}]\nPlease try again or check the file format.` } : msg));
                } else {
                  // PARSING
                  setMessages(prev => prev.map(msg => msg.id === msgId ? { ...msg, content: `[Parsing Document: ${file.name}] Progress: ${doc.parsingProgress || 0}%...` } : msg));
                }
              }
            }
            if (checkCount > 60) clearInterval(intervalId); // timeout after 3 mins
          } catch (e) {}
        }, 3000);
        
      } else {
        message.error(`Upload failed: ${res.data.message}`)
        setMessages(prev => prev.filter(msg => msg.id !== msgId));
      }
    } catch (error) {
      message.error('Upload failed: ' + error.message)
      setMessages(prev => prev.filter(msg => msg.id !== msgId));
    } finally {
      setIsLoading(false);
      // reset file input
      e.target.value = null;
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorderRef.current = new MediaRecorder(stream)
      chunksRef.current = []
      mediaRecorderRef.current.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const formData = new FormData()
        formData.append('file', blob, 'recording.webm')
        formData.append('session_id', sessionId)
        formData.append('type', 'audio')
        setMessages(prev => [...prev, { role: 'user', content: '🎤 Sending audio...' }])
        try {
          const res = await api.post('/upload', formData)
          if (res.data.status === 'success') {
            const text = res.data.transcription
            setMessages(prev => { const m = [...prev]; m.pop(); return [...m, { role: 'user', content: `🎤 ${text}` }] })
            sendMessage(text)
          }
        } catch (err) {}
      }
      mediaRecorderRef.current.start()
      setIsRecording(true)
    } catch (err) { alert('Could not access microphone') }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
    }
  }

  if (!user) return <Login onLoginSuccess={handleLoginSuccess} />

  const deleteScheduledTask = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Delete this scheduled task? (Backend will also remove it)')) return
    try {
      await api.delete(`/scheduled-tasks/${id}`)
      setScheduledTasks(prev => prev.filter(t => t.id !== id))
      setSessions(prev => prev.filter(s => s.id !== `sched-${id}`))
      if (sessionId === `sched-${id}`) startNewSession()
    } catch (err) {
      alert('Failed to delete scheduled task: ' + err.message)
    }
  }

  const handleEditTask = () => {
    setEditingTask(activeScheduledTask.id)
    setEditTaskData({
      scheduleType: activeScheduledTask.scheduleType,
      scheduleTime: activeScheduledTask.scheduleTime
    })
  }

  const saveEditedTask = async () => {
    try {
      setIsLoading(true)
      await api.put(`/scheduled-tasks/${editingTask}`, editTaskData)
      message.success('Scheduled task updated successfully')
      
      // Update local state
      setScheduledTasks(prev => prev.map(t => {
        if (t.id === editingTask) {
          return { ...t, ...editTaskData }
        }
        return t
      }))
      setEditingTask(null)
    } catch (err) {
      message.error('Failed to update scheduled task: ' + err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const cancelEditTask = () => {
    setEditingTask(null)
    setEditTaskData({})
  }

  const executeScheduledTaskNow = async (taskId) => {
    if (!confirm('Execute this scheduled task now? This may take some time.')) return
    setIsLoading(true)
    try {
      await api.post(`/scheduled-tasks/${taskId}/execute`)
      loadSession(`sched-${taskId}`, false)
    } catch (err) {
      message.error('Execution failed: ' + err.message)
    } finally {
      setIsLoading(false)
    }
  }

const handleDeleteSession = (id) => {
    if (!confirm('Delete this session?')) return
    api.delete(`/sessions/${id}`).then(() => {
      setSessions(prev => prev.filter(s => s.id !== id))
      sessionCacheRef.current.delete(id)
      if (sessionId === id) startNewSession()
    }).catch(() => {})
  }

  const handleDeleteMessage = async (msgId) => {
    if (!confirm('Delete this message?')) return
    // Remove from local state immediately
    setMessages(prev => prev.filter(m => m.id !== msgId && m._localId !== msgId))
    // If it has a real DB id, also delete on server
    if (msgId && typeof msgId === 'number' && msgId > 0) {
      try {
        await api.delete(`/messages/${msgId}`)
      } catch (e) {
        console.warn('Server delete failed (removed from UI only):', e.message)
      }
    }
    message.success('Message deleted')
  }

  const handleExecuteTask = (taskId) => {
    if (!confirm('Execute this scheduled task now?')) return
    setIsLoading(true)
    api.post(`/scheduled-tasks/${taskId}/execute`).then(() => {
      loadSession(`sched-${taskId}`, false)
    }).catch(err => {
      message.error('Execution failed: ' + err.message)
    }).finally(() => setIsLoading(false))
  }

  const handleDeleteTask = (id) => {
    if (!confirm('Delete this scheduled task?')) return
    api.delete(`/scheduled-tasks/${id}`).then(() => {
      setScheduledTasks(prev => prev.filter(t => t.id !== id))
      setSessions(prev => prev.filter(s => s.id !== `sched-${id}`))
      if (sessionId === `sched-${id}`) startNewSession()
    }).catch(err => alert('Failed: ' + err.message))
  }

  const sidebarItems = (sessions || []).filter(s => !s.id.startsWith('sched-')).map(s => ({
    key: s.id,
    icon: <MessageOutlined style={{ fontSize: 13 }} />,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
          {s.title || 'New Chat'}
        </span>
        <Button type="text" size="small" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />}
          onClick={e => handleDeleteSession(e, s.id)}
          style={{ opacity: 0.5, padding: '0 2px', minWidth: 'auto', flexShrink: 0 }}
          className="session-delete-btn"
        />
      </div>
    )
  }))

  const scheduledTaskItems = (scheduledTasks || []).map(t => ({
    key: 'sched-' + t.id,
    icon: <ClockCircleOutlined style={{ fontSize: 13 }} />,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }} title={t.taskGoal}>
          {t.taskGoal || 'Scheduled Task'}
        </span>
        <Space size={0} className="session-actions" style={{ flexShrink: 0 }}>
          <Button type="text" size="small" icon={<ThunderboltOutlined style={{ fontSize: 11 }} />}
            onClick={e => { e.stopPropagation(); handleExecuteTask(t.id) }}
            style={{ opacity: 0.7, padding: '0 4px', minWidth: 'auto', color: '#1677ff' }}
            title="Execute Now"
          />
          <Button type="text" size="small" danger icon={<DeleteOutlined style={{ fontSize: 11 }} />}
            onClick={e => handleDeleteTask(e, t.id)}
            style={{ opacity: 0.5, padding: '0 4px', minWidth: 'auto' }}
            title="Delete"
          />
        </Space>
      </div>
    )
  }))

  const activeScheduledTask = sessionId?.startsWith('sched-') ? scheduledTasks.find(t => 'sched-' + t.id === sessionId) : null;

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 8, colorBgContainer: '#161616', colorBgElevated: '#1a1a1a', colorBorder: '#2a2a2a' },
        components: {
          Layout: { siderBg: '#111', headerBg: '#111', bodyBg: '#0d0d0d' },
          Menu: { darkItemBg: '#111', darkSubMenuItemBg: '#111', itemHeight: 36 },
        }
      }}
      locale={i18n.language === 'en-US' ? enUS : zhCN}
    >
      <Modal
        title="Desktop Client Required"
        open={false} /* was: localAgentStatus === 'missing' */
        closable={true}
        onCancel={() => setLocalAgentStatus('ok')}
        footer={[
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={() => {
            const backendHost = window.localStorage.getItem('backend_host') || import.meta.env.VITE_BACKEND_HOST || `${window.location.hostname}:8000`;
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.toLowerCase().indexOf('mac') >= 0;
            const os = isMac ? 'mac' : 'win';
            window.open(`http://${backendHost}/api/frontend/update/download?os=${os}`, '_blank');
          }}>
            Download Desktop Client
          </Button>
        ]}
      >
        <p>You are running the web version of AutoBot, but the <strong>Desktop Client</strong> was not detected.</p>
        <p>Some features like local file editing, command execution, and database direct connections require the Desktop Client to be running on your machine.</p>
        <p><strong>Instructions:</strong></p>
        <ol>
          <li>Click the button below to download the AutoBot Desktop Client installation package.</li>
          <li>Extract or install the downloaded file to your preferred directory.</li>
          <li>Run the AutoBot application to start the client.</li>
          <li>The client will automatically start the local agent and connect to the system.</li>
        </ol>
      </Modal>

      {updateAvailable && (
        <div style={{ 
          background: '#1677ff', 
          color: 'white', 
          padding: '10px 20px', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          gap: '20px',
          zIndex: 1000
        }}>
          <span>
            <ThunderboltOutlined style={{ marginRight: 8 }} />
            New frontend version available: v{updateAvailable.version} (Current: v{import.meta.env.VITE_APP_VERSION || '1.0.0'})
          </span>
          <Space>
            <Button size="small" type="primary" style={{ background: '#fff', color: '#1677ff', border: 'none' }} loading={updating} onClick={handleUpdateFrontend}>
              Update Now
            </Button>
            <Button size="small" type="text" onClick={() => setUpdateAvailable(null)} style={{ color: 'white', background: 'rgba(255,255,255,0.2)' }}>
              Ignore
            </Button>
          </Space>
        </div>
      )}
      <Layout style={{ height: updateAvailable ? 'calc(100vh - 44px)' : '100vh', overflow: 'hidden' }}>
        {/* ── Sidebar ── */}
        <Sider
          collapsible collapsed={siderCollapsed} onCollapse={setSiderCollapsed}
          trigger={null} width={240} collapsedWidth={0}
          style={{ background: '#111', borderRight: '1px solid #1f1f1f', overflow: 'hidden' }}
>
          <SessionSidebar
            sessions={sessions}
            scheduledTasks={scheduledTasks}
            sessionId={sessionId}
            activeTab={activeTab}
            siderCollapsed={siderCollapsed}
            startNewSession={startNewSession}
            loadSession={loadSession}
            setActiveTab={setActiveTab}
            handleDeleteSession={handleDeleteSession}
            handleExecuteTask={handleExecuteTask}
            handleDeleteTask={handleDeleteTask}
            user={user}
            logout={logout}
            setShowSettings={setShowSettings}
            setShowUsersManagement={setShowUsersManagement}
            setShowCompanyManagement={setShowCompanyManagement}
          />
        </Sider>

        {/* ── Main ── */}
        <Layout style={{ background: '#0d0d0d' }}>
          {/* Header */}
          <Header style={{
            background: '#111', borderBottom: '1px solid #1f1f1f', padding: '0 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52
          }}>
            <Space>
              <Button type="text" icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSiderCollapsed(!siderCollapsed)}
                style={{ color: '#888' }} />
              <Text style={{ color: '#888', fontSize: 14 }}>
                {activeTab === 'documents' ? t('nav.companyDocuments') : activeTab === 'sales_orders' ? '销售单管理' : activeTab === 'purchase_orders' ? '采购单管理' : activeTab === 'reconciliations' ? '对账单管理' : activeTab === 'erp' ? t('erp.dataManagement') : activeTab === 'outbound_orders' ? t('erp.outboundOrders') : activeTab === 'inbound_orders' ? t('erp.inboundOrders') : activeTab === 'parts' ? t('erp.parts') : activeTab === 'customers' ? t('erp.customers') : activeTab === 'suppliers' ? t('erp.suppliers') : activeTab === 'customer_part_mappings' ? '客户料号映射' : activeTab === 'import_product_relation' ? '导入产品关系' : activeTab === 'dashboard' ? t('erp.dashboard') : activeTab === 'databases' ? t('nav.databases') : activeTab === 'monitor' ? 'autobot-monitor' : (sessions.find(s => s.id === sessionId)?.title || t('nav.newChat'))}
              </Text>
              {activeTab === 'chat' && sessions.find(s => s.id === sessionId)?.channel === 'code' && workspaceDir && (
                <Tag 
                  icon={<FolderOpenOutlined />} 
                  style={{ fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
                  onClick={() => {
                    setIsChangingWorkspace(true)
                    setWsPickerChannel('code')
                    setShowWsPicker(true)
                    loadWsBrowse(workspaceDir)
                  }}
                >
                  📁 {workspaceDir.length > 40 ? '...' + workspaceDir.slice(-40) : workspaceDir}
                </Tag>
              )}
            </Space>
            {activeTab === 'chat' && (
              <Space>
                <Tooltip title={liveLogActive ? (showLogs ? 'Hide live logs' : 'Show live logs') : 'No active logs'}>
                  <Button type="text" icon={<CodeOutlined />}
                    onClick={() => setShowLogs(!showLogs)}
                    style={{ color: showLogs && liveLogActive ? '#1677ff' : '#888' }}
                    disabled={!liveLogActive} />
                </Tooltip>
                </Space>
            )}
            <Dropdown menu={{
              items: [
                { key: 'zh-CN', label: '中文', onClick: () => { i18n.changeLanguage('zh-CN'); localStorage.setItem('autobot_lang', 'zh-CN'); } },
                { key: 'en-US', label: 'English', onClick: () => { i18n.changeLanguage('en-US'); localStorage.setItem('autobot_lang', 'en-US'); } },
              ],
              selectedKeys: [i18n.language]
            }}>
              <Tooltip title={t('language.switchTo')}>
                <Button type="text" icon={<GlobalOutlined />} style={{ color: '#888' }} />
              </Tooltip>
            </Dropdown>
          </Header>

          {/* Content Area */}
          {activeTab === 'documents' ? (
            <Documents user={user} companies={companies} users={users} />
          ) : activeTab === 'dashboard' ? (
            <StockDashboard user={user} companies={companies} />
          ) : activeTab === 'inbound_orders' ? (
            <InboundOrderManagement user={user} companies={companies} />
          ) : activeTab === 'outbound_orders' ? (
            <OutboundOrderManagement user={user} companies={companies} />
          ) : activeTab === 'parts' ? (
            <PartManagement user={user} companies={companies} />
          ) : activeTab === 'customers' ? (
            <CustomerManagement user={user} companies={companies} />
          ) : activeTab === 'suppliers' ? (
            <SupplierManagement user={user} companies={companies} />
          ) : activeTab === 'customer_part_mappings' ? (
            <CustomerPartMappingManagement user={user} companies={companies} />
          ) : activeTab === 'import_product_relation' ? (
            <ImportProductRelation user={user} companies={companies} />
          ) : activeTab === 'sales_orders' ? (
            <SalesOrderManagement user={user} companies={companies} />
          ) : activeTab === 'purchase_orders' ? (
            <PurchaseOrderManagement user={user} companies={companies} />
          ) : activeTab === 'reconciliations' ? (
            <ReconciliationManagement user={user} companies={companies} />
          ) : activeTab === 'erp' ? (
            <ErpManagement user={user} companies={companies} />
          ) : activeTab === 'inventory' ? (
            <InventoryManagement user={user} companies={companies} />
          ) : activeTab === 'audit_logs' ? (
            <AuditLogManagement user={user} />
          ) : activeTab === 'databases' ? (
              <DatabaseManagement dbConfigs={dbConfigs} fetchDbConfigs={fetchDbConfigs} onAddDbConfig={addDbConfig} onUpdateDbConfig={updateDbConfig} user={user} />
          ) : activeTab === 'monitor' && isSuperAdmin ? (
            <Content style={{ background: '#0d0d0d', overflow: 'auto' }}>
              <MonitorPanel />
            </Content>
          ) : (

          <Layout style={{ background: '#0d0d0d', overflow: 'hidden', flexDirection: 'row', position: 'relative' }}>
            {/* Chat area */}
            <Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
              {/* Messages */}
              {messages.length === 0 ? (
                <div style={{ flex: 1, overflow: 'auto', padding: '24px 0' }} className="custom-scrollbar">
                  <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px' }}>
                    {isLoading ? (
                      <SessionSkeleton />
                    ) : activeScheduledTask ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#444' }}>
                        <ClockCircleOutlined style={{ fontSize: 48, marginBottom: 16, color: '#1677ff', opacity: 0.6 }} />
                        <Title level={4} style={{ color: '#666', margin: 0 }}>Waiting for the first execution...</Title>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#444' }}>
                        <ThunderboltOutlined style={{ fontSize: 48, marginBottom: 16, color: '#1677ff', opacity: 0.6 }} />
                        <Title level={4} style={{ color: '#666', margin: 0 }}>{t('chat.greeting')}</Title>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, padding: '24px 0' }}>
                  <Virtuoso
                    style={{ height: '100%' }}
                    className="custom-scrollbar"
                    totalCount={messages.length}
                    followOutput="smooth"
                    increaseViewportBy={{ top: 200, bottom: 200 }}
                    itemContent={(index) => {
                      const msg = messages[index]
                      return (
                        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px' }}>
                          <MessageBubble msg={msg} onDelete={() => handleDeleteMessage(msg.id || msg._localId)} />
                        </div>
                      )
                    }}
                    components={{
                      Header: () => isParsingHistory && !isLoading ? (
                        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px' }}>
                          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                            <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
                            <div>
                              <Text style={{ color: '#888', fontSize: 12, display: 'block', marginBottom: 6 }}>AutoBot</Text>
                              <Space style={{ color: '#888' }}>
                                <LoadingOutlined spin />
                                <Text style={{ color: '#888', fontSize: 13 }}>Parsing session history...</Text>
                              </Space>
                            </div>
                          </div>
                        </div>
                      ) : null,
                      Footer: () => isLoading && messages.length > 0 ? (
                        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px' }}>
                          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                            <Avatar icon={<RobotOutlined />} size={32} style={{ background: '#1677ff', flexShrink: 0 }} />
                            <div>
                              <Text style={{ color: '#888', fontSize: 12, display: 'block', marginBottom: 6 }}>AutoBot</Text>
                              <Space style={{ color: '#888' }}>
                                <LoadingOutlined spin />
                                <Text style={{ color: '#888', fontSize: 13 }}>Thinking...</Text>
                              </Space>
                            </div>
                          </div>
                        </div>
                      ) : null,
                    }}
                  />
                </div>
              )}

              {/* Input */}
              {activeScheduledTask ? (
                <div style={{ padding: '16px 24px', background: '#111', borderTop: '1px solid #1a1a1a', display: 'flex', justifyContent: 'center' }}>
                  <div style={{ maxWidth: 760, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1a1a1a', padding: '12px 24px', borderRadius: 12, border: '1px solid #2a2a2a' }}>
                    <Space size="large">
                      <div>
                        <Text style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Frequency</Text>
                        {editingTask === activeScheduledTask.id ? (
                          <Select
                            size="small"
                            value={editTaskData.scheduleType}
                            onChange={(val) => setEditTaskData(prev => ({ ...prev, scheduleType: val }))}
                            options={[
                              { value: 'daily', label: 'Daily' },
                              { value: 'weekly', label: 'Weekly' },
                              { value: 'monthly', label: 'Monthly' },
                            ]}
                            style={{ width: 100 }}
                          />
                        ) : (
                          <Text style={{ color: '#e3e3e3', fontSize: 14 }}>{activeScheduledTask.scheduleType === 'daily' ? 'Daily' : activeScheduledTask.scheduleType === 'weekly' ? 'Weekly' : 'Monthly'}</Text>
                        )}
                      </div>
                      <div>
                        <Text style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Time</Text>
                        {editingTask === activeScheduledTask.id ? (
                          <TimePicker
                            size="small"
                            format="HH:mm"
                            value={editTaskData.scheduleTime ? dayjs(editTaskData.scheduleTime, 'HH:mm') : null}
                            onChange={(time, timeString) => setEditTaskData(prev => ({ ...prev, scheduleTime: timeString }))}
                            style={{ width: 90 }}
                          />
                        ) : (
                          <Text style={{ color: '#e3e3e3', fontSize: 14 }}>{activeScheduledTask.scheduleTime}</Text>
                        )}
                      </div>
                      <div>
                        <Text style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Execution Count</Text>
                        <Text style={{ color: '#e3e3e3', fontSize: 14 }}>{messages.filter(m => m.role === 'user').length}</Text>
                      </div>
                      <div>
                        <Text style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase' }}>Created At</Text>
                        <Text style={{ color: '#e3e3e3', fontSize: 14 }}>{new Date(activeScheduledTask.createdAt).toLocaleString()}</Text>
                      </div>
                    </Space>
                    <Space>
                      <Tag color="blue" style={{ margin: 0, border: 'none', background: '#1677ff22', color: '#1677ff' }}>Active</Tag>
                      {editingTask === activeScheduledTask.id ? (
                        <Space>
                          <Button size="small" onClick={cancelEditTask}>Cancel</Button>
                          <Button type="primary" size="small" onClick={saveEditedTask} loading={isLoading}>Save</Button>
                        </Space>
                      ) : (
                        <Button type="default" size="small" icon={<EditOutlined />} onClick={handleEditTask}>
                          Edit
                        </Button>
                      )}
                      <Button type="primary" size="small" icon={<ThunderboltOutlined />} loading={isLoading} onClick={() => executeScheduledTaskNow(activeScheduledTask.id)}>
                        Execute Now
                      </Button>
                    </Space>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '12px 24px 20px', background: '#0d0d0d', borderTop: '1px solid #1a1a1a' }}>
                  <div style={{ maxWidth: 760, margin: '0 auto' }}>
                    <div style={{
                      background: '#1a1a1a', borderRadius: 24, border: '1px solid #2a2a2a',
                      padding: '10px 14px', display: 'flex', alignItems: 'flex-end', gap: 8,
                      transition: 'border-color 0.2s'
                    }}
                      onFocus={e => e.currentTarget.style.borderColor = '#1677ff'}
                      onBlur={e => e.currentTarget.style.borderColor = '#2a2a2a'}
                    >
                      <Tooltip title="Attach image or document">
                        <Button type="text" icon={<PaperClipOutlined />}
                          onClick={() => fileInputRef.current?.click()}
                          style={{ color: '#666', padding: '4px 6px' }} />
                      </Tooltip>
                      <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,.dxf,.dwg,.step,.stp,.iges,.igs" />

                      {selectedImage && (
                        <div style={{ display: 'flex', alignItems: 'center', background: '#333', padding: '2px 8px', borderRadius: 4, marginRight: 8, gap: 4 }}>
                          <FileImageOutlined style={{ color: '#13c2c2', fontSize: 12 }} />
                          <Text style={{ color: '#e3e3e3', fontSize: 12, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedImage}</Text>
                          <CloseOutlined style={{ fontSize: 10, color: '#999', cursor: 'pointer' }} onClick={() => { setSelectedImage(null); setSelectedImageBase64(null); }} />
                        </div>
                      )}

                      {uploadedDocuments.map((doc, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', background: '#333', padding: '2px 8px', borderRadius: 4, marginRight: 8, gap: 4 }}>
                          <FileTextOutlined style={{ color: '#1677ff', fontSize: 12 }} />
                          <Text style={{ color: '#e3e3e3', fontSize: 12, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</Text>
                          <CloseOutlined style={{ fontSize: 10, color: '#999', cursor: 'pointer' }} onClick={() => { setUploadedDocuments(prev => prev.filter(d => d.id !== doc.id)); }} />
                        </div>
                      ))}

                      <TextArea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onCompositionStart={() => { window.__imeComposing = true }}
                        onCompositionEnd={() => { window.__imeComposing = false }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            if (window.__imeComposing || e.nativeEvent.isComposing) return
                            e.preventDefault()
                            sendMessage()
                          }
                        }}
                        placeholder="Ask AutoBot... (Shift+Enter to break line)"
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        style={{ background: 'transparent', border: 'none', color: '#e3e3e3', resize: 'none', flex: 1, padding: '4px 0', fontSize: 14 }}
                        variant="borderless"
                      />

                      <Space style={{ paddingBottom: 2 }}>
                        <Tooltip title={isRecording ? 'Stop recording' : 'Voice input'}>
                          <Button type="text"
                            icon={isRecording ? <StopOutlined style={{ color: '#ff4d4f' }} /> : <AudioOutlined />}
                            onClick={isRecording ? stopRecording : startRecording}
                            style={{ color: isRecording ? '#ff4d4f' : '#666', padding: '4px 6px' }} />
                        </Tooltip>
                        {(input.trim() || selectedImageBase64) && (
                          <Button type="primary" shape="circle" icon={<SendOutlined />}
                            onClick={() => sendMessage()} size="small" />
                        )}
                      </Space>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 8, color: '#444', fontSize: 11 }}>
                      AutoBot may make mistakes. Verify important information.
                    </div>
                  </div>
                </div>
              )}
            </Content>

            {/* Log Panel */}
            {showLogs && liveLogActive && (
              <LogPanel isOpen={showLogs} onClose={() => setShowLogs(false)} localTerminalOutput={localTerminalOutput} />
            )}
          </Layout>
          )}
        </Layout>
      </Layout>

      {/* ── Workspace Directory Picker for Code Sessions ── */}
      <Modal
        title="选择项目目录"
        open={showWsPicker}
        onCancel={() => { setShowWsPicker(false); setWsPickerChannel(null); setIsChangingWorkspace(false) }}
        footer={[
          <Button key="cancel" onClick={() => { setShowWsPicker(false); setWsPickerChannel(null); setIsChangingWorkspace(false) }}>取消</Button>,
          <Button key="ok" type="primary" onClick={() => {
            if (isChangingWorkspace) {
              changeWorkspaceDir(wsBrowsePath)
            } else {
              createSessionDirect(wsPickerChannel, wsBrowsePath)
            }
            setShowWsPicker(false)
            setIsChangingWorkspace(false)
          }}>选择此目录</Button>
        ]}
        width={500}
      >
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
          当前路径: <Text code style={{ fontSize: 11 }}>{wsBrowsePath}</Text>
        </div>
        <Space style={{ marginBottom: 8 }}>
          <Button size="small" icon={<HomeOutlined />} onClick={() => loadWsBrowse(getDefaultWorkspaceDir())}>
            {isWindows() ? '用户目录' : '项目根'}
          </Button>
          {isWindows() ? (
            <>
              <Button size="small" onClick={() => loadWsBrowse('')}>磁盘根目录</Button>
              {wsDriveEntries.map(entry => (
                <Button key={entry.path} size="small" onClick={() => loadWsBrowse(entry.path)}>
                  {entry.name}
                </Button>
              ))}
            </>
          ) : (
            <>
              <Button size="small" onClick={() => loadWsBrowse('/Users')}>/Users</Button>
              <Button size="small" onClick={() => loadWsBrowse('/')}>/ (根)</Button>
            </>
          )}
        </Space>
        <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #333', borderRadius: 4, background: '#141414' }}>
          {wsBrowseLoading ? <Spin size="small" style={{padding:20}} /> : (
            <List
              size="small"
              dataSource={wsBrowseEntries}
              renderItem={item => (
                <List.Item
                  onClick={() => { if (item.isDir) loadWsBrowse(item.path) }}
                  style={{ cursor: 'pointer', padding: '4px 12px', borderBottom: '1px solid #1a1a1a', color: '#ccc', fontSize: 12 }}
                >
                  <Space>
                    <FolderOpenOutlined style={{color:'#faad14'}} />
                    <span>{item.name}</span>
                    {!item.isDir && <Text style={{color:'#666',fontSize:10}}>文件</Text>}
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
      </Modal>

      <CompanyManagement
        open={showCompanyManagement}
        onClose={() => setShowCompanyManagement(false)}
        companies={companies}
        onAddCompany={addCompany}
        onUpdateCompany={updateCompany}
        onDeleteCompany={deleteCompany}
      />

      <UsersManagementModal
        open={showUsersManagement}
        onClose={() => setShowUsersManagement(false)}
        users={users}
        companies={companies}
        onAddUser={addUser}
        onDeleteUser={deleteUser}
        onApproveUser={approveUser}
        onRejectUser={rejectUser}
        user={user}
      />

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onToggleSkill={toggleSkill}
        companies={companies}
        onAddCompany={addCompany}
        onUpdateCompany={updateCompany}
        onDeleteCompany={deleteCompany}
        users={users}
        onAddUser={addUser}
        onDeleteUser={deleteUser}
        onUpdateUser={updateUser}
      />
      <DocumentPreviewModal />
    </ConfigProvider>
  )
}

export default App
