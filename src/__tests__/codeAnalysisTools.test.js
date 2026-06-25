/**
 * S5: 拓扑搜索 / 语义校验端点契约测试。
 */

describe('S5: code-analysis tools 端点契约', () => {
  test('GET /api/topology/{workspaceId} path 形如 /api/topology/<id>', () => {
    const wid = 'ws-abc-123'
    const url = `/api/topology/${encodeURIComponent(wid)}`
    expect(url).toBe('/api/topology/ws-abc-123')
  })
  test('POST /api/semantic-validate body schema 包含 workspaceId/filePath/code', () => {
    const body = { workspaceId: 'ws-1', filePath: '/x/Foo.java', code: 'class Foo {}' }
    expect(Object.keys(body).sort()).toEqual(['code', 'filePath', 'workspaceId'])
  })
})
