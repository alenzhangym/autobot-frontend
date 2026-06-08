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

  return {
    plugins: [react(), generateVersionFile()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version)
    },
    server: {
      host: '0.0.0.0',
      port: port,
      proxy: {
        '/api/local': {
          target: 'http://127.0.0.1:3000',
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
