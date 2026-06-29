// P7-7: 把 autobot-frontend/dist 复制到 autobot-frontend/desktop/resources/frontend,
// 供 electron-builder 通过 extraResources 打包进最终 app 的 resources/frontend.
// 用 fs.cpSync 递归复制 (Node 16.7+).
// 路径基于 desktop/scripts/ 位置计算:
//   SRC = ../../dist          (autobot-frontend/dist)
//   DST = ../resources/frontend (autobot-frontend/desktop/resources/frontend)
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'dist');
const DST = path.resolve(__dirname, '..', 'resources', 'frontend');

if (!fs.existsSync(SRC)) {
  console.error('[copy-frontend] 源目录不存在:', SRC);
  console.error('[copy-frontend] 请先在 autobot-frontend 跑: npm run build');
  process.exit(1);
}

// 清理旧产物
if (fs.existsSync(DST)) {
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });

// 递归复制
fs.cpSync(SRC, DST, { recursive: true });

// 统计文件数
const count = (function countDir(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countDir(path.join(dir, e.name));
    else n++;
  }
  return n;
})(DST);

console.log(`[copy-frontend] OK: ${count} file(s) -> ${path.relative(process.cwd(), DST)}`);
