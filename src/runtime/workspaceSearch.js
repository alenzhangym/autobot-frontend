// ─────────────────────────────────────────────────────────────────────────────
// [F37②] 本地工作区搜索原语 — 与后端 ScoutLookupService(纯 Java NIO + PathMatcher)
// 同一语义的 JS 版, 供 server.js 的 /api/local/workspace/search 使用。
//
// 为什么需要它: 当工作区在**另一台机器**上(后端看不到磁盘)时, 后端只能请本地代理搜;
// 而 agent 输出的 __FIND__:<glob> / __GREP__:<正则>[|<glob>] 要在这里落地。
//
// 三条不变量:
//   1. **只回路径** —— glob 模式回路径列表; grep 模式只回 {path, line}, **绝不回内容行**
//      (内容由随后的 read 提供; 把命中上下文灌回去等于绕过了读取预算)。
//   2. **有界** —— 命中数 ≤ MAX_HITS、文件数 ≤ MAX_WALK_FILES、单文件 ≤ MAX_FILE_BYTES、
//      深度 ≤ maxDepth, 一律跳过 DEFAULT_SKIP_DIRS 与隐藏目录。
//   3. **纯只读** —— 除 readdir/stat/read 外不做任何副作用; 不依赖 express/React, 可单测。
//
// 已知边界: 正则用的是 JS RegExp 语法 —— Java 的内联标志 ((?i)/(?m)/(?s)) 在 JS 里非法,
// 会在编译期抛错(调用方据此如实回一条"请改用别写法"的提示), 不做静默改写。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'

/** 与 server.js DEFAULT_WORKSPACE_SKIP_DIRS / 后端 WorkspaceIndexService.DEFAULT_SKIP_DIRS 同族。 */
export const DEFAULT_SKIP_DIRS = new Set([
  '.git', 'node_modules', '.worktrees', '.claude', '.deepseek',
  'target', 'dist', 'build', '__pycache__', '.next', '.idea', '.vscode',
  'venv', '.venv', '.npm', '.yarn', '.pnpm-store', 'coverage', 'out'
])

/** 与后端 ScoutLookupService.TEXT_EXTENSIONS 同族 —— grep 只扫"看起来像文本"的文件。 */
export const TEXT_EXTENSIONS = new Set([
  'java', 'kt', 'kts', 'scala', 'groovy', 'js', 'jsx', 'ts', 'tsx', 'mjs',
  'py', 'rb', 'go', 'rs', 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'hxx',
  'cs', 'swift', 'm', 'mm', 'php', 'lua', 'pl', 'sh', 'bash', 'zsh',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'json', 'yaml',
  'yml', 'toml', 'ini', 'cfg', 'conf', 'md', 'markdown', 'txt', 'sql'
])

export const MAX_HITS = 200
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_WALK_FILES = 20000
export const MAX_DEPTH = 12
export const DEFAULT_MAX_RESULTS = 50
export const MAX_MAX_RESULTS = 200

const REGEX_METACHARS = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])

/**
 * glob → RegExp。语义对齐 Java `FileSystems.getDefault().getPathMatcher("glob:...")`:
 *   - `**\/` 匹配任意层(含零层): `**\/X.java` 命中 `X.java` 与 `a/b/X.java`
 *   - `*` 只在**单层内**匹配(不跨 `/`), `?` 匹配一个非 `/` 字符
 * 路径统一用 `/` 分隔(调用方传 rel posix), 因此这里不做大小写折叠(与 Java 侧一致, 区分大小写)。
 */
export function globToRegExp(glob) {
  const g = String(glob == null ? '' : glob).replace(/\\/g, '/')
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]
    if (ch === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:[^/]+/)*'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      continue
    }
    re += REGEX_METACHARS.has(ch) ? '\\' + ch : ch
  }
  return new RegExp('^' + re + '$')
}

/** 相对路径是否命中任一 glob(空列表 = 不过滤, 与后端 `grep(pattern, [])` 语义一致)。 */
export function matchesAnyGlob(relPath, globs) {
  const list = Array.isArray(globs) ? globs.filter(Boolean) : (globs ? [String(globs)] : [])
  if (list.length === 0) return true
  const posix = String(relPath).replace(/\\/g, '/')
  return list.some((g) => globToRegExp(g).test(posix))
}

/** 是否"看起来像文本"(按扩展名, 与后端 isTextish 同口径)。 */
export function isTextFile(relPath) {
  const base = String(relPath).replace(/\\/g, '/').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return false
  return TEXT_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())
}

/** 有界递归列出文件(相对 root 的 posix 路径)。跳过隐藏项与 DEFAULT_SKIP_DIRS。 */
export function walkWorkspaceFiles(rootPath, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : MAX_DEPTH
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : MAX_WALK_FILES
  const rootAbs = path.resolve(rootPath)
  const files = []
  let truncated = false
  const stack = [[rootAbs, 0]]

  while (stack.length > 0) {
    const [dir, depth] = stack.pop()
    if (depth > maxDepth) continue
    let items = []
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch (_) {
      continue // 权限/消失等单目录失败不影响整体
    }
    for (const item of items) {
      if (files.length >= maxFiles) {
        truncated = true
        break
      }
      if (item.name.startsWith('.') || DEFAULT_SKIP_DIRS.has(item.name)) continue
      const full = path.join(dir, item.name)
      if (item.isDirectory()) {
        stack.push([full, depth + 1])
      } else if (item.isFile()) {
        files.push({ abs: full, rel: path.relative(rootAbs, full).replace(/\\/g, '/') })
      }
    }
  }
  return { files, truncated }
}

/**
 * 本地搜索入口。
 *
 * @param {string} rootPath 工作区根(绝对路径)
 * @param {object} options  { mode: 'glob'|'grep', pattern, globs, maxResults, maxDepth }
 * @returns {{root, mode, pattern, count, paths, hits, files_scanned, truncated}}
 *   - glob: paths = 命中文件路径; hits = []
 *   - grep: paths = 命中文件路径(去重); hits = [{path, line}] —— **不含内容行**
 * @throws {SyntaxError} 正则在 JS 里不合法(调用方据此回一条"换写法"的提示)
 */
export function searchWorkspace(rootPath, options = {}) {
  const mode = options.mode === 'grep' ? 'grep' : 'glob'
  const pattern = String(options.pattern == null ? '' : options.pattern)
  const globs = Array.isArray(options.globs) ? options.globs.filter(Boolean) : []
  const wanted = Number.isFinite(options.maxResults) ? options.maxResults : DEFAULT_MAX_RESULTS
  const maxResults = Math.min(MAX_MAX_RESULTS, Math.max(1, wanted))

  const rootAbs = path.resolve(rootPath)
  const walked = walkWorkspaceFiles(rootAbs, { maxDepth: options.maxDepth })

  if (mode === 'glob') {
    const matcher = pattern.trim() === '' ? null : globToRegExp(pattern)
    const paths = []
    for (const f of walked.files) {
      if (paths.length >= maxResults) break
      if (!isTextFile(f.rel)) continue
      if (matcher && !matcher.test(f.rel)) continue
      paths.push(f.rel)
    }
    paths.sort()
    return {
      root: rootAbs,
      mode,
      pattern,
      count: paths.length,
      paths,
      hits: [],
      files_scanned: walked.files.length,
      truncated: walked.truncated || paths.length >= maxResults
    }
  }

  // grep: 只扫文本文件 + 单文件大小上限; 命中只记 path:line
  const regex = new RegExp(pattern)
  const hits = []
  const paths = []
  const seen = new Set()
  let filesScanned = 0
  for (const f of walked.files) {
    if (paths.length >= maxResults || hits.length >= MAX_HITS) break
    if (!isTextFile(f.rel)) continue
    if (!matchesAnyGlob(f.rel, globs)) continue
    let size = 0
    try {
      size = fs.statSync(f.abs).size
    } catch (_) {
      continue
    }
    if (size <= 0 || size > MAX_FILE_BYTES) continue
    let content = ''
    try {
      content = fs.readFileSync(f.abs, 'utf-8')
    } catch (_) {
      continue
    }
    filesScanned += 1
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= MAX_HITS) break
      if (!regex.test(lines[i])) continue
      hits.push({ path: f.rel, line: i + 1 })
      if (!seen.has(f.rel)) {
        seen.add(f.rel)
        paths.push(f.rel)
      }
    }
  }
  paths.sort()
  hits.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)))
  return {
    root: rootAbs,
    mode,
    pattern,
    count: paths.length,
    paths,
    hits,
    files_scanned: filesScanned,
    truncated: walked.truncated || paths.length >= maxResults || hits.length >= MAX_HITS
  }
}