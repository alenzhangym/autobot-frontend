/**
 * [方案C] processGroup 的「OS 级兜底查杀」纯函数。
 *
 * 停不掉时的兜底依赖两件纯逻辑：①命令行是否引用该任务的 cwd（决定"是不是同一个项目的孤儿"）
 * ②进程表解析。这里只钉纯函数，不真杀任何进程 —— 真杀那一步在 sidecar 里由 taskkill 完成。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchesCwd, parseProcTable } from '../runtime/processGroup.js'

describe('processGroup: matchesCwd', () => {
  test('Windows 反斜杠/大小写归一：命令行引用该 cwd 即命中', () => {
    const cmd = 'java.exe -cp E:\\code\\litemall-master\\litemall-admin-api\\target\\classes;... org.linlinjava.litemall.admin.Application'
    assert.equal(matchesCwd(cmd, 'E:\\code\\litemall-master'), true)
    assert.equal(matchesCwd(cmd, 'e:/code/LITEMALL-MASTER'), true)
  })

  test('别的项目（含 autobot 后端自己）不命中', () => {
    const backend = 'java -jar E:\\code\\autobot\\java-backend\\target\\autobot-backend-1.0.1.jar'
    assert.equal(matchesCwd(backend, 'E:\\code\\litemall-master'), false)
  })

  test('空 / null cwd → 永不命中（宁可不杀）', () => {
    assert.equal(matchesCwd('anything', ''), false)
    assert.equal(matchesCwd('anything', null), false)
    assert.equal(matchesCwd('anything', undefined), false)
  })

  test('cwd 尾部斜杠不影响命中', () => {
    assert.equal(matchesCwd('/opt/app/svc/run.sh', '/opt/app/svc/'), true)
  })
})

describe('processGroup: parseProcTable', () => {
  test('Windows：PID<TAB>命令行', () => {
    assert.deepEqual(parseProcTable('1234\tjava -jar a.jar\n'),
      [{ pid: 1234, commandLine: 'java -jar a.jar' }])
  })

  test('POSIX：前导空白 + 空格分隔', () => {
    assert.deepEqual(parseProcTable('  4321 java -jar b.jar\n'),
      [{ pid: 4321, commandLine: 'java -jar b.jar' }])
  })

  test('空表 / 垃圾行 / 非数字 pid 全部忽略', () => {
    assert.deepEqual(parseProcTable(''), [])
    assert.deepEqual(parseProcTable('not a line\n\n'), [])
    assert.deepEqual(parseProcTable('abc java\n'), [])
  })
})