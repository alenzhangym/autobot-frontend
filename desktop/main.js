// Autobot 桌面壳 — Electron main 进程.
// P7-7: 把 autobot-frontend (Vite build 产物) 装进 BrowserWindow,
// 绕开浏览器沙箱, 让前端可直接 spawn 本地 LSP / MCP (通过 preload).
//
// 启动方式:
//   npm run dev        → 加载 http://localhost:5173 (Vite dev server)
//   npm run dev:prod   → 加载 http://localhost:8000 (Spring Boot 静态资源)
//   npm start / 打包后 → 加载本地 resources/frontend/index.html (自包含)
//
// 后端 (java-backend) 需另起: mvn spring-boot:run (端口 8000)
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 解析前端入口:
//   1. AUTOBOT_FRONTEND_URL 显式指定 → 用该 URL (dev 模式)
//   2. 否则查找本地打包的 frontend dist (resources/frontend/index.html)
//   3. 都没有 → 回退到 dev server (会显示加载失败提示)
function resolveFrontendEntry() {
  if (process.env.AUTOBOT_FRONTEND_URL) {
    return { type: 'url', target: process.env.AUTOBOT_FRONTEND_URL };
  }
  // 打包后: process.resourcesPath 指向 app.asar/resources
  // 开发时: __dirname (autobot-frontend/desktop/)
  const candidates = [
    path.join(process.resourcesPath || '', 'frontend', 'index.html'),
    path.join(__dirname, 'resources', 'frontend', 'index.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return { type: 'file', target: p };
    }
  }
  // 回退: dev server
  return { type: 'url', target: 'http://localhost:5173' };
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Autobot',
    backgroundColor: '#161616',
    webPreferences: {
      // 关键: 关闭沙箱 + 启用 nodeIntegration (P7 设计要求前端可直接 spawn 本地 LSP)
      // 注意安全风险: 仅本地桌面壳使用, 不暴露公网
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const entry = resolveFrontendEntry();
  if (entry.type === 'file') {
    mainWindow.loadFile(entry.target);
  } else {
    mainWindow.loadURL(entry.target);
  }

  // 外链点击用系统浏览器打开 (避免桌面壳里跳走)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 加载失败时显示诊断信息 (避免黑屏)
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    const msg = `页面加载失败\n\nURL: ${validatedURL}\n错误码: ${errorCode}\n原因: ${errorDescription}\n\n` +
      (entry.type === 'url'
        ? '请确认 dev server 或后端服务已启动。'
        : '请确认 resources/frontend/index.html 存在。');
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<html><body style="font-family:Segoe UI,sans-serif;padding:40px;background:#1a1a1a;color:#eee"><h2>Autobot 启动失败</h2><pre style="white-space:pre-wrap">${msg.replace(/\n/g, '<br>')}</pre></body></html>`
    ));
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
