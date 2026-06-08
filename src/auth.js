import axios from 'axios';

// Smart default: use the hostname the user typed in the browser + port 8000.
// Works for both LAN access (user types http://192.168.1.100:3000) and local
// dev (user types http://localhost:3000). Falls back to 127.0.0.1 for
// non-network contexts (file://, Electron) where window.location.hostname is empty.
function smartDefaultBackendHost() {
  const host = (typeof window !== 'undefined' && window.location?.hostname) || '127.0.0.1';
  return `${host}:8000`;
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
  localStorage.setItem('backend_host', host);
  window.location.reload();
};

export const getSuggestedBackendHost = () => {
  // Already configured? Honour it (preserve whatever the user has, with or without http://).
  const configured = localStorage.getItem('backend_host');
  if (configured) return configured;
  // Smart default shown in the Settings field: a fully-qualified URL.
  return `http://${smartDefaultBackendHost()}`;
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
