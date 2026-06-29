# Autobot 前端顶层 — 桌面壳 build 包装 (windows).
# 委托到 desktop/scripts/build-desktop.ps1.
# 用法与 desktop/scripts/build-desktop.ps1 一致.
[CmdletBinding()]
param(
    [ValidateSet('auto','win','mac','linux','dir')]
    [string]$Target = 'auto',
    [switch]$NoFrontend,
    [switch]$NoIcon
)
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopScript = Join-Path $ScriptDir '..\desktop\scripts\build-desktop.ps1'
& powershell -ExecutionPolicy Bypass -File $DesktopScript -Target $Target @PSBoundParameters
