import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pkg from './package.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const generateVersionFile = () => {
  return {
    name: 'generate-version-file',
    writeBundle() {
      const versionData = {
        version: pkg.version,
        timestamp: Date.now()
      }
      fs.writeFileSync(
        path.resolve(__dirname, 'dist', 'version.json'),
        JSON.stringify(versionData, null, 2)
      )
    }
  }
}

/**
 * 前端本地日志落盘插件。
 * 前端浏览器通过 appendLiveLog → POST /api/local/frontend-log 发送日志，
 * 本插件在 Vite dev server 中直接处理该请求，追加写入 java-backend/logs/frontend.log。
 * 不依赖外部 server.js，保证开发模式下日志也能正常落盘。
 */
const frontendLogPlugin = () => {
  return {
    name: 'frontend-log',
    configureServer(server) {
      console.log('[frontend-log] Vite plugin loaded, registering middleware')
      // 使用 Connect 中间件拦截 /api/local/frontend-log 请求。
      // Vite 在 configureServer 之后才添加 proxy 中间件，所以我们的中间件先执行。
      // 对于匹配的请求不调用 next()，代理中间件不会处理该请求。
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST') return next()
        const url = req.url || ''
        if (!url.endsWith('/api/local/frontend-log')) return next()

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { line, sessionId } = JSON.parse(body)
            if (!line) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              return res.end(JSON.stringify({ ok: false }))
            }
            // 日志目录: java-backend/logs/
            const logsDir = path.resolve(__dirname, '..', 'java-backend', 'logs')
            fs.mkdirSync(logsDir, { recursive: true })
            const timestamp = new Date().toISOString()
            const logLine = `[${timestamp}]${sessionId ? ` [${sessionId}]` : ''} ${line}\n`
            fs.appendFileSync(path.join(logsDir, 'frontend.log'), logLine, 'utf-8')
            console.log(`[frontend-log] Wrote ${line.length} bytes to frontend.log`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            console.warn('[frontend-log] Vite plugin write failed:', e.message)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false }))
          }
        })
      })
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = parseInt(env.VITE_PORT || '5173', 10);
  // 2026-08-25: /api/local/* 代理目标指向 Express 本地代理服务 (server.js).
  // 之前设置为 http://localhost:${port} 指向 Vite 自身，导致 /api/local/status 等请求
  // 陷入自代理循环。Express 服务默认运行在 3000 端口，提供 /api/local/status 等端点。
  // 注意: /api/local/frontend-log 由 frontendLogPlugin 中间件在 proxy 之前处理，
  //       不会进入代理，不受此目标影响。
  const localAgentPort = parseInt(env.VITE_LOCAL_AGENT_PORT || '3000', 10);
  const localAgentTarget = `http://localhost:${localAgentPort}`;
  // 2026-07-25: 后端 API 代理目标. dev server 和后端通常在同一台机器,
  // 用 localhost 避免公网 IP 的 NAT 回环问题(路由器/防火墙可能拦截从内网访问自己公网 IP).
  // 如果后端在另一台机器, 用环境变量 VITE_BACKEND_TARGET 指定.
  const backendTarget = env.VITE_BACKEND_TARGET || 'http://localhost:8000';

  return {
    // 相对路径 base — 让 build 产物可通过 file:// 加载 (Electron 桌面壳需要)
    base: './',
    plugins: [react(), generateVersionFile(), frontendLogPlugin()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version)
    },
    server: {
      host: '0.0.0.0',
      port: port,
      proxy: {
        // /api/local/* 代理到当前 dev server (本地 agent)
        // 注意: /api/local/frontend-log 由 Vite 插件 frontendLogPlugin 直接处理,
        //       此处通过 bypass 排除, 避免代理回自身形成循环.
        '/api/local': {
          target: localAgentTarget,
          changeOrigin: true,
          bypass(req) {
            if (req.url && req.url.includes('/frontend-log')) {
              return req.url // 绕过代理, 由 Vite 插件 frontendLogPlugin 处理
            }
          }
        },
        // /api/* 代理到后端 (2026-07-25 新增)
        // 注意: /api/local 必须在 /api 之前, 否则会被 /api 先匹配.
        // 不用 changeOrigin — 后端是 HTTP, 不需要修改 Host header,
        // 且 changeOrigin 曾导致 chunked 响应 body 丢失.
        '/api': {
          target: backendTarget,
          changeOrigin: false,
          secure: false
        }
      }
    },
    preview: {
      host: '0.0.0.0',
      port: port,
      proxy: {
        '/api/local': {
          target: localAgentTarget,
          changeOrigin: true,
          bypass(req) {
            if (req.url && req.url.includes('/frontend-log')) {
              return req.url
            }
          }
        },
        '/api': {
          target: backendTarget,
          changeOrigin: false,
          secure: false
        }
      }
    }
  }
})
