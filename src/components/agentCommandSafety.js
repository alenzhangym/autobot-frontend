/**
 * Safety guards for agent-emitted __CMD__ actions.
 *
 * <p>The CodeAgent backend may emit a {@code run} command with arbitrary
 * command + arguments. To prevent accidental execution of destructive shell
 * operations ({@code rm -rf /}, {@code git push --force}, {@code format}, etc.),
 * the frontend scans every {@code run} command and prompts the user before
 * executing anything that looks dangerous.</p>
 *
 * <p>Two independent signals trigger the prompt:</p>
 * <ol>
 *   <li><b>Backend flag</b>: the {@code requires_confirmation} field in the
 *       {@code __CMD__} JSON. The backend marks every {@code run} command
 *       as requiring confirmation by default; only known-safe toolchain
 *       invocations ({@code mvn test}, {@code go test}, etc.) opt out.</li>
 *   <li><b>Pattern match</b>: a defense-in-depth scan over command name and
 *       arguments. Even if a future backend regression forgets to set the
 *       flag, known-bad commands are blocked here.</li>
 * </ol>
 */

/**
 * Regex patterns that indicate a destructive operation. Match anywhere in
 * command name or arguments; the scan is case-insensitive and tolerates
 * common obfuscations (multiple spaces, quotes).
 *
 * Each pattern is a list of alternative substrings — at least one must
 * match for the command to be flagged.
 */
export const DANGEROUS_PATTERN_GROUPS = [
  // File-system destruction
  ['\\brm\\s+(-[a-z]*f[a-z]*\\s+)?(-[a-z]*r[a-z]*\\s+)?', 'recursive delete'],
  ['\\brmdir\\s+/s\\b', 'windows recursive delete'],
  ['\\bdel\\s+/[a-z]*s\\b', 'windows delete /s'],
  ['\\bformat\\s+[a-z]:', 'format drive'],
  ['\\bmkfs\\.', 'format filesystem'],
  ['\\bdd\\s+if=', 'dd disk image'],
  ['>\\s*/dev/sd[a-z]', 'overwrite raw disk'],
  ['\\btruncate\\s+-\\s*\\d', 'truncate file to zero'],

  // Privilege escalation
  ['\\bsudo\\b', 'sudo'],
  ['\\bsu\\s+-\\b', 'su root'],
  ['\\brunas\\b', 'runas (windows)'],
  ['\\bdoas\\b', 'doas'],

  // Git destructive
  ['\\bgit\\s+push\\b[\\s\\S]*--force', 'git push --force'],
  ['\\bgit\\s+push\\s+-f\\b', 'git push -f'],
  ['\\bgit\\s+reset\\s+--hard', 'git reset --hard'],
  ['\\bgit\\s+clean\\s+-[a-z]*f', 'git clean -f'],
  ['\\bgit\\s+checkout\\s+--\\s+\\.', 'git checkout -- .'],
  ['\\bgit\\s+branch\\s+-D\\b', 'git branch -D'],
  ['\\bgit\\s+stash\\s+drop', 'git stash drop'],
  ['\\bgit\\s+filter-branch', 'git filter-branch'],

  // Network exfil / remote execution
  ['\\bcurl\\b[\\s\\S]*\\|\\s*(bash|sh|zsh|powershell)', 'curl pipe to shell'],
  ['\\bwget\\b[\\s\\S]*\\|\\s*(bash|sh|zsh|powershell)', 'wget pipe to shell'],
  ['\\bnc\\s+-[a-z]*e', 'netcat reverse shell'],
  ['\\bbash\\s+-i\\s+>\\s*&\\s*/dev/tcp/', 'bash reverse shell'],

  // Process / kernel
  ['\\bkill\\s+-9\\s+1\\b', 'kill init'],
  ['\\bshutdown\\b', 'shutdown'],
  ['\\breboot\\b', 'reboot'],
  ['\\bhalt\\b', 'halt'],
  ['\\bpoweroff\\b', 'poweroff'],
  ['\\binit\\s+0\\b', 'init 0'],

  // System modification
  ['\\bchmod\\s+(-[a-z]*R[a-z]*\\s+)?0?7?7?7\\b', 'chmod 777 (overly permissive)'],
  ['\\bchown\\s+-R\\b', 'chown -R (recursive ownership change)'],
  ['\\bcrontab\\s+-r\\b', 'crontab -r (removes all cron jobs)'],
  ['\\bsystemctl\\s+(stop|disable|mask)\\b', 'systemctl stop/disable/mask'],
  ['\\bnet\\s+user\\s+.*\\s+/add', 'net user add (windows account creation)'],
  ['\\breg\\s+delete\\b', 'reg delete (windows registry)'],
  ['\\bdiskpart\\b', 'diskpart'],
]

/**
 * Compiled regex cache — built once at module load.
 */
const COMPILED_DANGEROUS_PATTERNS = DANGEROUS_PATTERN_GROUPS.map(([pattern, label]) => ({
  regex: new RegExp(pattern, 'i'),
  label,
}))

/**
 * Tools whose presence in the first argument makes the command a
 * definitely-destructive invocation regardless of arguments. (Defense in
 * depth; the regex list already covers most cases.)
 */
const FORBIDDEN_TOP_LEVEL_COMMANDS = new Set([
  'format', 'diskpart', 'mkfs', 'fdisk', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.btrfs',
])

/**
 * Explicit safe command shapes — a defense-in-depth whitelist.
 *
 * <p>A {@code run} command is considered safe (and skips the confirmation
 * dialog) ONLY if all three checks pass:</p>
 * <ol>
 *   <li>{@code cmd.id} matches one of the shape's {@code idPattern}s.</li>
 *   <li>{@code cmd.command} is in the shape's allowed {@code commands}.</li>
 *   <li>{@code cmd.args} starts (in order, exact-match per slot) with the
 *       shape's {@code argsPrefix}. The actual args array may have
 *       <em>additional</em> tokens after the prefix; the prefix is the
 *       minimum safe shape.</li>
 * </ol>
 *
 * <p>These shapes mirror what the backend emits via
 * {@code CommandSpec.trustedRun(...)} in the various {@code *LanguageAdapter}
 * classes. The id is constructed by the backend as
 * {@code "cmd-verify-quick:" + toolName} (or similar), so matching
 * {@code /^cmd-verify-quick:/} covers all of {mvn, mvnw, ./mvnw, mvnw.cmd}.
 * The command+args shape is re-validated here to defend against a
 * corrupted / hostile payload that just sets a whitelisted id.</p>
 *
 * <p>Adding a new shape: add an entry below AND make sure the backend
 * adapter that emits the corresponding {@code trustedRun} call is also
 * updated. The two stay in lock-step on purpose.</p>
 */
export const EXPLICIT_SAFE_SHAPES = [
  // ── Toolchain env probes (read-only, auto-run before the LLM works) ──
  // The backend emits these via AdapterCommandSupport.envCheck(...) as
  // trustedRun (requires_confirmation=false). Listing them here is pure
  // defense-in-depth: even if a future backend regression flips the flag,
  // a fixed `--version`/`version` probe still can't be hijacked.
  // cmd-envcheck:python   →  python --version
  {
    idPattern: /^cmd-envcheck:python$/,
    commands: ['python', 'python3', 'py'],
    argsPrefix: ['--version'],
  },
  // cmd-envcheck:pip      →  python -m pip --version
  {
    idPattern: /^cmd-envcheck:pip$/,
    commands: ['python', 'python3', 'py'],
    argsPrefix: ['-m', 'pip', '--version'],
  },
  // cmd-envcheck:node     →  node --version
  {
    idPattern: /^cmd-envcheck:node$/,
    commands: ['node'],
    argsPrefix: ['--version'],
  },
  // cmd-envcheck:npm      →  npm --version
  {
    idPattern: /^cmd-envcheck:npm$/,
    commands: ['npm'],
    argsPrefix: ['--version'],
  },
  // cmd-envcheck:go       →  go version
  {
    idPattern: /^cmd-envcheck:go$/,
    commands: ['go'],
    argsPrefix: ['version'],
  },
  // cmd-envcheck:java     →  java -version
  {
    idPattern: /^cmd-envcheck:java$/,
    commands: ['java'],
    argsPrefix: ['-version'],
  },
  // cmd-envcheck:mvn      →  mvn --version
  {
    idPattern: /^cmd-envcheck:mvn$/,
    commands: ['mvn', 'mvnw', './mvnw', 'mvnw.cmd'],
    argsPrefix: ['--version'],
  },
  // cmd-envcheck:gradle   →  gradle --version
  {
    idPattern: /^cmd-envcheck:gradle$/,
    commands: ['gradle', 'gradlew', './gradlew', 'gradlew.bat'],
    argsPrefix: ['--version'],
  },

  // ── Java (Maven) ────────────────────────────────────────────────────
  // cmd-verify-quick:<tool>  →  <tool> -q -B compile -DskipTests -Dsurefire.skip=true
  {
    idPattern: /^cmd-verify-quick:/,
    commands: ['mvn', 'mvnw', './mvnw', 'mvnw.cmd'],
    argsPrefix: ['-q', '-B', 'compile', '-DskipTests'],
  },
  // cmd-verify-compile:<tool>  (mvn flavour)
  {
    idPattern: /^cmd-verify-compile:/,
    commands: ['mvn', 'mvnw', './mvnw', 'mvnw.cmd'],
    argsPrefix: ['-q', '-B', 'compile', '-DskipTests'],
  },
  // cmd-verify-test:<tool>  (mvn flavour)
  {
    idPattern: /^cmd-verify-test:/,
    commands: ['mvn', 'mvnw', './mvnw', 'mvnw.cmd'],
    argsPrefix: ['-q', '-DskipITs', '-Dsurefire.failIfNoSpecifiedTests=false', '-B', 'test'],
  },

  // ── Java/Other (Gradle) ─────────────────────────────────────────────
  // cmd-verify-compile:<tool>  (gradle flavour)
  {
    idPattern: /^cmd-verify-compile:/,
    commands: ['gradle', 'gradlew', './gradlew', 'gradlew.bat'],
    argsPrefix: ['--no-daemon', '-q', 'compileJava', 'compileTestJava'],
  },
  // cmd-verify-test:<tool>  (gradle flavour)
  {
    idPattern: /^cmd-verify-test:/,
    commands: ['gradle', 'gradlew', './gradlew', 'gradlew.bat'],
    argsPrefix: ['--no-daemon', '-q', 'test'],
  },

  // ── Go ──────────────────────────────────────────────────────────────
  // cmd-verify:go-build  →  go build ./...
  {
    idPattern: /^cmd-verify:go-build$/,
    commands: ['go'],
    argsPrefix: ['build', './...'],
  },
  // cmd-verify:go-test  →  go test ./...
  {
    idPattern: /^cmd-verify:go-test$/,
    commands: ['go'],
    argsPrefix: ['test', './...'],
  },

  // ── TypeScript ──────────────────────────────────────────────────────
  // cmd-verify:tsc  →  npx --no-install tsc --noEmit
  {
    idPattern: /^cmd-verify:tsc$/,
    commands: ['npx'],
    argsPrefix: ['--no-install', 'tsc', '--noEmit'],
  },
  // cmd-verify:<framework>  →  npx --no-install <framework> [...]
  // frameworks: vitest | jest | mocha | vitest? (fallback)
  {
    idPattern: /^cmd-verify:(vitest|jest|mocha|vitest\?)$/,
    commands: ['npx'],
    argsPrefix: ['--no-install'],
  },

  // ── Node ────────────────────────────────────────────────────────────
  // cmd-verify:npm-test  →  npm test --silent
  {
    idPattern: /^cmd-verify:npm-test$/,
    commands: ['npm'],
    argsPrefix: ['test', '--silent'],
  },

  // ── Python ──────────────────────────────────────────────────────────
  // cmd-verify:pytest  →  pytest -q --tb=short
  {
    idPattern: /^cmd-verify:pytest$/,
    commands: ['pytest'],
    argsPrefix: ['-q', '--tb=short'],
  },

  // ── Git (autobot-managed rollback/stage/commit) ───────────────────
  // cmd-stage:git-add:<path>  →  git add <path>
  {
    idPattern: /^cmd-stage:git-add:/,
    commands: ['git'],
    argsPrefix: ['add'],
  },
  // cmd-rollback:git-restore:<path>  →  git restore <path>
  {
    idPattern: /^cmd-rollback:git-restore:/,
    commands: ['git'],
    argsPrefix: ['restore'],
  },
  // cmd-commit:git-reset:<path>  →  git reset HEAD <path>
  {
    idPattern: /^cmd-commit:git-reset:/,
    commands: ['git'],
    argsPrefix: ['reset', 'HEAD'],
  },
]

/**
 * Why install / mkdir / cp are NOT in {@link EXPLICIT_SAFE_SHAPES}.
 *
 * This whitelist means "run with NO confirmation". Deliberately:
 * <ul>
 *   <li><b>install</b> (pip/npm/go install, id prefix {@code cmd-setup:}) — the
 *       backend emits it as a {@code run} command with
 *       {@code requires_confirmation=true} (Gap 1). It mutates the environment
 *       and hits the network, so it MUST prompt. Auto-whitelisting it would
 *       silently bypass the very confirmation the backend gate is meant to
 *       enforce. Handled in {@code WorkspacePanel} run branch → confirm dialog.</li>
 *   <li><b>mkdir</b> (id prefix {@code cmd-mkdir:}) — a dedicated {@code mkdir}
 *       action handled in {@code WorkspacePanel} via Node fs directly; it never
 *       reaches {@link shouldRequireConfirmation} and carries no confirmation,
 *       which is equivalent to being auto-safe at the component level.</li>
 *   <li><b>cp</b> (id prefix {@code cmd-cp:}) — a dedicated {@code cp} action
 *       with {@code requires_confirmation=true} (Gap 2). Copying mutates the
 *       workspace, so it must prompt. Handled in {@code WorkspacePanel} cp
 *       branch → confirm dialog.</li>
 * </ul>
 * Adding any of these here would create a privilege-escalation hole, so they
 * stay gated where they belong.
 */

/**
 * Test whether a {@code run} command matches the explicit-safe whitelist.
 * Returns {@code true} if and only if id + command + args-prefix all line
 * up with one of the {@link EXPLICIT_SAFE_SHAPES}.
 *
 * <p>Defence layers in order of decreasing trust:</p>
 * <ol>
 *   <li>This whitelist (most specific; narrow contract)</li>
 *   <li>Backend {@code requires_confirmation} flag (set per-call by the
 *       language adapter)</li>
 *   <li>User session trust list (opt-in during a previous confirmation)</li>
 *   <li>Blacklist regex scan (last-resort fuzzy match)</li>
 * </ol>
 */
export function isExplicitlySafe(cmd) {
  if (!cmd || cmd.action !== 'run') return false
  const id = String(cmd.id || '')
  const command = String(cmd.command || '').trim()
  const args = Array.isArray(cmd.args) ? cmd.args.map((a) => String(a)) : []
  if (!id || !command) return false

  for (const shape of EXPLICIT_SAFE_SHAPES) {
    if (!shape.idPattern.test(id)) continue
    if (!shape.commands.includes(command)) continue
    if (args.length < shape.argsPrefix.length) continue
    let prefixOk = true
    for (let i = 0; i < shape.argsPrefix.length; i++) {
      if (args[i] !== shape.argsPrefix[i]) { prefixOk = false; break }
    }
    if (prefixOk) return true
  }
  return false
}

/**
 * Detect whether a {@code run} command should require user confirmation
 * before execution. Returns a human-readable reason, or {@code null} if
 * the command looks safe.
 *
 * @param {object} cmd - The parsed command object (with .action, .command, .args).
 * @param {object} [options] - { trustedPatterns?: string[] }
 * @returns {string | null} Confirmation reason, or null if safe.
 */
export function shouldRequireConfirmation(cmd, options = {}) {
  if (!cmd || typeof cmd !== 'object') return null
  if (cmd.action !== 'run') return null

  const command = String(cmd.command || '').trim()
  const args = Array.isArray(cmd.args) ? cmd.args.map(String) : []
  const fullCommandLine = [command, ...args].join(' ')

  // 0a) Explicit whitelist — narrow contract: id + command + args-prefix
  //     must line up with one of the EXPLICIT_SAFE_SHAPES entries. This is
  //     the most specific signal and short-circuits the prompt for known
  //     toolchain invocations (mvn test, go build, tsc, pytest, ...).
  //     Defense-in-depth: even if the backend forgets to set
  //     requires_confirmation=false, the shape re-check still applies.
  if (isExplicitlySafe(cmd)) {
    return null
  }

  // 0b) Trust list (session-scoped, localStorage backed). The user can opt
  //     into a pattern during a previous confirmation dialog ("trust for the
  //     rest of this session"). When a pattern matches, skip the prompt.
  const trusted = options.trustedPatterns || loadTrustedPatterns()
  if (trusted && trusted.length > 0) {
    for (const pattern of trusted) {
      if (patternMatches(pattern, fullCommandLine)) {
        return null
      }
    }
  }

  // 1) Backend signal
  if (cmd.requires_confirmation === true) {
    return 'Backend marked this run command as requiring confirmation.'
  }

  // 2) Top-level forbidden commands
  const top = command.toLowerCase()
  if (FORBIDDEN_TOP_LEVEL_COMMANDS.has(top)) {
    return `Forbidden top-level command: ${top}`
  }

  // 3) Pattern scan
  for (const { regex, label } of COMPILED_DANGEROUS_PATTERNS) {
    if (regex.test(fullCommandLine)) {
      return `Dangerous pattern detected: ${label}`
    }
  }

  return null
}

// ── Session-scoped trust list ─────────────────────────────────────────

const TRUST_STORAGE_KEY = 'autobot.trustedCommandPatterns'

/**
 * Read the session's trusted command patterns from localStorage. Returns
 * an array of strings (regex or literal substrings); empty if storage is
 * unavailable (e.g. server-side rendering).
 */
export function loadTrustedPatterns() {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(TRUST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch (e) {
    return []
  }
}

/**
 * Persist a new pattern to the session trust list. Patterns are matched
 * literally or as substring regex; callers should pass a pattern that
 * uniquely identifies the command (e.g. {@code "^mvn\\s+-q\\s+test$"} or
 * {@code "go test ./..."}).
 */
export function addTrustedPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return
  const existing = loadTrustedPatterns()
  if (existing.includes(pattern)) return
  existing.push(pattern)
  try {
    window.localStorage.setItem(TRUST_STORAGE_KEY, JSON.stringify(existing))
  } catch (e) {
    // ignore quota errors
  }
}

/**
 * Drop all session trust. Called from settings or a "reset" button.
 */
export function clearTrustedPatterns() {
  try {
    window.localStorage.removeItem(TRUST_STORAGE_KEY)
  } catch (e) {
    // ignore
  }
}

/**
 * Build a pattern string from a command line. The pattern is a regex that
 * matches {@code command + ' ' + args.join(' ')} literally, but with
 * {@code \s+} for the spaces so multi-space and trim variants match.
 */
export function patternFromCommand(fullCommandLine) {
  // Escape regex metacharacters, then collapse whitespace runs into \s+
  const escaped = fullCommandLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.replace(/\s+/g, '\\s+')
}

/**
 * Test whether a stored pattern matches a candidate command line. The
 * pattern is a regex source (escaped); the candidate is matched as-is.
 */
function patternMatches(pattern, candidate) {
  try {
    return new RegExp(pattern, 'i').test(candidate)
  } catch (e) {
    return false
  }
}

/**
 * Build a short human-readable summary of the command for the confirmation
 * dialog.
 */
export function formatCommandSummary(cmd) {
  if (!cmd) return ''
  const command = cmd.command || '(no command)'
  const args = Array.isArray(cmd.args) ? cmd.args : []
  const full = [command, ...args].join(' ').trim()
  if (full.length > 240) return full.substring(0, 240) + '...'
  return full || '(empty command)'
}
