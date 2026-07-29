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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = parseInt(env.VITE_PORT || '5173', 10);
  // 2026-07-21: /api/local/* 代理目标动态指向当前 dev server 端口.
  const localAgentTarget = `http://localhost:${port}`;
  // 2026-07-25: 后端 API 代理目标. dev server 和后端通常在同一台机器,
  // 用 localhost 避免公网 IP 的 NAT 回环问题(路由器/防火墙可能拦截从内网访问自己公网 IP).
  // 如果后端在另一台机器, 用环境变量 VITE_BACKEND_TARGET 指定.
  const backendTarget = env.VITE_BACKEND_TARGET || 'http://localhost:8000';

  return {
    // 相对路径 base — 让 build 产物可通过 file:// 加载 (Electron 桌面壳需要)
    base: './',
    plugins: [react(), generateVersionFile()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version)
    },
    server: {
      host: '0.0.0.0',
      port: port,
      proxy: {
        // /api/local/* 代理到当前 dev server (本地 agent)
        '/api/local': {
          target: localAgentTarget,
          changeOrigin: true
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
          changeOrigin: true
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
