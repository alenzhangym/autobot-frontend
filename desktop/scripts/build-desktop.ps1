# Autobot 桌面壳 — windows 通用 build 入口.
# 用法:
#   .\build-desktop.ps1                 # 按当前平台 (默认 win)
#   .\build-desktop.ps1 -Target mac     # 打 mac (需在 macOS / Linux 上跑)
#   .\build-desktop.ps1 -Target linux
#   .\build-desktop.ps1 -Target dir     # 仅打包目录
#   .\build-desktop.ps1 -NoFrontend     # 跳过 vite build
#   .\build-desktop.ps1 -NoIcon         # 跳过图标生成
[CmdletBinding()]
param(
    [ValidateSet('auto','win','mac','linux','dir')]
    [string]$Target = 'auto',
    [switch]$NoFrontend,
    [switch]$NoIcon
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Resolve-Path (Join-Path $ScriptDir '..')
$FrontendDir = Resolve-Path (Join-Path $DesktopDir '..')

# 推断 target
if ($Target -eq 'auto') {
    if ($IsWindows -or $env:OS -eq 'Windows_NT') { $Target = 'win' }
    elseif ($IsMacOS) { $Target = 'mac' }
    elseif ($IsLinux) { $Target = 'linux' }
    else { $Target = 'dir' }
}
Write-Host "[build-desktop] target = $Target"

# 前置: 装 desktop 依赖
if (-not (Test-Path (Join-Path $DesktopDir 'node_modules'))) {
    Write-Host '[build-desktop] installing desktop deps...'
    Push-Location $DesktopDir
    try { npm install } finally { Pop-Location }
}

# 步骤 1: 顶层 vite build
if (-not $NoFrontend) {
    Write-Host '[build-desktop] vite build (frontend dist)...'
    Push-Location $FrontendDir
    try { npm run build } finally { Pop-Location }
}

# 步骤 2: 图标
if (-not $NoIcon) {
    Push-Location $DesktopDir
    try {
        switch ($Target) {
            'win'   { npm run icon:win }
            'mac'   { npm run icon:mac }
            'linux' { npm run icon:linux }
        }
    } finally { Pop-Location }
}

# 步骤 3: 复制前端 dist
Write-Host '[build-desktop] copy-frontend...'
Push-Location $DesktopDir
try { npm run copy-frontend } finally { Pop-Location }

# 步骤 4: electron-builder
Push-Location $DesktopDir
try {
    switch ($Target) {
        'win'   { npm run dist:win }
        'mac'   { npm run dist:mac }
        'linux' { npm run dist:linux }
        'dir'   { npm run dist:dir }
        default { throw "未知 target: $Target" }
    }
} finally { Pop-Location }

Write-Host "[build-desktop] OK, 产物在 $DesktopDir\release\"
