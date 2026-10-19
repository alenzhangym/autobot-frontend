// [返工 R2·2.1] [META:{json}] 头与逐格原子事实的纯函数。
// 判据原文是"无 extra → 与今天逐字节一致"，刀①是"折批（写回 status）→ 必须被逐条用例红"。
// 抽成 runtime/commandResultsMeta.js 才钉得住（JSX 在 node --test 下编不动；
// 与 runtime/portProbe.js、runtime/procListen.js 同一口径）。
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCommandResultsMeta, buildCommandCellResults, isBatchEnumerated,
  recordCommandCellFact, takeCommandCellFacts, cmdCellFacts,
  normalizeRunExitCode, runOutputMarker, readRunCell,
} from '../runtime/commandResultsMeta.js'

beforeEach(() => cmdCellFacts.clear())

describe('buildCommandResultsMeta：不给 extra 就是今天的形状', () => {
  test('只有 sessionId 时逐字节等于旧输出（明细两键不许凭空出现）', () => {
    assert.equal(buildCommandResultsMeta('s-1'), '[META:{"session_id":"s-1"}]')
    assert.equal(
      buildCommandResultsMeta('s-1', { turnId: 3, toolCallId: 'call-1', sessionVersion: 2 }),
      '[META:{"session_id":"s-1","turn_id":3,"tool_call_id":"call-1","session_version":2}]')
  })

  test('没有 sessionId 时仍是空串（legacy 消息一个字节都不变）', () => {
    assert.equal(buildCommandResultsMeta('', { results: [{ id: 'x' }], enumerated: true }), '')
    assert.equal(buildCommandResultsMeta(undefined), '')
  })

  test('刀①：明细只报逐格事实，批次级 status / killed_ids 一个都不许由前端折出来', () => {
    recordCommandCellFact('cmd-run:mvn compile', { action: 'run', exit_code: 1, timed_out: true })
    const cells = buildCommandCellResults(
      [{ id: 'cmd-run:mvn compile', action: 'run' }], takeCommandCellFacts([{ id: 'cmd-run:mvn compile' }]),
      new Map([['cmd-run:mvn compile', 30000]]))
    const meta = buildCommandResultsMeta('s-1', { results: cells, enumerated: true })
    const parsed = JSON.parse(meta.slice('[META:'.length, -1))
    assert.deepEqual(Object.keys(parsed).sort(), ['enumerated', 'results', 'session_id'])
    assert.ok(!('status' in parsed), '批次级 status 归读回灌正文的一方，前端折它就等于两处各说一个词')
    assert.ok(!('killed_ids' in parsed), 'killed_ids 是服务端唯一的集合运算，前端不许另折一份真相')
    assert.deepEqual(parsed.results[0],
      { id: 'cmd-run:mvn compile', action: 'run', exit_code: 1, timed_out: true, elapsed_ms: 30000 })
  })

  test('results 非数组 / enumerated 非布尔 → 不落键（缺字段=旧语义，不许写个假的上去）', () => {
    assert.equal(buildCommandResultsMeta('s-1', { results: undefined, enumerated: 'yes' }),
      '[META:{"session_id":"s-1"}]')
  })
})

describe('isBatchEnumerated：这一格说的是"我报全了没有"，不是"跑得好不好"', () => {
  test('每格都有唯一 id → true', () => {
    assert.equal(isBatchEnumerated([{ id: 'a' }, { id: 'b' }]), true)
  })
  test('有命令没 id → false（那一格没法在明细里指认）', () => {
    assert.equal(isBatchEnumerated([{ id: 'a' }, { action: 'read' }]), false)
    assert.equal(isBatchEnumerated([{ id: 'a' }, { id: '   ' }]), false)
  })
  test('同 id 出现两次 → false（服务端折集合会把两条并成一条＝报少了）', () => {
    assert.equal(isBatchEnumerated([{ id: 'a' }, { id: 'a' }]), false)
  })
  test('空批 / 非数组 → false（没有"逐格报完"这回事）', () => {
    assert.equal(isBatchEnumerated([]), false)
    assert.equal(isBatchEnumerated(undefined), false)
  })
})

describe('buildCommandCellResults：只报这一格真的在手的事实', () => {
  test('run 族有 exit_code/timed_out；其余动作一格不编', () => {
    recordCommandCellFact('cmd-run:x', { action: 'run', exit_code: 0, timed_out: false })
    const cmds = [{ id: 'cmd-run:x', action: 'run' }, { id: 'cmd-read:a.java', action: 'read' }]
    const cells = buildCommandCellResults(cmds, takeCommandCellFacts(cmds), new Map())
    assert.deepEqual(cells, [
      { id: 'cmd-run:x', action: 'run', exit_code: 0, timed_out: false },
      { id: 'cmd-read:a.java', action: 'read' },
    ])
  })

  test('timed_out 只收布尔，字符串"false"不算事实', () => {
    recordCommandCellFact('cmd-run:x', { timed_out: 'false' })
    const cells = buildCommandCellResults([{ id: 'cmd-run:x', action: 'run' }],
      takeCommandCellFacts([{ id: 'cmd-run:x' }]), new Map())
    assert.deepEqual(cells, [{ id: 'cmd-run:x', action: 'run' }])
  })

  test('elapsed_ms 只给这一批真执行过的那几格（缓存复用的格子本轮没花时间）', () => {
    const cmds = [{ id: 'cmd-run:x', action: 'run' }, { id: 'cmd-read:a', action: 'read' }]
    const cells = buildCommandCellResults(cmds, takeCommandCellFacts(cmds),
      new Map([['cmd-run:x', 12]]))
    assert.equal(cells[0].elapsed_ms, 12)
    assert.ok(!('elapsed_ms' in cells[1]))
  })

  test('没 id 的格子仍然进明细（只有 id/action 两键），enumerated 由那一条另行如实报 false', () => {
    const cells = buildCommandCellResults([{ action: 'read' }], new Map(), new Map())
    assert.deepEqual(cells, [{ action: 'read' }])
    assert.equal(JSON.parse(buildCommandResultsMeta('s', { results: cells, enumerated: false })
      .slice(6, -1)).enumerated, false)
  })
})

describe('cmdCellFacts 生命周期：批次是唯一消费者，取完即清', () => {
  test('take 之后账里没有这一条（防跨批残留与无界增长）', () => {
    recordCommandCellFact('cmd-run:x', { exit_code: 1, timed_out: true })
    assert.equal(cmdCellFacts.size, 1)
    takeCommandCellFacts([{ id: 'cmd-run:x' }])
    assert.equal(cmdCellFacts.size, 0)
  })

  test('无 id 的记录被丢弃（那格本来就没法指认，也不许占住别人的键）', () => {
    recordCommandCellFact(undefined, { exit_code: 1 })
    recordCommandCellFact('', { exit_code: 1 })
    assert.equal(cmdCellFacts.size, 0)
  })

  test('同 id 二次记录是合并而不是覆盖（先记 exit_code 再记 timed_out 都留得住）', () => {
    recordCommandCellFact('cmd-run:x', { exit_code: 3 })
    recordCommandCellFact('cmd-run:x', { timed_out: true })
    assert.deepEqual(cmdCellFacts.get('cmd-run:x'), { exit_code: 3, timed_out: true })
  })
})

// [返工 R3·枚48 / #175（候选 #173）] 端侧把"sidecar 没回退出码"折成 exit=0 —— 一个假 0 同时说进
// 正文（[exit=0]）与逐格账（exit_code:0），服务端"没有标记 = 判不了成败（不等于失败）"那一支永不被喂到。
describe('readRunCell：没回退出码 = 不知道，两个消费者一起如实', () => {
  test('归一只认真整数：缺失/字符串/NaN/小数都成 null（不许折成 0）', () => {
    assert.equal(normalizeRunExitCode(0), 0)
    assert.equal(normalizeRunExitCode(127), 127)
    assert.equal(normalizeRunExitCode(undefined), null)
    assert.equal(normalizeRunExitCode(null), null)
    assert.equal(normalizeRunExitCode('0'), null)
    assert.equal(normalizeRunExitCode(NaN), null)
    assert.equal(normalizeRunExitCode(1.5), null)
  })

  test('正文三档：真退出码 / 被等待上限杀死 / 那一格不在场（unknown 不是失败，是判不了）', () => {
    assert.equal(runOutputMarker(0, false), '\n[exit=0]')
    assert.equal(runOutputMarker(2, false), '\n[exit=2]')
    assert.equal(runOutputMarker(null, false), '\n[exit=unknown]')
    assert.equal(runOutputMarker(null, true), '\n[Execution timed out]')
    assert.equal(runOutputMarker(1, true), '\n[Execution timed out]',
      '被杀那一格优先：编出来的 exit=1 会把"等待上限太短"这条出路说没')
  })

  test('一次调用同时给两个消费者：body 与 fact 不许分叉（#163 同源立场）', () => {
    const missing = readRunCell('BUILD FAILURE', undefined, false)
    assert.equal(missing.body, 'BUILD FAILURE\n[exit=unknown]')
    assert.deepEqual(missing.fact, { timed_out: false })
    assert.ok(!('exit_code' in missing.fact),
      '那一格缺失时 exit_code 键不许上去 —— null 会被后端"含 exit_code 且不为 0 = 失败"的字符串兜底读成失败')

    const real = readRunCell('ok', 0, false)
    assert.deepEqual(real.fact, { exit_code: 0, timed_out: false })
    assert.equal(real.body, 'ok\n[exit=0]')
    assert.equal(readRunCell('k', 137, false).body, 'k\n[exit=137]')
  })

  test('output 的形状与今天一致（非字符串转字符串、undefined/0 都成空串），本枚只动退出码那一格', () => {
    assert.equal(readRunCell(undefined, 0, false).body, '\n[exit=0]')
    assert.equal(readRunCell(0, 0, false).body, '\n[exit=0]')
    assert.equal(readRunCell('a\nb', 0, false).body, 'a\nb\n[exit=0]')
  })

  test('timed_out 只收真 true：字符串 "false" 不算被杀（与逐格账同一把刀）', () => {
    assert.equal(readRunCell('x', 0, 'false').body, 'x\n[exit=0]')
    assert.deepEqual(readRunCell('x', 0, 'false').fact, { exit_code: 0, timed_out: false })
    assert.equal(readRunCell('x', undefined, true).body, 'x\n[Execution timed out]')
  })

  test('逐格账接得上：unknown 那一格进 META 时只带 timed_out，明细里不会出现假 0', () => {
    const cmd = { id: 'cmd-run:x', action: 'run' }
    recordCommandCellFact(cmd.id, { action: cmd.action, ...readRunCell('x', undefined, false).fact })
    const cells = buildCommandCellResults([cmd], takeCommandCellFacts([cmd]), new Map())
    assert.deepEqual(cells, [{ id: 'cmd-run:x', action: 'run', timed_out: false }])
    assert.ok(!buildCommandResultsMeta('s', { results: cells, enumerated: true }).includes('"exit_code"'))
  })
})

describe('两个消费者同源：谁都不许再自己折一次退出码', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const consumers = [
    ['WorkspacePanel.jsx', path.join(here, '..', 'components', 'WorkspacePanel.jsx')],
    ['real-session-driver.mjs',
      path.join(here, '..', '..', '..', 'scripts', 'dogfood', 'real-session-driver.mjs')],
  ]
  for (const [name, file] of consumers) {
    const src = fs.readFileSync(file, 'utf-8')
    test(`${name} 用 readRunCell，且不再留一份本地折叠`, () => {
      assert.ok(src.includes('readRunCell'), `${name} 必须用同一份实现拿这一格`)
      assert.ok(!/=== 'number' \? [\w.]+ : 0/.test(src),
        `${name} 里不许再折一次：缺失折成 0 就是 #173 那个假 0`)
      assert.ok(!/function formatRunOutput/.test(src),
        `${name} 里那份本地正文拼装要删干净，否则两处形状会分叉`)
      assert.ok(!src.includes('[exit='),
        `${name} 里不许出现第二个写 [exit=…] 的地方：那一格的形状只在 readRunCell 一处`)
    })
  }
})
