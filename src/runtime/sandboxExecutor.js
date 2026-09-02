// ─────────────────────────────────────────────────────────────────────────────
// P2-7 沙箱 OS 级强制 — 可选执行层（默认关闭）
//
// 设计文档: docs/architecture/sandbox-os-level-enforcement-design.md
//
// 职责: 统一执行入口, 按开关分发到「本地直连」或「容器执行」。
//   - sandbox.enabled === false → runLocal: 与现状完全一致的 execFile (argv-only)。
//   - sandbox.enabled === true  → runDocker: 在预创建 Docker 容器内 `docker exec` 执行。
//
// 设计要点:
//   - 预创建容器 + 复用（避免每次 docker run 的启动开销）。
//   - 网络默认隔离（--network none, 仅在容器创建时生效）。
//   - 资源上限（--memory / --cpus, 容器创建时固定）。
//   - 工作区只读挂载（readOnlyWorkspace → /workspace:ro）。
//   - 沙箱不替代 agentCommandSafety / StepPermissionGuard —— 它是叠加的 OS 级强制层。
//
// 已知限制（Phase 1, reuse 模式）:
//   - `docker exec` 客户端超时被 Node 杀掉时, 容器内进程可能残留（共享容器不宜整容器 stop）。
//     长任务隔离的 per-task 容器模式属于 Phase 2。
//   - Windows 宿主机命令解析出的 .cmd/.bat 在 Linux 容器内不存在; 沙箱场景下应直接传
//     容器内可用的可执行名（node/python/git 等）。
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'child_process'

const DOCKER_BIN = process.env.AUTOBOT_SANDBOX_DOCKER_BIN || 'docker'
const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024
const CONTAINER_MOUNT = '/workspace'

/**
 * 执行一条命令。sandbox 开启时通过 docker exec 在预创建容器内运行,
 * 否则走本地 execFile（保持现状）。
 *
 * @param {object} opts { command, args, cwd, timeoutMs, hostTempFile }
 * @param {object} sandbox 沙箱配置（enabled/image/containerName/network/...）
 * @returns {Promise<{output: string, exitCode: number, timedOut: boolean}>}
 */
export function runInSandbox(opts, sandbox) {
  if (!sandbox || !sandbox.enabled) return runLocal(opts)
  return runDocker(opts, sandbox)
}

/**
 * 本地直连执行（默认路径, 与既有 server.js 行为一致）。
 */
export function runLocal({ command, args = [], cwd, timeoutMs = 60_000, maxBuffer = DEFAULT_MAX_BUFFER }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = execFile(command, args, {
        cwd: cwd || process.cwd(),
        timeout: timeoutMs,
        maxBuffer,
        windowsHide: true,
        // shell:false 是 execFile 默认; 保持 argv-only
      }, (error, stdout, stderr) => {
        if (!error) {
          resolve({ output: (stdout || '') + (stderr || ''), exitCode: 0, timedOut: false })
          return
        }
        const timedOut = !!error.killed && error.signal === 'SIGTERM' && error.code === null
        resolve({
          output: (stdout || '') + (stderr || ''),
          exitCode: typeof error.code === 'number' ? error.code : 1,
          timedOut,
        })
      })
    } catch (e) {
      reject(e)
      return
    }
    child.on('error', reject)
  })
}

/**
 * 容器执行路径。复用按工作区预创建的容器, `docker exec` 运行命令。
 */
export async function runDocker(opts, sandbox) {
  const container = await ensureContainer(opts.cwd, sandbox)
  const dockerArgs = buildDockerExecArgs(opts, container)
  return execDocker(dockerArgs, opts.timeoutMs || 60_000)
}

/**
 * 纯函数: 构建 `docker exec` 的 argv（可单测, 无需真实 docker）。
 * 宿主临时文件绝对路径被改写为容器内 /workspace/<basename>。
 */
export function buildDockerExecArgs({ command, args = [], cwd, hostTempFile }, container) {
  let effectiveArgs = args
  if (hostTempFile) {
    const base = String(hostTempFile).split(/[\\/]/).pop()
    effectiveArgs = args.map((a) => (a === String(hostTempFile) ? `${CONTAINER_MOUNT}/${base}` : a))
  }
  return [
    'exec',
    '--workdir', CONTAINER_MOUNT,
    '--env', `AUTOBOT_CWD=${cwd}`,
    container,
    command,
    ...effectiveArgs,
  ]
}

/**
 * 纯函数: 构建 `docker create` 的 argv。网络 / 资源 / 挂载仅在创建时生效,
 * 因此统一在此设置（docker exec 不支持 --network / --memory / --cpus）。
 */
export function buildCreateContainerArgs(workspace, sandbox, name) {
  const image = sandbox.image || 'autobot-runner:latest'
  const mount = `${workspace}:${CONTAINER_MOUNT}${sandbox.readOnlyWorkspace ? ':ro' : ''}`
  const args = ['create', '--name', name, '--restart', 'unless-stopped']
  if (sandbox.network === 'none') args.push('--network', 'none')
  if (sandbox.memory) args.push('--memory', String(sandbox.memory))
  if (sandbox.cpu) args.push('--cpus', String(sandbox.cpu))
  args.push('-v', mount, image, 'tail', '-f', '/dev/null')
  return args
}

// ── 预创建容器 + 复用（按工作区缓存, 避免每次 docker run 开销）────────────
async function ensureContainer(workspace, sandbox) {
  if (!sandbox._containers) sandbox._containers = new Map()
  const key = workspace ? String(workspace).replace(/[\\/]+$/, '') : '(root)'
  const cached = sandbox._containers.get(key)
  if (cached) return cached

  const base = sandbox.containerName || 'autobot-runner'
  const name = `${base}-${hashKey(key)}`
  const image = sandbox.image || 'autobot-runner:latest'

  // 同名容器已存在 → 直接复用（启动即可）
  const inspect = await execDocker(['inspect', '-f', '{{.State.Running}}', name], 15_000)
  if (inspect.exitCode === 0) {
    if (inspect.output.trim() !== 'true') await execDocker(['start', name], 15_000)
    sandbox._containers.set(key, name)
    return name
  }

  const createArgs = buildCreateContainerArgs(key, sandbox, name)
  const created = await execDocker(createArgs, 30_000)
  if (created.exitCode !== 0) {
    throw new Error(`sandbox container create failed (exit ${created.exitCode}): ${created.output}`)
  }
  await execDocker(['start', name], 15_000)
  sandbox._containers.set(key, name)
  return name
}

function execDocker(dockerArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = execFile(DOCKER_BIN, dockerArgs, {
        timeout: timeoutMs,
        maxBuffer: DEFAULT_MAX_BUFFER,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (!error) {
          resolve({ output: (stdout || '') + (stderr || ''), exitCode: 0, timedOut: false })
          return
        }
        const timedOut = !!error.killed && error.signal === 'SIGTERM' && error.code === null
        resolve({
          output: (stdout || '') + (stderr || ''),
          exitCode: typeof error.code === 'number' ? error.code : 1,
          timedOut,
        })
      })
    } catch (e) {
      reject(e)
      return
    }
    child.on('error', reject)
  })
}

// 稳定短哈希: 工作区绝对路径 → 容器名后缀
function hashKey(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}
