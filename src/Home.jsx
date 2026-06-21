import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Typography, Button, Row, Col, Divider, Tag, Space, List, Avatar, Spin, Alert } from 'antd'
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
  MessageOutlined
} from '@ant-design/icons'
import api, { isAuthenticated } from './auth'

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
        desc: '多格式文档解析（PDF/Word/Excel）',
        features: ['文本提取', '图片识别', '表格转换']
      },
      {
        name: 'KnowledgeExtractorAgent',
        desc: '从文档中提取结构化知识与实体',
        features: ['实体识别', '关系抽取', '知识图谱']
      },
      {
        name: 'DocumentArchitectAgent',
        desc: '文档架构设计与模板生成',
        features: ['架构规划', '模板创建', '内容组织']
      }
    ]
  },
  {
    id: 'debug',
    title: '调试与诊断 Agent',
    description: '问题定位、日志分析与错误修复',
    icon: <BugOutlined style={{ fontSize: 32, color: '#ff4d4f' }} />,
    agents: [
      {
        name: 'DebugAgent',
        desc: '运行时调试与问题诊断',
        features: ['日志分析', '堆栈追踪', '断点调试']
      },
      {
        name: 'ReflectionAgent',
        desc: '自我反思与策略优化',
        features: ['结果评估', '策略调整', '经验积累']
      },
      {
        name: 'CriticAgent',
        desc: '代码与方案审查，发现潜在问题',
        features: ['质量检查', '安全审计', '性能评估']
      }
    ]
  },
  {
    id: 'visual',
    title: '可视化与 UI 生成 Agent',
    description: '数据可视化图表与交互式界面生成',
    icon: <LineChartOutlined style={{ fontSize: 32, color: '#eb2f96' }} />,
    agents: [
      {
        name: 'UIAgent',
        desc: '生成数据可视化 HTML 仪表板',
        features: ['图表渲染', '仪表盘布局', '交互组件']
      },
      {
        name: 'VisualAgent',
        desc: '视觉内容分析与图像理解',
        features: ['图像识别', '场景分析', 'OCR 文字提取']
      }
    ]
  },
  {
    id: 'reasoning',
    title: '推理与规划 Agent',
    description: '复杂任务分解与多步推理',
    icon: <MessageOutlined style={{ fontSize: 32, color: '#13c2c2' }} />,
    agents: [
      {
        name: 'PlannerAgent',
        desc: '任务规划与步骤分解',
        features: ['目标分析', '步骤规划', '依赖管理']
      },
      {
        name: 'ReasoningAgent',
        desc: '多步逻辑推理与决策',
        features: ['逻辑推导', '方案比较', '最优选择']
      },
      {
        name: 'SummaryAgent',
        desc: '信息汇总与报告生成',
        features: ['内容摘要', '要点提炼', '格式输出']
      }
    ]
  },
  {
    id: 'sync',
    title: '同步与集成 Agent',
    description: '数据同步、ERP 集成与自动化任务',
    icon: <SyncOutlined style={{ fontSize: 32, color: '#fa8c16' }} />,
    agents: [
      {
        name: 'ERPOrchestrator',
        desc: 'ERP 系统协调与订单处理',
        features: ['订单管理', '库存同步', '财务对账']
      },
      {
        name: 'ScheduledTaskAgent',
        desc: '定时任务调度与执行',
        features: ['任务排期', '自动触发', '状态监控']
      },
      {
        name: 'MemoryAgent',
        desc: '会话记忆与上下文管理',
        features: ['历史追溯', '偏好学习', '状态保存']
      }
    ]
  }
]

export default function Home({ onLoginSuccess }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [agentsData, setAgentsData] = useState(null)

  useEffect(() => {
    // Check if user is already logged in
    if (isAuthenticated()) {
      onLoginSuccess()
    }
  }, [])

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

  useEffect(() => {
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
            fontWeight: 700,
            marginBottom: 16,
            letterSpacing: 2
          }}>
            AutoBot 智能代理系统
          </Title>
          <Paragraph style={{
            color: '#888',
            fontSize: '18px',
            lineHeight: 1.8,
            marginBottom: 32,
            maxWidth: 600,
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            基于大语言模型的多 Agent 协作平台，支持代码开发、数据分析、Web 交互、文档处理等八大领域任务
          </Paragraph>
          <Space size="large">
            <Button
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              onClick={() => onLoginSuccess()}
              style={{
                fontSize: '16px',
                padding: '12px 40px',
                borderRadius: 8,
                background: '#1677ff',
                border: 'none'
              }}
            >
              立即登录
            </Button>
            <Button
              size="large"
              icon={<AppstoreOutlined />}
              style={{
                fontSize: '16px',
                padding: '12px 40px',
                borderRadius: 8,
                background: 'transparent',
                border: '1px solid #2a2a2a',
                color: '#fff'
              }}
              onClick={() => window.scrollTo({ top: 800, behavior: 'smooth' })}
            >
              了解更多
            </Button>
          </Space>
        </div>
      </div>

      {/* Features Grid */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 20px' }}>
        <Title level={2} style={{
          color: '#fff',
          textAlign: 'center',
          marginBottom: 48,
          fontSize: '32px'
        }}>
          核心功能领域
        </Title>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" tip="加载中..." />
          </div>
        ) : (
          <Row gutter={[32, 32]}>
            {agentCategories.map((category) => (
              <Col xs={24} md={12} lg={8} key={category.id}>
                <Card
                  hoverable
                  style={{
                    height: '100%',
                    background: 'rgba(26, 26, 46, 0.8)',
                    border: '1px solid #2a2a2a',
                    borderRadius: 12,
                    transition: 'all 0.3s ease'
                  }}
                  bodyStyle={{ padding: '24px' }}
                >
                  <div style={{ marginBottom: 20 }}>
                    {category.icon}
                    <Title level={4} style={{
                      color: '#fff',
                      fontSize: '18px',
                      marginTop: 12,
                      marginBottom: 8
                    }}>
                      {category.title}
                    </Title>
                    <Text style={{ color: '#888', fontSize: '13px', lineHeight: 1.6 }}>
                      {category.description}
                    </Text>
                  </div>

                  <Divider style={{ borderColor: '#2a2a2a', margin: '16px 0' }} />

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
          onClick={() => onLoginSuccess()}
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
