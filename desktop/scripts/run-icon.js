// 跨平台 icon 生成入口 — windows 调 .ps1, mac/linux 调 .sh.
// npm scripts 透传: desktop:icon / desktop:icon:win / desktop:icon:mac / desktop:icon:linux.
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const plat = os.platform();
let cmd, cmdArgs;
if (plat === 'win32') {
  cmd = 'powershell';
  cmdArgs = ['-ExecutionPolicy', 'Bypass', '-File', 'build/gen-icon.ps1', ...args];
} else {
  cmd = 'bash';
  cmdArgs = ['build/gen-icon.sh', ...args];
}
const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: false });
process.exit(r.status ?? 1);
