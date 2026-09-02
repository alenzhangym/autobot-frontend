/**
 * P2-7 沙箱 OS 级强制 — sandboxExecutor 单测。
 * 覆盖设计文档 §5.1 阶段 1 验收: 本地/容器双路径、超时、路径映射。
 * 容器路径通过纯函数 buildDockerExecArgs / buildCreateContainerArgs 校验（无需真实 docker）。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  runInSandbox,
  runLocal,
  buildDockerExecArgs,
  buildCreateContainerArgs,
} from '../runtime/sandboxExecutor.js'

const NO_SANDBOX = { enabled: false }

describe('sandboxExecutor', () => {
  test('buildDockerExecArgs: 基础命令映射', () => {
    const argv = buildDockerExecArgs(
      { command: 'python', args: ['-c', 'print(1)'], cwd: 'C:/proj' },
      'autobot-runner-abc',
    )
    assert.deepEqual(argv, [
      'exec',
      '--workdir', '/workspace',
      '--env', 'AUTOBOT_CWD=C:/proj',
      'autobot-runner-abc',
      'python',
      '-c', 'print(1)',
    ])
  })

  test('buildDockerExecArgs: 宿主临时文件路径映射为 /workspace/<basename>', () => {
    const hostFile = 'C:\\proj\\.CodeAgent_run_123_ab12cd.py'
    const argv = buildDockerExecArgs(
      { command: 'python', args: [hostFile], cwd: 'C:/proj', hostTempFile: hostFile },
      'c',
    )
    assert.ok(argv.includes('/workspace/.CodeAgent_run_123_ab12cd.py'))
    assert.ok(!argv.includes(hostFile))
  })

  test('buildDockerExecArgs: 无临时文件时不改写参数', () => {
    const argv = buildDockerExecArgs(
      { command: 'node', args: ['-v'], cwd: '/home/u/p' },
      'c',
    )
    assert.deepEqual(argv.slice(0, 5), ['exec', '--workdir', '/workspace', '--env', 'AUTOBOT_CWD=/home/u/p'])
    assert.deepEqual(argv.slice(5), ['c', 'node', '-v'])
  })

  test('buildCreateContainerArgs: 默认禁网 + 资源上限 + 只读挂载', () => {
    const argv = buildCreateContainerArgs('C:/proj', {
      network: 'none',
      memory: '512m',
      cpu: '1.0',
      readOnlyWorkspace: true,
    }, 'autobot-runner-abc')
    assert.ok(argv.includes('--network') && argv.includes('none'))
    assert.ok(argv.includes('--memory') && argv.includes('512m'))
    assert.ok(argv.includes('--cpus') && argv.includes('1.0'))
    assert.ok(argv.includes('-v') && argv.includes('C:/proj:/workspace:ro'))
  })

  test('buildCreateContainerArgs: 读写挂载 + 可配置容器名/镜像', () => {
    const argv = buildCreateContainerArgs('/data/p', {
      image: 'my-image:2',
      network: 'host',
      readOnlyWorkspace: false,
    }, 'my-runner')
    assert.ok(argv.includes('--name') && argv.includes('my-runner'))
    assert.ok(argv.includes('/data/p:/workspace'))
    assert.ok(!argv.includes('--network')) // host 模式不加 --network none
  })

  test('runInSandbox: 关闭时走本地执行（真实命令回归）', async () => {
    const r = await runInSandbox({ command: 'node', args: ['-e', 'console.log("hi")'], timeoutMs: 5000 }, NO_SANDBOX)
    assert.equal(r.exitCode, 0)
    assert.ok(r.output.includes('hi'))
    assert.equal(r.timedOut, false)
  })

  test('runLocal: 非零退出码 + stderr 合并', async () => {
    const r = await runLocal({ command: 'node', args: ['-e', 'console.error("boom"); process.exit(3)'], timeoutMs: 5000 })
    assert.equal(r.exitCode, 3)
    assert.ok(r.output.includes('boom'))
  })

  test('runLocal: 超时置 timedOut', async () => {
    const r = await runLocal({ command: 'node', args: ['-e', 'setTimeout(()=>{}, 10000)'], timeoutMs: 300 })
    assert.equal(r.timedOut, true)
    assert.notEqual(r.exitCode, 0)
  })
})
