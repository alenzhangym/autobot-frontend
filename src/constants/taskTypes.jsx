/**
 * 任务类型常量 - 与后端 TaskType 枚举保持一致
 *
 * 方向 B+C 重构后的 4 个任务类型：
 *  - CODE_TASK   (代码任务)
 *  - DOC_TASK    (文档任务 - 包含问答/生成/摘要)
 *  - DB_TASK     (数据库任务)
 *  - GENERAL_QUERY (通用查询)
 *
 * 与 channel 映射：
 *  - code                → CODE_TASK (subType: analysis)
 *  - document            → DOC_TASK  (subType: auto - 后端 LLM 判别)
 *  - database_analysis   → DB_TASK   (subType: analysis)
 *  - general / null      → GENERAL_QUERY (ReAct 模式)
 *  - erp                 → ERP (独立分支，不属于这 4 个任务类型)
 */

import React from 'react';
import {
  MessageOutlined,
  FileTextOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ShopOutlined,
  SearchOutlined,
} from '@ant-design/icons';

// 任务类型 key（与后端 TaskType 枚举值完全一致）
export const TASK_TYPE = {
  CODE_TASK: 'CODE_TASK',
  DOC_TASK: 'DOC_TASK',
  DB_TASK: 'DB_TASK',
  GENERAL_QUERY: 'GENERAL_QUERY',
};

// Channel 列表（保留原命名，避免数据库值变化）
// 同时标注对应的 taskType，便于前端 UI 对齐展示
export const CHANNELS = [
  {
    key: 'general',
    label: '普通会话',
    desc: '通用 AI 对话，ReAct 推理模式',
    icon: '💬',
    antIcon: <MessageOutlined />,
    taskType: TASK_TYPE.GENERAL_QUERY,
    subType: null,
    capabilities: ['通用问答', 'ReAct 推理', '工具调用', '多步规划'],
    agentNames: ['RagAgent', 'LLMAgent', 'DBSqlAgent', 'DBInspectAgent', 'CodeAnalysisAgent'],
  },
  {
    key: 'document',
    label: '文档任务',
    desc: '问答 / 生成 / 摘要 - 后端 LLM 智能判别',
    icon: '📚',
    antIcon: <FileTextOutlined />,
    taskType: TASK_TYPE.DOC_TASK,
    subType: 'auto',
    capabilities: ['问答检索', '文档生成', '智能摘要', '多文档综合'],
    agentNames: ['RagAgent', 'DocumentArchitectAgent', 'ContentAgent', 'DocumentAssembler', 'SummaryAgent', 'UIAgent'],
  },
  {
    key: 'code',
    label: '代码任务',
    desc: '代码分析/生成/审查',
    icon: '💻',
    antIcon: <CodeOutlined />,
    taskType: TASK_TYPE.CODE_TASK,
    subType: 'analysis',
    capabilities: ['代码扫描', '依赖分析', '问题检测', '修复建议'],
    agentNames: ['CodeAnalysisAgent', 'CodeAgent', 'CodeValidatorAgent'],
  },
  {
    key: 'database_analysis',
    label: '数据库分析',
    desc: '查询与分析公司数据库',
    icon: '🗄️',
    antIcon: <DatabaseOutlined />,
    taskType: TASK_TYPE.DB_TASK,
    subType: 'analysis',
    capabilities: ['表结构探查', 'SQL 查询', '数据分析', '结果展示'],
    agentNames: ['DBInspectAgent', 'DBSqlAgent', 'DataProfilerAgent', 'SummaryAgent', 'UIAgent'],
  },
  {
    key: 'erp',
    label: 'ERP 进销存',
    desc: '库存/订单/客户管理',
    icon: '🏭',
    antIcon: <ShopOutlined />,
    taskType: null, // ERP 是独立分支
    subType: null,
    capabilities: ['采购单', '入库单', '出库单', '销售单', '对账单'],
    agentNames: ['ERPAgent'],
  },
];

/**
 * 按 taskType 分组 channels（用于按任务类型展示）
 */
export const CHANNELS_BY_TASK_TYPE = CHANNELS.reduce((acc, ch) => {
  const t = ch.taskType || 'OTHER';
  if (!acc[t]) acc[t] = [];
  acc[t].push(ch);
  return acc;
}, {});

/**
 * 按 key 快速查找 channel
 */
export const CHANNELS_BY_KEY = CHANNELS.reduce((acc, ch) => {
  acc[ch.key] = ch;
  return acc;
}, {});

/**
 * 获取 channel 对应的 taskType
 */
export function getTaskTypeByChannel(channelKey) {
  const ch = CHANNELS_BY_KEY[channelKey];
  return ch ? ch.taskType : null;
}
