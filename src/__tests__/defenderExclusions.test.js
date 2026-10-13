/**
 * defenderExclusions 纯逻辑与项目集持久化测试。
 *
 * 为什么要钉：排除项是否"已覆盖"直接决定 sidecar 会不会弹 UAC、会不会谎报成功。判错两头的代价
 * 不对称 —— 误判"已覆盖"会让写腿继续吃 EPERM；误判"未覆盖"会无谓弹框。脚本拼装更要防注入。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  normalizeForCompare, isCovered, missingProjects, psSingleQuote,
  buildAddScript, buildElevateScript, parseExclusionsJson,
  loadProjects, saveProjects, registerProject,
} from '../runtime/defenderExclusions.js'

test('normalizeForCompare: 统一分隔符/去尾斜杠/小写', () => {
  assert.equal(normalizeForCompare('E:\\Code\\Foo\\'), 'e:/code/foo')
  assert.equal(normalizeForCompare('e:/code/foo'), 'e:/code/foo')
  assert.equal(normalizeForCompare(''), '')
})

test('isCovered: 同路径 / 祖先目录算覆盖, 兄弟目录不算', () => {
  const ex = ['E:\\code', 'C:\\Users\\me\\proj']
  assert.equal(isCovered('E:\\code\\litemall-master', ex), true) // 祖先覆盖
  assert.equal(isCovered('C:\\Users\\me\\proj', ex), true)       // 自身
  assert.equal(isCovered('C:\\Users\\me\\proj2', ex), false)     // 兄弟(不是前缀+分隔符)
  assert.equal(isCovered('D:\\other', ex), false)
  assert.equal(isCovered('E:\\code', ex), true)
})

test('isCovered: 大小写与尾斜杠不敏感', () => {
  assert.equal(isCovered('E:\\CODE\\FOO', ['e:\\code\\foo']), true)
  assert.equal(isCovered('e:\\code\\foo\\', ['E:\\code\\foo']), true)
})

test('isCovered: 排除项是文件路径时不会误覆盖同名目录前缀', () => {
  // 排除 C:\a\b.txt 不该覆盖 C:\a\b.txtdir
  assert.equal(isCovered('C:\\a\\b.txtdir', ['C:\\a\\b.txt']), false)
})

test('missingProjects: 只回未覆盖的, 且归一化去重', () => {
  const projects = ['E:\\code\\a', 'E:\\code\\b', 'e:/code/a/', '']
  const ex = ['E:\\code\\a']
  assert.deepEqual(missingProjects(projects, ex), ['E:\\code\\b'])
})

test('psSingleQuote: 单引号翻倍, 杜绝注入', () => {
  assert.equal(psSingleQuote("a'b"), "'a''b'")
  assert.equal(psSingleQuote('E:\\code\\x'), "'E:\\code\\x'")
})

test('buildAddScript: 批量一条命令, 路径逐个转义', () => {
  const s = buildAddScript(["E:\\a", "F:\\b'c"], 'C:\\r.txt')
  assert.match(s, /Add-MpPreference -ExclusionPath @\('E:\\a','F:\\b''c'\)/)
  assert.match(s, /C:\\r\.txt/)
  // 只有一条 Add-MpPreference（不是每个路径一次 UAC）
  assert.equal((s.match(/Add-MpPreference/g) || []).length, 1)
})

test('buildElevateScript: 引用内层脚本, 用 RunAs', () => {
  const s = buildElevateScript('C:\\tmp\\inner.ps1', 'C:\\tmp\\r.txt')
  assert.match(s, /-Verb RunAs/)
  assert.match(s, /inner\.ps1/)
})

test('parseExclusionsJson: 数组 / 单值 / 空 / 畸形', () => {
  assert.deepEqual(parseExclusionsJson('["E:\\\\a","F:\\\\b"]'), ['E:\\a', 'F:\\b'])
  assert.deepEqual(parseExclusionsJson('"E:\\\\solo"'), ['E:\\solo'])
  assert.deepEqual(parseExclusionsJson(''), [])
  assert.deepEqual(parseExclusionsJson('   '), [])
  assert.deepEqual(parseExclusionsJson('not json'), [])
  assert.deepEqual(parseExclusionsJson('[1,2]'), [])
})

test('项目集持久化: 读写往返 + register 幂等去重', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'defender-test-'))
  const store = path.join(dir, 'nested', 'workspaces.json')
  try {
    assert.deepEqual(loadProjects(store), []) // 文件不存在 → []
    let list = registerProject(store, 'E:\\code\\a')
    assert.deepEqual(list, ['E:\\code\\a'])
    list = registerProject(store, 'E:\\CODE\\A\\')  // 归一化后同上 → 不重复
    assert.deepEqual(list, ['E:\\code\\a'])
    list = registerProject(store, 'E:\\code\\b')
    assert.deepEqual(list, ['E:\\code\\a', 'E:\\code\\b'])
    assert.deepEqual(loadProjects(store), ['E:\\code\\a', 'E:\\code\\b'])
    assert.deepEqual(registerProject(store, '   '), ['E:\\code\\a', 'E:\\code\\b']) // 空路径不动
    saveProjects(store, ['X:\\one'])
    assert.deepEqual(loadProjects(store), ['X:\\one'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})