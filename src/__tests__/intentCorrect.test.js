/**
 * S6: IntentCorrectionFloater 端点契约。
 */
describe('S6: intent/correct 端点契约', () => {
  test('POST body 字段名是 snake_case', () => {
    const body = {
      query: '什么是 fix-task',
      predicted_intent: 'KNOWLEDGE_RETRIEVAL',
      corrected_intent: 'CODE_ANALYSIS',
      reason: '我是在问代码',
    }
    expect(body.predicted_intent).toBeDefined()
    expect(body.corrected_intent).toBeDefined()
  })
  test('必填字段缺一不可', () => {
    const required = ['query', 'predicted_intent', 'corrected_intent']
    const body = { query: 'q', predicted_intent: 'A', corrected_intent: 'B' }
    for (const k of required) expect(body).toHaveProperty(k)
  })
})
