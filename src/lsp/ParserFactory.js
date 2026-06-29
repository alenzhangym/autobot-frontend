/**
 * PR7: ParserFactory — 根据本机 LSP 是否已安装, 动态选择 LocalLspParser 或 TreeSitterParser.
 *
 * <h3>策略</h3>
 * <ol>
 *   <li>浏览器模式 + 本机 agent 可用 + tree-sitter 支持该语言: 用 TreeSitterParser
 *       (浏览器无法 spawn LSP 进程, 只能走纯前端 wasm 解析; 文件通过本机 agent HTTP API 读取).</li>
 *   <li>浏览器模式 + 本机 agent 不可用: 返回 null, 上层 GraphStatusPanel 提示用户启本机 agent.</li>
 *   <li>桌面壳 + LSP binary 已装: 用 LocalLspParser (精确, 含真实 call hierarchy / references).</li>
 *   <li>桌面壳 + LSP binary 未装: 回退 TreeSitterParser (基于 wasm AST, 仅符号+调用边+name 匹配 refs).</li>
 * </ol>
 *
 * <h3>对外接口</h3>
 * <ul>
 *   <li>{@link ParserFactory.probe}(languageId) → 'lsp' | 'tree-sitter' | null</li>
 *   <li>{@link ParserFactory.create}(languageId, rootPath) → { parser, backend }</li>
 * </ul>
 *
 * <p>parser 对外暴露的接口 (LocalLspParser / TreeSitterParser 一致):
 * start / parseWorkspace / parseIncremental / dispose.</p>
 */
import axios from 'axios';
import { getLocalAgentBaseUrl } from '../auth';
import { LocalLspParser, LSP_LANGUAGE_CONFIG } from './LocalLspParser';
import { TreeSitterParser } from './TreeSitterParser';

/** 探测结果缓存 — 同会话同语言只查一次 which, 避免每次 build 重复 fork where/which. */
const _probeCache = new Map(); // `${languageId}` → 'lsp' | 'tree-sitter' | null

/** 本机 agent 可用性缓存 (一次会话只探一次). */
let _localAgentAvailableCache = null;

export class ParserFactory {
  /**
   * 是否在桌面壳中 (基本前置条件).
   */
  static isDesktop() {
    return typeof window !== 'undefined'
      && window.autobotDesktop?.isDesktop === true
      && typeof window.autobotDesktop.which === 'function';
  }

  /**
   * 浏览器模式: 探测本机 agent (local agent) 是否可用.
   * 本机 agent 提供 /api/local/workspace/list + /read, 浏览器靠它读文件.
   * 一次会话只探一次, 缓存结果.
   */
  static async isLocalAgentAvailable() {
    if (this.isDesktop()) return true; // 桌面壳不需要本机 agent
    if (_localAgentAvailableCache !== null) return _localAgentAvailableCache;
    try {
      await axios.get(`${getLocalAgentBaseUrl()}/api/local/status`, { timeout: 2000 });
      _localAgentAvailableCache = true;
    } catch (_) {
      _localAgentAvailableCache = false;
    }
    return _localAgentAvailableCache;
  }

  /**
   * 探测当前语言用哪个 backend.
   * @param {string} languageId  'typescript' | 'javascript' | 'python' | 'go' | 'java' | 'tsx'
   * @returns {Promise<'lsp' | 'tree-sitter' | null>}
   *   - 'lsp': 桌面壳 + LSP binary 已装
   *   - 'tree-sitter':
   *       a) 桌面壳 + LSP binary 未装 (wasm 总可用)
   *       b) 浏览器 + 本机 agent 可用 (wasm 总可用)
   *   - null: 不支持的语言 / 浏览器但本机 agent 不可用
   */
  static async probe(languageId) {
    // tree-sitter 必须支持该语言 (桌面壳和浏览器都靠它做回退)
    if (!TreeSitterParser.supportsLanguage(languageId)) return null;

    // 浏览器模式: 永远走 tree-sitter (无法 spawn LSP), 但需要本机 agent 提供文件
    if (!this.isDesktop()) {
      const agentOk = await this.isLocalAgentAvailable();
      return agentOk ? 'tree-sitter' : null;
    }

    // 桌面壳: LSP 优先, tree-sitter 回退
    // LSP_LANGUAGE_CONFIG 不含 tsx (tsx 走 typescript binary)
    const langKey = languageId === 'tsx' ? 'typescript' : languageId;
    const lspCfg = LSP_LANGUAGE_CONFIG[langKey];
    if (!lspCfg) return null; // LSP 不支持该语言 → 桌面壳下不启用 (保持 PR7 行为)

    const cacheKey = langKey;
    if (_probeCache.has(cacheKey)) return _probeCache.get(cacheKey);

    let backend = 'tree-sitter';
    try {
      const probe = await window.autobotDesktop.which(lspCfg.binary);
      if (probe.found) backend = 'lsp';
    } catch (_) {
      // which 抛错时保守走 tree-sitter
    }
    _probeCache.set(cacheKey, backend);
    return backend;
  }

  /**
   * 清除探测缓存 — 用户在 LSP 设置面板装了新 LSP 后应调用, 否则本次会话还会走旧路径.
   * 同时清本机 agent 可用性缓存 (用户可能刚启动本机 agent).
   */
  static invalidateCache(languageId = null) {
    if (languageId) _probeCache.delete(languageId);
    else _probeCache.clear();
    _localAgentAvailableCache = null;
  }

  /**
   * 创建 parser 实例并 start. 上层调用方拿到后直接 parseWorkspace / parseIncremental.
   *
   * @param {string} languageId
   * @param {string} rootPath
   * @returns {Promise<{parser, backend: 'lsp'|'tree-sitter'}>}
   * @throws {Error} 浏览器模式 / 不支持的语言 / LSP 启动失败且 tree-sitter 也失败
   */
  static async create(languageId, rootPath) {
    const backend = await this.probe(languageId);
    if (backend === null) {
      throw new Error(`ParserFactory.create: 不支持的语言或非桌面壳 (languageId=${languageId})`);
    }

    if (backend === 'lsp') {
      const parser = new LocalLspParser();
      try {
        await parser.start(languageId, rootPath);
        return { parser, backend };
      } catch (e) {
        // LSP 启动失败 (binary 存在但版本不兼容 / jdtls 需要 java 等) → 回退 tree-sitter
        // eslint-disable-next-line no-console
        console.warn('[ParserFactory] LSP start 失败, 回退 tree-sitter:', e.message);
        _probeCache.set(languageId === 'tsx' ? 'typescript' : languageId, 'tree-sitter');
        // fall through 到 tree-sitter 分支
      }
    }

    // tree-sitter 分支
    const parser = new TreeSitterParser();
    await parser.start(languageId, rootPath);
    return { parser, backend: 'tree-sitter' };
  }
}
