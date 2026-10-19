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
 */
const KNOWN_DEAD = {
  'codeAnalysisTools.test.js': '#182 无 node:test import → ReferenceError，加载即红',
  'intentCorrect.test.js': '#182 同上',
  'toolIcon.test.js': '#182 同上',
  'useLspLookup.test.js': '#182 同上',
  'cmdBlocks.test.js': '#182 import 指向 src/utils/cmdBlocks（该模块不存在）→ ERR_MODULE_NOT_FOUND',
}

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
    // cmdBlocks 那一行还多欠一格：它 import 的 `src/utils/cmdBlocks` 得真的存在才算修好。
    const stale = Object.keys(KNOWN_DEAD).filter((f) => {
      return /from\s+'node:test'/.test(readFileSync(path.join(HERE, f), 'utf-8'))
    })
    assert.deepEqual(stale, [], '这几份已经能加载了，请把它们从 KNOWN_DEAD 里删掉')
  })

  test('欠账总数要说得出（不许悄悄变多，也不许写成"没有"）', () => {
    assert.equal(Object.keys(KNOWN_DEAD).length, 5)
    assert.equal(testFiles().length >= Object.keys(KNOWN_DEAD).length, true)
  })

  test('本枚修好的那份不许再回到表里（codeSessionIntent 已共读 runtime 那一份）', () => {
    assert.equal('codeSessionIntent.test.js' in KNOWN_DEAD, false)
    assert.match(readFileSync(path.join(HERE, 'codeSessionIntent.test.js'), 'utf-8'), /from 'node:test'/)
  })
})
