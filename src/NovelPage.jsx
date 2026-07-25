// 2026-07-20: 小说创作页 — 精简三步流程
// 复用学术研究后端接口(/api/academic/research*), report_type="novel" 区分
// 权限: 公司勾选 novel channel 后, 该公司用户可见 SessionSidebar 中的"小说创作"入口
//
// 三步流程:
//   STEP 01 选择题材 (4卡片: 言情/玄幻/科幻/悬疑, 对应后端 4 个模板)
//   STEP 02 输入简短提要 (大号衬线 textarea, 50-200 字)
//   STEP 03 一键生成 + 进度展示 + 报告展示 (分屏: 大纲 + 章节正文)
//
// 跳过学术研究页的: 搜索资料步骤(小说不引用资料)、模板选择步骤(题材即模板)
// 复用学术研究页的: 状态机/卡住检测/resumeBatch/段落扩展/分屏报告渲染

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button, Spin, message, Tooltip, Modal, Form, Input, InputNumber, Popconfirm, Select, Empty, Checkbox, Drawer, Grid } from 'antd'
import {
  ArrowLeftOutlined, ArrowRightOutlined, EditOutlined, ReadOutlined,
  CopyOutlined, FileTextOutlined, ReloadOutlined, StopOutlined,
  PlusOutlined, CheckOutlined, CloseOutlined, RollbackOutlined,
  LeftOutlined, RightOutlined, UpOutlined, DownOutlined,
  DeleteOutlined, SettingOutlined, LockOutlined, TeamOutlined, UserOutlined, ShareAltOutlined,
  MenuOutlined,
} from '@ant-design/icons'
import ReactFlow, { Background, Controls, MiniMap, MarkerType } from 'reactflow'
import 'reactflow/dist/style.css'
import api, { getWsBaseUrl } from './auth'
import { useUIStore } from './store/useUIStore'
import { stripThinking } from './utils/helpers.jsx'

// ── 题材定义（对应后端 AcademicReportTemplates.java novel 4 个模板）──
// 每个题材有专属色调, 用于卡片左侧"书脊"色块和选中态边框
// 2026-07-22: 去掉故事弧线(desc)和卷结构(volumes/chaptersPerVolume/fullDesc) —
// 这些应由 LLM 基于用户输入的故事偏好生成, 而非题材硬编码.
// 题材卡片只保留: 名称 + 图标 + 一句话风格描述. volumes/chaptersPerVolume 保留在数据结构中
// 作为后端 fallback (用户未输入章节数时), 但不在 UI 显示.
const NOVEL_GENRES = [
  {
    id: 'novel-romance',
    name: '言情',
    numeral: 'Ⅰ',
    desc: '情感细腻，人物鲜活',
    volumes: 5,
    chaptersPerVolume: 30,
    accent: '#e8a4a4', // 玫瑰金
    spineGradient: 'linear-gradient(180deg, #e8a4a4 0%, #c97a6b 100%)',
    icon: '💝',
  },
  {
    id: 'novel-fantasy',
    name: '玄幻',
    numeral: 'Ⅱ',
    desc: '世界观宏大，战斗激烈',
    volumes: 6,
    chaptersPerVolume: 30,
    accent: '#a4b8e8', // 神秘蓝紫
    spineGradient: 'linear-gradient(180deg, #a4b8e8 0%, #6a7ab0 100%)',
    icon: '⚔️',
  },
  {
    id: 'novel-scifi',
    name: '科幻',
    numeral: 'Ⅲ',
    desc: '想象力丰富，概念硬核',
    volumes: 5,
    chaptersPerVolume: 30,
    accent: '#a4d8e8', // 科技青
    spineGradient: 'linear-gradient(180deg, #a4d8e8 0%, #4a9aa6 100%)',
    icon: '🚀',
  },
  {
    id: 'novel-mystery',
    name: '悬疑',
    numeral: 'Ⅳ',
    desc: '节奏紧凑，伏笔精密',
    volumes: 4,
    chaptersPerVolume: 30,
    accent: '#b8a4d8', // 深邃紫
    spineGradient: 'linear-gradient(180deg, #b8a4d8 0%, #7a6a9a 100%)',
    icon: '🔍',
  },
]

// 字体快捷引用
const serif = { fontFamily: 'var(--ab-font-display)' }
const body = { fontFamily: 'var(--ab-font-body)' }
const mono = { fontFamily: 'var(--ab-font-mono)' }

// ── StepShell: 步骤轴容器（简化版, 复用学术页设计语言）──
// ── CharacterGraphFlow: 人物关系图谱可视化 (react-flow) ─────────────
// 2026-07-21: 在大纲生成前独立一步, 让用户设计/调整人物关系.
// 节点 = 角色 (含 name/role/goal/personality), 边 = 关系 (含 type/description).
// 设计语言: 与 NovelPage 整体铜色调一致, 节点用铜色描边 + 半透明背景.
//
// 节点布局: 自动按圆形排布 (N 个角色均匀分布在圆周上), 用户可拖拽调整.
// 边样式: 按关系类型着色 — 合作(绿)/敌对(红)/师徒(金)/情感(粉)/亲属(蓝)/主仆(灰).

// 关系类型 → 边颜色 映射 (在组件外定义, 避免重复创建)
const RELATIONSHIP_COLORS = {
  '合作': '#7ec96b',
  '敌对': '#e85d5d',
  '师徒': '#d4a574',
  '情感': '#e8a4c4',
  '亲属': '#6b9ee8',
  '主仆': '#999999',
  '朋友': '#7ec96b',
  '恋人': '#e8a4c4',
  '仇人': '#e85d5d',
}

// 关系类型选项 (供新增关系表单的 Select 使用)
const RELATIONSHIP_TYPES = ['合作', '敌对', '师徒', '情感', '亲属', '主仆', '朋友', '恋人', '仇人']

function CharacterGraphFlow({ graph, onDeleteCharacter, onDeleteRelationship, onEditCharacter }) {
  // 把 characterGraph 数据转为 react-flow nodes/edges
  // 2026-07-21: useMemo 避免每次渲染都重算节点位置 (用户拖拽后位置由 react-flow 内部维护,
  // 但 graph 数据变化时需要重新计算布局).
  const nodes = useMemo(() => {
    if (!graph || !Array.isArray(graph.characters)) return []
    const n = graph.characters.length
    if (n === 0) return []
    const radius = Math.max(140, Math.min(260, 40 + n * 22))
    return graph.characters.map((c, i) => {
      // 圆形布局: 角度均匀分布, 起始角度从顶部 (-90°) 开始
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2
      const x = Math.cos(angle) * radius + 200
      const y = Math.sin(angle) * radius + 200
      return {
        id: c.id,
        type: 'characterNode',
        position: { x, y },
        data: { character: c, onDelete: onDeleteCharacter, onEdit: onEditCharacter },
        // 节点样式: 铜色描边 + 半透明背景, 不同 role 可扩展不同色调
        style: {
          background: 'rgba(212, 165, 116, 0.08)',
          border: '1px solid var(--ab-copper)',
          borderRadius: 8,
          padding: 0,
          width: 168,
        },
      }
    })
  }, [graph, onDeleteCharacter, onEditCharacter])

  const edges = useMemo(() => {
    if (!graph || !Array.isArray(graph.relationships)) return []
    return graph.relationships.map((r, i) => {
      const color = RELATIONSHIP_COLORS[r.type] || '#999'
      // 2026-07-22: 强化连线 label 显示 — 加大字号 + 加粗 + 更明显的背景, 让关系类型清晰可读.
      // 关系类型文字 (如"敌对"/"师徒"/"恋人") 显示在连线中点, 配色与关系类型一致.
      // labelShowBg=true 让文字有半透明背景, 避免与连线/节点重叠时看不清.
      return {
        id: `rel_${i}_${r.from}_${r.to}`,
        source: r.from,
        target: r.to,
        label: r.type,
        labelShowBg: true,
        labelStyle: { fill: '#fff', fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: color, fillOpacity: 0.85 },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4,
        // 2026-07-22: 连线加粗到 2px + markerEnd 箭头, 让关系方向更明确
        style: { stroke: color, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: color, width: 16, height: 16 },
        // 关系描述悬浮显示 (鼠标悬停连线时浏览器原生 title)
        data: { description: r.description, onDelete: () => onDeleteRelationship(i) },
      }
    })
  }, [graph, onDeleteRelationship])

  // 自定义节点类型: 角色卡片 (姓名 + 角色 + 目标 + 性格 + 删除按钮)
  // 2026-07-21: 卡片整体可点击 — 点击 (非删除按钮) 触发 onEdit 回调打开编辑弹窗.
  // 删除按钮用 stopPropagation 避免触发卡片点击.
  const nodeTypes = useMemo(() => ({
    characterNode: ({ data }) => {
      const c = data.character
      return (
        <div
          onClick={(e) => {
            // 点击卡片本身 (非删除按钮) 触发编辑
            e.stopPropagation()
            data.onEdit && data.onEdit(c)
          }}
          style={{
            background: 'var(--ab-surface)',
            border: '1px solid var(--ab-copper)',
            borderRadius: 8,
            padding: '8px 10px',
            // cursor: pointer 表示可点击放大; react-flow 内部拖拽会覆盖为 grab
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'box-shadow 0.15s, transform 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 6px 18px rgba(212,165,116,0.4)'
            e.currentTarget.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
          title="点击查看/编辑角色详情"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <UserOutlined style={{ color: 'var(--ab-copper)', fontSize: 11 }} />
            <span style={{ ...serif, fontSize: 13, fontWeight: 600, color: 'var(--ab-text)' }}>
              {c.name}
            </span>
            {data.onDelete && (
              <CloseOutlined
                onClick={(e) => { e.stopPropagation(); data.onDelete(c.id) }}
                style={{ fontSize: 10, color: 'var(--ab-text-4)', marginLeft: 'auto', cursor: 'pointer' }}
              />
            )}
            {/* 2026-07-21: 右上角"放大"图标提示可点击编辑 */}
            {data.onEdit && (
              <EditOutlined
                onClick={(e) => { e.stopPropagation(); data.onEdit(c) }}
                style={{ fontSize: 10, color: 'var(--ab-copper)', marginLeft: data.onDelete ? 4 : 'auto', cursor: 'pointer' }}
              />
            )}
          </div>
          <div style={{ ...mono, fontSize: 9.5, color: 'var(--ab-copper-2)', letterSpacing: '0.04em', marginBottom: 3 }}>
            {c.role}
          </div>
          <div style={{ ...body, fontSize: 10.5, color: 'var(--ab-text-3)', lineHeight: 1.4, maxHeight: 36, overflow: 'hidden' }}>
            <span style={{ color: 'var(--ab-text-4)' }}>目标:</span> {c.goal}
          </div>
          {c.personality && c.personality !== '未定' && (
            <div style={{ ...body, fontSize: 10, color: 'var(--ab-text-4)', lineHeight: 1.4, marginTop: 2 }}>
              <span>性格:</span> {c.personality}
            </div>
          )}
        </div>
      )
    },
  }), [])

  if (!graph || graph.characters.length === 0) {
    return (
      <div style={{
        height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--ab-bg-2)', borderRadius: 8, border: '1px dashed var(--ab-line)',
      }}>
        <Empty description="尚未生成人物关系图谱" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <span style={{ ...body, fontSize: 12, color: 'var(--ab-text-4)' }}>
            点击上方"生成关系图谱"开始
          </span>
        </Empty>
      </div>
    )
  }

  return (
    <div style={{
      height: 480, background: 'var(--ab-bg-2)', borderRadius: 8,
      border: '1px solid var(--ab-line)', overflow: 'hidden',
    }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        attributionPosition="bottom-left"
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--ab-line)" gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={() => 'var(--ab-copper)'}
          maskColor="rgba(10,10,10,0.6)"
          style={{ background: 'var(--ab-bg-2)' }}
        />
      </ReactFlow>
    </div>
  )
}

// ── BookReader: 书本翻页阅读器 ──────────────────────────────────────
// 2026-07-20: 把生成完成的小说按"书本翻页"方式呈现, 取代上下滚动
// 设计语言: Editorial Book Atelier — 双页对开 + 3D 翻页 + 羊皮纸页面质感
//
// 章节三态视觉:
//   ready      — 已生成(refined 或 draft 有内容): 正常展示正文, 章首花纹装饰
//   generating — 生成中(section 存在但无内容 + status==='generating'): 墨迹晕开动效
//   pending    — 待生成(sections 数组未填满到 expectedTotal): 空白卷页 "待续..."
//
// 翻页动画: framer-motion + rotateY + preserve-3d, 章节切换时触发
// 键盘导航: ← 上一章, → 下一章, Home 首章, End 末章
function BookReader({
  sections, expectedTotal, activeIdx, setActiveIdx,
  status, selectedGenre, synopsis, progressMessage, onCopy, onExportWord, onExportPdf, onRegenerateSection,
}) {
  // 2026-07-20: 章节列表 = 已有 sections + 待生成占位
  // 若 expectedTotal > sections.length, 补齐占位项让 BookReader 显示"待生成"页
  //
  // 2026-07-21 修复: 章节目录实时显示"正在生成第 N 章"闪烁状态.
  // 后端每章开始时调 updateProgress(rid, pct, "生成章节 N/M：章节名"),
  // 但 sections_json 要等章节完成才写入. 因此"正在生成的章节"在 sections 数组里不存在,
  // 前端原逻辑把它当 'pending' (空白卷页), 用户看不到"正在生成"反馈.
  // 修复: 从 progressMessage 解析出当前正在生成的章节序号 (1-based),
  // 让对应索引的占位项显示为 'generating' (墨迹闪烁动效).
  let generatingChapterIdx = -1  // 0-based, -1 表示未在生成中
  if (status === 'generating' && progressMessage) {
    // 匹配 "生成章节 11/150：第 11 章 办公室的流言蜚语" 或 "生成章节 11/150"
    const m = progressMessage.match(/生成章节\s+(\d+)\s*\//)
    if (m) {
      const n = parseInt(m[1], 10)
      if (!isNaN(n) && n >= 1) generatingChapterIdx = n - 1
    }
  }
  // 从 progressMessage 提取正在生成的章节名 (若有), 用于占位项的标题显示
  let generatingChapterTitle = ''
  if (generatingChapterIdx >= 0 && progressMessage) {
    const m = progressMessage.match(/生成章节\s+\d+\s*\/\s*\d+[：:]\s*(.+)$/)
    if (m) generatingChapterTitle = m[1].trim()
  }

  const totalSlots = Math.max(sections.length, expectedTotal, generatingChapterIdx + 1, 1)
  const chapters = []
  for (let i = 0; i < totalSlots; i++) {
    const sec = sections[i]
    if (sec && (sec.refined || sec.draft)) {
      // 已生成章节
      chapters.push({ idx: i, state: 'ready', title: sec.title || `第 ${i + 1} 章`, body: sec.refined || sec.draft })
    } else if (i === generatingChapterIdx) {
      // 2026-07-21: 正在生成的章节 — 即使 sections 数组里还没有这项, 也显示为 'generating'
      // 优先用 sections 里的标题 (draft-only 时已有), 否则用 progressMessage 解析的标题
      chapters.push({
        idx: i,
        state: 'generating',
        title: sec?.title || generatingChapterTitle || `第 ${i + 1} 章`,
        body: '',
      })
    } else if (sec) {
      // section 存在但无内容 (非当前生成章)
      chapters.push({ idx: i, state: status === 'generating' ? 'generating' : 'pending', title: sec.title || `第 ${i + 1} 章`, body: '' })
    } else {
      // section 不存在 (超出 sections 数组), 待生成
      chapters.push({ idx: i, state: 'pending', title: `第 ${i + 1} 章`, body: '' })
    }
  }

  // 2026-07-21 诊断日志: BookReader 渲染时打印 props, 定位"看不到更新"问题
  console.log('[BookReader] render:', {
    sectionsLen: sections.length,
    expectedTotal,
    totalSlots,
    chaptersLen: chapters.length,
    activeIdx,
    generatingChapterIdx,
    generatingChapterTitle,
    currentChapterState: chapters[activeIdx]?.state,
    currentChapterTitle: chapters[activeIdx]?.title,
    currentChapterBodyLen: chapters[activeIdx]?.body?.length || 0,
    status,
  })

  // 键盘导航
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft' && activeIdx > 0) {
        e.preventDefault(); setActiveIdx(activeIdx - 1)
      } else if (e.key === 'ArrowRight' && activeIdx < chapters.length - 1) {
        e.preventDefault(); setActiveIdx(activeIdx + 1)
      } else if (e.key === 'Home') {
        e.preventDefault(); setActiveIdx(0)
      } else if (e.key === 'End') {
        e.preventDefault(); setActiveIdx(chapters.length - 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeIdx, chapters.length, setActiveIdx])

  const current = chapters[activeIdx] || chapters[0] || { idx: 0, state: 'pending', title: '未开始', body: '' }
  const prevDisabled = activeIdx === 0
  const nextDisabled = activeIdx >= chapters.length - 1

  return (
    <div style={{
      background: 'var(--ab-surface)', border: '1px solid var(--ab-line)',
      borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--ab-shadow-2)',
    }}>
      {/* 书本工具栏 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 20px', borderBottom: '1px solid var(--ab-line)',
        background: 'var(--ab-bg-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <ReadOutlined style={{ color: 'var(--ab-copper)', fontSize: 16 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ ...serif, fontSize: 14.5, fontWeight: 500, color: 'var(--ab-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {synopsis.slice(0, 32) || '未命名'}{synopsis.length > 32 ? '…' : ''}
            </div>
            <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.05em', marginTop: 1 }}>
              {selectedGenre?.name} · {chapters.length} 章 · {activeIdx + 1}/{chapters.length}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* 翻页按钮 */}
          <Tooltip title="上一章 (←)">
            <Button size="small" icon={<LeftOutlined />}
              disabled={prevDisabled}
              onClick={() => !prevDisabled && setActiveIdx(activeIdx - 1)}
              style={{ borderColor: 'var(--ab-line)', color: prevDisabled ? 'var(--ab-text-4)' : 'var(--ab-text-2)' }} />
          </Tooltip>
          <Tooltip title="下一章 (→)">
            <Button size="small" icon={<RightOutlined />}
              disabled={nextDisabled}
              onClick={() => !nextDisabled && setActiveIdx(activeIdx + 1)}
              style={{ borderColor: 'var(--ab-line)', color: nextDisabled ? 'var(--ab-text-4)' : 'var(--ab-text-2)' }} />
          </Tooltip>
          <div style={{ width: 1, height: 20, background: 'var(--ab-line)', margin: '0 4px' }} />
          <Tooltip title="复制全文">
            <Button size="small" icon={<CopyOutlined />} onClick={onCopy}
              style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-3)' }} />
          </Tooltip>
          <Tooltip title="导出 Word">
            <Button size="small" icon={<FileTextOutlined />} onClick={onExportWord}
              style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-3)' }} />
          </Tooltip>
          <Tooltip title="导出 PDF">
            <Button size="small" icon={<FileTextOutlined />} onClick={onExportPdf}
              style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-3)' }} />
          </Tooltip>
          {/* 2026-07-21: 章节级重新生成 — 仅在当前章节已生成且非生成中时可用.
              点击后弹出对话框输入修改重点, 后端用 LLM 基于原文+用户重点重写本章. */}
          <Tooltip title={current.state === 'ready' && status !== 'generating'
            ? '重新生成本章 (基于原文 + 修改重点)'
            : (status === 'generating' ? '生成中, 请先取消或等待完成' : '当前章节尚未生成')}>
            <Button size="small" icon={<ReloadOutlined />}
              disabled={current.state !== 'ready' || status === 'generating'}
              onClick={() => onRegenerateSection && onRegenerateSection(activeIdx)}
              style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-copper)' }} />
          </Tooltip>
        </div>
      </div>

      {/* 书本主体: 左目录 + 右翻页书
          2026-07-21 阅读体验优化:
            - grid 高度从固定 minHeight:480 改为 calc(100vh - 200px), 让书本占满视口
            - 左目录宽度从 220px 缩到 200px, 给正文更多空间
            - 目录 maxHeight 同步改为 height: calc(100vh - 200px), 与正文区同高
          Mobile: 单列堆叠, 目录变矮 (160px) + 横向可滚动, 翻页区占满剩余高度 */}
      <div className="novel-book-grid" style={{ display: 'grid', gridTemplateColumns: '200px 1fr', height: 'calc(100vh - 200px)', minHeight: 520 }}>
        {/* 左: 章节目录 */}
        <div className="novel-book-toc custom-scrollbar" style={{
          background: 'var(--ab-bg-2)', borderRight: '1px solid var(--ab-line)',
          padding: '14px 10px', overflow: 'auto', height: '100%',
        }}>
          <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 10, padding: '0 4px' }}>
            CONTENTS · 目录
          </div>
          {chapters.map((ch, i) => {
            const isActive = i === activeIdx
            const isGenerating = ch.state === 'generating'
            const isPending = ch.state === 'pending'
            return (
              <div key={i}
                onClick={() => setActiveIdx(i)}
                style={{
                  padding: '7px 10px', borderRadius: 4, marginBottom: 2, cursor: 'pointer',
                  background: isActive ? 'var(--ab-surface)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--ab-copper)' : '2px solid transparent',
                  transition: 'all 0.15s', position: 'relative',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--ab-bg-3)' }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    ...mono, fontSize: 9.5, color: isActive ? 'var(--ab-copper)' : 'var(--ab-text-4)',
                    letterSpacing: '0.05em', minWidth: 24,
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{
                    ...serif, fontSize: 12, fontWeight: 500,
                    color: isActive ? 'var(--ab-text)' : (isPending ? 'var(--ab-text-4)' : 'var(--ab-text-2)'),
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontStyle: isPending ? 'italic' : 'normal',
                  }}>
                    {ch.title}
                  </span>
                  {/* 状态指示 */}
                  {isGenerating && (
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', background: 'var(--ab-copper)',
                      animation: 'novel-ink-pulse 1.5s ease-in-out infinite', flexShrink: 0,
                    }} />
                  )}
                  {ch.state === 'ready' && !isActive && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ab-copper-dim, var(--ab-copper))', opacity: 0.4, flexShrink: 0 }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 右: 书本翻页区 */}
        <div className="novel-book-pages" style={{
          position: 'relative',
          background: 'radial-gradient(ellipse at center, var(--ab-bg-3) 0%, var(--ab-bg) 70%)',
          overflow: 'hidden',
          // 3D perspective 容器 — 让翻页动画有深度感
          perspective: '2400px',
        }}>
          {/* 书脊阴影 — 中央竖线模拟书本装订 */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 24,
            background: 'linear-gradient(90deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)',
            pointerEvents: 'none', zIndex: 2,
          }} />

          {/* 翻页容器 — AnimatePresence 章节切换触发动画
              2026-07-21 修复 CSSStyleDeclaration indexed property 错误:
              framer-motion v12 中 transformOrigin 必须放在 style prop, 不能放在
              initial/animate/exit 里, 否则 v12 内部会用 indexed setter 写 style 触发报错 */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIdx}
              initial={{ rotateY: -25, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: 25, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              style={{
                position: 'absolute', inset: 0, padding: '32px 56px 32px 56px',
                transformStyle: 'preserve-3d', transformOrigin: 'left center', overflow: 'auto',
              }}
              className="custom-scrollbar novel-book-page-content"
            >
              <BookPage chapter={current} selectedGenre={selectedGenre} activeIdx={activeIdx} total={chapters.length} />
            </motion.div>
          </AnimatePresence>

          {/* 边缘翻页热区 — hover 显示翻页箭头 */}
          {!prevDisabled && (
            <div onClick={() => setActiveIdx(activeIdx - 1)}
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 60,
                cursor: 'pointer', zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0, transition: 'opacity 0.2s', background: 'linear-gradient(90deg, rgba(212,165,116,0.08) 0%, transparent 100%)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0' }}
              title="上一章 (←)"
            >
              <LeftOutlined style={{ fontSize: 20, color: 'var(--ab-copper)' }} />
            </div>
          )}
          {!nextDisabled && (
            <div onClick={() => setActiveIdx(activeIdx + 1)}
              style={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: 60,
                cursor: 'pointer', zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: 0, transition: 'opacity 0.2s', background: 'linear-gradient(270deg, rgba(212,165,116,0.08) 0%, transparent 100%)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0' }}
              title="下一章 (→)"
            >
              <RightOutlined style={{ fontSize: 20, color: 'var(--ab-copper)' }} />
            </div>
          )}
        </div>
      </div>

      {/* 页脚: 页码 + 翻页提示 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 20px', borderTop: '1px solid var(--ab-line)', background: 'var(--ab-bg-2)',
      }}>
        <div style={{ ...mono, fontSize: 9.5, color: 'var(--ab-text-4)', letterSpacing: '0.1em' }}>
          ← → 键翻页 · Home/End 跳首末章
        </div>
        <div style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.05em' }}>
          — {activeIdx + 1} / {chapters.length} —
        </div>
      </div>

      <style>{`
        @keyframes novel-ink-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); box-shadow: 0 0 8px var(--ab-copper); }
        }
        @keyframes novel-ink-spread {
          0% { opacity: 0.15; transform: scale(0.92); filter: blur(10px); }
          50% { opacity: 0.55; transform: scale(1.06); filter: blur(3px); }
          100% { opacity: 0.25; transform: scale(1); filter: blur(6px); }
        }
        @keyframes novel-pen-write {
          0% { transform: translateX(-20px) rotate(-12deg); opacity: 0; }
          40% { opacity: 1; }
          100% { transform: translateX(20px) rotate(8deg); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// ── BookPage: 单页书内容 ──
function BookPage({ chapter, selectedGenre, activeIdx, total }) {
  // 2026-07-21 修复 CSSStyleDeclaration indexed property 错误:
  // 模块级有 const body = { fontFamily: 'var(--ab-font-body)' } (字体对象),
  // 但 chapter.body 是章节正文(字符串). 若解构为 `body`, 则下方 `...body` 会展开字符串
  // 生成 { 0: 'h', 1: 'e', ... } 数字键, React 应用 style 时执行 style[0]='h' 触发报错.
  // 解构重命名为 content, 让 `...body` 正确引用模块级字体对象.
  const { state, title, body: content, idx } = chapter

  // 已生成章节: 正常展示正文
  if (state === 'ready') {
    const paragraphs = content.split('\n').filter(Boolean)
    return (
      <div>
        {/* 页眉: 章号 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 24, paddingBottom: 10, borderBottom: '1px solid var(--ab-line)',
        }}>
          <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Chapter {String(idx + 1).padStart(2, '0')}
          </div>
          {selectedGenre && (
            <div style={{ ...mono, fontSize: 9.5, color: selectedGenre.accent, letterSpacing: '0.1em' }}>
              {selectedGenre.name} · {selectedGenre.icon}
            </div>
          )}
        </div>

        {/* 章首装饰花纹 */}
        <div style={{ textAlign: 'center', marginBottom: 18, color: 'var(--ab-copper)', opacity: 0.6 }}>
          <span style={{ fontSize: 18, letterSpacing: '0.5em' }}>❦</span>
        </div>

        {/* 章节标题 */}
        <h2 style={{
          ...serif, fontSize: 30, fontWeight: 400, color: 'var(--ab-text)',
          margin: '0 0 28px', letterSpacing: '-0.015em', lineHeight: 1.25,
          textAlign: 'center',
        }}>
          {title}
        </h2>

        {/* 章首副装饰 */}
        <div style={{ textAlign: 'center', marginBottom: 28, color: 'var(--ab-text-4)', opacity: 0.4 }}>
          <span style={{ fontSize: 12 }}>✦</span>
        </div>

        {/* 正文段落
            2026-07-21 阅读体验优化:
              - maxWidth 从 680 → 760 (经典书籍排版最舒适字行长度约 66-80 字符)
              - fontSize 从 15 → 16 (稍大字 号降低阅读疲劳)
              - lineHeight 从 1.95 → 2.0 (行间距稍宽, 长时间阅读更舒适)
              - marginBottom 从 18 → 20 (段落间距稍大, 视觉节奏更清晰) */}
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {paragraphs.map((p, i) => (
            <p key={i} style={{
              ...body, fontFamily: 'var(--ab-font-body)',
              fontSize: 16, color: 'var(--ab-text)', lineHeight: 2.0,
              margin: '0 0 20px', textIndent: '2em',
            }}>
              {p}
            </p>
          ))}
        </div>

        {/* 页脚: 页码装饰 */}
        <div style={{ textAlign: 'center', marginTop: 36, paddingTop: 16, borderTop: '1px solid var(--ab-line)' }}>
          <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.2em' }}>
            — {activeIdx + 1} —
          </span>
        </div>
      </div>
    )
  }

  // 生成中: 墨迹晕开动效
  if (state === 'generating') {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 40,
      }}>
        {/* 墨迹晕开动效 */}
        <div style={{ position: 'relative', width: 120, height: 120, marginBottom: 28 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'radial-gradient(circle, var(--ab-copper) 0%, transparent 70%)',
            animation: 'novel-ink-spread 2.4s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute', inset: '30%', borderRadius: '50%',
            background: 'var(--ab-copper)', opacity: 0.6,
            animation: 'novel-ink-pulse 1.8s ease-in-out infinite',
          }} />
        </div>

        <div style={{ ...mono, fontSize: 11, color: 'var(--ab-copper)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>
          WRITING IN PROGRESS
        </div>
        <div style={{
          ...serif, fontSize: 22, fontWeight: 400, color: 'var(--ab-text)',
          marginBottom: 8, letterSpacing: '-0.01em', textAlign: 'center',
        }}>
          正在书写 {title}
        </div>
        <div style={{ ...body, fontSize: 12.5, color: 'var(--ab-text-3)', textAlign: 'center', lineHeight: 1.6, maxWidth: 360 }}>
          墨迹在羊皮纸上缓缓晕开, 故事正从笔尖流淌而出…<br />
          请稍候, 章节完成后将自动展示
        </div>

        {/* 装饰: 羽毛笔动画 */}
        <div style={{ marginTop: 32, position: 'relative', width: 80, height: 24 }}>
          <div style={{
            position: 'absolute', top: 0, left: 30, fontSize: 22, color: 'var(--ab-copper)',
            animation: 'novel-pen-write 2s ease-in-out infinite',
          }}>
            ✒
          </div>
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 1,
            background: 'linear-gradient(90deg, transparent 0%, var(--ab-line) 50%, transparent 100%)',
          }} />
        </div>
      </div>
    )
  }

  // 待生成: 空白卷页
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 40,
    }}>
      <div style={{
        ...mono, fontSize: 11, color: 'var(--ab-text-4)', letterSpacing: '0.2em', textTransform: 'uppercase',
        marginBottom: 20, opacity: 0.6,
      }}>
        FOLIO BLANK · 卷页待续
      </div>

      {/* 装饰: 空白卷轴 */}
      <div style={{ position: 'relative', marginBottom: 24, opacity: 0.3 }}>
        <div style={{
          width: 80, height: 100, border: '1px solid var(--ab-text-4)', borderRadius: 2,
          background: 'linear-gradient(180deg, transparent 0%, rgba(212,165,116,0.04) 100%)',
        }} />
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          ...serif, fontSize: 32, color: 'var(--ab-text-4)', opacity: 0.4,
        }}>
          ?
        </div>
      </div>

      <div style={{
        ...serif, fontSize: 24, fontWeight: 400, color: 'var(--ab-text-3)',
        marginBottom: 8, letterSpacing: '-0.01em', fontStyle: 'italic',
      }}>
        第 {idx + 1} 章 · 待续
      </div>
      <div style={{ ...body, fontSize: 12.5, color: 'var(--ab-text-4)', textAlign: 'center', lineHeight: 1.6, maxWidth: 320 }}>
        此章节尚未生成<br />
        <span style={{ ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', opacity: 0.7 }}>
          生成进度到达此章时将自动填充
        </span>
      </div>

      {/* 装饰花纹 */}
      <div style={{ marginTop: 32, color: 'var(--ab-text-4)', opacity: 0.25, fontSize: 16, letterSpacing: '0.5em' }}>
        ❦
      </div>
    </div>
  )
}

function StepShell({ index, title, subtitle, done, active, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        display: 'flex', gap: 24, marginBottom: 28,
        opacity: active ? 1 : 0.45,
        transition: 'opacity 0.3s',
      }}
    >
      {/* 步骤轴 */}
      <div style={{ flexShrink: 0, width: 64, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          ...mono, fontSize: 10, letterSpacing: '0.15em', color: 'var(--ab-text-4)',
          marginBottom: 6, textTransform: 'uppercase',
        }}>STEP</div>
        <div style={{
          ...serif, fontSize: 30, fontWeight: 300, lineHeight: 1,
          color: done ? 'var(--ab-copper)' : (active ? 'var(--ab-text)' : 'var(--ab-text-3)'),
          transition: 'color 0.3s',
        }}>{index}</div>
        <div style={{
          width: 1, flex: 1, background: done ? 'var(--ab-copper)' : 'var(--ab-line)',
          marginTop: 12, minHeight: 32,
        }} />
      </div>
      {/* 内容区 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h3 style={{ ...serif, fontSize: 19, fontWeight: 500, color: 'var(--ab-text)', margin: 0, letterSpacing: '-0.01em' }}>
            {title}
          </h3>
          {done && (
            <span style={{ ...mono, fontSize: 10, color: 'var(--ab-copper)', letterSpacing: '0.1em' }}>
              ✓ {typeof done === 'string' ? done : '已完成'}
            </span>
          )}
        </div>
        <div style={{ ...body, fontSize: 12.5, color: 'var(--ab-text-3)', marginBottom: 18 }}>
          {subtitle}
        </div>
        {children}
      </div>
    </motion.div>
  )
}

// ── useMemoOutlineChapters: 解析 outlineText JSON 提取章节标题 + key_points 摘要 ──
// 后端增量持久化格式: {"sections":[{"title":"第1章 ...","key_points":[...],...}, ...]}
// 2026-07-21: 返回结构从 [title] 改为 [{title, keyPoints}], 让大纲面板展示每章简要内容.
//   keyPoints: 数组 (如 ["情节事件1", "情节事件2"]), 展示时用 · 拼接为单行摘要
// 解析失败时降级为按行匹配"第N章"模式, 返回 [{title, keyPoints:[]}]
function parseOutlineChapters(outlineText) {
  if (!outlineText || !outlineText.trim()) return []
  const trimmed = outlineText.trim()

  // 尝试 JSON 解析
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      const sections = parsed.sections || (Array.isArray(parsed) ? parsed : [])
      const result = sections
        .map(s => {
          if (!s || !s.title) return null
          const kp = Array.isArray(s.key_points) ? s.key_points.filter(k => typeof k === 'string' && k.trim())
            : (Array.isArray(s.keyPoints) ? s.keyPoints.filter(k => typeof k === 'string' && k.trim()) : [])
          return { title: s.title, keyPoints: kp }
        })
        .filter(Boolean)
      if (result.length > 0) return result
    } catch (e) {
      // JSON 解析失败, 降级到文本匹配
    }
  }

  // 降级: 按行匹配 "第N章" 或 "第一章" 等中文数字格式
  const lines = trimmed.split('\n')
  const result = []
  for (const line of lines) {
    const m = line.match(/^\s*(第[\d一二三四五六七八九十百千]+章\s*[^:\-—、\n]+)/)
    if (m && m[1]) {
      result.push({ title: m[1].trim(), keyPoints: [] })
    }
  }
  return result
}

// ── OutlineProgressPanel: 大纲生成进度面板 ──
// 设计: Editorial Book Atelier 风格 — 章节列表 + 进度指示 + 卷分隔标记
// 三种展示形态:
//   1. generating && !hasSectionsStarted: 高亮展示, 列表逐章追加, 顶部"大纲生成中 N/M 章"
//   2. collapsed: 折叠为单行摘要, 点击展开
//   3. 已生成正文后: 仍可查看完整大纲, 但视觉次要
function OutlineProgressPanel({ chapters, totalExpected, generating, collapsed, genre }) {
  const [expanded, setExpanded] = useState(!collapsed)
  const [hoveredIdx, setHoveredIdx] = useState(-1)

  // 计算卷分隔: 每 30 章（genre.chaptersPerVolume）一卷
  const chaptersPerVol = genre?.chaptersPerVolume || 30
  const volumes = []
  for (let i = 0; i < chapters.length; i += chaptersPerVol) {
    const volEnd = Math.min(i + chaptersPerVol, chapters.length)
    volumes.push({
      volIdx: Math.floor(i / chaptersPerVol),
      volTitle: `第${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][Math.floor(i / chaptersPerVol)] || (Math.floor(i / chaptersPerVol) + 1)}卷`,
      chapters: chapters.slice(i, volEnd),
      startIdx: i,
    })
  }

  const progressPct = totalExpected > 0 ? Math.min(100, (chapters.length / totalExpected) * 100) : 0
  const accent = genre?.accent || 'var(--ab-copper)'

  // 折叠态: 单行摘要 + 展开按钮
  if (collapsed && !expanded) {
    return (
      <div style={{
        marginBottom: 16, padding: '12px 16px',
        background: 'var(--ab-surface)', borderRadius: 8,
        border: '1px solid var(--ab-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', transition: 'border-color 0.2s',
      }} onClick={() => setExpanded(true)}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--ab-bg-2)', border: '1px solid var(--ab-line)',
          color: 'var(--ab-copper)', fontSize: 14,
        }}>
          <ReadOutlined />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ ...serif, fontSize: 13.5, color: 'var(--ab-text)', fontWeight: 500 }}>
            完整大纲 · {chapters.length} 章
          </div>
          <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', marginTop: 2, letterSpacing: '0.05em' }}>
            点击展开查看全部章节名
          </div>
        </div>
        <RightOutlined style={{ color: 'var(--ab-text-3)', fontSize: 12 }} />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      style={{
        marginBottom: 16, background: 'var(--ab-surface)', borderRadius: 10,
        border: '1px solid var(--ab-line)', overflow: 'hidden',
        boxShadow: generating ? `0 0 0 1px ${accent}22 inset, 0 4px 18px rgba(0,0,0,0.4)` : 'var(--ab-shadow-2)',
      }}>
      {/* 顶部标题栏 */}
      <div style={{
        padding: '14px 18px 12px',
        borderBottom: '1px solid var(--ab-line)',
        background: generating
          ? `linear-gradient(135deg, ${accent}0d 0%, transparent 100%)`
          : 'transparent',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, borderRadius: '50%',
          background: generating ? accent : 'var(--ab-bg-2)',
          color: generating ? 'var(--ab-bg)' : 'var(--ab-copper)',
          fontSize: 14, transition: 'background 0.3s',
        }}>
          {generating ? <Spin size="small" /> : <ReadOutlined />}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...serif, fontSize: 15, color: 'var(--ab-text)', fontWeight: 500 }}>
              {generating ? '大纲生成中' : '完整大纲'}
            </span>
            <span style={{ ...mono, fontSize: 10.5, color: 'var(--ab-text-3)', letterSpacing: '0.05em' }}>
              {chapters.length} / {totalExpected} 章
            </span>
            {generating && (
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }}
                style={{ ...mono, fontSize: 10, color: accent, marginLeft: 4 }}>
                · 正在追加章节
              </motion.span>
            )}
          </div>
          {/* 进度条 */}
          <div style={{ height: 2, background: 'var(--ab-line)', borderRadius: 1, marginTop: 6, overflow: 'hidden' }}>
            <motion.div
              animate={{ width: `${progressPct}%` }} transition={{ duration: 0.5 }}
              style={{ height: '100%', background: `linear-gradient(90deg, ${accent}, ${accent}cc)` }}
            />
          </div>
        </div>
        {!generating && (
          <Tooltip title={expanded ? '收起' : '展开'}>
            <Button type="text" size="small" icon={expanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setExpanded(!expanded)}
              style={{ color: 'var(--ab-text-3)' }} />
          </Tooltip>
        )}
      </div>

      {/* 章节列表 */}
      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3 }}
          style={{ maxHeight: 360, overflowY: 'auto' }} className="custom-scrollbar">
          {volumes.map((vol) => (
            <div key={vol.volIdx} style={{ padding: '10px 18px 6px' }}>
              {/* 卷标题 */}
              <div style={{
                ...mono, fontSize: 10, color: accent, letterSpacing: '0.12em',
                textTransform: 'uppercase', marginBottom: 6, marginTop: vol.volIdx > 0 ? 8 : 0,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ width: 14, height: 1, background: accent, opacity: 0.5 }} />
                {vol.volTitle} · {vol.chapters.length} 章
              </div>
              {/* 章节网格 (3列, 适配长篇)
                  2026-07-21: 章节项从 string 改为 {title, keyPoints} 对象.
                  - 默认显示 title (单行省略)
                  - hover 时 tooltip 展示 key_points 拼接的简要内容总结
                  - 生成中新增章节高亮 (铜色左边框 + 淡背景) */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 12px',
              }}>
                {vol.chapters.map((ch, i) => {
                  const globalIdx = vol.startIdx + i
                  const isHovered = hoveredIdx === globalIdx
                  const isNew = generating && globalIdx === chapters.length - 1
                  // 2026-07-21: ch 可能是 {title, keyPoints} 对象 (JSON 解析成功) 或 string (降级路径)
                  const title = typeof ch === 'string' ? ch : (ch?.title || `第 ${globalIdx + 1} 章`)
                  const keyPoints = typeof ch === 'string' ? [] : (ch?.keyPoints || [])
                  const summary = keyPoints.length > 0 ? keyPoints.join(' · ') : ''
                  return (
                    <Tooltip
                      key={globalIdx}
                      title={summary ? <div style={{ maxWidth: 280 }}>
                        <div style={{ ...serif, fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{title}</div>
                        <div style={{ ...body, fontSize: 11, color: 'var(--ab-text-3)', lineHeight: 1.6 }}>
                          {summary}
                        </div>
                      </div> : title}
                      placement="topLeft"
                    >
                      <motion.div
                        initial={isNew ? { opacity: 0, x: -8 } : false}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                        onMouseEnter={() => setHoveredIdx(globalIdx)}
                        onMouseLeave={() => setHoveredIdx(-1)}
                        style={{
                          ...body, fontSize: 11.5,
                          color: isHovered ? 'var(--ab-text)' : (isNew ? accent : 'var(--ab-text-2)'),
                          padding: '4px 6px', borderRadius: 3,
                          background: isHovered ? 'var(--ab-bg-2)' : (isNew ? `${accent}0a` : 'transparent'),
                          borderLeft: isNew ? `2px solid ${accent}` : '2px solid transparent',
                          cursor: 'default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          transition: 'background 0.15s, color 0.15s',
                        }}>
                        {title}
                      </motion.div>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          ))}
          {generating && chapters.length < totalExpected && (
            <div style={{ padding: '10px 18px 14px', textAlign: 'center' }}>
              <motion.span
                animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}
                style={{ ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', letterSpacing: '0.08em' }}>
                正在生成下一卷章大纲 · 已完成 {chapters.length} / {totalExpected} 章
              </motion.span>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}

export default function NovelPage({ user }) {
  // ── Responsive breakpoint ──
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)

  // 2026-07-20: 进入小说页时自动折叠全局 Sider, 与学术页行为一致
  const setSiderCollapsed = useUIStore(s => s.setSiderCollapsed)
  useEffect(() => {
    const prevCollapsed = useUIStore.getState().siderCollapsed
    if (!prevCollapsed) setSiderCollapsed(true)
    return () => { if (!prevCollapsed) setSiderCollapsed(false) }
  }, [setSiderCollapsed])

  // Mobile: close history drawer when a history item is selected or new novel is created.
  // Uses closures that reference loadHistoryItem/handleReset defined later — safe because
  // these wrappers are only invoked via user interaction after full render.
  const loadHistoryItemMobile = (item) => { loadHistoryItem(item); setMobileHistoryOpen(false) }
  const handleResetMobile = () => { handleReset(); setMobileHistoryOpen(false) }

  // ── 步骤状态 ──
  // 2026-07-21: 三步 → 四步流程, 在提要与生成之间插入"人物关系图谱"独立步骤
  //   1=选题材, 2=输入提要, 3=人物关系图谱 (新增), 4=生成
  const [step, setStep] = useState(1)
  const [selectedGenre, setSelectedGenre] = useState(null)
  const [synopsis, setSynopsis] = useState('')     // 简短提要

  // ── 任务状态 ──
  const [researchId, setResearchId] = useState(null)
  const [status, setStatus] = useState('idle')     // idle/generating/done/paused/cancelled
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [resumeBatch, setResumeBatch] = useState(0)
  const [lastLlmActivityAt, setLastLlmActivityAt] = useState(null)
  const [generationMeta, setGenerationMeta] = useState(null)
  const [outlineText, setOutlineText] = useState('')
  const [sections, setSections] = useState([])
  const [generatedReport, setGeneratedReport] = useState('')
  // 2026-07-20: 预期总章数 — 从 generationMeta.totalChapters 或 selectedGenre 推算
  // 用于在 sections 数组未填满时, 让 BookReader 显示"待生成"占位页
  const [expectedTotalChapters, setExpectedTotalChapters] = useState(0)
  // 2026-07-24: 书名 — 从后端 research.bookName 同步, 用于导出文件名 fallback.
  // 优先级: 后端 Content-Disposition 文件名 > bookName > selectedArc.title > synopsis 前 20 字
  const [bookName, setBookName] = useState('')

  // ── 历史列表 ──
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // ── 2026-07-21: 用户自定义模板管理 ──
  // userTemplates: [{ id, name, desc, structure, isCustom, extraMeta }]
  // tplModalOpen: false=关闭, true=打开新建/编辑 Modal
  // editingTpl: null=新建, 对象=编辑某条
  const [userTemplates, setUserTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [tplModalOpen, setTplModalOpen] = useState(false)
  const [editingTpl, setEditingTpl] = useState(null)
  const [tplForm] = Form.useForm()

  // ── UI 状态 ──
  const [staleWarning, setStaleWarning] = useState(false)
  const [activeSectionIdx, setActiveSectionIdx] = useState(0)
  // 2026-07-21: 章节级重新生成对话框状态 (三阶段流程: input → preview → commit/cancel)
  // regenSectionIdx: 要重生的章节索引 (0-based); null 表示对话框关闭
  // regenStage: 'input' (输入修改重点) | 'preview' (预览对比) | null
  // regenHint: 用户输入的修改重点
  // regenLoading: LLM 重生中 (按钮 loading)
  // regenPreview: { original_refined, new_refined, section_name } 预览内容
  // regenCommitLoading: 保存提交中 (按钮 loading)
  const [regenSectionIdx, setRegenSectionIdx] = useState(null)
  const [regenStage, setRegenStage] = useState('input')
  const [regenHint, setRegenHint] = useState('')
  const [regenLoading, setRegenLoading] = useState(false)
  const [regenPreview, setRegenPreview] = useState(null)
  const [regenCommitLoading, setRegenCommitLoading] = useState(false)

  // ── 2026-07-23: 过短段落清单 + 人工交互式扩展 ──
  // shortParagraphs: listShortParagraphs API 返回的过短段落清单
  //   [{section_idx, section_name, para_idx, paragraph, length}]
  // shortParagraphsLoading: 清单加载中
  // shortParagraphsThreshold: 当前清单使用的长度阈值 (展示用)
  // paraExpandTarget: 当前正在扩展的段落标识 {section_idx, para_idx, section_name, original}; null=未在扩展
  // paraExpandStage: 'input' (输入扩展方向) | 'preview' (预览对比)
  // paraExpandHint: 用户输入的扩展方向提示
  // paraExpandLoading: LLM 扩展中
  // paraExpandPreview: { expanded, debate } 预览内容
  // paraExpandCommitLoading: 保存中
  const [shortParagraphs, setShortParagraphs] = useState([])
  const [shortParagraphsLoading, setShortParagraphsLoading] = useState(false)
  const [shortParagraphsThreshold, setShortParagraphsThreshold] = useState(300)
  const [paraExpandTarget, setParaExpandTarget] = useState(null)
  const [paraExpandStage, setParaExpandStage] = useState('input')
  const [paraExpandHint, setParaExpandHint] = useState('')
  const [paraExpandLoading, setParaExpandLoading] = useState(false)
  const [paraExpandPreview, setParaExpandPreview] = useState(null)
  const [paraExpandCommitLoading, setParaExpandCommitLoading] = useState(false)

  // ── 2026-07-21: 人物关系图谱状态 (STEP 03) ──
  // characterGraph: { characters: [{id,name,role,goal,personality}], relationships: [{from,to,type,description}] }
  // graphLoading: LLM 生成中 / 保存中
  // graphDirty: 用户本地编辑过但未保存 (用于显示"保存"按钮高亮)
  // graphNewChar: 新增角色表单临时状态
  // graphNewRel: 新增关系表单临时状态
  const [characterGraph, setCharacterGraph] = useState(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphDirty, setGraphDirty] = useState(false)
  const [graphNewChar, setGraphNewChar] = useState({ name: '', role: '', goal: '', personality: '' })
  const [graphNewRel, setGraphNewRel] = useState({ from: '', to: '', type: '合作', description: '' })
  // 2026-07-21: 图谱重新生成偏好 Modal
  const [graphRegenModalOpen, setGraphRegenModalOpen] = useState(false)
  const [graphRegenHint, setGraphRegenHint] = useState('')
  // 2026-07-21: 重新生成时是否清空原有人物关系.
  // 默认 false (保留) — 把原图谱作为背景信息传给 LLM, 结合用户偏好迭代优化.
  // 勾选 true (清空) — 完全从零生成, 不参考原图谱.
  const [graphRegenClear, setGraphRegenClear] = useState(false)
  // 2026-07-21: 大纲重新生成偏好 Modal
  const [outlineRegenModalOpen, setOutlineRegenModalOpen] = useState(false)
  const [outlineRegenHint, setOutlineRegenHint] = useState('')
  // 2026-07-21: 生成风格偏好 Modal — 在"开始生成"/"继续生成"前让用户注入持久化偏好.
  // styleHint: 当前已保存的偏好 (从 DB 加载); styleHintDraft: Modal 内编辑中的文本;
  // styleHintPendingAction: 确认后执行的动作 ('generate' | 'resume' | 'edit').
  // 与 regenHint/outlineRegenHint 的区别: styleHint 持久化保存到 DB, 每章生成都注入 prompt,
  // 不会用后清空. 用户可随时修改, 修改后影响后续未生成的章节.
  const [styleHint, setStyleHint] = useState('')
  const [styleHintModalOpen, setStyleHintModalOpen] = useState(false)
  const [styleHintDraft, setStyleHintDraft] = useState('')
  const [styleHintPendingAction, setStyleHintPendingAction] = useState(null)
  // 2026-07-22: 小说章节规划 — 用户在 STEP 02 提要页可调整总章节数和每卷章节数.
  // novelTotal: 用户自定义的总章节数 (覆盖题材默认值); null/空 = 用题材默认值
  // novelPerVol: 用户自定义的每卷章节数; null/空 = 用题材默认值
  // 这两个值会在 doGenerate 时保存到 DB (PUT /novel-chapter-plan),
  // 后端 parseTargetChapterCount 优先读取, 决定大纲生成的卷数和章数.
  const [novelTotalInput, setNovelTotalInput] = useState('')
  const [novelPerVolInput, setNovelPerVolInput] = useState('')
  // 2026-07-22: 角色数量 — 用户在 STEP 02 提要页配置, 点击"生成人物关系"时传给后端.
  // 后端 generateCharacterGraph 优先用此值 (min=max=userValue), null 时回退到题材默认 (言情/悬疑 5-8, 玄幻/科幻 8-12).
  const [novelCharCountInput, setNovelCharCountInput] = useState('')
  // 2026-07-22: 故事弧线候选 — 用户在 STEP 01 点"生成弧线大纲"后, 后端返回 3 个弧线供选择.
  // 选中弧线后, 弧线的 totalChapters/chaptersPerVolume 自动填入 STEP 02 的输入框,
  // 弧线的 title+desc 拼到 user_prompt 传给后续大纲/人物关系生成.
  const [storyArcs, setStoryArcs] = useState([])      // 弧线列表
  const [selectedArc, setSelectedArc] = useState(null) // 选中的弧线对象
  const [arcLoading, setArcLoading] = useState(false)  // 弧线生成中状态
  // 2026-07-21: 角色详情编辑 Modal — 点击图谱节点卡片放大打开, 可编辑 name/role/goal/personality.
  // characterEditing: 当前编辑的完整角色对象 (浅拷贝, 编辑过程不影响原图谱)
  // characterEditingId: 原角色 id (用于保存时定位), 独立于 characterEditing.id 让用户也能改 id
  const [characterEditing, setCharacterEditing] = useState(null)
  const [characterEditingId, setCharacterEditingId] = useState(null)

  const pollTimerRef = useRef(null)
  // 2026-07-24: WebSocket 推送替代 HTTP 轮询. wsRef=主连接, fallbackTimerRef=WS 断开时的 HTTP 兜底.
  const wsRef = useRef(null)
  const fallbackTimerRef = useRef(null)
  const wsClosedByUsRef = useRef(false)   // 终态时主动关闭, 避免触发 fallback
  const terminalReachedRef = useRef(false) // 已进入终态, 不再 fallback
  const staleWarnedRef = useRef(false)
  const lastProgressRef = useRef(0)
  const lastProgressTimeRef = useRef(Date.now())

  // ── 2026-07-21: 加载用户自定义小说模板 ──
  // 2026-07-25: 自定义模板是可选功能, 加载失败不应阻塞页面 (4 个内置题材卡片
  // 不依赖此 API). 改为 console.warn 静默降级, 避免移动端 token 缺失时弹出
  // "加载自定义模板失败" toast 影响用户体验.
  const loadUserTemplates = useCallback(async () => {
    setLoadingTemplates(true)
    try {
      const res = await api.get('/academic/user-templates', { params: { report_type: 'novel' } })
      const list = Array.isArray(res.data) ? res.data : []
      setUserTemplates(list)
    } catch (err) {
      console.warn('[NovelPage] loadUserTemplates failed (non-blocking):', err?.response?.status || err?.message)
      setUserTemplates([])
    } finally {
      setLoadingTemplates(false)
    }
  }, [])

  useEffect(() => { loadUserTemplates() }, [loadUserTemplates])

  // ── 2026-07-21: 把后端返回的自定义模板转为与 NOVEL_GENRES 一致的卡片数据结构 ──
  // 内置题材卡片字段: { id, name, desc, volumes, chaptersPerVolume, accent, spineGradient, icon, isCustom }
  // 自定义模板字段:   { id, name, desc, structure: [], extraMeta: {...} }
  // 转换: volumes = structure.length, chaptersPerVolume = extraMeta.chaptersPerVolume || 30
  const toGenreCardData = (tpl) => {
    const structure = Array.isArray(tpl.structure) ? tpl.structure : []
    const meta = tpl.extraMeta || {}
    const cpv = meta.chaptersPerVolume || 30
    const total = meta.totalChapters || (structure.length * cpv)
    return {
      id: tpl.id,
      name: tpl.name,
      numeral: '★',
      desc: structure.length > 0 ? structure.join(' → ') : (tpl.desc || '自定义模板'),
      fullDesc: tpl.desc || '自定义小说模板',
      volumes: structure.length,
      chaptersPerVolume: cpv,
      totalChapters: total,
      accent: '#d4a574',
      spineGradient: 'linear-gradient(180deg, #d4a574 0%, #8b6b3f 100%)',
      icon: '📖',
      isCustom: true,
      raw: tpl,
    }
  }

  // ── 2026-07-21: 打开新建模板 Modal ──
  const handleOpenCreateTpl = () => {
    setEditingTpl(null)
    tplForm.resetFields()
    tplForm.setFieldsValue({
      chaptersPerVolume: 30,
      wordCountMin: 3000,
      wordCountMax: 5000,
    })
    setTplModalOpen(true)
  }

  // ── 2026-07-21: 打开编辑模板 Modal ──
  const handleOpenEditTpl = (tpl) => {
    setEditingTpl(tpl)
    const meta = tpl.extraMeta || {}
    const structure = Array.isArray(tpl.structure) ? tpl.structure : []
    tplForm.setFieldsValue({
      name: tpl.name,
      description: tpl.desc,
      structure: structure.join('\n'),
      totalChapters: meta.totalChapters,
      chaptersPerVolume: meta.chaptersPerVolume || 30,
      wordCountMin: meta.wordCountMin,
      wordCountMax: meta.wordCountMax,
      focusPoints: meta.focusPoints,
      overallLogic: meta.overallLogic,
    })
    setTplModalOpen(true)
  }

  // ── 2026-07-21: 保存模板（新建或更新）──
  const handleSaveTpl = async () => {
    try {
      const values = await tplForm.validateFields()
      // structure: 一行一卷，转成数组
      const structure = (values.structure || '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
      if (structure.length === 0) {
        message.warning('故事弧线不能为空（一行一卷）')
        return
      }
      const extraMeta = {
        totalChapters: values.totalChapters ? Number(values.totalChapters) : null,
        chaptersPerVolume: values.chaptersPerVolume ? Number(values.chaptersPerVolume) : 30,
        wordCountMin: values.wordCountMin ? Number(values.wordCountMin) : null,
        wordCountMax: values.wordCountMax ? Number(values.wordCountMax) : null,
        focusPoints: values.focusPoints || '',
        overallLogic: values.overallLogic || '',
      }
      // 移除 null 字段，避免污染 JSON
      Object.keys(extraMeta).forEach(k => extraMeta[k] == null && delete extraMeta[k])

      if (editingTpl) {
        // 更新（按 templateId 调用 PUT，与 DELETE API 路径参数一致）
        await api.put(`/academic/user-templates/${editingTpl.id}`, {
          name: values.name,
          description: values.description || '',
          structure,
          extra_meta: extraMeta,
        })
        message.success('模板已更新')
      } else {
        // 新建
        await api.post('/academic/user-templates', {
          report_type: 'novel',
          name: values.name,
          description: values.description || '',
          structure,
          extra_meta: extraMeta,
        })
        message.success('模板已创建')
      }
      setTplModalOpen(false)
      loadUserTemplates()
    } catch (err) {
      if (err.errorFields) return  // 表单校验失败，不提示
      message.error('保存模板失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    }
  }

  // ── 2026-07-21: 删除模板 ──
  const handleDeleteTpl = async (tpl) => {
    try {
      const tplId = tpl.id  // 后端用 templateId 作为 id 字段返回
      await api.delete(`/academic/user-templates/${tplId}`)
      message.success('模板已删除')
      // 如果当前选中被删除的模板，清除选中
      if (selectedGenre?.id === tplId) setSelectedGenre(null)
      loadUserTemplates()
    } catch (err) {
      message.error('删除失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    }
  }

  // ── 加载历史列表（仅 novel 类型）──
  // 2026-07-22: 不再自动激活第一个历史记录 — 用户进入小说界面时应看到空白状态,
  // 由用户主动点击历史项才加载详情, 避免误操作和意外覆盖当前编辑内容.
  const loadHistory = useCallback(async (opts = {}) => {
    setLoadingHistory(true)
    try {
      const res = await api.get('/academic/research')
      const all = res.data || []
      // 前端过滤: 仅展示 novel 类型
      const novels = all.filter(r => r.reportType === 'novel')
      setHistory(novels)
    } catch (err) {
      // 2026-07-25: 401 由 auth.js 响应拦截器统一处理(reload 回登录页), 这里不弹错误.
      const status = err?.response?.status
      if (status === 401) {
        setHistory([])
        return
      }
      // 2026-07-25: 显示完整诊断信息 — 请求URL + 错误类型 + 状态码,
      // 帮助定位"请求未到达后端"的根因(如 backend_host 配置错误、网络不通、CORS 拦截).
      const reqUrl = err?.config?.baseURL + err?.config?.url || ''
      const errCode = err?.code || (err?.message?.includes('Network') ? 'Network Error' : '')
      const detail = status ? `HTTP ${status}` : (errCode || err?.message || '未知错误')
      console.error('[NovelPage] loadHistory failed:', { url: reqUrl, err })
      message.error({
        content: `加载小说列表失败: ${detail}${reqUrl ? `\n请求: ${reqUrl}` : ''}`,
        duration: 10,
      })
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // ── 加载历史记录详情 ──
  const loadHistoryItem = async (item) => {
    try {
      const res = await api.get(`/academic/research/${item.id}`)
      const r = res.data
      setResearchId(r.id)
      setStatus(r.status || 'idle')
      setProgress(r.progress || 0)
      setProgressMessage(r.progressMessage || '')
      setResumeBatch(r.resumeBatch || 0)
      setLastLlmActivityAt(r.lastLlmActivityAt || null)
      const meta = r.generationMeta ? (typeof r.generationMeta === 'string' ? JSON.parse(r.generationMeta) : r.generationMeta) : null
      setGenerationMeta(meta)
      // 2026-07-20: 同步预期总章数 — 优先用 generationMeta.totalChapters, 回退到 selectedGenre 推算
      if (meta?.totalChapters > 0) {
        setExpectedTotalChapters(meta.totalChapters)
      } else if (r.sectionsJson) {
        try {
          const parsed = typeof r.sectionsJson === 'string' ? JSON.parse(r.sectionsJson) : r.sectionsJson
          const arr = Array.isArray(parsed) ? parsed : (parsed.sections || [])
          setExpectedTotalChapters(arr.length)
        } catch (e) { /* ignore */ }
      }
      setOutlineText(r.outlineText || '')
      setGeneratedReport(r.generatedReport || '')
      // 2026-07-21: 加载持久化的生成风格偏好 (跨章节生效)
      setStyleHint(r.styleHint || '')
      // 2026-07-22: 加载用户自定义的章节规划 (null 时用题材默认值)
      setNovelTotalInput(r.novelTotalChapters != null ? String(r.novelTotalChapters) : '')
      setNovelPerVolInput(r.novelChaptersPerVolume != null ? String(r.novelChaptersPerVolume) : '')

      // 2026-07-21: 加载人物关系图谱 (STEP 03 数据)
      // 后端字段 character_graph_text 为 JSON 字符串, 解析失败时清空图谱状态
      const graph = parseGraphJson(r.characterGraphText)
      setCharacterGraph(graph)
      setGraphDirty(false)

      // 解析 sections
      if (r.sectionsJson) {
        try {
          const parsed = typeof r.sectionsJson === 'string' ? JSON.parse(r.sectionsJson) : r.sectionsJson
          const arr = Array.isArray(parsed) ? parsed : (parsed.sections || [])
          setSections(arr)
        } catch (e) {
          setSections([])
        }
      } else {
        setSections([])
      }

      // 推断题材
      // 2026-07-21: 优先匹配内置 4 题材; 若为 novel-user-* 自定义模板, 从 userTemplates 中查找.
      // 若 userTemplates 尚未加载完成, 用 templateId 构造一个最小卡片对象, 保证 selectedGenre 非空.
      if (r.templateId) {
        const g = NOVEL_GENRES.find(x => x.id === r.templateId)
        if (g) {
          setSelectedGenre(g)
        } else {
          const customTpl = userTemplates.find(t => t.id === r.templateId)
          if (customTpl) {
            setSelectedGenre(toGenreCardData(customTpl))
          } else if (r.templateId.startsWith('novel-user-')) {
            // userTemplates 还未加载完, 用最小数据兜底, 避免后续逻辑拿不到 selectedGenre
            setSelectedGenre({
              id: r.templateId, name: '自定义', numeral: '★',
              desc: '', fullDesc: '自定义模板',
              volumes: 0, chaptersPerVolume: 30,
              accent: '#d4a574',
              spineGradient: 'linear-gradient(180deg, #d4a574 0%, #8b6b3f 100%)',
              icon: '📖', isCustom: true,
            })
          }
        }
      }

      // 设置 synopsis 来自 topic
      setSynopsis(r.topic || '')

      // 2026-07-21: 三步→四步流程, 历史记录打开后直接进 STEP 04 (生成态).
      // 即使没有关系图谱也跳过 STEP 03, 因为历史记录通常已有大纲/章节, 无需再编辑图谱.
      setStep(4)
      // 2026-07-21 修复: 轮询启动条件从 status==='generating' 扩展为"非终态都启动".
      // 原逻辑只在 status='generating' 时启动轮询, 但以下场景会导致轮询丢失:
      //   1. 用户刷新浏览器时, status 刚好是 'paused' (max-chapters-per-session 触发批间停顿),
      //      后端 autoResumeLoopUntilDone 会自动恢复为 'generating', 但前端已不轮询, 看不到更新.
      //   2. 用户从历史列表打开一条 'paused' 记录, 期望看到自动续做进度, 但前端不轮询.
      // 修复: 只要 status 不是终态 (idle/draft/done/cancelled/failed) 都启动轮询.
      // 终态记录不需要轮询; idle/draft 是未启动状态, 由用户点"开始生成"触发.
      const terminalStatuses = ['idle', 'draft', 'done', 'cancelled', 'failed']
      if (!terminalStatuses.includes(r.status)) {
        startPolling(r.id)
      }
    } catch (err) {
      message.error('加载历史小说失败')
      console.error(err)
    }
  }

  // ── 生成状态同步: WebSocket 推送优先, HTTP 轮询兜底 ──
  // 2026-07-24: 原单一 setInterval 轮询改为 WS 优先 + HTTP 兜底.
  // 流程: startPolling 时先 HTTP 同步初始状态 (首次访问), 再建立 WS 连接接收服务端推送;
  //       WS 断开/出错时自动降级到 HTTP 轮询 (intervalMs), 保证可靠性.
  // 终态 (done/cancelled/failed) 时: 主动关闭 WS + 清理兜底定时器.

  // 把 research 字段应用到本地 state. 兼容完整对象 (HTTP) 和增量对象 (WS).
  // 增量场景下缺失字段 (undefined) 不覆盖现有 state.
  const applyResearchUpdate = (id, r) => {
    if (!r) return
    if (r.status !== undefined) setStatus(r.status)
    if (r.progress !== undefined) setProgress(r.progress || 0)
    if (r.progressMessage !== undefined) setProgressMessage(r.progressMessage || '')
    if (r.resumeBatch !== undefined) setResumeBatch(r.resumeBatch || 0)
    if (r.lastLlmActivityAt !== undefined) setLastLlmActivityAt(r.lastLlmActivityAt || null)

    // 2026-07-20 修复: sections_json 实时同步 — 即使为空也要 setSections([]).
    // 增量场景 (WS) 仅当 sectionsJson 字段存在时才更新, 避免推送 progress 时误清空章节.
    if (r.sectionsJson !== undefined) {
      try {
        const raw = r.sectionsJson
        let nextSections = []
        if (raw && typeof raw === 'string' && raw.trim()) {
          const parsed = JSON.parse(raw)
          nextSections = Array.isArray(parsed) ? parsed : (parsed.sections || [])
        } else if (raw && typeof raw === 'object') {
          nextSections = Array.isArray(raw) ? raw : (raw.sections || [])
        }
        const validSections = nextSections.filter(s => s && typeof s === 'object')
        console.log('[NovelPage] sections update:', {
          researchId: id, status: r.status,
          rawLen: typeof raw === 'string' ? raw.length : 0,
          count: validSections.length,
          firstTitle: validSections[0]?.title,
          lastTitle: validSections[validSections.length - 1]?.title,
        })
        setSections(validSections)
      } catch (e) {
        console.warn('[NovelPage] sectionsJson parse failed:', e)
      }
    }
    if (r.outlineText) setOutlineText(r.outlineText)
    if (r.generatedReport !== undefined) setGeneratedReport(r.generatedReport || '')
    // 2026-07-24: 同步书名, 用于导出文件名 fallback
    if (r.bookName !== undefined) setBookName(r.bookName || '')

    // 卡住检测: 20 分钟无 LLM 活动视为卡住 (仅当本次更新携带了相关字段才检测)
    const STALE_THRESHOLD_MS = 20 * 60 * 1000
    if (r.lastLlmActivityAt !== undefined || r.progress !== undefined) {
      let isStale = false
      if (r.lastLlmActivityAt) {
        const llmMs = new Date(r.lastLlmActivityAt).getTime()
        if (Date.now() - llmMs > STALE_THRESHOLD_MS) isStale = true
      }
      if (!isStale && r.progress !== undefined) {
        if (r.progress === lastProgressRef.current) {
          if (Date.now() - lastProgressTimeRef.current > STALE_THRESHOLD_MS) isStale = true
        } else {
          lastProgressRef.current = r.progress
          lastProgressTimeRef.current = Date.now()
        }
      }
      if (isStale && !staleWarnedRef.current) {
        staleWarnedRef.current = true
        setStaleWarning(true)
        message.warning('生成可能卡住：LLM 已 20 分钟无活动，建议检查或取消重试')
      } else if (!isStale && staleWarnedRef.current) {
        staleWarnedRef.current = false
        setStaleWarning(false)
      }
    }

    // 终态: 停止一切同步, done 时解析 generationMeta
    if (r.status === 'done' || r.status === 'cancelled' || r.status === 'failed') {
      console.log('[NovelPage] terminal status, stop sync. status=', r.status, 'researchId=', id)
      terminalReachedRef.current = true
      stopAllPolling()
      if (r.status === 'done' && r.generationMeta !== undefined) {
        const doneMeta = r.generationMeta ? (typeof r.generationMeta === 'string' ? JSON.parse(r.generationMeta) : r.generationMeta) : null
        setGenerationMeta(doneMeta)
        if (doneMeta?.totalChapters > 0) setExpectedTotalChapters(doneMeta.totalChapters)
      }
      // WS 终态消息不含 generatedReport (体积大), 拉取一次完整状态确保最终报告/章节最新.
      // pollOnce → applyResearchUpdate 会再次进入此分支, 但 stopAllPolling 幂等, 无副作用.
      if (r.generatedReport === undefined) {
        pollOnce(id)
      }
      loadHistory()
    }
  }

  // 停止所有同步通道 (WS + 兜底定时器). 终态/卸载/重置时调用.
  const stopAllPolling = () => {
    wsClosedByUsRef.current = true  // 标记主动关闭, 抑制 onclose 触发 fallback
    if (wsRef.current) {
      try { wsRef.current.close() } catch (_) {}
      wsRef.current = null
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (fallbackTimerRef.current) {
      clearInterval(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }

  // 单次 HTTP 拉取完整状态 (首次访问同步 + WS 断开兜底 + 终态最终同步用).
  const pollOnce = async (id) => {
    try {
      const res = await api.get(`/academic/research/${id}`)
      applyResearchUpdate(id, res.data)
    } catch (err) {
      console.error('[NovelPage] poll failed:', err)
    }
  }

  // 2026-07-24: startPolling — 首次 HTTP 同步 + 后续 WS 推送, WS 断开自动降级 HTTP 轮询.
  // intervalMs 仅用于 HTTP 兜底轮询间隔 (默认 60000, 生成中建议传 3000).
  const startPolling = async (id, intervalMs = 60000) => {
    // 清理旧通道
    stopAllPolling()
    wsClosedByUsRef.current = false
    terminalReachedRef.current = false
    staleWarnedRef.current = false
    lastProgressRef.current = 0
    lastProgressTimeRef.current = Date.now()

    console.log(`[NovelPage] startPolling: initial HTTP sync then WS, researchId=`, id)
    // 1. 首次访问: HTTP 同步当前完整状态
    await pollOnce(id)
    if (terminalReachedRef.current) return  // 首次同步已是终态, 无需 WS

    // 2. 建立 WS 连接接收服务端推送
    try {
      const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || ''
      const wsUrl = `${getWsBaseUrl()}/ws/research/${encodeURIComponent(id)}/progress?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onmessage = (ev) => {
        let data
        try { data = JSON.parse(ev.data) } catch (_) { return }
        if (!data || data.type !== 'research.progress') return
        applyResearchUpdate(id, data)
      }
      ws.onerror = (e) => {
        console.warn('[NovelPage] WS error, will fallback to HTTP poll if not terminal:', e)
      }
      ws.onclose = () => {
        console.log('[NovelPage] WS closed, researchId=', id)
        wsRef.current = null
        // 主动关闭 (终态/重置/卸载) 不触发 fallback
        if (wsClosedByUsRef.current || terminalReachedRef.current) return
        // 异常断开: 降级到 HTTP 轮询
        if (!fallbackTimerRef.current) {
          console.log(`[NovelPage] WS disconnected, fallback to ${intervalMs}ms HTTP poll`)
          fallbackTimerRef.current = setInterval(() => pollOnce(id), intervalMs)
        }
      }
    } catch (e) {
      console.warn('[NovelPage] WS connect failed, fallback to HTTP poll:', e)
      // WS 建立失败: 直接走 HTTP 轮询
      fallbackTimerRef.current = setInterval(() => pollOnce(id), intervalMs)
    }
  }

  useEffect(() => () => {
    // 2026-07-21 诊断: 组件卸载时清理轮询, 加日志确认是否被误触发
    // 2026-07-24: 同步清理 WS + 兜底定时器
    if (pollTimerRef.current || wsRef.current || fallbackTimerRef.current) {
      console.log('[NovelPage] unmount: clear WS + polling timers')
    }
    stopAllPolling()
  }, [])

  // ── 2026-07-21: 生成风格偏好 (持久化, 跨章节生效) ──
  // 用户在"开始生成"/"继续生成"前可注入偏好 (如"文风古雅, 多用诗词"/"节奏紧凑, 每章必有悬念").
  // 与 regenHint/outlineRegenHint 的区别: styleHint 持久化保存到 DB, 每章生成都注入 prompt,
  // 不会用后清空. 用户可随时修改, 修改后影响后续未生成的章节.
  const openStyleHintModal = (action) => {
    setStyleHintDraft(styleHint || '')
    setStyleHintPendingAction(action)
    setStyleHintModalOpen(true)
  }

  // doGenerate: 实际生成逻辑 (从 handleGenerate 抽出, 由 handleStyleHintConfirm 调用).
  // handleGenerate 负责校验 + 打开 Modal; 用户确认后调本方法执行 API 调用.
  // 2026-07-22: 新增 hintOverride 参数 — React setState 异步, handleStyleHintConfirm 里
  // setStyleHint(hint) 后立即调 doGenerate(), doGenerate 内读 styleHint state 拿到的是旧值,
  // 导致全新生成时 styleHint 丢失 (if(styleHint) 判断为 false, 跳过 DB 保存).
  // hintOverride 显式传入最新值, 优先于 state.
  const doGenerate = async (hintOverride) => {
    const genre = selectedGenre
    if (!genre) { message.warning('请先选择题材'); return }
    if (!synopsis.trim() || synopsis.trim().length < 10) {
      message.warning('请输入至少 10 字的简短提要')
      return
    }
    // 2026-07-22: 优先用 hintOverride (来自 Modal 确认的最新值), 避免 setState 异步导致读取旧值
    const effectiveStyleHint = (hintOverride !== undefined ? hintOverride : styleHint) || ''
    try {
      let newId = researchId
      if (!newId) {
        const createRes = await api.post('/academic/research', {
          topic: synopsis.trim(),
          report_type: 'novel',
        })
        newId = createRes.data.id
        setResearchId(newId)
      }
      // 2026-07-21: 保存风格偏好到 DB (全新生成时 researchId 刚创建, 此处补存)
      // 2026-07-22: 用 effectiveStyleHint 而非 styleHint state (避免 setState 异步读旧值)
      if (effectiveStyleHint) {
        try {
          await api.put(`/academic/research/${newId}/style-hint`, { style_hint: effectiveStyleHint })
        } catch (e) {
          console.warn('[NovelPage] Failed to save style hint for new research:', e)
        }
      }
      // 2026-07-22: 保存用户自定义的章节规划到 DB (优先级高于题材默认值)
      // 后端 parseTargetChapterCount 会优先读取这两个字段决定总章节数和卷数
      {
        const tc = novelTotalInput.trim() ? parseInt(novelTotalInput.trim(), 10) : null
        const cpv = novelPerVolInput.trim() ? parseInt(novelPerVolInput.trim(), 10) : null
        if (tc || cpv) {
          try {
            await api.put(`/academic/research/${newId}/novel-chapter-plan`, {
              total_chapters: tc,
              chapters_per_volume: cpv,
            })
          } catch (e) {
            console.warn('[NovelPage] Failed to save novel chapter plan:', e)
          }
        }
      }
      await api.post(`/academic/research/${newId}/generate`, {
        user_prompt: synopsis.trim(),
        template_id: genre.id,
      })
      setStatus('generating')
      setProgress(0)
      setStep(4)
      {
        // 2026-07-22: 优先用用户自定义的总章节数, 其次题材默认值
        const userInputTotal = novelTotalInput.trim() ? parseInt(novelTotalInput.trim(), 10) : null
        const metaTotal = userInputTotal || genre.totalChapters
        const fallbackTotal = genre.volumes * genre.chaptersPerVolume
        setExpectedTotalChapters(metaTotal || fallbackTotal || 0)
      }
      lastProgressRef.current = 0
      lastProgressTimeRef.current = Date.now()
      staleWarnedRef.current = false
      setStaleWarning(false)
      // 2026-07-23: 全新生成时用 3s 轮询 (而非默认 60s), 让大纲生成期间用户能实时看到
      // 章节名逐章追加 (后端 generateHierarchicalNovelOutline 每卷完成即增量持久化 outline_text).
      // 60s 间隔下用户要等很久才看到大纲更新, 体验上像"看不到大纲列表".
      startPolling(newId, 3000)
      message.success('开始生成小说')
    } catch (err) {
      message.error('启动生成失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    }
  }

  // doResume: 实际恢复生成逻辑 (从 handleResume 抽出, 由 handleStyleHintConfirm 调用).
  const doResume = async () => {
    if (!researchId) return
    try {
      const res = await api.post(`/academic/research/${researchId}/resume`)
      if (res.data?.resumed) {
        setStatus('generating')
        staleWarnedRef.current = false
        setStaleWarning(false)
        lastProgressTimeRef.current = Date.now()
        startPolling(researchId)
        message.success('已恢复生成')
      } else {
        message.info(res.data?.message || '当前无法恢复')
      }
    } catch (err) {
      message.error('恢复失败')
      console.error(err)
    }
  }

  // handleStyleHintConfirm: Modal 确认回调 — 保存偏好到 DB, 然后执行待处理动作.
  const handleStyleHintConfirm = async () => {
    const hint = styleHintDraft.trim()
    setStyleHint(hint)
    setStyleHintModalOpen(false)
    // 持久化到 DB (researchId 已存在时). 全新生成时 researchId 可能为空,
    // doGenerate 创建 research 后会补存.
    if (researchId) {
      try {
        await api.put(`/academic/research/${researchId}/style-hint`, { style_hint: hint })
      } catch (e) {
        console.warn('[NovelPage] Failed to save style hint:', e)
      }
    }
    // 执行待处理动作
    const action = styleHintPendingAction
    setStyleHintPendingAction(null)
    if (action === 'generate') {
      // 2026-07-22: 传 hint 给 doGenerate, 避免 setState 异步导致 doGenerate 读到旧 styleHint
      await doGenerate(hint)
    } else if (action === 'resume') {
      await doResume()
    } else if (action === 'edit') {
      if (!researchId) {
        message.success('风格偏好已记录，将在开始生成时保存')
      } else {
        message.success(hint ? '风格偏好已保存' : '风格偏好已清空')
      }
    }
  }

  // ── 创建并启动生成 ──
  const handleGenerate = async () => {
    // 2026-07-21: 防御性恢复 selectedGenre.
    // 场景: 用户已生成过人物关系图谱 (说明曾选过题材), 但因刷新页面/历史加载时
    // r.templateId 为空或匹配失败, selectedGenre 未能恢复. 此时用户在 STEP 03/04
    // 点击"生成大纲"会被"请先选择题材"挡住, 且无法回到 STEP 01 (步骤已不可见).
    // 修复: 若 researchId 已存在 (说明已创建任务), 从 DB 读取 templateId 重建 selectedGenre.
    // 后端 generateReport 也会兜底用 r.getTemplateId(), 但前端需要 selectedGenre
    // 来预填 expectedTotalChapters 和显示题材信息, 故仍需恢复.
    let genre = selectedGenre
    if (!genre && researchId) {
      try {
        const res = await api.get(`/academic/research/${researchId}`)
        const r = res.data
        if (r?.templateId) {
          const g = NOVEL_GENRES.find(x => x.id === r.templateId)
          if (g) {
            genre = g
          } else if (r.templateId.startsWith('novel-user-')) {
            const customTpl = userTemplates.find(t => t.id === r.templateId)
            genre = customTpl ? toGenreCardData(customTpl) : {
              id: r.templateId, name: '自定义', numeral: '★',
              desc: '', fullDesc: '自定义模板',
              volumes: 0, chaptersPerVolume: 30,
              accent: '#d4a574',
              spineGradient: 'linear-gradient(180deg, #d4a574 0%, #8b6b3f 100%)',
              icon: '📖', isCustom: true,
            }
          }
          if (genre) {
            setSelectedGenre(genre)
            console.log('[NovelPage] handleGenerate: restored selectedGenre from DB, id=', genre.id)
          }
        }
      } catch (e) {
        console.error('[NovelPage] handleGenerate: failed to restore selectedGenre from DB', e)
      }
    }
    if (!genre) { message.warning('请先选择题材'); return }
    if (!synopsis.trim() || synopsis.trim().length < 10) {
      message.warning('请输入至少 10 字的简短提要')
      return
    }
    // 2026-07-21: 校验通过后打开风格偏好 Modal, 用户确认后调 doGenerate.
    // 偏好会持久化保存到 DB, 每章生成都注入 prompt.
    openStyleHintModal('generate')
  }

  // ── 取消生成 ──
  const handleCancel = async () => {
    if (!researchId) return
    try {
      const res = await api.post(`/academic/research/${researchId}/cancel`)
      if (res.data?.cancelled) {
        message.success('已取消生成')
        // 2026-07-21 修复: 取消请求已被后端接受, 启动 3 秒快速轮询及时检测
        // status 变为 cancelled, 让"取消生成"按钮快速切换为"恢复生成".
        // 后端 cancel 是异步的 (设置 cancel_requested=true, 生成线程走到下个检查点
        // 才真正把 status 改为 cancelled), 所以需要快速轮询确认.
        // 检测到 terminal status (cancelled/failed/done) 后轮询会自动停止.
        startPolling(researchId, 3000)
      } else {
        // 2026-07-21 修复: 后端返回"任务不在生成中" — 通常是后端重启后 DB status 已被
        // resetStaleGeneratingStatus 改成 draft, 但前端 status state 还是旧的 generating
        // (轮询 60s 间隔太长未同步). 此时主动刷新 research 状态, 让 UI 同步到实际状态:
        //   - draft + 无 outline: 显示"准备就绪 / 开始生成"卡片
        //   - draft/cancelled/failed + 有 outline: 显示"继续生成" / "重新生成大纲"按钮
        //   - done: 显示完成态按钮
        // 避免用户卡在"生成中"UI 却点取消失败, 且看不到重新生成的入口.
        message.info(res.data?.message || '任务已不在生成中（可能后端已重启）')
        try {
          const fresh = await api.get(`/academic/research/${researchId}`)
          const r = fresh.data
          console.log('[NovelPage] handleCancel: backend says not generating, sync status from DB. local=generating, db=', r.status)
          setStatus(r.status || 'idle')
          setProgress(r.progress || 0)
          setProgressMessage(r.progressMessage || '')
          if (r.outlineText !== undefined) setOutlineText(r.outlineText || '')
          // 停止同步 (实际状态非 generating, 无需再轮询/WS)
          if (pollTimerRef.current || wsRef.current || fallbackTimerRef.current) {
            console.log('[NovelPage] handleCancel: stop sync after sync (status not generating)')
            stopAllPolling()
          }
        } catch (syncErr) {
          console.error('[NovelPage] handleCancel: failed to sync status from DB', syncErr)
        }
      }
    } catch (err) {
      message.error('取消失败')
      console.error(err)
    }
  }

  // ── 续传生成 ──
  // 2026-07-21: 改为先打开风格偏好 Modal, 用户确认后调 doResume.
  // 偏好会持久化保存到 DB, 影响后续未生成章节的风格.
  const handleResume = async () => {
    if (!researchId) return
    openStyleHintModal('resume')
  }

  // 2026-07-20: 重新生成大纲 — 清空 outline+sections+report, 走全新生成路径.
  // 用于大纲生成失败 / 大纲质量不满意时. 用户已生成的大纲和章节内容会被清空.
  // 2026-07-21: 改为弹窗让用户输入偏好 (与章节重新生成一致), 偏好会注入 LLM prompt.
  const handleRegenerateOutline = () => {
    if (!researchId) return
    setOutlineRegenHint('')
    setOutlineRegenModalOpen(true)
  }

  const handleOutlineRegenConfirm = async () => {
    setOutlineRegenModalOpen(false)
    if (!researchId) return
    const hint = outlineRegenHint.trim() || null
    try {
      const res = await api.post(`/academic/research/${researchId}/regenerate-outline`,
        hint ? { user_hint: hint } : {})
      if (res.data?.started) {
        setStatus('generating')
        setProgress(0)
        setSections([])
        setOutlineText('')
        setGeneratedReport('')
        setExpectedTotalChapters(selectedGenre ? (selectedGenre.totalChapters || selectedGenre.volumes * selectedGenre.chaptersPerVolume) : 0)
        lastProgressRef.current = 0
        lastProgressTimeRef.current = Date.now()
        staleWarnedRef.current = false
        setStaleWarning(false)
        startPolling(researchId)
        message.success(hint ? '已按偏好开始重新生成大纲' : '已开始重新生成大纲')
      } else {
        message.error(res.data?.error || '启动失败')
      }
    } catch (err) {
      message.error('重新生成大纲失败')
      console.error(err)
    }
  }

  // 2026-07-20: 重新生成章节内容 — 保留 outline, 清空 sections+report, 走 resume 路径.
  // 用于章节正文生成失败 (如 generateReportDirect 降级 / LLM 超时) 时.
  // 大纲保留避免重新跑 Stage 1 分层大纲生成 (~8 分钟), 显著缩短重试时间.
  const handleRegenerateSections = async () => {
    if (!researchId) return
    Modal.confirm({
      title: '重新生成章节内容',
      content: '将保留当前大纲, 仅清空已生成的章节正文并重新生成. 此操作不可撤销, 是否继续?',
      okText: '确定重新生成章节',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await api.post(`/academic/research/${researchId}/regenerate-sections`)
          if (res.data?.started) {
            setStatus('generating')
            setProgress(0)
            setSections([])
            setGeneratedReport('')
            lastProgressRef.current = 0
            lastProgressTimeRef.current = Date.now()
            staleWarnedRef.current = false
            setStaleWarning(false)
            startPolling(researchId)
            message.success('已开始重新生成章节内容（保留大纲）')
          } else {
            message.error(res.data?.error || '启动失败')
          }
        } catch (err) {
          message.error('重新生成章节内容失败')
          console.error(err)
        }
      },
    })
  }

  // ── 复制全文 ──
  const handleCopy = () => {
    if (!generatedReport) return
    navigator.clipboard.writeText(generatedReport).then(() => {
      message.success('已复制全文到剪贴板')
    }).catch(() => message.error('复制失败'))
  }

  // ── 2026-07-23: 导出 Word/PDF — 调用后端接口生成带格式的文档 (章节标题分级 + ### 子小节标题) ──
  // 原实现用 Blob 把纯文本塞进 .doc, 无章节标题分级、无段落格式、无 PDF 支持.
  // 改为调用后端 /academic/research/{id}/export?format=docx|pdf, 后端用 POI/pdfbox 生成.
  const handleExportWord = async () => {
    if (!researchId) { message.warning('请先选择或生成小说'); return }
    try {
      message.loading({ content: '正在生成 Word 文档...', key: 'export-word', duration: 0 })
      const res = await api.get(`/academic/research/${researchId}/export`, {
        params: { format: 'docx' },
        responseType: 'blob',
        timeout: 120000,
      })
      // 2026-07-24: 文件名优先级: Content-Disposition > bookName > selectedArc.title > synopsis 前 20 字
      let fallbackName = bookName || selectedArc?.title || (synopsis || 'novel').slice(0, 20)
      let filename = `${fallbackName}.docx`
      const cd = res.headers['content-disposition']
      if (cd) {
        const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd)
        if (m && m[1]) filename = decodeURIComponent(m[1])
      }
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      message.success({ content: '已导出 Word 文档', key: 'export-word' })
    } catch (e) {
      console.error('[NovelPage] export word failed:', e)
      message.error({ content: '导出 Word 失败: ' + (e.response?.status === 400 ? '无章节内容, 请先生成' : e.message), key: 'export-word' })
    }
  }

  const handleExportPdf = async () => {
    if (!researchId) { message.warning('请先选择或生成小说'); return }
    try {
      message.loading({ content: '正在生成 PDF 文档...', key: 'export-pdf', duration: 0 })
      const res = await api.get(`/academic/research/${researchId}/export`, {
        params: { format: 'pdf' },
        responseType: 'blob',
        timeout: 120000,
      })
      // 2026-07-24: 文件名优先级: Content-Disposition > bookName > selectedArc.title > synopsis 前 20 字
      let fallbackName = bookName || selectedArc?.title || (synopsis || 'novel').slice(0, 20)
      let filename = `${fallbackName}.pdf`
      const cd = res.headers['content-disposition']
      if (cd) {
        const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd)
        if (m && m[1]) filename = decodeURIComponent(m[1])
      }
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      message.success({ content: '已导出 PDF 文档', key: 'export-pdf' })
    } catch (e) {
      console.error('[NovelPage] export pdf failed:', e)
      message.error({ content: '导出 PDF 失败: ' + (e.response?.status === 400 ? '无章节内容, 请先生成' : e.message), key: 'export-pdf' })
    }
  }

  // ── 2026-07-21: 章节级重新生成 (三阶段: 输入修改重点 → 预览对比 → 保存/取消) ──
  // 阶段1 (input): 用户输入修改重点, 点"重新生成" → 调 /regenerate-preview (不写DB)
  // 阶段2 (preview): 展示新旧内容对比, 用户点"保存" → 调 /regenerate-commit (写DB)
  //                 用户点"取消" → 关闭对话框, 原章节内容保留 (DB 未变)
  const handleRegenerateSection = (sectionIdx) => {
    if (!researchId) {
      message.warning('请先选择一个小说任务')
      return
    }
    const sec = sections[sectionIdx]
    if (!sec || (!sec.refined && !sec.draft)) {
      message.warning('该章节尚未生成, 无法重新生成')
      return
    }
    if (status === 'generating') {
      message.warning('生成进行中, 请先取消或等待完成后再重新生成章节')
      return
    }
    setRegenSectionIdx(sectionIdx)
    setRegenStage('input')
    setRegenHint('')
    setRegenPreview(null)
  }

  // 阶段1 → 阶段2: 调 preview 接口, 拿到新旧内容
  const handleRegenPreview = async () => {
    if (regenSectionIdx === null) return
    const hint = regenHint.trim()
    if (!hint) {
      message.warning('请输入需要修改的重点')
      return
    }
    setRegenLoading(true)
    try {
      const res = await api.post(
        `/academic/research/${researchId}/sections/${regenSectionIdx}/regenerate-preview`,
        { user_hint: hint }
      )
      if (res.data?.previewed) {
        setRegenPreview({
          section_name: res.data.section_name,
          original_refined: res.data.original_refined,
          new_refined: res.data.new_refined,
        })
        setRegenStage('preview')
      } else {
        message.error(res.data?.error || '重新生成预览失败')
      }
    } catch (err) {
      message.error('重新生成预览失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setRegenLoading(false)
    }
  }

  // 阶段2 保存: 调 commit 接口, 写入 DB
  const handleRegenCommit = async () => {
    if (regenSectionIdx === null || !regenPreview?.new_refined) return
    setRegenCommitLoading(true)
    try {
      const res = await api.post(
        `/academic/research/${researchId}/sections/${regenSectionIdx}/regenerate-commit`,
        { user_hint: regenHint.trim(), new_refined: regenPreview.new_refined }
      )
      if (res.data?.committed) {
        // 后端返回新的 sections JSON 字符串, 解析后更新前端状态
        let newSections = []
        try {
          const parsed = typeof res.data.sections === 'string'
            ? JSON.parse(res.data.sections) : res.data.sections
          newSections = Array.isArray(parsed) ? parsed : (parsed.sections || [])
        } catch (e) {
          console.warn('[NovelPage] regen commit sections parse failed:', e)
        }
        if (newSections.length > 0) {
          setSections(newSections.filter(s => s && typeof s === 'object'))
        }
        if (res.data.report) setGeneratedReport(res.data.report)
        setStatus('done')
        message.success(`已保存第 ${regenSectionIdx + 1} 章的重新生成内容`)
        setRegenSectionIdx(null)
        setRegenStage('input')
        setRegenHint('')
        setRegenPreview(null)
      } else {
        message.error(res.data?.error || '保存失败')
      }
    } catch (err) {
      message.error('保存失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setRegenCommitLoading(false)
    }
  }

  // 阶段2 取消: 不调任何接口, 原章节内容保留 (DB 未变)
  const handleRegenCancel = () => {
    if (regenLoading || regenCommitLoading) return  // 生成/提交中不允许关闭
    setRegenSectionIdx(null)
    setRegenStage('input')
    setRegenHint('')
    setRegenPreview(null)
  }

  // ── 2026-07-23: 过短段落清单 + 人工交互式扩展 ──
  // 流程: 列出清单 → 用户点击某段落 → 输入扩展方向(可空) → LLM 扩展预览 → 保存/取消
  // 后端 expand API 已把扩展结果存到 sec.pendingParagraphExpands[paraIdx],
  // commit 时应用到 refined + 重写 generated_report, cancel 时清除 pending.
  // 小说场景下 Stage 3.5 已禁用自动扩展, 完全由人工触发.

  // 加载过短段落清单 (默认阈值 300 字)
  const handleLoadShortParagraphs = async (minChars = 300) => {
    if (!researchId) { message.warning('请先选择一个小说任务'); return }
    if (status === 'generating') {
      message.warning('生成进行中, 请先取消或等待完成')
      return
    }
    setShortParagraphsLoading(true)
    try {
      const res = await api.get(`/academic/research/${researchId}/short-paragraphs`, {
        params: { min_chars: minChars },
      })
      if (res.data) {
        setShortParagraphs(res.data.items || [])
        setShortParagraphsThreshold(res.data.threshold || minChars)
      }
    } catch (err) {
      message.error('加载过短段落清单失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setShortParagraphsLoading(false)
    }
  }

  // 点击清单中某个段落的"扩展"按钮 → 打开 input Modal
  const handleParaExpandStart = (item) => {
    if (status === 'generating') {
      message.warning('生成进行中, 请先取消或等待完成')
      return
    }
    setParaExpandTarget({
      section_idx: item.section_idx,
      para_idx: item.para_idx,
      section_name: item.section_name,
      original: item.paragraph,
      length: item.length,
    })
    setParaExpandStage('input')
    setParaExpandHint('')
    setParaExpandPreview(null)
  }

  // input → preview: 调 expand API, 拿到扩展后文本
  const handleParaExpandPreview = async () => {
    if (!paraExpandTarget || !researchId) return
    setParaExpandLoading(true)
    try {
      const payload = {}
      const hint = paraExpandHint.trim()
      if (hint) payload.expand_hint = hint
      const res = await api.post(
        `/academic/research/${researchId}/sections/${paraExpandTarget.section_idx}/paragraphs/${paraExpandTarget.para_idx}/expand`,
        payload,
        { timeout: 600000 }
      )
      if (res.data?.expanded) {
        // 后端返回完整 sectionsJson, 解析出 pendingParagraphExpands[para_idx].expanded
        let expandedText = ''
        let debateText = ''
        try {
          const parsed = typeof res.data.sections === 'string'
            ? JSON.parse(res.data.sections) : res.data.sections
          const arr = Array.isArray(parsed) ? parsed : (parsed.sections || [])
          const sec = arr[paraExpandTarget.section_idx]
          const pending = sec?.pendingParagraphExpands?.[String(paraExpandTarget.para_idx)]
          if (pending) {
            expandedText = pending.expanded || ''
            debateText = pending.debate || ''
          }
        } catch (e) {
          console.warn('[NovelPage] parse pendingParagraphExpands failed:', e)
        }
        if (!expandedText) {
          message.error('扩展结果解析失败, 请重试')
          return
        }
        setParaExpandPreview({ expanded: expandedText, debate: debateText })
        setParaExpandStage('preview')
      } else {
        message.error(res.data?.error || '扩展失败')
      }
    } catch (err) {
      message.error('扩展失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setParaExpandLoading(false)
    }
  }

  // preview → 保存: 调 commit API, 写入 refined + 重写 report
  const handleParaExpandCommit = async () => {
    if (!paraExpandTarget || !researchId) return
    setParaExpandCommitLoading(true)
    try {
      const res = await api.post(
        `/academic/research/${researchId}/sections/${paraExpandTarget.section_idx}/paragraphs/${paraExpandTarget.para_idx}/commit`,
        {},
        { timeout: 300000 }
      )
      if (res.data?.committed) {
        // 更新前端 sections 和 report
        let newSections = []
        try {
          const parsed = typeof res.data.sections === 'string'
            ? JSON.parse(res.data.sections) : res.data.sections
          newSections = Array.isArray(parsed) ? parsed : (parsed.sections || [])
        } catch (e) {
          console.warn('[NovelPage] para expand commit sections parse failed:', e)
        }
        if (newSections.length > 0) {
          setSections(newSections.filter(s => s && typeof s === 'object'))
        }
        if (res.data.report) setGeneratedReport(res.data.report)
        setStatus('done')
        message.success(`已保存 ${paraExpandTarget.section_name} 段落 ${paraExpandTarget.para_idx + 1} 的扩展`)
        // 关闭 Modal 并刷新清单 (该段落已扩展, 从清单移除)
        setParaExpandTarget(null)
        setParaExpandStage('input')
        setParaExpandHint('')
        setParaExpandPreview(null)
        // 重新加载清单 (后台静默刷新)
        handleLoadShortParagraphs(shortParagraphsThreshold)
      } else {
        message.error(res.data?.error || '保存失败')
      }
    } catch (err) {
      message.error('保存失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setParaExpandCommitLoading(false)
    }
  }

  // preview → 取消: 调 cancel API 清除 pending, 原段落不变
  const handleParaExpandCancel = async () => {
    if (!paraExpandTarget || !researchId) return
    if (paraExpandLoading || paraExpandCommitLoading) return
    // 如果还在 input 阶段 (未调 expand), 直接关闭 Modal 即可
    if (paraExpandStage === 'input') {
      setParaExpandTarget(null)
      setParaExpandHint('')
      setParaExpandPreview(null)
      return
    }
    // preview 阶段: 调 cancel API 清除 pending
    try {
      await api.post(
        `/academic/research/${researchId}/sections/${paraExpandTarget.section_idx}/paragraphs/${paraExpandTarget.para_idx}/cancel`
      )
    } catch (err) {
      console.warn('[NovelPage] cancel pending expand failed (ignore):', err)
    }
    setParaExpandTarget(null)
    setParaExpandStage('input')
    setParaExpandHint('')
    setParaExpandPreview(null)
  }

  // preview → 重新扩展 (回到 input 阶段, 保留 hint)
  const handleParaExpandRetry = () => {
    if (paraExpandCommitLoading || paraExpandLoading) return
    setParaExpandStage('input')
    setParaExpandPreview(null)
  }

  // 阶段2 返回: 回到阶段1 重新输入修改重点 (保留当前 hint, 不清空预览内容会让用户困惑)
  const handleRegenBackToInput = () => {
    if (regenCommitLoading) return
    setRegenStage('input')
    setRegenPreview(null)
  }

  // 阶段2 再试一次: 用当前 hint 重新调 preview (不返回 input 阶段, 直接覆盖预览内容)
  // 用户对新内容不满意时, 无需返回修改阶段重新输入 hint, 直接点"再试一次"即可.
  // LLM 生成有随机性, 同一 hint 多次调可能得到不同结果.
  const handleRegenRetry = async () => {
    if (regenSectionIdx === null || regenCommitLoading || regenLoading) return
    const hint = regenHint.trim()
    if (!hint) {
      message.warning('修改重点为空, 请返回修改阶段输入')
      return
    }
    setRegenLoading(true)
    try {
      const res = await api.post(
        `/academic/research/${researchId}/sections/${regenSectionIdx}/regenerate-preview`,
        { user_hint: hint }
      )
      if (res.data?.previewed) {
        setRegenPreview({
          section_name: res.data.section_name,
          original_refined: res.data.original_refined,
          new_refined: res.data.new_refined,
        })
        message.success('已重新生成, 请对比新内容')
      } else {
        message.error(res.data?.error || '再试一次失败')
      }
    } catch (err) {
      message.error('再试一次失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setRegenLoading(false)
    }
  }

  // ── 删除历史 ──
  const handleDeleteHistory = async (id, e) => {
    e.stopPropagation()
    try {
      await api.delete(`/academic/research/${id}`)
      message.success('已删除')
      loadHistory()
      if (id === researchId) handleReset()
    } catch (err) {
      message.error('删除失败')
      console.error(err)
    }
  }

  // ── 重置新建 ──
  const handleReset = () => {
    if (pollTimerRef.current || wsRef.current || fallbackTimerRef.current) {
      console.log('[NovelPage] handleReset: clear WS + polling timers')
      stopAllPolling()
    }
    setResearchId(null)
    setStatus('idle')
    setProgress(0)
    setProgressMessage('')
    setResumeBatch(0)
    setLastLlmActivityAt(null)
    setGenerationMeta(null)
    setOutlineText('')
    setSections([])
    setGeneratedReport('')
    setExpectedTotalChapters(0)
    setBookName('')  // 2026-07-24: 重置书名
    setSelectedGenre(null)
    setSynopsis('')
    setNovelTotalInput('')
    setNovelPerVolInput('')
    setNovelCharCountInput('')
    setStoryArcs([])
    setSelectedArc(null)
    setArcLoading(false)
    setCharacterGraph(null)
    setGraphDirty(false)
    setGraphLoading(false)
    setGraphNewChar({ name: '', role: '', goal: '', personality: '' })
    setGraphNewRel({ from: '', to: '', type: '合作', description: '' })
    setGraphRegenModalOpen(false)
    setGraphRegenHint('')
    setGraphRegenClear(false)
    setOutlineRegenModalOpen(false)
    setOutlineRegenHint('')
    setCharacterEditing(null)
    setCharacterEditingId(null)
    setStep(1)
    staleWarnedRef.current = false
    setStaleWarning(false)
  }

  // ── 2026-07-21: 人物关系图谱 handlers (STEP 03) ──
  // 设计: 图谱 = { characters: [{id,name,role,goal,personality}], relationships: [{from,to,type,description}] }
  //   - characters.id: 稳定字符串 ID, 用于 relationships.from/to 引用
  //   - relationships.type: 合作 / 敌对 / 师徒 / 情感 / 亲属 / 主仆 等
  // 用户流程: STEP 02 完成 → 跳到 STEP 03 → 点"生成关系图谱" → LLM 产出 →
  //          (可选)手动增删角色/关系 → 点"保存并生成大纲" → 进入 STEP 04
  // 后端: POST /character-graph/generate (LLM 生成 + 写 DB), PUT /character-graph (保存用户编辑)

  // 安全解析 JSON 字符串为图谱对象, 失败返回 null
  const parseGraphJson = (raw) => {
    if (!raw || typeof raw !== 'string') return null
    try {
      const obj = JSON.parse(raw)
      if (!obj || !Array.isArray(obj.characters)) return null
      if (!Array.isArray(obj.relationships)) obj.relationships = []
      return obj
    } catch (e) {
      return null
    }
  }

  // 2026-07-22: 生成故事弧线候选 — 用户在 STEP 01 点"生成弧线大纲"按钮触发.
  // 流程: 创建 research → 保存题材+偏好 → 调 /story-arcs/generate → 显示弧线列表供用户选择.
  // 选中弧线后填充章节数到 STEP 02 输入框, 弧线 title+desc 拼到 user_prompt 传给后续生成.
  const handleGenerateArcs = async () => {
    if (!selectedGenre || !synopsis.trim()) {
      message.warning('请先完成题材与故事偏好')
      return
    }
    if (synopsis.trim().length < 10) {
      message.warning('故事偏好至少 10 字')
      return
    }
    setArcLoading(true)
    try {
      let id = researchId
      // 1. 创建 research (如果还没创建)
      if (!id) {
        const createRes = await api.post('/academic/research', {
          topic: synopsis.trim(),
          report_type: 'novel',
        })
        id = createRes.data.id
        setResearchId(id)
      } else {
        // 已有 research, 更新 topic (偏好可能改过)
        await api.put(`/academic/research/${id}`, { topic: synopsis.trim() })
      }
      // 2. 保存题材
      await api.put(`/academic/research/${id}`, { template_id: selectedGenre.id })
      // 3. 调弧线生成接口
      const res = await api.post(`/academic/research/${id}/story-arcs/generate`)
      const arcs = res.data.arcs || []
      if (arcs.length === 0) {
        message.error('弧线生成失败, 请重试')
        return
      }
      setStoryArcs(arcs)
      setSelectedArc(null)
    } catch (err) {
      message.error('生成故事弧线失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setArcLoading(false)
    }
  }

  // 2026-07-22: 选中弧线 — 填充章节数到输入框, 设置 selectedArc, 进入 STEP 02.
  // 弧线的 title+desc 会在 doGenerate/handleGenerateGraphFromStep2 时拼到 user_prompt 传给后端.
  // 2026-07-23: 同时把弧线标题作为书名持久化到 DB (book_name 字段),
  // 用于历史列表卡片显示和导出文件名, 优先级高于 topic.
  const handleSelectArc = async (arc) => {
    setSelectedArc(arc)
    // 自动填充章节数 (用户仍可在 STEP 02 修改)
    setNovelTotalInput(String(arc.total_chapters))
    setNovelPerVolInput(String(arc.chapters_per_volume))
    // 持久化书名 (弧线标题); researchId 在 handleGenerateArcs 时已创建
    if (researchId) {
      try {
        await api.put(`/academic/research/${researchId}/book-name`, { book_name: arc.title })
      } catch (err) {
        console.warn('[NovelPage] save book_name failed (ignore):', err)
      }
    }
    message.success(`已选择弧线: ${arc.title}`)
    setStep(2)
  }

  // 调 LLM 生成人物关系图谱 (基于题材+提要), 写入 DB 并更新本地状态.
  // 2026-07-21: 已有图谱时点击"重新生成"会先弹窗让用户输入偏好, 再调 _doGenerateGraph.
  // 首次生成 (无图谱) 直接调, 不需要偏好.
  // 2026-07-22: 新增 handleGenerateGraphFromStep2 — 从 STEP 02 "生成人物关系"按钮直接触发,
  // 合并了创建 research + 保存章节/角色配置 + 生成图谱三步, 用户无需先跳到 STEP 03 再点生成.
  const handleGenerateGraphFromStep2 = async () => {
    if (!selectedGenre || !synopsis.trim()) {
      message.warning('请先完成题材与提要')
      return
    }
    // 2026-07-24: 必须先在 STEP 01 选定故事弧线 (含书名) 才能生成人物关系.
    // 按钮 disabled 已拦截, 此处为防御性兜底, 避免无弧线信息就生成.
    if (!selectedArc) {
      message.warning('请先在第一步生成弧线大纲并选择一条弧线')
      return
    }
    // 解析用户输入的角色数量
    const cc = novelCharCountInput.trim() ? parseInt(novelCharCountInput.trim(), 10) : null
    // 2026-07-22: 如果用户选了故事弧线, 把弧线 title+desc 拼到 topic 传给后端,
    // 让人物关系和大纲生成能引用弧线信息 (情节走向、卷划分逻辑).
    let effectiveTopic = synopsis.trim()
    if (selectedArc) {
      effectiveTopic = effectiveTopic + '\n\n【故事弧线: ' + selectedArc.title + '】\n' + selectedArc.desc
        + '\n(共' + selectedArc.total_chapters + '章, ' + selectedArc.volumes + '卷, 每卷' + selectedArc.chapters_per_volume + '章)'
    }
    setGraphLoading(true)
    try {
      let id = researchId
      // 1. 创建 research 记录 (如果还没创建)
      if (!id) {
        const createRes = await api.post('/academic/research', {
          topic: effectiveTopic,
          report_type: 'novel',
        })
        id = createRes.data.id
        setResearchId(id)
        // 保存故事类型 (template_id), 让后端生成图谱时能区分题材
        await api.put(`/academic/research/${id}`, { template_id: selectedGenre.id })
      } else {
        // 已有 research, 更新 topic (含弧线信息)
        await api.put(`/academic/research/${id}`, { topic: effectiveTopic })
      }
      // 2. 保存章节规划配置 (总章节数 + 每卷章节数) 到 DB
      const tc = novelTotalInput.trim() ? parseInt(novelTotalInput.trim(), 10) : null
      const cpv = novelPerVolInput.trim() ? parseInt(novelPerVolInput.trim(), 10) : null
      if (tc || cpv) {
        try {
          await api.put(`/academic/research/${id}/novel-chapter-plan`, {
            total_chapters: tc,
            chapters_per_volume: cpv,
          })
        } catch (e) {
          console.warn('[NovelPage] Failed to save novel chapter plan from step2:', e)
        }
      }
      // 3. 调图谱生成接口 (传 characterCount 让 LLM 按数量生成)
      await _doGenerateGraph(id, null, null, cc)
      // 4. 生成成功后跳到 STEP 03
      setStep(3)
    } catch (err) {
      message.error('生成人物关系失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setGraphLoading(false)
    }
  }

  const handleGenerateGraph = async () => {
    if (!researchId) {
      // 首次进入 STEP 03 时 researchId 可能尚未创建 (用户从 STEP 02 跳过未点开始生成).
      // 这里先创建 research 记录, 再调生成接口. 与 handleGenerate 中创建逻辑一致.
      // 2026-07-21 修复: 创建后立即保存 template_id (故事类型), 否则后端 generateCharacterGraph
      // 拿不到题材, 只能用泛化的"小说"而非言情/玄幻/科幻/悬疑, 角色数量和风格都会偏离.
      if (!selectedGenre || !synopsis.trim()) {
        message.warning('请先完成题材与提要')
        return
      }
      try {
        const createRes = await api.post('/academic/research', {
          topic: synopsis.trim(),
          report_type: 'novel',
        })
        const newId = createRes.data.id
        // 保存故事类型 (template_id), 让后端生成图谱时能区分言情/玄幻/科幻/悬疑
        await api.put(`/academic/research/${newId}`, {
          template_id: selectedGenre.id,
        })
        setResearchId(newId)
        // 立即用新 ID 继续生成图谱 (首次生成, 无 existingGraph)
        await _doGenerateGraph(newId, null, null)
      } catch (err) {
        message.error('创建任务失败: ' + (err.response?.data?.error || err.message))
        console.error(err)
      }
      return
    }
    // 已有图谱 → 弹窗让用户输入偏好 (与章节重新生成一致)
    if (characterGraph) {
      setGraphRegenHint('')
      setGraphRegenClear(false)  // 默认保留原图谱作为背景信息
      setGraphRegenModalOpen(true)
      return
    }
    // 首次生成 → 直接调
    await _doGenerateGraph(researchId, null, null)
  }

  // 2026-07-21: 图谱重新生成 Modal 确认按钮 — 把用户偏好 + 是否清空原图谱传给后端.
  // 不勾选"清空"时, 把当前 characterGraph 作为 existing_graph 传给后端,
  // 后端会把它作为背景信息注入 LLM prompt, 让新图谱在原图谱基础上迭代优化.
  const handleGraphRegenConfirm = async () => {
    setGraphRegenModalOpen(false)
    if (!researchId) return
    const hint = graphRegenHint.trim() || null
    // graphRegenClear=true → 清空原图谱从零生成, 不传 existing_graph
    // graphRegenClear=false → 保留原图谱作为背景, 传 existing_graph 给 LLM 参考
    const existingGraph = (!graphRegenClear && characterGraph) ? JSON.stringify(characterGraph) : null
    await _doGenerateGraph(researchId, hint, existingGraph)
  }

  const _doGenerateGraph = async (id, userHint, existingGraph, characterCount) => {
    setGraphLoading(true)
    try {
      // 2026-07-21: existingGraph 不为空时, 后端会把原图谱作为背景信息注入 LLM prompt,
      // 让新图谱在原图谱基础上结合 userHint 迭代优化, 而非完全从零生成.
      // 2026-07-22: characterCount 不为空时, 后端 minChars=maxChars=characterCount, 严格按数量生成.
      const payload = {}
      if (userHint) payload.user_hint = userHint
      if (existingGraph) payload.existing_graph = existingGraph
      if (characterCount) payload.character_count = characterCount
      const res = await api.post(`/academic/research/${id}/character-graph/generate`, payload)
      if (res.data?.generated) {
        const graph = parseGraphJson(res.data.character_graph)
        if (graph) {
          setCharacterGraph(graph)
          setGraphDirty(false)
          message.success(`已生成 ${graph.characters.length} 个人物 · ${graph.relationships.length} 条关系`)
        } else {
          message.error('图谱格式错误, 请重试')
        }
      } else {
        message.error(res.data?.error || '生成失败')
      }
    } catch (err) {
      message.error('生成关系图谱失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setGraphLoading(false)
    }
  }

  // 保存用户编辑后的图谱到 DB
  const handleSaveGraph = async () => {
    if (!researchId || !characterGraph) return
    setGraphLoading(true)
    try {
      await api.put(`/academic/research/${researchId}/character-graph`, {
        character_graph: JSON.stringify(characterGraph),
      })
      setGraphDirty(false)
      message.success('关系图谱已保存')
    } catch (err) {
      message.error('保存失败: ' + (err.response?.data?.error || err.message))
      console.error(err)
    } finally {
      setGraphLoading(false)
    }
  }

  // 新增角色 (本地编辑, 不立即写 DB; 用户点"保存"后统一持久化)
  const handleAddCharacter = () => {
    const { name, role, goal, personality } = graphNewChar
    if (!name.trim()) {
      message.warning('请输入角色名')
      return
    }
    const newChar = {
      id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      role: role.trim() || '未定',
      goal: goal.trim() || '未定',
      personality: personality.trim() || '未定',
    }
    setCharacterGraph(prev => ({
      characters: [...(prev?.characters || []), newChar],
      relationships: prev?.relationships || [],
    }))
    setGraphNewChar({ name: '', role: '', goal: '', personality: '' })
    setGraphDirty(true)
    message.success(`已添加角色: ${newChar.name}`)
  }

  // 删除角色 (同时清理涉及该角色的关系)
  const handleDeleteCharacter = (charId) => {
    const char = characterGraph?.characters.find(c => c.id === charId)
    Modal.confirm({
      title: '删除角色',
      content: `确认删除「${char?.name || charId}」? 涉及该角色的关系也会一并删除.`,
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: () => {
        setCharacterGraph(prev => ({
          characters: (prev?.characters || []).filter(c => c.id !== charId),
          relationships: (prev?.relationships || []).filter(r => r.from !== charId && r.to !== charId),
        }))
        setGraphDirty(true)
        message.success('已删除角色')
      },
    })
  }

  // 新增关系
  const handleAddRelationship = () => {
    const { from, to, type, description } = graphNewRel
    if (!from || !to) {
      message.warning('请选择关系的双方')
      return
    }
    if (from === to) {
      message.warning('关系双方不能为同一角色')
      return
    }
    setCharacterGraph(prev => ({
      characters: prev?.characters || [],
      relationships: [...(prev?.relationships || []), {
        from, to, type: type || '合作', description: description.trim(),
      }],
    }))
    setGraphNewRel({ from: '', to: '', type: '合作', description: '' })
    setGraphDirty(true)
    message.success('已添加关系')
  }

  // 删除关系
  const handleDeleteRelationship = (idx) => {
    setCharacterGraph(prev => ({
      characters: prev?.characters || [],
      relationships: (prev?.relationships || []).filter((_, i) => i !== idx),
    }))
    setGraphDirty(true)
    message.success('已删除关系')
  }

  // ── 2026-07-21: 角色详情编辑 (点击卡片放大到独立弹窗) ──
  // 点击 react-flow 节点卡片触发: 浅拷贝角色对象到 characterEditing, 打开 Modal.
  // 编辑过程不直接修改原图谱, 用户点"保存"才写回; 点"取消"丢弃改动.
  // 2026-07-22: 新增 handleAddCharacterModal — 打开空白 Modal 用于新增角色 (characterEditingId='__new__').
  const handleAddCharacterModal = () => {
    // 生成新角色 id: c_new_xxxx, 保存时再生成最终 id
    setCharacterEditing({
      id: 'c' + ((characterGraph?.characters?.length || 0) + 1),
      name: '',
      role: '',
      goal: '',
      personality: '',
    })
    setCharacterEditingId('__new__')  // 哨兵值, 区分新增 vs 编辑
  }

  const handleEditCharacter = (character) => {
    if (!character) return
    setCharacterEditing({ ...character })  // 浅拷贝, 避免编辑过程污染原图谱
    setCharacterEditingId(character.id)     // 记录原 id, 保存时按此定位
  }

  // Modal 保存按钮: 把编辑后的字段写回 characterGraph.characters 中对应原 id 的角色
  // 同时同步更新 relationships 中 from/to 引用 (若用户改了 id)
  // 2026-07-22: characterEditingId === '__new__' 时走新增逻辑, 而非更新现有角色.
  const handleEditCharacterSave = () => {
    if (!characterEditing) return
    const { id: newId, name, role, goal, personality } = characterEditing
    if (!name || !name.trim()) {
      message.warning('角色名不能为空')
      return
    }
    // 2026-07-22: 新增模式 — 往 characterGraph.characters 追加新角色
    if (characterEditingId === '__new__') {
      // 生成唯一 id (避免与现有 id 冲突)
      const existingIds = new Set((characterGraph?.characters || []).map(c => c.id))
      let finalId = newId || ('c' + ((characterGraph?.characters?.length || 0) + 1))
      while (existingIds.has(finalId)) {
        finalId = finalId + '_' + Math.random().toString(36).slice(2, 5)
      }
      const newChar = {
        id: finalId,
        name: name.trim(),
        role: role.trim() || '未定',
        goal: goal.trim() || '未定',
        personality: personality.trim() || '未定',
      }
      setCharacterGraph(prev => ({
        characters: [...(prev?.characters || []), newChar],
        relationships: prev?.relationships || [],
      }))
      setGraphDirty(true)
      message.success(`已添加角色: ${newChar.name}`)
      setCharacterEditing(null)
      setCharacterEditingId(null)
      return
    }
    // 编辑模式 — 原有逻辑
    if (!characterEditingId) return
    setCharacterGraph(prev => {
      if (!prev) return prev
      const characters = prev.characters.map(c =>
        c.id === characterEditingId
          ? { ...c, id: newId, name: name.trim(), role: role?.trim() || '未定', goal: goal?.trim() || '未定', personality: personality?.trim() || '未定' }
          : c
      )
      // 若 id 变了, 同步更新 relationships 中的 from/to 引用
      const relationships = newId !== characterEditingId
        ? prev.relationships.map(r => ({
          ...r,
          from: r.from === characterEditingId ? newId : r.from,
          to: r.to === characterEditingId ? newId : r.to,
        }))
        : prev.relationships
      return { characters, relationships }
    })
    setGraphDirty(true)
    setCharacterEditing(null)
    setCharacterEditingId(null)
    message.success('角色已更新')
  }

  const handleEditCharacterCancel = () => {
    setCharacterEditing(null)
    setCharacterEditingId(null)
  }

  // STEP 03 → STEP 04: 若有未保存改动先保存, 再进入生成步骤.
  // 2026-07-21 修复: 用户反馈"点击下一步生成大纲没反应". 原因是只调 setStep(4) 切到"准备就绪"页面,
  // 需要用户再点"开始生成"才真正启动, 体验上像没反应. 修复为: 保存图谱后直接调 handleGenerate
  // 一步到位开始生成大纲, 跳过中间的"准备就绪"卡片.
  const handleGraphNext = async () => {
    if (graphDirty && characterGraph && researchId) {
      await handleSaveGraph()
    }
    // 直接开始生成大纲 (handleGenerate 内部会 setStep(4) + 启动轮询)
    await handleGenerate()
  }

  // ── 步骤完成判定 ──
  const step1Done = selectedGenre ? selectedGenre.name : false
  const step2Done = synopsis.trim().length >= 10 ? `${synopsis.trim().length} 字` : false
  // 2026-07-21: STEP 03 完成判定 — 图谱存在且至少有 1 个角色
  const step3Done = characterGraph && characterGraph.characters.length > 0
    ? `${characterGraph.characters.length} 人物 · ${characterGraph.relationships.length} 关系`
    : false

  const generating = status === 'generating'
  // 2026-07-21: 生成开始后锁定题材和简短提要, 防止用户误修改
  // 可编辑态: idle (全新会话) / draft (任务已创建但未启动)
  // 锁定态: generating / paused / cancelled / failed / done
  const lockInputs = status !== 'idle' && status !== 'draft'

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--ab-bg)', color: 'var(--ab-text)',
      display: 'flex', flexDirection: 'row',
    }} className="arp-grain">
      <style>{`
        @keyframes novel-spine-glow { 0%,100%{box-shadow:0 0 0 rgba(212,165,116,0)} 50%{box-shadow:0 0 24px rgba(212,165,116,0.3)} }
        .novel-genre-card:hover .novel-spine { transform: translateX(-2px); }
        .novel-genre-card:hover .novel-spine-glow { animation: novel-spine-glow 2s ease-in-out infinite; }
        .novel-synopsis-input { background:transparent !important; border:none !important; color:var(--ab-text) !important;
          font-family:var(--ab-font-display) !important; font-size:26px !important; line-height:1.5 !important;
          font-weight:400 !important; letter-spacing:-0.01em !important; padding:8px 0 !important; resize:none !important; box-shadow:none !important; }
        .novel-synopsis-input::placeholder { color:var(--ab-text-4) !important; font-style:italic !important; font-weight:300 !important; }
        .novel-synopsis-input:focus { box-shadow:none !important; outline:none !important; }
        .novel-history-item:hover .novel-history-delete { opacity: 1 !important; }
        @media (max-width: 1280px) { .novel-genre-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 720px) { .novel-genre-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {/* ── 左栏: 历史列表 280px ──
          Mobile: 渲染为左侧 Drawer，由 header 汉堡按钮触发。 */}
      {(() => {
        const sidebarInner = (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>LIBRARY</div>
                <div style={{ ...serif, fontSize: 18, fontWeight: 500, color: 'var(--ab-text)', marginTop: 2 }}>我的小说</div>
              </div>
              <Button size="small" type="text" icon={<PlusOutlined />} onClick={isMobile ? handleResetMobile : handleReset}
                style={{ color: 'var(--ab-copper)' }} title="新建小说" />
            </div>

            {loadingHistory && <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>}

            {!loadingHistory && history.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--ab-text-4)' }}>
                <EditOutlined style={{ fontSize: 28, opacity: 0.4, marginBottom: 12 }} />
                <div style={{ ...body, fontSize: 12.5 }}>还没有小说作品</div>
                <div style={{ ...mono, fontSize: 10, marginTop: 4, opacity: 0.7 }}>从右侧第一步开始创作</div>
              </div>
            )}

            {history.map(item => {
              const g = NOVEL_GENRES.find(x => x.id === item.templateId)
              const isActive = item.id === researchId
              return (
                <div key={item.id} className="novel-history-item"
                  onClick={() => isMobile ? loadHistoryItemMobile(item) : loadHistoryItem(item)}
                  style={{
                    padding: '12px 12px', borderRadius: 6, marginBottom: 6, cursor: 'pointer',
                    background: isActive ? 'var(--ab-surface)' : 'transparent',
                    border: isActive ? '1px solid var(--ab-copper)' : '1px solid transparent',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--ab-bg-3)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {g && <div style={{ width: 3, height: 14, background: g.accent, borderRadius: 1 }} />}
                    <span style={{ ...serif, fontSize: 13.5, fontWeight: 500, color: 'var(--ab-text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {/* 2026-07-23: 优先显示书名 (弧线标题), 回退到 topic */}
                      {item.bookName || item.topic || '未命名'}
                    </span>
                    <CloseOutlined className="novel-history-delete"
                      onClick={(e) => handleDeleteHistory(item.id, e)}
                      style={{ fontSize: 11, color: 'var(--ab-text-4)', opacity: 0, transition: 'opacity 0.15s', flexShrink: 0 }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>
                    {g && <span>{g.name}</span>}
                    {g && <span>·</span>}
                    <span>{(item.status || '').toUpperCase()}</span>
                    {item.progress > 0 && item.status === 'generating' && <span>· {item.progress}%</span>}
                  </div>
                </div>
              )
            })}
          </>
        )
        return isMobile ? (
          <Drawer
            placement="left" open={mobileHistoryOpen} onClose={() => setMobileHistoryOpen(false)}
            width={280} closable={false}
            styles={{ body: { padding: '24px 16px', background: 'var(--ab-bg-2)', overflow: 'auto' }, header: { display: 'none' } }}
          >
            {sidebarInner}
          </Drawer>
        ) : (
          <div style={{
            width: 280, flexShrink: 0, borderRight: '1px solid var(--ab-line)',
            background: 'var(--ab-bg-2)', overflow: 'auto', padding: '24px 16px',
          }} className="custom-scrollbar">
            {sidebarInner}
          </div>
        )
      })()}

      {/* ── 主区 ──
          2026-07-21 阅读体验优化:
            - padding 从 '36px 40px 80px' → '24px 32px 60px' (减少外层留白, 让 BookReader 占更多空间)
            - maxWidth 从 1200 → 1440 (加宽整体容器, 配合用户偏好"减少两侧空白") */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '20px 14px 50px' : '24px 32px 60px' }} className="custom-scrollbar">
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          {/* 页眉 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: isMobile ? 24 : 36, gap: 12 }}>
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Mobile: 汉堡按钮打开历史列表 Drawer */}
              {isMobile && (
                <Button type="text" icon={<MenuOutlined />} onClick={() => setMobileHistoryOpen(true)}
                  style={{ color: 'var(--ab-text-3)', flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ ...mono, fontSize: 11, color: 'var(--ab-copper)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 6 }}>
                  ✒️ Novel Atelier
                </div>
                <h1 style={{ ...serif, fontSize: isMobile ? 26 : 38, fontWeight: 400, color: 'var(--ab-text)', margin: 0, letterSpacing: '-0.02em', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  小说创作
                </h1>
                {!isMobile && (
                  <div style={{ ...body, fontSize: 13, color: 'var(--ab-text-3)', marginTop: 8 }}>
                    选题材 · 写提要 · 一键生成 · 长篇分层结构 · 自动断点续传
                  </div>
                )}
              </div>
            </div>
            {researchId && (
              <Button icon={<PlusOutlined />} onClick={handleReset}
                style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-2)', flexShrink: 0 }}>
                新建小说
              </Button>
            )}
          </div>

          {/* ── STEP 01 选择题材 ── */}
          {/* 2026-07-21: 显示条件增加 !selectedGenre — 若题材丢失 (历史加载恢复失败/DB 无 templateId),
              始终显示 STEP 01 让用户能重新选择, 避免"提示需要选择题材但 STEP 01 不可见"的死循环. */}
          {(step === 1 || step1Done || !selectedGenre) && (
            <StepShell index="01" title="选择题材" subtitle="选择一种小说题材模板, 决定卷数与故事弧线"
              done={step1Done} active={step === 1 || !selectedGenre}>
              {lockInputs && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px',
                  background: 'var(--ab-copper-glow)', border: '1px solid var(--ab-copper)',
                  borderRadius: 6, color: 'var(--ab-copper-2)', ...mono, fontSize: 11, letterSpacing: '0.05em',
                }}>
                  <LockOutlined /> 题材已锁定 · 生成开始后不可修改, 如需更换题材请新建小说
                </div>
              )}
              <div className="novel-genre-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                {NOVEL_GENRES.map(g => {
                  const selected = selectedGenre?.id === g.id
                  return (
                    <motion.div key={g.id}
                      className="novel-genre-card"
                      onClick={lockInputs ? undefined : () => {
                        // 2026-07-22: 选完题材不自动跳 STEP 02, 而是留在 STEP 01 显示偏好输入框.
                        // 用户必须输入故事偏好 (至少 10 字) 后才能点"下一步"进入 STEP 02.
                        setSelectedGenre(g)
                      }}
                      whileHover={lockInputs ? undefined : { y: -3 }}
                      transition={{ duration: 0.2 }}
                      style={{
                        display: 'flex', background: 'var(--ab-surface)', borderRadius: 8, overflow: 'hidden',
                        border: `1px solid ${selected ? 'var(--ab-copper)' : 'var(--ab-line)'}`,
                        cursor: lockInputs ? 'not-allowed' : 'pointer', position: 'relative',
                        boxShadow: selected ? '0 0 0 1px var(--ab-copper), 0 8px 24px rgba(212,165,116,0.12)' : 'none',
                        opacity: lockInputs && !selected ? 0.55 : 1,
                      }}
                    >
                      {/* 书脊色块 */}
                      <div className="novel-spine-glow"
                        style={{
                          width: 8, flexShrink: 0, background: g.spineGradient,
                          boxShadow: selected ? '0 0 16px ' + g.accent + '40' : 'none',
                        }} />
                      <div style={{ padding: '18px 16px', flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div>
                            <div style={{ ...mono, fontSize: 11, color: 'var(--ab-text-4)', letterSpacing: '0.1em' }}>
                              {g.numeral}
                            </div>
                            <div style={{ ...serif, fontSize: 22, fontWeight: 500, color: selected ? 'var(--ab-copper)' : 'var(--ab-text)',
                              marginTop: 2, letterSpacing: '-0.01em' }}>
                              {g.name}
                            </div>
                          </div>
                          <span style={{ fontSize: 22, opacity: 0.8 }}>{g.icon}</span>
                        </div>
                        {/* 2026-07-22: 去掉故事弧线 (原 desc 是弧线如"相遇→相知→相爱"), 改为一句话风格描述 */}
                        <div style={{ ...mono, fontSize: 10.5, color: g.accent, letterSpacing: '0.04em', lineHeight: 1.5 }}>
                          {g.desc}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              {/* ── 2026-07-21: 用户自定义模板区 ── */}
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', letterSpacing: '0.08em' }}>
                    我的自定义模板 {loadingTemplates && <Spin size="small" style={{ marginLeft: 8 }} />}
                  </div>
                  <Button size="small" type="dashed" icon={<PlusOutlined />}
                    onClick={handleOpenCreateTpl}
                    style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)' }}>
                    新增自定义模板
                  </Button>
                </div>
                {userTemplates.length === 0 ? (
                  <div style={{
                    padding: '20px 16px', textAlign: 'center',
                    background: 'var(--ab-surface)', borderRadius: 8,
                    border: '1px dashed var(--ab-line)', color: 'var(--ab-text-3)',
                    ...body, fontSize: 12,
                  }}>
                    还没有自定义模板。点击右上角「新增自定义模板」创建属于你的小说模板，
                    可自定义章节数、每章字数、偏好重点和整体逻辑流程。
                  </div>
                ) : (
                  <div className="novel-genre-grid"
                    style={{
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14,
                  }}>
                    {userTemplates.map(tpl => {
                      const g = toGenreCardData(tpl)
                      const selected = selectedGenre?.id === g.id
                      return (
                        <motion.div key={g.id}
                          className="novel-genre-card"
                          onClick={lockInputs ? undefined : () => {
                            // 2026-07-22: 选完题材不自动跳 STEP 02, 留在 STEP 01 显示偏好输入框.
                            setSelectedGenre(g)
                          }}
                          whileHover={lockInputs ? undefined : { y: -3 }}
                          transition={{ duration: 0.2 }}
                          style={{
                            display: 'flex', background: 'var(--ab-surface)', borderRadius: 8, overflow: 'hidden',
                            border: `1px solid ${selected ? 'var(--ab-copper)' : 'var(--ab-line)'}`,
                            cursor: lockInputs ? 'not-allowed' : 'pointer', position: 'relative',
                            boxShadow: selected ? '0 0 0 1px var(--ab-copper), 0 8px 24px rgba(212,165,116,0.12)' : 'none',
                            opacity: lockInputs && !selected ? 0.55 : 1,
                          }}
                        >
                          {/* 书脊色块 */}
                          <div className="novel-spine-glow"
                            style={{
                              width: 8, flexShrink: 0, background: g.spineGradient,
                              boxShadow: selected ? '0 0 16px ' + g.accent + '40' : 'none',
                            }} />
                          <div style={{ padding: '18px 16px', flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                              <div>
                                <div style={{ ...mono, fontSize: 11, color: 'var(--ab-text-4)', letterSpacing: '0.1em' }}>
                                  {g.numeral} · 自定义
                                </div>
                                <div style={{ ...serif, fontSize: 22, fontWeight: 500, color: selected ? 'var(--ab-copper)' : 'var(--ab-text)',
                                  marginTop: 2, letterSpacing: '-0.01em' }}>
                                  {g.name}
                                </div>
                              </div>
                              <span style={{ fontSize: 22, opacity: 0.8 }}>{g.icon}</span>
                            </div>
                            {/* 2026-07-22: 去掉弧线和卷结构显示, 只保留一句话风格描述 */}
                            <div style={{ ...mono, fontSize: 10.5, color: g.accent, letterSpacing: '0.04em', lineHeight: 1.5 }}>
                              {g.desc}
                            </div>
                          </div>
                          {/* 自定义模板编辑/删除悬浮按钮组 */}
                          <div style={{
                            position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4,
                            opacity: 0, transition: 'opacity 0.2s',
                          }} className="novel-tpl-actions">
                            <Tooltip title="编辑">
                              <Button size="small" type="text" icon={<EditOutlined />}
                                onClick={(e) => { e.stopPropagation(); handleOpenEditTpl(tpl) }}
                                style={{ color: 'var(--ab-text-2)', background: 'rgba(0,0,0,0.5)' }} />
                            </Tooltip>
                            <Popconfirm
                              title="确认删除此模板？"
                              description="删除后无法恢复，但已创建的小说不受影响。"
                              onConfirm={(e) => { e?.stopPropagation(); handleDeleteTpl(tpl) }}
                              onCancel={(e) => e?.stopPropagation()}
                              okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                            >
                              <Button size="small" type="text" icon={<DeleteOutlined />}
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: '#ff6b6b', background: 'rgba(0,0,0,0.5)' }} />
                            </Popconfirm>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 2026-07-22: 选完题材后显示必填的故事偏好输入框 — 放在所有卡片下方.
                  故事弧线和卷结构应由 LLM 基于此偏好生成, 而非题材硬编码.
                  用户必须输入至少 10 字的偏好, 才能点"生成弧线大纲"生成弧线候选. */}
              {selectedGenre && !lockInputs && (
                <div style={{
                  marginTop: 20, padding: '20px 24px',
                  background: 'var(--ab-surface)', borderRadius: 8,
                  border: '1px solid var(--ab-copper)',
                  boxShadow: '0 4px 16px rgba(212,165,116,0.08)',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>{selectedGenre.icon}</span>
                    <div style={{ ...serif, fontSize: 16, fontWeight: 500, color: 'var(--ab-copper)' }}>
                      {selectedGenre.name}
                    </div>
                    <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.05em', marginLeft: 8 }}>
                      请输入故事偏好
                    </div>
                  </div>
                  <textarea
                    className="novel-synopsis-input"
                    value={synopsis}
                    onChange={(e) => setSynopsis(e.target.value)}
                    placeholder="描述你想要的故事方向、核心冲突、主角设定、世界观要素等。LLM 会基于此偏好生成故事弧线、卷结构和人物关系..."
                    rows={4}
                    autoFocus
                    style={{ width: '100%', minHeight: 100 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <div style={{ ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', letterSpacing: '0.05em' }}>
                      {synopsis.trim().length} 字 {synopsis.trim().length < 10 ? '· 至少 10 字' : '· ✓ 符合要求'}
                    </div>
                    {/* 2026-07-24: 按钮改名"生成弧线大纲" — 点击后调 LLM 生成 3 个故事弧线候选.
                        用户必须先选弧线 (selectedArc) 才能点击下方"生成人物关系"按钮. */}
                    <Button type="primary" icon={<ArrowRightOutlined />}
                      disabled={synopsis.trim().length < 10}
                      onClick={handleGenerateArcs}
                      loading={arcLoading}
                      style={{
                        background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)',
                        color: 'var(--ab-bg)', fontWeight: 500,
                      }}>
                      生成弧线大纲
                    </Button>
                  </div>

                  {/* 2026-07-22: 故事弧线候选列表 — 点击"生成弧线大纲"后显示.
                      用户选一个弧线后, 自动填充章节数到 STEP 02 输入框, 并进入 STEP 02. */}
                  {storyArcs.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <div style={{
                        ...mono, fontSize: 11, color: 'var(--ab-text-3)', letterSpacing: '0.08em',
                        marginBottom: 10,
                      }}>
                        故事弧线候选 · 选择一个进入下一步
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                        {storyArcs.map((arc, i) => {
                          const isSelected = selectedArc?.title === arc.title
                          return (
                            <motion.div
                              key={i}
                              onClick={() => handleSelectArc(arc)}
                              whileHover={{ y: -3 }}
                              transition={{ duration: 0.2 }}
                              style={{
                                background: 'var(--ab-surface)',
                                borderRadius: 8, padding: '16px 14px',
                                border: `1px solid ${isSelected ? 'var(--ab-copper)' : 'var(--ab-line)'}`,
                                cursor: 'pointer', position: 'relative',
                                boxShadow: isSelected
                                  ? '0 0 0 1px var(--ab-copper), 0 8px 24px rgba(212,165,116,0.12)'
                                  : 'none',
                              }}
                            >
                              <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                                marginBottom: 8,
                              }}>
                                <div style={{
                                  ...serif, fontSize: 16, fontWeight: 500,
                                  color: isSelected ? 'var(--ab-copper)' : 'var(--ab-text)',
                                  letterSpacing: '-0.01em',
                                }}>
                                  {arc.title}
                                </div>
                                <span style={{ fontSize: 16 }}>
                                  {['📖', '🌀', '⚡'][i] || '✨'}
                                </span>
                              </div>
                              <div style={{
                                ...body, fontSize: 11.5, color: 'var(--ab-text-3)',
                                lineHeight: 1.6, marginBottom: 10,
                                minHeight: 60,
                              }}>
                                {arc.desc}
                              </div>
                              <div style={{
                                ...mono, fontSize: 10, color: 'var(--ab-text-4)',
                                letterSpacing: '0.05em', display: 'flex', gap: 12,
                              }}>
                                <span>{arc.volumes} 卷</span>
                                <span>{arc.chapters_per_volume} 章/卷</span>
                                <span style={{ color: 'var(--ab-copper)' }}>共 {arc.total_chapters} 章</span>
                              </div>
                            </motion.div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </StepShell>
          )}

          {/* ── STEP 02 章节与角色规划 ── */}
          {/* 2026-07-22: 原"简短提要"已前移到 STEP 01 (选题材后必填), 此步骤改为纯章节与角色规划. */}
          {(step === 2 || step2Done) && (
            <StepShell index="02" title="章节与角色规划"
              subtitle="配置总章节数、每卷章节数和角色数量, 然后生成人物关系图谱"
              done={step2Done} active={step === 2}>
              {lockInputs && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px',
                  background: 'var(--ab-copper-glow)', border: '1px solid var(--ab-copper)',
                  borderRadius: 6, color: 'var(--ab-copper-2)', ...mono, fontSize: 11, letterSpacing: '0.05em',
                }}>
                  <LockOutlined /> 配置已锁定 · 生成开始后不可修改, 如需更换请新建小说
                </div>
              )}
              <div style={{
                background: 'var(--ab-surface)', borderRadius: 8, padding: '24px 28px',
                border: '1px solid var(--ab-line)',
                opacity: lockInputs ? 0.7 : 1,
              }}>
                {/* 2026-07-22: 章节规划配置面板 — 让用户在生成人物关系和大纲前调整总章节数和每卷章节数.
                    未填写时后端用题材默认值 (如言情 5 卷×30 章=150 章), 用户填写后优先级最高.
                    2026-07-22 新增: 角色数量输入框, 点击"生成人物关系"时传给后端. */}
                <div style={{
                  padding: '14px 16px',
                  background: novelTotalInput || novelPerVolInput || novelCharCountInput
                    ? 'rgba(212,165,116,0.06)' : 'var(--ab-surface-2)',
                  border: `1px solid ${novelTotalInput || novelPerVolInput || novelCharCountInput ? 'rgba(212,165,116,0.25)' : 'var(--ab-line)'}`,
                  borderRadius: 6,
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 10,
                  }}>
                    <div style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', letterSpacing: '0.05em' }}>
                      章节与角色规划 {selectedGenre ? `· 题材默认: ${selectedGenre.totalChapters || selectedGenre.volumes * selectedGenre.chaptersPerVolume} 章 / ${selectedGenre.chaptersPerVolume} 章/卷` : ''}
                    </div>
                    {(novelTotalInput || novelPerVolInput || novelCharCountInput) && (
                      <span style={{ ...mono, fontSize: 10, color: 'var(--ab-copper)', letterSpacing: '0.05em' }}>
                        已自定义
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', whiteSpace: 'nowrap' }}>
                        总章节数
                      </label>
                      <input
                        type="number" min="1" max="9999"
                        value={novelTotalInput}
                        onChange={(e) => setNovelTotalInput(e.target.value)}
                        disabled={lockInputs}
                        placeholder={selectedGenre ? String(selectedGenre.totalChapters || selectedGenre.volumes * selectedGenre.chaptersPerVolume) : '150'}
                        style={{
                          width: 90, padding: '4px 8px',
                          background: 'var(--ab-bg)', border: '1px solid var(--ab-line)',
                          borderRadius: 4, color: 'var(--ab-text)',
                          fontFamily: 'var(--ab-font-mono)', fontSize: 12,
                          cursor: lockInputs ? 'default' : 'text',
                        }}
                      />
                      <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>章</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', whiteSpace: 'nowrap' }}>
                        每卷章节数
                      </label>
                      <input
                        type="number" min="1" max="999"
                        value={novelPerVolInput}
                        onChange={(e) => setNovelPerVolInput(e.target.value)}
                        disabled={lockInputs}
                        placeholder={selectedGenre ? String(selectedGenre.chaptersPerVolume) : '30'}
                        style={{
                          width: 90, padding: '4px 8px',
                          background: 'var(--ab-bg)', border: '1px solid var(--ab-line)',
                          borderRadius: 4, color: 'var(--ab-text)',
                          fontFamily: 'var(--ab-font-mono)', fontSize: 12,
                          cursor: lockInputs ? 'default' : 'text',
                        }}
                      />
                      <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>章/卷</span>
                    </div>
                    {/* 2026-07-22: 角色数量 — 点击"生成人物关系"时传给后端, 决定 LLM 生成几个角色 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', whiteSpace: 'nowrap' }}>
                        角色数量
                      </label>
                      <input
                        type="number" min="1" max="99"
                        value={novelCharCountInput}
                        onChange={(e) => setNovelCharCountInput(e.target.value)}
                        disabled={lockInputs}
                        placeholder={selectedGenre ? (
                          selectedGenre.id && (selectedGenre.id.includes('fantasy') || selectedGenre.id.includes('scifi')) ? '10' : '6'
                        ) : '6'}
                        style={{
                          width: 90, padding: '4px 8px',
                          background: 'var(--ab-bg)', border: '1px solid var(--ab-line)',
                          borderRadius: 4, color: 'var(--ab-text)',
                          fontFamily: 'var(--ab-font-mono)', fontSize: 12,
                          cursor: lockInputs ? 'default' : 'text',
                        }}
                      />
                      <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)' }}>个</span>
                    </div>
                    <div style={{ ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', alignSelf: 'center', letterSpacing: '0.03em' }}>
                      {/* 实时计算预计卷数 */}
                      {(() => {
                        const tc = novelTotalInput.trim() ? parseInt(novelTotalInput.trim(), 10) : (selectedGenre?.totalChapters || selectedGenre?.volumes * selectedGenre?.chaptersPerVolume || 0)
                        const cpv = novelPerVolInput.trim() ? parseInt(novelPerVolInput.trim(), 10) : (selectedGenre?.chaptersPerVolume || 0)
                        if (tc > 0 && cpv > 0) {
                          const vols = Math.ceil(tc / cpv)
                          return `预计 ${vols} 卷 · ${tc} 章`
                        }
                        return '留空使用题材默认值'
                      })()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  {/* 2026-07-22: synopsis 已前移到 STEP 01, 这里显示故事偏好摘要 (只读) */}
                  <div style={{ ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', letterSpacing: '0.05em', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    故事偏好: {synopsis.trim() ? synopsis.trim().substring(0, 60) + (synopsis.trim().length > 60 ? '...' : '') : '未输入'}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(1)}
                      style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-2)' }}>
                      上一步
                    </Button>
                    {/* 2026-07-22: "生成人物关系"按钮 — 点击直接生成人物关系图谱.
                        2026-07-24: 必须先在 STEP 01 选定故事弧线 (selectedArc) 才可点击,
                        未选弧线时禁用, 避免无弧线/书名就直接生成人物关系.
                        点击后: 创建 research → 保存章节/角色配置 → 调图谱生成接口 → 成功后跳到 STEP 03. */}
                    <Button type="primary" icon={<TeamOutlined />}
                      disabled={!selectedArc || lockInputs}
                      onClick={handleGenerateGraphFromStep2}
                      loading={graphLoading}
                      style={{
                        background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)',
                        color: 'var(--ab-bg)', fontWeight: 500,
                      }}>
                      生成人物关系
                    </Button>
                  </div>
                </div>
              </div>
            </StepShell>
          )}

          {/* ── STEP 03 人物关系图谱 (2026-07-21 新增独立步骤) ──
              用户在大纲生成前设计/调整人物关系. LLM 基于题材+提要产出角色+关系,
              用户可手动增删角色/关系, 保存后大纲生成会引用图谱让情节围绕人物展开.
              显示条件: step===3 或已有图谱数据 (即使进入 step 4 后也保留以便回看). */}
          {(step === 3 || (step3Done && step > 3)) && (
            <StepShell index="03" title="人物关系图谱"
              subtitle="设计角色与关系, 决定小说的丰富度. 生成大纲会引用图谱让情节围绕人物展开"
              done={step3Done} active={step === 3}>
              {lockInputs && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px',
                  background: 'var(--ab-copper-glow)', border: '1px solid var(--ab-copper)',
                  borderRadius: 6, color: 'var(--ab-copper-2)', ...mono, fontSize: 11, letterSpacing: '0.05em',
                }}>
                  <LockOutlined /> 图谱已锁定 · 生成开始后不可修改, 如需调整请新建小说
                </div>
              )}

              {/* 顶部操作栏: 生成/重新生成/保存 + 进度统计 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 12, padding: '10px 14px',
                background: 'var(--ab-surface)', borderRadius: 8, border: '1px solid var(--ab-line)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <TeamOutlined style={{ color: 'var(--ab-copper)', fontSize: 16 }} />
                  <div>
                    <div style={{ ...serif, fontSize: 14, fontWeight: 500, color: 'var(--ab-text)' }}>
                      {characterGraph
                        ? `${characterGraph.characters.length} 个人物 · ${characterGraph.relationships.length} 条关系`
                        : '尚未生成图谱'}
                    </div>
                    <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.05em', marginTop: 1 }}>
                      {characterGraph
                        ? (graphDirty ? '⚠ 有未保存的修改' : '✓ 已保存')
                        : '点击右侧"生成关系图谱"开始'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(2)}
                    disabled={lockInputs}
                    style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-2)' }}>
                    上一步
                  </Button>
                  <Button icon={<ShareAltOutlined />}
                    onClick={handleGenerateGraph}
                    loading={graphLoading}
                    disabled={lockInputs}
                    style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)' }}>
                    {characterGraph ? '重新生成图谱' : '生成关系图谱'}
                  </Button>
                  {/* 2026-07-22: 图谱卡片上的"添加人物"按钮 — 点击打开新增角色 Modal, 可继续增加人物.
                      复用 characterEditing Modal, characterEditingId='__new__' 标识新增模式. */}
                  {characterGraph && !lockInputs && (
                    <Button icon={<PlusOutlined />}
                      onClick={handleAddCharacterModal}
                      style={{
                        borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)',
                        background: 'rgba(212,165,116,0.06)',
                      }}>
                      添加人物
                    </Button>
                  )}
                  {characterGraph && graphDirty && !lockInputs && (
                    <Button type="primary" icon={<CheckOutlined />}
                      onClick={handleSaveGraph}
                      loading={graphLoading}
                      style={{
                        background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)', color: 'var(--ab-bg)',
                      }}>
                      保存
                    </Button>
                  )}
                  {characterGraph && !lockInputs && (
                    <Button type="primary" icon={<ArrowRightOutlined />}
                      onClick={handleGraphNext}
                      style={{
                        background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)', color: 'var(--ab-bg)',
                        fontWeight: 500,
                      }}>
                      下一步: 生成大纲
                    </Button>
                  )}
                </div>
              </div>

              {/* 主体: 左图谱 + 右编辑面板 (双栏布局) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14 }}>
                {/* 左: react-flow 图谱可视化 */}
                <CharacterGraphFlow
                  graph={characterGraph}
                  onDeleteCharacter={lockInputs ? undefined : handleDeleteCharacter}
                  onDeleteRelationship={lockInputs ? undefined : handleDeleteRelationship}
                  onEditCharacter={lockInputs ? undefined : handleEditCharacter}
                />

                {/* 右: 角色与关系的增删表单 */}
                <div style={{
                  background: 'var(--ab-surface)', borderRadius: 8,
                  border: '1px solid var(--ab-line)', padding: 14,
                  maxHeight: 480, overflow: 'auto',
                }} className="custom-scrollbar">
                  {lockInputs ? (
                    <div style={{ padding: 12, color: 'var(--ab-text-4)', ...body, fontSize: 12, textAlign: 'center' }}>
                      <LockOutlined style={{ marginBottom: 8, fontSize: 18, opacity: 0.5 }} />
                      <div>生成开始后图谱已锁定</div>
                      <div style={{ marginTop: 4, fontSize: 11 }}>如需调整请新建小说</div>
                    </div>
                  ) : (
                    <>
                      {/* 新增角色表单 */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{
                          ...mono, fontSize: 10, color: 'var(--ab-copper)', letterSpacing: '0.1em',
                          textTransform: 'uppercase', marginBottom: 8,
                        }}>
                          <PlusOutlined style={{ marginRight: 4 }} />新增角色
                        </div>
                        <Input
                          placeholder="角色名 (如: 林清霜)"
                          value={graphNewChar.name}
                          onChange={(e) => setGraphNewChar({ ...graphNewChar, name: e.target.value })}
                          size="small"
                          style={{ marginBottom: 6 }}
                        />
                        <Input
                          placeholder="身份 (如: 主角 / 反派 / 师父)"
                          value={graphNewChar.role}
                          onChange={(e) => setGraphNewChar({ ...graphNewChar, role: e.target.value })}
                          size="small"
                          style={{ marginBottom: 6 }}
                        />
                        <Input
                          placeholder="任务/目标 (如: 报仇 / 寻亲 / 称霸)"
                          value={graphNewChar.goal}
                          onChange={(e) => setGraphNewChar({ ...graphNewChar, goal: e.target.value })}
                          size="small"
                          style={{ marginBottom: 6 }}
                        />
                        <Input
                          placeholder="性格 (如: 隐忍 / 暴躁 / 温润)"
                          value={graphNewChar.personality}
                          onChange={(e) => setGraphNewChar({ ...graphNewChar, personality: e.target.value })}
                          size="small"
                          style={{ marginBottom: 8 }}
                        />
                        <Button size="small" block icon={<PlusOutlined />}
                          onClick={handleAddCharacter}
                          style={{
                            borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)',
                            background: 'rgba(212,165,116,0.06)',
                          }}>
                          添加角色
                        </Button>
                      </div>

                      {/* 新增关系表单 */}
                      <div style={{ marginBottom: 18, paddingTop: 12, borderTop: '1px dashed var(--ab-line)' }}>
                        <div style={{
                          ...mono, fontSize: 10, color: 'var(--ab-copper)', letterSpacing: '0.1em',
                          textTransform: 'uppercase', marginBottom: 8,
                        }}>
                          <ShareAltOutlined style={{ marginRight: 4 }} />新增关系
                        </div>
                        <Select
                          placeholder="角色 A"
                          value={graphNewRel.from || undefined}
                          onChange={(v) => setGraphNewRel({ ...graphNewRel, from: v })}
                          size="small"
                          style={{ width: '100%', marginBottom: 6 }}
                          options={(characterGraph?.characters || []).map(c => ({ value: c.id, label: c.name }))}
                          notFoundContent={<span style={{ fontSize: 11 }}>请先添加角色</span>}
                        />
                        <Select
                          placeholder="角色 B"
                          value={graphNewRel.to || undefined}
                          onChange={(v) => setGraphNewRel({ ...graphNewRel, to: v })}
                          size="small"
                          style={{ width: '100%', marginBottom: 6 }}
                          options={(characterGraph?.characters || []).map(c => ({ value: c.id, label: c.name }))}
                          notFoundContent={<span style={{ fontSize: 11 }}>请先添加角色</span>}
                        />
                        <Select
                          value={graphNewRel.type}
                          onChange={(v) => setGraphNewRel({ ...graphNewRel, type: v })}
                          size="small"
                          style={{ width: '100%', marginBottom: 6 }}
                          options={RELATIONSHIP_TYPES.map(t => ({ value: t, label: t }))}
                        />
                        <Input
                          placeholder="关系描述 (可选, 如: 表面合作实则各怀鬼胎)"
                          value={graphNewRel.description}
                          onChange={(e) => setGraphNewRel({ ...graphNewRel, description: e.target.value })}
                          size="small"
                          style={{ marginBottom: 8 }}
                        />
                        <Button size="small" block icon={<PlusOutlined />}
                          onClick={handleAddRelationship}
                          disabled={!characterGraph || characterGraph.characters.length < 2}
                          style={{
                            borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)',
                            background: 'rgba(212,165,116,0.06)',
                          }}>
                          添加关系
                        </Button>
                      </div>

                      {/* 已有角色列表 (可删除) */}
                      {characterGraph && characterGraph.characters.length > 0 && (
                        <div style={{ paddingTop: 12, borderTop: '1px dashed var(--ab-line)' }}>
                          <div style={{
                            ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                            textTransform: 'uppercase', marginBottom: 8,
                          }}>
                            角色列表 ({characterGraph.characters.length})
                          </div>
                          {characterGraph.characters.map(c => (
                            <div key={c.id} style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                              background: 'var(--ab-bg-2)', border: '1px solid var(--ab-line)',
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ ...serif, fontSize: 12, fontWeight: 500, color: 'var(--ab-text)',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {c.name}
                                </div>
                                <div style={{ ...mono, fontSize: 9.5, color: 'var(--ab-text-4)' }}>
                                  {c.role} · {c.goal}
                                </div>
                              </div>
                              <DeleteOutlined
                                onClick={() => handleDeleteCharacter(c.id)}
                                style={{ fontSize: 11, color: '#ff6b6b', cursor: 'pointer', flexShrink: 0 }}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 已有关系列表 (可删除) */}
                      {characterGraph && characterGraph.relationships.length > 0 && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--ab-line)' }}>
                          <div style={{
                            ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                            textTransform: 'uppercase', marginBottom: 8,
                          }}>
                            关系列表 ({characterGraph.relationships.length})
                          </div>
                          {characterGraph.relationships.map((r, i) => {
                            const fromChar = characterGraph.characters.find(c => c.id === r.from)
                            const toChar = characterGraph.characters.find(c => c.id === r.to)
                            const color = RELATIONSHIP_COLORS[r.type] || '#999'
                            return (
                              <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                                background: 'var(--ab-bg-2)', border: '1px solid var(--ab-line)',
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ ...serif, fontSize: 11.5, color: 'var(--text-2)' }}>
                                    {fromChar?.name || r.from} <span style={{ color, fontSize: 10 }}>·{r.type}·</span> {toChar?.name || r.to}
                                  </div>
                                  {r.description && (
                                    <div style={{ ...body, fontSize: 10, color: 'var(--ab-text-4)',
                                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {r.description}
                                    </div>
                                  )}
                                </div>
                                <DeleteOutlined
                                  onClick={() => handleDeleteRelationship(i)}
                                  style={{ fontSize: 11, color: '#ff6b6b', cursor: 'pointer', flexShrink: 0 }}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* 空状态提示: 无图谱时引导用户使用上方表单或顶部"生成关系图谱"按钮 */}
                      {!characterGraph && (
                        <div style={{
                          marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--ab-line)',
                          padding: '16px 12px', textAlign: 'center', color: 'var(--ab-text-4)',
                        }}>
                          <TeamOutlined style={{ fontSize: 24, opacity: 0.4, marginBottom: 8 }} />
                          <div style={{ ...body, fontSize: 11.5, lineHeight: 1.6 }}>
                            可使用上方表单手动添加角色<br />
                            或点击顶部"生成关系图谱"让 LLM 自动设计
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </StepShell>
          )}

          {/* ── STEP 04 生成 ── (原 STEP 03, 2026-07-21 三步→四步后挪到 04) ── */}
          {(step === 4 || status !== 'idle') && (
            <StepShell index="04" title="生成小说"
              subtitle={selectedGenre ? `题材: ${selectedGenre.name} · ${selectedGenre.volumes} 卷 ≈ ${selectedGenre.volumes * selectedGenre.chaptersPerVolume} 章` : '点击下方按钮开始生成'}
              active={step === 4}>
              {/* 2026-07-20: 未启动生成时显示"开始生成"按钮
                  - status='idle': 全新会话, 从未点击过开始生成
                  - status='draft': 任务已创建但未开始 (用户从历史列表打开未启动的记录,
                    或步骤 2 完成跳到步骤 3 但 handleGenerate 启动前) — 之前会走进度卡片分支但无按钮,
                    导致用户看到"生成已停止 0%"却找不到开始入口 */}
              {(status === 'idle' || status === 'draft') && (
                <div style={{
                  background: 'var(--ab-surface)', borderRadius: 8, padding: 32,
                  border: '1px solid var(--ab-line)', textAlign: 'center',
                }}>
                  <ReadOutlined style={{ fontSize: 36, color: 'var(--ab-copper)', opacity: 0.7, marginBottom: 16 }} />
                  {/* 2026-07-21: draft + 有 outlineText 说明大纲生成被中断 (如后端重启),
                      区分文案让用户知道可以重新生成大纲 */}
                  <div style={{ ...serif, fontSize: 18, color: 'var(--ab-text)', marginBottom: 6 }}>
                    {status === 'draft' && outlineText?.trim() ? '生成已中断' : '准备就绪'}
                  </div>
                  <div style={{ ...body, fontSize: 12.5, color: 'var(--ab-text-3)', marginBottom: 20, lineHeight: 1.6 }}>
                    {status === 'draft' && outlineText?.trim()
                      ? <>上次生成被中断 (可能后端重启)<br />可"重新生成大纲"从头开始, 或"继续生成"基于已有大纲续做</>
                      : <>点击"开始生成"启动异步流程<br />系统将基于人物关系图谱生成分层大纲, 再分章节展开正文, 自动断点续传</>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(3)}
                      style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-2)' }}>
                      修改关系图谱
                    </Button>
                    {/* 2026-07-21: draft + 有 outlineText 时显示"重新生成大纲"(清空重做) +
                        "继续生成"(基于已有大纲续做); 全新 draft/idle 显示"开始生成" */}
                    {status === 'draft' && outlineText?.trim() ? (
                      <>
                        <Button size="large" icon={<RollbackOutlined />}
                          onClick={handleResume}
                          style={{
                            borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)',
                            height: 44, paddingInline: 24, fontWeight: 500,
                          }}>
                          继续生成
                        </Button>
                        <Button type="primary" size="large" danger icon={<EditOutlined />}
                          onClick={handleRegenerateOutline}
                          style={{
                            background: 'var(--ab-rose)', borderColor: 'var(--ab-rose)',
                            color: 'var(--ab-bg)', fontWeight: 500, height: 44, paddingInline: 28,
                          }}>
                          重新生成大纲
                        </Button>
                      </>
                    ) : (
                      <Button type="primary" size="large" icon={<EditOutlined />}
                        onClick={handleGenerate}
                        style={{
                          background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)',
                          color: 'var(--ab-bg)', fontWeight: 500, height: 44, paddingInline: 32,
                        }}>
                        开始生成
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* 生成中 / 完成态: 进度卡片 */}
              {status !== 'idle' && (
                <div style={{
                  background: 'var(--ab-surface)', borderRadius: 10, padding: '20px 24px',
                  border: '1px solid var(--ab-line)', boxShadow: 'var(--ab-shadow-2)', marginBottom: 20,
                }}>
                  {/* 顶部: Spin + 标题 + 百分比 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                    {generating && <Spin size="small" />}
                    <div style={{ flex: 1 }}>
                      <div style={{ ...serif, color: 'var(--ab-text)', fontSize: 15, fontWeight: 500 }}>
                        {progressMessage || (generating ? '正在生成小说…' : '生成已停止')}
                      </div>
                      <div style={{ ...mono, color: 'var(--ab-text-4)', fontSize: 10, marginTop: 3, letterSpacing: '0.05em' }}>
                        {selectedGenre?.name} · {selectedGenre?.volumes} 卷分层生成 · 自动断点续传
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <AnimatePresence mode="wait">
                        {resumeBatch > 0 && (
                          <motion.span key={resumeBatch}
                            initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                            transition={{ duration: 0.2 }}
                            title={`自动续做第 ${resumeBatch} 批次 · 当前进度 ${progress}% · 长篇分批生成避免单次超时`}
                            style={{
                              ...mono, fontSize: 10, fontWeight: 500, color: 'var(--ab-copper-2)',
                              padding: '2px 8px', borderRadius: 3, background: 'var(--ab-copper-glow)',
                              border: '1px solid var(--ab-copper)', cursor: 'help',
                              fontVariantNumeric: 'tabular-nums', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                            }}>
                            续做第 {resumeBatch} 批
                          </motion.span>
                        )}
                      </AnimatePresence>
                      <div style={{ ...mono, color: 'var(--ab-copper)', fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                        {progress}%
                      </div>
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div style={{ height: 2, background: 'var(--ab-line)', borderRadius: 1, overflow: 'hidden', marginBottom: 14 }}>
                    <motion.div
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5 }}
                      style={{ height: '100%', background: 'linear-gradient(90deg, var(--ab-copper), var(--ab-copper-hi))' }}
                    />
                  </div>

                  {/* 2026-07-21: 风格偏好条 (常驻) — 生成中/完成态/失败态都可查看和编辑.
                      点击打开 Modal 修改, 修改后影响后续未生成的章节.
                      生成中也可修改 (后端每章读取 styleHint 注入 prompt), 无需中断生成. */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 12,
                    background: styleHint ? 'rgba(212,165,116,0.08)' : 'var(--ab-surface-2)',
                    border: `1px solid ${styleHint ? 'rgba(212,165,116,0.3)' : 'var(--ab-line)'}`,
                    borderRadius: 4, cursor: 'pointer',
                  }}
                    onClick={() => openStyleHintModal('edit')}
                    title="点击修改风格偏好 · 持久化保存, 跨章节生效, 修改后影响后续未生成的章节"
                  >
                    <span style={{
                      ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: styleHint ? 'var(--ab-copper)' : 'var(--ab-text-4)', whiteSpace: 'nowrap',
                    }}>
                      风格偏好
                    </span>
                    <span style={{
                      flex: 1, ...body, fontSize: 12,
                      color: styleHint ? 'var(--ab-text-2)' : 'var(--ab-text-4)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {styleHint ? styleHint.replace(/\n/g, ' ').slice(0, 120) + (styleHint.length > 120 ? '…' : '')
                        : '未设置 (点击添加, 可选) — 此偏好会注入每章生成的 prompt, 贯穿整体风格'}
                    </span>
                    <span style={{ color: 'var(--ab-text-4)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {styleHint ? `${styleHint.length} 字 · 编辑` : '设置'}
                    </span>
                  </div>

                  {/* 卡住警告条 */}
                  {staleWarning && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 12,
                      background: 'rgba(201, 122, 107, 0.08)', border: '1px solid var(--ab-rose)',
                      borderRadius: 4,
                    }}>
                      <span style={{ color: 'var(--ab-rose)', fontSize: 13, fontWeight: 500 }}>⚠ 生成可能卡住</span>
                      <span style={{ ...body, fontSize: 12, color: 'var(--ab-text-3)' }}>
                        LLM 已 20 分钟无活动, 建议点击"取消"后"恢复生成"重试
                      </span>
                    </div>
                  )}

                  {/* 2026-07-20: 失败态专属横幅 — 醒目展示错误 + 已生成内容摘要 + 大尺寸恢复/重启按钮
                      设计意图: 失败时让用户立即看到 (1) 失败原因 (2) 已保留的进度 (3) 显眼的恢复入口
                      避免失败后用户误以为"无法继续"而放弃已生成的大纲/章节内容
                      2026-07-20 v2: 区分"有内容可恢复"与"无内容需重启"两种场景
                        - 有 outline+sections: 显示"恢复生成"主按钮 (resume, 复用已生成内容)
                        - 无 outline/sections  : 显示"重新开始生成"主按钮 (generate, 失败发生在生成初期) */}
                  {status === 'failed' && (() => {
                    const hasOutline = !!(outlineText && outlineText.trim())
                    const hasSections = sections.length > 0
                    // 2026-07-20 v3: 分级失败横幅
                    //   - hasOutline + hasSections: 失败发生在章节生成中, 优先"恢复生成"继续未完成章节
                    //   - hasOutline + 无 sections: 失败发生在章节生成初期 (如 generateReportDirect 降级),
                    //     优先"重新生成章节内容" (保留大纲, 走 resume 路径)
                    //   - 无 outline: 失败发生在大纲生成阶段, 只能"重新生成大纲" (清空所有产物)
                    const scenario = hasOutline && hasSections ? 'resume'
                      : hasOutline ? 'regen-sections'
                      : 'regen-outline'
                    const titleMap = {
                      'resume': '生成失败 — 已保留大纲与章节',
                      'regen-sections': '生成失败 — 大纲已保留, 章节未生成',
                      'regen-outline': '生成失败 — 大纲未生成',
                    }
                    const hintMap = {
                      'resume': '可"恢复生成"继续未完成章节, 或"重新生成章节内容"从第一章重试 (保留大纲)',
                      'regen-sections': '点击"重新生成章节内容"基于已保留的大纲重新生成正文',
                      'regen-outline': '失败发生在大纲生成阶段, 点击"重新生成大纲"从头开始',
                    }
                    return (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                      style={{
                        marginBottom: 14, padding: '14px 18px', borderRadius: 8,
                        background: 'linear-gradient(135deg, rgba(201, 122, 107, 0.12) 0%, rgba(201, 122, 107, 0.04) 100%)',
                        border: '1px solid var(--ab-rose)',
                        boxShadow: '0 0 0 1px rgba(201, 122, 107, 0.18) inset, 0 4px 18px rgba(201, 122, 107, 0.08)',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 22, height: 22, borderRadius: '50%',
                          background: 'var(--ab-rose)', color: 'var(--ab-bg)', fontSize: 13, fontWeight: 700,
                        }}>!</span>
                        <span style={{ ...serif, fontSize: 15, color: 'var(--ab-rose)', fontWeight: 500 }}>
                          {titleMap[scenario]}
                        </span>
                        <span style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', marginLeft: 'auto' }}>
                          已生成 {sections.length} 章 · 进度 {progress}%
                        </span>
                      </div>
                      <div style={{
                        ...mono, fontSize: 11.5, color: 'var(--ab-text-2)', lineHeight: 1.6,
                        padding: '8px 10px', background: 'rgba(10, 10, 10, 0.4)', borderRadius: 4,
                        border: '1px solid var(--ab-line)', marginBottom: 10,
                        maxHeight: 88, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {progressMessage || '未知错误'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ ...body, fontSize: 12, color: 'var(--ab-text-3)', flex: 1, minWidth: 200 }}>
                          {hintMap[scenario]}
                        </span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {/* 2026-07-21: 统一为"继续生成" — 只要有大纲就能续传 (resumeGeneration 支持从空 sections 继续) */}
                          {hasOutline && (
                            <Button size="large" type="primary" icon={<RollbackOutlined />} onClick={handleResume}
                              style={{
                                height: 38, paddingInline: 22, fontWeight: 500,
                                background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)', color: 'var(--ab-bg)',
                              }}>
                              继续生成
                            </Button>
                          )}
                          {hasOutline && (
                            <Button size="large" icon={<ReloadOutlined />} onClick={handleRegenerateSections}
                              style={{
                                height: 38, paddingInline: 18, fontWeight: 500,
                                borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)',
                                background: 'rgba(212, 165, 116, 0.06)',
                              }}>
                              重新生成章节
                            </Button>
                          )}
                          <Button size="large" danger icon={<EditOutlined />} onClick={handleRegenerateOutline}
                            style={{
                              height: 38, paddingInline: 18, fontWeight: 500,
                              borderColor: 'var(--ab-rose)', color: 'var(--ab-rose)',
                              background: 'rgba(201, 122, 107, 0.06)',
                            }}>
                            重新生成大纲
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                    )
                  })()}

                  {/* 操作按钮 */}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {generating && (
                      <Button danger icon={<StopOutlined />} onClick={handleCancel}
                        style={{ borderColor: 'var(--ab-rose)', color: 'var(--ab-rose)' }}>
                        取消生成
                      </Button>
                    )}
                    {/* 2026-07-21: 统一规则 — 非生成中 + 有大纲 = 显示"继续生成"按钮.
                        覆盖原分散逻辑 (paused/cancelled/draft/failed/done 各自判断).
                        后端 resumeGeneration 会判断是否真的需要续传 (已完成会返回 resumed:false),
                        所以即使 done 状态点"继续生成"也安全.
                        idle 状态无 researchId, handleResume 会直接 return, 不会发请求. */}
                    {!generating && outlineText?.trim() && (
                      <Button type="primary" icon={<RollbackOutlined />} onClick={handleResume}
                        style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)', color: 'var(--ab-bg)' }}>
                        继续生成
                      </Button>
                    )}
                    {/* 失败态额外入口: 重新生成章节内容 + 重新生成大纲 (保留大纲或从头开始) */}
                    {status === 'failed' && (() => {
                      const hasOutline = !!(outlineText && outlineText.trim())
                      return (
                        <>
                          {hasOutline && (
                            <Button icon={<ReloadOutlined />} onClick={handleRegenerateSections}
                              style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)' }}>
                              重新生成章节内容
                            </Button>
                          )}
                          <Button danger icon={<EditOutlined />} onClick={handleRegenerateOutline}
                            style={{ borderColor: 'var(--ab-rose)', color: 'var(--ab-rose)' }}>
                            重新生成大纲
                          </Button>
                        </>
                      )
                    })()}
                    {/* 完成态 + 有 sections: 复制/导出/重新生成大纲 (章节正文已产出) */}
                    {status === 'done' && sections.length > 0 && (() => {
                      const hasOutline = !!(outlineText && outlineText.trim())
                      return (
                        <>
                          <Button icon={<CopyOutlined />} onClick={handleCopy}
                            style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-2)' }}>
                            复制全文
                          </Button>
                          <Button icon={<FileTextOutlined />} onClick={handleExportWord}
                            style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)' }}>
                            导出 Word
                          </Button>
                          <Button icon={<FileTextOutlined />} onClick={handleExportPdf}
                            style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)' }}>
                            导出 PDF
                          </Button>
                          {hasOutline && (
                            <Button icon={<EditOutlined />} onClick={handleRegenerateOutline}
                              style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-3)' }}>
                              重新生成大纲
                            </Button>
                          )}
                        </>
                      )
                    })()}
                    {/* 完成态 + 有大纲 + 无 sections (如 generateReportDirect 降级导致 totalChapters=0):
                        "继续生成"已在上方统一规则显示, 这里补"重新生成大纲"次按钮 */}
                    {status === 'done' && !sections.length && outlineText?.trim() && (
                      <Button icon={<EditOutlined />} onClick={handleRegenerateOutline}
                        style={{ borderColor: 'var(--ab-line)', color: 'var(--ab-text-3)' }}>
                        重新生成大纲
                      </Button>
                    )}
                  </div>

                  {/* 完成态元数据 */}
                  {status === 'done' && generationMeta && (
                    <div style={{
                      marginTop: 14, padding: '10px 14px', background: 'var(--ab-bg-2)',
                      borderRadius: 4, border: '1px solid var(--ab-line)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CheckOutlined style={{ color: 'var(--ab-copper)' }} />
                        <div style={{ ...serif, fontSize: 13, color: 'var(--ab-text)', fontWeight: 500 }}>
                          小说生成完成 · 总耗时 {generationMeta.totalDurationMin || 0} 分钟
                          {generationMeta.totalChapters > 0 && ` · ${generationMeta.totalChapters} 章`}
                          {generationMeta.reportLength > 0 && ` · ${generationMeta.reportLength} 字`}
                          {generationMeta.totalResumeCount > 0 && ` · 分批生成避免单次超时`}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2026-07-23: 过短段落清单 + 人工交互式扩展
                      小说场景下 Stage 3.5 已禁用自动扩展, 改为完成态由用户人工点击确认扩展.
                      流程: 点"检查过短段落" → 加载清单 → 点段落"扩展" → input(扩展方向) → preview(对比) → 保存/取消
                      扩展只用当前段落内容 + 偏好 (styleHint/focusPoints), 不引入外部知识库. */}
                  {status === 'done' && sections.length > 0 && (
                    <div style={{
                      marginTop: 14, padding: '12px 16px', background: 'var(--ab-bg-2)',
                      borderRadius: 8, border: '1px solid var(--ab-line)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <EditOutlined style={{ color: 'var(--ab-copper)', fontSize: 14 }} />
                          <span style={{ ...serif, fontSize: 13, color: 'var(--ab-text)', fontWeight: 500 }}>
                            过短段落扩展
                          </span>
                          {shortParagraphs.length > 0 && (
                            <span style={{
                              fontSize: 11, padding: '1px 8px', borderRadius: 10,
                              background: 'rgba(201, 122, 107, 0.12)', color: 'var(--ab-rose)',
                            }}>
                              {shortParagraphs.length} 段 &lt; {shortParagraphsThreshold} 字
                            </span>
                          )}
                        </div>
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          loading={shortParagraphsLoading}
                          onClick={() => handleLoadShortParagraphs(shortParagraphsThreshold)}
                          style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)', borderRadius: 14 }}
                        >
                          {shortParagraphs.length > 0 ? '刷新清单' : '检查过短段落'}
                        </Button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ab-text-3)', marginBottom: shortParagraphs.length > 0 ? 10 : 0, lineHeight: 1.6 }}>
                        章节生成完成即可导出. 此处可选择性扩展过短段落, 扩展只基于当前段落内容 + 风格偏好, 不引入外部资料.
                      </div>
                      {shortParagraphs.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
                          {shortParagraphs.map((item, idx) => (
                            <div key={`${item.section_idx}-${item.para_idx}-${idx}`} style={{
                              padding: '10px 12px', background: 'var(--ab-bg)',
                              borderRadius: 6, border: '1px solid var(--ab-line)',
                              transition: 'border-color 0.2s, box-shadow 0.2s',
                            }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = 'var(--ab-copper)'
                                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(184, 134, 98, 0.12)'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = 'var(--ab-line)'
                                e.currentTarget.style.boxShadow = 'none'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ab-text-2)' }}>
                                  <span style={{ ...serif, fontWeight: 500, color: 'var(--ab-text)' }}>
                                    {item.section_name}
                                  </span>
                                  <span>·</span>
                                  <span>段落 {item.para_idx + 1}</span>
                                  <span>·</span>
                                  <span style={{ color: 'var(--ab-rose)' }}>{item.length} 字</span>
                                </div>
                                <Button
                                  size="small"
                                  type="primary"
                                  icon={<EditOutlined />}
                                  disabled={!!paraExpandTarget || status === 'generating'}
                                  onClick={() => handleParaExpandStart(item)}
                                  style={{ borderRadius: 12, background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' }}
                                >
                                  扩展
                                </Button>
                              </div>
                              <div style={{
                                fontSize: 12, color: 'var(--ab-text-2)', lineHeight: 1.6,
                                maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis',
                                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                              }}>
                                {item.paragraph}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 2026-07-20: 大纲生成进度面板 — 分层生成时显示已生成的章节名列表
                  后端 generateHierarchicalNovelOutline 每完成一卷就增量持久化 outline_text,
                  前端轮询拿到后实时渲染章节列表, 让用户看到大纲逐章追加 (第一章/第二章/...).
                  当章节正文 sections 还未开始生成时, 这个面板是用户唯一的进度可视化入口. */}
              {(() => {
                const outlineChapters = parseOutlineChapters(outlineText)
                if (outlineChapters.length === 0) return null
                const totalExpected = expectedTotalChapters || outlineChapters.length
                const hasSectionsStarted = sections.length > 0
                // 2026-07-23: 大纲列表常驻可见, 不再因章节正文开始生成而折叠.
                // 之前 collapsed = hasSectionsStarted && status !== 'generating' 会导致
                // 章节生成开始后大纲面板折叠为单行摘要, 用户"看不到大纲列表".
                // 现在始终展开, 让用户在章节生成期间也能查看完整大纲章节名.
                // generating 标记仅在大纲生成阶段 (无 sections) 时为 true, 显示高亮动效.
                return (
                  <OutlineProgressPanel
                    chapters={outlineChapters}
                    totalExpected={totalExpected}
                    generating={generating && !hasSectionsStarted}
                    collapsed={false}
                    genre={selectedGenre}
                  />
                )
              })()}

              {/* 2026-07-20: 书本翻页阅读器 — 取代原"分屏大纲+滚动正文"布局
                  设计: Editorial Book Atelier — 双页对开 + 3D 翻页 + 章节三态视觉
                  章节状态: ready(已生成可读) / generating(墨迹晕开动效) / pending(空白卷页) */}
              {(sections.length > 0 || expectedTotalChapters > 0 || outlineText || generatedReport) && (
                <BookReader
                  sections={sections}
                  expectedTotal={expectedTotalChapters}
                  activeIdx={activeSectionIdx}
                  setActiveIdx={setActiveSectionIdx}
                  status={status}
                  selectedGenre={selectedGenre}
                  synopsis={synopsis}
                  progressMessage={progressMessage}
                  onCopy={handleCopy}
                  onExportWord={handleExportWord}
                  onExportPdf={handleExportPdf}
                  onRegenerateSection={handleRegenerateSection}
                />
              )}
            </StepShell>
          )}

          {/* 底部留白 */}
          <div style={{ height: 60 }} />
        </div>
      </div>

      {/* ── 2026-07-21: 自定义模板编辑/新增 Modal ──
          字段: name / description / structure(一行一卷) /
                totalChapters / chaptersPerVolume /
                wordCountMin / wordCountMax /
                focusPoints(偏好重点) / overallLogic(整体逻辑流程) */}
      <Modal
        open={tplModalOpen}
        title={editingTpl ? '编辑自定义模板' : '新增自定义模板'}
        onCancel={() => setTplModalOpen(false)}
        onOk={handleSaveTpl}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnHidden
        okButtonProps={{ style: { background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' } }}
      >
        <Form form={tplForm} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: '请输入模板名称' }, { max: 50, message: '不超过 50 字' }]}
          >
            <Input placeholder="如：武侠江湖、校园青春..." />
          </Form.Item>

          <Form.Item name="description" label="模板说明" rules={[{ max: 200 }]}>
            <Input.TextArea
              rows={2}
              placeholder="简要说明该模板的风格、题材定位、目标读者等（最多 200 字）"
            />
          </Form.Item>

          <Form.Item
            name="structure"
            label="故事弧线 / 卷结构"
            tooltip="一行一卷，每行简述该卷主线。例如：相遇 → 相知 → 相爱 → 阻碍 → 圆满"
            rules={[{ required: true, message: '故事弧线不能为空' }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={'相遇相知\n情感升温\n阻碍冲突\n化解圆满'}
              style={{ ...mono, fontSize: 12 }}
            />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item
              name="totalChapters"
              label="总章节数"
              tooltip="留空则按 卷数 × 每卷章节数 自动计算"
            >
              <InputNumber min={1} max={2000} placeholder="如 150" style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              name="chaptersPerVolume"
              label="每卷章节数"
              rules={[{ required: true, message: '请输入每卷章节数' }]}
            >
              <InputNumber min={1} max={200} placeholder="默认 30" style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              name="wordCountMin"
              label="每章最少字数"
              rules={[{ required: true, message: '请输入最少字数' }]}
            >
              <InputNumber min={500} max={20000} step={100} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              name="wordCountMax"
              label="每章最多字数"
              rules={[{ required: true, message: '请输入最多字数' }]}
            >
              <InputNumber min={500} max={30000} step={100} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Form.Item
            name="focusPoints"
            label="偏好重点"
            tooltip="写作重点、文风倾向、必备元素等，会在每章生成时注入到 LLM prompt"
          >
            <Input.TextArea
              rows={3}
              placeholder="如：注重心理描写；场景画面感强；情节推进节奏快；每章结尾留悬念..."
            />
          </Form.Item>

          <Form.Item
            name="overallLogic"
            label="整体逻辑流程"
            tooltip="全书的逻辑骨架、因果链、伏笔回收规则等，影响大纲与每章生成"
          >
            <Input.TextArea
              rows={4}
              placeholder={'主线：主角的成长弧线\n伏笔：第 1 卷埋的悬念在第 3 卷回收\n节奏：前慢后快，第 4 卷为高潮'}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── 2026-07-21: 章节级重新生成 Modal (三阶段: 输入修改重点 → 预览对比 → 保存/取消) ──
          阶段1 (input):  输入修改重点, 点"重新生成" → 调 /regenerate-preview (不写DB)
          阶段2 (preview): 展示新旧内容对比, 点"保存" → 调 /regenerate-commit (写DB)
                          点"取消" → 关闭对话框, 原章节内容保留 (DB 未变) */}
      <Modal
        open={regenSectionIdx !== null}
        title={regenSectionIdx !== null
          ? `${regenStage === 'preview' ? '预览重新生成' : '重新生成'}第 ${regenSectionIdx + 1} 章${regenPreview?.section_name || sections[regenSectionIdx]?.title ? '：' + (regenPreview?.section_name || sections[regenSectionIdx].title) : ''}`
          : '重新生成章节'}
        onCancel={handleRegenCancel}
        width={regenStage === 'preview' ? 900 : 640}
        destroyOnHidden
        maskClosable={!regenLoading && !regenCommitLoading}
        footer={null}
      >
        {/* 阶段1: 输入修改重点 */}
        {regenStage === 'input' && (
          <>
            <div style={{ marginBottom: 12, color: 'var(--ab-text-3)', fontSize: 13, lineHeight: 1.6 }}>
              基于当前章节原文与你的修改重点，LLM 会重写本章内容。原文中好的部分会保留，只调整你提示涉及的部分。
              <br />
              <span style={{ color: 'var(--ab-text-4)' }}>提示：生成后会进入预览对比，你可以选择保存或取消。</span>
            </div>
            <Input.TextArea
              rows={6}
              value={regenHint}
              onChange={(e) => setRegenHint(e.target.value)}
              placeholder={'输入需要修改的重点，例如：\n- 加强武松与县令对话的紧张感，增加心理博弈描写\n- 删除第二段的冗余场景，补充县令恐惧的细节\n- 结尾改为开放式，留悬念给下一章'}
              disabled={regenLoading}
              autoFocus
              maxLength={2000}
              showCount
              style={{ fontFamily: 'var(--ab-font-body)' }}
            />
            {regenLoading && (
              <div style={{ marginTop: 10, color: 'var(--ab-copper)', fontSize: 12 }}>
                <Spin size="small" style={{ marginRight: 6 }} />
                LLM 正在重写本章，请稍候...
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button onClick={handleRegenCancel} disabled={regenLoading}>
                取消
              </Button>
              <Button type="primary" onClick={handleRegenPreview} loading={regenLoading}
                style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' }}>
                重新生成
              </Button>
            </div>
          </>
        )}

        {/* 阶段2: 预览对比 */}
        {regenStage === 'preview' && regenPreview && (
          <>
            <div style={{ marginBottom: 12, color: 'var(--ab-text-3)', fontSize: 13, lineHeight: 1.6 }}>
              左侧为原章节内容，右侧为 LLM 重新生成的内容。点击"保存"用新内容替换原章节，点击"取消"保留原章节。
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxHeight: '55vh' }}>
              {/* 左: 原内容 */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{
                  padding: '6px 10px', background: 'var(--ab-bg-2)', borderRadius: '4px 4px 0 0',
                  border: '1px solid var(--ab-line)', borderBottom: 'none',
                  ...mono, fontSize: 11, color: 'var(--ab-text-3)', letterSpacing: '0.05em',
                }}>
                  原内容 · {(regenPreview.original_refined || '').length} 字
                </div>
                <div style={{
                  flex: 1, padding: '12px 14px', overflow: 'auto',
                  background: 'var(--ab-bg)', border: '1px solid var(--ab-line)', borderRadius: '0 0 4px 4px',
                  ...body, fontSize: 13, lineHeight: 1.8, color: 'var(--ab-text-2)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }} className="custom-scrollbar">
                  {regenPreview.original_refined || '(空)'}
                </div>
              </div>
              {/* 右: 新内容 */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{
                  padding: '6px 10px', background: 'rgba(212, 165, 116, 0.08)', borderRadius: '4px 4px 0 0',
                  border: '1px solid var(--ab-copper)', borderBottom: 'none',
                  ...mono, fontSize: 11, color: 'var(--ab-copper)', letterSpacing: '0.05em',
                }}>
                  新内容 · {(regenPreview.new_refined || '').length} 字
                </div>
                <div style={{
                  flex: 1, padding: '12px 14px', overflow: 'auto',
                  background: 'rgba(212, 165, 116, 0.03)', border: '1px solid var(--ab-copper)', borderRadius: '0 0 4px 4px',
                  ...body, fontSize: 13, lineHeight: 1.8, color: 'var(--ab-text)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }} className="custom-scrollbar">
                  {regenPreview.new_refined || '(空)'}
                </div>
              </div>
            </div>
            {(regenCommitLoading || regenLoading) && (
              <div style={{ marginTop: 10, color: 'var(--ab-copper)', fontSize: 12 }}>
                <Spin size="small" style={{ marginRight: 6 }} />
                {regenCommitLoading ? '正在保存...' : 'LLM 正在重新生成, 请稍候...'}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
              <Button onClick={handleRegenBackToInput} disabled={regenCommitLoading || regenLoading}>
                返回修改
              </Button>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* 2026-07-21: 再试一次 — 用当前 hint 重新调 preview, 覆盖右侧新内容.
                    LLM 生成有随机性, 不满意可多次重试, 无需返回修改阶段. */}
                <Button onClick={handleRegenRetry} loading={regenLoading}
                  disabled={regenCommitLoading}
                  icon={<ReloadOutlined />}
                  style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)' }}>
                  再试一次
                </Button>
                <Button onClick={handleRegenCancel} disabled={regenCommitLoading || regenLoading}>
                  取消（保留原章节）
                </Button>
                <Button type="primary" onClick={handleRegenCommit} loading={regenCommitLoading}
                  disabled={regenLoading}
                  style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' }}>
                  保存（替换原章节）
                </Button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ── 2026-07-23: 段落级扩展 Modal (三阶段: 输入扩展方向 → 预览对比 → 保存/取消) ──
          阶段1 (input):  输入扩展方向提示 (可空), 点"扩展" → 调 /expand (pending 写入 DB, refined 不变)
          阶段2 (preview): 展示原段落 vs 扩展后段落对比
                          点"保存" → 调 /commit (pending 应用到 refined + 重写 report)
                          点"取消" → 调 /cancel (清除 pending, 原段落保留)
          与章节级 regen Modal 的区别: 段落级扩展只扩展单个段落, 不重写整章;
          扩展只用当前段落内容 + 偏好, 不引入外部资料. */}
      <Modal
        open={paraExpandTarget !== null}
        title={paraExpandTarget
          ? `${paraExpandStage === 'preview' ? '预览段落扩展' : '扩展段落'}：${paraExpandTarget.section_name} · 段落 ${paraExpandTarget.para_idx + 1}`
          : '扩展段落'}
        onCancel={handleParaExpandCancel}
        width={paraExpandStage === 'preview' ? 900 : 640}
        destroyOnHidden
        maskClosable={!paraExpandLoading && !paraExpandCommitLoading}
        footer={null}
      >
        {/* 阶段1: 输入扩展方向 (可空) */}
        {paraExpandStage === 'input' && paraExpandTarget && (
          <>
            <div style={{ marginBottom: 12, color: 'var(--ab-text-3)', fontSize: 13, lineHeight: 1.6 }}>
              LLM 会基于当前段落原文 + 整章上下文 + 你的风格偏好扩展该段落, 不引入外部资料.
              <br />
              <span style={{ color: 'var(--ab-text-4)' }}>提示: 扩展方向可留空, 留空时 LLM 自行判断薄弱环节; 生成后进入预览对比, 你可以保存或取消.</span>
            </div>
            <div style={{
              marginBottom: 12, padding: '10px 12px', background: 'var(--ab-bg-2)',
              borderRadius: 4, border: '1px solid var(--ab-line)',
              maxHeight: 180, overflow: 'auto',
            }} className="custom-scrollbar">
              <div style={{ ...mono, fontSize: 11, color: 'var(--ab-text-3)', marginBottom: 6, letterSpacing: '0.05em' }}>
                原段落 · {paraExpandTarget.length} 字
              </div>
              <div style={{ ...body, fontSize: 13, lineHeight: 1.8, color: 'var(--ab-text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {paraExpandTarget.original}
              </div>
            </div>
            <Input.TextArea
              rows={4}
              value={paraExpandHint}
              onChange={(e) => setParaExpandHint(e.target.value)}
              placeholder={'扩展方向提示 (可选), 例如:\n- 加强人物心理描写\n- 补充场景的视觉细节\n- 改写对话使其更贴合人物性格'}
              disabled={paraExpandLoading}
              autoFocus
              maxLength={1000}
              showCount
              style={{ fontFamily: 'var(--ab-font-body)' }}
            />
            {paraExpandLoading && (
              <div style={{ marginTop: 10, color: 'var(--ab-copper)', fontSize: 12 }}>
                <Spin size="small" style={{ marginRight: 6 }} />
                LLM 正在扩展段落, 请稍候...
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button onClick={handleParaExpandCancel} disabled={paraExpandLoading}>
                取消
              </Button>
              <Button type="primary" onClick={handleParaExpandPreview} loading={paraExpandLoading}
                style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' }}>
                扩展
              </Button>
            </div>
          </>
        )}

        {/* 阶段2: 预览对比 */}
        {paraExpandStage === 'preview' && paraExpandPreview && paraExpandTarget && (
          <>
            <div style={{ marginBottom: 12, color: 'var(--ab-text-3)', fontSize: 13, lineHeight: 1.6 }}>
              左侧为原段落, 右侧为 LLM 扩展后的段落. 点击"保存"用扩展后内容替换原段落 (并重写整本小说合成文本), 点击"取消"保留原段落.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxHeight: '55vh' }}>
              {/* 左: 原段落 */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{
                  padding: '6px 10px', background: 'var(--ab-bg-2)', borderRadius: '4px 4px 0 0',
                  border: '1px solid var(--ab-line)', borderBottom: 'none',
                  ...mono, fontSize: 11, color: 'var(--ab-text-3)', letterSpacing: '0.05em',
                }}>
                  原段落 · {paraExpandTarget.length} 字
                </div>
                <div style={{
                  flex: 1, padding: '12px 14px', overflow: 'auto',
                  background: 'var(--ab-bg)', border: '1px solid var(--ab-line)', borderRadius: '0 0 4px 4px',
                  ...body, fontSize: 13, lineHeight: 1.8, color: 'var(--ab-text-2)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }} className="custom-scrollbar">
                  {paraExpandTarget.original || '(空)'}
                </div>
              </div>
              {/* 右: 扩展后段落 */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{
                  padding: '6px 10px', background: 'rgba(212, 165, 116, 0.08)', borderRadius: '4px 4px 0 0',
                  border: '1px solid var(--ab-copper)', borderBottom: 'none',
                  ...mono, fontSize: 11, color: 'var(--ab-copper)', letterSpacing: '0.05em',
                }}>
                  扩展后 · {(paraExpandPreview.expanded || '').length} 字
                  {paraExpandTarget.length > 0 && (
                    <span style={{ marginLeft: 8, color: 'var(--ab-text-4)' }}>
                      (+{Math.max(0, (paraExpandPreview.expanded || '').length - paraExpandTarget.length)} 字)
                    </span>
                  )}
                </div>
                <div style={{
                  flex: 1, padding: '12px 14px', overflow: 'auto',
                  background: 'rgba(212, 165, 116, 0.03)', border: '1px solid var(--ab-copper)', borderRadius: '0 0 4px 4px',
                  ...body, fontSize: 13, lineHeight: 1.8, color: 'var(--ab-text)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }} className="custom-scrollbar">
                  {paraExpandPreview.expanded || '(空)'}
                </div>
              </div>
            </div>
            {(paraExpandCommitLoading || paraExpandLoading) && (
              <div style={{ marginTop: 10, color: 'var(--ab-copper)', fontSize: 12 }}>
                <Spin size="small" style={{ marginRight: 6 }} />
                {paraExpandCommitLoading ? '正在保存...' : 'LLM 正在扩展段落, 请稍候...'}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
              <Button onClick={handleParaExpandRetry} disabled={paraExpandCommitLoading || paraExpandLoading}
                icon={<ReloadOutlined />}
                style={{ borderColor: 'var(--ab-copper)', color: 'var(--ab-copper)' }}>
                再试一次
              </Button>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={handleParaExpandCancel} disabled={paraExpandCommitLoading || paraExpandLoading}>
                  取消（保留原段落）
                </Button>
                <Button type="primary" onClick={handleParaExpandCommit} loading={paraExpandCommitLoading}
                  disabled={paraExpandLoading}
                  style={{ background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' }}>
                  保存（替换原段落）
                </Button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ── 2026-07-21: 人物关系图谱重新生成 Modal ──
          已有图谱时点击"重新生成图谱"弹出, 让用户输入偏好 (如"增加角色冲突"/"角色更黑暗"),
          偏好会注入 LLM prompt.
          2026-07-21 增强: 增加"清空原有人物关系"复选框 (默认不勾选).
          - 不勾选: 把原图谱作为背景信息传给 LLM, 新图谱在原图谱基础上结合偏好迭代优化
          - 勾选: 完全从零生成, 不参考原图谱 */}
      <Modal
        open={graphRegenModalOpen}
        title="重新生成人物关系图谱"
        onCancel={() => setGraphRegenModalOpen(false)}
        onOk={handleGraphRegenConfirm}
        okText="按偏好重新生成"
        cancelText="取消"
        width={560}
        destroyOnHidden
        maskClosable={!graphLoading}
        okButtonProps={{
          loading: graphLoading,
          style: { background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' },
        }}
      >
        <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--ab-bg-2)',
          borderRadius: 6, border: '1px solid var(--ab-line)' }}>
          <div style={{ ...mono, fontSize: 10, color: 'var(--ab-copper)', letterSpacing: '0.1em',
            textTransform: 'uppercase', marginBottom: 6 }}>
            <TeamOutlined style={{ marginRight: 4 }} />当前图谱
          </div>
          <div style={{ ...serif, fontSize: 13, color: 'var(--ab-text)' }}>
            {characterGraph
              ? `${characterGraph.characters.length} 个人物 · ${characterGraph.relationships.length} 条关系`
              : '无图谱'}
          </div>
        </div>
        {/* 2026-07-21: 是否清空原图谱复选框 — 默认不勾选 (保留作为背景信息) */}
        <div style={{
          marginBottom: 12, padding: '10px 12px',
          background: graphRegenClear ? 'rgba(232,93,93,0.06)' : 'rgba(212,165,116,0.06)',
          borderRadius: 6,
          border: `1px solid ${graphRegenClear ? 'rgba(232,93,93,0.3)' : 'var(--ab-copper)'}`,
        }}>
          <Checkbox
            checked={graphRegenClear}
            onChange={(e) => setGraphRegenClear(e.target.checked)}
            style={{ fontSize: 12.5, color: 'var(--ab-text-2)' }}
          >
            清空原有人物关系 (完全从零生成)
          </Checkbox>
          <div style={{ marginTop: 4, ...body, fontSize: 11, color: 'var(--ab-text-4)', lineHeight: 1.6, paddingLeft: 24 }}>
            {graphRegenClear
              ? '不参考当前图谱, 完全按偏好和默认规则重新设计角色与关系.'
              : '保留当前图谱作为背景信息, LLM 会在原图谱基础上结合偏好迭代优化 (推荐).'}
          </div>
        </div>
        <div style={{ marginBottom: 6, ...body, fontSize: 12.5, color: 'var(--ab-text-2)' }}>
          偏好提示 (可选)
        </div>
        <Input.TextArea
          rows={5}
          value={graphRegenHint}
          onChange={(e) => setGraphRegenHint(e.target.value)}
          placeholder={'示例:\n- 增加一个女性反派角色\n- 角色之间的冲突要更激烈\n- 主角的师父要有隐藏身份\n- 减少 2 个配角, 集中刻画主线'}
          style={{ fontFamily: 'var(--ab-font-body)' }}
        />
        <div style={{ marginTop: 8, ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', lineHeight: 1.6 }}>
          {graphRegenClear
            ? '留空则按默认规则从零生成. 偏好会注入 LLM prompt 影响角色设计.'
            : '留空则在原图谱基础上优化. 偏好会注入 LLM prompt, 结合原图谱作为背景迭代生成.'}
        </div>
      </Modal>

      {/* ── 2026-07-21: 大纲重新生成 Modal ──
          点击"重新生成大纲"弹出, 让用户输入偏好 (如"大纲更紧凑"/"增加感情线"),
          偏好会注入 LLM prompt. 确认后调 /regenerate-outline (清空旧大纲+章节, 异步生成). */}
      <Modal
        open={outlineRegenModalOpen}
        title="重新生成大纲"
        onCancel={() => setOutlineRegenModalOpen(false)}
        onOk={handleOutlineRegenConfirm}
        okText="按偏好重新生成"
        cancelText="取消"
        width={560}
        destroyOnHidden
        okButtonProps={{
          style: { background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' },
        }}
      >
        <div style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(232,93,93,0.06)',
          borderRadius: 6, border: '1px solid rgba(232,93,93,0.3)' }}>
          <div style={{ ...mono, fontSize: 10, color: '#e85d5d', letterSpacing: '0.1em',
            textTransform: 'uppercase', marginBottom: 6 }}>
            <DeleteOutlined style={{ marginRight: 4 }} />注意
          </div>
          <div style={{ ...body, fontSize: 12, color: 'var(--ab-text-2)', lineHeight: 1.6 }}>
            重新生成会清空当前大纲与所有章节正文, 从头开始生成. 此操作不可撤销.
          </div>
        </div>
        <div style={{ marginBottom: 6, ...body, fontSize: 12.5, color: 'var(--ab-text-2)' }}>
          偏好提示 (可选)
        </div>
        <Input.TextArea
          rows={5}
          value={outlineRegenHint}
          onChange={(e) => setOutlineRegenHint(e.target.value)}
          placeholder={'示例:\n- 大纲更紧凑, 减少 2 卷\n- 增加主角与反派的直接冲突\n- 第 3 卷加入转折, 揭露师父的真实身份\n- 感情线要更细腻, 不要太快在一起'}
          style={{ fontFamily: 'var(--ab-font-body)' }}
        />
        <div style={{ marginTop: 8, ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', lineHeight: 1.6 }}>
          留空则按默认规则重新生成. 偏好会注入大纲生成 LLM prompt, 仅本次有效.
        </div>
      </Modal>

      {/* ── 2026-07-21: 生成风格偏好 Modal ──
          在"开始生成"/"继续生成"前弹出, 让用户注入持久化偏好 (如"文风古雅"/"节奏紧凑").
          与 regenHint/outlineRegenHint 的区别: styleHint 持久化保存到 DB, 每章生成都注入 prompt,
          不会用后清空. 用户可随时修改, 修改后影响后续未生成的章节. */}
      <Modal
        open={styleHintModalOpen}
        title="生成风格偏好"
        onCancel={() => { setStyleHintModalOpen(false); setStyleHintPendingAction(null) }}
        onOk={handleStyleHintConfirm}
        okText={
          styleHintPendingAction === 'generate' ? '确认并开始生成'
          : styleHintPendingAction === 'resume' ? '确认并继续生成'
          : '保存偏好'
        }
        cancelText="取消"
        width={560}
        destroyOnHidden
        okButtonProps={{
          style: { background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' },
        }}
      >
        <div style={{ marginBottom: 12, padding: '10px 12px', background: 'rgba(212,165,116,0.08)',
          borderRadius: 6, border: '1px solid rgba(212,165,116,0.3)' }}>
          <div style={{ ...mono, fontSize: 10, color: 'var(--ab-copper)', letterSpacing: '0.1em',
            textTransform: 'uppercase', marginBottom: 6 }}>
            持久化偏好 · 跨章节生效
          </div>
          <div style={{ ...body, fontSize: 12, color: 'var(--ab-text-2)', lineHeight: 1.6 }}>
            此偏好会保存到任务记录, 每一章生成都注入 LLM prompt, 贯穿后续所有章节的整体风格.
            可随时修改, 修改后影响尚未生成的章节. 留空则不注入偏好 (或清空已有偏好).
          </div>
        </div>
        <div style={{ marginBottom: 6, ...body, fontSize: 12.5, color: 'var(--ab-text-2)' }}>
          风格偏好 (可选)
        </div>
        <Input.TextArea
          rows={6}
          value={styleHintDraft}
          onChange={(e) => setStyleHintDraft(e.target.value)}
          placeholder={'示例:\n- 文风古雅, 多用诗词典故, 避免现代口语\n- 节奏紧凑, 每章结尾留悬念\n- 注重心理描写, 角色内心独白丰富\n- 对话简洁有力, 避免冗长说教\n- 战斗场面热血, 招式描写具体'}
          style={{ fontFamily: 'var(--ab-font-body)' }}
        />
        <div style={{ marginTop: 8, ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', lineHeight: 1.6 }}>
          {styleHint ? `当前已保存偏好 (${styleHint.length} 字), 修改后会覆盖.` : '尚未设置偏好. 留空确认则不注入偏好.'}
        </div>
      </Modal>

      {/* ── 2026-07-21: 角色详情编辑 Modal ──
          点击图谱节点卡片放大打开, 显示完整角色信息并支持编辑.
          编辑字段: id / name / role / goal / personality
          编辑过程不直接改原图谱, 保存后才写回 characterGraph + 同步 relationships 引用. */}
      <Modal
        open={characterEditing !== null}
        title={characterEditingId === '__new__' ? '新增角色' : '角色详情'}
        onCancel={handleEditCharacterCancel}
        onOk={handleEditCharacterSave}
        okText={characterEditingId === '__new__' ? '添加' : '保存'}
        cancelText="取消"
        width={620}
        destroyOnHidden
        okButtonProps={{
          style: { background: 'var(--ab-copper)', borderColor: 'var(--ab-copper)' },
        }}
      >
        {characterEditing && (
          <>
            {/* 顶部角色卡 (放大版, 展示头像+姓名+身份) */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18,
              padding: '14px 18px', background: 'var(--ab-bg-2)',
              borderRadius: 8, border: '1px solid var(--ab-copper)',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--ab-copper) 0%, var(--ab-copper-2) 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--ab-bg)', fontSize: 22, flexShrink: 0,
              }}>
                <UserOutlined />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...serif, fontSize: 18, fontWeight: 600, color: 'var(--ab-text)' }}>
                  {characterEditing.name || '(未命名)'}
                </div>
                <div style={{ ...mono, fontSize: 11, color: 'var(--ab-copper)', letterSpacing: '0.05em', marginTop: 2 }}>
                  {characterEditing.role || '未定身份'} · ID: {characterEditing.id}
                </div>
              </div>
            </div>

            {/* 编辑表单: id / name / role / goal / personality */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                  textTransform: 'uppercase', marginBottom: 4 }}>
                  角色名 *
                </div>
                <Input
                  value={characterEditing.name}
                  onChange={(e) => setCharacterEditing({ ...characterEditing, name: e.target.value })}
                  placeholder="如: 林清霜"
                />
              </div>
              <div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                  textTransform: 'uppercase', marginBottom: 4 }}>
                  身份
                </div>
                <Input
                  value={characterEditing.role}
                  onChange={(e) => setCharacterEditing({ ...characterEditing, role: e.target.value })}
                  placeholder="如: 主角 / 反派 / 师父"
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                textTransform: 'uppercase', marginBottom: 4 }}>
                任务 / 目标
              </div>
              <Input.TextArea
                rows={2}
                value={characterEditing.goal}
                onChange={(e) => setCharacterEditing({ ...characterEditing, goal: e.target.value })}
                placeholder="如: 报杀父之仇 / 寻找失散的妹妹 / 称霸修真界"
                style={{ fontFamily: 'var(--ab-font-body)' }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                textTransform: 'uppercase', marginBottom: 4 }}>
                性格特点
              </div>
              <Input.TextArea
                rows={3}
                value={characterEditing.personality}
                onChange={(e) => setCharacterEditing({ ...characterEditing, personality: e.target.value })}
                placeholder="如: 隐忍寡言, 内心炽热; 对朋友忠诚, 对敌人冷酷; 但容易陷入偏执..."
                style={{ fontFamily: 'var(--ab-font-body)' }}
              />
            </div>

            {/* ID 编辑 (高级, 折叠) — 改 ID 会同步更新 relationships 引用 */}
            <div style={{
              padding: '10px 12px', background: 'var(--ab-bg-2)',
              borderRadius: 6, border: '1px solid var(--ab-line)',
            }}>
              <div style={{ ...mono, fontSize: 10, color: 'var(--ab-text-4)', letterSpacing: '0.1em',
                textTransform: 'uppercase', marginBottom: 4 }}>
                角色 ID (高级)
              </div>
              <Input
                value={characterEditing.id}
                onChange={(e) => setCharacterEditing({ ...characterEditing, id: e.target.value })}
                size="small"
                style={{ fontFamily: 'var(--ab-font-mono)', fontSize: 11 }}
              />
              <div style={{ marginTop: 6, ...body, fontSize: 10.5, color: 'var(--ab-text-4)', lineHeight: 1.6 }}>
                ID 是角色在图谱中的唯一标识, 用于关系引用. 修改 ID 会自动同步更新涉及该角色的所有关系. 建议保持 c1/c2/c3... 格式.
              </div>
            </div>

            <div style={{ marginTop: 12, ...mono, fontSize: 10.5, color: 'var(--ab-text-4)', lineHeight: 1.6 }}>
              ✓ 保存后图谱会标记为"有未保存修改", 请点顶部"保存"按钮持久化到数据库.
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
