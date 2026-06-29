#!/usr/bin/env node
// Autobot 桌面壳 — 跨平台一键 build (auto target).
// 等价于:
//   1. vite build (生成 dist)
//   2. 复制 dist 到 desktop/resources/frontend
//   3. 按当前平台调 electron-builder 对应 target
//   - win   → nsis + portable
//   - mac   → dmg + zip
//   - linux → AppImage + deb
//   - other → dir (不解包)
// 用法: node scripts/build-desktop-auto.js  (或在 frontend 根目录 npm run desktop:dist:auto)
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.resolve(__dirname, '..');
const desktop = path.join(root, 'desktop');

function run(cmd, args, cwd) {
  console.log(`\n[build-desktop-auto] > ${cmd} ${args.join(' ')}  (cwd=${path.relative(root, cwd)})`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd, shell: false });
  if (r.status !== 0) {
    console.error(`[build-desktop-auto] FAIL: ${cmd} exited ${r.status}`);
    process.exit(r.status || 1);
  }
}

function which(cmd) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const ext of exts) {
    const tryCmd = cmd + ext;
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [tryCmd], { encoding: 'utf8' });
    if (r.status === 0) return tryCmd;
  }
  return null;
}

// 1) 装 desktop deps
if (!fs.existsSync(path.join(desktop, 'node_modules'))) {
  run('npm', ['install'], desktop);
}

// 2) vite build
run('npm', ['run', 'build'], root);

// 3) copy-frontend
run('node', ['scripts/copy-frontend.js'], desktop);

// 4) pick target
let target;
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLin = process.platform === 'linux';
if (isWin) target = 'dist:win';
else if (isMac) target = 'dist:mac';
else if (isLin) target = 'dist:linux';
else target = 'dist:dir';

console.log(`[build-desktop-auto] platform=${process.platform} -> target=${target}`);
run('npm', ['run', target], desktop);

console.log(`\n[build-desktop-auto] OK -> ${path.join(desktop, 'release')}`);
