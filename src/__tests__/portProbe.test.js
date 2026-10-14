// [F72·枚23/枚26] 端口真探的纯函数：把三种通道的监听表读成"端口 → pid"，以及端口号的收口。
// 只钉纯函数 —— 真枚举那一步在 sidecar 里由 powershell/ss/netstat 完成（与 processGroup.test.js 同一口径）。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePort, parseListenTable } from '../runtime/portProbe.js'

describe('normalizePort：判不了就不探（绝不拿猜出来的端口去问盘）', () => {
  test('数字与字符串都收，两侧空白剥掉', () => {
    assert.equal(normalizePort('8081'), 8081)
    assert.equal(normalizePort(9527), 9527)
    assert.equal(normalizePort('  80  '), 80)
  })
  test('非端口形状一律 null（含越界、小数、带协议前缀、空）', () => {
    for (const bad of ['', '   ', null, undefined, 'abc', '0', '70000', '8081.5', ':8081', '8081/tcp']) {
      assert.equal(normalizePort(bad), null, `${JSON.stringify(bad)} 不该被当成端口`)
    }
  })
})

describe('parseListenTable：Windows CIM（LocalPort<TAB>OwningProcess）', () => {
  test('同端口的多个 pid 并进来，认不出的行跳过而不猜', () => {
    const t = parseListenTable('8081\t2460\n9527\t3001\n9527\t3002\n\n junk line\n\t\n', 'nettcp')
    assert.deepEqual([...t.keys()].sort((a, b) => a - b), [8081, 9527])
    assert.deepEqual(t.get(8081), [2460])
    assert.deepEqual(t.get(9527), [3001, 3002])
  })
  test('没有 pid 列时端口仍然算在听（pid 空不代表没在听）', () => {
    const t = parseListenTable('8081\t\n', 'nettcp')
    assert.deepEqual(t.get(8081), [])
  })
})

describe('parseListenTable：ss -ltnH', () => {
  test('v4/v6/通配三种本地地址形态都取到端口，pid 从 users:(...) 抠', () => {
    const out = [
      'LISTEN 0 4096    0.0.0.0:8081 0.0.0.0:* users:(("java",pid=2460,fd=18))',
      'LISTEN 0 511        [::]:9527    [::]:* users:(("node",pid=3001,fd=19))',
      'LISTEN 0 128            *:3000   *:*',
    ].join('\n')
    const t = parseListenTable(out, 'ss')
    assert.deepEqual(t.get(8081), [2460])
    assert.deepEqual(t.get(9527), [3001])
    assert.deepEqual(t.get(3000), [])
  })
})

describe('parseListenTable：netstat（Linux 与 macOS 两种列形）', () => {
  test('只认 LISTEN 行；没有 pid 列就不编 pid', () => {
    const linux = [
      'Active Internet connections (including servers) identifier',
      'Proto Recv-Q Send-Q Local Address          Foreign Address        State',
      'tcp        0      0 0.0.0.0:8081           0.0.0.0:*              LISTEN',
      'tcp        0      0 127.0.0.1:5432         0.0.0.0:*              LISTEN',
      //   这条 ESTABLISHED 的**本地端口不在监听表里**：筛掉 LISTEN 的那把刀只有在这种数据上才咬得动
      //   （旧数据用的是 5432，去掉筛选也得到同一个键 → 变异体等价，2026-10-14 实测过）
      'tcp        0      0 127.0.0.1:54999        127.0.0.1:49999        ESTABLISHED',
    ].join('\n')
    const t = parseListenTable(linux, 'netstat')
    assert.deepEqual([...t.keys()].sort((a, b) => a - b), [5432, 8081])
    assert.deepEqual(t.get(8081), [])
    const bsd = 'tcp4       0      0  *.9527                 *.*                    LISTEN'
    assert.deepEqual([...parseListenTable(bsd, 'netstat').keys()], [9527])
  })
})

describe('三态的根：表里没有 ≠ 枚举失败', () => {
  test('整表为空（枚举空回）与"枚举到别的端口"在解析层是同一件事 —— 分诊由调用方按 enumerated 判', () => {
    assert.equal(parseListenTable('', 'nettcp').size, 0)
    assert.equal(parseListenTable('8081\t2460', 'nettcp').get(9527), undefined)
  })
})
