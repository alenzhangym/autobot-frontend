/**
 * [L0 收口] 能力清单与前端实际会执行的动作必须一致。
 *
 * 为什么值得钉：清单是后端**发命令之前**唯一的依据（`client_info.features`）。列了一个前端不认识的
 * 动作，后端就会以为"这只手在"并发的走过去，收到的只是 `unsupported_action` —— 比清单缺失更坏，
 * 因为它把一次本可以事前避免的失败换成一轮空转。2026-10-02 就写错过一次（`depgraph` 其实由后端
 * ServerSideCommandResolver 就地解析，前端没有对应 case）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRONTEND_CAPABILITIES } from '../runtime/frontendCapabilities.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const panelSrc = fs.readFileSync(
  path.join(here, '..', 'components', 'WorkspacePanel.jsx'), 'utf-8')

test('清单里没有重复项, 且都是非空字符串', () => {
  const seen = new Set()
  for (const c of FRONTEND_CAPABILITIES) {
    assert.equal(typeof c, 'string')
    assert.ok(c.length > 0)
    assert.ok(!seen.has(c), `重复的能力名: ${c}`)
    seen.add(c)
  }
})

test('清单里每一项在 WorkspacePanel 都有对应 case（否则后端会发出不可能成功的指令）', () => {
  const missing = FRONTEND_CAPABILITIES.filter(
    (c) => !new RegExp(`case\\s+'${c}'`).test(panelSrc))
  assert.deepEqual(missing, [], `这些能力前端执行不了: ${missing.join(', ')}`)
})

test('由后端就地解析的动作不许混进清单', () => {
  for (const serverSide of ['depgraph', 'graph', 'graph_search', 'focus', 'issues', 'skill']) {
    assert.ok(!FRONTEND_CAPABILITIES.includes(serverSide),
      `${serverSide} 由后端解析, 列进来等于谎报能力`)
  }
})

// ── [返工 R3·U1] 反方向：有 `case` 却没入册 ─────────────────────────────
//
// 今天这份文件只钉了「清单 → 有 case」这一向。**反方向没有检查**：
// 往 `executeSingleCommand` 加一个 `case` 却忘了入清单时，一例都不红。
// 后果按族不同，所以下面分成两组，各组说各自那句（不许折成一句吓人的话）：
//   · **手令那一族**（后端 `CodeAnalysisAgent.analysisCmdActions()`，见 `:3230-3234`）
//     —— 后端发前会读 `clientSupports`（`:3440`）：漏报＝**这只手永远发不出去**，
//     而交付里出现的是 `[能力不支持]`，读起来像"这台机器没这个能力"。
//   · **别的通道 / 服务端就地解析那一族** —— 铸卡那一条腿**不读**清单，漏报不致命，
//     只是环境简报里不提这只手；仍要明写"为什么不入册"，否则下一轮没人分得清。

/** 后端 `analysisCmdActions()` 的全部成员（门开时多一条 proc_port_probe）。权威在后端那一处。 */
const HAND_COMMAND_ACTIONS = [
  'env_probe', 'run', 'proc_start', 'proc_status', 'proc_stop', 'proc_sweep', 'proc_port_probe',
]

/**
 * 有 `case` 但**刻意不入册**的动作，每项带一行实测出处。
 * 加新 case 时：要么入册（首选），要么在这里加一项并写清是谁下发的。
 *
 * <p>这张表**只收有 case 的动作**。`depgraph` 不在表里不是遗漏：前端根本没有 `case 'depgraph'`
 * （2026-10-02 那次写错就是把后端就地解析的它列进了清单），它由上面那条"不许混进清单"用例管。</p>
 */
const OUT_OF_LIST_BY_DESIGN = {
  graph: '后端就地解析（cmd-graph: 在服务端填结果，不发到这只手）',
  graph_search: '后端就地解析（graph 族的子动作）',
  graph_callchain: '后端就地解析（graph 族的子动作）',
  graph_references: '后端就地解析（graph 族的子动作）',
  focus: '后端就地解析（cmd-focus: 状态格，不改宿主）',
  issues: '后端就地解析（cmd-issues: 同上）',
  skill: '后端就地解析（cmd-skill: 由服务端读技能正文）',
  diff: '不由分析通道铸卡（全仓 grep `cmd-diff:` = 0）；由别的通道/就地解析处理',
  scan: '不由能力闸管辖：后端只在手令族读清单（cmd-scan: 那条腿不经 clientSupports）',
  search: '不由能力闸管辖：全仓 grep `cmd-search:` = 0，属别的通道',
  search_replace: '写通道那一族的动作（ImplementationService / 语言适配器），不读这份清单',
  mkdir: '写通道那一族（cmd-mkdir: 出自 ImplementationService/适配器），不读这份清单',
  cp: '写通道那一族（cmd-cp: 同上），不读这份清单',
  network: '写通道/沙箱那一族（CommandSpec / SequentialExecutionStrategy），不读这份清单',
}

// 字符集要宽容：只认 `[a-z_]` 的话，一个带数字/大写的 case 名会被**静默跳过**，
// 反向用例就漏抓"新加手没入册"——这把刀第一次打就是这样打空的（返工 R3·U1 奖状里记着）。
const caseNames = (src) => [...src.matchAll(/case\s+'([A-Za-z0-9_]+)'/g)].map((m) => m[1])

test('手令族（后端会读 clientSupports 的那一族）逐项必须在清单里 —— 漏报＝那只手永远发不出去', () => {
  const missing = HAND_COMMAND_ACTIONS.filter((a) => !FRONTEND_CAPABILITIES.includes(a))
  assert.deepEqual(missing, [],
    `这些手令动作前端会做却没上报，后端 clientSupports 会把它拒成"能力不支持": ${missing.join(', ')}`)
})

test('每个 case 要么入册，要么在"刻意不入册"表里带一句理由 —— 抓"新加手忘了入册"', () => {
  const listed = new Set(FRONTEND_CAPABILITIES)
  const unaccounted = caseNames(panelSrc)
    .filter((c) => !listed.has(c) && !(c in OUT_OF_LIST_BY_DESIGN))
    .sort()
  assert.deepEqual(unaccounted, [],
    `这些动作前端认得却没入册，也没有一句"谁下发的"留痕: ${unaccounted.join(', ')}`)
})

test('不入册表里的每一项必须真的有对应 case（防止表里留着早已删掉的手）', () => {
  const stale = Object.keys(OUT_OF_LIST_BY_DESIGN).filter((c) => !panelSrc.includes(`case '${c}'`))
  assert.deepEqual(stale, [], `这些项已没有对应 case，该从表里删掉: ${stale.join(', ')}`)
})

