/**
 * [返工 R3·#120 的同族留痕，新债记 #182] 端侧用例目录的反向着例：
 * 「一份 `*.test.js` 一条都没跑过」这件事，从今天起**要当场红**。
 *
 * 成因（2026-10-19 实测，不是推测）：`codeSessionIntent.test.js` 有 4 个 describe、约 20 条 test，
 * 却连 `import { describe, test } from 'node:test'` 都没有 —— `node --test` 报
 * `ReferenceError: describe is not defined`，**一条都没执行过**，而这件事在目录里安静地存在了很久。
 * 逐个跑一遍 `src/__tests__/*.test.js` 之后，同形状的还有几份（见下面那张表）。
 * 它们不是"断言失败"，是**加载失败**，所以任何"这套用例绿"的说法此前都不包含它们。
 *
 * 立场与 U1（能力清单反向着例）同形：不假装今天就把它们全修完，而是
 *   ① 把账显式登记在一张表里，每一份带一句"是谁、为什么还没跑"；
 *   ② 新加的 `*.test.js` 一旦忘了 import，本用例当场红；
 *   ③ 表里不许留着已经修好的文件 —— 修好就要把它划掉，否则债会一直显示还在。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * 已知"一例都没跑过"的文件。key = 文件名，value = 为什么在这里（**不是**设计如此，是欠账）。
 * 修好一份就删掉一行；删干净之后这张表应当是空的。
 *
 * [F72·#182 收口，2026-10-19 15:4x] 五笔全部接完，表是空的：
 *   · `cmdBlocks` 那笔的真正成因不是"模块不存在"，是 **import 少写了 `.js`**（打包器能解析，node ESM 不能）；
 *     接上后又发现它整份用的是 jest 的 `expect()`，本仓跑的是 node:test + assert —— 即两条静默叠在一起。
 *   · 另四笔（`codeAnalysisTools` / `intentCorrect` / `toolIcon` / `useLspLookup`）补 import 也不会看见任何东西：
 *     它们的断言全打在**测试自己造的常量**上，产品怎么改都不会红。这一轮把每份都改成逐字读真源
 *     （前端调用点 + 后端 controller / BaseAgent 那一头），当场照出两条真的：
 *     `DesktopOutlined` 后端会发而前端 ICON_MAP 从没登记（界面上退成通用图标，已补登记）、
 *     `intent/correct` 的键名两侧对齐（这条今天是对的，钉住它别再漂）。
 *   · 同族第 7 例（形状不同，故本用例抓不到）：`serverIntegration.test.js` 把 server.js 指到 `src/` 下
 *     那个不存在的路径，spawn 立刻退出 → `before` 抛错 → 报 `tests 10 / pass 0 / fail 0`，一条都不落。
 *     已改指包根真身 + 加载期 `existsSync` 断言（路径再写错就是**加载即红**，不许再静默），
 *     10 条第一次全跑；两条 background 用例补了产品自己那只手会带的 `confirmed:true`。
 */
const KNOWN_DEAD = {}

const testFiles = () => readdirSync(HERE).filter((f) => f.endsWith('.test.js')).sort()

describe('#120/#182 端侧用例目录的反向着例：新用例不许静默不跑', () => {
  test('每份 *.test.js 要么 import 了 node:test，要么在 KNOWN_DEAD 里带一句欠账原因', () => {
    const offenders = []
    for (const f of testFiles()) {
      const src = readFileSync(path.join(HERE, f), 'utf-8')
      const importsRunner = /from\s+'node:test'/.test(src)
      if (importsRunner) continue
      if (KNOWN_DEAD[f]) continue
      offenders.push(f)
    }
    assert.deepEqual(offenders, [], '这些用例文件谁都不会跑到：补 node:test import，或把成因登记进 KNOWN_DEAD')
  })

  test('KNOWN_DEAD 里不许留着已经修好的文件（修好就划掉，别把债留成常态）', () => {
    const stale = Object.keys(KNOWN_DEAD).filter((f) => {
      return /from\s+'node:test'/.test(readFileSync(path.join(HERE, f), 'utf-8'))
    })
    assert.deepEqual(stale, [], '这几份已经能加载了，请把它们从 KNOWN_DEAD 里删掉')
  })

  test('欠账总数要说得出（不许悄悄变多，也不许写成"没有"）', () => {
    const n = Object.keys(KNOWN_DEAD).length
    assert.equal(n, 0, `#182 已收口，这张表就该是空的；现在留着 ${n} 笔：`
      + Object.entries(KNOWN_DEAD).map(([k, v]) => k + '=' + v).join(' / '))
    assert.equal(testFiles().length >= n, true)
  })

  test('本枚修好的那份不许再回到表里（codeSessionIntent 已共读 runtime 那一份）', () => {
    assert.equal('codeSessionIntent.test.js' in KNOWN_DEAD, false)
    assert.match(readFileSync(path.join(HERE, 'codeSessionIntent.test.js'), 'utf-8'), /from 'node:test'/)
  })

  // ── #182 那三份的"不许回到旧形状"：旧形状不是断言红，是**加载不了 / 根本什么都没测** ──

  test('cmdBlocks 那份要用带扩展名的真源 import，且断言层是本仓跑得动的那一套', () => {
    const s = readFileSync(path.join(HERE, 'cmdBlocks.test.js'), 'utf-8')
    // 少写 `.js` 时打包器照样解析、node ESM 报 ERR_MODULE_NOT_FOUND —— 一条都不跑且不红。
    assert.match(s, /from '\.\.\/utils\/cmdBlocks\.js'/)
    assert.equal(/^\s*expect\(/m.test(s), false,
      'jest 的 expect 在本仓不存在：这份用例当年就是死在"连 expect 都没定义"上')
  })

  test('serverIntegration 那份要在加载期就钉住被启动的那个文件真的存在', () => {
    const s = readFileSync(path.join(HERE, 'serverIntegration.test.js'), 'utf-8')
    // 它旧的下场是 `tests 10 / pass 0 / fail 0`：路径指错 → spawn 立刻退出 → before 抛错，一条都不落。
    assert.match(s, /existsSync\(SERVER_PATH\)/)
  })

  test('契约类用例不许再拿测试自己造的常量当产品（读真源那三份各留一条特征）', () => {
    const reads = (f) => readFileSync(path.join(HERE, f), 'utf-8').includes('node:fs')
    for (const f of ['toolIcon.test.js', 'intentCorrect.test.js', 'codeAnalysisTools.test.js']) {
      assert.equal(reads(f), true, f + ' 没有读真源 —— 它断言的很可能只是自己抄的那份')
    }
  })
})
