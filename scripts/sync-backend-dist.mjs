/**
 * [L0 双前端包收敛] 把 Vite 构建产物同步到后端实际服务的目录。
 *
 * <p>背景: 后端 `spring.web.resources.static-locations=file:./frontend-update/` 服务的是
 * `java-backend/frontend-update/`，而不是 `autobot-frontend/dist/`。此前**没有任何脚本**把两者
 * 连起来，于是"重建 dist"对 8000 端口那份 UI 完全无效，前端包可以静默陈旧数周（2026-10-02
 * 事故：服务中的包停在 2026-09-06，不认识 env_probe）。</p>
 *
 * <p>只替换 UI 部分（index.html / assets / wasm / 顶层静态文件 / version.json），
 * **不动**同目录下的安装包与 release zip —— 那些是 `/api/frontend/update/download` 要服务的。</p>
 *
 * <p>幂等: 连跑两次结果一致。dist 缺失 index.html 时**直接失败**，不写半个包。</p>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '..');
const distDir = path.join(frontendDir, 'dist');
const targetDir = path.resolve(frontendDir, '..', 'java-backend', 'frontend-update');

function die(msg) {
  console.error(`[sync-backend-dist] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  die(`dist/index.html 不存在 —— 请先运行 \`npm run build\`（dist=${distDir}）`);
}

// 1) 清掉上一版 UI（只清 UI，不碰安装包 / release zip / package.json / server.js）
const UI_DIRS = ['assets', 'wasm'];
const UI_FILES = ['index.html', 'version.json', 'vite.svg', 'echarts.min.js', 'tailwind.min.js'];
fs.mkdirSync(targetDir, { recursive: true });
for (const d of UI_DIRS) {
  fs.rmSync(path.join(targetDir, d), { recursive: true, force: true });
}
for (const f of UI_FILES) {
  fs.rmSync(path.join(targetDir, f), { force: true });
}

// 2) dist → target 递归拷贝
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(distDir, targetDir);

// 3) 写构建指纹（buildId = 本次产物入口文件名，唯一标识这一版包）
const assetsDir = path.join(targetDir, 'assets');
const entry = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).find((n) => /^index-.*\.js$/.test(n))
  : null;
if (!entry) die('同步后仍找不到 assets/index-*.js —— 产物形态异常');

const pkg = JSON.parse(fs.readFileSync(path.join(frontendDir, 'package.json'), 'utf-8'));
// Windows 上必须用 file:// URL，绝对路径（E:\...）会被 ESM loader 当成 "e:" 协议拒绝
const { FRONTEND_CAPABILITIES } = await import(
  pathToFileURL(path.join(frontendDir, 'src', 'runtime', 'frontendCapabilities.js')).href);
const versionFile = path.join(targetDir, 'version.json');
fs.writeFileSync(versionFile, JSON.stringify({
  version: pkg.version,
  timestamp: Date.now(),
  buildId: entry,
  features: FRONTEND_CAPABILITIES,
}, null, 2) + '\n', 'utf-8');

console.log(`[sync-backend-dist] OK  ${distDir}  ->  ${targetDir}`);
console.log(`[sync-backend-dist] buildId=${entry} features=${FRONTEND_CAPABILITIES.length}`);