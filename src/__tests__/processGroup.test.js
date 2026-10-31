/**
 * [方案C] processGroup 的「OS 级兜底查杀」纯函数。
 *
 * 停不掉时的兜底依赖两件纯逻辑：①命令行是否引用该任务的 cwd（决定"是不是同一个项目的孤儿"）
 * ②进程表解析。这里只钉纯函数，不真杀任何进程 —— 真杀那一步在 sidecar 里由 taskkill 完成。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchesCwd, matchesExcludeMarker, parseProcTable, selectSweepTargets, isUnderPath,
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

  // [C·2026-10-31 归属判据·收紧] 子串 → 完整路径 token
  test('[C·2026-10-31] 前缀共享的别的项目不再命中（E:\\code\\autobot-fork ≠ E:\\code\\autobot）', () => {
    assert.equal(matchesCwd('node E:\\code\\autobot-fork\\app.js', 'E:\\code\\autobot'), false)
    assert.equal(matchesCwd('node E:\\code\\autobotics\\app.js', 'E:\\code\\autobot'), false)
    assert.equal(matchesCwd('node /opt/app/svcs/run.sh', '/opt/app/svc'), false)
  })

  test('[C·2026-10-31] 同名前缀的**文件**不算该目录（autobot.jar）', () => {
    assert.equal(matchesCwd('java -jar E:\\code\\autobot.jar', 'E:\\code\\autobot'), false)
  })

  test('[C·2026-10-31] 作为独立参数出现（引号 / = / 结尾）仍命中', () => {
    assert.equal(matchesCwd('node --project=E:\\code\\autobot', 'E:\\code\\autobot'), true)
    assert.equal(matchesCwd('"E:\\code\\autobot"', 'E:\\code\\autobot'), true)
    assert.equal(matchesCwd('cd /opt/app/svc && ./run.sh', '/opt/app/svc'), true)
  })

  test('[C·2026-10-31] 目录之下的子路径命中（分隔符之后才算）', () => {
    assert.equal(matchesCwd('node E:\\code\\autobot\\autobot-frontend\\server.js', 'E:\\code\\autobot'), true)
    assert.equal(matchesCwd('node /opt/app/svc/sub/run.sh', '/opt/app/svc'), true)
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

  // [C·2026-10-31] 第三级证据：命令行里没有工作区路径，但有"确属本项目"的强证据
  test('[C·2026-10-31] ownedPids 强证据：命令行里没有该目录也能认（tree / port）', () => {
    const procs = [
      { pid: 700, commandLine: 'node vite.mjs' },
      { pid: 701, commandLine: 'node server.js' },
      { pid: 702, commandLine: 'node unrelated.js' },
    ]
    const hit = selectSweepTargets(procs, {
      anchors: ANCHORS, ownedPids: new Map([[700, 'tree'], [701, 'port']]),
    })
    assert.deepEqual(hit.map((p) => [p.pid, p.evidence]), [[700, 'tree'], [701, 'port']])
    assert.equal(hit.some((p) => p.pid === 702), false)   // 无证据 → 不猜
  })

  test('[C·2026-10-31] 强证据也要过 exclude / onlyPids 闸（不是"有证据就特权杀"）', () => {
    const procs = [
      { pid: 700, commandLine: 'node vite.mjs' },
      { pid: 701, commandLine: 'node server.js' },
    ]
    const hit = selectSweepTargets(procs, {
      anchors: [], excludePids: [700], onlyPids: [700, 701],
      ownedPids: new Map([[700, 'tree'], [701, 'tree']]),
    })
    assert.deepEqual(hit.map((p) => p.pid), [701])
  })

  test('[C·2026-10-31] 每条目标都带 evidence 字段（path 是弱证据，另外两级是强证据）', () => {
    const hit = selectSweepTargets(PROCS, { anchors: ANCHORS })
    assert.deepEqual(hit.map((p) => p.evidence), ['path', 'path', 'path'])
  })
})

describe('processGroup: isUnderPath', () => {
  test('同级前缀不算之下（autobot-x 不在 autobot 之下）', () => {
    assert.equal(isUnderPath('E:\\code\\autobot-x', 'E:\\code\\autobot'), false)
    assert.equal(isUnderPath('/opt/app/svcs', '/opt/app/svc'), false)
  })

  test('自身 / 真子目录 / 分隔符与大小写归一都算之下', () => {
    assert.equal(isUnderPath('E:\\code\\autobot', 'E:\\code\\autobot'), true)
    assert.equal(isUnderPath('e:/code/AUTOBOT', 'E:\\code\\autobot'), true)
    assert.equal(isUnderPath('E:\\code\\autobot\\java-backend', 'E:\\code\\autobot'), true)
    assert.equal(isUnderPath('/opt/app/svc/sub', '/opt/app/svc'), true)
  })

  test('空值一律 false（判不了就不认之下）', () => {
    assert.equal(isUnderPath('', 'E:\\code\\autobot'), false)
    assert.equal(isUnderPath('E:\\code\\autobot', ''), false)
    assert.equal(isUnderPath(null, null), false)
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