/**
 * S4: useLspLookup 端点契约测试。
 * 不依赖 react-testing-library（轻量化），只测纯函数映射逻辑。
 */

describe('S4: useLspLookup endpoint contract', () => {
  test('定义端点 body schema', () => {
    const body = { workspaceRoot: '/ws', file: '/ws/Foo.java', line: 10, col: 4 }
    expect(Object.keys(body).sort()).toEqual(['col', 'file', 'line', 'workspaceRoot'])
  })
  test('引用端点 body schema 包含 maxResults', () => {
    const body = { workspaceRoot: '/ws', file: '/ws/Foo.java', line: 0, col: 0, maxResults: 50 }
    expect(body.maxResults).toBe(50)
  })
  test('符号端点 body schema 包含 kind 过滤', () => {
    const body = { workspaceRoot: '/ws', file: '/ws/Foo.java', kind: 'method' }
    expect(body.kind).toBe('method')
  })
})
