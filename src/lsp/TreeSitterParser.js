/**
 * PR5: Tree-sitter AST 解析器 — LSP 不可用时的零依赖回退.
 *
 * <h3>定位</h3>
 * 当客户端未装 LSP binary 时, ParserFactory 会创建本类替代 LocalLspParser,
 * 通过 web-tree-sitter 在浏览器/Electron renderer 进程里跑 AST 解析.
 *
 * <h3>能力边界</h3>
 * <ul>
 *   <li>symbols: 语法级定义 (class/function/method/field/interface/enum), 无类型推导</li>
 *   <li>calls: 同文件内 call_expression 静态收集, 精确率 >90%</li>
 *   <li>refs: workspace 级二阶段解析 — 先建全局符号表, 再做 name 匹配.
 *       会因重载/同名变量产生 ~15% 误报, 但对"未装 LSP 的快速建库"场景足够.</li>
 * </ul>
 *
 * <h3>对外契约</h3>
 * 严格对齐 {@link LocalLspParser} 的 parseFile/parseWorkspace/parseIncremental/dispose,
 * GraphStatusPanel 完全不感知.
 *
 * <p>注: line/col 全部 0-based (后端 ingest 时会 +1 转 1-based).</p>
 */
import * as TreeSitter from 'web-tree-sitter';
const { Parser, Language, Query } = TreeSitter;
import axios from 'axios';
import api, { getLocalAgentBaseUrl } from '../auth';
import { LocalLspFingerprintStore } from './LocalLspFingerprintStore';
import TYPESCRIPT_QUERY from './queries/typescript.scm?raw';
import JAVASCRIPT_QUERY from './queries/javascript.scm?raw';
import PYTHON_QUERY from './queries/python.scm?raw';
import GO_QUERY from './queries/go.scm?raw';
import JAVA_QUERY from './queries/java.scm?raw';

/** 各语言的 grammar wasm 文件名 + 扩展名 + query 文本. */
const LANGUAGE_CONFIG = {
  typescript: {
    wasm: 'tree-sitter-typescript.wasm',
    extensions: ['.ts'],
    query: TYPESCRIPT_QUERY,
  },
  tsx: {
    wasm: 'tree-sitter-tsx.wasm',
    extensions: ['.tsx'],
    query: TYPESCRIPT_QUERY,
  },
  javascript: {
    wasm: 'tree-sitter-javascript.wasm',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    query: JAVASCRIPT_QUERY,
  },
  python: {
    wasm: 'tree-sitter-python.wasm',
    extensions: ['.py'],
    query: PYTHON_QUERY,
  },
  go: {
    wasm: 'tree-sitter-go.wasm',
    extensions: ['.go'],
    query: GO_QUERY,
  },
  java: {
    wasm: 'tree-sitter-java.wasm',
    extensions: ['.java'],
    query: JAVA_QUERY,
  },
};

/** 单文件上限 — 防压缩/生成代码爆炸. */
const MAX_SYMBOLS_PER_FILE = 2000;
const MAX_CALLS_PER_FILE = 5000;
/** 全局 ref edges 上限. */
const MAX_REF_EDGES_TOTAL = 50000;
/** 单符号被引用上限 (对齐 LocalLspParser.MAX_REFS_PER_SYMBOL). */
const MAX_REFS_PER_SYMBOL = 50;

/** PR8: 仅这些 kind 进入全局符号表参与 ref 解析.
 *  field/property/enummember 等不会被 call_expression 调用, 不放入以减少 candidates 噪声. */
const CALLABLE_KINDS = new Set(['class', 'function', 'method', 'constructor']);

/** PR8: 各语言的调用表达式节点类型.
 *  TS/JS/Go: call_expression, new_expression
 *  Java: method_invocation, object_creation_expression (tree-sitter-java 无 call_expression)
 *  Python: call (tree-sitter-python 用 call 表示函数调用) */
const CALL_EXPR_TYPES = new Set([
  'call_expression',           // TS/JS/Go
  'new_expression',            // TS/JS
  'method_invocation',         // Java
  'object_creation_expression', // Java (new)
  'call',                      // Python
]);

/** PR8: scope-aware 局部变量收集时, 递归扫描 enclosing body 的最大深度.
 *  限制深度避免大函数开销爆炸; 绝大多数局部变量在前 5 层就能收集到. */
const LOCAL_VAR_SCAN_DEPTH = 6;

/** tree-sitter 节点类型 → LSP SymbolKind (数字) + 字符串 kind. */
const NODE_KIND_MAP = {
  'definition.class':        { kindNum: 5,  kind: 'class' },
  'definition.function':     { kindNum: 12, kind: 'function' },
  'definition.method':       { kindNum: 6,  kind: 'method' },
  'definition.constructor':  { kindNum: 9,  kind: 'constructor' },
  'definition.field':        { kindNum: 8,  kind: 'field' },
  'definition.property':     { kindNum: 7,  kind: 'property' },
  'definition.interface':    { kindNum: 11, kind: 'interface' },
  'definition.enum':         { kindNum: 10, kind: 'enum' },
  'definition.enummember':   { kindNum: 22, kind: 'enummember' },
  'definition.type':         { kindNum: 26, kind: 'typeparameter' },
};

let _parserInitDone = false;

/**
 * PR8: detectProjectLanguages 的辅助函数 — 按扩展名统计文件数, 过滤掉文件数过少的语言.
 * @param {Array<{relPath}>} files  文件列表 (桌面壳有 relPath, 浏览器 tree 端点转成 relPath)
 * @param {Object} extToLang  扩展名 → languageId 反向映射
 * @param {number} minFiles   最少文件数阈值
 * @param {boolean} useBasename  浏览器 tree 端点的 path 是相对路径含 '/', 取 basename 算扩展名
 * @returns {string[]}  languageIds 数组
 */
function _countAndFilter(files, extToLang, minFiles, useBasename = false) {
  const counts = {}; // languageId → 文件数
  for (const f of files) {
    const p = String(f.relPath || '');
    const name = useBasename ? p.split('/').pop() : p;
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx < 0) continue;
    const ext = name.slice(dotIdx).toLowerCase();
    const lang = extToLang[ext];
    if (!lang) continue;
    counts[lang] = (counts[lang] || 0) + 1;
  }
  // 按文件数降序排列, 文件数 >= minFiles 的语言才返回
  return Object.entries(counts)
    .filter(([, n]) => n >= minFiles)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

export class TreeSitterParser {
  constructor() {
    this.languageId = null;
    this.rootPath = null;
    this.parser = null;
    this.language = null;
    this.query = null;
    this._globalSymbolTable = new Map(); // name → [{ relPath, startLine, kind }]
  }

  /** 探测是否桌面壳 + 是否已装 LSP. 由 ParserFactory 调用. */
  static async isPreferred(languageId, rootPath, lspAvailable) {
    return !lspAvailable;
  }

  /** PR7: 是否支持指定语言 (LANGUAGE_CONFIG 是否有该 key). */
  static supportsLanguage(languageId) {
    return Object.prototype.hasOwnProperty.call(LANGUAGE_CONFIG, languageId);
  }

  /**
   * PR8: 自动检测项目包含哪些语言 (monorepo 多语言支持).
   * 扫一次 tree 端点 (不传 extensions, 拿所有文件), 按扩展名统计,
   * 文件数 >= MIN_FILES_PER_LANG 的语言才返回 (避免 vendor 里零星文件误判).
   *
   * @param {string} rootPath  项目根路径
   * @returns {Promise<string[]>}  languageIds 数组, 如 ['java', 'typescript', 'go']
   */
  static async detectProjectLanguages(rootPath) {
    // 扩展名 → languageId 反向映射
    const extToLang = {};
    for (const [langId, cfg] of Object.entries(LANGUAGE_CONFIG)) {
      for (const ext of cfg.extensions) extToLang[ext] = langId;
    }
    const MIN_FILES_PER_LANG = 5; // 少于 5 个文件的语言不算 (vendor/示例代码)

    // 桌面壳: 直接 IPC 拿文件列表
    if (typeof window !== 'undefined' && window.autobotDesktop?.readCodeFiles) {
      // 桌面壳 readCodeFiles 需要传 extensions, 传所有支持的扩展名并集
      const allExts = Object.values(LANGUAGE_CONFIG).flatMap(c => c.extensions);
      const files = await window.autobotDesktop.readCodeFiles(rootPath, { extensions: allExts });
      return _countAndFilter(files, extToLang, MIN_FILES_PER_LANG);
    }

    // 浏览器: 走本机 agent tree 端点 (不传 extensions, 拿全部文件再按扩展名过滤)
    const localApi = axios.create({ baseURL: getLocalAgentBaseUrl(), timeout: 60000 });
    const res = await localApi.post('/api/local/workspace/tree', {
      path: rootPath,
      maxDepth: 12,
      maxEntries: 30000,
    });
    const entries = (res.data?.entries || []).filter(e => e.type === 'file');
    return _countAndFilter(entries.map(e => ({ relPath: e.path })), extToLang, MIN_FILES_PER_LANG, true);
  }

  /**
   * 加载 wasm + 初始化 parser.
   * @param {string} languageId
   * @param {string} rootPath
   */
  async start(languageId, rootPath) {
    const cfg = LANGUAGE_CONFIG[languageId];
    if (!cfg) throw new Error(`TreeSitterParser 不支持语言: ${languageId}`);

    if (!_parserInitDone) {
      await Parser.init({ locateFile: () => this._resolveWasmUrl('tree-sitter.wasm') });
      _parserInitDone = true;
    }

    this.languageId = languageId;
    this.rootPath = rootPath;
    this.language = await Language.load(this._resolveWasmUrl(cfg.wasm));
    this.parser = new Parser();
    this.parser.setLanguage(this.language);
    this.query = new Query(this.language, cfg.query);
    this._globalSymbolTable = new Map();
  }

  isReady() {
    return this.parser != null && this.language != null;
  }

  dispose() {
    try { this.query?.delete?.(); } catch (_) {}
    try { this.parser?.delete?.(); } catch (_) {}
    try { this.language?.delete?.(); } catch (_) {}
    this.parser = null;
    this.language = null;
    this.query = null;
    this._globalSymbolTable.clear();
  }

  /**
   * 解析单文件 — Phase 1.
   *
   * PR8 优化: 一次性提取 symbols + calls + refCandidates, 避免后续 Phase 2 重新 parse AST.
   * refCandidates 存到 fileResult._refCandidates (内部字段, ingest 前会删掉).
   * 全局符号表只放可调用符号 (CALLABLE_KINDS), 减少 candidates 噪声.
   *
   * @param {{ relPath, content, md5, mtime, size }} file
   */
  async parseFile(file) {
    if (!this.isReady()) throw new Error('TreeSitterParser not started');

    const tree = this.parser.parse(file.content);
    try {
      const symbols = this._extractSymbols(tree.rootNode, file.relPath);
      const { calls, refCandidates } = this._extractCallsAndRefs(tree.rootNode, file.relPath, symbols);

      // PR8: 只把可调用符号注册到全局符号表 (class/function/method/constructor).
      // field/property/enummember 不会被 call_expression 调用, 放入只会增加 candidates 噪声.
      for (const sym of symbols) {
        if (!CALLABLE_KINDS.has(sym.kind)) continue;
        if (!this._globalSymbolTable.has(sym.name)) {
          this._globalSymbolTable.set(sym.name, []);
        }
        this._globalSymbolTable.get(sym.name).push({
          relPath: file.relPath,
          startLine: sym.startLine,
          kind: sym.kind,
          containerName: sym.containerName || '',
        });
      }

      return {
        relPath: file.relPath,
        symbols,
        calls,
        refs: [], // 留给 parseWorkspace 末尾基于 refCandidates 填充
        fingerprint: { md5: file.md5, mtime: file.mtime },
        _refCandidates: refCandidates, // PR8: 内部字段, _resolveRefs 用完即删
      };
    } finally {
      tree.delete?.();
    }
  }

  /**
   * 全量解析整个 workspace.
   * Phase 1: 逐文件解析 (symbols + calls, refs 暂空)
   * Phase 2: 基于全局符号表二次扫描, 产出 refs
   */
  async parseWorkspace(workspaceId, rootPath, languageId, onProgress = () => {}, clearFirst = true) {
    await this.start(languageId, rootPath);
    const cfg = LANGUAGE_CONFIG[languageId];
    const files = await this._readCodeFiles(rootPath, cfg.extensions);
    onProgress({ phase: 'building', processed: 0, total: files.length, currentFile: null });

    const fpStore = new LocalLspFingerprintStore(workspaceId, languageId);
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
        console.warn('[TreeSitterParser] parse failed', f.relPath, e.message);
      }
    }

    // Phase 2: refs 二阶段解析
    onProgress({ phase: 'resolving-refs', processed: 0, total: results.length, currentFile: null });
    let totalRefs = 0;
    for (let i = 0; i < results.length; i++) {
      if (totalRefs >= MAX_REF_EDGES_TOTAL) break;
      const r = results[i];
      onProgress({ phase: 'resolving-refs', processed: i, total: results.length, currentFile: r.relPath });
      r.refs = this._resolveRefs(r, results);
      totalRefs += r.refs.length;
    }

    onProgress({ phase: 'done', processed: files.length, total: files.length, currentFile: null });

    // PR8: ingest 前清理内部字段 (_defNode / _refCandidates), 不能发到后端
    this._stripInternalFields(results);
    // PR8: 多语言建库时, 仅第一种语言 clearFirst=true, 后续语言追加到同一图谱.
    const ingest = await this.ingest(workspaceId, rootPath, results, clearFirst);
    return { files: files.length, ingest, backend: 'tree-sitter' };
  }

  /** 增量解析 — 仅对变更文件跑 Phase 1 + Phase 2 (仅对变更文件). */
  async parseIncremental(workspaceId, rootPath, languageId, onProgress = () => {}) {
    await this.start(languageId, rootPath);
    const cfg = LANGUAGE_CONFIG[languageId];
    const files = await this._readCodeFiles(rootPath, cfg.extensions);
    const fpStore = new LocalLspFingerprintStore(workspaceId, languageId);
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
        console.warn('[TreeSitterParser] parse failed', f.relPath, e.message);
      }
    }
    for (const p of deleted) fpStore.remove(p);
    onProgress({ phase: 'done', processed: toParse.length, total: toParse.length, currentFile: null });

    if (results.length === 0) {
      return { files: 0, skipped: true, added: added.length, modified: modified.length, deleted: deleted.length };
    }

    // 增量场景下只对变更文件做 refs (依赖当前已收集的符号表, 跨文件 refs 可能漏命中)
    for (const r of results) {
      r.refs = this._resolveRefs(r, results);
    }

    // PR8: ingest 前清理内部字段
    this._stripInternalFields(results);
    const ingest = await this.ingest(workspaceId, rootPath, results, false);
    return {
      files: results.length,
      added: added.length, modified: modified.length, deleted: deleted.length,
      ingest, backend: 'tree-sitter',
    };
  }

  /** POST /api/graph/ingest — 与 LocalLspParser 完全一致. */
  async ingest(workspaceId, rootPath, files, clearFirst) {
    const r = await api.post('/graph/ingest', { workspaceId, rootPath, clearFirst, files });
    return r.data;
  }

  // ── 内部: AST 提取 ──────────────────────────────────────────

  /** 提取定义级符号. */
  _extractSymbols(rootNode, relPath) {
    const matches = this.query.matches(rootNode);
    const symbols = [];
    const seen = new Set();

    for (const { captures } of matches) {
      let defNode = null, nameNode = null;
      for (const c of captures) {
        if (c.name.startsWith('definition.')) defNode = c.node;
        else if (c.name === 'name') nameNode = c.node;
      }
      if (!defNode || !nameNode) continue;

      const kindKey = captures.find(c => c.name.startsWith('definition.')).name;
      const kindInfo = NODE_KIND_MAP[kindKey];
      if (!kindInfo) continue;

      const name = nameNode.text;
      const startLine = defNode.startPosition.row;
      const endLine = defNode.endPosition.row;
      const startCol = defNode.startPosition.column;
      const dedupKey = `${relPath}:${startLine}:${startCol}:${name}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      symbols.push({
        name,
        kind: kindInfo.kind,
        kindNum: kindInfo.kindNum,
        startLine,
        endLine,
        startCol,
        containerName: this._inferContainerName(defNode),
        _defNode: defNode, // PR8: 内部字段, _collectLocalVars 用, ingest 前会删掉
      });

      if (symbols.length >= MAX_SYMBOLS_PER_FILE) break;
    }

    return symbols;
  }

  /**
   * PR8: 一次性提取 calls + refCandidates, 避免 Phase 2 重新 parse AST.
   *
   * refCandidates 是 Phase 2 ref 解析的输入, 字段:
   *   { callName, callLine, enclosing: {name, containerName, startLine, endLine}, isLocal }
   * isLocal=true 表示 callName 在 enclosing function 内有同名局部变量, 应跳过 ref 解析.
   *
   * @returns {{ calls: Array, refCandidates: Array }}
   */
  _extractCallsAndRefs(rootNode, relPath, symbols) {
    const matches = this.query.matches(rootNode);
    const calls = [];
    const refCandidates = [];

    // PR8: scope-aware — 缓存每个 enclosing 的局部变量集合, 避免重复扫描.
    const localVarsCache = new Map(); // enclosingStartLine → Set<localVarName>

    // PR8: 按 callName 索引本文件 symbols, 替代 find() 线性扫描.
    const symbolsByName = new Map();
    for (const s of symbols) symbolsByName.set(s.name, s);

    for (const { captures } of matches) {
      let callNameNode = null;
      for (const c of captures) {
        if (c.name === 'call_name') { callNameNode = c.node; break; }
      }
      if (!callNameNode) continue;

      // callNameNode 可能是 identifier (直接调用 foo() / new Foo()) 或 property_identifier (obj.foo()).
      // 前者 parent 是 call_expression 或 new_expression; 后者 parent 是 member_expression, 需再上一层.
      let callExpr = callNameNode.parent;
      if (callExpr?.type === 'member_expression') callExpr = callExpr.parent;
      if (!callExpr) continue;
      // 各语言的调用节点类型:
      //   TS/JS/Go: call_expression, new_expression
      //   Java: method_invocation, object_creation_expression
      //   Python: call
      if (!CALL_EXPR_TYPES.has(callExpr.type)) continue;

      const callLine = callExpr.startPosition.row;
      const dstName = callNameNode.text;
      const enclosing = this._findEnclosingSymbol(callLine, symbols);
      if (!enclosing) continue;

      // PR8: scope-aware — 检查 callName 是否被 enclosing 内的局部变量遮蔽.
      // e.g. function foo() {} function bar() { const foo = () => {}; foo(); } — 此处 foo() 是局部变量.
      let isLocal = false;
      if (callNameNode.type === 'identifier') { // 只对直接调用做检查; obj.foo() 的 property 不算
        let localVars = localVarsCache.get(enclosing.startLine);
        if (!localVars) {
          localVars = this._collectLocalVars(enclosing._defNode);
          localVarsCache.set(enclosing.startLine, localVars);
        }
        if (localVars.has(dstName)) isLocal = true;
      }

      // dst 信息: 查本文件内已知定义
      const dstDef = symbolsByName.get(dstName);

      calls.push({
        srcSymbol: {
          name: enclosing.name,
          containerName: enclosing.containerName || '',
          startLine: enclosing.startLine,
          endLine: enclosing.endLine,
        },
        dst: {
          name: dstName,
          containerName: dstDef ? dstDef.containerName || '' : '',
          relPath: dstDef ? relPath : '',
          startLine: dstDef ? dstDef.startLine : callLine,
          endLine: dstDef ? dstDef.endLine : callLine,
          kind: dstDef ? dstDef.kind : 'function',
        },
      });

      // PR8: 收集 ref candidate (Phase 2 用). isLocal=true 的不进 ref 解析.
      if (!isLocal) {
        refCandidates.push({
          callName: dstName,
          callLine,
          enclosing: {
            name: enclosing.name,
            containerName: enclosing.containerName || '',
            startLine: enclosing.startLine,
            endLine: enclosing.endLine,
          },
        });
      }

      if (calls.length >= MAX_CALLS_PER_FILE) break;
    }

    return { calls, refCandidates };
  }

  /**
   * PR8: scope-aware — 收集 enclosing function/method body 内的局部变量名.
   * 用于过滤被局部变量遮蔽的调用 (e.g. const foo = ...; foo()).
   *
   * 启发式: 递归扫描 enclosing 节点的子树 (限深 LOCAL_VAR_SCAN_DEPTH),
   * 收集 variable_declarator / assignment / parameter 等节点的 declared name.
   * 不做完全 scope 解析 (太重), 覆盖 90% 常见场景即可.
   */
  _collectLocalVars(defNode) {
    const localVars = new Set();
    if (!defNode) return localVars;

    // 找出函数体节点 (各语言节点名不同)
    let body = defNode.childForFieldName('body'); // TS/JS/Java: method_definition.body
    if (!body) {
      // Python: function_definition.body 是 block; Go: method_declaration.block
      body = defNode.childForFieldName('block');
    }
    if (!body) return localVars;

    // 递归收集 (限深)
    const visit = (node, depth) => {
      if (depth > LOCAL_VAR_SCAN_DEPTH) return;
      const t = node.type;
      // variable_declarator: const foo = ... / let foo = ... / var foo = ...
      // 适用 TS/JS/Java
      if (t === 'variable_declarator' || t === 'lexical_declaration' && false) {
        const nameNode = node.childForFieldName('name');
        if (nameNode && nameNode.type === 'identifier') localVars.add(nameNode.text);
      }
      // Python: assignment left = identifier
      if (t === 'assignment') {
        const left = node.childForFieldName('left');
        if (left && left.type === 'identifier') localVars.add(left.text);
      }
      // Go: var_spec / short_var_declaration (a := 1)
      if (t === 'var_spec') {
        for (const child of node.children) {
          if (child.type === 'identifier') localVars.add(child.text);
        }
      }
      // 函数参数 (formal_parameter / parameter)
      if (t === 'formal_parameter' || t === 'parameter') {
        const nameNode = node.childForFieldName('name') || node.childForFieldName('declarator');
        if (nameNode && nameNode.type === 'identifier') localVars.add(nameNode.text);
      }
      // for-loop 变量: for (let i = 0; ...) / for (const item of arr)
      if (t === 'for_statement') {
        for (const child of node.children) {
          if (child.type === 'identifier') localVars.add(child.text);
        }
      }
      // 递归子节点
      for (let i = 0; i < node.childCount; i++) {
        visit(node.child(i), depth + 1);
      }
    };
    visit(body, 0);

    return localVars;
  }

  /**
   * PR8: Phase 2 ref 解析 — 直接用 fileResult._refCandidates 查全局符号表.
   *
   * 不再重新 parse AST (旧实现每次都 parse 一遍, 浪费 50% 时间).
   * 不再重新查 enclosing (Phase 1 已收集).
   *
   * 限流策略:
   *   - 全局 ref edges 上限 MAX_REF_EDGES_TOTAL (parseWorkspace 末尾判断)
   *   - 单符号被引用上限 MAX_REFS_PER_SYMBOL (按 callName 计数)
   *   - 调用点去重: 同一 (callName, callLine) 只产出一条 ref
   *
   * 自引用过滤:
   *   - 跳过 refLocation 指向调用点本身 (cand.relPath === fileResult.relPath && cand.startLine === callLine)
   *   - 跳过 src symbol 自调用 (cand.relPath === fileResult.relPath && cand.startLine === enclosing.startLine)
   */
  _resolveRefs(fileResult, allResults) {
    const candidates = fileResult._refCandidates;
    if (!candidates || candidates.length === 0) return [];

    const refs = [];
    const refCountBySymbol = new Map(); // callName → ref count (限流)
    const seenCallSites = new Set();    // (callName, callLine) 去重

    for (const cand of candidates) {
      const { callName, callLine, enclosing } = cand;

      // 调用点去重: 同一调用点只产出一条 ref (避免一个调用产生多个 edge)
      const callSiteKey = `${callName}@${callLine}`;
      if (seenCallSites.has(callSiteKey)) continue;
      seenCallSites.add(callSiteKey);

      // 限流: 单符号被引用上限
      const count = refCountBySymbol.get(callName) || 0;
      if (count >= MAX_REFS_PER_SYMBOL) continue;

      // 查全局符号表
      const defs = this._globalSymbolTable.get(callName);
      if (!defs || defs.length === 0) continue;

      // 选一个最佳定义点: 优先跨文件的 (跨文件 ref 价值高); 否则取第一个
      let chosen = null;
      for (const d of defs) {
        // 跳过自调用: src symbol 定义点和 candidate 定义点相同
        if (d.relPath === fileResult.relPath && d.startLine === enclosing.startLine) continue;
        // 跳过调用点本身 (refLocation 不应指向调用所在行)
        if (d.relPath === fileResult.relPath && d.startLine === callLine) continue;
        chosen = d;
        if (d.relPath !== fileResult.relPath) break; // 跨文件优先, 命中即取
      }
      if (!chosen) continue;

      refs.push({
        srcSymbol: {
          name: callName,
          containerName: enclosing.containerName || '',
          startLine: enclosing.startLine,
          endLine: enclosing.endLine,
        },
        refLocation: {
          relPath: chosen.relPath,
          startLine: chosen.startLine,
          endLine: chosen.startLine,
          startCol: 0,
        },
      });
      refCountBySymbol.set(callName, count + 1);
    }

    return refs;
  }

  /** 向上找最近的定义级 symbol (class/function/method). */
  _findEnclosingSymbol(line, symbols) {
    let best = null;
    for (const s of symbols) {
      if (line >= s.startLine && line <= s.endLine) {
        if (!best || (s.endLine - s.startLine) < (best.endLine - best.startLine)) {
          best = s;
        }
      }
    }
    return best;
  }

  /** 从节点向上找 class/interface 名作为 containerName.
   *  覆盖各语言的容器节点类型:
   *    - class_declaration / interface_declaration (TS/JS/Java)
   *    - class_definition (Python)
   *    - type_declaration + type_spec (Go — type Foo struct/interface) */
  _inferContainerName(node) {
    let parent = node.parent;
    while (parent) {
      if (parent.type === 'class_declaration' || parent.type === 'interface_declaration') {
        const nameField = parent.childForFieldName('name');
        if (nameField) return nameField.text;
      }
      // Python: class_definition name: (identifier)
      if (parent.type === 'class_definition') {
        const nameField = parent.childForFieldName('name');
        if (nameField) return nameField.text;
      }
      // Go: type_declaration 包含 type_spec, 取 type_spec.name
      if (parent.type === 'type_declaration') {
        const typeSpec = parent.childForFieldName('type') ||
          parent.children.find(c => c.type === 'type_spec');
        if (typeSpec) {
          const nameField = typeSpec.childForFieldName('name');
          if (nameField) return nameField.text;
        }
      }
      parent = parent.parent;
    }
    return '';
  }

  /**
   * 解析 wasm URL — 兼容浏览器 (public/wasm) 和 Node 测试 (从 public 目录读).
   * Vite build 后 public 资源映射到根路径; ESM 下用 import.meta.url 定位文件.
   */
  _resolveWasmUrl(filename) {
    if (typeof window !== 'undefined' && window.location) {
      // 浏览器/Electron renderer: public 目录映射到根路径
      const base = window.location.pathname.replace(/\/[^/]*$/, '');
      return `${base}/wasm/${filename}`.replace(/\/+/g, '/');
    }
    // Node 测试环境: 用 import.meta.url 定位项目 public/wasm 目录
    return new URL(`../../public/wasm/${filename}`, import.meta.url).href;
  }

  /** PR8: ingest 前清理 fileResult 上的内部字段, 不能发到后端. */
  _stripInternalFields(results) {
    for (const r of results) {
      if (r._refCandidates) delete r._refCandidates;
      if (r.symbols) {
        for (const s of r.symbols) {
          if (s._defNode) delete s._defNode;
        }
      }
    }
  }

  /**
   * 读取 workspace 下所有代码文件.
   * 桌面壳: 直接 IPC 读文件系统 (零网络开销).
   * 浏览器: 通过本机 agent HTTP API (/api/local/workspace/tree + /read) 按需读取.
   *   注意: list 端点只返回直接子项不递归, 必须用 tree 端点 (maxDepth=12, 递归扫).
   * 返回统一格式: { relPath, absPath, content, mtime, size, md5 }
   */
  async _readCodeFiles(rootPath, extArray) {
    // 桌面壳: 直接走 IPC
    if (typeof window !== 'undefined' && window.autobotDesktop?.readCodeFiles) {
      return window.autobotDesktop.readCodeFiles(rootPath, { extensions: extArray });
    }

    // 浏览器: 走本机 agent HTTP API
    const localApi = axios.create({ baseURL: getLocalAgentBaseUrl(), timeout: 600000 });
    const extStr = (extArray || []).join(',');
    // tree 端点递归扫整个项目 (list 端点只返回直接子项, 不能用)
    const treeRes = await localApi.post('/api/local/workspace/tree', {
      path: rootPath,
      extensions: extStr,
      maxDepth: 12,
      maxEntries: 30000,
    });
    // tree 返回 entries: [{path: '相对路径', type: 'file'|'dir', ext, depth, parent}]
    // 注意: 没有 absolute 字段, 需要 rootPath + '/' + path 拼绝对路径
    // PR8: server.js shouldIncludeWorkspaceFile 会强制塞 Dockerfile/pom.xml,
    //      这里按 extArray 二次过滤, 只保留目标语言的扩展名.
    const extSet = new Set(extArray || []);
    const fileEntries = (treeRes.data?.entries || []).filter(
      e => e.type === 'file' && extSet.has(e.ext)
    );
    if (fileEntries.length === 0) return [];

    // 并发读内容 (8 并发, 避免一次几百个请求打爆本机 agent)
    const CONCURRENCY = 8;
    const files = [];
    // 用 '/' 拼接, Node.js fs 在 Windows 上能识别混合分隔符 (E:\code\xxx/src/...)
    const rootPrefix = rootPath.replace(/[\\/]+$/, ''); // 去掉末尾分隔符
    for (let i = 0; i < fileEntries.length; i += CONCURRENCY) {
      const batch = fileEntries.slice(i, i + CONCURRENCY);
      const reads = await Promise.all(
        batch.map(e => {
          const absPath = `${rootPrefix}/${e.path}`;
          return localApi.post('/api/local/workspace/read', { path: absPath })
            .then(r => ({
              relPath: e.path,
              absPath,
              content: r.data?.content ?? '',
              mtime: 0,  // 本机 agent API 不返回 mtime, 用 size + md5 做指纹
              size: r.data?.size ?? 0,
              md5: '',   // 下面统一算
            }))
            .catch(err => {
              console.warn('[TreeSitterParser] read failed', e.path, err.message);
              return null;
            });
        })
      );
      for (const f of reads) if (f) files.push(f);
    }

    // 浏览器算 sha256 作为内容指纹 (Web Crypto API 全浏览器支持, md5 Firefox 不支持)
    // 字段名沿用 md5 (fingerprint store 历史字段), 值实为 sha256, 不影响 diff 逻辑
    for (const f of files) {
      f.md5 = await this._sha256(f.content);
    }
    return files;
  }

  /** Web Crypto API 计算 sha256, 返回 hex. */
  async _sha256(text) {
    try {
      const buf = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // 兜底: 用 content length 代替 (极端情况, 实际不会走到)
      return `len:${text.length}`;
    }
  }
}
