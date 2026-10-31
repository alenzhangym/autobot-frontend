/**
 * [方案C] processGroup 的「OS 级兜底查杀」纯函数。
 *
 * 停不掉时的兜底依赖两件纯逻辑：①命令行是否引用该任务的 cwd（决定"是不是同一个项目的孤儿"）
 * ②进程表解析。这里只钉纯函数，不真杀任何进程 —— 真杀那一步在 sidecar 里由 taskkill 完成。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchesCwd, matchesExcludeMarker, parseProcTable, selectSweepTargets,
} from '../runtime/processGroup.js'

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

describe('processGroup: matchesExcludeMarker', () => {
  test('[C·2026-10-31] 命中标记 → 这条不许进候选（workspace 就是 autobot 仓库时保护后端自己）', () => {
    const backend = 'java -jar E:\\code\\autobot\\java-backend\\target\\autobot-backend-1.0.1.jar'
    // 反过来：matchesCwd 认为它属于这个工作区（真机事故的原因）
    assert.equal(matchesCwd(backend, 'E:\\code\\autobot'), true)
    assert.equal(matchesExcludeMarker(backend, ['E:/code/autobot/java-backend']), true)
    assert.equal(matchesExcludeMarker(backend, ['java-backend']), true)
  })

  test('大小写不敏感；标记两端的斜杠会被剥掉', () => {
    const cmd = 'node E:\\CODE\\AUTOBOT\\AUTOBOT-FRONTEND\\server.js'
    assert.equal(matchesExcludeMarker(cmd, ['\\code\\autobot\\autobot-frontend\\']), true)
    assert.equal(matchesExcludeMarker(cmd, ['/code/autobot/autobot-frontend']), true)
  })

  test('空标记表 / 空串标记 / 不相关标记 → 不排除（宁可不杀也不许误伤）', () => {
    assert.equal(matchesExcludeMarker('node server.js', []), false)
    assert.equal(matchesExcludeMarker('node server.js', null), false)
    assert.equal(matchesExcludeMarker('node server.js', ['', '   ']), false)
    assert.equal(matchesExcludeMarker('node server.js', ['other-project']), false)
  })
})

/**
 * [C·2026-10-31] 清扫目标的唯一一处判据。真杀那一步不可测（会杀本机进程），
 * 所以把"谁在名单里"提成纯函数单钉：四道闸缺任何一道都会重现当场事故（按 cwd 误杀后端）。
 */
describe('processGroup: selectSweepTargets', () => {
  const WS = 'E:\\code\\autobot'
  const ANCHORS = [WS, `${WS}\\autobot-frontend`, `${WS}\\java-backend`]
  const PROCS = [
    { pid: 111, commandLine: `node ${WS}\\autobot-frontend\\server.js` },
    { pid: 222, commandLine: `java -jar ${WS}\\java-backend\\target\\autobot.jar` },
    // 预览之后新起的（用户没见过的那一条）
    { pid: 333, commandLine: `node ${WS}\\autobot-frontend\\vite.mjs` },
    { pid: 444, commandLine: 'notepad.exe' },
    { pid: 555, commandLine: 'node E:\\code\\litemall\\litemall-admin\\server.js' },
  ]

  test('缺省（无确认名单）→ 按锚点全收，且自身/父进程永不在名单里', () => {
    const hit = selectSweepTargets(PROCS, { anchors: ANCHORS })
    assert.deepEqual(hit.map((p) => p.pid), [111, 222, 333])
    assert.equal(hit.some((p) => p.pid === process.pid), false)
    assert.equal(hit.some((p) => p.pid === process.ppid), false)
  })

  test('[C·2026-10-31] onlyPids 给定 → 只杀用户确认过的那一批', () => {
    const hit = selectSweepTargets(PROCS, { anchors: ANCHORS, onlyPids: [111, 222] })
    assert.deepEqual(hit.map((p) => p.pid), [111, 222])
    // 333 是预览之后新起的：用户没见过它 → 不许顺带杀掉
    assert.equal(hit.some((p) => p.pid === 333), false)
    // 444 不相关
    assert.equal(hit.some((p) => p.pid === 444), false)
  })

  test('onlyPids 里的 pid 也必须过归属闸（不能靠"用户点了头"就跨工作区杀）', () => {
    const hit = selectSweepTargets(PROCS, { anchors: ANCHORS, onlyPids: [444, 555] })
    assert.deepEqual(hit.map((p) => p.pid), [])
  })

  test('onlyPids 含自身 pid / excludePids 里 → 排除闸优先级更高', () => {
    const hit = selectSweepTargets(PROCS, {
      anchors: ANCHORS, excludePids: [111], onlyPids: [process.pid, 111, 222],
    })
    assert.deepEqual(hit.map((p) => p.pid), [222])
  })

  test('excludeMarkers → 整条排除（workspace 就是 autobot 仓库时保住后端自己）', () => {
    const hit = selectSweepTargets(PROCS, {
      anchors: ANCHORS, excludeMarkers: ['java-backend', 'autobot-frontend\\server.js'],
    })
    assert.deepEqual(hit.map((p) => p.pid), [333])
  })

  test('没给名单（undefined/非数组）→ 不设限（服务重启兜底等无确认流程照旧按 cwd 全收）', () => {
    for (const none of [undefined, null, '403']) {
      const hit = selectSweepTargets(PROCS, { anchors: ANCHORS, onlyPids: none })
      assert.deepEqual(hit.map((p) => p.pid), [111, 222, 333])
    }
  })

  test('[fail-safe] 给了名单但为空/全垃圾 → 一条都不杀（不许退化成盲扫全 cwd）', () => {
    for (const bad of [[], [0, -1, 'abc']]) {
      const hit = selectSweepTargets(PROCS, { anchors: ANCHORS, onlyPids: bad })
      assert.deepEqual(hit.map((p) => p.pid), [])
    }
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