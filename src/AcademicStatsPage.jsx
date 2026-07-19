/**
 * 2026-07-18: ReAct 闭环效果统计页面（管理后台）。
 *
 * 数据来源：GET /api/academic/admin/section-statistics
 * 展示维度：
 *   1. 顶部卡片：总研究数 / 总章节数 / 总子小节数 / 平均相似度
 *   2. revise_method 分布饼图（two-step / single-call / debate-failed / subsection / subsection-retry）
 *   3. consistency_check 分布饼图（normal / low_revision / high_revision / skipped）
 *   4. 报告类型 × revise_method 交叉统计表格
 *   5. 相似度分布统计
 *
 * 权限：仅 SUPER_ADMIN / COMPANY_ADMIN 可访问（后端已校验，前端菜单也只对管理员可见）
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Layout, Card, Row, Col, Statistic, Spin, Empty, Tag, Table, Button, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import api from './auth'

const { Content } = Layout

// ── 颜色配置 ──────────────────────────────────────────────
const METHOD_COLORS = {
  'two-step':         '#16a34a',  // 绿色：理想路径
  'single-call':      '#d97706',  // 橙色：降级路径
  'debate-failed':    '#dc2626',  // 红色：失败
  'subsection':       '#2563eb',  // 蓝色：子小节路径
  'subsection-retry': '#7c3aed',  // 紫色：截断重试
}
const CONSISTENCY_COLORS = {
  'normal':        '#16a34a',        // 绿色：正常
  'low_revision':  '#dc2626',        // 红色：修订不足
  'high_revision': '#d97706',        // 橙色：大幅重写
  'skipped':       '#9ca3af',        // 灰色：跳过
}

// ── 文案映射 ──────────────────────────────────────────────
const METHOD_LABELS = {
  'two-step':         '两步 ReAct',
  'single-call':      '单次降级',
  'debate-failed':    '未修订',
  'subsection':       '子小节路径',
  'subsection-retry': '拆分重试',
}
const CONSISTENCY_LABELS = {
  'normal':        '正常修订',
  'low_revision':  '修订不足',
  'high_revision': '大幅重写',
  'skipped':       '跳过',
}
const REPORT_TYPE_LABELS = {
  'policy_advice': '对策建议型',
  'forecast':      '预警研判型',
  'evaluation':    '评估验证型',
  'empirical':     '调研实证型',
  'lesson_plan':   '编写教案',
}

// ── 主组件 ──────────────────────────────────────────────
export default function AcademicStatsPage() {
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/academic/admin/section-statistics')
      if (res.data) setStats(res.data)
    } catch (e) {
      message.error('加载统计失败: ' + (e.response?.data?.error || e.message))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  // 转换为饼图数据
  const methodPieData = stats?.method_stats
    ? Object.entries(stats.method_stats).map(([k, v]) => ({ name: METHOD_LABELS[k] || k, value: v, key: k }))
    : []
  const consistencyPieData = stats?.consistency_stats
    ? Object.entries(stats.consistency_stats).map(([k, v]) => ({ name: CONSISTENCY_LABELS[k] || k, value: v, key: k }))
    : []

  // 报告类型 × 方法交叉表格数据
  const reportTypeTableData = stats?.report_type_method_stats
    ? Object.entries(stats.report_type_method_stats).map(([reportType, methods], idx) => {
        const row = { key: idx, reportType, reportTypeLabel: REPORT_TYPE_LABELS[reportType] || reportType }
        let total = 0
        Object.entries(methods).forEach(([m, c]) => { row[m] = c; total += c })
        row.total = total
        return row
      })
    : []

  // 报告类型柱状图数据
  const reportTypeBarData = reportTypeTableData.map(r => ({
    name: r.reportTypeLabel,
    '两步 ReAct': r['two-step'] || 0,
    '单次降级': r['single-call'] || 0,
    '未修订': r['debate-failed'] || 0,
    '子小节路径': r['subsection'] || 0,
    '拆分重试': r['subsection-retry'] || 0,
  }))

  // 表格列定义
  const reportTypeColumns = [
    { title: '报告类型', dataIndex: 'reportTypeLabel', key: 'reportTypeLabel', fixed: 'left', width: 140 },
    { title: '两步 ReAct', dataIndex: 'two-step', key: 'two-step', render: v => v ? <Tag color="green">{v}</Tag> : '-' },
    { title: '单次降级', dataIndex: 'single-call', key: 'single-call', render: v => v ? <Tag color="orange">{v}</Tag> : '-' },
    { title: '未修订', dataIndex: 'debate-failed', key: 'debate-failed', render: v => v ? <Tag color="red">{v}</Tag> : '-' },
    { title: '子小节路径', dataIndex: 'subsection', key: 'subsection', render: v => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '拆分重试', dataIndex: 'subsection-retry', key: 'subsection-retry', render: v => v ? <Tag color="purple">{v}</Tag> : '-' },
    { title: '总计', dataIndex: 'total', key: 'total', render: v => <strong>{v}</strong> },
  ]

  return (
    <Layout style={{ background: '#0d0d0d', height: '100%' }}>
      <Content style={{ padding: 24, height: '100%', overflow: 'auto' }} className="custom-scrollbar">
        {/* 标题栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ color: '#e3e3e3', margin: 0, fontSize: 22, fontFamily: "'Fraunces', serif", fontWeight: 400 }}>
              ReAct 闭环效果统计
            </h2>
            <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
              统计所有已完成学术报告的章节修订方式与一致性校验结果
            </div>
          </div>
          <Button icon={<ReloadOutlined />} onClick={fetchStats} loading={loading}>
            刷新
          </Button>
        </div>

        <Spin spinning={loading}>
          {stats ? (
            <>
              {/* ── 顶部统计卡片 ── */}
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                  <Card style={{ background: '#1a1a1a', borderColor: '#333' }}>
                    <Statistic title={<span style={{ color: '#888' }}>已完成研究</span>}
                      value={stats.total_researches || 0}
                      valueStyle={{ color: '#e3e3e3' }} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card style={{ background: '#1a1a1a', borderColor: '#333' }}>
                    <Statistic title={<span style={{ color: '#888' }}>总章节数</span>}
                      value={stats.total_sections || 0}
                      valueStyle={{ color: '#e3e3e3' }} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card style={{ background: '#1a1a1a', borderColor: '#333' }}>
                    <Statistic title={<span style={{ color: '#888' }}>总子小节数</span>}
                      value={stats.total_subsections || 0}
                      valueStyle={{ color: '#e3e3e3' }} />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card style={{ background: '#1a1a1a', borderColor: '#333' }}>
                    <Statistic title={<span style={{ color: '#888' }}>平均相似度</span>}
                      value={stats.similarity_stats?.avg || 0}
                      precision={2}
                      suffix={stats.similarity_stats?.count > 0 ? ` (n=${stats.similarity_stats.count})` : ''}
                      valueStyle={{ color: '#d4a574' }} />
                  </Card>
                </Col>
              </Row>

              {/* ── 饼图区：revise_method + consistency_check ── */}
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={12}>
                  <Card title={<span style={{ color: '#e3e3e3' }}>修订方式分布（revise_method）</span>}
                    style={{ background: '#1a1a1a', borderColor: '#333' }}
                    headStyle={{ borderColor: '#333', color: '#e3e3e3' }}>
                    {methodPieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie data={methodPieData} dataKey="value" nameKey="name"
                            cx="50%" cy="50%" outerRadius={100} label>
                            {methodPieData.map((entry, idx) => (
                              <Cell key={idx} fill={METHOD_COLORS[entry.key] || '#888'} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#e3e3e3' }} />
                          <Legend wrapperStyle={{ color: '#e3e3e3' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <Empty description="暂无数据" />}
                  </Card>
                </Col>
                <Col span={12}>
                  <Card title={<span style={{ color: '#e3e3e3' }}>一致性校验分布（consistency_check）</span>}
                    style={{ background: '#1a1a1a', borderColor: '#333' }}
                    headStyle={{ borderColor: '#333', color: '#e3e3e3' }}>
                    {consistencyPieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie data={consistencyPieData} dataKey="value" nameKey="name"
                            cx="50%" cy="50%" outerRadius={100} label>
                            {consistencyPieData.map((entry, idx) => (
                              <Cell key={idx} fill={CONSISTENCY_COLORS[entry.key] || '#888'} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#e3e3e3' }} />
                          <Legend wrapperStyle={{ color: '#e3e3e3' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <Empty description="暂无数据" />}
                  </Card>
                </Col>
              </Row>

              {/* ── 相似度统计卡片 ── */}
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={24}>
                  <Card title={<span style={{ color: '#e3e3e3' }}>相似度统计（draft vs refined）</span>}
                    style={{ background: '#1a1a1a', borderColor: '#333' }}
                    headStyle={{ borderColor: '#333', color: '#e3e3e3' }}>
                    <Row gutter={32}>
                      <Col span={6}>
                        <Statistic title={<span style={{ color: '#888' }}>平均相似度</span>}
                          value={stats.similarity_stats?.avg || 0} precision={2}
                          valueStyle={{ color: '#d4a574' }} />
                      </Col>
                      <Col span={6}>
                        <Statistic title={<span style={{ color: '#888' }}>最小相似度</span>}
                          value={stats.similarity_stats?.min || 0} precision={2}
                          valueStyle={{ color: '#dc2626' }} />
                      </Col>
                      <Col span={6}>
                        <Statistic title={<span style={{ color: '#888' }}>最大相似度</span>}
                          value={stats.similarity_stats?.max || 0} precision={2}
                          valueStyle={{ color: '#16a34a' }} />
                      </Col>
                      <Col span={6}>
                        <Statistic title={<span style={{ color: '#888' }}>样本数</span>}
                          value={stats.similarity_stats?.count || 0}
                          valueStyle={{ color: '#e3e3e3' }} />
                      </Col>
                    </Row>
                    <div style={{ marginTop: 16, color: '#888', fontSize: 12, lineHeight: 1.6 }}>
                      <div>◇ 相似度 &gt; 0.95：修订不足（refined 几乎未修改 draft，可能 LLM 偷懒）</div>
                      <div>◇ 相似度 0.3-0.95：正常修订幅度</div>
                      <div>◇ 相似度 &lt; 0.3：大幅重写（可能过度修改）</div>
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* ── 报告类型 × 方法 交叉统计 ── */}
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={24}>
                  <Card title={<span style={{ color: '#e3e3e3' }}>报告类型 × 修订方式交叉统计</span>}
                    style={{ background: '#1a1a1a', borderColor: '#333' }}
                    headStyle={{ borderColor: '#333', color: '#e3e3e3' }}>
                    <Table dataSource={reportTypeTableData} columns={reportTypeColumns}
                      pagination={false} size="small"
                      rowKey="key"
                      style={{ background: 'transparent' }} />
                  </Card>
                </Col>
              </Row>

              {/* ── 报告类型柱状图 ── */}
              {reportTypeBarData.length > 0 && (
                <Row gutter={16}>
                  <Col span={24}>
                    <Card title={<span style={{ color: '#e3e3e3' }}>各报告类型修订方式分布</span>}
                      style={{ background: '#1a1a1a', borderColor: '#333' }}
                      headStyle={{ borderColor: '#333', color: '#e3e3e3' }}>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={reportTypeBarData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                          <XAxis dataKey="name" stroke="#888" />
                          <YAxis stroke="#888" />
                          <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#e3e3e3' }} />
                          <Legend wrapperStyle={{ color: '#e3e3e3' }} />
                          <Bar dataKey="两步 ReAct" stackId="a" fill={METHOD_COLORS['two-step']} />
                          <Bar dataKey="单次降级" stackId="a" fill={METHOD_COLORS['single-call']} />
                          <Bar dataKey="未修订" stackId="a" fill={METHOD_COLORS['debate-failed']} />
                          <Bar dataKey="子小节路径" stackId="a" fill={METHOD_COLORS['subsection']} />
                          <Bar dataKey="拆分重试" stackId="a" fill={METHOD_COLORS['subsection-retry']} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                  </Col>
                </Row>
              )}
            </>
          ) : (
            !loading && <Empty description="暂无统计数据" />
          )}
        </Spin>
      </Content>
    </Layout>
  )
}
