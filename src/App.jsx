import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  Layout, Menu, Button, Input, Avatar, Typography, Space, Tooltip,
  Modal, Form, Tabs, Tag, Dropdown, Divider, ConfigProvider, theme, Badge, Select, InputNumber, TimePicker, message, Checkbox,
  List, Spin, Drawer, Segmented, Grid
} from 'antd'
import dayjs from 'dayjs'
import {
  SendOutlined, PlusOutlined, SettingOutlined, DeleteOutlined,
  MessageOutlined, LogoutOutlined,
  CheckCircleOutlined, SyncOutlined, PlayCircleOutlined,
  CodeOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RobotOutlined, BarsOutlined,
  StopOutlined, LoadingOutlined, ThunderboltOutlined, UserOutlined, TeamOutlined,
  DownOutlined, RightOutlined, CheckOutlined, EditOutlined, ClockCircleOutlined,
  FileTextOutlined, PaperClipOutlined, CloseOutlined, FileImageOutlined, DownloadOutlined, DatabaseOutlined, GlobalOutlined,
  FolderOpenOutlined, HomeOutlined, SearchOutlined, ShopOutlined,
  ApartmentOutlined, MenuOutlined
} from '@ant-design/icons'
import api, { logout, isAuthenticated, getCurrentUser, fetchMe, getWsBaseUrl, getLocalAgentBaseUrl, getBackendHost } from './auth'
import Login from './Login'
import HomeWrapper from './Home'
import LogPanel from './LogPanel'
import PlanView from './PlanView'
import MonitorPanel from './components/MonitorPanel'
import Documents from './Documents'
import DatabaseManagement from './DatabaseManagement'
import ErpManagement from './ErpManagement'
import ErpMetadataManagement from './ErpMetadataManagement'
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
import RecycleBinManagement from './RecycleBinManagement'
import CompanyManagement from './CompanyManagement'
import InventoryManagement from './InventoryManagement'
import ProfitAnalysis from './ProfitAnalysis'
import AuditLogManagement from './AuditLogManagement'
import PlanLearningManagement from './PlanLearningManagement'
import CrmCustomerManagement from './CrmCustomerManagement'
import CrmContactManagement from './CrmContactManagement'
import CrmLeadManagement from './CrmLeadManagement'
import CrmOpportunityManagement from './CrmOpportunityManagement'
import CrmContractManagement from './CrmContractManagement'
import CrmPaymentPlanManagement from './CrmPaymentPlanManagement'
import CrmPaymentRecordManagement from './CrmPaymentRecordManagement'
import CrmFollowUpManagement from './CrmFollowUpManagement'
import DocumentPreviewModal from './DocumentPreviewModal'
import SessionSidebar from './components/SessionSidebar'
import { executeAgentCommands, appendStreamToken, tryStreamDispatch, resetStreamBuffer } from './components/WorkspacePanel'
import MessageBubble from './components/MessageBubble'
import IssuesSidePanel from './components/IssuesSidePanel'
import InteractivePanel from './components/InteractivePanel'
import OrderFormModal from './components/OrderFormModal'
import ErpQuickActions from './components/ErpQuickActions'
import CrmQuickActions from './components/CrmQuickActions'
import PlanPreviewCard from './components/PlanPreviewCard'
import ClarifyQuestionModal from './components/ClarifyQuestionModal'
import ResultExplanationCard from './components/ResultExplanationCard'
import ParamSourceCard from './components/ParamSourceCard'
import CrossDomainEntityCard from './components/CrossDomainEntityCard'
import GraphStatusPanel from './components/GraphStatusPanel'
import LspSettingsPanel from './components/LspSettingsPanel'
import McpSettingsPanel from './components/McpSettingsPanel'
import CodeGraphExplorer from './components/CodeGraphExplorer'
import CodePreviewDrawer from './components/CodePreviewDrawer'
import IntentCorrectionFloater from './components/IntentCorrectionFloater'
import ReVerifyProgressToast from './components/ReVerifyProgressToast'
import AcademicResearchPage from './AcademicResearchPage'
import AcademicStatsPage from './AcademicStatsPage'
import NovelPage from './NovelPage'
import StockMonitorPage from './StockMonitorPage'
import TranslationCheckPage from './TranslationCheckPage'
import LlmManagement from './LlmManagement'
import { useUserStore } from './store/useUserStore'
import { useDataStore } from './store/useDataStore'
import { useConfigStore } from './store/useConfigStore'
import { useUIStore } from './store/useUIStore'
import ThemeSwitcher from './components/ThemeSwitcher'
import { THEMES, getThemeId, getTheme, initTheme } from './themes'
import { useTranslation } from 'react-i18next'
import { probeToolchain, getClientInfo, clearToolchainCache } from './utils/probeTools'
import zhCN from 'antd/es/locale/zh_CN'
import enUS from 'antd/es/locale/en_US'
import { Virtuoso } from 'react-virtuoso'
import { extractTrailingStateJson, stripAgentMarkers, tryParseAnalysisResult, getLastParseError, decodeStateStringList, replaceTrailingAnalysisState, mergeAnalysisStateContent, extractAnalysisState } from './utils/helpers.jsx'
import { createHealthPoller, probeHttp } from './utils/healthPoller.js'
import { getTaskTypeByChannel, CHANNELS_BY_KEY, CHANNELS as ALL_CHANNELS, LEGACY_BUSINESS_CHANNELS, detectDomainFromInput, isBusinessChannel } from './constants/taskTypes.jsx'
import { isSuperAdmin as isSuperAdminFn, isCompanyAdmin as isCompanyAdminFn } from './utils/permissions.js'

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

function extractCommandSignature(content) {
  if (!content || typeof content !== 'string' || !content.includes('__CMD__{')) return ''
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

// ── Users Management Modal ───────────────────────────────────────────────────
function UsersManagementModal({ open, onClose, users, companies, onAddUser, onDeleteUser, onApproveUser, onRejectUser, user }) {
  const { t } = useTranslation()
  const [userForm] = Form.useForm()
  const isSuperAdmin = isSuperAdminFn(user)
  const isCompanyAdmin = isCompanyAdminFn(user)
  
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
      styles={{ body: { background: '#181613', padding: '24px' }, header: { background: '#181613', borderBottom: '1px solid #2a2620', padding: '16px 24px' } }}
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
            <Input placeholder="Username" style={{ background: '#0e0e0e', borderColor: '#2a2620', color: '#e8e3d8' }} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Form.Item name="password" rules={[{ required: true, message: 'Please input password' }, { min: 6, message: 'Password must be at least 6 characters' }]} style={{ flex: 1 }}>
            <Input.Password placeholder="Password" style={{ background: '#0e0e0e', borderColor: '#2a2620', color: '#e8e3d8' }} />
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
            <Input.Password placeholder="Confirm Password" style={{ background: '#0e0e0e', borderColor: '#2a2620', color: '#e8e3d8' }} />
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
  { key: 'general', label: '普通会话', desc: '通用AI助手', icon: <MessageOutlined /> },
  { key: 'document_qa', label: '文档问答', desc: '基于知识库的文档检索问答', icon: <SearchOutlined /> },
  { key: 'code', label: '代码任务', desc: '代码分析/生成/审查', icon: <CodeOutlined /> },
  { key: 'document_generation', label: '文档生成', desc: '创建文档/报告', icon: <FileTextOutlined /> },
  { key: 'cross', label: 'ERP/CRM 业务', desc: '进销存 + 客户关系管理', icon: <ShopOutlined /> },
  { key: 'database_analysis', label: '数据库分析', desc: '查询公司数据库', icon: <DatabaseOutlined /> },
]

function SettingsModal({ open, onClose, user, dbConfigs, onDeleteDbConfig, onAddDbConfig, onUpdateDbConfig, skills, onToggleSkill, companies, onAddCompany, onUpdateCompany, onDeleteCompany, users, onAddUser, onDeleteUser, onUpdateUser }) {
  const { t } = useTranslation()
  const isSuperAdmin = isSuperAdminFn(user)
  const isCompanyAdmin = isCompanyAdminFn(user)
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
            <Input disabled placeholder="Username" style={{ background: '#0e0e0e', borderColor: '#2a2620', color: '#807a6e' }} />
          </Form.Item>
          <Form.Item name="password" label={<span style={{ color: '#e3e3e3' }}>New Password</span>} rules={[{ min: 6, message: 'Password must be at least 6 characters' }]}>
            <Input.Password placeholder="Leave blank to keep current password" style={{ background: '#0e0e0e', borderColor: '#2a2620', color: '#e8e3d8' }} />
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
            <Input.Password placeholder="Confirm New Password" style={{ background: '#0e0e0e', borderColor: '#2a2620', color: '#e8e3d8' }} />
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
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: 10, background: '#161613', borderRadius: 3, border: '1px solid #2a2620' }}>
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
                          // Phase 4 兼容: 旧 erp/crm 显示为 cross label
                          const normalizedCh = LEGACY_BUSINESS_CHANNELS.includes(ch) ? 'cross' : ch
                          const def = ALL_CHANNELS.find(d => d.key === normalizedCh)
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
              <Input placeholder="Company Name" style={{ background: '#0e0e0e', borderColor: '#2a2620', color: '#e8e3d8' }} />
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
              <div key={db.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: 10, background: '#161613', borderRadius: 3, border: '1px solid #2a2620' }}>
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
      <div style={{ marginTop: 24 }}>
        <McpSettingsPanel />
      </div>
      <div style={{ marginTop: 16 }}>
        <LspSettingsPanel />
      </div>
    </Modal>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const { t, i18n } = useTranslation()
  // ── Responsive breakpoint ──
  // md ≥ 768px. On screens below md we switch Sider/right panel to Drawers.
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
  const {
    user, setUser,
    companies, setCompanies,
    users, setUsers,
    companyChannels, setCompanyChannels
  } = useUserStore()
  const {
    dbConfigs, setDbConfigs,
    skills, setSkills
  } = useDataStore()
  const {
    localAgentStatus, setLocalAgentStatus
  } = useConfigStore()
  const {
    siderCollapsed, setSiderCollapsed,
    showLogs, setShowLogs,
    showSettings, setShowSettings,
    showUsersManagement, setShowUsersManagement,
    showCompanyManagement, setShowCompanyManagement
  } = useUIStore()

  const isSuperAdmin = isSuperAdminFn(user)

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
  // S6: 意图纠正浮层状态
  const [intentFloater, setIntentFloater] = useState({ open: false, query: '', predicted: '' })
  // 路线 B: re-verify 模式右下角 toast 开关 (命中"是否修复"语义 + 提交成功后置 true)
  const [reVerifyToastEnabled, setReVerifyToastEnabled] = useState(false)
  const lastUserQueryRef = useRef('')
  // P0-4: 结构化恢复协议 — clarify/pause 恢复时携带 resumeContext + clarifyResponse
  const pendingResumeRef = useRef(null)
  const msgIdCounter = useRef(Date.now())
  const nextMsgId = () => { msgIdCounter.current += 1; return msgIdCounter.current }
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState('')
  // A 方案：code 会话不再需要 'plan'/'build' 二选 toggle；'auto' 表示由后端自动推断。
  // 保留 codeMode 状态变量是为未来可能的"高级用户强制锁定"留口子（UI 已不再暴露）。
  const [codeMode, setCodeMode] = useState('auto')  // 'auto' (默认) | 'plan' (强制只分析) | 'build' (强制实施)
  const [isLoading, setIsLoading] = useState(false)
  const [workspaceDir, setWorkspaceDir] = useState('')
  const [showWsPicker, setShowWsPicker] = useState(false)
  const [wsPickerChannel, setWsPickerChannel] = useState(null)
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false)
  // 阶段5: ERP 订单表单弹窗 (收到 reply_context.formSpec 时弹出)
  const [orderFormOpen, setOrderFormOpen] = useState(false)
  const [orderFormSpec, setOrderFormSpec] = useState(null)
  const [orderFormHint, setOrderFormHint] = useState('')
  // Phase 4: 结构化澄清 / 执行前预览 (pause/clarify 承接)
  const [pendingPause, setPendingPause] = useState(null)   // {preview, reason, sessionId}
  const [pendingClarify, setPendingClarify] = useState(null) // {clarifyQuestion, sessionId}
  const [clarifyLoading, setClarifyLoading] = useState(false)
  const [isResumingCodeSession, setIsResumingCodeSession] = useState(false)
  const [graphDrawerOpen, setGraphDrawerOpen] = useState(false) // P7-6: 会话内图知识库 Drawer
  // 代码预览 Drawer（点击"定位代码" / "Git Diff" 打开）: { open, filePath, line, tab }
  const [codePreview, setCodePreview] = useState({ open: false, filePath: '', line: 0, tab: 'file', titlePrefix: '' })
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
  const [themeId, setThemeId] = useState(getThemeId())
  const [uploadedDocuments, setUploadedDocuments] = useState([])
  const [probeResult, setProbeResult] = useState(null)
  const [currentChannel, setCurrentChannel] = useState('general')
  // C1 (2026-07-14): 粘贴即预览 — 检测输入框中的表格形态, 提示用户声明意图
  const [pasteTableInfo, setPasteTableInfo] = useState(null)

  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedImageBase64, setSelectedImageBase64] = useState(null)

  const fileInputRef = useRef(null)
  const chatWsRef = useRef(null)
  const virtuosoRef = useRef(null)

  
  const liveLogActiveRef = useRef(false)

  const sessionCacheRef = useRef(new Map())

  // 2026-07-01: ERP 快速操作标签 — 选中后写到该 state, 不直接发送, 让用户看清再输入.
  // 形状: {key, label, text, category, color, icon, desc} | null
  const [selectedQuickAction, setSelectedQuickAction] = useState(null)
  const chatInputRef = useRef(null)

  // Mobile: auto-close sidebar drawer when session changes (covers startNewSession + loadSession)
  useEffect(() => {
    if (isMobile && sessionId) setMobileSidebarOpen(false)
  }, [sessionId, isMobile])

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

  // Listen for theme changes from ThemeSwitcher
  useEffect(() => {
    const handler = (e) => setThemeId(e.detail)
    window.addEventListener('theme-change', handler)
    initTheme()
    return () => window.removeEventListener('theme-change', handler)
  }, [])

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
      const isSuper = isSuperAdminFn(user)
      const isCompany = isCompanyAdminFn(user)

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

  const handleLoginSuccess = (loginData) => {
    // Save token to localStorage if not already saved
    if (loginData && loginData.token && !localStorage.getItem('token')) {
      localStorage.setItem('token', loginData.token)
    }
    
    // Build user object from login response
    const currentUser = {
      id: loginData?.id,
      username: loginData?.username,
      role: loginData?.role,
      companyId: loginData?.companyId
    }
    
    // Save user info to localStorage
    localStorage.setItem('user', JSON.stringify(currentUser))
    
    // Set user directly in Zustand store
    setUser(currentUser)
    
    // Initialize sessions immediately
    initSessions()
  }

  const initSessions = async () => {
    fetchScheduledTasks()
    try {
      const res = await api.get('/sessions')
      const loaded = res.data.sessions || []
      setSessions(loaded)
      if (loaded.length > 0) loadSession(loaded[0].id)
      // Don't create new session by default - wait for user to click "New Chat"
    } catch (e) {
      if (e.response?.status === 401) { logout(); return }
      setSessions([])
      // Don't create new session by default - wait for user to click "New Chat"
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

                  // 数据/结构分离：完整数据已存入 data-store（IndexedDB + 后端文件），
                  // 这里只把「结构」传给后端/LLM —— 每个子结果集的 id、名称、行数、列、schema。
                  // 不内联完整 rows，避免占用 LLM 上下文空间；UIAgent 通过 stored_id 拉取完整数据渲染。
                  responseDataToBackend = {
                    status: result.status,
                    data: {
                      _meta: {
                        note: 'Multiple result sets have been stored as multiple json files with a manifest.',
                        stored_id: manifestId,
                        manifest_id: manifestId,
                        dataset_count: datasetMetas.length
                      },
                      datasets: datasetMetas.map(m => ({
                        id: m.id,
                        name: m.name,
                        total_rows: m.total_rows,
                        cols: m.cols,
                        schema_injected: m.schema_injected || ''
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
          } else if (data.type === 'REACT_TOOL_CALL') {
            // [P3] ReAct 工具调用进度 - 聚合同一会话内的所有步骤到一条 react_flow 消息
            const iteration = data.iteration ?? 0
            const tool = data.tool || '?'
            const mappedAgent = data.mappedAgent || '?'
            const status = data.status || 'CALLING'
            const input = data.input || ''
            const truncated = input.length > 80 ? input.substring(0, 80) + '...' : input
            const statusIcon = status === 'CALLING' ? '⚙️' : status === 'OK' ? '✅' : status === 'FAILED' ? '❌' : '❓'
            const logLine = `${statusIcon} [ReAct #${iteration + 1}] ${tool} → ${mappedAgent} | ${truncated}\n`
            if (typeof appendLiveLog === 'function') appendLiveLog(logLine)
            setMessages(prev => {
              // 找到同 session 的最后一个 react_flow 消息，没有就新建
              const newMsgs = [...prev]
              let flowIdx = -1
              for (let i = newMsgs.length - 1; i >= 0; i--) {
                if (newMsgs[i].role === 'react_flow') { flowIdx = i; break; }
                // 遇到 user 消息就停（不同 turn）
                if (newMsgs[i].role === 'user') break;
              }
              const newEvent = { tool, mappedAgent, status, iteration, input, logLine, ts: Date.now() }
              if (flowIdx === -1) {
                newMsgs.push({
                  role: 'react_flow',
                  content: 'ReAct 推理中...',
                  events: [newEvent],
                  isActive: status === 'CALLING',
                })
              } else {
                const existing = newMsgs[flowIdx]
                newMsgs[flowIdx] = {
                  ...existing,
                  events: [...(existing.events || []), newEvent],
                  isActive: status === 'CALLING' || existing.isActive,
                }
              }
              return newMsgs
            })
            return  // 短路后面的 plan 消息处理
          } else if (data.type === 'ui_render') {
            const localId = data.id || Date.now()
            setMessages(prev => [...prev, { id: data.id || null, _localId: localId, role: 'ui_render', content: data.message }])
          } else if (data.type === 'AGENT_STREAM' || data.type === 'AGENT_THOUGHT') {
            // Also show stream/thought output in terminal (skip HTML generation streaming)
            if (data.type === 'AGENT_STREAM' && data.token && data.agent !== 'UIAgent') {
              appendLiveLog(data.token)
              // Accumulate tokens for early __CMD__ dispatch
              appendStreamToken(data.token, sessionId)
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
      // 后端返回 ApiResult 信封 { code, message, data: { configs } }
      const configs = res.data?.data?.configs || res.data?.configs || []
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
      return true
    } catch (e) {
      message.error('Failed to delete DB config: ' + (e.response?.data || e.message))
      return false
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
      const loaded = res.data.sessions || []
      
      // Debug: Check for duplicate session IDs
      const idCounts = {}
      loaded.forEach(s => {
        idCounts[s.id] = (idCounts[s.id] || 0) + 1
      })
      const duplicates = Object.entries(idCounts).filter(([id, count]) => count > 1)
      if (duplicates.length > 0) {
        console.error('[App] Duplicate session IDs found:', duplicates)
      }
      
      setSessions(loaded)
      const cur = loaded.find(s => s.id === sessionId)
      if (cur?.channel) setCurrentChannel(cur.channel)
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
      // 2026-07-01: 切换会话时清空已选快速操作标签, 避免上一个会话的标签
      // 误带到新会话的输入框 (chip 残留会误导不同操作的录入).
      setSelectedQuickAction(null)
    }

    // ── Fast path: cache hit ──
    const cached = sessionCacheRef.current.get(id)
    if (cached) {
      if (!isSameSession) setSessionId(id)
      // eslint-disable-next-line no-console
      console.log('[loadSession] CACHE HIT for', id, '— replaying',
        cached.length, 'messages; last id=',
        cached[cached.length - 1]?.id,
        'last meta=',
        (cached[cached.length - 1]?.meta || '').slice(0, 100))
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
      setCurrentChannel(sessionChannel || 'general')
      if (sessionChannel === 'code' && sessionWorkspaceDir) {
        setWorkspaceDir(sessionWorkspaceDir)
        const valid = await validateWorkspaceDir(sessionWorkspaceDir)
        if (!valid) {
          console.warn('[Workspace] Stored workspace is invalid:', sessionWorkspaceDir)
          setWsInvalid(true)
          setIsResumingCodeSession(true)  // 标记: 恢复场景, 选了目录后只补 workspace, 不新建会话
          setWsPickerChannel('code')
          setShowWsPicker(true)
          loadWsBrowse(sessionWorkspaceDir)
        } else {
          setWsInvalid(false)
        }
      } else if (sessionChannel === 'code') {
        // Code session but no workspace set - prompt user to select one
        setWsInvalid(true)
        setIsResumingCodeSession(true)
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
            if (e.data.errors && e.data.errors.length > 0) {
              console.warn('[Worker] messageNormalizer encountered', e.data.errors.length, 'parse issue(s):', e.data.errors)
            }
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
        // eslint-disable-next-line no-console
        console.log('[loadSession] sending', history.length,
          'messages to worker; last id=',
          history[history.length - 1]?.id,
          'last meta=',
          (history[history.length - 1]?.meta || '').slice(0, 100))
        worker.postMessage({ messages: history })
      } else {
        // eslint-disable-next-line no-console
        console.log('[loadSession] setMessages (small history); count=',
          history.length, 'last id=',
          history[history.length - 1]?.id,
          'last meta=',
          (history[history.length - 1]?.meta || '').slice(0, 100))
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
    // Phase 4: 历史 erp/crm channel 自动映射到 cross (已合并)
    let ch = channelType || currentChannel
    if (LEGACY_BUSINESS_CHANNELS.includes(ch)) ch = 'cross'
    setCurrentChannel(ch)
    if (ch === 'code') {
      // 浏览器模式已支持 tree-sitter wasm 解析 (通过本机 agent 读文件),
      // 不再限制 code 任务入口. ParserFactory.create 内部按需选择
      // 桌面壳 LSP / 浏览器 wasm + 本机 agent.
      // 显式清掉恢复标记, 避免上次的 isResumingCodeSession=true 影响本次分流.
      setIsResumingCodeSession(false)
      setIsChangingWorkspace(false)
      setWsPickerChannel(ch)
      setShowWsPicker(true)
      loadWsBrowse(getInitialBrowsePath())
      return
    }
    createSessionDirect(ch)
  }

  // Handle workspace selection without creating new session
  const handleWorkspaceSelect = (newDir) => {
    if (!newDir || newDir === workspaceDir) return
    setWorkspaceDir(newDir)
    setWsInvalid(false)
    // Don't create new session, just update workspace for current session
    syncWorkspaceTreeSilently(newDir, 'workspace-change')
  }

  // 打开代码预览 Drawer（定位代码 / 查看 Git Diff）。
  // filePath 为 issue.filePath（相对路径），由 Drawer 结合 workspaceDir 解析。
  const openCodePreview = useCallback((filePath, line, tab = 'file', titlePrefix = '') => {
    if (!filePath) return
    setCodePreview({ open: true, filePath, line: line || 0, tab, titlePrefix })
  }, [])

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
    const parseErrors = []
    try {
      const stateJson = extractTrailingStateJson(msg.content)
      if (stateJson) {
        try {
          state = JSON.parse(stateJson)
        } catch (e) {
          parseErrors.push({ field: 'state', error: 'JSON.parse: ' + e.message })
        }
      }
      const extractErr = getLastParseError()
      if (extractErr) parseErrors.push({ field: 'state', error: extractErr.detail })
    } catch (e) {
      parseErrors.push({ field: 'state', error: 'exception: ' + e.message })
    }
    try {
      analysisResult = tryParseAnalysisResult(msg.content)
      const extractErr = getLastParseError()
      if (extractErr) parseErrors.push({ field: 'analysisResult', error: extractErr.detail })
    } catch (e) {
      parseErrors.push({ field: 'analysisResult', error: 'exception: ' + e.message })
    }
    try {
      displayContent = stripAgentMarkers(msg.content)
    } catch (e) {
      parseErrors.push({ field: 'displayContent', error: 'exception: ' + e.message })
    }
    return { ...msg, __cmd: { state, analysisResult, displayContent, hasCommands: msg.content.includes('__CMD__{'), _parseErrors: parseErrors.length > 0 ? parseErrors : undefined } }
  }

  const syncWorkspaceTreeSilently = async (dirPath, reason = 'auto') => {
    if (!dirPath) return false
    const syncKey = `${sessionId}:${dirPath}`
    // Always sync to ensure backend has the latest snapshot (especially after backend restart)
    // Removed cache check to prevent stale data issues

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
    // [方向 B+C 重构] 根据 channel 自动计算 taskType + subType，对齐后端
    const channelDef = CHANNELS_BY_KEY[ch] || {};
    const sessionMeta = {
      id: newId,
      title: 'New Chat',
      channel: ch,
      taskType: channelDef.taskType || null,
      subType: channelDef.subType || null,
      createdAt: new Date().toISOString()
    };
    setSessions(prev => {
      const withoutTemp = prev.filter(s => s.title !== 'New Chat')
      return [sessionMeta, ...withoutTemp]
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
        const explanation = res.data?.metadata?.explanation
        const paramSources = res.data?.metadata?.paramSources
        const crossDomainEntities = res.data?.metadata?.crossDomainEntities
        const tableData = res.data?.metadata?.tableData
        setMessages(prev => [...prev, normalizeMessage({ role: 'assistant', content: res.data.response, explanation, paramSources, crossDomainEntities, tableData })]);
        fetchSessions();
      } else {
        // 防御性: 与 /chat 同样, message 缺失时回退到 response
        const errMsg = res.data.message || res.data.response || 'Unknown error'
        setMessages(prev => [...prev, { role: 'error', content: `Error: ${errMsg}` }]);
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
      // 2026-07-13: 删除当前会话后, 不再自动调用 startNewSession() 创建新会话
      // (旧逻辑: 删完立即开一个新会话, 体验上像是"删了又补一个"很奇怪)
      // 改为: 清空 sessionId / messages, 关闭 live log, 切回 chat tab
      // currentChannel 保留用户偏好, 后续主动点"新对话"时再创建
      if (sessionId === id) {
        endLiveLogSession()
        setSessionId('')
        setMessages([])
        setActiveTab('chat')
      }
    } catch (e) {}
  }

  // S6: 触发意图纠正浮层。
  // 后端 PlannerService.attachIntentAnalysis 把 taskIntent.name() 写到
  // planData.intent；直接 success 路径有时也会写 res.data.intent。
  // 触发策略：
  //   1. 用户 query 长度 >= 4（避免空 / 标点）
  //   2. 分类结果是 code 会话专用的 CodeSessionIntent（ANALYZE/FIX/BUILD/QUERY）且不是 QUERY
  //      ——QUERY 频率太高（每条自由提问都是），弹浮层没意义
  //   3. 当前浮层未开（避免堆叠）
  //   4. 当前会话不是 code 会话 —— code 任务的意图由后端自行处理, 不再弹纠正浮层
  //      (用户已确认 "全部给后端自行处理" 不必每次确认)
  const maybeShowIntentFloater = (data, queryText, isCodeSess) => {
    try {
      if (!data) return
      if (isCodeSess) return  // code 任务静默, 后端 PlannerService 自己处理 intent 推断 + 执行
      if (intentFloater.open) return
      const predicted = data.intent || (data.plan && data.plan.intent) || (data.plan && data.plan.code_intent)
      if (!predicted) return
      const normalized = String(predicted).toUpperCase()
      // A 方案：code 会话 4 档意图中，ANALYZE/FIX/BUILD 都值得用户确认（避免 LLM 误判改文件），
      // QUERY 频率太高、CONFIRMATION 是系统拦截，CONVERSATIONAL 是闲聊——这三类静默。
      const silent = ['QUERY', 'CONVERSATIONAL', 'CONFIRMATION', 'UNKNOWN']
      if (silent.includes(normalized)) return
      const q = (queryText || lastUserQueryRef.current || '').trim()
      if (q.length < 4) return
      setIntentFloater({ open: true, query: q, predicted: normalized })
    } catch (_) { /* 静默 — 浮层是 best-effort */ }
  }

  // 阶段5: ERP 订单表单弹窗.
  // 后端在 status=clarify 或 success 路径都可能携带 reply_context(JSON),含 formSpec
  // 试图解析 → 若成功,弹 OrderFormModal;否则静默.
  const tryOpenOrderFormModal = (data) => {
    try {
      if (!data || !data.reply_context) return
      const ctx = typeof data.reply_context === 'string'
        ? JSON.parse(data.reply_context) : data.reply_context
      const spec = ctx && ctx.formSpec
      if (!spec || !spec.orderType) return
      setOrderFormSpec(spec)
      setOrderFormHint(data.response || '')
      setOrderFormOpen(true)
    } catch (e) {
      // P2-2: formSpec 解析失败时给用户可见降级提示, 不再仅 console.debug 静默
      console.debug('[OrderFormModal] no formSpec in reply_context:', e?.message)
      message.warning('表单数据解析失败，请从上方表格复制内容补充')
    }
  }

  const closeOrderFormModal = () => {
    setOrderFormOpen(false)
    setOrderFormSpec(null)
    setOrderFormHint('')
  }

  // (2026-07-01: 移除 openOrderFormWithSpec — 快速操作改为 sendText 路径,
  //  不再本地弹空表单. OrderFormModal 仅由 tryOpenOrderFormModal 触发.)

  // 弹窗提交:把填好的内容作为新一条 user message 送回后端
  // (走同一 channel,后端 ERPOrchestrator 会再次接收,此时 op 完整 → 创建成功)
  const submitOrderForm = async (text) => {
    closeOrderFormModal()
    await sendMessage(text)
  }

  /**
   * C1 (2026-07-14): 前端轻量表格形态检测 — 对齐后端 HeaderlessTableAnalyzer 启发.
   * 用于"粘贴即预览": 检测到表格时提示用户点快速操作声明意图, 提升识别成功率.
   * @returns {null | {rows: number, cols: number}} 检测到表格返回行列数, 否则 null
   */
  const detectPastedTable = (text) => {
    if (!text || typeof text !== 'string') return null
    if (text.length > 20000) return null  // 大文本大概率是文档粘贴, 不检测
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
      .filter(l => !/^\|?[\s:|-]+\|?$/.test(l) && !/^[-=]{3,}$/.test(l))  // 跳过 markdown 分隔线
    if (lines.length < 2) return null
    const threshold = Math.max(2, Math.floor(lines.length / 2))
    const tabN = lines.filter(l => l.includes('\t')).length
    const pipeN = lines.filter(l => l.includes('|')).length
    const commaN = lines.filter(l => {
      if (/[，]/.test(l)) return true
      // 排除千分位数字 "198,000" 不算 CSV 分隔 (对齐后端)
      if (/\d,\d{3}/.test(l)) return false
      return l.includes(',')
    }).length
    const spaceN = lines.filter(l => l.split(/\s+/).length >= 3).length
    let cols = 0
    if (tabN >= threshold) cols = Math.max(...lines.filter(l => l.includes('\t')).map(l => l.split('\t').length))
    else if (pipeN >= threshold) cols = Math.max(...lines.filter(l => l.includes('|')).map(l => l.split('|').length))
    else if (commaN >= threshold) cols = Math.max(...lines.filter(l => l.includes(',') || l.includes('，')).map(l => l.split(/[,，]/).length))
    else if (spaceN >= threshold) cols = Math.max(...lines.map(l => l.split(/\s+/).length))
    else return null
    if (cols < 2) return null
    return { rows: lines.length, cols }
  }

  /**
   * 2026-07-01: 处理用户点发送 / 按回车.
   * - 如果 selectedQuickAction 存在: 把"标签 text"作为前缀拼到当前 input 前面, 然后发.
   *   例: selectedQuickAction.text="新建采购单", input="台庆精密... 6 项"
   *       → 发送: "新建采购单\n台庆精密... 6 项"
   *   后端 ERPIntentDetector 看到"新建采购单"立即命中 PURCHASE_ORDER (0 LLM 意图调用).
   * - 发送后清空 selectedQuickAction, 避免下一次发送重复加标签.
   */
  const handleSendWithQuickAction = () => {
    if (selectedQuickAction) {
      const cur = (typeof input === 'string' ? input : '').trim()
      // 如果 text 自带 ":" (如 "新增供应商:") 且 cur 不为空, 用空格分隔让用户内容更自然
      const sep = selectedQuickAction.text.endsWith(':') || selectedQuickAction.text.endsWith('：') ? ' ' : '\n'
      const full = cur ? `${selectedQuickAction.text}${sep}${cur}` : selectedQuickAction.text
      setSelectedQuickAction(null)
      sendMessage(full)
    } else {
      sendMessage(undefined)
    }
  }

  const sendMessage = async (presetText) => {
    let text = typeof presetText === 'string' ? presetText : input;
    if ((!text.trim() && !selectedImageBase64 && uploadedDocuments.length === 0) || isLoading) return

    // Reset the streaming __CMD__ buffer for the new response
    resetStreamBuffer(sessionId)

    // ── Block chat if workspace is invalid for code sessions ──
    const currentSession = sessions.find(s => s.id === sessionId)
    const isCodeSess = currentSession?.channel === 'code' || (!currentSession?.channel && currentChannel === 'code')
    if (isCodeSess && wsInvalid) {
      setIsResumingCodeSession(true)  // 现有 code session 但 workspace 无效, 选目录后只补齐, 不新建
      setWsPickerChannel('code')
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
    // S6: 记录最近一条 user query（供 intent 弹层用）
    lastUserQueryRef.current = text
    
    if (!sessions.find(s => s.id === sessionId)) {
      const currentSession = sessions.find(s => s.id === sessionId)
      const channelToUse = currentSession?.channel || currentChannel
      setSessions(prev => [{ id: sessionId, title: text || selectedImage || (uploadedDocuments.length > 0 ? uploadedDocuments[0].name : 'New Session'), channel: channelToUse, timestamp: new Date().toISOString() }, ...prev])
    }
    try {
      if (isCodeSess && workspaceDir) {
        await syncWorkspaceTreeSilently(workspaceDir, 'before-chat')
      }

      const payload = { message: text, session_id: sessionId };
      // P0-4: 结构化恢复协议 — 携带 resumeContext + clarifyResponse 供后端恢复暂停的计划
      if (pendingResumeRef.current) {
        payload.resume_context = pendingResumeRef.current.resumeContext
        payload.clarify_response = pendingResumeRef.current.clarifyResponse
        pendingResumeRef.current = null
      }
      // A 方案：code 会话意图由后端推断——前端不再发 code_mode（除非用户强制锁定）。
      // 旧 'plan' 锁定可通过 IssuesSidePanel 的修复按钮 + IssuesSidePanel "auto" 模式替代；
      // 旧 'build' 锁定 → 后端会基于 isImplementationContinuation 自动升级。
      if (codeMode && codeMode !== 'auto') payload.code_mode = codeMode;
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
      // S6: 后端在 plan / 直接 response 携带 intent —— 弹纠正浮层
      //     触发条件：用户非确认型 query + 分类结果不是 CONVERSATIONAL
      //     code 任务静默 (isCodeSess=true) —— 后端自行处理 intent 推断, 不弹浮层
      maybeShowIntentFloater(res.data, text, isCodeSess)
      if (res.data.status === 'success') {
        // §9.6 P2-3: 提取结构化结果解释, 附加到消息对象供 ResultExplanationCard 渲染
        const explanation = res.data?.metadata?.explanation
        // §7.6 方案七 (P2): 提取参数来源 + 跨域实体聚合, 供 ParamSourceCard / CrossDomainEntityCard 渲染
        const paramSources = res.data?.metadata?.paramSources
        const crossDomainEntities = res.data?.metadata?.crossDomainEntities
        // P0-4: 提取已抽取参数, 供前端结构化展示/恢复使用
        const extractedParams = res.data?.metadata?.extractedParams
        // 2026-08: ERP 查询结果含 items 明细列时, 后端透传结构化表格数据供可展开表格渲染
        const tableData = res.data?.metadata?.tableData
        setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: res.data.response, explanation, paramSources, crossDomainEntities, extractedParams, tableData })])
        fetchSessions()
        // 阶段5: ERP 订单表单 — 收到 reply_context.formSpec 时弹窗
        tryOpenOrderFormModal(res.data)
        // Agent-driven issue ops: 后端可能在本轮 chat 中执行了 <ISSUE_OP .../>
        // (例如用户说"删除 issue 12, 13" / "把 22 标为已修复"), IssueStore 已被修改.
        // 通知右栏立即刷新一次, 避免等 5s 自适应轮询.
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('agent-issue-ops-applied', {
            detail: { sessionId, source: 'chat' }
          }))
        }
      } else if (res.data.status === 'pause') {
        // Phase 4: HIGH 风险写操作暂停 — 解析 reply_context 中的 planPreview + clarifyQuestion
        let pauseCtx = null
        try {
          pauseCtx = res.data.reply_context ? JSON.parse(res.data.reply_context) : null
        } catch (e) {
          // P2-2: 解析失败给用户可见降级提示, 不再静默
          message.warning('收到暂停确认但上下文解析失败，请按文本提示回复')
        }
        const preview = pauseCtx?.planPreview || null
        const clarifyQuestion = pauseCtx?.clarifyQuestion || null
        // 先把暂停原因作为普通消息展示
        setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: res.data.response || '⚠️ 高风险操作需要确认' })])
        // 弹出结构化确认 UI
        setPendingPause({ preview, clarifyQuestion, reason: res.data.response, sessionId })
      } else if (res.data.status === 'clarify') {
        // Phase 4: 结构化澄清 — 解析 reply_context 中的 clarifyQuestion
        let clarifyCtx = null
        try {
          clarifyCtx = res.data.reply_context ? JSON.parse(res.data.reply_context) : null
        } catch (e) {
          // P2-2: 解析失败给用户可见降级提示, 不再静默
          message.warning('收到澄清请求但上下文解析失败，请按文本提示回复')
        }
        const clarifyQuestion = clarifyCtx?.clarifyQuestion || null
        if (clarifyQuestion) {
          // 有结构化 ClarifyQuestion → 弹出结构化澄清 UI
          setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: res.data.response || clarifyQuestion.question || '请补充信息' })])
          setPendingClarify({ clarifyQuestion, sessionId })
        } else {
          // 无结构化 ClarifyQuestion → 退化为纯文本展示
          setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: res.data.response })])
          fetchSessions()
          tryOpenOrderFormModal(res.data)
        }
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
            const hasCommands = typeof execRes.data.response === 'string' && execRes.data.response.includes('__CMD__{')
            setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: execRes.data.response })])
            setMessages(prev => {
              const newMsgs = [...prev]
              for (let i = newMsgs.length - 1; i >= 0; i--) {
                if (newMsgs[i].role === 'plan') {
                  const newContent = { ...newMsgs[i].content, status: 'executed' }
                  if (!hasCommands && newContent.plan) {
                    newContent.plan = newContent.plan.map(s => ({ ...s, status: 'completed' }))
                  }
                  newMsgs[i] = { ...newMsgs[i], content: newContent }
                  break
                }
              }
              return newMsgs
            })
            fetchSessions()
            // plan execute 也可能产出 <ISSUE_OP .../> (e.g. "把 plan 里的 issue 全标为 in_progress")
            if (typeof window !== 'undefined' && window.dispatchEvent) {
              window.dispatchEvent(new CustomEvent('agent-issue-ops-applied', {
                detail: { sessionId, source: 'plan-execute' }
              }))
            }
          } else {
            setMessages(prev => [...prev, { role: 'error', content: `Error: ${execRes.data.message}` }])
          }
        } catch (err) {
          setMessages(prev => [...prev, { role: 'error', content: `Execution Error: ${err.message}` }])
        }
      } else {
        // 防御性: 部分后端路径(如 ERP 旧版)只填 response 不填 message.
        // 优先用 message, 回退到 response, 最后兜底为 'Unknown error'.
        const errMsg = res.data.message || res.data.response || 'Unknown error'
        setMessages(prev => [...prev, { role: 'error', content: `Error: ${errMsg}` }])
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

  // 方案 A: IntentCorrect replay 结果注入聊天流。
  // 后端 /intent/correct 同步返回了 replay_result (内含 chatExecute 的 final conclusion
  // —— enforce-final 模式直接生成的 final, 含 issue 列表 + 状态统计),
  // 这里复刻 /chat/execute 路径 (App.jsx 2335-2352) 的处理:
  //   1. 把 final 当成 assistant 消息注入聊天流 (走 normalizeMessage 解析 state/analysisResult)
  //   2. 找最近 plan 消息, 标 status='executed' + 全 step 标 'completed'
  //   3. 刷新 session 列表
  // 这样:
  //   - 聊天 UI 能看到完整的分析结论 (issue 列表 + 修复状态)
  //   - plan 状态切到 executed, 右栏 IssuesSidePanel 会跟着收尾
  //   - 避免"前端一轮停止"+ useIssueList 永久轮询
  //
  // 路线 B: payload 现在是整条 /intent/correct 响应 (r.data),
  // 含 re_verify 标志 (后端 isReVerifyQuestion 判定) + replay_result 子对象。
  // 命中 re_verify=true 时挂起 ReVerifyProgressToast 轮询 progress。
  const handleIntentCorrectResult = useCallback((payload) => {
    if (!payload) return
    // 1. 注入 replay_result.response 到聊天流 (方案 A 主体)
    const replayResult = payload.replay_result
    if (replayResult) {
      const finalResponse = replayResult.response
      if (typeof finalResponse === 'string' && finalResponse.length > 0) {
        // enforce-final 模式不含 __CMD__, 不会有"等前端喂 COMMAND_RESULTS"的中间态
        const hasCommands = finalResponse.includes('__CMD__{')
        setMessages(prev => [...prev, normalizeMessage({ id: nextMsgId(), role: 'assistant', content: finalResponse })])
        setMessages(prev => {
          const newMsgs = [...prev]
          for (let i = newMsgs.length - 1; i >= 0; i--) {
            if (newMsgs[i].role === 'plan') {
              const newContent = { ...newMsgs[i].content, status: 'executed' }
              if (!hasCommands && newContent.plan) {
                newContent.plan = newContent.plan.map(s => ({ ...s, status: 'completed' }))
              }
              newMsgs[i] = { ...newMsgs[i], content: newContent }
              break
            }
          }
          return newMsgs
        })
        fetchSessions()
      }
    }
    // 2. 路线 B: re-verify 模式 → 挂右下角 Toast 轮询 progress
    // 注: 即便 replay 没产生 finalResponse (例如 isCodeIntent(corrected)=false 时不重放),
    // 只要 re_verify=true 也要显示 toast, 让用户知道"系统在跑"。
    if (payload.re_verify === true && sessionId) {
      setReVerifyToastEnabled(true)
    }
  }, [normalizeMessage, fetchSessions, sessionId])

  // ── Agent command detection: auto-execute __CMD__ markers ──
  const processedCmdMsgs = useRef(new Set())
  const processingCmdMsgs = useRef(new Set())
  const syncedWorkspaceTreesRef = useRef(new Set())
  const silentResponseVersionRef = useRef(new Map())

  const isCommandResultsMessage = (content) =>
    typeof content === 'string' && content.trim().startsWith('[COMMAND_RESULTS]')

  const isIntermediateCmdMessage = (content) =>
    typeof content === 'string' && content.includes('__CMD__{')

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
    if (!lastMsg.content || !lastMsg.content.includes('__CMD__{')) return
    if (!lastMsg.id) return

    const commandExecutionKey = `${sessionId}:${lastMsg.id}:${lastMsg.content}`
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
    if (typeof lastMsg.content !== 'string' || lastMsg.content.includes('__CMD__{')) return
    if (lastMsg._isComplete === false) return
    const timer = setTimeout(() => {
      endLiveLogSession()
    }, 250)
    return () => clearTimeout(timer)
  }, [messages, liveLogActive])

  // ── Auto-scroll to bottom when new messages arrive ──
  useEffect(() => {
    if (messages.length > 0) {
      // Small delay to let Virtuoso finish rendering the new item
      const timer = setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' })
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [messages.length])

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
            } else if (finalContent.includes('__CMD__{')) {
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
        // Re-verify / IntentCorrect 等场景下，真实结果会从 /intent/correct → replay_result
        // 路径以新消息抵达。此处不再把 "本轮文件读取已完成…" 兜底文案塞进聊天流中间，
        // 否则用户会看到"提问 → 错误占位 → 真实结果"三段，错误是噪声。
        appendLiveLog(`[CodeAnalysis] 静默回传未拿到最终分析结论: ${failureReason || '未知原因'}。保留原消息内容，不向聊天流注入错误占位（真实结果将由 IntentCorrect replay 等其他路径抵达）。\n`)
        if (silentResponseVersionRef.current.get(targetMsgId) !== nextVersion) {
          appendLiveLog('[CodeAnalysis] 检测到更晚的静默回传，忽略当前旧响应\n')
          return
        }
        setMessages(prev => prev.map(m =>
          m.id === targetMsgId ? { ...m, _isComplete: true } : m
        ))
        return
      }

      if (silentResponseVersionRef.current.get(targetMsgId) !== nextVersion) {
        appendLiveLog('[CodeAnalysis] 检测到更晚的静默回传，忽略当前旧响应\n')
        return
      }

      const currentMessage = messages.find(m => m.id === targetMsgId)
      let hasCmd = finalContent.includes('__CMD__{')
      // Removed overly-strict loop protection:
      // In a real execution environment, the backend handles deduplication and tracking
      // of reads. Blocking it on the frontend side breaks scenarios where identical commands
      // are legitimately required in the same flow.

      setMessages(prev => prev.map(m =>
        m.id === targetMsgId
          ? normalizeMessage({ ...m, __cmd: undefined, content: mergeAnalysisStateContent(m.content, finalContent), _isComplete: !hasCmd })
          : m
      ))
      // When analysis is complete, explicitly mark all plan steps as completed
      if (!hasCmd) {
        setMessages(prev => prev.map(m => {
          if (m.role !== 'plan') return m
          const newPlan = { ...m.content }
          if (newPlan.plan) {
            newPlan.plan = newPlan.plan.map(s => ({ ...s, status: 'completed' }))
          }
          return { ...m, content: newPlan }
        }))
      } else {
        // If it still has commands, we MUST remove it from processedCmdMsgs
        // so that the main useEffect hook can pick it up again and execute the new commands!
        const newKey = `${sessionId}:${targetMsgId}:${finalContent}`
        processedCmdMsgs.current.delete(newKey)
      }
    } catch (e) {
      console.warn('Command results send failed:', e)
      // 同样不向聊天流注入错误占位 —— 真实结果会从 IntentCorrect replay 等其他路径抵达。
      appendLiveLog(`[CodeAnalysis] 静默回传异常: ${e?.message || '网络或服务异常'}。保留原消息内容，不向聊天流注入错误占位。\n`)
      if (silentResponseVersionRef.current.get(targetMsgId) !== nextVersion) {
        appendLiveLog('[CodeAnalysis] 检测到更晚的静默回传，忽略当前异常响应\n')
        return
      }
      setMessages(prev => prev.map(m =>
        m.id === targetMsgId ? { ...m, _isComplete: true } : m
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

  if (!user) return <HomeWrapper onLoginSuccess={handleLoginSuccess} />

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
      // 2026-07-13: 同步 deleteSession() 的修复, 删除当前会话后不清空新建
      if (sessionId === id) {
        endLiveLogSession()
        setSessionId('')
        setMessages([])
        setActiveTab('chat')
      }
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

  const currentTheme = getTheme(themeId)
  const antAlgorithm = currentTheme.ant.algorithm === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm

  return (
    <ConfigProvider
      theme={{
        algorithm: antAlgorithm,
        token: currentTheme.ant.token,
        components: currentTheme.ant.components,
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
        {/* Mobile: Sider becomes a left Drawer (auto-closes on session select).
            Desktop: original collapsible Sider retained. */}
        {!isMobile ? (
          <Sider
            collapsible collapsed={siderCollapsed} onCollapse={setSiderCollapsed}
            trigger={null} width={240} collapsedWidth={0}
            style={{ background: 'var(--ab-bg-1)', borderRight: '1px solid var(--ab-line)', overflow: 'hidden' }}
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
        ) : (
          <Drawer
            placement="left"
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            width={280}
            styles={{ body: { padding: 0, background: 'var(--ab-bg-1)' }, header: { display: 'none' } }}
            closable={false}
          >
            <SessionSidebar
              sessions={sessions}
              scheduledTasks={scheduledTasks}
              sessionId={sessionId}
              activeTab={activeTab}
              siderCollapsed={false}
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
          </Drawer>
        )}

        {/* ── Main ── */}
        <Layout style={{ background: 'var(--ab-bg)' }}>
          {/* Header */}
          <Header style={{
            background: 'var(--ab-bg-1)', borderBottom: '1px solid var(--ab-line)', padding: isMobile ? '0 10px' : '0 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, gap: 8
          }}>
            <Space style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <Button type="text"
                icon={isMobile ? <MenuOutlined /> : (siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
                onClick={() => isMobile ? setMobileSidebarOpen(true) : setSiderCollapsed(!siderCollapsed)}
                style={{
                  color: 'var(--ab-text-3)',
                  flexShrink: 0,
                  // 2026-07-25: 移动端会话切换按钮加背景色 + Badge, 让用户更容易发现入口.
                  // 之前按钮太不起眼, 用户进入会话后找不到如何打开会话列表切换.
                  background: isMobile ? 'var(--ab-bg-3)' : 'transparent',
                  borderRadius: 8,
                  paddingInline: isMobile ? 10 : 7,
                  minHeight: 36,
                }} />
              {isMobile && sessions.length > 0 && (
                <Badge
                  count={sessions.length}
                  style={{
                    backgroundColor: 'var(--ab-copper)',
                    marginLeft: -8,
                    marginTop: -10,
                    fontSize: 10,
                    minWidth: 16,
                    height: 16,
                    lineHeight: '16px',
                    boxShadow: '0 0 0 2px var(--ab-bg-1)',
                  }}
                />
              )}
              {activeTab === 'chat' ? (() => {
                const curSess = sessions.find(s => s.id === sessionId)
                const chKey = curSess?.channel || currentChannel
                // Phase 4: 历史 erp/crm 会话映射到 cross
                const normalizedChKey = LEGACY_BUSINESS_CHANNELS.includes(chKey) ? 'cross' : chKey
                const chDef = ALL_CHANNELS.find(c => c.key === normalizedChKey)
                return (
                  <>
                    {chDef?.icon && <span style={{ color: 'var(--ab-copper)', fontSize: 15, display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{chDef.icon}</span>}
                    <Text style={{ color: 'var(--ab-text)', fontSize: 14, fontWeight: 500, fontFamily: "'Hanken Grotesk', system-ui, sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {curSess?.title || t('nav.newChat')}
                    </Text>
                    {chDef && !isMobile && <Tag style={{ fontSize: 11, marginInlineEnd: 0, color: 'var(--ab-text-3)', borderColor: 'var(--ab-line)', background: 'var(--ab-bg-3)', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em' }}>({chDef.label})</Tag>}
                  </>
                )
              })() : (
                <Text style={{ color: 'var(--ab-text-3)', fontSize: isMobile ? 13 : 14, fontFamily: "'Hanken Grotesk', system-ui, sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeTab === 'documents' ? t('nav.companyDocuments') : activeTab === 'academic' ? '学术分析' : activeTab === 'academic_stats' ? 'ReAct 闭环统计' : activeTab === 'llm_management' ? 'LLM 模型管理' : activeTab === 'sales_orders' ? '销售单管理' : activeTab === 'purchase_orders' ? '采购单管理' : activeTab === 'reconciliations' ? '对账单管理' : activeTab === 'recycle_bin' ? '回收站' : activeTab === 'inventory' ? '库存管理 (Admin)' : activeTab === 'profit_analysis' ? '出入库价差利润分析' : activeTab === 'audit_logs' ? '审计日志 (Admin)' : activeTab === 'plan_learning' ? '模型学习审核' : activeTab === 'crm_customers' ? 'CRM 客户管理' : activeTab === 'crm_contacts' ? 'CRM 联系人管理' : activeTab === 'crm_leads' ? 'CRM 线索管理' : activeTab === 'crm_opportunities' ? 'CRM 商机管理' : activeTab === 'crm_contracts' ? 'CRM 合同管理' : activeTab === 'crm_payment_plans' ? 'CRM 回款计划' : activeTab === 'crm_payment_records' ? 'CRM 回款记录' : activeTab === 'crm_follow_ups' ? 'CRM 跟进记录' : activeTab === 'dashboard' ? t('erp.dashboard') : activeTab === 'databases' ? t('nav.databases') : activeTab === 'monitor' ? 'autobot-monitor' : (sessions.find(s => s.id === sessionId)?.title || t('nav.newChat'))}
                </Text>
              )}
              {activeTab === 'chat' && (sessions.find(s => s.id === sessionId)?.channel === 'code' || (!sessions.find(s => s.id === sessionId)?.channel && currentChannel === 'code')) && workspaceDir && !isMobile && (
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
              {activeTab === 'chat' && (sessions.find(s => s.id === sessionId)?.channel === 'code' || (!sessions.find(s => s.id === sessionId)?.channel && currentChannel === 'code')) && workspaceDir && sessionId && !isMobile && (
                <Button
                  size="small"
                  icon={<ApartmentOutlined />}
                  onClick={() => setGraphDrawerOpen(true)}
                  style={{ fontSize: 12 }}
                >
                  图谱
                </Button>
              )}
            </Space>
            <Space style={{ flexShrink: 0 }}>
              {activeTab === 'chat' && (
                <>
                  {/* Mobile: toggle right issues/interactive panel as a Drawer.
                      2026-07-25: 改用 BarsOutlined 图标, 避免和左侧会话列表按钮(MenuOutlined)混淆. */}
                  {isMobile && sessionId && (
                    <Tooltip title="Issues & Interactive panel">
                      <Button type="text" icon={<BarsOutlined />}
                        onClick={() => setMobilePanelOpen(true)}
                        style={{ color: 'var(--ab-text-3)' }} />
                    </Tooltip>
                  )}
                  <Tooltip title={liveLogActive ? (showLogs ? 'Hide live logs' : 'Show live logs') : 'No active logs'}>
                    <Button type="text" icon={<CodeOutlined />}
                      onClick={() => setShowLogs(!showLogs)}
                      style={{ color: showLogs && liveLogActive ? 'var(--ab-copper)' : 'var(--ab-text-3)' }}
                      disabled={!liveLogActive} />
                  </Tooltip>
                </>
              )}
              <Dropdown menu={{
                items: [
                  { key: 'zh-CN', label: '中文', onClick: () => { i18n.changeLanguage('zh-CN'); localStorage.setItem('autobot_lang', 'zh-CN'); } },
                  { key: 'en-US', label: 'English', onClick: () => { i18n.changeLanguage('en-US'); localStorage.setItem('autobot_lang', 'en-US'); } },
                ],
                selectedKeys: [i18n.language]
              }}>
                <Tooltip title={t('language.switchTo')}>
                  <Button type="text" icon={<GlobalOutlined />} style={{ color: 'var(--ab-text-3)' }} />
                </Tooltip>
              </Dropdown>
              <ThemeSwitcher size="small" />
            </Space>
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
          ) : activeTab === 'recycle_bin' ? (
            <RecycleBinManagement user={user} companies={companies} />
          ) : activeTab === 'erp' ? (
            <ErpManagement user={user} companies={companies} />
          ) : activeTab === 'erp_metadata' ? (
            <ErpMetadataManagement user={user} companies={companies} />
          ) : activeTab === 'inventory' ? (
            <InventoryManagement user={user} companies={companies} />
          ) : activeTab === 'profit_analysis' ? (
            <ProfitAnalysis user={user} companies={companies} />
          ) : activeTab === 'audit_logs' ? (
            <AuditLogManagement user={user} />
          ) : activeTab === 'plan_learning' && isSuperAdmin ? (
            <PlanLearningManagement user={user} />
          ) : activeTab === 'crm_customers' ? (
            <CrmCustomerManagement user={user} companies={companies} />
          ) : activeTab === 'crm_contacts' ? (
            <CrmContactManagement user={user} companies={companies} />
          ) : activeTab === 'crm_leads' ? (
            <CrmLeadManagement user={user} companies={companies} />
          ) : activeTab === 'crm_opportunities' ? (
            <CrmOpportunityManagement user={user} companies={companies} />
          ) : activeTab === 'crm_contracts' ? (
            <CrmContractManagement user={user} companies={companies} />
          ) : activeTab === 'crm_payment_plans' ? (
            <CrmPaymentPlanManagement user={user} companies={companies} />
          ) : activeTab === 'crm_payment_records' ? (
            <CrmPaymentRecordManagement user={user} companies={companies} />
          ) : activeTab === 'crm_follow_ups' ? (
            <CrmFollowUpManagement user={user} companies={companies} />
          ) : activeTab === 'databases' ? (
              <DatabaseManagement dbConfigs={dbConfigs} fetchDbConfigs={fetchDbConfigs} onAddDbConfig={addDbConfig} onUpdateDbConfig={updateDbConfig} onDeleteDbConfig={deleteDbConfig} user={user} />
          ) : activeTab === 'monitor' && isSuperAdmin ? (
            <Content style={{ background: '#0a0a0a', overflow: 'auto' }}>
              <MonitorPanel />
            </Content>
          ) : activeTab === 'academic' ? (
            <Content style={{ background: '#0a0a0a', overflow: 'auto' }}>
              <AcademicResearchPage user={user} />
            </Content>
          ) : activeTab === 'novel' ? (
            <Content style={{ background: '#0a0a0a', overflow: 'auto' }}>
              <NovelPage user={user} />
            </Content>
          ) : activeTab === 'stock_monitor' ? (
            <Content style={{ background: '#0a0a0a', overflow: 'auto' }}>
              <StockMonitorPage user={user} />
            </Content>
          ) : activeTab === 'translation_check' ? (
            <Content style={{ background: 'var(--ab-bg)', overflow: 'hidden' }}>
              <TranslationCheckPage user={user} />
            </Content>
          ) : activeTab === 'academic_stats' && isSuperAdmin ? (
            <Content style={{ background: '#0a0a0a', overflow: 'auto' }}>
              <AcademicStatsPage />
            </Content>
          ) : activeTab === 'llm_management' && isSuperAdmin ? (
            <Content style={{ background: '#0a0a0a', overflow: 'auto' }}>
              <LlmManagement />
            </Content>
          ) : (

          <Layout style={{ background: '#0a0a0a', overflow: 'hidden', flexDirection: 'row', position: 'relative' }}>
            {/* Chat area */}
            <Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
              {/* Messages */}
              {messages.length === 0 && !sessionId ? (
                // 2026-07-13: 删除当前会话后, 改为"创建会话引导页"
                // (旧逻辑: 复用 greeting 占位 + input 区仍显示, 体验割裂)
                <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '24px 14px' : '40px 24px' }} className="custom-scrollbar">
                  <div style={{ maxWidth: isMobile ? '100%' : 880, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <ThunderboltOutlined style={{ fontSize: 56, color: '#d4a574', opacity: 0.75, marginBottom: 20 }} />
                    <Title level={2} style={{ color: '#e8e3d8', fontFamily: "'Fraunces', serif", fontWeight: 300, letterSpacing: '-0.02em', marginBottom: 8 }}>
                      开始新对话
                    </Title>
                    <Text style={{ color: '#807a6e', fontSize: 14, marginBottom: 40, textAlign: 'center', fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
                      选择一个对话类型, AutoBot 会按场景调度合适的 Agent
                    </Text>

                    {/* Channel 卡片网格 — 点击即 startNewSession(key) */}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, width: '100%', marginBottom: 28 }}>
                      {ALL_CHANNELS.map(ch => (
                        <div key={ch.key}
                          role="button"
                          tabIndex={0}
                          onClick={() => startNewSession(ch.key)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startNewSession(ch.key) } }}
                          style={{
                            background: '#161613', border: '1px solid #2a2620', borderRadius: 6,
                            padding: '16px 18px', cursor: 'pointer', transition: 'all 0.2s',
                            display: 'flex', flexDirection: 'column', gap: 6, outline: 'none'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#d4a574'; e.currentTarget.style.background = '#1a1a17' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2620'; e.currentTarget.style.background = '#161613' }}
                          onFocus={e => e.currentTarget.style.borderColor = '#d4a574'}
                          onBlur={e => e.currentTarget.style.borderColor = '#2a2620'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18 }}>
                            <span style={{ color: '#d4a574', display: 'inline-flex' }}>{ch.antIcon}</span>
                            <span style={{ color: '#e8e3d8', fontSize: 15, fontWeight: 500 }}>{ch.label}</span>
                          </div>
                          <Text style={{ color: '#807a6e', fontSize: 12, lineHeight: 1.5 }}>{ch.desc}</Text>
                          {ch.capabilities && ch.capabilities.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                              {ch.capabilities.slice(0, 3).map(c => (
                                <Tag key={c} style={{ fontSize: 10, margin: 0, background: 'rgba(212, 165, 116, 0.08)', borderColor: 'rgba(212, 165, 116, 0.3)', color: '#d4a574' }}>{c}</Tag>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 回到最近会话 — 从侧边栏点开过的 session, 一键恢复 */}
                    {(() => {
                      const recent = (sessions || []).filter(s => !s.id.startsWith('sched-')).slice(0, 5)
                      if (recent.length === 0) return null
                      return (
                        <div style={{ width: '100%', borderTop: '1px solid #2a2620', paddingTop: 20 }}>
                          <div style={{ fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                            Recent Sessions
                          </div>
                          {recent.map(s => {
                            const sessChKey = LEGACY_BUSINESS_CHANNELS.includes(s.channel) ? 'cross' : s.channel
                            const chDef = ALL_CHANNELS.find(c => c.key === sessChKey)
                            return (
                              <div key={s.id}
                                onClick={() => loadSession(s.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 4, cursor: 'pointer', color: '#b8b1a3', transition: 'background 0.15s' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#161613'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                <span style={{ color: '#d4a574', display: 'inline-flex', fontSize: 14 }}>
                                  {chDef ? chDef.antIcon : <MessageOutlined />}
                                </span>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                                  {s.title || t('nav.newChat')}
                                </span>
                                <span style={{ fontSize: 10, color: '#555', fontFamily: "'JetBrains Mono', monospace" }}>
                                  {chDef ? chDef.label : ''}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div style={{ flex: 1, overflow: 'auto', padding: '24px 0' }} className="custom-scrollbar">
                  <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px' }}>
                    {isLoading ? (
                      <SessionSkeleton />
                    ) : activeScheduledTask ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#524d44' }}>
                        <ClockCircleOutlined style={{ fontSize: 48, marginBottom: 16, color: '#d4a574', opacity: 0.7 }} />
                        <Title level={4} style={{ color: '#807a6e', margin: 0, fontFamily: "'Fraunces', serif", fontWeight: 300, letterSpacing: '-0.01em' }}>Waiting for the first execution...</Title>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#524d44' }}>
                        <ThunderboltOutlined style={{ fontSize: 48, marginBottom: 16, color: '#d4a574', opacity: 0.7 }} />
                        <Title level={4} style={{ color: '#807a6e', margin: 0, fontFamily: "'Fraunces', serif", fontWeight: 300, letterSpacing: '-0.01em' }}>{t('chat.greeting')}</Title>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, padding: '24px 0' }}>
                  <Virtuoso
                    ref={virtuosoRef}
                    style={{ height: '100%' }}
                    className="custom-scrollbar"
                    totalCount={messages.length}
                    followOutput="smooth"
                    increaseViewportBy={{ top: 200, bottom: 200 }}
                    itemContent={(index) => {
                      const msg = messages[index]
                      return (
                        <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px' }}>
                          <MessageBubble msg={msg} onDelete={() => handleDeleteMessage(msg.id || msg._localId)} />
                          {msg.explanation && <ResultExplanationCard explanation={msg.explanation} />}
                          {msg.paramSources && <ParamSourceCard paramSources={msg.paramSources} />}
                          {msg.crossDomainEntities && <CrossDomainEntityCard entities={msg.crossDomainEntities} />}
                        </div>
                      )
                    }}
                    components={{
                      Header: () => isParsingHistory && !isLoading ? (
                        <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px' }}>
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
                        <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px' }}>
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

              {/* Input — 没有 sessionId 时不显示 (用户在"创建会话引导页"上, 见上方分支) */}
              {!sessionId ? null : activeScheduledTask ? (
                <div style={{ padding: isMobile ? '10px 12px' : '16px 24px', background: '#0e0e0e', borderTop: '1px solid #2a2620', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
                  <div style={{ maxWidth: 760, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#161613', padding: isMobile ? '10px 12px' : '12px 24px', borderRadius: 4, border: '1px solid #2a2620', gap: 12, flexWrap: 'wrap' }}>
                    <Space size="large">
                      <div>
                        <Text style={{ color: '#807a6e', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em' }}>Frequency</Text>
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
                          <Text style={{ color: '#e8e3d8', fontSize: 14 }}>{activeScheduledTask.scheduleType === 'daily' ? 'Daily' : activeScheduledTask.scheduleType === 'weekly' ? 'Weekly' : 'Monthly'}</Text>
                        )}
                      </div>
                      <div>
                        <Text style={{ color: '#807a6e', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em' }}>Time</Text>
                        {editingTask === activeScheduledTask.id ? (
                          <TimePicker
                            size="small"
                            format="HH:mm"
                            value={editTaskData.scheduleTime ? dayjs(editTaskData.scheduleTime, 'HH:mm') : null}
                            onChange={(time, timeString) => setEditTaskData(prev => ({ ...prev, scheduleTime: timeString }))}
                            style={{ width: 90 }}
                          />
                        ) : (
                          <Text style={{ color: '#e8e3d8', fontSize: 14 }}>{activeScheduledTask.scheduleTime}</Text>
                        )}
                      </div>
                      <div>
                        <Text style={{ color: '#807a6e', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em' }}>Execution Count</Text>
                        <Text style={{ color: '#e8e3d8', fontSize: 14 }}>{messages.filter(m => m.role === 'user').length}</Text>
                      </div>
                      <div>
                        <Text style={{ color: '#807a6e', fontSize: 11, display: 'block', marginBottom: 4, textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em' }}>Created At</Text>
                        <Text style={{ color: '#e8e3d8', fontSize: 14 }}>{new Date(activeScheduledTask.createdAt).toLocaleString()}</Text>
                      </div>
                    </Space>
                    <Space>
                      <Tag color="blue" style={{ margin: 0, border: 'none', background: 'rgba(212, 165, 116, 0.12)', color: '#d4a574', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em' }}>Active</Tag>
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
                <div style={{ padding: isMobile ? '0 12px 14px' : '0 24px 20px', background: '#0a0a0a', borderTop: '1px solid #2a2620' }}>
                  <div style={{ maxWidth: 760, margin: '0 auto' }}>
                    {/* ── ERP 快速操作栏 — 业务会话 (cross/erp) 显示 ──
                        Phase 4: erp/crm 合并为 cross channel 后, 标签按域动态切换.
                        - 历史 erp 会话 → 固定显示 ERP 标签
                        - cross 会话 → 根据已选标签或输入框关键词检测域
                        标签前缀仍命中后端 ERPIntentDetector 快速路径 (0 LLM 调用). */}
                    {(() => {
                      const curSess = sessions.find(s => s.id === sessionId)
                      const sessChannel = curSess?.channel || currentChannel
                      if (!isBusinessChannel(sessChannel)) return false
                      if (sessChannel === 'crm') return false
                      if (sessChannel === 'erp') return true
                      // cross: 已选标签时根据标签 text 锁定域, 否则根据输入框内容检测
                      const probe = selectedQuickAction?.text || (typeof input === 'string' ? input : '')
                      return detectDomainFromInput(probe) === 'erp'
                    })() && (
                      <ErpQuickActions
                        selected={selectedQuickAction}
                        onSelect={setSelectedQuickAction}
                        onClear={() => setSelectedQuickAction(null)}
                        currentInput={input}
                        inputRef={chatInputRef}
                        disabled={isLoading}
                      />
                    )}

                    {/* ── CRM 快速操作栏 — 业务会话 (cross/crm) 显示 ──
                        Phase 4: 对标 ERP 标签逻辑, cross 会话时根据输入动态切换.
                        标签前缀仍命中后端 CRMIntentDetector 快速路径 (0 LLM 调用). */}
                    {(() => {
                      const curSess = sessions.find(s => s.id === sessionId)
                      const sessChannel = curSess?.channel || currentChannel
                      if (!isBusinessChannel(sessChannel)) return false
                      if (sessChannel === 'erp') return false
                      if (sessChannel === 'crm') return true
                      // cross: 已选标签时根据标签 text 锁定域, 否则根据输入框内容检测
                      const probe = selectedQuickAction?.text || (typeof input === 'string' ? input : '')
                      return detectDomainFromInput(probe) === 'crm'
                    })() && (
                      <CrmQuickActions
                        selected={selectedQuickAction}
                        onSelect={setSelectedQuickAction}
                        onClear={() => setSelectedQuickAction(null)}
                        currentInput={input}
                        inputRef={chatInputRef}
                        disabled={isLoading}
                      />
                    )}
                    {/* ── A 方案：code 会话移除「分析/构建」toggle，意图由后端基于消息+状态推断。
                          状态栏保留 codeMode='auto' 默认值；高级用户可通过 devtools 临时改 state 强制锁定。 */}
                    {/* ── C1: 粘贴即预览 — 检测到表格时提示声明意图 (2026-07-14) ── */}
                    {(() => {
                      const curSess = sessions.find(s => s.id === sessionId)
                      const sessChannel = curSess?.channel || currentChannel
                      if (!isBusinessChannel(sessChannel)) return false
                      return pasteTableInfo && !selectedQuickAction
                    })() && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
                        background: 'rgba(212, 165, 116, 0.08)', border: '1px solid rgba(212, 165, 116, 0.25)',
                        borderRadius: 4, marginBottom: 4, fontSize: 12, color: '#c9a97e'
                      }}>
                        <span>📋 检测到表格: {pasteTableInfo.rows} 行 × {pasteTableInfo.cols} 列</span>
                        <Text style={{ color: '#888', fontSize: 11, flex: 1 }}>
                          点上方「快速操作」声明意图可提升识别成功率，或直接发送
                        </Text>
                        <span role="button" aria-label="关闭表格提示"
                          onClick={() => setPasteTableInfo(null)}
                          style={{ cursor: 'pointer', color: '#888', padding: '0 4px' }}>✕</span>
                      </div>
                    )}
                    <div style={{
                      background: '#161613', borderRadius: 4, border: '1px solid #2a2620',
                      padding: '10px 14px', display: 'flex', alignItems: 'flex-end', gap: 8,
                      transition: 'border-color 0.2s, box-shadow 0.2s'
                    }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#d4a574'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(212, 165, 116, 0.12)' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#2a2620'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      <Tooltip title="Attach image or document">
                        <Button type="text" icon={<PaperClipOutlined />}
                          onClick={() => fileInputRef.current?.click()}
                          style={{ color: '#524d44', padding: '4px 6px' }} />
                      </Tooltip>
                      <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,.dxf,.dwg,.step,.stp,.iges,.igs" />

                      {selectedImage && (
                        <div style={{ display: 'flex', alignItems: 'center', background: '#0e0e0e', padding: '2px 8px', borderRadius: 2, marginRight: 8, gap: 4, border: '1px solid #2a2620' }}>
                          <FileImageOutlined style={{ color: '#7ab5b0', fontSize: 12 }} />
                          <Text style={{ color: '#e8e3d8', fontSize: 12, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedImage}</Text>
                          <CloseOutlined style={{ fontSize: 10, color: '#807a6e', cursor: 'pointer' }} onClick={() => { setSelectedImage(null); setSelectedImageBase64(null); }} />
                        </div>
                      )}

                      {uploadedDocuments.map((doc, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', background: '#0e0e0e', padding: '2px 8px', borderRadius: 2, marginRight: 8, gap: 4, border: '1px solid #2a2620' }}>
                          <FileTextOutlined style={{ color: '#d4a574', fontSize: 12 }} />
                          <Text style={{ color: '#e8e3d8', fontSize: 12, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</Text>
                          <CloseOutlined style={{ fontSize: 10, color: '#807a6e', cursor: 'pointer' }} onClick={() => { setUploadedDocuments(prev => prev.filter(d => d.id !== doc.id)); }} />
                        </div>
                      ))}

                      {selectedQuickAction && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: `${selectedQuickAction.color}22`,
                            border: `1px solid ${selectedQuickAction.color}80`,
                            padding: '2px 4px 2px 10px',
                            borderRadius: 4,
                            marginRight: 8,
                            gap: 4,
                            userSelect: 'none'
                          }}
                          title={`当前选中的快速操作标签: ${selectedQuickAction.label}`}
                        >
                          <span style={{ color: selectedQuickAction.color, fontSize: 12, display: 'flex', alignItems: 'center' }}>
                            {selectedQuickAction.icon}
                          </span>
                          <Text style={{ color: '#fff', fontSize: 12, whiteSpace: 'nowrap' }}>
                            {selectedQuickAction.label}
                          </Text>
                          <span
                            role="button"
                            aria-label="移除快速操作标签"
                            onClick={() => setSelectedQuickAction(null)}
                            onMouseDown={e => e.preventDefault()}
                            style={{
                              color: '#bbb',
                              fontSize: 12,
                              lineHeight: 1,
                              padding: '0 4px',
                              marginLeft: 2,
                              borderRadius: 2,
                              cursor: 'pointer'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#bbb'; e.currentTarget.style.background = 'transparent' }}
                          >✕</span>
                        </div>
                      )}

                      <TextArea
                        ref={chatInputRef}
                        value={input}
                        onChange={e => {
                          setInput(e.target.value)
                          setPasteTableInfo(detectPastedTable(e.target.value))
                        }}
                        onCompositionStart={() => { window.__imeComposing = true }}
                        onCompositionEnd={() => { window.__imeComposing = false }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            if (window.__imeComposing || e.nativeEvent.isComposing) return
                            e.preventDefault()
                            handleSendWithQuickAction()
                          }
                        }}
                        placeholder={
                          selectedQuickAction
                            ? '在此输入内容后回车或点发送 (上方标签可点击关闭)'
                            : 'Ask AutoBot... (Shift+Enter to break line)'
                        }
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        style={{ background: 'transparent', border: 'none', color: '#e8e3d8', resize: 'none', flex: 1, padding: '4px 0', fontSize: 14, fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}
                        variant="borderless"
                      />

                      <Space style={{ paddingBottom: 2 }}>
                        {(() => {
                          const hasInput = input.trim() || selectedImageBase64 || selectedQuickAction
                          if (hasInput) {
                            return (
                              <Button type="primary" shape="circle" icon={<SendOutlined />}
                                onClick={() => handleSendWithQuickAction()} size="small"
                                style={{ background: '#d4a574', borderColor: '#d4a574' }} />
                            )
                          }
                          return null
                        })()}
                      </Space>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 8, color: '#524d44', fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      AutoBot may make mistakes · Verify important information
                    </div>
                  </div>
                </div>
              )}
            </Content>

            {/* Right-hand issues panel — only for code sessions. The panel
                reuses the existing session to fetch /api/code-analysis/{id}/issues
                and lets the user mark items fixed/ignored. Strikes through
                issues whose status === 'fixed' | 'ignored' so the user can
                see at a glance which items remain.
                Mobile: rendered inside a right-side Drawer toggled from the header. */}
            {activeTab === 'chat' && sessionId && (() => {
              const rightPanelInner = (
                <>
                <InteractivePanel sessionId={sessionId} />
                {/* 阶段5: ERP 订单表单弹窗 — 收到 reply_context.formSpec 时弹出 */}
                <OrderFormModal
          open={orderFormOpen}
          onClose={closeOrderFormModal}
          onSubmit={submitOrderForm}
          formSpec={orderFormSpec}
          hintText={orderFormHint}
          companyId={user?.companyId}
        />
                {/* Phase 4: 结构化澄清弹窗 — 缺槽位/歧义/确认 */}
                {pendingClarify && (
                  <ClarifyQuestionModal
                    clarify={pendingClarify.clarifyQuestion}
                    loading={clarifyLoading}
                    onResolve={async (result) => {
                      setClarifyLoading(true)
                      try {
                        // P0-4: 结构化恢复协议 — 携带 resumeContext + clarifyResponse
                        // 仍生成文本回复供后端向后兼容, 但额外发送结构化字段
                        let replyText = ''
                        let clarifyResponse = null
                        if (result.confirmed !== undefined) {
                          replyText = result.confirmed ? '确认' : '取消'
                          clarifyResponse = { confirmed: result.confirmed }
                        } else if (result.slot && result.value !== undefined) {
                          replyText = `${result.slot}=${result.value}`
                          clarifyResponse = { slot: result.slot, value: result.value }
                        }
                        const resumeContext = pendingClarify.clarifyQuestion?.resumeContext || null
                        setPendingClarify(null)
                        // 复用 sendMessage 逻辑发送回复
                        if (replyText) {
                          pendingResumeRef.current = { resumeContext, clarifyResponse }
                          // 直接发送, 不走 quick action 拼装
                          setInput(replyText)
                          // 用 setTimeout 等状态更新后自动发送
                          setTimeout(() => {
                            sendMessage(replyText)
                          }, 0)
                        }
                      } finally {
                        setClarifyLoading(false)
                      }
                    }}
                    onCancel={() => setPendingClarify(null)}
                  />
                )}
                {/* Phase 4: HIGH 风险确认弹窗 — 执行前预览 + 确认/取消 */}
                {pendingPause && (
                  <>
                    {/* §5.6.2 PlanPreviewCard: 有 preview 时渲染结构化预览, 无 preview 时降级到 ClarifyQuestionModal */}
                    {pendingPause.preview ? (
                      <PlanPreviewCard
                        preview={pendingPause.preview}
                        loading={clarifyLoading}
                        onConfirm={async (editedParams) => {
                          setClarifyLoading(true)
                          try {
                            // §9.2 若用户修改了参数, 以 "确认编辑 {json}" 格式回传后端
                            const hasEdits = editedParams && Object.keys(editedParams).length > 0
                            const replyText = hasEdits
                              ? `确认编辑 ${JSON.stringify(editedParams)}`
                              : '确认'
                            // P0-4: 结构化恢复协议 — 携带 resumeContext + clarifyResponse
                            const resumeContext = pendingPause.clarifyQuestion?.resumeContext || null
                            const clarifyResponse = { confirmed: true, editedParams: hasEdits ? editedParams : null }
                            setPendingPause(null)
                            pendingResumeRef.current = { resumeContext, clarifyResponse }
                            setInput(hasEdits ? '确认' : replyText)
                            setTimeout(() => { sendMessage(replyText) }, 0)
                          } finally {
                            setClarifyLoading(false)
                          }
                        }}
                        onCancel={async () => {
                          setClarifyLoading(true)
                          try {
                            const replyText = '取消'
                            // P0-4: 结构化恢复协议
                            const resumeContext = pendingPause.clarifyQuestion?.resumeContext || null
                            const clarifyResponse = { confirmed: false }
                            setPendingPause(null)
                            pendingResumeRef.current = { resumeContext, clarifyResponse }
                            setInput(replyText)
                            setTimeout(() => { sendMessage(replyText) }, 0)
                          } finally {
                            setClarifyLoading(false)
                          }
                        }}
                      />
                    ) : (
                      <ClarifyQuestionModal
                        clarify={pendingPause.clarifyQuestion || {
                          clarifyType: 'POLICY_CONFIRMATION',
                          question: pendingPause.reason || '此操作为高风险, 请确认是否执行.',
                          blockingSlot: 'confirmation'
                        }}
                        loading={clarifyLoading}
                        onResolve={async (result) => {
                          setClarifyLoading(true)
                          try {
                            const replyText = result.confirmed ? '确认' : '取消'
                            const pauseSessionId = pendingPause.sessionId
                            // P0-4: 结构化恢复协议
                            const resumeContext = pendingPause.clarifyQuestion?.resumeContext || null
                            const clarifyResponse = { confirmed: !!result.confirmed }
                            setPendingPause(null)
                            pendingResumeRef.current = { resumeContext, clarifyResponse }
                            setInput(replyText)
                            setTimeout(() => {
                              sendMessage(replyText)
                            }, 0)
                          } finally {
                            setClarifyLoading(false)
                          }
                        }}
                        onCancel={() => setPendingPause(null)}
                      />
                    )}
                  </>
                )}
                {(sessions.find(s => s.id === sessionId)?.channel === 'code' || (!sessions.find(s => s.id === sessionId)?.channel && currentChannel === 'code')) && (
                  <IssuesSidePanel
                    sessionId={sessionId}
                    workspaceDir={workspaceDir}
                    onJumpToFile={(filePath, line) => {
                      // 提示位置 + 打开代码文件（右侧滑出 Drawer 展示并定位到行）
                      message.info(
                        line ? `${filePath}:${line}` : (filePath || 'No file path'),
                        2
                      )
                      openCodePreview(filePath, line, 'file')
                    }}
                    onViewGitDiff={(filePath) => {
                      // 修复后查看真实 git diff（右侧滑出 Drawer 的 Git Diff 页）
                      openCodePreview(filePath, 0, 'diff', '修复后的改动')
                    }}
                    onInjectAssistantMessage={(content) => {
                      // Inject a synthetic assistant message containing
                      // __CMD__ into the chat flow so the auto-execution
                      // useEffect picks it up and continues the multi-round
                      // __CMD__ → [COMMAND_RESULTS] interaction.
                      const id = `fix-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                      setMessages(prev => [...prev, {
                        id,
                        role: 'assistant',
                        content,
                        createdAt: new Date().toISOString(),
                        _isComplete: false
                      }])
                  }}
                  onFixIssueMessageUpdated={() => {
                    // The IssuesSidePanel just (a) inserted a
                    // brand-new placeholder message row via
                    // `createFixIssueMessage` (startFix just
                    // returned successfully) OR (b) updated the
                    // same row in place via
                    // `updateFixIssueMessage` (driver reached
                    // COMPLETED/FAILED). Either way the chat
                    // history on the server has changed. The
                    // chat UI does not poll messages on its own.
                    // Re-fetch the session history so the user
                    // sees the new / updated row.
                    //
                    // IMPORTANT: the cached history for this
                    // session is stale (it predates the change),
                    // so we MUST drop the cache entry before
                    // calling loadSession — otherwise the
                    // `if (cached) return` short-circuit in
                    // loadSession will re-mount the old array
                    // and the placeholder row never appears in
                    // the chat flow. `instantSwitch=false`
                    // preserves scroll position and avoids a
                    // full-screen loading flash.
                    if (sessionId) {
                      sessionCacheRef.current.delete(sessionId)
                      loadSession(sessionId, false)
                    }
                  }}
                  />
                )}
                </>
              )
              return isMobile ? (
                <Drawer
                  placement="right"
                  open={mobilePanelOpen}
                  onClose={() => setMobilePanelOpen(false)}
                  width="85%"
                  title="Issues & Interactive"
                  styles={{ body: { padding: 0, background: '#0a0a0a', overflowY: 'auto' }, header: { background: 'var(--ab-bg-1)', borderBottom: '1px solid var(--ab-line)' } }}
                >
                  {rightPanelInner}
                </Drawer>
              ) : (
                <div style={{
                  width: 320, flexShrink: 0,
                  borderLeft: '1px solid #2a2620',
                  background: '#0a0a0a',
                  overflowY: 'auto'
                }}>
                  {rightPanelInner}
                </div>
              )
            })()}

            {/* Log Panel */}
            {showLogs && liveLogActive && (
              <LogPanel isOpen={showLogs} onClose={() => setShowLogs(false)} localTerminalOutput={localTerminalOutput} />
            )}
          </Layout>
          )}
        </Layout>
      </Layout>

      {/* S6: 意图纠正浮层 —— 后端 predicted_intent 出现时弹出 */}
      <IntentCorrectionFloater
        visible={intentFloater.open}
        query={intentFloater.query}
        predictedIntent={intentFloater.predicted}
        sessionId={intentFloater.sessionId || sessionId}
        onResult={handleIntentCorrectResult}
        onClose={() => setIntentFloater({ open: false, query: '', predicted: '', sessionId: '' })}
      />

      {/* 路线 B: re-verify 模式进度 toast —— re_verify=true 时挂出, 轮询 progress */}
      <ReVerifyProgressToast
        sessionId={sessionId}
        enabled={reVerifyToastEnabled}
        onDone={(final) => {
          // 收到 running=false 的最终 snapshot → 关闭 toast
          // 此时后端已把核实结果写进 IssueStore, 右栏 issues 需要刷新
          setReVerifyToastEnabled(false)
          // 通知右栏 IssuesSidePanel 立即拉一次新数据 (避免等 5s 自动轮询)
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('reverify-finished', { detail: final }))
          }
        }}
      />

      {/* ── Workspace Directory Picker for Code Sessions ── */}
      <Modal
        title="选择项目目录"
        open={showWsPicker}
        onCancel={() => { setShowWsPicker(false); setWsPickerChannel(null); setIsChangingWorkspace(false); setIsResumingCodeSession(false) }}
        footer={[
          <Button key="cancel" onClick={() => { setShowWsPicker(false); setWsPickerChannel(null); setIsChangingWorkspace(false); setIsResumingCodeSession(false) }}>取消</Button>,
          <Button key="ok" type="primary" onClick={() => {
            const pickedDir = wsBrowsePath
            // 四类场景分流:
            // 1. isChangingWorkspace=true       — 用户主动在会话内切目录, 只改 workspace.
            // 2. isResumingCodeSession=true     — 恢复 code session 但 workspace 已失效, 只补齐 workspace.
            // 3. wsPickerChannel 已设 (新建会话) — 真正创建新 session, 写入新 workspace.
            // 4. 兜底                            — 与旧行为保持一致 (改 workspace, 不创建会话).
            if (isChangingWorkspace) {
              changeWorkspaceDir(pickedDir)
            } else if (isResumingCodeSession) {
              handleWorkspaceSelect(pickedDir)
            } else if (wsPickerChannel) {
              createSessionDirect(wsPickerChannel, pickedDir)
            } else {
              handleWorkspaceSelect(pickedDir)
            }
            setShowWsPicker(false)
            setWsPickerChannel(null)
            setIsChangingWorkspace(false)
            setIsResumingCodeSession(false)
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
                  style={{ cursor: 'pointer', padding: '4px 12px', borderBottom: '1px solid #2a2620', color: '#b8b1a3', fontSize: 12 }}
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
      <Drawer
        title={<Space><ApartmentOutlined /><span>代码图谱 — 当前会话</span></Space>}
        open={graphDrawerOpen}
        onClose={() => setGraphDrawerOpen(false)}
        size="large"
        styles={{ body: { background: '#0f0f0f', padding: 16 } }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <GraphStatusPanel workspaceId={sessionId} projectRoot={workspaceDir} />
          <CodeGraphExplorer workspaceId={sessionId} />
        </Space>
      </Drawer>
      {/* 代码预览 Drawer：点击"定位代码"打开文件并定位行；已修复 issue 可查看真实 git diff */}
      <CodePreviewDrawer
        open={codePreview.open}
        onClose={() => setCodePreview(prev => ({ ...prev, open: false }))}
        filePath={codePreview.filePath}
        line={codePreview.line}
        workspaceDir={workspaceDir}
        initialTab={codePreview.tab}
        titlePrefix={codePreview.titlePrefix}
      />
      <DocumentPreviewModal />
    </ConfigProvider>
  )
}

export default App
