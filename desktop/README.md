# autobot-desktop

P7-7: Autobot 桌面壳 (Electron 包装).

把 `../dist`(Vite build 产物)装进 Electron BrowserWindow, 绕开浏览器沙箱,
让 webui 能直接 spawn 本地 LSP / MCP 子进程 (通过 `window.autobotDesktop` API).

> **位置变更**: 历史项目根下的 `autobot-desktop/` 目录已迁入本目录
> (`autobot-frontend/desktop/`), 方便用户下载前端包后即可构建自己的桌面客户端.

## 快速开始

```bash
# 1. 装桌面壳依赖 (electron + electron-builder)
npm run desktop:install

# 2. 一键按当前平台出安装包 (自动 vite build + copy-frontend + electron-builder)
npm run desktop:dist:auto

# 3. 显式指定平台
npm run desktop:dist:win      # windows: nsis + portable
npm run desktop:dist:mac      # macOS:   dmg + zip
npm run desktop:dist:linux    # linux:   AppImage + deb
```

## Dev 模式

```bash
# 终端 1: 前端 dev server (热更新)
npm run dev

# 终端 2: 桌面壳加载 dev server
npm run desktop:dev
# 或加载后端 8000 静态资源
npm run desktop:dev:prod
```

## 显式分步 (CI / 调试用)

```bash
# 步骤 1: 装依赖
npm run desktop:install

# 步骤 2: vite build
npm run build

# 步骤 3: 复制 dist 到 desktop/resources/frontend
npm run desktop:copy-frontend

# 步骤 4: 桌面壳图标 (按平台)
npm run desktop:icon:win      # 调用 build/gen-icon.ps1
npm run desktop:icon:mac      # 调用 build/gen-icon.sh (含 icns)
npm run desktop:icon:linux    # 调用 build/gen-icon.sh (含 png)

# 步骤 5: electron-builder
npm run desktop:dist:win      # 或 mac / linux / dir
```

## 三平台编译脚本

提供 2 层入口:

### 1. 顶层 wrapper (`../scripts/build-desktop.{sh,ps1}`)

```bash
# mac / linux
../scripts/build-desktop.sh                  # 按本平台
../scripts/build-desktop.sh --target win     # 显式打 win (需 wine)
../scripts/build-desktop.sh --target mac
../scripts/build-desktop.sh --target linux
../scripts/build-desktop.sh --target dir
../scripts/build-desktop.sh --no-frontend    # 跳过 vite build
../scripts/build-desktop.sh --no-icon        # 跳过 icon 生成
```

```powershell
# windows
..\scripts\build-desktop.ps1                 # 默认 win
..\scripts\build-desktop.ps1 -Target mac
..\scripts\build-desktop.ps1 -Target linux
..\scripts\build-desktop.ps1 -NoFrontend
..\scripts\build-desktop.ps1 -NoIcon
```

### 2. desktop 内部脚本 (`./scripts/build-desktop.{sh,ps1}`)

直接由 `npm run desktop:dist:*` 间接调用, 也可手动运行.

## 图标生成 (无第三方依赖)

- **Windows**: `build/gen-icon.ps1` — 纯 .NET `System.Drawing`, 输出 `build/icon.ico`.
- **macOS / Linux**: `build/gen-icon.sh` — 纯 Node 写 PNG, macOS 用 `sips + iconutil` 出
  `icon.icns`, Linux 用 `convert` (ImageMagick, 可选) 出 `icon.ico`.

## 与浏览器的区别

| 能力 | 浏览器 | 桌面壳 |
|------|--------|--------|
| 调用后端 API | ✅ (同源/跨域配置) | ✅ |
| `window.autobotDesktop.isDesktop` | `undefined` | `true` |
| 探测本地 LSP binary | ❌ | ✅ `which(bin)` |
| 读本地项目文件 | ❌ | ✅ `readFile/listDir` |
| spawn 本地 LSP/MCP | ❌ | ✅ `spawn(cmd, args)` |

前端代码 feature-detect:

```js
const isDesktop = typeof window !== 'undefined' && window.autobotDesktop?.isDesktop;
if (isDesktop) {
  const { found, path } = await window.autobotDesktop.which('gopls');
  // ...
}
```

## 产物路径

- `release/Autobot-0.1.0-x64.exe`         (Windows nsis 安装包)
- `release/Autobot-0.1.0-portable.exe`     (Windows 便携版)
- `release/Autobot-0.1.0-x64.dmg`          (macOS Intel)
- `release/Autobot-0.1.0-arm64.dmg`        (macOS Apple Silicon)
- `release/Autobot-0.1.0-x64.AppImage`     (Linux 通用)
- `release/Autobot-0.1.0-x64.deb`          (Debian / Ubuntu)

> 旧项目根下 `autobot-desktop/release-v2/` 是历史产物, 可手动删除.

## 安全说明

- `nodeIntegration: true` + `contextIsolation: false` 是为简化 P7 dev 脚手架.
- 生产打包前应切换到 `contextIsolation: true` + 通过 preload 暴露白名单 API.
- 桌面壳只在本机运行, 不暴露公网; 仍信任本机用户操作.

## 不做什么

- 不 bundle JRE — 后端需用户本机装 Java 17+ 并 `mvn spring-boot:run`.
- 不做自动更新.
- 不做代码签名 (macOS / Windows 需用户自行配置证书).
