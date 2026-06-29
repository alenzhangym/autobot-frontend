#!/usr/bin/env bash
# Autobot 桌面壳 — mac/linux 通用 build 入口.
# 用法:
#   ./build-desktop.sh                  # 按当前平台 (mac → dmg+zip, linux → AppImage+deb)
#   ./build-desktop.sh --target win     # 显式打 windows 安装包 (需 wine + 已有 icon.ico)
#   ./build-desktop.sh --target mac
#   ./build-desktop.sh --target linux
#   ./build-desktop.sh --target dir     # 仅打包目录, 不出安装包 (快速验证)
#   ./build-desktop.sh --no-frontend    # 跳过 vite build + 复制 (已构建过)
#   ./build-desktop.sh --no-icon        # 跳过 icon 生成 (已生成)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$(cd "$DESKTOP_DIR/.." && pwd)"

# ── 解析参数 ──
TARGET="auto"
RUN_FRONTEND_BUILD="yes"
RUN_ICON="yes"
for arg in "$@"; do
  case "$arg" in
    --target) shift; TARGET="${1:-auto}";;
    --target=*) TARGET="${arg#--target=}";;
    --no-frontend) RUN_FRONTEND_BUILD="no";;
    --no-icon) RUN_ICON="no";;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# ── 推断 target ──
if [ "$TARGET" = "auto" ]; then
  case "$(uname -s)" in
    Darwin) TARGET="mac";;
    Linux)  TARGET="linux";;
    *)      TARGET="dir";;
  esac
fi
echo "[build-desktop] target = $TARGET"

# ── 前置: 装 desktop 依赖 ──
if [ ! -d "$DESKTOP_DIR/node_modules" ]; then
  echo "[build-desktop] installing desktop deps..."
  (cd "$DESKTOP_DIR" && npm install)
fi

# ── 步骤 1: 顶层 vite build (生成 dist) ──
if [ "$RUN_FRONTEND_BUILD" = "yes" ]; then
  echo "[build-desktop] vite build (frontend dist)..."
  (cd "$FRONTEND_DIR" && npm run build)
fi

# ── 步骤 2: 生成图标 ──
if [ "$RUN_ICON" = "yes" ]; then
  case "$TARGET" in
    win)   (cd "$DESKTOP_DIR" && npm run icon:win) || echo "[build-desktop] icon:win 失败, 继续...";;
    mac)   (cd "$DESKTOP_DIR" && npm run icon:mac);;
    linux) (cd "$DESKTOP_DIR" && npm run icon:linux);;
  esac
fi

# ── 步骤 3: 复制前端 dist 到 desktop/resources ──
echo "[build-desktop] copy-frontend..."
(cd "$DESKTOP_DIR" && npm run copy-frontend)

# ── 步骤 4: electron-builder ──
case "$TARGET" in
  win)
    (cd "$DESKTOP_DIR" && npm run dist:win)
    ;;
  mac)
    (cd "$DESKTOP_DIR" && npm run dist:mac)
    ;;
  linux)
    (cd "$DESKTOP_DIR" && npm run dist:linux)
    ;;
  dir)
    (cd "$DESKTOP_DIR" && npm run dist:dir)
    ;;
  *)
    echo "[build-desktop] 未知 target: $TARGET" >&2
    exit 2
    ;;
esac

echo "[build-desktop] OK, 产物在 $DESKTOP_DIR/release/"
