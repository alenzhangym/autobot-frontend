// Autobot 桌面壳 preload.
// P7-7: 暴露少量本地能力给前端, 让 webui 在桌面壳模式下:
//   ① 探测本地已装的 LSP binary (避免每次问后端)
//   ② spawn 子进程跑 LSP server / npm install -g (绕开浏览器 fetch 限制)
//   ③ download + extract (github via 的 LSP, 走 GitHub Releases 一键装)
// 仅在桌面壳上下文有效; 普通浏览器模式 window.autobotDesktop 为 undefined,
// 前端代码应 feature-detect.
//
// 注意: main.js 设 contextIsolation:false, 此时 contextBridge.exposeInMainWorld
// 不会生效, preload 直接在主世界执行, 因此直接挂 window.autobotDesktop.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { URL } = require('url');

/** 系统级"非 PATH 但二进制可能在的目录" — Go/Cargo/Cabal/Stack/Opam/Nimble 工具链默认 bin. */
function getExtraPaths() {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  // 顺序无关, fs.existsSync 过滤
  const candidates = isWin ? [
    path.join(home, 'go', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'AppData', 'Roaming', 'cabal', 'bin'),
    path.join(home, '.cabal', 'bin'),
    path.join(home, '.stack', 'bin'),
    path.join(home, '.opam', 'default', 'bin'),
    path.join(home, '.nimble', 'bin'),
    'C:\\Program Files\\Go\\bin',
    'C:\\go\\bin',
  ] : [
    path.join(home, 'go', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.cabal', 'bin'),
    path.join(home, '.stack', 'bin'),
    path.join(home, '.opam', 'default', 'bin'),
    path.join(home, '.nimble', 'bin'),
    '/usr/local/go/bin',
  ];
  return candidates.filter(p => p && fs.existsSync(p));
}

window.autobotDesktop = {
  /** 标识: 前端可据此判断是否在桌面壳里. */
  isDesktop: true,

  /**
   * 探测 binary 是否在 PATH 上 (含 getExtraPaths() 补扫).
   * 返 {found, path} (Promise).
   */
  which(bin) {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'where' : 'which';
      const sep = isWin ? ';' : ':';
      const pathEnv = (process.env.PATH || '') + sep + getExtraPaths().join(sep);
      execFile(cmd, [bin], { env: { ...process.env, PATH: pathEnv } }, (err, stdout) => {
        if (err) return resolve({ found: false, path: null });
        const p = stdout.split(/\r?\n/)[0].trim();
        resolve({ found: !!p, path: p || null });
      });
    });
  },

  /**
   * 读本地文件 (前端可读项目根的代码, 直接喂给 LSP 或显示).
   * 受限: 仅用于桌面壳本地场景, 不做路径白名单 (信任本机用户).
   */
  readFile(p, opts = 'utf8') {
    return new Promise((resolve, reject) => {
      fs.readFile(p, opts, (err, data) => err ? reject(err) : resolve(data));
    });
  },

  /** 列目录 (浅层). 返 string[] (文件名). */
  listDir(dir) {
    return new Promise((resolve, reject) => {
      fs.readdir(dir, (err, files) => err ? reject(err) : resolve(files));
    });
  },

  /**
   * spawn 一个子进程 (LSP server / MCP server / npm install -g ...),
   * 返回 { pid, kill, onStdout, onStderr, onExit }.
   * 前端用此能力在本地直接装 LSP server, 不走后端.
   */
  spawn(cmd, args = [], opts = {}) {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
    return {
      pid: child.pid,
      kill: () => child.kill(),
      onStdout: (cb) => child.stdout.on('data', d => cb(d.toString())),
      onStderr: (cb) => child.stderr.on('data', d => cb(d.toString())),
      onExit: (cb) => child.on('exit', code => cb(code)),
    };
  },

  /**
   * P7-9: 启动 LSP server 子进程 (JSON-RPC over stdio).
   * 与 spawn() 区别: 长期常驻 + stdin.write + 自动解析 Content-Length 帧.
   *
   * @returns {{ pid, kill, write, onMessage, onExit, onError }}
   *   write(str): 发一条 JSON-RPC (自动加 Content-Length 头) 到 stdin
   *   onMessage(cb): 注册消息回调 (cb 接收解析后的 JS 对象)
   */
  spawnLsp(cmd, args = [], opts = {}) {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
    let buf = Buffer.alloc(0);
    let msgHandler = () => {};
    let exitHandler = () => {};
    let errHandler = () => {};
    child.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const header = buf.slice(0, headerEnd).toString('utf8');
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) { buf = buf.slice(headerEnd + 4); continue; }
        const len = parseInt(m[1], 10);
        const bodyStart = headerEnd + 4;
        if (buf.length < bodyStart + len) break;
        const body = buf.slice(bodyStart, bodyStart + len);
        buf = buf.slice(bodyStart + len);
        try { msgHandler(JSON.parse(body.toString('utf8'))); }
        catch (_) { /* skip malformed */ }
      }
    });
    child.stderr.on('data', (d) => {
      // eslint-disable-next-line no-console
      console.warn('[lsp-stderr]', d.toString());
    });
    child.on('exit', (code) => exitHandler(code));
    child.on('error', (e) => errHandler(e));
    return {
      pid: child.pid,
      kill: () => { try { child.kill(); } catch (_) {} },
      write: (str) => {
        const body = Buffer.from(str, 'utf8');
        child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        child.stdin.write(body);
      },
      onMessage: (cb) => { msgHandler = cb; },
      onExit: (cb) => { exitHandler = cb; },
      onError: (cb) => { errHandler = cb; },
    };
  },

  /**
   * P7-9: 递归读项目根下所有代码文件, 返 [{ relPath, absPath, content, mtime, size, md5 }].
   * 用于前端 LSP 解析 + 增量指纹比对.
   *
   * @param {string} rootPath    项目根绝对路径
   * @param {object} opts
   * @param {string[]} [opts.extensions]  包含的扩展名 (e.g. ['.ts','.tsx','.js'])
   * @param {string[]} [opts.exclude]     排除目录名 (默认 node_modules/.git/dist/build 等)
   * @param {number}   [opts.maxBytes]    单文件最大字节 (默认 1MB, 超过跳过)
   * @param {number}   [opts.maxFiles]    最多读多少文件 (默认 2000, 防大仓库卡死)
   */
  readCodeFiles(rootPath, opts = {}) {
    const {
      extensions = null,
      exclude = ['node_modules', '.git', 'dist', 'build', 'target', '.idea', '.vscode', 'out', 'bin'],
      maxBytes = 1_048_576,
      maxFiles = 2000,
    } = opts;
    const extSet = extensions ? new Set(extensions.map(e => e.toLowerCase())) : null;
    const excludeSet = new Set(exclude);
    const crypto = require('crypto');
    const out = [];
    let stopped = false;
    function walk(dir) {
      if (stopped) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (_) { return; }
      for (const e of entries) {
        if (stopped) return;
        if (e.isDirectory()) {
          if (excludeSet.has(e.name)) continue;
          walk(path.join(dir, e.name));
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (extSet && !extSet.has(ext)) continue;
          const full = path.join(dir, e.name);
          try {
            const st = fs.statSync(full);
            if (st.size > maxBytes) continue;
            if (out.length >= maxFiles) { stopped = true; return; }
            const content = fs.readFileSync(full, 'utf8');
            out.push({
              relPath: path.relative(rootPath, full).replace(/\\/g, '/'),
              absPath: full,
              content,
              mtime: st.mtimeMs,
              size: st.size,
              md5: crypto.createHash('md5').update(content, 'utf8').digest('hex'),
            });
          } catch (_) { /* skip */ }
        }
      }
    }
    walk(rootPath);
    return Promise.resolve(out);
  },

  /**
   * P7-7: download 文件 (follow redirect 最多 5 跳). 返 { path, size }.
   * 桌面壳用 https 直下到本地, 不走 Node fetch.
   */
  download(url, destPath) {
    return new Promise((resolve, reject) => {
      const doGet = (u, hops) => {
        if (hops > 5) return reject(new Error('too many redirects'));
        let p;
        try { p = new URL(u); } catch (e) { return reject(new Error('bad url: ' + u)); }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const req = https.get(p, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            res.resume();
            return doGet(res.headers.location, hops + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error('HTTP ' + res.statusCode + ' for ' + u));
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => file.close(() => {
            try {
              const size = fs.statSync(destPath).size;
              resolve({ path: destPath, size });
            } catch (e) { resolve({ path: destPath, size: 0 }); }
          }));
          file.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(120_000, () => { req.destroy(new Error('download timeout')); });
      };
      doGet(url, 0);
    });
  },

  /**
   * P7-7: 解压 zip 或 tar.gz/tgz 到 destDir. 调系统工具 (Windows 用 PowerShell Expand-Archive, 类 Unix 用 unzip / tar).
   * 返 { ok, binaryName } — binaryName 是从压缩包根目录探测到的可执行文件名 (启发式).
   */
  extract(archivePath, destDir) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(destDir, { recursive: true });
      const lower = archivePath.toLowerCase();
      const isWin = process.platform === 'win32';
      let cmd, args;
      if (lower.endsWith('.zip')) {
        if (isWin) {
          cmd = 'powershell';
          args = ['-NoProfile', '-Command',
            `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`];
        } else {
          cmd = 'unzip';
          args = ['-o', archivePath, '-d', destDir];
        }
      } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        cmd = 'tar';
        args = ['-xzf', archivePath, '-C', destDir];
      } else if (lower.endsWith('.tar.bz2')) {
        cmd = 'tar';
        args = ['-xjf', archivePath, '-C', destDir];
      } else if (lower.endsWith('.tar.xz')) {
        cmd = 'tar';
        args = ['-xJf', archivePath, '-C', destDir];
      } else if (lower.endsWith('.tar')) {
        cmd = 'tar';
        args = ['-xf', archivePath, '-C', destDir];
      } else {
        return reject(new Error('unsupported archive: ' + archivePath));
      }
      execFile(cmd, args, (err) => {
        if (err) return reject(err);
        // 启发式找 binary — 解压后 destDir 或 destDir/<root> 下, 取第一个可执行文件
        const binary = pickExecutable(destDir, isWin);
        resolve({ ok: true, destDir, binaryName: binary });
      });
    });
  },

  /**
   * P7-7: 拿 PATH 第一个可写目录 (用于放 binary 软链 / 直接装包).
   */
  firstWritablePathDir() {
    const isWin = process.platform === 'win32';
    const sep = isWin ? ';' : ':';
    const dirs = (process.env.PATH || '').split(sep).filter(Boolean);
    for (const d of dirs) {
      try {
        fs.accessSync(d, fs.constants.W_OK);
        return d;
      } catch (_) { continue; }
    }
    // fallback: 用户的 ~/.local/bin (类 Unix) 或 %LOCALAPPDATA%\Programs (Windows)
    const fallback = isWin
      ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs', 'autobot-lsp')
      : path.join(os.homedir(), '.local', 'bin');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  },

  /**
   * P7-7: 一次性原子操作 — 从 GitHub Releases 拉指定 repo 的最新 release,
   * 选匹配本平台/架构的 asset, 下载 + 解压, 软链 binary 到 PATH 目录.
   *
   * @param {string} repo - "owner/name"
   * @param {string} [binaryHint] - 解压后想找的可执行名 (e.g. "jdtls", "rust-analyzer")
   * @returns {Promise<{ installed, path, version, message }>}
   */
  async installGithubRelease(repo, binaryHint) {
    // 1. 查最新 release
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const release = await new Promise((resolve, reject) => {
      const req = https.get(apiUrl, {
        headers: { 'User-Agent': 'autobot-desktop', 'Accept': 'application/vnd.github+json' }
      }, (res) => {
        if (res.statusCode === 404) return reject(new Error(`repo not found: ${repo}`));
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GitHub API HTTP ${res.statusCode}`));
        }
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(30_000, () => req.destroy(new Error('GitHub API timeout')));
    });

    // 2. 选本平台的 asset
    const plat = process.platform;
    const arch = process.arch;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const chosen = pickGithubAsset(assets, plat, arch);
    if (!chosen) {
      return {
        installed: false,
        path: null,
        version: release.tag_name || null,
        message: `no compatible asset for ${plat}/${arch} in release ${release.tag_name} (${assets.length} assets)`
      };
    }

    // 3. 下载到 tmp
    const isWin = process.platform === 'win32';
    const tmpDir = path.join(os.tmpdir(), 'autobot-lsp-install');
    fs.mkdirSync(tmpDir, { recursive: true });
    const archive = path.join(tmpDir, chosen.name);
    await window.autobotDesktop.download(chosen.browser_download_url, archive);

    // 4. 解压到 installDir
    const installDir = path.join(tmpDir, repo.replace('/', '_') + '-' + (release.tag_name || 'latest'));
    const { binaryName } = await window.autobotDesktop.extract(archive, installDir);
    if (!binaryName) {
      return { installed: false, path: null, version: release.tag_name,
               message: 'extracted but no executable found in archive' };
    }

    // 5. 拷贝/软链 binary 到 PATH 第一个可写目录
    const targetDir = window.autobotDesktop.firstWritablePathDir();
    const targetBinary = binaryHint || binaryName;
    const targetPath = path.join(targetDir, isWin ? targetBinary + '.exe' : targetBinary);
    const srcPath = path.join(installDir, binaryName);
    try {
      // 删旧文件 / 旧软链
      try { fs.unlinkSync(targetPath); } catch (_) {}
      fs.symlinkSync(srcPath, targetPath);
    } catch (e) {
      // Windows 软链要管理员 → fallback: 拷贝
      try {
        fs.copyFileSync(srcPath, targetPath);
        fs.chmodSync(targetPath, 0o755);
      } catch (e2) {
        return { installed: false, path: null, version: release.tag_name,
                 message: 'failed to link/copy: ' + e2.message };
      }
    }

    return { installed: true, path: targetPath, version: release.tag_name,
             message: `${targetBinary} ${release.tag_name} installed` };
  },
};

// ── helpers (闭包内) ──

/** 从解压目录中启发式找可执行文件 (binary). */
function pickExecutable(dir, isWin) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  // 1. 优先: dir/ 下与 binaryHint 同名 (没有, 跳过)
  // 2. 否则: dir/<root>/ 下第一个可执行文件
  const flat = (d) => {
    const out = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) out.push(...flat(full));
      else out.push(full);
    }
    return out;
  };
  const files = flat(dir);
  // 先找 .exe (Windows) 或无后缀 (Unix) 的可执行
  const exes = files.filter(f => {
    if (isWin) return f.toLowerCase().endsWith('.exe');
    return !f.includes('.') || f.endsWith('/bin/'); // 简化
  });
  if (exes.length > 0) {
    // 优先名字带 "bin" 的 (e.g. .../bin/jdtls)
    const binned = exes.find(f => /\/bin\//.test(f));
    if (binned) return path.relative(dir, binned);
    return path.relative(dir, exes[0]);
  }
  // 兜底: 任何文件 (macOS 解压 .app 之类)
  if (files.length > 0) return path.relative(dir, files[0]);
  return null;
}

/** 从 GitHub release assets 数组里挑一个匹配本平台/架构的. */
function pickGithubAsset(assets, plat, arch) {
  if (!assets || assets.length === 0) return null;
  const isExe = (n) => n.toLowerCase().endsWith('.exe');
  // 平台关键字
  const platKws = plat === 'win32'
    ? ['windows', 'win32', 'win64', 'msvc', 'pc-windows']
    : plat === 'darwin'
      ? ['darwin', 'macos', 'osx', 'apple', 'os-x']
      : ['linux', 'unknown-linux'];
  // 架构关键字
  const archKws = arch === 'arm64' ? ['arm64', 'aarch64'] : ['x86_64', 'amd64', 'x64'];
  // 0) Windows 优先: 任何 .exe (marksman.exe / binary.exe 等)
  if (plat === 'win32') {
    const exes = assets.filter(a => isExe(a.name));
    if (exes.length > 0) return exes[0];
  }
  // 1) 平台 + 架构 + zip/tar.gz
  for (const a of assets) {
    const n = a.name.toLowerCase();
    if (platKws.some(k => n.includes(k)) && archKws.some(k => n.includes(k)) &&
        (n.endsWith('.zip') || n.endsWith('.tar.gz') || n.endsWith('.tgz'))) {
      return a;
    }
  }
  // 2) 仅平台 (有些 release 不分架构, 如 jdtls universal)
  for (const a of assets) {
    const n = a.name.toLowerCase();
    if (platKws.some(k => n.includes(k)) &&
        (n.endsWith('.zip') || n.endsWith('.tar.gz') || n.endsWith('.tgz'))) {
      return a;
    }
  }
  // 3) 任何 zip/tar.gz
  for (const a of assets) {
    const n = a.name.toLowerCase();
    if (n.endsWith('.zip') || n.endsWith('.tar.gz') || n.endsWith('.tgz')) return a;
  }
  // 4) macOS/Linux: 兜底无后缀 binary (marksman-linux-x64, marksman-macos 等)
  if (plat !== 'win32') {
    for (const a of assets) {
      if (!/\.[a-z0-9]+$/i.test(a.name)) return a; // 无扩展名
    }
  }
  return null;
}
