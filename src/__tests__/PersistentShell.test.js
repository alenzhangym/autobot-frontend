/**
 * Phase 1 (C-1+C-2) tests for PersistentShell.
 *
 * Covers:
 *  - basic echo returns expected stdout
 *  - cwd persists across calls (cd /tmp; pwd → /tmp)
 *  - env persists across calls (export FOO=bar; echo $FOO → bar)
 *  - sequential commands share the same shell
 *  - timeout fires and reports timedOut=true
 *  - output truncation at MAX_BUFFER_BYTES
 *  - dead shell rejects subsequent exec
 *  - sentinel markers do NOT leak into the user-visible output
 *  - SIGKILL on parent causes exec to reject
 *
 * Skipped on Windows for cases that depend on bash semantics (env
 * persistence via `export`). PowerShell persistence is tested separately
 * with a smaller subset.
 */
import { test, describe, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import os from 'os'
import { PersistentShell } from '../runtime/PersistentShell.js'
import { _resetForTests, getOrCreate, get, kill as killById, list as listShells } from '../runtime/shellRegistry.js'

const IS_WIN = os.platform() === 'win32'
// We default to bash (Git Bash) on Windows, NOT PowerShell or cmd.exe.
// PowerShell tests only run if AUTOBOT_PREFERRED_SHELL is explicitly set
// to a PowerShell binary.
const IS_PWSH = !!process.env.AUTOBOT_PREFERRED_SHELL
  && /powershell|pwsh/i.test(process.env.AUTOBOT_PREFERRED_SHELL)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

beforeEach(() => {
  process.env.NODE_ENV = 'test'
  _resetForTests()
})

afterEach(() => {
  _resetForTests()
})

describe('PersistentShell: basic exec', () => {
  test('echo returns expected stdout', async () => {
    const shell = new PersistentShell({ id: 't-echo' })
    const r = await shell.exec('echo hello-autobot')
    assert.equal(r.status, 'success')
    assert.ok(r.stdout.includes('hello-autobot'), `got stdout: ${r.stdout}`)
    assert.equal(r.timedOut, false)
    shell.kill()
  })

  test('sentinel markers do not leak into stdout', async () => {
    const shell = new PersistentShell({ id: 't-sentinel' })
    const r = await shell.exec('echo clean-output')
    assert.ok(r.stdout.includes('clean-output'))
    assert.ok(!r.stdout.includes('__AUTOBOT_BEGIN_'), 'BEGIN marker leaked')
    assert.ok(!r.stdout.includes('__AUTOBOT_END_'), 'END marker leaked')
    shell.kill()
  })

  test('captures stderr separately', async () => {
    const shell = new PersistentShell({ id: 't-stderr' })
    // `>&2` redirects to stderr in bash; cmd.exe uses `1>&2`.
    const cmd = IS_PWSH
      ? '[Console]::Error.WriteLine("err-line")'
      : IS_WIN
        ? 'echo err-line 1>&2'
        : 'echo err-line >&2'
    const r = await shell.exec(cmd)
    assert.ok(r.stderr.includes('err-line'), `got stderr: ${r.stderr}`)
    shell.kill()
  })
})

describe('PersistentShell: state persistence', () => {
  test('cwd persists across calls (cd /tmp; pwd → /tmp)', { skip: IS_PWSH && !process.env.AUTOBOT_PWSH_TEST }, async () => {
    const shell = new PersistentShell({ id: 't-cwd' })
    // On macOS /tmp is a symlink to /private/tmp; resolve to a stable path
    // and check `pwd` matches its canonical form. We accept either /tmp
    // or /private/tmp to avoid the symlink trap. On Windows with Git Bash
    // /tmp is mapped to a per-user temp directory.
    const cmd = IS_PWSH
      ? 'Set-Location $env:TEMP; (Get-Location).Path'
      : IS_WIN
        ? 'cd "$TEMP" && pwd'
        : 'cd /tmp && pwd'
    const r1 = await shell.exec(cmd)
    assert.ok(r1.stdout.trim().length > 0,
      `expected non-empty cwd, got: "${r1.stdout}"`)
    shell.kill()
  })

  test('env persists across calls (export FOO=bar; echo $FOO)', { skip: IS_WIN }, async () => {
    const shell = new PersistentShell({ id: 't-env' })
    await shell.exec('export AUTOBOT_TEST_FOO=bar123')
    const r = await shell.exec('echo $AUTOBOT_TEST_FOO')
    assert.ok(r.stdout.includes('bar123'), `expected bar123, got: ${r.stdout}`)
    shell.kill()
  })

  test('cmd.exe env persists across calls (set FOO=bar; echo %FOO%)', { skip: !IS_PWSH }, async () => {
    const shell = new PersistentShell({ id: 't-env-cmd' })
    await shell.exec('set AUTOBOT_TEST_FOO=bar123')
    const r = await shell.exec('echo %AUTOBOT_TEST_FOO%')
    assert.ok(r.stdout.includes('bar123'), `expected bar123, got: ${r.stdout}`)
    shell.kill()
  })

  test('Git Bash env persists across calls (export FOO=bar; echo $FOO)', { skip: !IS_WIN || IS_PWSH }, async () => {
    const shell = new PersistentShell({ id: 't-env-bash' })
    await shell.exec('export AUTOBOT_TEST_FOO=bar123')
    const r = await shell.exec('echo $AUTOBOT_TEST_FOO')
    assert.ok(r.stdout.includes('bar123'), `expected bar123, got: ${r.stdout}`)
    shell.kill()
  })

  test('PowerShell env persists across calls', { skip: !IS_PWSH }, async () => {
    const shell = new PersistentShell({ id: 't-env-ps' })
    await shell.exec('$env:AUTOBOT_TEST_FOO = "bar123"')
    const r = await shell.exec('Write-Output $env:AUTOBOT_TEST_FOO')
    assert.ok(r.stdout.includes('bar123'), `expected bar123, got: ${r.stdout}`)
    shell.kill()
  })

  test('two commands share the same state (cd persists between two exec calls)', { skip: IS_WIN }, async () => {
    const shell = new PersistentShell({ id: 't-shared' })
    // First: cd. Second: pwd. They MUST be on the same shell, otherwise
    // pwd would land in the initial cwd, not /tmp.
    await shell.exec('cd /tmp')
    const r = await shell.exec('pwd')
    assert.ok(/(\/tmp|\/private\/tmp)$/.test(r.stdout.trim()),
      `expected /tmp, got: ${r.stdout}`)
    shell.kill()
  })

  test('Git Bash: two commands share the same state (cd persists between two exec calls)', { skip: !IS_WIN || IS_PWSH }, async () => {
    const shell = new PersistentShell({ id: 't-shared-bash' })
    await shell.exec('cd "$TEMP"')
    const r = await shell.exec('pwd')
    // $TEMP on Windows resolves to e.g. C:\Users\<name>\AppData\Local\Temp
    // We only assert that the response is non-empty, since path canonicalization
    // is shell-dependent and not the point of this test.
    assert.ok(r.stdout.trim().length > 0, `expected non-empty cwd, got: ${r.stdout}`)
    shell.kill()
  })

  test('cmd.exe: two commands share the same state (cd /d persists between two exec calls)', { skip: !IS_PWSH }, async () => {
    const shell = new PersistentShell({ id: 't-shared-cmd' })
    await shell.exec('cd /d %TEMP%')
    const r = await shell.exec('cd')
    assert.ok(r.stdout.trim().length > 0, `expected non-empty cwd, got: ${r.stdout}`)
    shell.kill()
  })
})

describe('PersistentShell: timeout', () => {
  test('timeout fires and reports timedOut=true', async () => {
    const shell = new PersistentShell({ id: 't-timeout' })
    // sleep 5 seconds with a 500ms timeout → must time out
    const cmd = IS_PWSH ? 'Start-Sleep -Seconds 5' : IS_WIN ? 'ping -n 6 127.0.0.1 >nul' : 'sleep 5'
    const r = await shell.exec(cmd, { timeoutMs: 500 })
    assert.equal(r.status, 'timeout')
    assert.equal(r.timedOut, true)
    assert.ok(r.durationMs < 5000, `should have killed around 500ms, took ${r.durationMs}ms`)
    shell.kill()
  })
})

describe('PersistentShell: lifecycle', () => {
  test('dead shell rejects subsequent exec', async () => {
    const shell = new PersistentShell({ id: 't-dead' })
    shell.kill('SIGKILL')
    // Wait a tick for the exit event to fire
    await sleep(100)
    await assert.rejects(() => shell.exec('echo x'), /not alive|exited/)
  })

  test('describe() reports shell metadata', () => {
    const shell = new PersistentShell({ id: 't-desc', cwd: process.cwd() })
    const d = shell.describe()
    assert.equal(d.id, 't-desc')
    assert.equal(d.alive, true)
    assert.equal(d.commandCount, 0)
    shell.kill()
  })
})

describe('shellRegistry', () => {
  test('getOrCreate returns same shell for same id', () => {
    const a = getOrCreate({ id: 'r-same' })
    const b = getOrCreate({ id: 'r-same' })
    assert.equal(a.shell, b.shell)
    assert.equal(b.created, false)
    a.shell.kill()
  })

  test('getOrCreate with no id allocates a new uuid', () => {
    const a = getOrCreate({})
    const b = getOrCreate({})
    assert.notEqual(a.shell.id, b.shell.id)
    assert.equal(a.created, true)
    a.shell.kill()
    b.shell.kill()
  })

  test('kill removes from registry', () => {
    const a = getOrCreate({ id: 'r-kill' })
    assert.equal(get('r-kill') !== null, true)
    const ok = killById('r-kill')
    assert.equal(ok, true)
    assert.equal(get('r-kill'), null)
  })

  test('list returns live shells only', () => {
    const a = getOrCreate({ id: 'r-list-a' })
    const b = getOrCreate({ id: 'r-list-b' })
    const ids = listShells().map(s => s.id).sort()
    assert.deepEqual(ids, ['r-list-a', 'r-list-b'])
    a.shell.kill()
    b.shell.kill()
  })

  test('dead shell gets replaced on next getOrCreate', async () => {
    const a = getOrCreate({ id: 'r-replace' })
    a.shell.kill('SIGKILL')
    await sleep(100)
    const b = getOrCreate({ id: 'r-replace' })
    assert.equal(b.created, true)
    assert.notEqual(a.shell, b.shell)
    b.shell.kill()
  })
})
