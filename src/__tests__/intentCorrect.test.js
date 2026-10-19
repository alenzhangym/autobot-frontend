// [F72·#182] 这份用例从前一条都没跑过（没有 `node:test` import → ReferenceError），
// 而且原文两条断言都在**测试自己造的常量**上打转（`const body = {...}` 然后断言它有那个键），
// 产品改什么都不会红。现在两边都读真源：前端 `IntentCorrectionFloater` 发的是哪些键、
// 后端 `CodeAnalysisController.correctIntent` 读的是哪些键 —— 键名对不上就红。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLOATER = path.resolve(HERE, '../components/IntentCorrectionFloater.jsx')
const CTRL = path.resolve(HERE, '../../../java-backend/src/main/java/com/autobot/controller/CodeAnalysisController.java')

/** 前端 api.post('/intent/correct', { ... }) 那个字面量里的键（含简写属性）。 */
function sentKeys() {
  const src = readFileSync(FLOATER, 'utf-8')
  const start = src.indexOf("api.post('/intent/correct', {")
  assert.notEqual(start, -1, '前端那道 post 的字面量形状变了 —— 契约的一端换了地方，这条用例要跟着改')
  const block = src.slice(start, src.indexOf('\n        })', start))
  return [...new Set([...block.matchAll(/^\s*([a-z_]+)\s*(?:,|:)/gm)].map((m) => m[1]))]
}

/** 后端从请求体里读走的键（request.get("...")）。 */
function readKeys() {
  const src = readFileSync(CTRL, 'utf-8')
  const start = src.indexOf('public ResponseEntity<?> correctIntent')
  assert.notEqual(start, -1, '后端 correctIntent 不在了')
  const body = src.slice(start, start + 4000)
  return [...new Set([...body.matchAll(/request\.get\("([a-z_]+)"\)/g)].map((m) => m[1]))]
}

describe('S6: intent/correct 契约（两边都读真源）', () => {
  test('后端读走的每个键，前端都要真的发出去', () => {
    const sent = new Set(sentKeys())
    const missing = readKeys().filter((k) => !sent.has(k))
    assert.deepEqual(missing, [],
      `后端按这些键取值而前端没发（那边会静默收到 null）：${missing.join(', ')}`)
  })

  test('字段名是 snake_case —— 后端就按这个字面取', () => {
    const read = readKeys()
    assert.ok(read.includes('predicted_intent') && read.includes('corrected_intent'),
      '后端读的名不再是这两个 snake_case 名字了：' + read.join(', '))
    for (const k of sentKeys()) {
      assert.equal(/^[a-z_]+$/.test(k), true, `前端发的键不是 snake_case：${k}`)
    }
  })

  test('path 不许自带 /api 前缀（baseURL 已是 ${host}/api，再拼一次就是 404）', () => {
    const src = readFileSync(FLOATER, 'utf-8')
    assert.match(src, /api\.post\('\/intent\/correct'/)
    assert.equal(src.includes("api.post('/api/"), false, '这一格会把 URL 拼成 /api/api/…')
  })

  test('后端那头的完整路径确实是 /api/intent/correct', () => {
    const src = readFileSync(CTRL, 'utf-8')
    assert.match(src, /@RequestMapping\("\/api"\)[\s\S]*?@PostMapping\("\/intent\/correct"\)/)
  })
})
