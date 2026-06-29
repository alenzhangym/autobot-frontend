# P7-7: 生成 Autobot 桌面应用图标 (256x256 ICO, 蓝底白字 "A").
# 无需任何 npm 依赖, 纯 .NET System.Drawing.
# 输出: build/icon.ico  (electron-builder 默认查找路径)
Add-Type -AssemblyName System.Drawing

$size = 256
$out = Join-Path $PSScriptRoot 'icon.ico'
$null = New-Item -ItemType Directory -Force -Path $PSScriptRoot -ErrorAction SilentlyContinue

$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# 圆角蓝色背景
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 22, 119, 255)) # #1677FF (antd primary)
$radius = 56
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $radius, $radius, 180, 90)
$path.AddArc($size - $radius, 0, $radius, $radius, 270, 90)
$path.AddArc($size - $radius, $size - $radius, $radius, $radius, 0, 90)
$path.AddArc(0, $size - $radius, $radius, $radius, 90, 90)
$path.CloseFigure()
$g.FillPath($bg, $path)

# 白色 "A" 字母居中
$font = New-Object System.Drawing.Font('Segoe UI', 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$white = [System.Drawing.Brushes]::White
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, 8, $size, $size)
$g.DrawString('A', $font, $white, $rect, $sf)

$g.Flush()

# 直接保存为 ICO (System.Drawing.Icon 支持, 但 Bitmap.Save 用 Icon encoder 即可)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()

# 手工构造 ICO 容器 (单张 PNG 嵌入, CURDIR style)
$bw = New-Object System.IO.BinaryWriter([System.IO.File]::Create($out))
# ICONDIR (6 bytes): reserved=0, type=1 (icon), count=1
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]1)
# ICONDIRENTRY (16 bytes): width=0(=256), height=0(=256), colors=0, reserved=0, planes=1, bpp=32, size=pnglen, offset=22
$bw.Write([byte]0)       # width (0 => 256)
$bw.Write([byte]0)       # height (0 => 256)
$bw.Write([byte]0)       # colorCount
$bw.Write([byte]0)       # reserved
$bw.Write([uint16]1)     # planes
$bw.Write([uint16]32)    # bitCount
$bw.Write([uint32]$pngBytes.Length)  # bytesInRes
$bw.Write([uint32]22)    # image offset (6 + 16 = 22)
# PNG payload
$bw.Write($pngBytes)
$bw.Close()

$ms.Dispose()
$g.Dispose()
$bmp.Dispose()
$bg.Dispose()
$font.Dispose()
$sf.Dispose()

$fi = Get-Item $out
Write-Host "OK: $($fi.FullName) ($([math]::Round($fi.Length/1KB,1)) KB)"
