/**
 * Toolchain discovery — probes what tooling the local machine has via
 * the /api/local/workspace/probe endpoint, caches results, and builds
 * a client_info object the backend can use to adapt commands per OS.
 */

import api, { getLocalAgentBaseUrl } from '../auth';

const CACHE_KEY = 'autobot_toolchain';
const CACHE_TTL = 3600_000; // 1 hour

const DEFAULT_TOOLS = [
  'mvn', 'gradle', 'python', 'python3', 'py', 'node',
  'npm', 'pnpm', 'yarn', 'go', 'mvnw', 'mvnw.cmd', 'gradlew', 'gradlew.bat',
];

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* localStorage quota */ }
}

export async function probeToolchain(tools = DEFAULT_TOOLS) {
  const cached = loadCache();
  if (cached) return cached;

  try {
    const res = await api.post('/api/local/workspace/probe', { tools }, {
      baseURL: getLocalAgentBaseUrl(),
      timeout: 30_000,
    });
    const data = res.data;
    if (data && Array.isArray(data.tools)) {
      saveCache(data);
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearToolchainCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* noop */ }
}

function platformLabel() {
  const p = typeof navigator !== 'undefined' ? navigator.platform || '' : '';
  if (/Win/i.test(p)) return 'windows';
  if (/Mac/i.test(p)) return 'macos';
  if (/Linux/i.test(p)) return 'linux';
  return p.toLowerCase() || 'unknown';
}

function pathSep() {
  const p = platformLabel();
  return p === 'windows' ? '\\' : '/';
}

export function getClientInfo(probeResult) {
  const tools = (probeResult?.tools || []).filter(t => t.found).reduce((acc, t) => {
    acc[t.key] = t.version || true;
    return acc;
  }, {});

  return {
    platform: platformLabel(),
    arch: typeof navigator !== 'undefined' ? navigator.platform || '' : '',
    path_sep: pathSep(),
    tools,
  };
}

export { DEFAULT_TOOLS };
