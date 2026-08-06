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
  BgColorsOutlined,
  CopyOutlined,
  DesktopOutlined,
  WindowsOutlined,
  AppleOutlined,
  LinuxOutlined,
  TeamOutlined,
  ShoppingCartOutlined,
  SolutionOutlined,
  ReadOutlined,
  BookOutlined,
} from '@ant-design/icons'
import ThemeSwitcher from './components/ThemeSwitcher'
import { initTheme } from './themes'

const { Title, Text, Paragraph } = Typography

// Apply saved theme on module load
initTheme()

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
    <div style={{ marginBottom: 14 }}>
      {label && (
        <div className="ab-mono-dim" style={{ marginBottom: 6, fontSize: 10 }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--ab-bg)',
        border: '1px solid var(--ab-line)',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <pre style={{
          flex: 1,
          margin: 0,
          padding: '11px 14px',
          color: 'var(--ab-copper-hi)',
          fontFamily: 'var(--ab-font-mono)',
          fontSize: 12.5,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>{command}</pre>
        <Button
          type="text"
          icon={<CopyOutlined style={{ color: 'var(--ab-text-3)' }} />}
          onClick={() => {
            copyToClipboard(command).then(
              () => message.success('已复制'),
              () => message.error('复制失败')
            )
          }}
          style={{ color: 'var(--ab-text-3)', borderLeft: '1px solid var(--ab-line)' }}
          title="复制到剪贴板"
        />
      </div>
      {hint && <div style={{ color: 'var(--ab-text-4)', fontFamily: 'var(--ab-font-mono)', fontSize: 10.5, marginTop: 5, letterSpacing: '0.02em' }}>{hint}</div>}
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
    <div className="ab-surface ab-reveal ab-reveal-2" style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="ab-mono-label">06 / Install</span>
        </div>
        <span className="ab-mono-dim" style={{ fontSize: 10 }}>SPA · STATIC · LOCAL-RUN</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, marginBottom: 10 }}>
        <GithubOutlined style={{ fontSize: 22, color: 'var(--ab-copper)' }} />
        <h2 className="ab-display" style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>
          本地安装 <em>AutoBot</em> 前端
        </h2>
      </div>
      <p style={{ color: 'var(--ab-text-2)', marginBottom: 22, lineHeight: 1.7, fontSize: 14, maxWidth: 640 }}>
        前端为纯静态 SPA, 可在自己的机器上 <span className="ab-code">npm start</span> 跑起来。
        默认连后端 <span className="ab-code">{INSTALL_DEFAULT_BACKEND_HOST}</span>；
        登录页 "后端地址" 框未改时使用该默认地址。
      </p>

      <Row gutter={[32, 20]}>
        <Col xs={24} md={14}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className="ab-tag ab-tag-copper">METHOD 01</span>
            <span style={{ fontFamily: 'var(--ab-font-body)', color: 'var(--ab-text)', fontSize: 14, fontWeight: 500 }}>手动安装</span>
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className="ab-tag ab-tag-teal">METHOD 02</span>
            <span style={{ fontFamily: 'var(--ab-font-body)', color: 'var(--ab-text)', fontSize: 14, fontWeight: 500 }}>一键脚本</span>
          </div>
          <CopyableCommand
            label={isWin ? '# Windows (PowerShell)' : '# macOS / Linux'}
            command={oneClickCmd}
            hint="脚本会检查 Node 环境、克隆仓库、npm install、写入 .env 写入默认后端地址并启动"
          />
          <div style={{
            background: 'rgba(212, 165, 116, 0.05)',
            border: '1px solid var(--ab-line-soft)',
            borderLeft: '2px solid var(--ab-copper)',
            padding: '12px 14px',
            color: 'var(--ab-text-2)',
            fontFamily: 'var(--ab-font-body)',
            fontSize: 12.5,
            lineHeight: 1.65,
          }}>
            <DatabaseOutlined style={{ marginRight: 8, color: 'var(--ab-copper)' }} />
            <strong style={{ color: 'var(--ab-text)' }}>DB Agent / Code Agent 用户</strong>：脚本默认会将
            <span className="ab-code" style={{ margin: '0 4px' }}>VITE_BACKEND_HOST</span>
            写入 <span className="ab-code">.env</span>，无需手动配置。
            如需修改后端地址, 启动后在登录页 "后端地址" 中设置即可。
          </div>
        </Col>
      </Row>
    </div>
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
    <div className="ab-surface ab-reveal ab-reveal-3" style={{ padding: '28px 32px', marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span className="ab-mono-label">02 / Desktop</span>
        </div>
        <span className="ab-mono-dim" style={{ fontSize: 10 }}>ELECTRON · CROSS-PLATFORM · NATIVE</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, marginBottom: 10 }}>
        <DesktopOutlined style={{ fontSize: 22, color: 'var(--ab-teal-hi)' }} />
        <h2 className="ab-display" style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>
          构建桌面客户端 <em>Electron</em>
        </h2>
      </div>
      <p style={{ color: 'var(--ab-text-2)', marginBottom: 22, lineHeight: 1.7, fontSize: 14, maxWidth: 640 }}>
        把 AutoBot WebUI 装成本地桌面 app — 跳过浏览器沙箱, 可直接调用本机 LSP / MCP / 文件系统。
        一键脚本自动 <span className="ab-code">vite build</span> + <span className="ab-code">electron-builder</span>,
        输出当前平台原生安装包到 <span className="ab-code">desktop/release/</span>。
      </p>

      <Row gutter={[32, 20]}>
        <Col xs={24} md={14}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className="ab-tag ab-tag-copper">METHOD 01</span>
            <span style={{ fontFamily: 'var(--ab-font-body)', color: 'var(--ab-text)', fontSize: 14, fontWeight: 500 }}>手动分步（推荐）</span>
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span className="ab-tag ab-tag-teal">METHOD 02</span>
            <span style={{ fontFamily: 'var(--ab-font-body)', color: 'var(--ab-text)', fontSize: 14, fontWeight: 500 }}>一行命令（CI）</span>
          </div>
          <CopyableCommand
            label={isWin ? '# Windows (PowerShell)' : '# macOS / Linux'}
            command={oneLineCmd}
            hint="git clone → npm install → desktop:install → desktop:dist:本平台"
          />
          <div style={{
            background: 'rgba(90, 154, 150, 0.05)',
            border: '1px solid rgba(90, 154, 150, 0.18)',
            borderLeft: '2px solid var(--ab-teal)',
            padding: '10px 14px',
            color: 'var(--ab-text-2)',
            fontFamily: 'var(--ab-font-body)',
            fontSize: 12,
            lineHeight: 1.6,
            marginBottom: 12,
          }}>
            <strong style={{ color: 'var(--ab-teal-hi)' }}>显式三平台命令</strong> (需在目标平台或对应 docker 镜像中执行):
          </div>
          <CopyableCommand
            label={<span><WindowsOutlined style={{ color: '#0078d4', marginRight: 4 }} /> Windows</span>}
            command={`npm run desktop:dist:win`}
          />
          <CopyableCommand
            label={<span><AppleOutlined style={{ color: 'var(--ab-text-3)', marginRight: 4 }} /> macOS</span>}
            command={`npm run desktop:dist:mac`}
          />
          <CopyableCommand
            label={<span><LinuxOutlined style={{ color: 'var(--ab-text)', marginRight: 4 }} /> Linux</span>}
            command={`npm run desktop:dist:linux`}
          />
          <div style={{
            background: 'rgba(212, 165, 116, 0.05)',
            border: '1px solid var(--ab-line-soft)',
            borderLeft: '2px solid var(--ab-copper)',
            padding: '10px 14px',
            color: 'var(--ab-text-2)',
            fontFamily: 'var(--ab-font-body)',
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--ab-text)' }}>详细文档</strong>：<span className="ab-code">desktop/README.md</span>
            （含图标生成、跨平台构建脚本、dev 模式、与浏览器模式差异对比）
          </div>
        </Col>
      </Row>
    </div>
  )
}

// 主页 sticky 导航条. 锚点列表 + 当前激活 section 跟随滚动高亮.
// 滚动用 element.scrollIntoView({behavior:'smooth', block:'start'}),
// 各 section 已配 scrollMarginTop: 64 让 sticky 头不遮挡锚点标题.
function HomeNavBar({ onLoginClick }) {
  const [active, setActive] = useState('hero')
  const items = [
    { id: 'hero',     label: 'Platform' },
    { id: 'modules',  label: 'Modules' },
    { id: 'workflow', label: 'Workflow' },
    { id: 'cta',      label: 'Begin' },
    { id: 'install',  label: 'Install' },
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
        background: 'rgba(10, 10, 10, 0.82)',
        backdropFilter: 'blur(14px) saturate(140%)',
        WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        borderBottom: '1px solid var(--ab-line)',
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: '14px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 36,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginRight: 'auto' }}>
          <span style={{
            fontFamily: 'var(--ab-font-display)',
            fontSize: 20,
            fontWeight: 400,
            color: 'var(--ab-text)',
            letterSpacing: '-0.015em',
          }}>
            AutoBot
          </span>
          <span className="ab-mono-dim" style={{ fontSize: 10, color: 'var(--ab-text-4)' }}>/ ATELIER</span>
        </div>
        {items.map((it) => {
          const isActive = active === it.id
          return (
            <button
              key={it.id}
              className={`ab-nav-link ${isActive ? 'is-active' : ''}`}
              onClick={() => scrollTo(it.id)}
            >
              {it.label}
            </button>
          )
        })}
        {/* Login button + Theme switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <ThemeSwitcher size="small" />
          <Button
            type="primary"
            size="small"
            icon={<LoginOutlined />}
            onClick={onLoginClick}
            className="ab-btn-copper"
            style={{
              fontSize: 11,
              height: 32,
              padding: '0 20px',
              borderRadius: 3,
              letterSpacing: '0.08em',
            }}
          >
            LOGIN
          </Button>
        </div>
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
    title: '通用查询',
    subtitle: 'ReAct Reasoning',
    description: '复杂任务自动分解 + 原子工具调用',
    accent: 'copper',
    icon: <RobotOutlined />,
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
    subtitle: 'Code Synthesis',
    description: '代码分析 / 生成 / 修复（统一入口）',
    accent: 'iris',
    icon: <CodeOutlined />,
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
    subtitle: 'Document Pipeline',
    description: '文档问答 / 文档生成 / 摘要（统一入口）',
    accent: 'rose',
    icon: <FileTextOutlined />,
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
    subtitle: 'Data Intelligence',
    description: '数据库分析 / 报表生成（统一入口）',
    accent: 'moss',
    icon: <DatabaseOutlined />,
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
    subtitle: 'Commerce Operations',
    description: '采购 / 入库 / 出库 / 销售 / 对账 / 库存 / 利润分析',
    accent: 'teal',
    icon: <ShoppingCartOutlined />,
    channels: CHANNELS_BY_TASK_TYPE.OTHER || [],
    agents: [
      { name: 'ERPOrchestrator', desc: 'ERP 流程编排与执行 (LLM ReAct)', features: ['采购/销售单', '入库/出库', '对账', '库存管理', '利润分析', 'Excel 导入', '批量同步', '审计日志', '数据看板'] },
    ]
  },
  {
    id: 'CRM',
    title: 'CRM 客户关系',
    subtitle: 'Customer Relationship',
    description: '客户 / 联系人 / 线索 / 商机 / 合同 / 回款 / 跟进',
    accent: 'iris',
    icon: <TeamOutlined />,
    channels: [],
    agents: [
      { name: 'CRMOrchestrator', desc: 'CRM 流程编排与执行 (LLM ReAct)', features: ['客户与联系人', '线索与商机', '合同管理', '回款计划与记录', '跟进记录', '统一客户主数据'] },
    ]
  },
  {
    id: 'academic',
    title: '学术分析',
    subtitle: 'Research & Report',
    description: '论文检索 / 深度研究 / 报告生成（四阶段流水线）',
    accent: 'copper',
    icon: <ReadOutlined />,
    channels: [],
    agents: [
      { name: 'SearchAgent', desc: '多源论文检索', features: ['Perplexity', 'FeedCoop', '本地知识库'] },
      { name: 'OutlineArchitect', desc: '报告大纲规划', features: ['内置模板', '用户自定义模板'] },
      { name: 'SectionGenerator', desc: '章节逐段生成', features: ['长文档', '异步进度', '断点续传'] },
      { name: 'DebateReviewer', desc: '辩论评审与修订', features: ['ReAct 闭环', '段落扩展', 'LLM 校准'] },
      { name: 'SynthesisAgent', desc: '报告合成与导出', features: ['DOCX', 'PDF', '大纲/章节审核'] },
    ]
  },
  {
    id: 'novel',
    title: '小说创作',
    subtitle: 'Fiction Pipeline',
    description: '题材化小说分层生成 — 角色图谱 / 大纲 / 卷章',
    accent: 'rose',
    icon: <BookOutlined />,
    channels: [],
    agents: [
      { name: 'ArcGenerator', desc: '故事弧线与角色关系图谱', features: ['多弧线候选', '关系图谱', '角色配置'] },
      { name: 'OutlineGenerator', desc: '分层大纲生成', features: ['卷/章配置', '章节计数', '风格偏好'] },
      { name: 'ChapterGenerator', desc: '章节逐章生成', features: ['异步进度', '章节审核', '断点续传'] },
      { name: 'AssemblyAgent', desc: '成书与导出', features: ['DOCX', 'PDF', '过短段落扩展'] },
    ]
  },
]

// accent → color mapping
const ACCENT_COLOR = {
  copper: 'var(--ab-copper)',
  iris: 'var(--ab-iris)',
  rose: 'var(--ab-rose)',
  moss: 'var(--ab-moss)',
  teal: 'var(--ab-teal-hi)',
}

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
    <div className="ab-grain" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--ab-bg)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div className="ab-grid-bg" />
      {/* Side metadata column */}
      <div style={{
        position: 'absolute',
        left: 32,
        top: '50%',
        transform: 'translateY(-50%)',
        writingMode: 'vertical-rl',
        fontFamily: 'var(--ab-font-mono)',
        fontSize: 10,
        letterSpacing: '0.32em',
        color: 'var(--ab-text-4)',
        textTransform: 'uppercase',
        zIndex: 2,
      }}>
        AUTOBOT · ATELIER COMMAND CENTER · EST. 2026
      </div>
      {/* Right corner mono metadata */}
      <div style={{
        position: 'absolute',
        right: 32,
        top: 32,
        textAlign: 'right',
        fontFamily: 'var(--ab-font-mono)',
        fontSize: 10,
        letterSpacing: '0.2em',
        color: 'var(--ab-text-4)',
        textTransform: 'uppercase',
        zIndex: 2,
        lineHeight: 1.8,
      }}>
        <div>SESSION / NEW</div>
        <div style={{ color: 'var(--ab-copper)' }} className="ab-cursor-blink">STATUS / READY</div>
      </div>

      <Button
        type="default"
        icon={<SettingOutlined />}
        onClick={() => setSettingsVisible(true)}
        style={{
          position: 'absolute',
          bottom: 32,
          right: 32,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: '1px solid var(--ab-line)',
          color: 'var(--ab-text-2)',
          fontWeight: 500,
          fontFamily: 'var(--ab-font-mono)',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          height: 32,
          zIndex: 2,
        }}
      >
        Backend
      </Button>
      <Modal
        title="后端地址设置"
        open={settingsVisible}
        onCancel={() => setSettingsVisible(false)}
        onOk={handleSaveSettings}
        okText="保存"
        cancelText="取消"
      >
        <Paragraph style={{ color: 'var(--ab-text-3)', fontSize: 12, marginBottom: 12 }}>
          默认后端地址为{' '}
          <span className="ab-code">{INSTALL_DEFAULT_BACKEND_HOST}</span>
          。如需修改, 请填写完整 URL (含 http://) 或 host:port, 保存后会自动刷新页面。
        </Paragraph>
        <div className="ab-mono-dim" style={{ marginBottom: 8, fontSize: 11 }}>
          后端地址 (host:port 或完整 URL)
        </div>
        <Input
          value={backendHost}
          onChange={(e) => setLocalBackendHost(e.target.value)}
          placeholder={INSTALL_DEFAULT_BACKEND_HOST}
        />
      </Modal>

      <div style={{
        width: 440,
        padding: '48px 44px',
        background: 'var(--ab-surface)',
        border: '1px solid var(--ab-line)',
        borderRadius: 4,
        boxShadow: 'var(--ab-shadow-2)',
        position: 'relative',
        zIndex: 2,
      }} className="ab-reveal">
        {/* Corner ticks */}
        <span style={{ position: 'absolute', top: 0, left: 0, width: 14, height: 14, borderTop: '1px solid var(--ab-copper)', borderLeft: '1px solid var(--ab-copper)' }} />
        <span style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderTop: '1px solid var(--ab-copper)', borderRight: '1px solid var(--ab-copper)' }} />
        <span style={{ position: 'absolute', bottom: 0, left: 0, width: 14, height: 14, borderBottom: '1px solid var(--ab-copper)', borderLeft: '1px solid var(--ab-copper)' }} />
        <span style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderBottom: '1px solid var(--ab-copper)', borderRight: '1px solid var(--ab-copper)' }} />

        <div style={{ marginBottom: 36 }}>
          <div className="ab-mono-label" style={{ marginBottom: 18 }}>AUTHENTICATE</div>
          <h1 className="ab-display" style={{ fontSize: 40, fontWeight: 300, marginBottom: 8 }}>
            Sign in to <em>AutoBot</em>
          </h1>
          <div style={{ color: 'var(--ab-text-3)', fontSize: 13, fontFamily: 'var(--ab-font-body)' }}>
            请输入您的账号密码以进入控制中心
          </div>
        </div>

        <form onSubmit={(e) => {
          e.preventDefault && e.preventDefault();
          handleLogin(e);
        }} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 22 }}>
            <label className="ab-mono-dim" style={{ display: 'block', marginBottom: 8, fontSize: 10 }}>
              USERNAME
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              style={{
                width: '100%',
                padding: '13px 16px',
                fontSize: 14,
                fontFamily: 'var(--ab-font-body)',
                borderRadius: 3,
                border: '1px solid var(--ab-line)',
                background: 'var(--ab-bg)',
                color: 'var(--ab-text)',
                outline: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--ab-copper)'; e.target.style.boxShadow = '0 0 0 3px var(--ab-copper-glow)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--ab-line)'; e.target.style.boxShadow = 'none' }}
            />
          </div>

          <div style={{ marginBottom: 32 }}>
            <label className="ab-mono-dim" style={{ display: 'block', marginBottom: 8, fontSize: 10 }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              style={{
                width: '100%',
                padding: '13px 16px',
                fontSize: 14,
                fontFamily: 'var(--ab-font-body)',
                borderRadius: 3,
                border: '1px solid var(--ab-line)',
                background: 'var(--ab-bg)',
                color: 'var(--ab-text)',
                outline: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--ab-copper)'; e.target.style.boxShadow = '0 0 0 3px var(--ab-copper-glow)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--ab-line)'; e.target.style.boxShadow = 'none' }}
            />
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            className="ab-btn-copper"
            size="large"
            style={{
              width: '100%',
              fontSize: 13,
              height: 46,
              borderRadius: 3,
              letterSpacing: '0.06em',
            }}
          >
            AUTHENTICATE & ENTER
          </Button>

          <div style={{ textAlign: 'center', marginTop: 22 }}>
            <button
              type="button"
              onClick={onBackToHome || (() => onLoginSuccess && onLoginSuccess({ showHome: true }))}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--ab-font-mono)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--ab-text-3)',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--ab-copper)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--ab-text-3)'}
            >
              ← BACK TO HOME
            </button>
          </div>
        </form>
      </div>
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
    <div id="top" className="ab-grain" style={{
      minHeight: '100vh',
      background: 'var(--ab-bg)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <HomeNavBar onLoginClick={onLoginClick} />

      {/* Hero Section */}
      <div id="hero" style={{
        padding: '120px 32px 80px',
        position: 'relative',
        scrollMarginTop: 64,
        overflow: 'hidden',
      }}>
        <div className="ab-grid-bg" />
        <div className="ab-vignette" />

        {/* Vertical mono strip — left */}
        <div style={{
          position: 'absolute',
          left: 32,
          top: 120,
          writingMode: 'vertical-rl',
          fontFamily: 'var(--ab-font-mono)',
          fontSize: 10,
          letterSpacing: '0.32em',
          color: 'var(--ab-text-4)',
          textTransform: 'uppercase',
          zIndex: 3,
        }}>
          MULTI-AGENT · LLM-NATIVE · v2026
        </div>

        <div style={{ maxWidth: 980, margin: '0 auto', position: 'relative', zIndex: 3 }}>
          <div className="ab-mono-label ab-reveal ab-reveal-1" style={{ marginBottom: 32 }}>
            INTELLIGENCE PLATFORM / EST. 2026
          </div>

          <h1 className="ab-display ab-reveal ab-reveal-2" style={{
            fontSize: 'clamp(48px, 7vw, 88px)',
            margin: '0 0 28px',
            fontWeight: 300,
            letterSpacing: '-0.03em',
          }}>
            Multi-agent<br />
            intelligence,<br />
            <em>orchestrated</em>.
          </h1>

          <p className="ab-reveal ab-reveal-3" style={{
            color: 'var(--ab-text-2)',
            fontSize: 17,
            lineHeight: 1.7,
            maxWidth: 580,
            margin: '0 0 44px',
            fontFamily: 'var(--ab-font-body)',
          }}>
            基于大语言模型的多 Agent 协作平台 — 代码工程、数据分析、文档编排、
            ERP 进销存、CRM 客户关系、学术研究与小说创作任务在同一控制中心内自动化执行。
          </p>

          <div className="ab-reveal ab-reveal-4" style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <Button
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              onClick={onLoginClick}
              className="ab-btn-copper"
              style={{
                fontSize: 13,
                height: 48,
                padding: '0 36px',
                borderRadius: 3,
                letterSpacing: '0.08em',
              }}
            >
              AUTHENTICATE & ENTER
            </Button>
            <button
              onClick={() => {
                const el = document.getElementById('modules')
                if (el) el.scrollIntoView({ behavior: 'smooth' })
              }}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--ab-font-mono)',
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ab-text-3)',
                padding: '6px 0',
                position: 'relative',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--ab-copper)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--ab-text-3)'}
            >
              EXPLORE MODULES ↓
            </button>
          </div>

          {/* Hero metadata strip */}
          <div className="ab-reveal ab-reveal-5" style={{
            display: 'flex',
            gap: 48,
            marginTop: 80,
            paddingTop: 28,
            borderTop: '1px solid var(--ab-line)',
            flexWrap: 'wrap',
          }}>
            {[
              { k: 'AGENTS', v: '20+' },
              { k: 'CHANNELS', v: '05' },
              { k: 'TASK TYPES', v: '04 + ERP + CRM + 学术/小说' },
              { k: 'LANGUAGES', v: 'JAVA / TS / GO' },
            ].map(s => (
              <div key={s.k}>
                <div className="ab-mono-dim" style={{ fontSize: 10, marginBottom: 6 }}>{s.k}</div>
                <div style={{
                  fontFamily: 'var(--ab-font-display)',
                  fontSize: 28,
                  fontWeight: 300,
                  color: 'var(--ab-text)',
                  letterSpacing: '-0.01em',
                }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ab-hairline" style={{ maxWidth: 1240, margin: '0 auto' }} />

      {/* Agent Categories */}
      <div id="modules" style={{ maxWidth: 1240, margin: '0 auto', padding: '88px 32px', scrollMarginTop: 64, position: 'relative', zIndex: 2 }}>
        <div style={{ marginBottom: 56, maxWidth: 720 }}>
          <div className="ab-mono-label" style={{ marginBottom: 18 }}>03 / Modules</div>
          <h2 className="ab-display" style={{ fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 300, margin: '0 0 16px' }}>
            Core <em>capability</em> matrix
          </h2>
          <p style={{ color: 'var(--ab-text-3)', fontSize: 15, lineHeight: 1.7, fontFamily: 'var(--ab-font-body)' }}>
            八个任务域, 每个域由专职 Agent 编排执行 — 从推理检索、代码生成、SQL 执行, 到 ERP/CRM 业务、
            学术研究与小说创作, 端到端无需人工切换工具。
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <Spin size="large" />
          </div>
        ) : (
          <Row gutter={[28, 28]}>
            {agentCategories.map((category, idx) => {
              const accent = ACCENT_COLOR[category.accent] || 'var(--ab-copper)'
              return (
                <Col xs={24} md={12} lg={8} key={category.id}>
                  <div
                    className="ab-surface ab-reveal"
                    style={{
                      padding: '28px 28px 24px',
                      height: '100%',
                      transition: 'border-color 0.3s, transform 0.3s',
                      animationDelay: `${0.08 * idx + 0.1}s`,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--ab-line-bold)'
                      e.currentTarget.style.transform = 'translateY(-2px)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--ab-line)'
                      e.currentTarget.style.transform = 'translateY(0)'
                    }}
                  >
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                      <div style={{
                        width: 44, height: 44,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: `1px solid ${accent}`,
                        color: accent,
                        fontSize: 22,
                        background: 'var(--ab-bg)',
                        borderRadius: 3,
                      }}>
                        {category.icon}
                      </div>
                      <span className="ab-mono-dim" style={{ fontSize: 10 }}>
                        {String(idx + 1).padStart(2, '0')} / 08
                      </span>
                    </div>

                    <h3 className="ab-display" style={{ fontSize: 26, fontWeight: 400, margin: '0 0 4px', color: 'var(--ab-text)' }}>
                      {category.title}
                    </h3>
                    <div className="ab-mono-dim" style={{ fontSize: 10, marginBottom: 10, color: accent }}>
                      {category.subtitle}
                    </div>
                    <p style={{ color: 'var(--ab-text-2)', fontSize: 13, lineHeight: 1.65, marginBottom: 16, fontFamily: 'var(--ab-font-body)' }}>
                      {category.description}
                    </p>

                    {category.channels && category.channels.length > 0 && (
                      <div style={{ marginBottom: 18, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {category.channels.map((ch) => (
                          <span key={ch.key} className="ab-tag ab-tag-teal" style={{ fontSize: 9 }}>
                            {ch.icon} {ch.label}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid var(--ab-line)', paddingTop: 16, marginTop: 'auto' }}>
                      {category.agents.map((agent, aIdx) => (
                        <div key={agent.name} style={{
                          padding: '10px 0',
                          borderBottom: aIdx < category.agents.length - 1 ? '1px dashed var(--ab-line)' : 'none',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                            <span style={{
                              fontFamily: 'var(--ab-font-mono)',
                              fontSize: 12.5,
                              color: 'var(--ab-text)',
                              fontWeight: 500,
                            }}>
                              {agent.name}
                            </span>
                          </div>
                          <div style={{ color: 'var(--ab-text-3)', fontSize: 11.5, fontFamily: 'var(--ab-font-body)', marginBottom: 8 }}>
                            {agent.desc}
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {agent.features.map((feature, fIdx) => (
                              <span key={fIdx} className="ab-tag" style={{ fontSize: 9 }}>
                                {feature}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Col>
              )
            })}
          </Row>
        )}
      </div>

      <div className="ab-hairline" style={{ maxWidth: 1240, margin: '0 auto' }} />

      {/* How It Works */}
      <div id="workflow" style={{ maxWidth: 1240, margin: '0 auto', padding: '88px 32px', scrollMarginTop: 64, position: 'relative', zIndex: 2 }}>
        <div style={{ marginBottom: 56, maxWidth: 720 }}>
          <div className="ab-mono-label" style={{ marginBottom: 18 }}>04 / Workflow</div>
          <h2 className="ab-display" style={{ fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 300, margin: '0 0 16px' }}>
            From intent to <em>artifact</em>
          </h2>
          <p style={{ color: 'var(--ab-text-3)', fontSize: 15, lineHeight: 1.7, fontFamily: 'var(--ab-font-body)' }}>
            四阶段编排: 自然语言输入 → 智能规划 → 多 Agent 协同执行 → 结果汇总呈现。
          </p>
        </div>

        <div style={{ position: 'relative' }}>
          {/* connecting line */}
          <div style={{
            position: 'absolute',
            top: 32,
            left: '8%',
            right: '8%',
            height: 1,
            background: 'linear-gradient(90deg, transparent, var(--ab-line-bold), var(--ab-line-bold), transparent)',
            display: 'none',
          }} />

          <Row gutter={[24, 32]} style={{ marginTop: 16 }}>
            {[
              {
                step: '01',
                title: 'Intent Capture',
                subtitle: '用户输入需求',
                desc: '通过聊天界面描述任务目标, 可上传文档、图片等辅助材料',
                icon: <LayoutOutlined />,
              },
              {
                step: '02',
                title: 'Planning',
                subtitle: '智能规划分解',
                desc: 'PlannerAgent 分析需求, 分解为多个可执行步骤并分配给相应 Agent',
                icon: <SettingOutlined />,
              },
              {
                step: '03',
                title: 'Execution',
                subtitle: '多 Agent 协同',
                desc: '各专业 Agent 并行或串行执行任务, 实时交换上下文信息',
                icon: <RobotOutlined />,
              },
              {
                step: '04',
                title: 'Synthesis',
                subtitle: '结果汇总呈现',
                desc: 'SummaryAgent 整合执行结果, 生成报告或可视化图表展示给用户',
                icon: <LineChartOutlined />,
              }
            ].map((item, idx) => (
              <Col xs={24} md={12} lg={6} key={idx}>
                <div
                  className="ab-reveal"
                  style={{
                    animationDelay: `${0.1 * idx + 0.1}s`,
                    padding: '32px 24px 28px',
                    background: 'var(--ab-surface)',
                    border: '1px solid var(--ab-line)',
                    borderRadius: 4,
                    height: '100%',
                    position: 'relative',
                    transition: 'border-color 0.3s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ab-line-bold)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--ab-line)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                    <span style={{
                      fontFamily: 'var(--ab-font-display)',
                      fontSize: 44,
                      fontWeight: 300,
                      color: 'var(--ab-copper)',
                      lineHeight: 1,
                      letterSpacing: '-0.03em',
                    }}>
                      {item.step}
                    </span>
                    <span style={{
                      width: 36, height: 36,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--ab-text-2)',
                      fontSize: 18,
                      border: '1px solid var(--ab-line)',
                      borderRadius: '50%',
                    }}>
                      {item.icon}
                    </span>
                  </div>
                  <h4 className="ab-display" style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', color: 'var(--ab-text)' }}>
                    {item.title}
                  </h4>
                  <div className="ab-mono-dim" style={{ fontSize: 10, marginBottom: 12 }}>
                    {item.subtitle}
                  </div>
                  <p style={{ color: 'var(--ab-text-3)', fontSize: 12.5, lineHeight: 1.7, fontFamily: 'var(--ab-font-body)' }}>
                    {item.desc}
                  </p>
                </div>
              </Col>
            ))}
          </Row>
        </div>
      </div>

      {/* CTA Section */}
      <div id="cta" style={{
        maxWidth: 1240,
        margin: '60px auto 80px',
        padding: '0 32px',
        scrollMarginTop: 64,
        position: 'relative',
        zIndex: 2,
      }}>
        <div className="ab-surface ab-reveal" style={{
          padding: '88px 56px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--ab-surface)',
        }}>
          <div className="ab-grid-bg" style={{ opacity: 0.4 }} />
          <div style={{ position: 'relative', zIndex: 2 }}>
            <div className="ab-mono-label" style={{ justifyContent: 'center', marginBottom: 24 }}>
              05 / Begin
            </div>
            <h2 className="ab-display" style={{
              fontSize: 'clamp(40px, 6vw, 64px)',
              fontWeight: 300,
              margin: '0 0 20px',
              letterSpacing: '-0.025em',
            }}>
              Ready to <em>orchestrate</em>?
            </h2>
            <p style={{
              color: 'var(--ab-text-2)',
              fontSize: 16,
              lineHeight: 1.7,
              maxWidth: 520,
              margin: '0 auto 40px',
              fontFamily: 'var(--ab-font-body)',
            }}>
              登录系统, 体验智能代理带来的高效工作流。
            </p>
            <Button
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              onClick={onLoginClick}
              className="ab-btn-copper"
              style={{
                fontSize: 13,
                height: 48,
                padding: '0 40px',
                borderRadius: 3,
                letterSpacing: '0.08em',
              }}
            >
              AUTHENTICATE & ENTER
            </Button>
          </div>
        </div>
      </div>

      {/* Install Section — 移至页面底部 */}
      <div id="install" style={{ maxWidth: 1240, margin: '0 auto 80px', padding: '0 32px', scrollMarginTop: 64, position: 'relative', zIndex: 2 }}>
        <InstallCard />
        <DesktopClientCard />
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--ab-line)',
        padding: '32px',
      }}>
        <div style={{
          maxWidth: 1240,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <span style={{
            fontFamily: 'var(--ab-font-mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--ab-text-4)',
            textTransform: 'uppercase',
          }}>
            AUTOBOT © 2026 · LLM × MULTI-AGENT
          </span>
          <span style={{
            fontFamily: 'var(--ab-font-mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--ab-text-4)',
            textTransform: 'uppercase',
          }}>
            ATELIER / COMMAND CENTER
          </span>
        </div>
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
