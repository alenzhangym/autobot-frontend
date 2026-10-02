// ─────────────────────────────────────────────────────────────────────────────
// [L4] cwd 越界守卫 —— 反向通道下发的 cwd 必须落在用户选定的工作区内
//
// cwd 是命令/进程的**执行目录**：`run` 会在那里真跑命令，`proc_start` 会在那里常驻一个进程。
// 反向下发的 cwd 名义上是"工作区相对目录"，但前端 `resolveCommandPath` 对绝对路径原样透传、
// 对相对路径只做字符串拼接 —— `"../../.."` 或 `"C:\\Windows"` 都能一路走到工作区外，中间
// 没有任何人判过（F47 轮次文档 §12② 那笔"两处各写一遍"的老账的另一半）。
//
// 后端 `CodeEnvPrepareService.isCwdOutOfWorkspace` 是同一判据的第一道；这里是第二道，也是跨机
// 部署下**唯一够得到用户机器**的那一道（LocalAgentClient 打的是后端自己的 localhost），不能只信上游。
//
// 三态（不是两态）：
//   没给 workspace_root       → 判不了 → 返回 null，保持旧行为（老前端包不带这个字段，不臆断）；
//   给了且 cwd 在区内          → 返回 null，放行；
//   给了且 cwd 越界            → 返回一句可读理由，调用方**拒绝执行**（fail-closed）。
//
// 越界的代价不对称：让命令在错误目录跑一次（可能写坏用户别处的仓库），比拒绝一次糟得多。
// 判据交给 Node 的 `path`（Windows 的分隔符/大小写/跨盘符由它处理），不自己拼字符串。
// ─────────────────────────────────────────────────────────────────────────────
import path from 'path'

/**
 * @param {string} cwd            待判目录（可为相对/绝对/省略）
 * @param {string} workspaceRoot  工作区根（用户选定；缺省/空 = 判不了）
 * @returns {string|null} 越界理由（非 null = 拒绝）；null = 放行或判不了
 */
export function cwdGuard(cwd, workspaceRoot) {
  if (!workspaceRoot || typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) return null
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(cwd || root)
  const rel = path.relative(root, target)
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
  if (!outside) return null
  return `cwd 越界: ${target} 不在工作区 ${root} 内（拒绝在该目录执行；命令的 cwd 必须是工作区内目录）`
}

export default cwdGuard