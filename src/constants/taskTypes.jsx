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
 *  - crm                 → CRM (独立分支，对标 ERP)
 *  - cross               → ERP/CRM 跨域 (Phase 4: 合并 erp/crm, 后端 CrossDomainRouter 自动分发)
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
    key: 'cross',
    label: 'ERP/CRM 业务',
    desc: '进销存 + 客户关系管理 (跨域联动)',
    icon: '🏢',
    antIcon: <ShopOutlined />,
    taskType: null, // 独立分支, 后端 CrossDomainOrchestrator 自动分发到 ERP/CRM
    subType: null,
    capabilities: ['采购单', '入库单', '出库单', '销售单', '库存', '客户查询', '商机推进', '合同回款', '跟进记录', '跨域联动'],
    agentNames: ['CrossDomainOrchestrator'],
  },
];

// ── 历史会话 channel 兼容 (Phase 4: erp/crm 合并为 cross) ──
// 旧会话的 channel='erp' 或 'crm', 加载时需识别为业务会话并映射到 cross 标签逻辑.
// 不改数据库, 仅前端识别.
export const LEGACY_BUSINESS_CHANNELS = ['erp', 'crm'];

// ── 域关键词 (与后端 CrossDomainRouter 对称, 用于快速标签动态切换) ──
export const ERP_KEYWORDS = [
  '采购', '入库', '出库', '销售单', '采购单', '库存', '对账', '物料', '供应商',
  '备货', '报价单', '发货', '出货', '收货', '补货', '缺货', '安全库存'
];
export const CRM_KEYWORDS = [
  '客户', '联系人', '线索', '商机', '合同', '回款', '跟进', '意向', '成交',
  '客户流失', '客户价值', '客户画像'
];

/**
 * 根据输入文本推断业务域 (用于合并会话后快速标签动态切换).
 * @param {string} input 用户输入
 * @returns {'erp'|'crm'} 默认 'erp' (ERP 是主业务)
 */
export function detectDomainFromInput(input) {
  if (!input || typeof input !== 'string') return 'erp';
  let hasErp = false, hasCrm = false;
  for (const kw of ERP_KEYWORDS) { if (input.includes(kw)) { hasErp = true; break; } }
  for (const kw of CRM_KEYWORDS) { if (input.includes(kw)) { hasCrm = true; break; } }
  if (hasCrm && !hasErp) return 'crm';
  return 'erp';
}

/**
 * 判断 channel 是否为业务会话 (含历史 erp/crm 和新 cross).
 * 用于快速标签渲染条件.
 */
export function isBusinessChannel(channel) {
  return channel === 'cross' || LEGACY_BUSINESS_CHANNELS.includes(channel);
}

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
