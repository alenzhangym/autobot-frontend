#!/usr/bin/env bash
# AutoBot Frontend one-click installer (macOS / Linux).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/alenzhangym/autobot-frontend/main/scripts/install-autobot-frontend.sh | bash
#
# What it does:
#   1. Verifies Node.js (>= 18) and npm are available.
#   2. Clones the repo (or `git pull`s an existing checkout).
#   3. Writes .env with VITE_BACKEND_HOST=http://120.26.113.95:8000
#      unless the user already customised it.
#   4. Runs `npm install`.
#   5. Starts `npm start`.

set -euo pipefail

REPO_URL="https://github.com/alenzhangym/autobot-frontend.git"
REPO_DIR="autobot-frontend"
DEFAULT_BACKEND_HOST="http://120.26.113.95:8000"

# ---------- helpers ----------
err() { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; }
ok()  { printf '\033[32m[ ok ]\033[0m %s\n' "$*"; }
info(){ printf '\033[36m[info]\033[0m %s\n' "$*"; }

# ---------- 1. prerequisites ----------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed. Please install Node.js >= 18 first:"
  err "  https://nodejs.org/en/download"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  err "npm is not installed (this is unusual; Node.js usually ships it)."
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  err "git is not installed. Please install git first."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  err "Node.js >= 18 is required, but found $(node -v)."
  exit 1
fi
ok "Node $(node -v), npm $(npm -v), git $(git --version | awk '{print $3}')"

# ---------- 2. clone or pull ----------
if [ -d "${REPO_DIR}/.git" ]; then
  info "Existing checkout found at ./${REPO_DIR}, running git pull..."
  (cd "${REPO_DIR}" && git pull --ff-only)
elif [ -d "${REPO_DIR}" ]; then
  err "./${REPO_DIR} exists but is not a git repo. Remove or rename it and re-run."
  exit 1
else
  info "Cloning ${REPO_URL} ..."
  git clone "${REPO_URL}" "${REPO_DIR}"
fi
cd "${REPO_DIR}"

# ---------- 3. .env ----------
ENV_FILE=".env"
if [ -f "${ENV_FILE}" ] && grep -q '^VITE_BACKEND_HOST=' "${ENV_FILE}"; then
  ok ".env already has VITE_BACKEND_HOST — keeping existing value:"
  grep '^VITE_BACKEND_HOST=' "${ENV_FILE}"
else
  printf 'VITE_BACKEND_HOST=%s\n' "${DEFAULT_BACKEND_HOST}" > "${ENV_FILE}"
  ok "Wrote .env with VITE_BACKEND_HOST=${DEFAULT_BACKEND_HOST}"
fi
info "If your backend lives elsewhere, edit .env and re-run."

# ---------- 4. install ----------
if [ -d node_modules ]; then
  ok "node_modules already present, skipping npm install"
else
  info "Running npm install (this may take a few minutes) ..."
  npm install
fi

# ---------- 5. start ----------
ok "Starting frontend on http://localhost:3000"
ok "Press Ctrl-C to stop."
exec npm start
