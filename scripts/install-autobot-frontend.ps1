<#
.SYNOPSIS
  AutoBot Frontend one-click installer (Windows / PowerShell).

.DESCRIPTION
  Usage:
    irm https://raw.githubusercontent.com/alenzhangym/autobot-frontend/main/scripts/install-autobot-frontend.ps1 | iex

  Steps performed:
    1. Verifies Node.js (>= 18) and npm are installed.
    2. Clones the repo (or `git pull`s an existing checkout).
    3. Writes .env with VITE_BACKEND_HOST=http://120.26.113.95:8000
       unless the user already customised it.
    4. Runs `npm install`.
    5. Starts `npm start`.
#>

$ErrorActionPreference = 'Stop'

$REPO_URL       = 'https://github.com/alenzhangym/autobot-frontend.git'
$REPO_DIR       = 'autobot-frontend'
$DEFAULT_BACKEND_HOST = 'http://120.26.113.95:8000'

function Write-Info($msg) { Write-Host "[info] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[ ok ] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

# ---------- 1. prerequisites ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Err "Node.js is not installed. Please install Node.js >= 18 first:`n  https://nodejs.org/en/download"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Err "npm is not installed (this is unusual; Node.js usually ships it)."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Err "git is not installed. Please install git first:`n  https://git-scm.com/download/win"
}

$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 18) {
  Write-Err "Node.js >= 18 is required, but found $(node -v)."
}
Write-Ok "Node $(node -v), npm $(npm -v)"

# ---------- 2. clone or pull ----------
if (Test-Path (Join-Path $REPO_DIR '.git')) {
  Write-Info "Existing checkout found at .\$REPO_DIR, running git pull..."
  Push-Location $REPO_DIR
  try { git pull --ff-only } finally { Pop-Location }
} elseif (Test-Path $REPO_DIR) {
  Write-Err ".\$REPO_DIR exists but is not a git repo. Remove or rename it and re-run."
} else {
  Write-Info "Cloning $REPO_URL ..."
  git clone $REPO_URL $REPO_DIR
}
Set-Location $REPO_DIR

# ---------- 3. .env ----------
$envFile = Join-Path (Get-Location) '.env'
$needsWrite = $true
if (Test-Path $envFile) {
  $existing = Get-Content $envFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^VITE_BACKEND_HOST=' }
  if ($existing) {
    $needsWrite = $false
    Write-Ok ".env already has VITE_BACKEND_HOST - keeping existing value:"
    Write-Host "  $existing"
  }
}
if ($needsWrite) {
  "VITE_BACKEND_HOST=$DEFAULT_BACKEND_HOST" | Out-File -FilePath $envFile -Encoding utf8 -Append
  Write-Ok "Wrote .env with VITE_BACKEND_HOST=$DEFAULT_BACKEND_HOST"
}
Write-Info "If your backend lives elsewhere, edit .env and re-run."

# ---------- 4. install ----------
if (Test-Path 'node_modules') {
  Write-Ok "node_modules already present, skipping npm install"
} else {
  Write-Info "Running npm install (this may take a few minutes) ..."
  npm install
  if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed." }
}

# ---------- 5. start ----------
Write-Ok "Starting frontend on http://localhost:3000"
Write-Ok "Press Ctrl-C to stop."
npm start
