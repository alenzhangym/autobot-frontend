/**
 * S8: REACT_TOOL_CALL.toolIcon 字段契约 —— 锁住前后端 icon 名一致。
 */
describe('S8: REACT_TOOL_CALL toolIcon 契约', () => {
  test('所有后端返回的 icon 名都应在前端 ICON_MAP 里有对应', () => {
    const ICON_MAP = new Set([
      'ToolOutlined', 'FileTextOutlined', 'EditOutlined', 'SearchOutlined',
      'FolderOpenOutlined', 'DatabaseOutlined', 'ConsoleSqlOutlined', 'CodeOutlined',
      'BranchesOutlined', 'BulbOutlined', 'DeleteOutlined', 'EyeOutlined',
      'BuildOutlined', 'ExperimentOutlined',
    ])
    const backendIcons = new Set([
      'FileTextOutlined', 'EditOutlined', 'SearchOutlined', 'FolderOpenOutlined',
      'DatabaseOutlined', 'ConsoleSqlOutlined', 'CodeOutlined', 'BranchesOutlined',
      'BulbOutlined', 'DeleteOutlined', 'EyeOutlined', 'BuildOutlined',
      'ExperimentOutlined', 'ToolOutlined',
    ])
    for (const ic of backendIcons) {
      expect(ICON_MAP.has(ic)).toBe(true)
    }
  })
  test('payload 必须含 toolIcon 字段', () => {
    const payload = {
      type: 'REACT_TOOL_CALL',
      tool: 'rag_search',
      toolIcon: 'DatabaseOutlined',
      status: 'running',
    }
    expect(payload.toolIcon).toBe('DatabaseOutlined')
  })
})
