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
  // 原 target 硬编码 127.0.0.1:3000, 但 dev 模式下没有 3000 端口的 standalone agent 在跑,
  // 导致 ECONNREFUSED 3000. auth.js 的 getLocalAgentBaseUrl() 也用 window.location.port,
  // 即 dev 模式下本地 agent 应与前端同端口 (5173), standalone 才是 3000.
  // 这里用 localhost 而非 127.0.0.1, 与 auth.js 保持一致.
  const localAgentTarget = `http://localhost:${port}`;

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
        '/api/local': {
          target: localAgentTarget,
          changeOrigin: true
        }
      }
    },
    preview: {
      host: '0.0.0.0',
      port: port,
    }
  }
})
