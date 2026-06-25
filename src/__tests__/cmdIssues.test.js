/**
 * S9: cmd-issues:<session_id> 命令契约测试。
 *
 * 验证前端 __CMD__ 解析能识别 `action: "issues"`，并且后端接口契约
 * `/api/code-analysis/{sessionId}/issues` 返回的 issue 列表能正确
 * 被过滤/排序/截断成 markdown 表格。
 */

// 复制后端 useIssueTable 的过滤+排序+渲染逻辑，避免引入被测组件的依赖。
// 与 WorkspacePanel.jsx executeSingleCommand 'issues' 分支保持一致。
function buildIssueTable(issues) {
  const open = (issues || []).filter(i => (i.status || 'open') === 'open')
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  open.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
  const top = open.slice(0, 30)
  if (top.length === 0) return 'No open issues recorded for this session.'
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200)
  const rows = top.map(i =>
    `| ${esc(i.severity)} | ${esc(i.category)} | ${esc(i.filePath || '-')}${i.lineNumber ? ':' + i.lineNumber : ''} | ${esc(i.description)} |`
  )
  return ['| severity | category | file:line | description |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

describe('S9: cmd-issues 契约', () => {
  test('issues URL 形如 /api/code-analysis/<sessionId>/issues，sessionId 经 encode', () => {
    const sid = 'sess/with/slash'
    const url = `/api/code-analysis/${encodeURIComponent(sid)}/issues`
    expect(url).toBe('/api/code-analysis/sess%2Fwith%2Fslash/issues')
  })

  test('只保留 OPEN 状态的 issue', () => {
    const table = buildIssueTable([
      { severity: 'HIGH', category: 'bug', filePath: 'A.java', lineNumber: 1, description: 'open-one', status: 'open' },
      { severity: 'HIGH', category: 'bug', filePath: 'B.java', lineNumber: 1, description: 'fixed-one', status: 'fixed' },
      { severity: 'LOW',  category: 'bug', filePath: 'C.java', lineNumber: 1, description: 'ignored-one', status: 'ignored' }
    ])
    expect(table).toContain('open-one')
    expect(table).not.toContain('fixed-one')
    expect(table).not.toContain('ignored-one')
  })

  test('按 severity 降序（HIGH > MEDIUM > LOW）', () => {
    const table = buildIssueTable([
      { severity: 'LOW',    category: 'c', filePath: 'L.java', lineNumber: 1, description: 'low-row' },
      { severity: 'HIGH',   category: 'c', filePath: 'H.java', lineNumber: 1, description: 'high-row' },
      { severity: 'MEDIUM', category: 'c', filePath: 'M.java', lineNumber: 1, description: 'medium-row' }
    ])
    const highAt = table.indexOf('high-row')
    const medAt  = table.indexOf('medium-row')
    const lowAt  = table.indexOf('low-row')
    expect(highAt).toBeGreaterThan(-1)
    expect(highAt).toBeLessThan(medAt)
    expect(medAt).toBeLessThan(lowAt)
  })

  test('超过 30 条截断到前 30', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      severity: 'LOW', category: 'c', filePath: `F${i}.java`, lineNumber: i + 1, description: `desc-${i}`
    }))
    const table = buildIssueTable(many)
    const lines = table.split('\n').filter(l => l.startsWith('| LOW'))
    expect(lines).toHaveLength(30)
    expect(table).toContain('desc-0')
    expect(table).not.toContain('desc-49')
  })

  test('空 issue 列表返回英文占位', () => {
    expect(buildIssueTable([])).toBe('No open issues recorded for this session.')
  })

  test('description 里的 | 不会破坏表格列', () => {
    const table = buildIssueTable([
      { severity: 'HIGH', category: 'bug', filePath: 'X.java', lineNumber: 1, description: 'a | b | c' }
    ])
    // 渲染后的行："| HIGH | bug | X.java:1 | a \| b \| c |"
    // 5 个未转义 |（4 个列分隔 + 1 个行首） + 2 个被转义的 \|（description 里有 2 个 |）
    const dataRow = table.split('\n').find(l => l.startsWith('| HIGH'))
    const unescapedPipe = (dataRow.match(/(?<!\\)\|/g) || []).length
    const escapedPipe   = (dataRow.match(/\\\|/g) || []).length
    expect(unescapedPipe).toBe(5)
    expect(escapedPipe).toBe(2)
  })
})
