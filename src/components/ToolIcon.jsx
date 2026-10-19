import React from 'react'
import {
  ToolOutlined, FileTextOutlined, EditOutlined, SearchOutlined,
  FolderOpenOutlined, DatabaseOutlined, ConsoleSqlOutlined, CodeOutlined,
  BranchesOutlined, BulbOutlined, DeleteOutlined, EyeOutlined,
  BuildOutlined, ExperimentOutlined, DesktopOutlined,
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
  // [F72·#182] 后端 resolveToolIcon 的 canvas_ui / open_tab / show_preview / navigate_to_file
  //   那一族发的就是这个名字，而这份表里从没登记过 —— 界面上一律退成通用图标，且没有任何一处会红。
  DesktopOutlined,
}

export default function ToolIcon({ name, ...rest }) {
  const C = ICON_MAP[name] || ToolOutlined
  return <C {...rest} />
}
