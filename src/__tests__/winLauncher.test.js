/**
 * L1 tests for the Windows launcher resolver.
 *
 * The invariant that matters: mvn / npm / pnpm / yarn / npx are `.cmd` shims on Windows, and Node
 * (>=20.12) refuses to spawn them directly (EINVAL) while a bare name gives ENOENT. They only run
 * wrapped as `cmd.exe /d /s /c <name>`. These tests pin that mapping, the "refuse rather than
 * escape" rule, and the "can't tell ≠ not installed" separation.
 *
 * Platform-dependent assertions are gated on os.platform(): on non-Windows the resolver is a
 * pass-through by design, and we pin exactly that instead of skipping.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { hasCmdMeta, resolveLauncher } from '../runtime/winLauncher.js'

const IS_WIN = os.platform() === 'win32'

describe('hasCmdMeta — 元字符即拒（不是转义问题）', () => {
  const unsafe = ['a&&b', 'a|b', 'a%b%', 'a^b', 'a>b', 'a<b', 'a(b)', 'a\nb', 'a!b', 'say "hi"']
  for (const s of unsafe) {
    test(`${JSON.stringify(s)} → 含元字符`, () => assert.equal(hasCmdMeta(s), true))
  }
  const safe = ['mvn', 'npm.cmd', 'pnpm', 'node.exe', 'C:\\tools\\mvn.cmd', '']
  for (const s of safe) {
    test(`${JSON.stringify(s)} → 干净`, () => assert.equal(hasCmdMeta(s), false))
  }
  test('null / undefined 不当元字符', () => {
    assert.equal(hasCmdMeta(null), false)
    assert.equal(hasCmdMeta(undefined), false)
  })
})

describe('空命令一律 refuse（先于平台分支）', () => {
  for (const s of ['', '   ', null, undefined]) {
    test(`${JSON.stringify(s)} → refuse`, () => {
      const r = resolveLauncher(s)
      assert.equal(r.mode, 'refuse')
      assert.equal(r.reason, '空命令')
    })
  }
})

describe('win32 形态判定', { skip: !IS_WIN }, () => {
  test('裸命令 .cmd shim → 包 cmd.exe /d /s /c（argv 传参，不拼字符串）', () => {
    const r = resolveLauncher('mvn.cmd')
    assert.equal(r.mode, 'cmd')
    assert.equal(r.kind, 'cmd')
    assert.equal(path.basename(r.file).toLowerCase(), 'cmd.exe')
    assert.deepEqual(r.args, ['/d', '/s', '/c', 'mvn.cmd'])
    assert.equal(r.resolved, 'mvn.cmd')
  })

  test('.bat 与 .cmd 同等对待', () => {
    const r = resolveLauncher('gradlew.bat')
    assert.equal(r.mode, 'cmd')
    assert.deepEqual(r.args, ['/d', '/s', '/c', 'gradlew.bat'])
  })

  test('.exe 直连，绝不加一层 shell（少一个解析面）', () => {
    const r = resolveLauncher('java.exe')
    assert.equal(r.mode, 'direct')
    assert.equal(r.kind, 'exe')
    assert.equal(r.file, 'java.exe')
    assert.deepEqual(r.args, [])
  })

  test('含元字符 → refuse，不尝试转义', () => {
    const r = resolveLauncher('mvn && calc')
    assert.equal(r.mode, 'refuse')
    assert.match(r.reason, /元字符/)
  })

  test('带空格的 .cmd 路径 → refuse（cmd /s /c 的引号剥离会切断路径）', () => {
    const r = resolveLauncher('C:\\Program Files\\tool\\run.cmd')
    assert.equal(r.mode, 'refuse')
    assert.match(r.reason, /空格/)
  })

  test('PATH 上确实找不到 → notFound 标记（这是"真的没有"）', () => {
    const r = resolveLauncher('definitely-not-a-real-tool-xyz')
    assert.equal(r.mode, 'direct')
    assert.equal(r.notFound, true)
    assert.match(r.reason, /找不到/)
  })
})

describe('非 Windows：原样直连（这套只在 win32 上有必要）', { skip: IS_WIN }, () => {
  test('裸命令原样透传，不包 shell', () => {
    const r = resolveLauncher('mvn')
    assert.equal(r.mode, 'direct')
    assert.equal(r.file, 'mvn')
    assert.deepEqual(r.args, [])
  })
})