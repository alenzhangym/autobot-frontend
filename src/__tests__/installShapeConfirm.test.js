/**
 * F47·C4 tests for install-shape confirmation.
 *
 * Invariant I-③1 (the one that matters this round): an install command NEVER
 * runs without a confirmation dialog — not because the backend remembered to
 * set `requires_confirmation`, but because the frontend re-checks the shape.
 * The __CMD__ body is now written by the LLM itself, so a missing field must
 * not silently become "auto-run".
 *
 * Also pinned: read-only `env_probe` is not a `run` command at all, so the
 * gate stays out of its way; and `mvn compile` / `npm test` (the whitelisted
 * verify shapes) must not be swept into the install bucket.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shouldRequireConfirmation, installShapeReason } from '../components/agentCommandSafety.js'

describe('installShapeReason — 动词明着是装的才拦', () => {
  const mustConfirm = [
    ['npm', ['ci']],
    ['npm', ['install']],
    ['pnpm', ['add', 'antd']],
    ['pip', ['install', '-r', 'requirements.txt']],
    ['python', ['-m', 'pip', 'install', '-r', 'requirements.txt']],
    ['winget', ['install', 'OpenJS.NodeJS.LTS']],
    ['brew', ['install', 'maven']],
    ['apt-get', ['install', '-y', 'openjdk-17-jdk']],
    ['mvn', ['-q', '-DskipTests', 'dependency:go-offline']],
    ['go', ['get', '-u', './...']],
  ]
  for (const [command, args] of mustConfirm) {
    test(`${command} ${args.join(' ')} → 必弹确认`, () => {
      assert.ok(installShapeReason(command, args), 'expected an install reason')
      // 关键: 不依赖后端那个字段
      const reason = shouldRequireConfirmation({
        action: 'run', id: 'cmd-setup-dep:s', command, args, requires_confirmation: false,
      })
      assert.ok(reason, 'install shape must prompt even with the flag absent/false')
    })
  }

  const mustNotBeInstall = [
    ['npm', ['test']],
    ['npm', ['run', 'dev']],
    ['mvn', ['-q', '-B', 'compile', '-DskipTests']],
    ['node', ['--version']],
    ['python', ['-m', 'pytest']],
  ]
  for (const [command, args] of mustNotBeInstall) {
    test(`${command} ${args.join(' ')} → 不算装东西`, () => {
      assert.equal(installShapeReason(command, args), null)
    })
  }
})

describe('env_probe / proc_status 不被确认门挡住（只读）', () => {
  test('env_probe 不是 run 动作, shouldRequireConfirmation 直接放行', () => {
    assert.equal(shouldRequireConfirmation({ action: 'env_probe', tools: ['node'] }), null)
    assert.equal(shouldRequireConfirmation({ action: 'proc_status' }), null)
  })
})
