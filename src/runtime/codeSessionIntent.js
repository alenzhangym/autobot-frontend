/**
 * [返工 R3·#120] code 会话意图这一族的**唯一实现点**：payload 的 code_mode 那一手、
 * 意图纠正浮层的静默规则、以及 code 会话的 4 档候选。
 *
 * 为什么要把它们收到这里（不是"顺手重构"）：
 *   - `App.jsx` 里有一份（sendMessage 的 code_mode 段 + maybeShowIntentFloater），
 *     `components/IntentCorrectionFloater.jsx` 里有一份候选表，
 *     `__tests__/codeSessionIntent.test.js` 里还有**第三份手抄**；
 *   - 那份手抄连 `import { describe, test } from 'node:test'` 都没有，`node --test` 直接
 *     `ReferenceError: describe is not defined` → **二十个用例一条都没跑过**，绿是假的；
 *   - 而且它抄的时候产品已经改过：产品会随 code_mode 一起发 `execution_mode`，手抄那份没有；
 *     产品的浮层规则里有"code 会话一律静默"这一格，手抄那份连这个参数都不接。
 *   → 于是"覆盖了"这件事本身是两份落后的真相。现在产品与用例共读这一份
 *     （与 `runtime/commandResultsMeta.js`、`runtime/procListen.js` 同口径）。
 */

/** code 会话的 4 档意图候选（后端 CodeSessionIntent 枚举的那四档）。 */
export const CODE_SESSION_INTENTS = ['ANALYZE', 'FIX', 'BUILD', 'QUERY']

/** 不值得弹纠正浮层的那些档：QUERY 太频、CONFIRMATION 是系统拦截、CONVERSATIONAL 是闲聊、UNKNOWN 判不了。 */
export const SILENT_INTENTS = ['QUERY', 'CONVERSATIONAL', 'CONFIRMATION', 'UNKNOWN']

/**
 * 显式锁定 plan/build 时才发这两个字段（默认 'auto' 一律不发，交给后端 CodeIntentClassifier）。
 * 就地改 payload 并返回它 —— 与产品里那一手的作用方式一致，不制造第二个对象。
 */
export function applyCodeMode(payload, codeMode) {
  if (!codeMode || codeMode === 'auto') return payload
  payload.code_mode = codeMode
  if (codeMode === 'build') payload.execution_mode = 'apply'
  else if (codeMode === 'plan') payload.execution_mode = 'plan'
  return payload
}

/** 后端把预测意图放在三处之一：data.intent / data.plan.intent / data.plan.code_intent。 */
export function predictedIntentOf(data) {
  if (!data) return null
  return data.intent || (data.plan && data.plan.intent) || (data.plan && data.plan.code_intent) || null
}

/**
 * 要不要弹意图纠正浮层 —— 判据全在这里，副作用（setState / try-catch）留在调用方。
 * 返回 `null` = 静默；否则返回要写进浮层状态的那两格（逐字 trim 过的 query + 大写化的档位名）。
 */
export function intentFloaterDecision({ data, queryText, lastUserQuery, isCodeSess, floaterOpen }) {
  if (!data) return null
  // code 任务的意图由后端 PlannerService 自己处理，不再弹纠正浮层（用户已确认不必每次确认）。
  if (isCodeSess) return null
  if (floaterOpen) return null
  const predicted = predictedIntentOf(data)
  if (!predicted) return null
  const normalized = String(predicted).toUpperCase()
  if (SILENT_INTENTS.includes(normalized)) return null
  const q = (queryText || lastUserQuery || '').trim()
  if (q.length < 4) return null
  return { query: q, predicted: normalized }
}
