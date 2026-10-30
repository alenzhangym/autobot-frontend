/**
 * [后端地址解析的唯一定义] `backend_host` 的归一化、解析, 以及 API / WS 基址的派生。
 *
 * <p>为什么需要这个模块(2026-10-30 事故): "设置后端地址为 http://127.0.0.1:8000 却没生效"。
 * host 的取值此前散落在 4 处、fallback 链各不相同:
 * <ul>
 *   <li>auth.js: localStorage → VITE_BACKEND_HOST → 远端默认地址;</li>
 *   <li>helpers.jsx 的 iframe bridge: 只读 `window.parent.localStorage`, 否则 hostname:8000;</li>
 *   <li>helpers.jsx 的 fetchMissingDataFromServer: localStorage → VITE → hostname:8000, 且**不带 http://**;</li>
 *   <li>App.jsx 的更新下载: localStorage → VITE → hostname:8000。</li>
 * </ul>
 * 结果是同一页面里 `/api/skills` 打到本机、`/api/chat` 却打到远端, 用户看到的现象就是"设置没起作用"。</p>
 *
 * <p>本模块只做**纯计算**(不读 localStorage、不读 DOM), 所以可以被 node:test 直接单测;
 * 由 auth.js 负责把 stored / env / location 喂进来。</p>
 */

/** 未配置时的默认后端(公网那台). 必须与 Home.jsx 的 INSTALL_DEFAULT_BACKEND_HOST 保持一致。 */
export const DEFAULT_BACKEND_HOST = 'http://120.26.113.95:8000';

/** localStorage 里保存后端地址的键。改变此值等于让所有用户已保存的配置失效。 */
export const BACKEND_HOST_STORAGE_KEY = 'backend_host';

/**
 * 把用户输入的地址归一化成 `http(s)://host[:port]`:
 * 去空白、去尾部斜杠、缺协议时补 `http://`(大小写不敏感, 已带协议则原样保留)。
 * 空输入返回 `''` —— 调用方据此判断"用户清空了"。
 */
export function normalizeBackendHost(raw) {
  if (raw === null || raw === undefined) return '';
  let host = String(raw).trim().replace(/\/+$/, '');
  if (!host) return '';
  if (!/^http(s)?:\/\//i.test(host)) {
    host = `http://${host.replace(/^\/+/, '')}`;
  }
  return host;
}

/**
 * 页面由后端自己服务时(默认端口 8000)默认同源。
 *
 * <p>否则本地装完前端、打开 `http://127.0.0.1:8000` 却仍然把请求发给远端默认后端 ——
 * 这是"本地 E2E 看不到自己的日志"的另一半原因。只在 8000 端口生效, 不动其它部署形态:
 * 用 `npm start`(:3000) 或 Vite(:5173) 打开前端的人, 默认依旧是远端(与安装说明一致)。</p>
 */
export function sameOriginBackendHost(location) {
  if (!location) return '';
  const protocol = location.protocol || '';
  const hostname = location.hostname || '';
  const port = location.port || '';
  if (protocol === 'http:' && port === '8000' && hostname) {
    return `http://${hostname}:8000`;
  }
  return '';
}

/**
 * 解析生效的后端地址, 优先级: 用户显式保存 → 构建期 env → 同源(:8000) → 远端默认。
 */
export function resolveBackendHost({ stored, env, location } = {}) {
  return (
    normalizeBackendHost(stored) ||
    normalizeBackendHost(env) ||
    sameOriginBackendHost(location) ||
    DEFAULT_BACKEND_HOST
  );
}

/**
 * 由后端地址派生 axios 的 baseURL。
 * https 一律降级成 http —— 后端只监听 http, 保留这条历史行为以免混合内容被浏览器拦掉。
 */
export function apiBaseUrlFromHost(host) {
  const h = normalizeBackendHost(host) || DEFAULT_BACKEND_HOST;
  return `${h.replace(/^https:\/\//i, 'http://')}/api`;
}

/**
 * 由后端地址派生 WebSocket 基址(日志通道 / react 事件通道共用)。
 * token 与 http 请求是同一份, 所以这两个 URL 必须和 baseURL 出自同一个 host。
 */
export function wsBaseUrlFromHost(host) {
  const h = (normalizeBackendHost(host) || DEFAULT_BACKEND_HOST).replace(/^https:\/\//i, 'http://');
  return `ws://${h.replace(/^http:\/\//i, '')}`;
}
