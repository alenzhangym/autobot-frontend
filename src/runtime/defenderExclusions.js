/**
 * defenderExclusions —— 客户端（sidecar）统一持有"我服务哪些项目根"，并据此管理 Windows
 * Defender 排除项集合。
 *
 * <p><b>为什么归客户端所有</b>：同一个 sidecar 会给多台/多个工作区服务，排除项必须是"这台机器
 * 上我负责的所有项目"这一<b>集合</b>，而不是后端某次请求里的<b>单条路径</b>。后端只发
 * {@code __CMD__{action:"defender_exclude"}} 这一件事，排除哪些目录由客户端自算。</p>
 *
 * <p><b>能力边界（如实）</b>：读 {@code Get-MpPreference} 免管理员；写
 * {@code Add-MpPreference} <b>必须</b>管理员，只能靠 UAC 弹框，无法静默。加入排除项 = 降低该目录
 * 的实时防护，这是明确的取舍，不是"修复"。因此 {@code ensure} 只增不减、只在用户确认后执行，
 * 且以"重新读取排除列表"为准判定是否真的生效（提权进程自身不返回值，不靠它自称成功）。</p>
 *
 * <p>本模块只放纯逻辑与脚本拼装，不 spawn 进程；进程调用留在 server.js，便于单测。</p>
 */
import fs from 'fs'
import path from 'path'

/** 读取排除列表的 PowerShell：免管理员。空数组用 -InputObject 才稳定输出 `[]`。 */
export const READ_EXCLUSIONS_SCRIPT =
  'ConvertTo-Json -InputObject @(Get-MpPreference | Select-Object -ExpandProperty ExclusionPath) -Compress'

/**
 * 归一化一个路径，专用于"是否已覆盖"的比较：把分隔符统一成 `/`、去掉尾部斜杠、小写。
 * 不做真实文件系统解析（排除项是字符串比较；盘根保留 `c:` 形态）。
 */
export function normalizeForCompare(p) {
  let s = String(p == null ? '' : p).trim()
  if (!s) return ''
  s = s.replace(/\\/g, '/').replace(/\/+$/, '')
  return s.toLowerCase()
}

/**
 * 判断某个项目路径是否已被现有排除列表覆盖。
 * 覆盖 = 存在一条排除项与项目同路径，或是项目的祖先目录（例如排除 `E:\code` 覆盖其下所有项目）。
 * 单条排除项若是文件路径，不会覆盖目录项目（字符串前缀匹配够用，且不会误报）。
 */
export function isCovered(projectPath, exclusions) {
  const proj = normalizeForCompare(projectPath)
  if (!proj) return false
  for (const raw of Array.isArray(exclusions) ? exclusions : []) {
    const ex = normalizeForCompare(raw)
    if (!ex) continue
    if (proj === ex) return true
    if (proj.startsWith(ex + '/')) return true
  }
  return false
}

/**
 * 从"已登记的项目集"里挑出**尚未被排除**的那些。返回去重后的原始路径（保持注册时的写法）。
 */
export function missingProjects(projects, exclusions) {
  const out = []
  const seen = new Set()
  for (const p of Array.isArray(projects) ? projects : []) {
    const key = normalizeForCompare(p)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (!isCovered(p, exclusions)) out.push(p)
  }
  return out
}

/** PowerShell 单引号字符串转义：`'` → `''`。用于把路径安全嵌进脚本，杜绝注入。 */
export function psSingleQuote(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"
}

/**
 * 生成内层（提权后真正执行）脚本：批量加排除项，并把结果写到结果文件。
 * 只加不删；一条命令内 `-ExclusionPath @(...)` 批量处理，避免多次 UAC。
 */
export function buildAddScript(paths, resultFile) {
  const list = (Array.isArray(paths) ? paths : [])
    .map((p) => String(p == null ? '' : p).trim())
    .filter(Boolean)
  const arr = list.length ? list.map(psSingleQuote).join(',') : ''
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  Add-MpPreference -ExclusionPath @(${arr})`,
    `  Set-Content -Path ${psSingleQuote(resultFile)} -Value 'OK' -Encoding UTF8`,
    '} catch {',
    `  Set-Content -Path ${psSingleQuote(resultFile)} -Value ('ERR: ' + $_.Exception.Message) -Encoding UTF8`,
    '  exit 1',
    '}',
    '',
  ].join('\n')
}

/**
 * 生成外层脚本：以管理员身份启动内层脚本并等待。`-Verb RunAs` 是唯一能发起 UAC 提升的方式；
 * 用户取消 UAC 时 Start-Process 抛异常，写入结果文件便于如实回报。
 */
export function buildElevateScript(innerScriptPath, resultFile) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru ' +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psSingleQuote(innerScriptPath)})`,
    '  exit $p.ExitCode',
    '} catch {',
    `  Set-Content -Path ${psSingleQuote(resultFile)} -Value ('ERR: ' + $_.Exception.Message) -Encoding UTF8`,
    '  exit 1',
    '}',
    '',
  ].join('\n')
}

/** 解析 `Get-MpPreference` 的 JSON 输出 → 字符串数组（空/畸形一律回 []，绝不编造）。 */
export function parseExclusionsJson(stdout) {
  const text = String(stdout == null ? '' : stdout).trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    return arr.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
  } catch {
    return []
  }
}

// ── 项目集持久化（sidecar 自身状态文件，与 monitor-config.json 同目录习惯）──

/** 读已登记项目集；文件缺失/畸形 → []。 */
export function loadProjects(storeFile) {
  try {
    if (!storeFile || !fs.existsSync(storeFile)) return []
    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
    const list = Array.isArray(raw?.projects) ? raw.projects : []
    return list.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
  } catch {
    return []
  }
}

/** 覆盖写项目集（原子写：临时文件 + rename）。 */
export function saveProjects(storeFile, projects) {
  const list = (Array.isArray(projects) ? projects : [])
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim())
  const dir = path.dirname(storeFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = storeFile + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ projects: list, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
  fs.renameSync(tmp, storeFile)
  return list
}

/**
 * 登记一个项目根（幂等：按归一化路径去重，保留先注册的写法）。返回更新后的全集。
 */
export function registerProject(storeFile, projectPath) {
  const p = String(projectPath == null ? '' : projectPath).trim()
  if (!p) return loadProjects(storeFile)
  const current = loadProjects(storeFile)
  const key = normalizeForCompare(p)
  if (current.some((x) => normalizeForCompare(x) === key)) return current
  return saveProjects(storeFile, [...current, p])
}