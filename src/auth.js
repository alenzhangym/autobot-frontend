import axios from 'axios';

// Default backend host. Users who haven't touched the login screen's
// "backend address" field get this. The user can still override at
// runtime via the Settings panel — that value lands in localStorage
// (`backend_host`) and wins over this default.
const DEFAULT_BACKEND_HOST = 'http://120.26.113.95:8000';

// Smart default: when the user hasn't configured anything, fall back
// to `DEFAULT_BACKEND_HOST`. The earlier heuristic (browser hostname
// :8000) made sense for fully LAN deployments but is wrong for
// production — most users access the frontend from outside the LAN
// and the backend lives on a fixed public address.
function smartDefaultBackendHost() {
  return DEFAULT_BACKEND_HOST;
}

export const getBackendHost = () => {
  // Use localStorage if available, otherwise fallback to env variable or default
  if (localStorage.getItem('backend_host')) {
    return localStorage.getItem('backend_host');
  }
  if (import.meta.env.VITE_BACKEND_HOST) {
    return import.meta.env.VITE_BACKEND_HOST;
  }
  return smartDefaultBackendHost();
};

export const setBackendHost = (host) => {
  // The axios request interceptor re-reads `getApiBaseUrl()` (which in
  // turn reads `getBackendHost()`) on every request, so the new host
  // takes effect immediately. We previously called `window.location.reload()`
  // here, but that re-initialises React state (e.g. HomeWrapper's
  // `showLogin` flag), so users who saved the backend address from the
  // login screen would be kicked back to the home page. Saving and
  // returning is enough — let the caller show a toast and stay put.
  localStorage.setItem('backend_host', host);
};

export const getSuggestedBackendHost = () => {
  // Already configured? Honour it (preserve whatever the user has, with or without http://).
  const configured = localStorage.getItem('backend_host');
  if (configured) return configured;
  // smartDefaultBackendHost() now returns a fully-qualified URL
  // (e.g. http://120.26.113.95:8000), so don't double-prefix http://.
  return smartDefaultBackendHost();
};

export const getApiBaseUrl = () => {
  // 2026-07-25: dev 模式下且用户未显式配置 backend_host 时, 返回相对路径 '/api',
  // 让请求走 Vite dev server 的 /api 代理 (见 vite.config.js).
  // 这样手机端通过局域网 IP (http://192.168.x.x:5173) 访问前端时,
  // /api/* 请求会被 Vite 代理转发到后端, 绕过 CORS 和手机端无法直连后端公网 IP 的问题.
  // 如果用户显式配置了 backend_host (localStorage), 优先使用配置值.
  const configured = localStorage.getItem('backend_host');
  if (!configured && import.meta.env.DEV) {
    return '/api';
  }
  let host = getBackendHost();
  if (host.startsWith('https://')) {
    host = host.replace('https://', 'http://');
  } else if (!host.startsWith('http://')) {
    host = `http://${host}`;
  }
  return `${host}/api`;
};

export const getWsBaseUrl = () => {
  let host = getBackendHost();
  if (host.startsWith('https://')) {
    host = host.replace('https://', '');
  } else if (host.startsWith('http://')) {
    host = host.replace('http://', '');
  }
  return `ws://${host}`;
};

export const getLocalAgentBaseUrl = () => {
  // For local agent APIs, always use localhost with the current frontend serving port
  // This ensures /api/local/* calls go to the local agent (5173 for Vite, 3000 for standalone)
  const port = window.location.port;
  return `http://localhost:${port}`;
};

// Create an Axios instance
const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 1800000, // 30 minutes timeout to prevent premature network errors during long-running tasks
});

// Request interceptor to add token and dynamic baseURL
api.interceptors.request.use(
  (config) => {
    // Only fall back to getApiBaseUrl() when the caller did NOT supply an explicit
    // per-request baseURL. The monitor panel and other local-agent callers pass
    // { baseURL: getLocalAgentBaseUrl() } and we must not clobber that.
    if (!config.baseURL) {
      config.baseURL = getApiBaseUrl();
    }
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor: centralised 401 handling.
// 2026-07-25: token 失效时(过期/篡改/服务端重启换 secret), 后端返回 401. 统一在响应拦截器
// 处理: 清除 localStorage 凭证并 reload, App.jsx bootstrap 检测到 !tokenExists 渲染登录页.
//
// 关键: 只在"请求带了 token 但被后端拒绝"时才 reload. 如果请求本身没带 Authorization header
// (bootstrap 阶段的 fetchMe, 或未登录时的请求), 不触发 reload — 否则会形成死循环:
// 无 token → fetchMe 401 → reload → 无 token → fetchMe 401 → reload → ...
// 这种情况让调用方自行处理(fetchMe 返回 null, App.jsx 会渲染登录页).
let _unauthorizedRedirecting = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';
    const reqHeaders = error?.config?.headers || {};
    const hadAuthHeader = !!reqHeaders['Authorization'] || !!reqHeaders['authorization'];
    if (status === 401 && !_unauthorizedRedirecting) {
      // 排除 /auth/login 本身 — 登录失败应让调用方处理(弹出"密码错误"), 不应跳转.
      if (!url.includes('/auth/login') && hadAuthHeader) {
        _unauthorizedRedirecting = true;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // 延迟 100ms 让当前 catch 链跑完, 避免 React 状态更新与 reload 冲突.
        setTimeout(() => { window.location.reload(); }, 100);
      }
    }
    return Promise.reject(error);
  }
);

export const login = async (username, password) => {
  try {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify({
        id: response.data.id,
        username: response.data.username,
        role: response.data.role,
        companyId: response.data.companyId
      }));
      return response.data;
    }
    return null;
  } catch (error) {
    throw error;
  }
};

export const logout = () => {
  const hadToken = localStorage.getItem('token');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (hadToken) {
    window.location.reload();
  }
};

export const fetchMe = async () => {
  try {
    const res = await api.get('/auth/me');
    if (res.data?.username) {
      localStorage.setItem('user', JSON.stringify({
        id: res.data.id,
        username: res.data.username,
        role: res.data.role,
        companyId: res.data.companyId
      }));
      return res.data;
    }
    return null;
  } catch (error) {
    return null;
  }
};

export const getCurrentUser = () => {
  const userStr = localStorage.getItem('user');
  if (userStr) return JSON.parse(userStr);
  return null;
};

export const isAuthenticated = () => {
  return !!localStorage.getItem('token');
};

export const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export default api;
