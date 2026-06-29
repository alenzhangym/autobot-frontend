#!/usr/bin/env bash
# 生成 Autobot 桌面应用图标 (mac/linux).
# 输出:
#   build/icon.png   (512x512, 通用)
#   build/icon.ico   (仅当本机装了 ImageMagick `convert` 才生成)
# mac 上用 sips 转 icns (sips 是系统自带).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.."
ICON_PNG="$BUILD_DIR/build/icon.png"
ICON_ICO="$BUILD_DIR/build/icon.ico"
ICON_ICNS="$BUILD_DIR/build/icon.icns"

if [ -f "$ICON_PNG" ] && [ ! "${1:-}" = "--force" ]; then
  echo "[gen-icon] 已存在 $ICON_PNG, 用 --force 强制重新生成."
  exit 0
fi

# 1) 生成 512x512 PNG (零依赖, 纯 Node + canvas-free, 走 sips 或 Node 实现)
#    优先用 Node 一行命令输出 PNG, 不依赖 ImageMagick.
node -e '
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 512;
const W = SIZE, H = SIZE;
const R = 112; // 圆角半径

// 调色板 (Antd 蓝 #1677FF)
const FG = [22, 119, 255, 255];
const FG_2 = [12, 82, 196, 255];
const BG = [255, 255, 255, 255];

function setPixel(buf, x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  if (a === 255) {
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = 255;
  } else {
    const inv = 255 - a;
    buf[i  ] = (buf[i  ] * inv + r * a) / 255;
    buf[i+1] = (buf[i+1] * inv + g * a) / 255;
    buf[i+2] = (buf[i+2] * inv + b * a) / 255;
    buf[i+3] = 255;
  }
}

const px = Buffer.alloc(W * H * 4);

// 圆角检测 + 渐变填充
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // 圆角遮罩: 角内距 < 0 → 透明
    let alpha = 255;
    const cx = x < R ? R : (x >= W - R ? W - 1 - R : x);
    const cy = y < R ? R : (y >= H - R ? H - 1 - R : y);
    if (x !== cx || y !== cy) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d > R) alpha = 0;
      else if (d > R - 1) alpha = Math.round(255 * (1 - (d - (R - 1))));
    }
    if (alpha === 0) {
      setPixel(px, x, y, 0, 0, 0, 0);
      continue;
    }
    // 垂直渐变
    const t = y / (H - 1);
    const r = Math.round(FG[0] * (1 - t) + FG_2[0] * t);
    const g = Math.round(FG[1] * (1 - t) + FG_2[1] * t);
    const b = Math.round(FG[2] * (1 - t) + FG_2[2] * t);
    setPixel(px, x, y, r, g, b, alpha);
  }
}

// 绘制 "A" 字母 — 简易 bitmap 字体 (10x14, 仅 A 字符, scale 后居中)
const A_FONT = [
  "..XXXXX..",
  ".XX...XX.",
  "XX.....XX",
  "XX.....XX",
  "XXXXXXXXX",
  "XXXXXXXXX",
  "XX.....XX",
  "XX.....XX",
  "XX.....XX",
  "XX.....XX",
];
const FW = 9, FH = 10;
const scale = 36; // 9*36 = 324
const ox = Math.floor((W - FW * scale) / 2);
const oy = Math.floor((H - FH * scale) / 2);
for (let fy = 0; fy < FH; fy++) {
  for (let fx = 0; fx < FW; fx++) {
    if (A_FONT[fy][fx] !== "X") continue;
    for (let sy = 0; sy < scale; sy++) {
      for (let sx = 0; sx < scale; sx++) {
        setPixel(px, ox + fx * scale + sx, oy + fy * scale + sy,
                 255, 255, 255, 255);
      }
    }
  }
}

// ── 构造 PNG ──
function crc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
// filter byte per row
const rows = [];
for (let y = 0; y < H; y++) {
  rows.push(Buffer.from([0]));
  rows.push(px.slice(y * W * 4, (y + 1) * W * 4));
}
const raw = Buffer.concat(rows);
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
fs.mkdirSync(path.dirname(process.argv[1]), { recursive: true });
fs.writeFileSync(process.argv[1], png);
console.log("[gen-icon] PNG ->", process.argv[1], png.length, "bytes");
' "$ICON_PNG"

# 2) 转 ICO (Linux 需要 ImageMagick; macOS 用 sips/iconutil)
if command -v convert >/dev/null 2>&1; then
  convert "$ICON_PNG" -define icon:auto-resize=256,128,64,48,32,16 "$ICON_ICO"
  echo "[gen-icon] ICO -> $ICON_ICO"
elif [ "$(uname -s)" = "Darwin" ]; then
  # macOS: 用 sips 准备多尺寸 pngiconset, 再 iconutil 出 icns
  ICONSET="$BUILD_DIR/build/icon.iconset"
  rm -rf "$ICONSET" && mkdir -p "$ICONSET"
  for sz in 16 32 64 128 256 512; do
    sips -z $sz $sz "$ICON_PNG" --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  done
  cp "$ICON_PNG" "$ICONSET/icon_512x512@2x.png"
  iconutil -c icns "$ICONSET" -o "$ICON_ICNS"
  rm -rf "$ICONSET"
  echo "[gen-icon] ICNS -> $ICON_ICNS"
else
  echo "[gen-icon] 警告: 未装 ImageMagick (convert), 仅生成 PNG. Windows 平台请用 build/gen-icon.ps1."
fi

echo "OK"
