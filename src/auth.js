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
