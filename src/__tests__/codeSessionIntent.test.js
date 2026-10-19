/**
 * [返工 R3·#120] A 方案：code 会话去除 toggle + 4 档 intent 透传的契约用例。
 *
 * 这个文件以前有 4 个 describe、约 20 条 test，却**一条都没跑过** —— 它连
 * `import { describe, test } from 'node:test'` 都没有，`node --test` 直接
 * `ReferenceError: describe is not defined`（基线：`ℹ pass 0 / ℹ fail 1`，红的不是判据而是加载）。
 * 更要紧的是它在文件里**手抄了一份产品规则**，而抄的那份已经落后：
 *   · 产品随 code_mode 一起发 execution_mode（build→apply / plan→plan），手抄那份没有；
 *   · 产品的浮层判据里有"code 会话一律静默"这一格，手抄那份连 isCodeSess 这个参数都不接。
 *   → 让它跑起来还不够；手抄的三份里只留一份（`src/runtime/codeSessionIntent.js`），
 *     产品（App.jsx / IntentCorrectionFloater.jsx）与本用例共读它。
 *
 * 覆盖：
 *   1. payload 构造：codeMode='auto' 时不发 code_mode/execution_mode，显式 'plan'/'build' 时**成对**发
 *   2. intentFloaterDecision 静默规则：QUERY/CONVERSATIONAL/CONFIRMATION/UNKNOWN 静默、
 *      ANALYZE/FIX/BUILD 触发、**code 会话整族静默**、短问句静默、已开不叠
 *   3. intent 字段透传：data.intent / data.plan.intent / data.plan.code_intent 三处都能读到
 *   4. CODE_SESSION_INTENTS 与后端 CodeSessionIntent 4 档对齐
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyCodeMode,
  predictedIntentOf,
  intentFloaterDecision,
  CODE_SESSION_INTENTS,
  SILENT_INTENTS,
} from '../runtime/codeSessionIntent.js'

// 产品里 payload 的起手只有 message/session_id，其余都是可选附加 —— 用例照这个起手，
// 差别只在 code_mode 那一手走的是产品实现（不再有一份手抄）。
function buildChatPayload({ text, codeMode, sessionId }) {
  return applyCodeMode({ message: text, session_id: sessionId }, codeMode)
}

describe('A 方案：payload 构造（code_mode 与 execution_mode 是一对）', () => {
  test("codeMode='auto'（默认）→ code_mode / execution_mode 都不发", () => {
    const p = buildChatPayload({ text: '分析这段代码', codeMode: 'auto', sessionId: 's1' })
    assert.equal('code_mode' in p, false)
    assert.equal('execution_mode' in p, false)
  })

  test("显式 codeMode='build' → 发 code_mode=build 且 execution_mode=apply（旧手抄缺的就是这一半）", () => {
    const p = buildChatPayload({ text: '改一下', codeMode: 'build', sessionId: 's1' })
    assert.equal(p.code_mode, 'build')
    assert.equal(p.execution_mode, 'apply')
  })

  test("显式 codeMode='plan' → 发 code_mode=plan 且 execution_mode=plan（只给方案不改文件）", () => {
    const p = buildChatPayload({ text: '分析', codeMode: 'plan', sessionId: 's1' })
    assert.equal(p.code_mode, 'plan')
    assert.equal(p.execution_mode, 'plan')
  })

  test('codeMode 为空 → 不发；不认识的档位名只透传 code_mode，不替它折成任何一种执行模式', () => {
    assert.equal('code_mode' in buildChatPayload({ text: 'x', codeMode: null, sessionId: 's1' }), false)
    assert.equal('code_mode' in buildChatPayload({ text: 'x', sessionId: 's1' }), false)
    const p = buildChatPayload({ text: 'x', codeMode: 'whatever', sessionId: 's1' })
    assert.equal(p.code_mode, 'whatever')
    assert.equal('execution_mode' in p, false)
  })
})

describe('A 方案：intentFloaterDecision 静默规则', () => {
  test('ANALYZE / FIX / BUILD 三档都触发，且交回逐字 trim 过的 query', () => {
    for (const intent of ['ANALYZE', 'FIX', 'BUILD']) {
      const d = intentFloaterDecision({
        data: { intent }, queryText: '  帮我改一下这个类  ', floaterOpen: false,
      })
      assert.ok(d, intent + ' 该弹浮层')
      assert.equal(d.predicted, intent)
      assert.equal(d.query, '帮我改一下这个类')
    }
  })

  test('QUERY 静默（每条自由提问都是，弹了没意义）', () => {
    assert.equal(intentFloaterDecision({ data: { intent: 'QUERY' }, queryText: '这段代码做什么', floaterOpen: false }), null)
  })

  test('CONVERSATIONAL / CONFIRMATION / UNKNOWN 静默（含小写传入）', () => {
    for (const intent of ['CONVERSATIONAL', 'CONFIRMATION', 'UNKNOWN', 'conversational']) {
      assert.equal(intentFloaterDecision({
        data: { intent }, queryText: '一段足够长的 query 文本来满足长度门槛', floaterOpen: false,
      }), null)
    }
  })

  test('code 会话整族静默 —— 这一格手抄那份连参数都不接', () => {
    assert.equal(intentFloaterDecision({
      data: { intent: 'BUILD' }, queryText: '帮我加一个接口', isCodeSess: true, floaterOpen: false,
    }), null)
  })

  test('问句去掉空白后不足 4 字静默（空 / 标点）', () => {
    assert.equal(intentFloaterDecision({ data: { intent: 'BUILD' }, queryText: '改', floaterOpen: false }), null)
    assert.equal(intentFloaterDecision({ data: { intent: 'BUILD' }, queryText: '   ', lastUserQuery: '', floaterOpen: false }), null)
  })

  test('浮层已开 → 不叠第二份', () => {
    assert.equal(intentFloaterDecision({ data: { intent: 'BUILD' }, queryText: '帮我写一个新功能模块', floaterOpen: true }), null)
  })

  test('data 为空 / 三处都没有 intent → 静默', () => {
    assert.equal(intentFloaterDecision({ data: null, queryText: '测试 query 足够长', floaterOpen: false }), null)
    assert.equal(intentFloaterDecision({ data: {}, queryText: '测试 query 足够长', floaterOpen: false }), null)
  })

  test('queryText 缺省时回退到上一问（lastUserQuery 那一格）', () => {
    const d = intentFloaterDecision({ data: { intent: 'FIX' }, queryText: '', lastUserQuery: '这里报错了', floaterOpen: false })
    assert.equal(d.query, '这里报错了')
  })
})

describe('A 方案：intent 字段透传来源', () => {
  test('data.intent 优先', () => {
    assert.equal(predictedIntentOf({ intent: 'BUILD', plan: { intent: 'ANALYZE' } }), 'BUILD')
  })

  test('data.intent 缺失时回退到 data.plan.intent', () => {
    assert.equal(predictedIntentOf({ plan: { intent: 'ANALYZE' } }), 'ANALYZE')
  })

  test('再缺失时兜到 data.plan.code_intent（后端 A 方案新增字段）', () => {
    assert.equal(predictedIntentOf({ plan: { code_intent: 'FIX' } }), 'FIX')
  })

  test('小写 intent 字符串被规范化成大写档位名', () => {
    const d = intentFloaterDecision({ data: { intent: 'build' }, queryText: '帮我写一个新的登录功能', floaterOpen: false })
    assert.equal(d.predicted, 'BUILD')
  })
})

describe('A 方案：候选集与后端 CodeSessionIntent 对齐', () => {
  test('候选 = [ANALYZE, FIX, BUILD, QUERY]（无旧的 KNOWLEDGE_RETRIEVAL 等）', () => {
    assert.deepEqual(CODE_SESSION_INTENTS, ['ANALYZE', 'FIX', 'BUILD', 'QUERY'])
  })

  test('不含旧的全局 TaskIntent 值', () => {
    for (const legacy of ['KNOWLEDGE_RETRIEVAL', 'SYSTEM_OPERATION', 'CODE_ANALYSIS', 'CODE_GENERATION', 'CODE_FIX']) {
      assert.equal(CODE_SESSION_INTENTS.includes(legacy), false, legacy)
    }
  })

  test('静默那几档与候选集的交集只有 QUERY —— 「ANALYZE/FIX/BUILD 都值得确认」那句的结构写法', () => {
    assert.deepEqual(CODE_SESSION_INTENTS.filter((v) => SILENT_INTENTS.includes(v)), ['QUERY'])
  })
})

/**
 * 反向的一条（与 U1 那份能力清单反向着例同形）：本枚治的是"一份规则三份手抄"，
 * 光把 runtime 那份钉住不够 —— 消费点要是没接上，产品仍在各写一遍而用例一点看不出来。
 * 这两条读的是**源文件本身**：JSX 在 `node --test` 下编不动（与 portProbe/procListen 同口径），
 * 所以只能这样钉。
 */
describe('A 方案：两个消费点必须共读 runtime 那一份（反向着例）', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf-8')
  const floater = readFileSync(new URL('../components/IntentCorrectionFloater.jsx', import.meta.url), 'utf-8')

  test('App.jsx 与 IntentCorrectionFloater.jsx 都从 runtime 那份取，且真用了导出的名字', () => {
    assert.match(app, /from '\.\/runtime\/codeSessionIntent'/)
    assert.match(app, /applyCodeMode\(payload, codeMode\)/)
    assert.match(app, /intentFloaterDecision\(/)
    assert.match(floater, /from '\.\.\/runtime\/codeSessionIntent'/)
    assert.match(floater, /setAlternatives\(CODE_SESSION_INTENTS\)/)
  })

  test('产品文件里不许再留着内联的那两份（回退＝第四份真相，本枚要治的就是它）', () => {
    assert.equal(/payload\.code_mode\s*=/.test(app), false, 'App.jsx 里不该再有 code_mode 的内联赋值')
    assert.equal(/payload\.execution_mode\s*=/.test(app), false, 'App.jsx 里不该再有 execution_mode 的内联赋值')
    assert.equal(/setAlternatives\(\s*\[/.test(floater), false, '浮层候选不该再写死一份数组')
    assert.equal(/const silent = \[/.test(app), false, '静默那几档不该在 App.jsx 里再列一遍')
  })
})
