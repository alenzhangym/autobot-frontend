import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Typography, Button, Row, Col, Divider, Tag, Space, List, Avatar, Spin, Alert, message, Modal, Input } from 'antd'
import api, { isAuthenticated, getBackendHost, setBackendHost, getSuggestedBackendHost } from './auth'
import { CHANNELS_BY_TASK_TYPE, TASK_TYPE } from './constants/taskTypes.jsx'
import {
  RobotOutlined,
  CodeOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  FileTextOutlined,
  MessageOutlined,
  LoginOutlined,
  UserOutlined,
  LockOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  LayoutOutlined,
  LineChartOutlined,
  GithubOutlined,
  CopyOutlined,
  DesktopOutlined,
  WindowsOutlined,
  AppleOutlined,
  LinuxOutlined,
} from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

// Default backend host. Must stay in sync with DEFAULT_BACKEND_HOST
// in ./auth.js. We duplicate it here (rather than importing) so the
// InstallCard is self-contained and renders even if auth.js is in a
// half-loaded state.
const INSTALL_DEFAULT_BACKEND_HOST = 'http://120.26.113.95:8000'
const INSTALL_REPO_URL = 'https://github.com/alenzhangym/autobot-frontend.git'

// 复制到剪贴板的轻量助手. n.clipboard 在某些环境 (非 HTTPS) 下
// 不可用, 因此回退到 document.execCommand 方案.
function copyToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      resolve()
    } catch (e) {
      reject(e)
    }
  })
}

// 一行可复制的代码块, 旁边带复制按钮.
function CopyableCommand({ label, command, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <div style={{ color: '#bbb', fontSize: 12, marginBottom: 4 }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        background: '#0a0a14',
        border: '1px solid #2a2a2a',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        <pre style={{
          flex: 1,
          margin: 0,
          padding: '10px 12px',
          color: '#7ee787',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>{command}</pre>
        <Button
          type="text"
          icon={<CopyOutlined style={{ color: '#888' }} />}
          onClick={() => {
            copyToClipboard(command).then(
              () => message.success('已复制'),
              () => message.error('复制失败')
            )
          }}
          style={{ color: '#888' }}
          title="复制到剪贴板"
        />
      </div>
      {hint && <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// 安装说明卡片. 面向使用 dbagent / code agent 的用户 —
// 他们在自己的机器上跑前端, 后端连到 DEFAULT_BACKEND_HOST.
function InstallCard() {
  const isWin = typeof navigator !== 'undefined' && /windows/i.test(navigator.platform || '')
  const oneClickCmd = isWin
    ? `irm https://raw.githubusercontent.com/alenzhangym/autobot-frontend/main/scripts/install-autobot-frontend.ps1 | iex`
    : `curl -fsSL https://raw.githubusercontent.com/alenzhangym/autobot-frontend/main/scripts/install-autobot-frontend.sh | bash`

  return (
    <Card
      style={{
        background: 'rgba(20, 20, 35, 0.7)',
        border: '1px solid rgba(22, 119, 255, 0.25)',
        borderRadius: 12,
      }}
      styles={{ body: { padding: 24 } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <GithubOutlined style={{ fontSize: 22, color: '#1677ff', marginRight: 10 }} />
        <Title level={4} style={{ color: '#fff', margin: 0 }}>
          本地安装 AutoBot 前端（DB Agent / Code Agent 用户）
        </Title>
      </div>
      <Paragraph style={{ color: '#aaa', marginBottom: 16 }}>
        前端为纯静态 SPA, 可在自己的机器上 <code style={{ color: '#7ee787' }}>npm start</code> 跑起来。
        默认连后端 <Text code style={{ color: '#7ee787' }}>{INSTALL_DEFAULT_BACKEND_HOST}</Text>；
        登录页 &quot;后端地址&quot; 框未改时使用该默认地址。
      </Paragraph>

      <Row gutter={[24, 16]}>
        <Col xs={24} md={14}>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>
            <CodeOutlined style={{ color: '#722ed1', marginRight: 8 }} />
            方式 1：手动安装
          </Title>
          <CopyableCommand
            label="# 1. 克隆代码"
            command={`git clone ${INSTALL_REPO_URL}`}
          />
          <CopyableCommand
            label="# 2. 安装依赖"
            command={`cd autobot-frontend && npm install`}
          />
          <CopyableCommand
            label="# 3. 启动前端 (默认连接上面的后端)"
            command={`npm run build && npm run start`}
            hint="启动后浏览器会自动打开 http://localhost:3000"
          />
        </Col>
        <Col xs={24} md={10}>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>
            <ThunderboltOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
            方式 2：一键脚本
          </Title>
          <CopyableCommand
            label={isWin ? '# Windows (PowerShell)' : '# macOS / Linux'}
            command={oneClickCmd}
            hint="脚本会检查 Node 环境、克隆仓库、npm install、写入 .env 写入默认后端地址并启动"
          />
          <div style={{
            background: 'rgba(22, 119, 255, 0.08)',
            border: '1px solid rgba(22, 119, 255, 0.2)',
            borderRadius: 6,
            padding: '10px 12px',
            color: '#9ec5fe',
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            <DatabaseOutlined style={{ marginRight: 6 }} />
            <strong>DB Agent / Code Agent 用户</strong>：脚本默认会将
            <Text code style={{ color: '#7ee787', margin: '0 4px' }}>VITE_BACKEND_HOST</Text>
            写入 <Text code style={{ color: '#7ee787' }}>.env</Text>，无需手动配置。
            如需修改后端地址, 启动后在登录页 &quot;后端地址&quot; 中设置即可。
          </div>
        </Col>
      </Row>
    </Card>
  )
}

// 桌面客户端构建说明卡片. 面向想把 webui 装成原生桌面 app 的用户
// — 一条命令出本平台安装包, 也支持三平台交叉编译.
function DesktopClientCard() {
  const ua = (typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '').toLowerCase()
  const isWin = /windows/.test(ua) || /win/.test(typeof navigator !== 'undefined' ? (navigator.platform || '') : '')
  const isMac = /mac/.test(ua) || /darwin/.test(typeof navigator !== 'undefined' ? (navigator.platform || '') : '')
  const currentOs = isWin ? 'win' : isMac ? 'mac' : 'linux'

  const distCmd = `npm run desktop:dist:${currentOs}`
  const oneLineCmd = isWin
    ? `git clone ${INSTALL_REPO_URL} ; cd autobot-frontend ; npm install ; npm run desktop:install ; npm run desktop:dist:win`
    : `git clone ${INSTALL_REPO_URL} && cd autobot-frontend && npm install && npm run desktop:install && npm run desktop:dist:${isMac ? 'mac' : 'linux'}`

  return (
    <Card
      style={{
        background: 'rgba(20, 20, 35, 0.7)',
        border: '1px solid rgba(82, 196, 26, 0.25)',
        borderRadius: 12,
        marginTop: 16,
      }}
      styles={{ body: { padding: 24 } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <DesktopOutlined style={{ fontSize: 22, color: '#52c41a', marginRight: 10 }} />
        <Title level={4} style={{ color: '#fff', margin: 0 }}>
          本地构建桌面客户端（Electron 跨平台壳）
        </Title>
      </div>
      <Paragraph style={{ color: '#aaa', marginBottom: 16 }}>
        把 AutoBot WebUI 装成本地桌面 app — 跳过浏览器沙箱, 可直接调用本机 LSP / MCP / 文件系统。
        一键脚本自动 <code style={{ color: '#7ee787' }}>vite build</code> + <code style={{ color: '#7ee787' }}>electron-builder</code>,
        输出当前平台原生安装包到 <Text code style={{ color: '#7ee787' }}>desktop/release/</Text>。
      </Paragraph>

      <Row gutter={[24, 16]}>
        <Col xs={24} md={14}>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>
            <CodeOutlined style={{ color: '#722ed1', marginRight: 8 }} />
            方式 1：手动分步（推荐 — 可观察每步输出）
          </Title>
          <CopyableCommand
            label="# 1. 克隆前端仓库"
            command={`git clone ${INSTALL_REPO_URL}`}
          />
          <CopyableCommand
            label="# 2. 安装 web 依赖"
            command={`cd autobot-frontend && npm install`}
          />
          <CopyableCommand
            label="# 3. 安装桌面壳依赖 (electron + electron-builder)"
            command={`npm run desktop:install`}
            hint="仅首次需要, 等价于 cd desktop && npm install"
          />
          <CopyableCommand
            label={`# 4. 按当前平台出安装包 (检测到: ${currentOs})`}
            command={distCmd}
            hint={
              isWin
                ? 'Windows: NSIS 安装包 + portable 便携版 (desktop/release/Autobot-0.1.0-x64.exe)'
                : isMac
                  ? 'macOS: dmg + zip (Intel/Apple Silicon)'
                  : 'Linux: AppImage + deb (desktop/release/Autobot-0.1.0-x64.{AppImage,deb})'
            }
          />
        </Col>
        <Col xs={24} md={10}>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>
            <ThunderboltOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
            方式 2：一行命令（适合 CI）
          </Title>
          <CopyableCommand
            label={isWin ? '# Windows (PowerShell)' : '# macOS / Linux'}
            command={oneLineCmd}
            hint="git clone → npm install → desktop:install → desktop:dist:本平台"
          />
          <div style={{
            background: 'rgba(82, 196, 26, 0.08)',
            border: '1px solid rgba(82, 196, 26, 0.2)',
            borderRadius: 6,
            padding: '10px 12px',
            color: '#b7eb8f',
            fontSize: 12,
            lineHeight: 1.6,
            marginBottom: 10,
          }}>
            <strong>显式三平台命令</strong> (需在目标平台或对应 docker 镜像中执行):
          </div>
          <CopyableCommand
            label={<span><WindowsOutlined style={{ color: '#0078d4', marginRight: 4 }} /> Windows</span>}
            command={`npm run desktop:dist:win`}
          />
          <CopyableCommand
            label={<span><AppleOutlined style={{ color: '#999', marginRight: 4 }} /> macOS</span>}
            command={`npm run desktop:dist:mac`}
          />
          <CopyableCommand
            label={<span><LinuxOutlined style={{ color: '#fff', marginRight: 4 }} /> Linux</span>}
            command={`npm run desktop:dist:linux`}
          />
          <div style={{
            background: 'rgba(22, 119, 255, 0.08)',
            border: '1px solid rgba(22, 119, 255, 0.2)',
            borderRadius: 6,
            padding: '10px 12px',
            color: '#9ec5fe',
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            <strong>详细文档</strong>：<Text code style={{ color: '#7ee787' }}>desktop/README.md</Text>
            （含图标生成、跨平台构建脚本、dev 模式、与浏览器模式差异对比）
          </div>
        </Col>
      </Row>
    </Card>
  )
}

// 主页 sticky 导航条. 锚点列表 + 当前激活 section 跟随滚动高亮.
// 滚动用 element.scrollIntoView({behavior:'smooth', block:'start'}),
// 各 section 已配 scrollMarginTop: 64 让 sticky 头不遮挡锚点标题.
function HomeNavBar() {
  const [active, setActive] = useState('hero')
  const items = [
    { id: 'install',  label: '安装说明' },
    { id: 'hero',     label: '平台介绍' },
    { id: 'modules',  label: '功能模块' },
    { id: 'workflow', label: '工作流程' },
    { id: 'cta',      label: '立即开始' },
  ]

  // 跟随滚动 — IntersectionObserver 监听各 section
  useEffect(() => {
    const sections = items
      .map((it) => document.getElementById(it.id))
      .filter(Boolean)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // 取当前在视口中且 ratio 最大的 section
        let best = null
        entries.forEach((e) => {
          if (e.isIntersecting) {
            if (!best || e.intersectionRatio > best.intersectionRatio) {
              best = e
            }
          }
        })
        if (best && best.target.id) {
          setActive(best.target.id)
        }
      },
      {
        // 顶部 64px 留给 sticky 头, 底部 -50% 让 section 进入视口中部时切换
        rootMargin: '-64px 0px -50% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    )
    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [])

  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(13, 13, 13, 0.85)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid #2a2a2a',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <ThunderboltOutlined style={{ fontSize: 18, color: '#1677ff', marginRight: 8 }} />
        <Text strong style={{ color: '#fff', fontSize: 15, marginRight: 'auto' }}>
          AutoBot
        </Text>
        {items.map((it) => {
          const isActive = active === it.id
          return (
            <Button
              key={it.id}
              type="text"
              onClick={() => scrollTo(it.id)}
              style={{
                color: isActive ? '#1677ff' : '#bbb',
                fontWeight: isActive ? 600 : 400,
                fontSize: 14,
                borderBottom: isActive ? '2px solid #1677ff' : '2px solid transparent',
                borderRadius: 0,
                height: 32,
                padding: '0 12px',
              }}
            >
              {it.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

// Agent 功能描述数据
// 任务类型 - 与后端 TaskType 枚举保持一致（4 个核心类型 + ERP 独立分支）
// 方向 B+C 重构：按"任务类型"维度展示，对齐后端 buildXxxTaskPlan
const agentCategories = [
  {
    id: TASK_TYPE.GENERAL_QUERY,
    title: '通用查询（ReAct 推理）',
    description: '复杂任务自动分解 + 原子工具调用',
    icon: <RobotOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
    channels: CHANNELS_BY_TASK_TYPE.GENERAL_QUERY || [],
    agents: [
      { name: 'ReasoningAgent', desc: '多步推理与 ReAct 循环', features: ['逻辑推理', '工具调用', '自纠错'] },
      { name: 'RagAgent', desc: '企业知识库检索', features: ['语义检索', 'top_k', '多文档'] },
      { name: 'CodeAnalysisAgent', desc: '代码符号搜索', features: ['符号匹配', '引用追踪'] },
    ]
  },
  {
    id: TASK_TYPE.CODE_TASK,
    title: '代码任务',
    description: '代码分析 / 生成 / 修复（统一入口）',
    icon: <CodeOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
    channels: CHANNELS_BY_TASK_TYPE.CODE_TASK || [],
    agents: [
      { name: 'CodeAnalysisAgent', desc: '代码结构与依赖分析', features: ['代码扫描', '问题检测', '报告生成'] },
      { name: 'CodeAgent', desc: '代码生成与编辑（Java/TS/Go）', features: ['代码生成', '文件编辑', '构建执行'] },
      { name: 'CodeValidatorAgent', desc: '代码验证与测试', features: ['单元测试', '集成验证', '回归检测'] },
    ]
  },
  {
    id: TASK_TYPE.DOC_TASK,
    title: '文档任务',
    description: '文档问答 / 文档生成 / 摘要（统一入口）',
    icon: <FileTextOutlined style={{ fontSize: 32, color: '#fa8c16' }} />,
    channels: CHANNELS_BY_TASK_TYPE.DOC_TASK || [],
    agents: [
      { name: 'RagAgent', desc: '文档检索（QA 模式）', features: ['语义检索', '答案生成'] },
      { name: 'DocumentArchitectAgent', desc: '文档结构设计（Generation 模式）', features: ['结构规划', '章节设计'] },
      { name: 'ContentAgent', desc: '文档内容生成', features: ['段落生成', '知识引用'] },
      { name: 'DocumentAssembler', desc: '文档组装输出', features: ['格式编排', '模板应用'] },
      { name: 'SummaryAgent', desc: '多文档摘要', features: ['要点提炼', '摘要输出'] },
    ]
  },
  {
    id: TASK_TYPE.DB_TASK,
    title: '数据库任务',
    description: '数据库分析 / 报表生成（统一入口）',
    icon: <DatabaseOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
    channels: CHANNELS_BY_TASK_TYPE.DB_TASK || [],
    agents: [
      { name: 'DBInspectAgent', desc: '表结构探查', features: ['schema 导出', '索引分析'] },
      { name: 'DBSqlAgent', desc: '智能 SQL 生成与执行', features: ['SQL 生成', '查询优化', '结果格式化'] },
      { name: 'DataProfilerAgent', desc: '数据探查与统计', features: ['数据分布', '异常检测'] },
      { name: 'SummaryAgent', desc: '分析结果汇总', features: ['报告生成', '要点提炼'] },
      { name: 'UIAgent', desc: '结果可视化展示', features: ['表格渲染', '图表生成'] },
    ]
  },
  {
    id: 'ERP',
    title: 'ERP 进销存',
    description: '采购 / 入库 / 出库 / 销售 / 对账',
    icon: <GlobalOutlined style={{ fontSize: 32, color: '#13c2c2' }} />,
    channels: CHANNELS_BY_TASK_TYPE.OTHER || [],
    agents: [
      { name: 'ERPOrchestrator', desc: 'ERP 流程编排与执行', features: ['订单处理', '库存管理', '财务对账'] },
    ]
  },
]


// 登录表单组件
function LoginForm({ onLoginSuccess, onBackToHome }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [backendHost, setLocalBackendHost] = useState('')

  useEffect(() => {
    setLocalBackendHost(getSuggestedBackendHost())
  }, [settingsVisible])

  const handleSaveSettings = () => {
    const v = (backendHost || '').trim()
    if (!v) {
      message.warning('请填写后端地址')
      return
    }
    setBackendHost(v)
    setSettingsVisible(false)
    message.success('后端地址已保存, 当前页面会立即使用新地址')
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!username || !password) {
      message.error('请输入用户名和密码')
      return
    }

    setLoading(true)
    try {
      const response = await api.post('/auth/login', {
        username,
        password
      })

      if (response.data && response.data.token) {
        message.success('登录成功！')
        if (onLoginSuccess) {
          onLoginSuccess(response.data)
        }
        setUsername('')
        setPassword('')
      } else {
        message.error('登录失败：未收到有效响应')
      }
    } catch (error) {
      console.error('Login error:', error)
      message.error('登录失败：' + (error.response?.data?.message || error.message || '请检查网络连接'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      position: 'relative',
    }}>
      <Button
        type="default"
        icon={<SettingOutlined />}
        onClick={() => setSettingsVisible(true)}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(22, 119, 255, 0.12)',
          border: '1px solid rgba(22, 119, 255, 0.45)',
          color: '#9ec5fe',
          fontWeight: 500,
        }}
      >
        设置后端地址
      </Button>
      <Modal
        title="后端地址设置"
        open={settingsVisible}
        onCancel={() => setSettingsVisible(false)}
        onOk={handleSaveSettings}
        okText="保存"
        cancelText="取消"
      >
        <Paragraph style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          默认后端地址为{' '}
          <Text code style={{ color: '#7ee787' }}>
            {INSTALL_DEFAULT_BACKEND_HOST}
          </Text>
          。如需修改, 请填写完整 URL (含 http://) 或 host:port, 保存后会自动刷新页面。
        </Paragraph>
        <div style={{ marginBottom: 8, color: '#bbb', fontSize: 13 }}>
          后端地址 (host:port 或完整 URL)
        </div>
        <Input
          value={backendHost}
          onChange={(e) => setLocalBackendHost(e.target.value)}
          placeholder={INSTALL_DEFAULT_BACKEND_HOST}
        />
      </Modal>
      <Card style={{
        width: 400,
        padding: 40,
        background: 'rgba(30, 30, 50, 0.9)',
        border: '1px solid rgba(22, 119, 255, 0.3)',
        borderRadius: 16
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <RobotOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
          <Title level={2} style={{ color: '#fff', marginBottom: 8 }}>
            AutoBot 登录
          </Title>
          <Text style={{ color: '#888' }}>请输入您的账号密码</Text>
        </div>

        <form onSubmit={(e) => { 
          e.preventDefault && e.preventDefault();
          handleLogin(e);
        }} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 24 }}>
            <label style={{ color: '#fff', fontWeight: 500, display: 'block', marginBottom: 8, fontSize: '14px' }}>
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              style={{ 
                padding: '12px 16px',
                fontSize: '16px',
                borderRadius: 8,
                border: '1px solid rgba(22, 119, 255, 0.3)',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: 32 }}>
            <label style={{ color: '#fff', fontWeight: 500, display: 'block', marginBottom: 8, fontSize: '14px' }}>
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              style={{ 
                padding: '12px 16px',
                fontSize: '16px',
                borderRadius: 8,
                border: '1px solid rgba(22, 119, 255, 0.3)',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                outline: 'none'
              }}
            />
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            size="large"
            style={{
              width: '100%',
              fontSize: '16px',
              borderRadius: 8,
              background: '#1677ff',
              border: 'none'
            }}
          >
            登录
          </Button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Text 
              onClick={onBackToHome || (() => onLoginSuccess && onLoginSuccess({ showHome: true }))}
              style={{ color: '#1677ff', cursor: 'pointer' }}
            >
              ← 返回主页
            </Text>
          </div>
        </form>
      </Card>
    </div>
  )
}

// 主页内容组件
function HomeContent({ onLoginClick }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [agentsData, setAgentsData] = useState(null)

  useEffect(() => {
    const fetchAgentsInfo = async () => {
      setLoading(true)
      try {
        const res = await api.get('/skills')
        setAgentsData(res.data?.skills || [])
      } catch (e) {
        console.log('Failed to fetch agents info')
      } finally {
        setLoading(false)
      }
    }
    fetchAgentsInfo()
  }, [])

  return (
    <div id="top" style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a2e 50%, #16213e 100%)',
      position: 'relative'
    }}>
      <HomeNavBar />

      {/* Install Card (unauthenticated only) — tells DB-agent and
          Code-agent users how to bring the frontend up locally. The
          default backend URL is the same one auth.js uses as the
          unconfigured default (DEFAULT_BACKEND_HOST). */}
      <div id="install" style={{ maxWidth: 1100, margin: '40px auto 0', padding: '0 20px', scrollMarginTop: 64 }}>
        <InstallCard />
        <DesktopClientCard />
      </div>

      {/* Hero Section */}
      <div id="hero" style={{
        padding: '80px 20px 60px',
        textAlign: 'center',
        background: 'radial-gradient(ellipse at center, rgba(22, 119, 255, 0.1) 0%, transparent 70%)',
        scrollMarginTop: 64,
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <ThunderboltOutlined style={{ fontSize: 64, color: '#1677ff', marginBottom: 24 }} />
          <Title level={1} style={{
            color: '#fff',
            fontSize: '48px',
            marginBottom: 16
          }}>
            AutoBot - 智能多 Agent 协作平台
          </Title>
          <Paragraph style={{
            color: '#888',
            fontSize: '18px',
            lineHeight: 1.8,
            marginBottom: 40
          }}>
            基于大语言模型的多 Agent 系统，实现代码开发、数据分析、文档处理等任务的自动化执行
          </Paragraph>
          <Button
            type="primary"
            size="large"
            icon={<LoginOutlined />}
            onClick={onLoginClick}
            style={{
              fontSize: '18px',
              padding: '16px 64px',
              borderRadius: 8,
              background: '#1677ff',
              border: 'none'
            }}
          >
            立即登录
          </Button>
        </div>
      </div>

      {/* Agent Categories */}
      <div id="modules" style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 20px', scrollMarginTop: 64 }}>
        <Title level={2} style={{
          color: '#fff',
          textAlign: 'center',
          marginBottom: 48,
          fontSize: '32px'
        }}>
          核心功能模块
        </Title>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <Spin size="large" />
          </div>
        ) : (
          <Row gutter={[32, 32]}>
            {agentCategories.map((category) => (
              <Col xs={24} md={12} lg={8} key={category.id}>
                <Card style={{
                  background: 'rgba(30, 30, 50, 0.5)',
                  border: '1px solid #2a2a2a',
                  borderRadius: 12,
                  height: '100%'
                }}>
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                      {category.icon}
                      <Title level={4} style={{
                        color: '#fff',
                        fontSize: '18px',
                        marginLeft: 12,
                        marginBottom: 0
                      }}>
                        {category.title}
                      </Title>
                    </div>
                    <Text style={{ color: '#888', fontSize: '14px' }}>
                      {category.description}
                    </Text>
                    {category.channels && category.channels.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Text style={{ color: '#666', fontSize: '11px', marginRight: 6 }}>入口：</Text>
                        {category.channels.map((ch) => (
                          <Tag
                            key={ch.key}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(82, 196, 26, 0.1)',
                              color: '#52c41a',
                              border: '1px solid rgba(82, 196, 26, 0.3)'
                            }}
                          >
                            {ch.icon} {ch.label}
                          </Tag>
                        ))}
                      </div>
                    )}
                  </div>

                  <List
                    size="small"
                    dataSource={category.agents}
                    renderItem={(agent) => (
                      <List.Item>
                        <List.Item.Meta
                          title={
                            <Space>
                              <Avatar
                                icon={<RobotOutlined />}
                                style={{ background: '#1677ff', color: '#fff' }}
                                size="small"
                              />
                              <Text style={{ color: '#e3e3e3', fontWeight: 500 }}>
                                {agent.name}
                              </Text>
                            </Space>
                          }
                          description={
                            <div>
                              <Text style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: 8 }}>
                                {agent.desc}
                              </Text>
                              <Space wrap>
                                {agent.features.map((feature, idx) => (
                                  <Tag
                                    key={idx}
                                    style={{
                                      fontSize: '10px',
                                      padding: '2px 8px',
                                      borderRadius: 4,
                                      background: 'rgba(22, 119, 255, 0.1)',
                                      color: '#1677ff',
                                      border: '1px solid rgba(22, 119, 255, 0.3)'
                                    }}
                                  >
                                    {feature}
                                  </Tag>
                                ))}
                              </Space>
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                  />
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </div>

      {/* How It Works */}
      <Divider style={{ borderColor: '#2a2a2a', margin: '60px 0' }} />

      <div id="workflow" style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 20px', scrollMarginTop: 64 }}>
        <Title level={2} style={{
          color: '#fff',
          textAlign: 'center',
          marginBottom: 48,
          fontSize: '32px'
        }}>
          工作流程
        </Title>

        <Row gutter={[40, 40]} style={{ marginTop: 40 }}>
          {[
            {
              step: '1',
              title: '用户输入需求',
              desc: '通过聊天界面描述任务目标，可上传文档、图片等辅助材料',
              icon: <LayoutOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            },
            {
              step: '2',
              title: '智能规划分解',
              desc: 'PlannerAgent 分析需求，分解为多个可执行步骤并分配给相应 Agent',
              icon: <SettingOutlined style={{ fontSize: 24, color: '#52c41a' }} />
            },
            {
              step: '3',
              title: '多 Agent 协同执行',
              desc: '各专业 Agent 并行或串行执行任务，实时交换上下文信息',
              icon: <RobotOutlined style={{ fontSize: 24, color: '#faad14' }} />
            },
            {
              step: '4',
              title: '结果汇总呈现',
              desc: 'SummaryAgent 整合执行结果，生成报告或可视化图表展示给用户',
              icon: <LineChartOutlined style={{ fontSize: 24, color: '#eb2f96' }} />
            }
          ].map((item, idx) => (
            <Col xs={24} md={6} key={idx}>
              <div style={{
                textAlign: 'center',
                padding: '24px',
                background: 'rgba(26, 26, 46, 0.5)',
                borderRadius: 12,
                border: '1px solid #2a2a2a'
              }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1677ff, #0d5ebf)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  boxShadow: '0 4px 12px rgba(22, 119, 255, 0.3)'
                }}>
                  {item.icon}
                </div>
                <Title level={5} style={{
                  color: '#fff',
                  fontSize: '16px',
                  marginBottom: 12
                }}>
                  {item.title}
                </Title>
                <Text style={{ color: '#888', fontSize: '13px', lineHeight: 1.8 }}>
                  {item.desc}
                </Text>
              </div>
            </Col>
          ))}
        </Row>
      </div>

      {/* CTA Section */}
      <div id="cta" style={{
        maxWidth: 900,
        margin: '80px auto 60px',
        padding: '60px 40px',
        background: 'linear-gradient(135deg, rgba(22, 119, 255, 0.1), rgba(26, 115, 232, 0.1))',
        borderRadius: 16,
        border: '1px solid rgba(22, 119, 255, 0.3)',
        textAlign: 'center',
        scrollMarginTop: 64,
      }}>
        <Title level={3} style={{
          color: '#fff',
          fontSize: '28px',
          marginBottom: 16
        }}>
          准备好开始使用 AutoBot 了吗？
        </Title>
        <Paragraph style={{
          color: '#888',
          fontSize: '16px',
          marginBottom: 32
        }}>
          登录系统，体验智能代理带来的高效工作流
        </Paragraph>
        <Button
          type="primary"
          size="large"
          icon={<LoginOutlined />}
          onClick={onLoginClick}
          style={{
            fontSize: '16px',
            padding: '12px 48px',
            borderRadius: 8,
            background: '#1677ff',
            border: 'none'
          }}
        >
          立即登录
        </Button>
      </div>

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        padding: '40px 20px',
        borderTop: '1px solid #1f1f1f'
      }}>
        <Text style={{ color: '#555', fontSize: '12px' }}>
          AutoBot © 2026 | Powered by LLM & Multi-Agent Architecture
        </Text>
      </div>
    </div>
  )
}

// 主组件导出
export default function HomeWrapper({ onLoginSuccess }) {
  const [showLogin, setShowLogin] = useState(false)

  // 如果显示登录表单
  if (showLogin) {
    return <LoginForm onLoginSuccess={onLoginSuccess} onBackToHome={() => setShowLogin(false)} />
  }

  // 默认显示主页内容
  return <HomeContent onLoginClick={() => setShowLogin(true)} />
}
