// [F72·#182] 这条 import 一直是 `../utils/cmdBlocks`（无扩展名）—— 打包器能解析，node ESM 不能，
// 所以这份用例从写下那天起一条都没跑过（ERR_MODULE_NOT_FOUND，不是断言红）。
// 同一次接回还换掉了断言层：原文用的是 jest 的 expect().toBe()，本仓跑的是 node:test + assert，
// `expect` 从来不存在 —— 也就是说即使模块名修好，这 12 条也只会红在 ReferenceError 上。
import { parseAllCmdBlocks, scanBraceEnd, parseCompleteCmdBlocksStreaming, stripCmdBlocks } from '../utils/cmdBlocks.js'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

/**
 * S2: 锁住 __CMD__{...} 解析器的契约。
 * 一旦三处共用 parser 后必须保证跨场景行为一致。
 */

describe('S2: __CMD__{} 共享解析器', () => {
  test('空文本 / 非字符串 → 空数组（不许凭空造一条指令）', () => {
    assert.deepEqual(parseAllCmdBlocks(''), [])
    assert.deepEqual(parseAllCmdBlocks(null), [])
    assert.deepEqual(parseAllCmdBlocks(undefined), [])
    assert.deepEqual(parseAllCmdBlocks(123), [])
  })

  test('无 __CMD__ 标记 → 空数组', () => {
    assert.deepEqual(parseAllCmdBlocks('hello world'), [])
  })

  test('单块基本解析：start 指向标记，end 是块后的下一格（ exclusive ）', () => {
    const text = 'before __CMD__{"id":"c1","action":"read","path":"X.java"} after'
    const blocks = parseAllCmdBlocks(text)
    assert.equal(blocks.length, 1)
    assert.deepEqual(blocks[0].cmd, { id: 'c1', action: 'read', path: 'X.java' })
    assert.equal(blocks[0].start, 7)
    // 原文写的是 text.length - 5，逐字对过实现后是 -6：'}' 在下标 length-7，end 记的是它后面那一格。
    // 这一格是调用方切片用的（stripCmdBlocks 就按它拼），所以要钉住而不是"大概"。
    assert.equal(blocks[0].end, text.length - 6)
    assert.equal(text.slice(blocks[0].start, blocks[0].end), '__CMD__{"id":"c1","action":"read","path":"X.java"}')
  })

  test('多块顺序解析（嵌套对象原样进 cmd）', () => {
    const text = '__CMD__{"id":"a"} text __CMD__{"id":"b","nested":{"x":1}} end'
    const blocks = parseAllCmdBlocks(text)
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0].cmd.id, 'a')
    assert.equal(blocks[1].cmd.id, 'b')
    assert.equal(blocks[1].cmd.nested.x, 1)
  })

  test('JSON 字符串内的大括号不打断 brace 计数', () => {
    const text = '__CMD__{"id":"x","msg":"hello } world {"}'
    const blocks = parseAllCmdBlocks(text)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].cmd.msg, 'hello } world {')
  })

  test('JSON 字符串内的转义引号正确处理', () => {
    const text = '__CMD__{"id":"x","msg":"he said \\"hi\\""}'
    const blocks = parseAllCmdBlocks(text)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].cmd.msg, 'he said "hi"')
  })

  test('不完整块 → 流式解析安全停止（不报错，等下一批 token）', () => {
    assert.deepEqual(parseCompleteCmdBlocksStreaming('__CMD__{"id":"x",'), [])
  })

  test('完整块 + 不完整尾部：只交已完整的那一条', () => {
    const blocks = parseCompleteCmdBlocksStreaming('__CMD__{"id":"a"} __CMD__{"id":"b"')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].cmd.id, 'a')
  })

  test('损坏 JSON → 跳过该块，后面那条照收', () => {
    const blocks = parseAllCmdBlocks('__CMD__{not valid json} __CMD__{"id":"ok"}')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].cmd.id, 'ok')
  })

  test('__CMD__ 后不是 { → 跳过（不许把散文里的标记当指令）', () => {
    const blocks = parseAllCmdBlocks('plain __CMD__ text __CMD__{"id":"x"}')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].cmd.id, 'x')
  })

  test('stripCmdBlocks 只剥指令块，给人看的那一段逐字留着', () => {
    assert.equal(stripCmdBlocks('pre __CMD__{"id":"a"} mid __CMD__{"id":"b"} post'), 'pre  mid  post')
    assert.equal(stripCmdBlocks('没有指令块'), '没有指令块')
    assert.equal(stripCmdBlocks(null), null, '非字符串原样交回，不许折成空串')
  })

  test('scanBraceEnd：配对返回下标，不配对返回 -1', () => {
    assert.equal(scanBraceEnd('{"a":1}', 0), 6)
    // 原文写的是 11 —— 逐字数过 `{"a":{"b":2}}`：外层 '}' 在 12。这条旧断言从来没跑过，所以错了也没人知道。
    assert.equal(scanBraceEnd('{"a":{"b":2}}', 0), 12)
    assert.equal(scanBraceEnd('{"a":1', 0), -1)
    assert.equal(scanBraceEnd('xx{', 2), -1)
    assert.equal(scanBraceEnd('{"a":1}', 1), -1, 'openIdx 指的不是 { 就不算一次扫描')
  })
})
