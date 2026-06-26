/**
 * commandAnalyzer — raw shell command → tokenized AST → permission decision.
 *
 * <h3>Why a new module?</h3>
 * <p>The pre-existing {@code agentCommandSafety.js} operates on
 * <em>structured</em> command specs ({@code __CMD__} payloads produced
 * by the language adapters). The new {@code /api/local/bash} endpoint
 * accepts raw shell strings from the LLM, which need a different
 * analysis path. This module tokenizes raw shell into subcommands
 * (split on {@code ;}, {@code &&}, {@code ||}, {@code |}, {@code &},
 * redirects, newlines) and then applies a rule engine to the
 * (command, args) tuple of each subcommand.</p>
 *
 * <h3>Decision semantics</h3>
 * <ul>
 *   <li>Each subcommand is evaluated against the rule list in order.
 *       The first matching rule decides; unmatched subcommands fall
 *       through to the default action.</li>
 *   <li>The whole command is denied if ANY subcommand is denied.</li>
 *   <li>The whole command needs confirmation if ANY subcommand needs
 *       confirmation (and none are denied).</li>
 *   <li>Otherwise the whole command is allowed.</li>
 * </ul>
 *
 * <h3>Why not full bash AST (tree-sitter)?</h3>
 * <p>Tree-sitter-bash is the gold standard but requires a WASM/native
 * binary and significant setup. For Phase 2 we ship a conservative
 * tokenizer that handles the common cases (statements, pipes,
 * redirects, quoted strings). Replacing it with a real AST is a Phase
 * 5 task; the public API of this module will not change.</p>
 */

/**
 * @typedef {Object} Subcommand
 * @property {string} command  The first token of the subcommand (e.g. "rm").
 * @property {string[]} args  The remaining tokens.
 * @property {string} raw  The original text slice for diagnostics.
 * @property {string[]} redirects  Tokens captured after a `>` or `<`.
 * @property {boolean} isPipelineTail  True if this subcommand is the
 *   right-hand side of a pipe (`|`). The user can require that pipeline
 *   segments all be evaluated.
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {'allow'|'deny'|'ask'} decision
 * @property {string} [reason]  Human-readable explanation.
 * @property {Subcommand[]} subcommands  The tokenized subcommands.
 * @property {Array<{subcommand: Subcommand, rule: Rule, action: string}>} matches
 */

/**
 * @typedef {Object} Rule
 * @property {string} pattern  Glob pattern: "<command> [args...]".
 *   The first whitespace-delimited token is the command name. A trailing
 *   ` *` matches any further args. Literal args are matched exactly.
 *   `r/<regex>` is interpreted as a regex over the full command line.
 * @property {'allow'|'deny'|'ask'} action
 * @property {string} [reason]
 * @property {number} [priority]  Lower number = higher priority. Default 100.
 */

/**
 * Default rule set: conservative. Anything not explicitly allowed is
 * asked about. The user can override via {@link setDefaultRules}.
 *
 * @type {Rule[]}
 */
export const DEFAULT_RULES = [
  // ── Always-deny ───────────────────────────────────────────────────
  { pattern: 'rm -rf /*', action: 'deny', reason: 'Recursive force delete at filesystem root', priority: 1 },
  { pattern: 'rm -rf /', action: 'deny', reason: 'Recursive force delete at filesystem root', priority: 1 },
  { pattern: ':(){:|:&};:', action: 'deny', reason: 'Fork bomb', priority: 1 },
  { pattern: 'mkfs *', action: 'deny', reason: 'Format filesystem', priority: 1 },
  { pattern: 'dd if=* of=/dev/*', action: 'deny', reason: 'Raw disk write', priority: 1 },
  { pattern: 'shutdown *', action: 'deny', reason: 'System shutdown', priority: 1 },
  { pattern: 'reboot *', action: 'deny', reason: 'System reboot', priority: 1 },
  { pattern: 'halt *', action: 'deny', reason: 'System halt', priority: 1 },
  { pattern: 'poweroff *', action: 'deny', reason: 'System poweroff', priority: 1 },

  // ── Ask-by-default for anything destructive-looking ───────────────
  { pattern: 'rm *', action: 'ask', reason: 'File deletion', priority: 50 },
  { pattern: 'mv *', action: 'ask', reason: 'File move', priority: 50 },
  { pattern: 'chmod *', action: 'ask', reason: 'Permission change', priority: 50 },
  { pattern: 'chown *', action: 'ask', reason: 'Ownership change', priority: 50 },
  { pattern: 'git push *', action: 'ask', reason: 'Git push', priority: 50 },
  { pattern: 'git reset *', action: 'ask', reason: 'Git reset', priority: 50 },
  { pattern: 'curl *', action: 'ask', reason: 'Network request via curl', priority: 50 },
  { pattern: 'wget *', action: 'ask', reason: 'Network request via wget', priority: 50 },
  { pattern: 'sudo *', action: 'ask', reason: 'Privilege escalation', priority: 50 },
  { pattern: 'su *', action: 'ask', reason: 'User switch', priority: 50 },
  { pattern: 'r/\\b(eval|exec|source)\\s', action: 'ask', reason: 'Dynamic code evaluation', priority: 50 },

  // ── Allow common read-only / build commands ───────────────────────
  { pattern: 'ls *', action: 'allow', reason: 'List directory', priority: 200 },
  { pattern: 'ls', action: 'allow', reason: 'List directory', priority: 200 },
  { pattern: 'cat *', action: 'allow', reason: 'Read file', priority: 200 },
  { pattern: 'head *', action: 'allow', reason: 'Read file head', priority: 200 },
  { pattern: 'tail *', action: 'allow', reason: 'Read file tail', priority: 200 },
  { pattern: 'grep *', action: 'allow', reason: 'Search text', priority: 200 },
  { pattern: 'rg *', action: 'allow', reason: 'Search text', priority: 200 },
  { pattern: 'find *', action: 'allow', reason: 'Find files', priority: 200 },
  { pattern: 'pwd', action: 'allow', reason: 'Print working directory', priority: 200 },
  { pattern: 'echo *', action: 'allow', reason: 'Echo', priority: 200 },
  { pattern: 'echo', action: 'allow', reason: 'Echo', priority: 200 },
  { pattern: 'cd *', action: 'allow', reason: 'Change directory', priority: 200 },
  { pattern: 'cd', action: 'allow', reason: 'Change directory', priority: 200 },
  { pattern: 'export *', action: 'allow', reason: 'Set env var', priority: 200 },
  { pattern: 'mvn *', action: 'allow', reason: 'Maven build', priority: 200 },
  { pattern: 'mvnw *', action: 'allow', reason: 'Maven wrapper', priority: 200 },
  { pattern: 'gradle *', action: 'allow', reason: 'Gradle build', priority: 200 },
  { pattern: 'gradlew *', action: 'allow', reason: 'Gradle wrapper', priority: 200 },
  { pattern: 'go *', action: 'allow', reason: 'Go toolchain', priority: 200 },
  { pattern: 'npm *', action: 'allow', reason: 'npm', priority: 200 },
  { pattern: 'npx *', action: 'allow', reason: 'npx', priority: 200 },
  { pattern: 'node *', action: 'allow', reason: 'Node.js', priority: 200 },
  { pattern: 'pytest *', action: 'allow', reason: 'pytest', priority: 200 },
  { pattern: 'python *', action: 'allow', reason: 'python', priority: 200 },
  { pattern: 'pip *', action: 'allow', reason: 'pip', priority: 200 },
  { pattern: 'git status', action: 'allow', reason: 'Git status', priority: 200 },
  { pattern: 'git diff *', action: 'allow', reason: 'Git diff', priority: 200 },
  { pattern: 'git log *', action: 'allow', reason: 'Git log', priority: 200 },
  { pattern: 'git log', action: 'allow', reason: 'Git log', priority: 200 },
  { pattern: 'git add *', action: 'allow', reason: 'Git add', priority: 200 },
  { pattern: 'git branch *', action: 'allow', reason: 'Git branch (read)', priority: 200 },
  { pattern: 'git show *', action: 'allow', reason: 'Git show', priority: 200 },
]

/**
 * Default action when a subcommand matches no rule.
 * Configurable via {@link setDefaultAction}. Default: {@code 'ask'}.
 */
let defaultAction = 'ask'
const RULE_SETS = new Map() // namespace → Rule[]

/**
 * Override the default action ('ask' | 'allow' | 'deny').
 */
export function setDefaultAction(action) {
  if (action !== 'allow' && action !== 'deny' && action !== 'ask') {
    throw new Error(`Invalid default action: ${action}`)
  }
  defaultAction = action
}

/**
 * Register a custom rule set under a namespace. Use {@code 'default'}
 * to override the built-in set.
 *
 * @param {string} namespace
 * @param {Rule[]} rules
 */
export function setDefaultRules(namespace, rules) {
  if (typeof namespace !== 'string' || !namespace) {
    throw new Error('namespace is required')
  }
  if (!Array.isArray(rules)) {
    throw new Error('rules must be an array')
  }
  RULE_SETS.set(namespace, rules)
}

/**
 * Get the active rule set. Returns a defensive copy so callers cannot
 * mutate the internal list.
 */
export function getRules(namespace = 'default') {
  const rules = RULE_SETS.get(namespace) || DEFAULT_RULES
  return rules.slice().sort((a, b) => (a.priority || 100) - (b.priority || 100))
}

/**
 * Tokenize a raw shell string into subcommands. Handles:
 *   - statement separators: `;`, `&&`, `||`, `&`, newline
 *   - pipes: `|`
 *   - redirects: `>`, `<`, `>>`, `2>`, `&>`
 *   - single and double quoted strings (preserved as a single token)
 *   - comments: `#` to end of line (stripped)
 *   - trailing `\` for line continuation
 *
 * @param {string} command
 * @returns {Subcommand[]}
 */
export function tokenize(command) {
  if (typeof command !== 'string') return []
  const tokens = lex(command)
  if (tokens.length === 0) return []
  return tokensToSubcommands(tokens)
}

/**
 * Lex a shell string into a flat list of typed tokens.
 * Each token is { type, value }.
 *
 * Types: word, sep, pipe, redirect, background.
 */
function lex(command) {
  const tokens = []
  let i = 0
  const n = command.length
  let buf = ''
  let inSingle = false
  let inDouble = false

  const flushBuf = () => {
    if (buf.length > 0) {
      tokens.push({ type: 'word', value: buf })
      buf = ''
    }
  }

  while (i < n) {
    const c = command[i]

    if (inSingle) {
      if (c === "'") {
        inSingle = false
        i++
        continue
      }
      buf += c
      i++
      continue
    }

    if (inDouble) {
      if (c === '"') {
        inDouble = false
        i++
        continue
      }
      if (c === '\\' && i + 1 < n && (command[i + 1] === '"' || command[i + 1] === '\\' || command[i + 1] === '$')) {
        buf += command[i + 1]
        i += 2
        continue
      }
      buf += c
      i++
      continue
    }

    // Not in quotes
    if (c === "'") { inSingle = true; i++; continue }
    if (c === '"') { inDouble = true; i++; continue }
    if (c === '\\' && i + 1 < n) {
      // line continuation or escape
      if (command[i + 1] === '\n') { i += 2; continue }
      buf += command[i + 1]
      i += 2
      continue
    }
    if (c === '#') {
      // comment to end of line
      while (i < n && command[i] !== '\n') i++
      continue
    }
    if (c === ' ' || c === '\t') { flushBuf(); i++; continue }
    if (c === '\n') { flushBuf(); tokens.push({ type: 'sep', value: ';' }); i++; continue }
    if (c === ';') { flushBuf(); tokens.push({ type: 'sep', value: ';' }); i++; continue }
    if (c === '&') {
      flushBuf()
      if (command[i + 1] === '&') { tokens.push({ type: 'sep', value: '&&' }); i += 2 }
      else { tokens.push({ type: 'background', value: '&' }); i++ }
      continue
    }
    if (c === '|') {
      flushBuf()
      if (command[i + 1] === '|') { tokens.push({ type: 'sep', value: '||' }); i += 2 }
      else { tokens.push({ type: 'pipe', value: '|' }); i++ }
      continue
    }
    // Handle fd prefix for redirect: `2>`, `2>&1`, `1>>`, `0<`. We must
    // check this BEFORE the generic `>`/`<` block below, otherwise the
    // bare `>` matches first and we lose the fd.
    if ((c === '0' || c === '1' || c === '2') && i + 1 < n
        && (command[i + 1] === '>' || command[i + 1] === '<')) {
      flushBuf()
      let op = c + command[i + 1]
      i += 2
      if (command[i] === '>') { op += '>'; i++ }
      if (command[i] === '&' && command[i + 1] === '1') { op += '&1'; i += 2 }
      else if (command[i] === '&' && command[i + 1] === '2') { op += '&2'; i += 2 }
      tokens.push({ type: 'redirect', value: op })
      continue
    }
    if (c === '>' || c === '<') {
      flushBuf()
      let op = c
      if (command[i + 1] === '>') { op += '>'; i++ }
      // Handle `>&` (dup stderr to stdout) and `&>` (redirect both)
      if (command[i + 1] === '&') { op += '&'; i++ }
      tokens.push({ type: 'redirect', value: op })
      i++
      continue
    }
    buf += c
    i++
  }
  flushBuf()
  return tokens
}

/**
 * Convert a token stream into a list of subcommands. A subcommand is
 * delimited by `sep` or `background`; pipes within a subcommand split
 * into `pipeTarget` subcommands (the analyzer treats each pipe segment
 * independently for safety).
 */
function tokensToSubcommands(tokens) {
  const result = []
  let current = null
  let inRedirect = false

  const newSub = () => {
    if (current) result.push(current)
    current = { command: null, args: [], redirects: [], raw: '', isPipelineTail: false }
    inRedirect = false
  }

  newSub()

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]
    if (t.type === 'sep' || t.type === 'background') {
      newSub()
      continue
    }
    if (t.type === 'pipe') {
      // The subcommand on the LEFT of the pipe becomes a "completed"
      // pipeline segment. The subcommand on the RIGHT (the new
      // `current`) is a pipeline TAIL — i.e. it received its stdin
      // from a pipe, not from the user directly.
      if (current) {
        result.push(current)
      }
      current = {
        command: null, args: [], redirects: [], raw: '',
        isPipelineTail: true,
      }
      continue
    }
    if (t.type === 'redirect') {
      // Some redirects (e.g. `2>&1`) have no following filename; they
      // are self-contained fd-duplication tokens. We still record them
      // in `redirects` for downstream analysis.
      current.redirects.push(t.value)
      current.raw += (current.raw ? ' ' : '') + t.value
      inRedirect = true
      continue
    }
    if (t.type === 'word') {
      if (inRedirect) {
        current.redirects.push(t.value)
        current.raw += (current.raw ? ' ' : '') + t.value
        inRedirect = false
        continue
      }
      if (current.command === null) {
        current.command = t.value
        current.raw = t.value
      } else {
        current.args.push(t.value)
        current.raw += ' ' + t.value
      }
      continue
    }
  }
  if (current && (current.command !== null || current.args.length > 0)) {
    result.push(current)
  }
  // Drop the empty initial subcommand if nothing came before the first sep
  return result.filter((s) => s.command !== null)
}

/**
 * Test whether a subcommand's (command, args) matches a rule pattern.
 * Pattern format:
 *   "<cmd>"          exact command
 *   "<cmd> *"        command with any args
 *   "<cmd> a b"      command with these args as a prefix (more args allowed)
 *   "r/<regex>"      full command line matches regex
 *
 * @param {Rule} rule
 * @param {Subcommand} sub
 * @returns {boolean}
 */
export function ruleMatches(rule, sub) {
  const pattern = rule.pattern || ''
  if (pattern.startsWith('r/')) {
    const regex = new RegExp(pattern.slice(2), 'i')
    // Build a fallback command line from command + args if `raw` is absent
    const candidate = sub.raw || [sub.command, ...(sub.args || [])].join(' ').trim()
    return regex.test(candidate)
  }
  const parts = pattern.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return false
  const [cmdPat, ...argPats] = parts
  if (!matchCommandToken(cmdPat, sub.command)) return false
  // If pattern ends with `*`, any args are OK
  const isAnyArgs = argPats.length > 0 && argPats[argPats.length - 1] === '*'
  const concrete = isAnyArgs ? argPats.slice(0, -1) : argPats
  if (sub.args.length < concrete.length) return false
  for (let i = 0; i < concrete.length; i++) {
    if (!matchCommandToken(concrete[i], sub.args[i])) return false
  }
  return true
}

function matchCommandToken(pat, val) {
  if (pat === '*') return true
  // Match dotted names: `mkfs *` should match `mkfs.ext4` because in
  // practice `mkfs.ext4`, `mkfs.xfs` etc. are real commands that share
  // the `mkfs` family. We split on `.` and check the first segment.
  if (pat.indexOf('.') === -1 && val && val.indexOf('.') !== -1) {
    return pat === val.split('.')[0]
  }
  return pat === val
}

/**
 * Apply the rule set to a list of subcommands and return the decision
 * for each one.
 */
function evaluateSubcommands(subcommands, rules) {
  const matches = []
  let denied = null
  let ask = null
  for (const sub of subcommands) {
    let action = null
    let rule = null
    for (const r of rules) {
      if (ruleMatches(r, sub)) {
        action = r.action
        rule = r
        break
      }
    }
    if (!action) action = defaultAction
    matches.push({ subcommand: sub, rule, action })
    if (action === 'deny' && !denied) denied = { sub, rule }
    else if (action === 'ask' && !ask && !denied) ask = { sub, rule }
  }
  return { matches, denied, ask }
}

/**
 * Analyze a raw shell command and return a permission decision.
 *
 * @param {string} command
 * @param {object} [options]
 * @param {string} [options.namespace]  Rule namespace, default 'default'.
 * @returns {AnalysisResult}
 */
export function analyzeCommand(command, options = {}) {
  const subcommands = tokenize(command)
  if (subcommands.length === 0) {
    return {
      decision: 'allow',
      reason: 'empty command',
      subcommands: [],
      matches: [],
    }
  }
  const rules = getRules(options.namespace)
  const { matches, denied, ask } = evaluateSubcommands(subcommands, rules)
  if (denied) {
    return {
      decision: 'deny',
      reason: denied.rule?.reason || 'Denied by rule',
      subcommands,
      matches,
    }
  }
  if (ask) {
    return {
      decision: 'ask',
      reason: ask.rule?.reason || 'Needs confirmation',
      subcommands,
      matches,
    }
  }
  return {
    decision: 'allow',
    subcommands,
    matches,
  }
}
