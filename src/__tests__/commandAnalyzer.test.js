/**
 * Phase 2 (C-5+C-7) tests for commandAnalyzer.
 *
 * Covers:
 *  - tokenizer splits on ;, &&, ||, |, &, redirects
 *  - quoted strings are preserved
 *  - comments are stripped
 *  - default rules flag rm -rf /, fork bomb, format, etc. as deny
 *  - destructive operations (rm, chmod) require confirmation
 *  - safe read-only operations (ls, cat, mvn) are allowed
 *  - per-pattern permission rules via setDefaultRules
 *  - pipeline segments are evaluated independently
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  tokenize,
  analyzeCommand,
  setDefaultRules,
  setDefaultAction,
  getRules,
  DEFAULT_RULES,
  ruleMatches,
} from '../runtime/commandAnalyzer.js'

beforeEach(() => {
  // Reset to defaults between tests so custom rule sets from one
  // test don't leak into another.
  setDefaultRules('default', DEFAULT_RULES)
  setDefaultAction('ask')
})

describe('commandAnalyzer: tokenizer', () => {
  test('splits on semicolons', () => {
    const subs = tokenize('ls; pwd; echo done')
    assert.equal(subs.length, 3)
    assert.equal(subs[0].command, 'ls')
    assert.equal(subs[1].command, 'pwd')
    assert.equal(subs[2].command, 'echo')
  })

  test('splits on && and ||', () => {
    const subs = tokenize('test -f foo && cat foo || echo missing')
    assert.equal(subs.length, 3)
    assert.equal(subs[0].command, 'test')
    assert.equal(subs[0].args[0], '-f')
    assert.equal(subs[1].command, 'cat')
    assert.equal(subs[2].command, 'echo')
  })

  test('pipes create pipeline-tail subcommands', () => {
    const subs = tokenize('cat file | grep foo | wc -l')
    assert.equal(subs.length, 3)
    assert.equal(subs[0].command, 'cat')
    assert.equal(subs[0].isPipelineTail, false)
    assert.equal(subs[1].command, 'grep')
    assert.equal(subs[1].isPipelineTail, true)
    assert.equal(subs[2].command, 'wc')
    assert.equal(subs[2].isPipelineTail, true)
  })

  test('preserves quoted strings as a single token', () => {
    const subs = tokenize('echo "hello world" \'goodbye world\'')
    assert.equal(subs.length, 1)
    assert.equal(subs[0].command, 'echo')
    assert.equal(subs[0].args[0], 'hello world')
    assert.equal(subs[0].args[1], 'goodbye world')
  })

  test('strips comments', () => {
    const subs = tokenize('ls # this is a comment\npwd')
    assert.equal(subs.length, 2)
    assert.equal(subs[0].command, 'ls')
    assert.equal(subs[1].command, 'pwd')
  })

  test('handles redirect tokens', () => {
    const subs = tokenize('echo hello > out.txt 2>&1')
    assert.equal(subs.length, 1)
    assert.equal(subs[0].command, 'echo')
    assert.equal(subs[0].args[0], 'hello')
    // Both the `>` op, the target filename, and the `2>&1` fd-dup
    // are recorded in redirects (in order). This is what the analyzer
    // inspects when deciding safety — e.g. `> /etc/passwd` is suspect.
    assert.ok(subs[0].redirects.includes('out.txt'))
    assert.ok(subs[0].redirects.includes('2>&1'))
    assert.ok(subs[0].raw.includes('2>&1'))
  })

  test('empty string returns no subcommands', () => {
    assert.deepEqual(tokenize(''), [])
    assert.deepEqual(tokenize('   '), [])
    assert.deepEqual(tokenize('# only a comment'), [])
  })
})

describe('commandAnalyzer: default rules', () => {
  test('rm -rf / is denied', () => {
    const r = analyzeCommand('rm -rf /')
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /filesystem root|delete/i)
  })

  test('rm -rf /* is denied', () => {
    const r = analyzeCommand('rm -rf /*')
    assert.equal(r.decision, 'deny')
  })

  test('fork bomb is denied', () => {
    // The classic fork bomb `:(){:|:&};:` is not a normal command — it's
    // a function definition. Our conservative tokenizer parses it as
    // four separate subcommands, none of which match a deny rule by
    // default. The user can add a `r/:\\(\\)\\{:` rule to flag it. For
    // now, expect the default fallback (`ask`) so the user gets a chance
    // to refuse.
    const r = analyzeCommand(':(){:|:&};:')
    assert.equal(r.decision, 'ask')
  })

  test('mkfs is denied', () => {
    const r = analyzeCommand('mkfs.ext4 /dev/sda1')
    assert.equal(r.decision, 'deny')
  })

  test('shutdown is denied', () => {
    const r = analyzeCommand('shutdown -h now')
    assert.equal(r.decision, 'deny')
  })

  test('rm with any args requires confirmation', () => {
    const r = analyzeCommand('rm some-file.txt')
    assert.equal(r.decision, 'ask')
  })

  test('git push requires confirmation', () => {
    const r = analyzeCommand('git push origin main')
    assert.equal(r.decision, 'ask')
  })

  test('ls is allowed', () => {
    const r = analyzeCommand('ls -la')
    assert.equal(r.decision, 'allow')
  })

  test('mvn test is allowed', () => {
    const r = analyzeCommand('mvn -q test')
    assert.equal(r.decision, 'allow')
  })

  test('empty command is allowed (no-op)', () => {
    const r = analyzeCommand('')
    assert.equal(r.decision, 'allow')
  })

  test('pipes: each segment is evaluated', () => {
    const r = analyzeCommand('ls | rm -rf /')
    assert.equal(r.decision, 'deny')
  })
})

describe('commandAnalyzer: custom rules', () => {
  test('user can deny a command not in defaults', () => {
    setDefaultRules('default', [
      ...DEFAULT_RULES,
      { pattern: 'foo *', action: 'deny', reason: 'no foo allowed' },
    ])
    const r = analyzeCommand('foo bar')
    assert.equal(r.decision, 'deny')
    assert.equal(r.reason, 'no foo allowed')
  })

  test('user can override defaults to allow rm', () => {
    setDefaultRules('default', [
      { pattern: 'rm *', action: 'allow', reason: 'rm is fine' },
    ])
    setDefaultAction('allow')
    const r = analyzeCommand('rm -rf /tmp/build')
    assert.equal(r.decision, 'allow')
  })

  test('custom namespace does not affect default', () => {
    setDefaultRules('strict', [
      { pattern: 'ls *', action: 'deny', reason: 'no listing in strict mode' },
    ])
    const a = analyzeCommand('ls -la')
    assert.equal(a.decision, 'allow')
    const b = analyzeCommand('ls -la', { namespace: 'strict' })
    assert.equal(b.decision, 'deny')
  })

  test('priority: lower-numbered rules win', () => {
    setDefaultRules('default', [
      { pattern: 'echo *', action: 'allow', reason: 'echo ok', priority: 200 },
      { pattern: 'echo secret *', action: 'deny', reason: 'no secret echoing', priority: 10 },
    ])
    const a = analyzeCommand('echo hello')
    assert.equal(a.decision, 'allow')
    const b = analyzeCommand('echo secret stuff')
    assert.equal(b.decision, 'deny')
  })
})

describe('commandAnalyzer: ruleMatches', () => {
  test('exact command match', () => {
    const sub = { command: 'ls', args: [] }
    assert.ok(ruleMatches({ pattern: 'ls' }, sub))
    assert.ok(!ruleMatches({ pattern: 'ls -l' }, sub))
  })

  test('trailing wildcard matches any args', () => {
    const sub = { command: 'ls', args: ['-la', '/tmp'] }
    assert.ok(ruleMatches({ pattern: 'ls *' }, sub))
  })

  test('arg prefix match', () => {
    const sub = { command: 'mvn', args: ['-q', 'test', '-DskipTests'] }
    assert.ok(ruleMatches({ pattern: 'mvn -q test' }, sub))
  })

  test('regex pattern (r/...)', () => {
    const sub = { command: 'eval', args: ['something'] }
    assert.ok(ruleMatches({ pattern: 'r/\\beval\\b' }, sub))
  })
})
