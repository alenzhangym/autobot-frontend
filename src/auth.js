import axios from 'axios';
import {
  BACKEND_HOST_STORAGE_KEY,
  apiBaseUrlFromHost,
  normalizeBackendHost,
  resolveBackendHost,
  wsBaseUrlFromHost
} from './backendHost';

// 后端地址的唯一解析入口在 ./backendHost.js —— 这里只负责把
// 「localStorage / 构建期 env / 当前页面 location」喂给纯函数。
// 2026-10-30: 此前 src 里存在第二、第三套 fallback(helpers.jsx 的 iframe bridge、
// App.jsx 的 hostname:8000), 导致 `/api/skills` 打本机、`/api/chat` 打远端,
// 用户看到的就是「设置了 backend 却没生效」。

const readStoredBackendHost = () => {
  try {
    return localStorage.getItem(BACKEND_HOST_STORAGE_KEY);
  } catch (e) {
    return null;
  }
};

const currentLocation = () => {
  try {
    return window.location;
  } catch (e) {
    return null;
  }
};

/**
 * 当前生效的后端地址(已归一化, 一定带 http(s)://)。
 * 优先级: 用户保存值 → VITE_BACKEND_HOST → 页面同源(:8000) → 远端默认。
 */
export const getBackendHost = () => resolveBackendHost({
  stored: readStoredBackendHost(),
  env: import.meta.env.VITE_BACKEND_HOST,
  location: currentLocation()
});

/**
 * 当前「页面 ↔ 后端」的完整路由画像, 供 DevTools 排查用:
 * 控制台执行 `__autobotBackendInfo()` 即可看到页面 origin、解析出的 host、api/ws 基址。
 */
export const getBackendRouting = () => {
  const loc = currentLocation();
  return {
    page: loc ? `${loc.protocol}//${loc.host}` : '',
    storedBackendHost: normalizeBackendHost(readStoredBackendHost()),
    backendHost: getBackendHost(),
    apiBaseUrl: getApiBaseUrl(),
    wsBaseUrl: getWsBaseUrl()
  };
};

/**
 * 保存后端地址。返回 `{ host, switched, requiresLogin }` 给调用方决定提示文案。
 *
 * <p>两个关键语义:</p>
 * <ol>
 *   <li>写入前先归一化(`127.0.0.1:8000` → `http://127.0.0.1:8000`), 否则 `${host}/api`
 *       这类拼接会拼出非法 URL, 看起来就像"设置没生效"。</li>
 *   <li>地址**确实变化**时清掉 `token`/`user` 并回登录页: JWT 是各后端用自己的 secret
 *       签的, 拿 A 后端的 token 去打 B 后端必然 401, 而响应拦截器会静默清 token + reload,
 *       用户只会看到"被踢回首页/一直登录不上"。在这里主动做, 并明确提示需要重新登录。</li>
 * </ol>
 */
export const setBackendHost = (host) => {
  const next = normalizeBackendHost(host);
  if (!next) {
    return { host: '', switched: false, requiresLogin: false };
  }

  const previous = getBackendHost();
  let hadToken = false;
  try {
    localStorage.setItem(BACKEND_HOST_STORAGE_KEY, next);
    hadToken = !!localStorage.getItem('token');
  } catch (e) {
    // 隐私模式等 localStorage 不可用的场景: 保持旧行为(不阻断保存动作)
  }

  const switched = previous !== next;
  if (!switched) {
    return { host: next, switched: false, requiresLogin: false };
  }

  console.info('[backend] 后端地址已切换', { from: previous, to: next, hadToken });
  if (hadToken) {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch (e) { /* ignore */ }
    // 延迟 reload 让当前 catch 链/React 状态收尾, 避免与状态更新冲突.
    setTimeout(() => { try { window.location.reload(); } catch (e) { /* ignore */ } }, 100);
  }
  return { host: next, switched: true, requiresLogin: hadToken };
};

export const getSuggestedBackendHost = () => {
  // 已配置就回显用户自己的值(归一化后), 否则回显当前生效值,
  // 让设置框里显示的就是"这次请求真正会打到哪里"。
  return normalizeBackendHost(readStoredBackendHost()) || getBackendHost();
};

export const getApiBaseUrl = () => {
  // 2026-07-25: dev 模式下且用户未显式配置 backend_host 时, 返回相对路径 '/api',
  // 让请求走 Vite dev server 的 /api 代理 (见 vite.config.js).
  // 这样手机端通过局域网 IP (http://192.168.x.x:5173) 访问前端时,
  // /api/* 请求会被 Vite 代理转发到后端, 绕过 CORS 和手机端无法直连后端公网 IP 的问题.
  // 如果用户显式配置了 backend_host (localStorage), 优先使用配置值.
  if (!normalizeBackendHost(readStoredBackendHost()) && import.meta.env.DEV) {
    return '/api';
  }
  return apiBaseUrlFromHost(getBackendHost());
};

export const getWsBaseUrl = () => wsBaseUrlFromHost(getBackendHost());

export const getLocalAgentBaseUrl = () => {
  // For local agent APIs, always use localhost with the current frontend serving port
  // This ensures /api/local/* calls go to the local agent (5173 for Vite, 3000 for standalone)
  const port = window.location.port;
  return `http://localhost:${port}`;
};

// 可观测性: 页面一加载就把「当前到底在跟哪个后端说话」打到控制台,
// 并暴露 __autobotBackendInfo() 供排查 —— 换后端"没生效"时先看这一行。
try {
  console.info('[backend] routing resolved', getBackendRouting());
  window.__autobotBackendInfo = getBackendRouting;
} catch (e) {
  // 非浏览器环境(单测/SSR)或隐私模式下忽略
}

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
        // 打一条 warn: 401 时页面会静默清 token + reload, 用户只会觉得"设置没生效";
        // 带上当前后端地址, 一眼能分辨"token 是另一个后端签的"。
        console.warn('[backend] 401 清空凭证并回登录页', { url, backendHost: getBackendHost() });
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
