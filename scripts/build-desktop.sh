#!/usr/bin/env bash
# Autobot 前端顶层 — 桌面壳 build 包装 (mac/linux).
# 委托到 desktop/scripts/build-desktop.sh.
# 用法与 desktop/scripts/build-desktop.sh 一致.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/../desktop/scripts/build-desktop.sh" "$@"
