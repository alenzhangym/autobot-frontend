// [F72·#182] 这份用例从前一条都没跑过（没有 `node:test` import → ReferenceError）。
// 接回产品实现时发现更要紧的一件事：原文两边那张 icon 名单**都是手抄的**，
// 手抄的那两份恰好都漏了同一个名字 —— 于是它对产品现状一句都不说。
// 现在改成逐字读两份真源：后端 `BaseAgent.resolveToolIcon` 能返回哪些名字、
// 前端 `ToolIcon.jsx` 的 ICON_MAP 登记了哪些名字，两边一比就红。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BACKEND = path.resolve(HERE, '../../../java-backend/src/main/java/com/autobot/agent/BaseAgent.java')
const FRONTEND = path.resolve(HERE, '../components/ToolIcon.jsx')

/** 后端 resolveToolIcon 那一段里逐字出现的 icon 名（只读方法体，不读整个文件）。 */
function backendIcons() {
  const src = readFileSync(BACKEND, 'utf-8')
  const start = src.indexOf('static String resolveToolIcon')
  assert.notEqual(start, -1, '后端方法 resolveToolIcon 不在了 —— 契约的一端换了地方，这条用例要跟着改')
  const body = src.slice(start, src.indexOf('\n    }\n', start))
  return [...new Set([...body.matchAll(/"([A-Za-z]+Outlined)"/g)].map((m) => m[1]))]
}

/** 前端 ICON_MAP 里登记的键。 */
function frontendIcons() {
  const src = readFileSync(FRONTEND, 'utf-8')
  const start = src.indexOf('const ICON_MAP = {')
  assert.notEqual(start, -1, '前端 ICON_MAP 不在了')
  const block = src.slice(start, src.indexOf('\n}', start))
  return [...new Set([...block.matchAll(/^\s*([A-Za-z]+Outlined),/gm)].map((m) => m[1]))]
}

describe('S8: REACT_TOOL_CALL.toolIcon 契约（两边都读真源）', () => {
  test('后端能返回的每个 icon 名，前端 ICON_MAP 里都要有对应', () => {
    const be = backendIcons()
    const fe = new Set(frontendIcons())
    const missing = be.filter((n) => !fe.has(n))
    assert.deepEqual(missing, [],
      `后端会发这些名字而前端没登记（界面上会退成通用图标）：${missing.join(', ')}`)
  })

  test('挑不到就用兜底那个图标，不是什么都不画', () => {
    assert.match(readFileSync(FRONTEND, 'utf-8'), /ICON_MAP\[name\]\s*\|\|\s*ToolOutlined/)
  })

  test('后端发的字段名是 toolIcon（前端按这个键取）', () => {
    assert.match(readFileSync(BACKEND, 'utf-8'), /payload\.put\("toolIcon"/)
  })

  test('两份名单都不许是空的（空表会让上面那条 ⊆ 断言恒真）', () => {
    assert.ok(backendIcons().length >= 10, '后端那张名单抽不出东西 = 解析形状变了')
    assert.ok(frontendIcons().length >= 10, '前端那张表抽不出东西 = 解析形状变了')
  })
})
