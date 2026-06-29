/**
 * P7-9: 前端本地 LSP 解析器 — 桌面壳模式下启动本机 LSP server,
 * 解析代码 → 组装 symbols/calls/refs → 通过后端 /api/graph/ingest 入库.
 *
 * <h3>流程</h3>
 * <ol>
 *   <li>{@link #start}(languageId, rootPath) — 启动 LSP 进程 + initialize</li>
 *   <li>{@link #parseFile}(file) — didOpen + documentSymbol + prepareCallHierarchy
 *       + outgoingCalls + didClose, 返 { relPath, symbols, calls, refs, fingerprint }</li>
 *   <li>{@link #parseWorkspace}(...) — 全量解析 + ingest (clearFirst=true)</li>
 *   <li>{@link #parseIncremental}(...) — 基于 {@link LocalLspFingerprintStore} 的增量</li>
 *   <li>{@link #dispose}() — 关 LSP 进程</li>
 * </ol>
 *
 * <h3>后端 ingest schema 对齐</h3>
 * <ul>
 *   <li>{@code file.fingerprint}: { md5, mtime }</li>
 *   <li>{@code symbol}: { name, kind, startLine, endLine, startCol, containerName } (kind 字符串)</li>
 *   <li>{@code call}: { srcSymbol: {name, containerName, startLine, endLine},
 *                       dst: {name, containerName, relPath, startLine, endLine, kind} }</li>
 *   <li>{@code ref}:  { srcSymbol: {...}, refLocation: { relPath, startLine, endLine } }</li>
 * </ul>
 *
 * <p>注: line/col 全部 0-based (后端 ingest 时会 +1 转 1-based 存储).</p>
 *
 * <p>本 PR 仅实现 calls (outgoing). refs 留空数组, 留待 PR4 实现 references 接口.</p>
 */
import api from '../auth';
import { LocalLspFingerprintStore } from './LocalLspFingerprintStore';

/** 各语言的 LSP binary + 启动参数 + 文件扩展名.
 *  PR7: 导出给 ParserFactory 做探测. */
export const LSP_LANGUAGE_CONFIG = {
  typescript: { binary: 'typescript-language-server', args: ['--stdio'], extensions: ['.ts', '.tsx'] },
  javascript: { binary: 'typescript-language-server', args: ['--stdio'], extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  python:     { binary: 'pyright-langserver', args: ['--stdio'], extensions: ['.py'] },
  go:         { binary: 'gopls', args: ['serve'], extensions: ['.go'] },
  java:       { binary: 'jdtls', args: [], extensions: ['.java'] },
};
// 内部沿用旧名, 保持模块其余代码不动.
const LANGUAGE_CONFIG = LSP_LANGUAGE_CONFIG;

/** LSP SymbolKind 数字 → 字符串 (与后端 kind 字段对齐). */
const SYMBOL_KIND_STR = {
  1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class',
  6: 'method', 7: 'property', 8: 'field', 9: 'constructor', 10: 'enum',
  11: 'interface', 12: 'function', 13: 'variable', 14: 'constant',
  15: 'string', 16: 'number', 17: 'boolean', 18: 'array', 19: 'object',
  20: 'key', 21: 'null', 22: 'enummember', 23: 'struct', 24: 'event',
  25: 'operator', 26: 'typeparameter',
};

/** 是不是可调用的 symbol (function/method/constructor). */
const CALLABLE_KINDS = new Set([6, 9, 12]);

/** 是不是值得跑 references 的 symbol (定义级别, 跨文件被引用).
 *  variable(13)/local var 不做 — 同文件内引用价值低, 数量爆炸. */
const REFERENCEABLE_KINDS = new Set([
  5,   // class
  6,   // method
  7,   // property
  8,   // field
  9,   // constructor
  10,  // enum
  11,  // interface
  12,  // function
  14,  // constant
  22,  // enummember
  23,  // struct
  26,  // typeparameter
]);

/** 单 symbol references 上限, 防大项目爆炸. */
const MAX_REFS_PER_SYMBOL = 50;

let _nextId = 1;

export class LocalLspParser {
  constructor() {
    this.child = null;
    this.languageId = null;
    this.rootPath = null;
    this.rootUri = null;
    this.pending = new Map(); // id → {resolve, reject, method, timer}
    this.capabilities = null;
    this.initialized = false;
  }

  /** 是否在桌面壳中 (有 window.autobotDesktop.spawnLsp). */
  static isAvailable() {
    return typeof window !== 'undefined'
      && window.autobotDesktop?.isDesktop === true
      && typeof window.autobotDesktop.spawnLsp === 'function';
  }

  /** 当前是否已初始化 (start 成功). */
  isReady() {
    return this.initialized && this.child != null;
  }

  /**
   * 启动 LSP 进程 + initialize.
   * @param {string} languageId  'typescript' | 'javascript' | 'python' | 'go' | 'java'
   * @param {string} rootPath    项目根绝对路径
   */
  async start(languageId, rootPath) {
    if (!LocalLspParser.isAvailable()) {
      throw new Error('LocalLspParser 仅在桌面壳模式可用 (无 window.autobotDesktop.spawnLsp)');
    }
    if (this.initialized) {
      // 已经在跑同语言同根 → 直接复用
      if (this.languageId === languageId && this.rootPath === rootPath) return this;
      // 否则先关旧的
      this.dispose();
    }
    const cfg = LANGUAGE_CONFIG[languageId];
    if (!cfg) throw new Error(`unsupported language: ${languageId}`);

    const probe = await window.autobotDesktop.which(cfg.binary);
    if (!probe.found) {
      throw new Error(`LSP binary "${cfg.binary}" 未安装 — 请在 LSP 设置面板安装`);
    }

    this.languageId = languageId;
    this.rootPath = rootPath;
    this.rootUri = pathToUri(rootPath);

    this.child = window.autobotDesktop.spawnLsp(probe.path, cfg.args, { cwd: rootPath });
    this.child.onMessage((msg) => this._onMessage(msg));
    this.child.onExit((code) => {
      // eslint-disable-next-line no-console
      console.warn('[LocalLspParser] LSP exited code=', code);
      this._rejectAll(new Error(`LSP exited code=${code}`));
      this.child = null;
      this.initialized = false;
    });
    this.child.onError((e) => {
      // eslint-disable-next-line no-console
      console.error('[LocalLspParser] LSP error', e);
      this._rejectAll(e);
    });

    // initialize (LSP 冷启动久, 30s 超时)
    const initResult = await this._request('initialize', {
      processId: null,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didChange: true, didClose: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          callHierarchy: { dynamicRegistration: false },
          references: {},
        },
      },
      initializationOptions: {},
    }, 30000);
    this.capabilities = initResult && initResult.capabilities;
    this._notify('initialized', {});
    this.initialized = true;
    return this;
  }

  /** 关闭 LSP 进程. */
  dispose() {
    if (this.child) {
      try { this.child.kill(); } catch (_) {}
      this.child = null;
    }
    this._rejectAll(new Error('disposed'));
    this.initialized = false;
    this.capabilities = null;
  }

  /**
   * 解析单文件 → { relPath, symbols, calls, refs, fingerprint }.
   * @param {{relPath, content, md5, mtime, size}} file
   */
  async parseFile(file) {
    if (!this.isReady()) throw new Error('LSP not initialized');
    const uri = uriForRelPath(this.rootUri, file.relPath);

    // 1. didOpen
    await this._notify('textDocument/didOpen', {
      textDocument: { uri, languageId: this.languageId, version: 1, text: file.content },
    });

    // 2. documentSymbol
    let symbols = [];
    try {
      const r = await this._request('textDocument/documentSymbol', { textDocument: { uri } });
      symbols = flattenDocumentSymbol(r || []);
    } catch (e) {
      // server 不支持 → 跳过
    }

    // 3. 对每个 Method/Function/Constructor 调 prepareCallHierarchy + outgoingCalls
    const calls = [];
    for (const sym of symbols) {
      if (!CALLABLE_KINDS.has(sym.kindNum)) continue;
      try {
        const items = await this._request('textDocument/prepareCallHierarchy', {
          textDocument: { uri },
          position: { line: sym.startLine, character: sym.startCol },
        });
        if (!Array.isArray(items) || items.length === 0) continue;
        for (const item of items) {
          // outgoing (本函数调用了谁)
          try {
            const outs = await this._request('callHierarchy/outgoingCalls', { item });
            if (Array.isArray(outs)) {
              for (const o of outs) {
                calls.push({
                  srcSymbol: {
                    name: sym.name,
                    containerName: sym.containerName || '',
                    startLine: sym.startLine,
                    endLine: sym.endLine,
                  },
                  dst: {
                    name: o.to.name,
                    containerName: o.to.detail || '',
                    relPath: uriToRelPath(o.to.uri, this.rootUri),
                    startLine: o.to.selectionRange ? o.to.selectionRange.start.line : 0,
                    endLine: o.to.range ? o.to.range.end.line : (o.to.selectionRange ? o.to.selectionRange.start.line : 0),
                    kind: kindToStr(o.to.kind),
                  },
                });
              }
            }
          } catch (_) { /* server 不支持 outgoingCalls → 跳过 */ }
          // incomingCalls 在大项目上爆炸 (n×m), 不做 — references 接口在 PR4 处理
        }
      } catch (_) { /* server 不支持 callHierarchy → 跳过 */ }
    }

    // 4. didClose
    try {
      await this._notify('textDocument/didClose', { textDocument: { uri } });
    } catch (_) {}

    // 5. references — 对每个"定义级" symbol 跑 textDocument/references
    //    位置取 selectionRange.start, includeDeclaration: false (避免自引用)
    //    每个 symbol 上限 MAX_REFS_PER_SYMBOL, 防大项目爆炸
    const refs = [];
    for (const sym of symbols) {
      if (!REFERENCEABLE_KINDS.has(sym.kindNum)) continue;
      try {
        const locs = await this._request('textDocument/references', {
          textDocument: { uri },
          position: { line: sym.startLine, character: sym.startCol },
          context: { includeDeclaration: false },
        });
        if (!Array.isArray(locs)) continue;
        for (let i = 0; i < Math.min(locs.length, MAX_REFS_PER_SYMBOL); i++) {
          const loc = locs[i];
          if (!loc || !loc.uri || !loc.range) continue;
          const refRel = uriToRelPath(loc.uri, this.rootUri);
          // 后端会再次过滤自引用, 这里也提前跳过减少数据量
          if (refRel === file.relPath && loc.range.start.line === sym.startLine) continue;
          refs.push({
            srcSymbol: {
              name: sym.name,
              containerName: sym.containerName || '',
              startLine: sym.startLine,
              endLine: sym.endLine,
            },
            refLocation: {
              relPath: refRel,
              startLine: loc.range.start.line,
              endLine: loc.range.end.line,
              startCol: loc.range.start.character,
            },
          });
        }
      } catch (_) { /* server 不支持 references → 跳过 */ }
    }

    return {
      relPath: file.relPath,
      symbols,
      calls,
      refs,
      fingerprint: { md5: file.md5, mtime: file.mtime },
    };
  }

  /**
   * 全量解析整个 workspace, 写入后端.
   * @param {string} workspaceId
   * @param {string} rootPath
   * @param {string} languageId
   * @param {(p:{phase, processed, total, currentFile})=>void} [onProgress]
   * @returns {Promise<{files: number, ingest: object}>}
   */
  async parseWorkspace(workspaceId, rootPath, languageId, onProgress = () => {}) {
    await this.start(languageId, rootPath);
    const cfg = LANGUAGE_CONFIG[languageId];
    const files = await window.autobotDesktop.readCodeFiles(rootPath, { extensions: cfg.extensions });
    onProgress({ phase: 'building', processed: 0, total: files.length, currentFile: null });

    const fpStore = new LocalLspFingerprintStore(workspaceId);
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      onProgress({ phase: 'building', processed: i, total: files.length, currentFile: f.relPath });
      try {
        const r = await this.parseFile(f);
        results.push(r);
        fpStore.update(f);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[LocalLspParser] parse failed', f.relPath, e.message);
      }
    }
    onProgress({ phase: 'done', processed: files.length, total: files.length, currentFile: null });

    const ingest = await this.ingest(workspaceId, rootPath, results, true);
    return { files: files.length, ingest };
  }

  /**
   * 增量解析 — 仅对 mtime/md5 变更的文件跑 LSP, 写入后端.
   * @param {string} workspaceId
   * @param {string} rootPath
   * @param {string} languageId
   * @param {(p)=>void} [onProgress]
   */
  async parseIncremental(workspaceId, rootPath, languageId, onProgress = () => {}) {
    await this.start(languageId, rootPath);
    const cfg = LANGUAGE_CONFIG[languageId];
    const files = await window.autobotDesktop.readCodeFiles(rootPath, { extensions: cfg.extensions });
    const fpStore = new LocalLspFingerprintStore(workspaceId);
    const { added, modified, deleted } = fpStore.diff(files);
    const changed = new Set([...added, ...modified]);
    const toParse = files.filter(f => changed.has(f.relPath));

    onProgress({ phase: 'building', processed: 0, total: toParse.length, currentFile: null });
    const results = [];
    for (let i = 0; i < toParse.length; i++) {
      const f = toParse[i];
      onProgress({ phase: 'building', processed: i, total: toParse.length, currentFile: f.relPath });
      try {
        const r = await this.parseFile(f);
        results.push(r);
        fpStore.update(f);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[LocalLspParser] parse failed', f.relPath, e.message);
      }
    }
    // 删除文件的指纹也清掉 (后端 ingest 没暴露 delete-file, 节点留到下次全量重建)
    for (const p of deleted) fpStore.remove(p);
    onProgress({ phase: 'done', processed: toParse.length, total: toParse.length, currentFile: null });

    if (results.length === 0) {
      return { files: 0, skipped: true, added: added.length, modified: modified.length, deleted: deleted.length };
    }
    const ingest = await this.ingest(workspaceId, rootPath, results, false);
    return {
      files: results.length,
      added: added.length, modified: modified.length, deleted: deleted.length,
      ingest,
    };
  }

  /** POST /api/graph/ingest. */
  async ingest(workspaceId, rootPath, files, clearFirst) {
    const r = await api.post('/graph/ingest', { workspaceId, rootPath, clearFirst, files });
    return r.data;
  }

  // ── 内部: LSP JSON-RPC ────────────────────────────────────

  _request(method, params, timeoutMs = 10000) {
    if (!this.child) return Promise.reject(new Error('LSP not started'));
    const id = _nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.child.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  _notify(method, params) {
    if (!this.child) return Promise.reject(new Error('LSP not started'));
    this.child.write(JSON.stringify({ jsonrpc: '2.0', method, params }));
    return Promise.resolve();
  }

  _onMessage(msg) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message || 'lsp error'}`));
      else p.resolve(msg.result);
    }
    // 通知类消息 (publishDiagnostics/window/...) 暂忽略 — 本 PR 只关心图构建
  }

  _rejectAll(e) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(e);
    }
    this.pending.clear();
  }
}

// ── helpers ───────────────────────────────────────────────

function pathToUri(p) {
  const norm = String(p).replace(/\\/g, '/');
  return 'file:///' + norm.replace(/^\/+/, '');
}

function uriForRelPath(rootUri, relPath) {
  return rootUri.replace(/\/$/, '') + '/' + relPath.replace(/^\/+/, '');
}

function uriToRelPath(uri, rootUri) {
  if (!uri) return '';
  const prefix = rootUri.replace(/\/$/, '') + '/';
  if (uri.startsWith(prefix)) return uri.slice(prefix.length);
  // fallback: file:///<abs> → 取 basename
  const m = /\/([^/]+)$/.exec(uri);
  return m ? m[1] : uri;
}

function kindToStr(kindNum) {
  return SYMBOL_KIND_STR[kindNum] || 'symbol';
}

/**
 * 把 DocumentSymbol[] (嵌套) 或 SymbolInformation[] 拍平成统一格式.
 * 返回 [{ name, kind(str), kindNum, startLine, endLine, startCol, containerName }].
 */
function flattenDocumentSymbol(syms) {
  const out = [];
  function walkDocument(arr, parentName) {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      const sl = s.selectionRange || s.range;
      const el = s.range;
      out.push({
        name: s.name || '',
        kind: kindToStr(s.kind),
        kindNum: s.kind,
        startLine: sl ? sl.start.line : 0,
        startCol: sl ? sl.start.character : 0,
        endLine: el ? el.end.line : (sl ? sl.start.line : 0),
        containerName: parentName || '',
      });
      if (s.children && s.children.length) walkDocument(s.children, s.name);
    }
  }
  function walkSymbolInfo(arr) {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      out.push({
        name: s.name || '',
        kind: kindToStr(s.kind),
        kindNum: s.kind,
        startLine: s.location ? s.location.range.start.line : 0,
        startCol: s.location ? s.location.range.start.character : 0,
        endLine: s.location ? s.location.range.end.line : (s.location ? s.location.range.start.line : 0),
        containerName: s.containerName || '',
      });
    }
  }
  // 启发: DocumentSymbol 有 range/selectionRange/children; SymbolInformation 有 location
  if (syms.length > 0 && syms[0].location) {
    walkSymbolInfo(syms);
  } else {
    walkDocument(syms, '');
  }
  return out;
}
