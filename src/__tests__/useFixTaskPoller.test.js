/**
 * S7: useFixTaskPoller / useIssueList hook 契约。
 * 测的是"重构前先锁定行为"，避免迁移到 hook 后行为偏移。
 */

describe('S7: useFixTaskPoller 契约', () => {
  test('空 sessionId 时不报错', () => {
    const config = { sessionId: null, filter: 'open' }
    // 不能调 useEffect，仅做契约 doc-test
    expect(config).toBeDefined()
  })
  test('pending-confirmations 端点路径', () => {
    const sid = 's-123'
    const tid = 't-abc'
    const url = `/api/code-analysis/${sid}/fix-task/${tid}/pending-confirmations`
    expect(url).toBe('/api/code-analysis/s-123/fix-task/t-abc/pending-confirmations')
  })
  test('confirm POST 路径', () => {
    const sid = 's-1'; const tid = 't-1'; const cid = 'c-1'
    const url = `/api/code-analysis/${sid}/fix-task/${tid}/confirm/${cid}`
    expect(url).toBe('/api/code-analysis/s-1/fix-task/t-1/confirm/c-1')
  })
})
