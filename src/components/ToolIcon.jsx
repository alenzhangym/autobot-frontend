import React from 'react'
import {
  ToolOutlined, FileTextOutlined, EditOutlined, SearchOutlined,
  FolderOpenOutlined, DatabaseOutlined, ConsoleSqlOutlined, CodeOutlined,
  BranchesOutlined, BulbOutlined, DeleteOutlined, EyeOutlined,
  BuildOutlined, ExperimentOutlined,
} from '@ant-design/icons'

/**
 * S8: antd icon name 串 → React 组件。
 *
 * <p>后端 {@code BaseAgent.resolveToolIcon(String)} 返回的 icon 名
 * （字符串），前端要转成真组件渲染。新增 tool 时改两处：</p>
 * <ul>
 *   <li>后端：{@code BaseAgent.java} 的 {@code resolveToolIcon} 加分支</li>
 *   <li>前端：本文件 {@code ICON_MAP} 加一项</li>
 * </ul>
 */
const ICON_MAP = {
  ToolOutlined,
  FileTextOutlined,
  EditOutlined,
  SearchOutlined,
  FolderOpenOutlined,
  DatabaseOutlined,
  ConsoleSqlOutlined,
  CodeOutlined,
  BranchesOutlined,
  BulbOutlined,
  DeleteOutlined,
  EyeOutlined,
  BuildOutlined,
  ExperimentOutlined,
}

export default function ToolIcon({ name, ...rest }) {
  const C = ICON_MAP[name] || ToolOutlined
  return <C {...rest} />
}
