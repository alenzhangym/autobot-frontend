// [F72·#182] 从前一条都没跑过（没有 `node:test` import）。原文两条断言打的都是测试自己写的常量
// （自己拼一个 URL 再断言它等于自己拼出来的串），产品怎么改都不会红。现在读真源。
//
// 顺带一条**观察**（不改码，记进 candidates §60）：后端有 `POST /api/semantic-validate` 这条路
// （CodeAnalysisController:98），而端侧今天没有任何调用面 —— 这份用例因此只钉 topology 那一头。
// 将来端侧接上 semantic-validate 时，要在本文件里加一条两侧键名对齐的用例，别回到手抄常量。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CALLER = path.resolve(HERE, '../components/WorkspaceTopologySearch.jsx')
const CTRL = path.resolve(HERE, '../../../java-backend/src/main/java/com/autobot/controller/CodeAnalysisController.java')

describe('S5: 拓扑端点契约（读真源，不手抄）', () => {
  test('前端按 GET /topology/<id> 取，且 id 必须过 encodeURIComponent', () => {
    const src = readFileSync(CALLER, 'utf-8')
    const hit = src.match(/api\.get\(\s*`\/topology\/\$\{([^}]*)\}`/)
    assert.ok(hit, '前端取拓扑那一格形状变了 —— 契约的一端换了地方，这条用例要跟着改')
    // workspaceId 里可能带路径分隔符；不 encode 就会把一段 id 拼成多层 path。
    assert.match(hit[1], /encodeURIComponent\(/, '这一格没 encode：' + hit[1])
  })

  test('前端不许自带 /api 前缀（axios baseURL 已是 ${host}/api）', () => {
    assert.equal(readFileSync(CALLER, 'utf-8').includes("api.get('/api/"), false)
  })

  test('后端那头的完整路径是 /api/topology/{workspaceId}', () => {
    const src = readFileSync(CTRL, 'utf-8')
    assert.match(src, /@RequestMapping\("\/api"\)[\s\S]*?@GetMapping\("\/topology\/\{workspaceId\}"\)/)
  })
})
