// [F72·#182] 从前一条都没跑过（没有 `node:test` import）。原文三条断言打的都是测试自己造的常量，
// 产品改什么都不会红。现在读真源：钩子发出去的端点名与请求体键名，就是这份契约的全部。
//
// 顺带一条**观察**（不改码，记进 candidates §60）：这三条 `/lsp/*` 路径在后端今天**没有对应路由**
// （controller 目录里 grep 不到 lsp）—— 真按这条走会 404。这一格不在用例里断言"不存在"，
// 因为那会把将来补路由的那件事变成一条红用例；成因归到候选文档等点名。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(HERE, '../hooks/useLspLookup.js')
const src = () => readFileSync(HOOK, 'utf-8')

describe('S4: useLspLookup 端点与请求体契约（读真源）', () => {
  test('path 由 /lsp/<端点名> 拼，且自带 baseURL 之外的 /api 前缀一次都不许出现', () => {
    assert.match(src(), /api\.post\(`\/lsp\/\$\{endpoint\}`/)
    assert.equal(src().includes("'/api/lsp/"), false, 'baseURL 已是 ${host}/api，再拼一次就是 /api/api/…')
  })

  test('三个动作各自发到自己的端点名', () => {
    const s = src()
    for (const name of ['definition', 'references', 'symbols']) {
      assert.match(s, new RegExp(`call\\('${name}',\\s*\\{`), `这一格没发到 /lsp/${name}`)
    }
  })

  test('请求体键名：三档都带 workspaceRoot 与 file；定义/引用带 line+col，符号带 kind', () => {
    const s = src()
    const bodyOf = (endpoint) => {
      const at = s.indexOf(`call('${endpoint}', {`)
      assert.notEqual(at, -1, `call('${endpoint}') 那一格不在了`)
      return s.slice(at, s.indexOf('})', at) + 2)
    }
    for (const ep of ['definition', 'references', 'symbols']) {
      assert.match(bodyOf(ep), /workspaceRoot/, ep + ' 那一格没带 workspaceRoot')
      assert.match(bodyOf(ep), /\bfile\b/, ep + ' 那一格没带 file')
    }
    assert.match(bodyOf('definition'), /line,\s*col/)
    assert.match(bodyOf('references'), /line,\s*col,\s*maxResults/)
    assert.match(bodyOf('symbols'), /kind/)
  })

  test('引用那一档的 maxResults 有默认值（不发 undefined 上去）', () => {
    assert.match(src(), /maxResults\s*=\s*50/)
  })
})
