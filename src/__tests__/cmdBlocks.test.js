import { parseAllCmdBlocks, scanBraceEnd, parseCompleteCmdBlocksStreaming, stripCmdBlocks } from '../utils/cmdBlocks'

/**
 * S2: 锁住 __CMD__{...} 解析器的契约。
 * 一旦三处共用 parser 后必须保证跨场景行为一致。
 */

describe('S2: __CMD__{} 共享解析器', () => {
  test('空文本 → 空数组', () => {
    expect(parseAllCmdBlocks('')).toEqual([])
    expect(parseAllCmdBlocks(null)).toEqual([])
    expect(parseAllCmdBlocks(undefined)).toEqual([])
    expect(parseAllCmdBlocks(123)).toEqual([])
  })

  test('无 __CMD__ 标记 → 空数组', () => {
    expect(parseAllCmdBlocks('hello world')).toEqual([])
  })

  test('单块基本解析', () => {
    const text = 'before __CMD__{"id":"c1","action":"read","path":"X.java"} after'
    const blocks = parseAllCmdBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cmd).toEqual({ id: 'c1', action: 'read', path: 'X.java' })
    expect(blocks[0].start).toBe(7)
    expect(blocks[0].end).toBe(text.length - 5)
  })

  test('多块顺序解析', () => {
    const text = '__CMD__{"id":"a"} text __CMD__{"id":"b","nested":{"x":1}} end'
    const blocks = parseAllCmdBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].cmd.id).toBe('a')
    expect(blocks[1].cmd.id).toBe('b')
    expect(blocks[1].cmd.nested.x).toBe(1)
  })

  test('JSON 字符串内的大括号不打断 brace 计数', () => {
    const text = '__CMD__{"id":"x","msg":"hello } world {"}'
    const blocks = parseAllCmdBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cmd.msg).toBe('hello } world {')
  })

  test('JSON 字符串内的转义引号正确处理', () => {
    const text = '__CMD__{"id":"x","msg":"he said \\"hi\\""}'
    const blocks = parseAllCmdBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cmd.msg).toBe('he said "hi"')
  })

  test('不完整块 → 流式解析安全停止', () => {
    const text = '__CMD__{"id":"x",'
    const blocks = parseCompleteCmdBlocksStreaming(text)
    expect(blocks).toEqual([])
  })

  test('完整块 + 不完整尾部', () => {
    const text = '__CMD__{"id":"a"} __CMD__{"id":"b"'
    const blocks = parseCompleteCmdBlocksStreaming(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cmd.id).toBe('a')
  })

  test('损坏 JSON → 跳过该块', () => {
    const text = '__CMD__{not valid json} __CMD__{"id":"ok"}'
    const blocks = parseAllCmdBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cmd.id).toBe('ok')
  })

  test('__CMD__ 后无 { → 跳过', () => {
    const text = 'plain __CMD__ text __CMD__{"id":"x"}'
    const blocks = parseAllCmdBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cmd.id).toBe('x')
  })

  test('stripCmdBlocks 剥离所有 __CMD__ 块', () => {
    const text = 'pre __CMD__{"id":"a"} mid __CMD__{"id":"b"} post'
    expect(stripCmdBlocks(text)).toBe('pre  mid  post')
  })

  test('scanBraceEnd 基础', () => {
    expect(scanBraceEnd('{"a":1}', 0)).toBe(6)
    expect(scanBraceEnd('{"a":{"b":2}}', 0)).toBe(11)
    expect(scanBraceEnd('{"a":1', 0)).toBe(-1)
    expect(scanBraceEnd('xx{', 2)).toBe(-1)
  })
})
