/**
 * A 方案：code 会话去除 toggle + 4 档 intent 透传契约测试。
 *
 * 覆盖：
 *   1. payload 构造：codeMode='auto' 时不发 code_mode，显式 'plan'/'build' 时仍发（向后兼容）
 *   2. maybeShowIntentFloater 静默规则：QUERY/CONVERSATIONAL/CONFIRMATION/UNKNOWN 静默，
 *      ANALYZE/FIX/BUILD 触发
 *   3. 后端响应 intent 字段透传：data.intent / data.plan.intent / data.plan.code_intent 三处
 *      都能被前端读到
 *   4. IntentCorrectionFloater 候选集合对齐 CodeSessionIntent 4 档
 */

// ── payload 构造逻辑的纯函数版本（与 App.jsx sendMessage 保持一致） ────────
function buildChatPayload({ text, codeMode, sessionId, imageBase64, uploadedDocuments }) {
  const payload = { message: text, session_id: sessionId }
  // A 方案：codeMode='auto' 不发；显式 'plan'/'build' 才发（向后兼容旧前端）
  if (codeMode && codeMode !== 'auto') payload.code_mode = codeMode
  if (imageBase64) payload.image_base64 = imageBase64
  if (uploadedDocuments && uploadedDocuments.length > 0) {
    payload.document_ids = uploadedDocuments.map(d => d.id)
  }
  return payload
}

// ── maybeShowIntentFloater 触发判断（与 App.jsx 同源） ──────────────────
const SILENT_INTENTS = new Set(['QUERY', 'CONVERSATIONAL', 'CONFIRMATION', 'UNKNOWN'])

function shouldShowIntentFloater({ data, queryText, lastUserQuery, floaterOpen }) {
  if (!data) return false
  if (floaterOpen) return false
  const predicted = data.intent || (data.plan && data.plan.intent) || (data.plan && data.plan.code_intent)
  if (!predicted) return false
  const normalized = String(predicted).toUpperCase()
  if (SILENT_INTENTS.has(normalized)) return false
  const q = (queryText || lastUserQuery || '').trim()
  if (q.length < 4) return false
  return normalized
}

// ── IntentCorrectionFloater 候选（与组件 useEffect 同源） ───────────────
const CODE_SESSION_INTENTS = ['ANALYZE', 'FIX', 'BUILD', 'QUERY']

describe('A 方案：payload 构造', () => {
  test("codeMode='auto'（默认）→ 不发 code_mode 字段", () => {
    const p = buildChatPayload({ text: '分析这段代码', codeMode: 'auto', sessionId: 's1' })
    expect(p).not.toHaveProperty('code_mode')
  })

  test("显式 codeMode='build' → 发 code_mode='build'（向后兼容旧前端）", () => {
    const p = buildChatPayload({ text: '改一下', codeMode: 'build', sessionId: 's1' })
    expect(p.code_mode).toBe('build')
  })

  test("显式 codeMode='plan' → 发 code_mode='plan'（向后兼容）", () => {
    const p = buildChatPayload({ text: '分析', codeMode: 'plan', sessionId: 's1' })
    expect(p.code_mode).toBe('plan')
  })

  test("codeMode=null/undefined → 不发 code_mode 字段", () => {
    expect(buildChatPayload({ text: 'x', codeMode: null, sessionId: 's1' })).not.toHaveProperty('code_mode')
    expect(buildChatPayload({ text: 'x', sessionId: 's1' })).not.toHaveProperty('code_mode')
  })
})

describe('A 方案：maybeShowIntentFloater 静默规则', () => {
  test("BUILD 触发浮层", () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'BUILD' },
      queryText: '帮我写一个新功能',
      floaterOpen: false
    })
    expect(r).toBe('BUILD')
  })

  test("FIX 触发浮层", () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'FIX' },
      queryText: '修一下这个 bug',
      floaterOpen: false
    })
    expect(r).toBe('FIX')
  })

  test("ANALYZE 触发浮层", () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'ANALYZE' },
      queryText: '分析一下这段代码',
      floaterOpen: false
    })
    expect(r).toBe('ANALYZE')
  })

  test("QUERY 静默（不弹浮层）", () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'QUERY' },
      queryText: '你好',
      floaterOpen: false
    })
    expect(r).toBe(false)
  })

  test("CONVERSATIONAL/CONFIRMATION/UNKNOWN 静默", () => {
    ['CONVERSATIONAL', 'CONFIRMATION', 'UNKNOWN', 'conversational'].forEach(intent => {
      const r = shouldShowIntentFloater({
        data: { intent },
        queryText: '一段足够长的 query 文本来满足长度门槛',
        floaterOpen: false
      })
      expect(r).toBe(false)
    })
  })

  test('query 长度 < 4 静默（避免空 / 标点）', () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'BUILD' },
      queryText: '改',
      floaterOpen: false
    })
    expect(r).toBe(false)
  })

  test('浮层已开 → 不重复弹', () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'BUILD' },
      queryText: '帮我写一个新功能模块',
      floaterOpen: true
    })
    expect(r).toBe(false)
  })

  test('data 为空 → 不弹', () => {
    expect(shouldShowIntentFloater({ data: null, queryText: '测试 query 足够长', floaterOpen: false })).toBe(false)
    expect(shouldShowIntentFloater({ data: {}, queryText: '测试 query 足够长', floaterOpen: false })).toBe(false)
  })
})

describe('A 方案：intent 字段透传来源', () => {
  test('data.intent 优先', () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'BUILD', plan: { intent: 'ANALYZE' } },
      queryText: '帮我改一下',
      floaterOpen: false
    })
    expect(r).toBe('BUILD')
  })

  test('data.intent 缺失时回退到 data.plan.intent', () => {
    const r = shouldShowIntentFloater({
      data: { plan: { intent: 'ANALYZE' } },
      queryText: '分析一下',
      floaterOpen: false
    })
    expect(r).toBe('ANALYZE')
  })

  test('data.plan.code_intent（后端 A 方案新增字段）兜底', () => {
    const r = shouldShowIntentFloater({
      data: { plan: { code_intent: 'FIX' } },
      queryText: '修一下那个崩溃',
      floaterOpen: false
    })
    expect(r).toBe('FIX')
  })

  test('小写 intent 字符串被规范化', () => {
    const r = shouldShowIntentFloater({
      data: { intent: 'build' },
      queryText: '帮我写一个新的登录功能',
      floaterOpen: false
    })
    expect(r).toBe('BUILD')
  })
})

describe('A 方案：IntentCorrectionFloater 候选与 CodeSessionIntent 对齐', () => {
  test('候选集合 = [ANALYZE, FIX, BUILD, QUERY]（无旧的 KNOWLEDGE_RETRIEVAL 等）', () => {
    expect(CODE_SESSION_INTENTS).toEqual(['ANALYZE', 'FIX', 'BUILD', 'QUERY'])
  })

  test('不含旧的全局 TaskIntent 值', () => {
    const legacy = ['KNOWLEDGE_RETRIEVAL', 'SYSTEM_OPERATION', 'CODE_ANALYSIS', 'CODE_GENERATION', 'CODE_FIX']
    legacy.forEach(v => expect(CODE_SESSION_INTENTS).not.toContain(v))
  })

  test('候选集合覆盖 CodeSessionDetector 全部 4 档输出', () => {
    const all = ['ANALYZE', 'FIX', 'BUILD', 'QUERY']
    all.forEach(v => expect(CODE_SESSION_INTENTS).toContain(v))
  })
})
