// [返工 R2·2.1] [META:{json}] 头与逐格原子事实的纯函数。
// 判据原文是"无 extra → 与今天逐字节一致"，刀①是"折批（写回 status）→ 必须被逐条用例红"。
// 抽成 runtime/commandResultsMeta.js 才钉得住（JSX 在 node --test 下编不动；
// 与 runtime/portProbe.js、runtime/procListen.js 同一口径）。
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCommandResultsMeta, buildCommandCellResults, isBatchEnumerated,
  recordCommandCellFact, takeCommandCellFacts, cmdCellFacts,
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
