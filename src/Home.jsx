import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Typography, Button, Row, Col, Divider, Tag, Space, List, Avatar, Spin, Alert, message } from 'antd'
import api, { isAuthenticated } from './auth'
import {
  RobotOutlined,
  CodeOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  FileTextOutlined,
  BugOutlined,
  LineChartOutlined,
  LayoutOutlined,
  VideoCameraOutlined,
  ThunderboltOutlined,
  LoginOutlined,
  SettingOutlined,
  AppstoreOutlined,
  ProfileOutlined,
  ClusterOutlined,
  SyncOutlined,
  MessageOutlined,
  UserOutlined,
  LockOutlined
} from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

// Agent 功能描述数据
const agentCategories = [
  {
    id: 'code',
    title: '代码开发 Agent',
    description: '自动化代码分析、生成与修复',
    icon: <CodeOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
    agents: [
      {
        name: 'CodeAgent',
        desc: '代码生成与编辑，支持多语言（Java/TypeScript/Go）',
        features: ['代码生成', '文件编辑', '构建执行', '错误修复']
      },
      {
        name: 'CodeAnalysisAgent',
        desc: '静态代码分析，识别潜在问题与优化建议',
        features: ['代码扫描', '问题检测', '报告生成']
      },
      {
        name: 'CodeValidatorAgent',
        desc: '代码验证与测试，确保修改正确性',
        features: ['单元测试', '集成验证', '回归检测']
      }
    ]
  },
  {
    id: 'data',
    title: '数据分析 Agent',
    description: '数据库查询、数据探索与可视化分析',
    icon: <DatabaseOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
    agents: [
      {
        name: 'DBSqlAgent',
        desc: '智能 SQL 生成与执行，支持多数据库类型',
        features: ['SQL 生成', '查询优化', '安全验证', '结果格式化']
      },
      {
        name: 'DataProfilerAgent',
        desc: '数据探查与统计，自动生成数据概览',
        features: ['数据分布', '异常检测', '统计指标']
      },
      {
        name: 'DataStoreAgent',
        desc: '数据持久化与检索，支持大规模数据集',
        features: ['数据存储', '索引构建', '高效查询']
      }
    ]
  },
  {
    id: 'web',
    title: 'Web 交互 Agent',
    description: '浏览器自动化与网页内容处理',
    icon: <GlobalOutlined style={{ fontSize: 32, color: '#faad14' }} />,
    agents: [
      {
        name: 'BrowserAgent',
        desc: '浏览器自动化操作，支持网页导航与交互',
        features: ['页面访问', '元素定位', '表单填写', '截图保存']
      },
      {
        name: 'RagQueryAgent',
        desc: '基于知识库的问答检索，精准获取信息',
        features: ['语义检索', '知识整合', '答案生成']
      }
    ]
  },
  {
    id: 'document',
    title: '文档处理 Agent',
    description: '文档解析、提取与知识管理',
    icon: <FileTextOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
    agents: [
      {
        name: 'DocumentAgent',
        desc: '文档解析与内容提取，支持多种格式',
        features: ['PDF 解析', 'Office 文档', '文本提取']
      },
      {
        name: 'KnowledgeExtractorAgent',
        desc: '知识图谱构建与三元组提取',
        features: ['实体识别', '关系抽取', '图谱存储']
      },
      {
        name: 'DocumentArchitectAgent',
        desc: '文档架构设计与蓝图生成',
        features: ['结构规划', '章节设计', '依赖分析']
      }
    ]
  },
  {
    id: 'debug',
    title: '调试与诊断 Agent',
    description: '智能错误定位与问题修复',
    icon: <BugOutlined style={{ fontSize: 32, color: '#eb2f96' }} />,
    agents: [
      {
        name: 'DebugAgent',
        desc: '调试信息收集与异常分析',
        features: ['日志分析', '堆栈追踪', '断点管理']
      },
      {
        name: 'ReflectionAgent',
        desc: '自我反思与执行优化',
        features: ['结果评估', '策略调整', '经验积累']
      },
      {
        name: 'CriticAgent',
        desc: '代码与方案质量评审',
        features: ['一致性检查', '事实验证', '逻辑评估']
      }
    ]
  },
  {
    id: 'visual',
    title: '可视化与 UI 生成 Agent',
    description: '数据可视化与界面自动生成',
    icon: <LineChartOutlined style={{ fontSize: 32, color: '#faad14' }} />,
    agents: [
      {
        name: 'UIAgent',
        desc: 'HTML/CSS界面生成与渲染',
        features: ['页面布局', '样式设计', '交互实现']
      },
      {
        name: 'VisualAgent',
        desc: '图表与可视化元素生成',
        features: ['Mermaid 图表', '数据可视化', '流程图']
      }
    ]
  },
  {
    id: 'reasoning',
    title: '推理与规划 Agent',
    description: '复杂任务分解与多步推理',
    icon: <RobotOutlined style={{ fontSize: 32, color: '#1677ff' }} />,
    agents: [
      {
        name: 'PlannerAgent',
        desc: '任务分解与执行计划生成',
        features: ['意图识别', '步骤规划', '依赖分析']
      },
      {
        name: 'ReasoningAgent',
        desc: '多步推理与问题求解',
        features: ['逻辑推理', '工具调用', '自纠错']
      },
      {
        name: 'SummaryAgent',
        desc: '结果汇总与报告生成',
        features: ['信息整合', '要点提炼', '格式输出']
      }
    ]
  },
  {
    id: 'sync',
    title: '同步与集成 Agent',
    description: '外部系统集成与数据同步',
    icon: <SyncOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
    agents: [
      {
        name: 'ERPOrchestrator',
        desc: 'ERP 系统流程编排与执行',
        features: ['订单处理', '库存管理', '财务对账']
      },
      {
        name: 'ScheduledTaskAgent',
        desc: '定时任务调度与执行',
        features: ['任务编排', '时间触发', '状态监控']
      },
      {
        name: 'MemoryAgent',
        desc: '会话记忆与上下文管理',
        features: ['历史追溯', '偏好学习', '状态保存']
      }
    ]
  }
]

// 登录表单组件
function LoginForm({ onLoginSuccess, onBackToHome }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

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
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
    }}>
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
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a2e 50%, #16213e 100%)',
      position: 'relative'
    }}>
      {/* Hero Section */}
      <div style={{
        padding: '80px 20px 60px',
        textAlign: 'center',
        background: 'radial-gradient(ellipse at center, rgba(22, 119, 255, 0.1) 0%, transparent 70%)'
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
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 20px' }}>
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

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 20px' }}>
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
      <div style={{
        maxWidth: 900,
        margin: '80px auto 60px',
        padding: '60px 40px',
        background: 'linear-gradient(135deg, rgba(22, 119, 255, 0.1), rgba(26, 115, 232, 0.1))',
        borderRadius: 16,
        border: '1px solid rgba(22, 119, 255, 0.3)',
        textAlign: 'center'
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
