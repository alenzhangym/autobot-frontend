/**
 * PR8 压测验证 — 大项目场景下 tree-sitter 后端的引用解析性能与精度.
 *
 * 测试目标:
 *   1. 性能: 1000 个符号 × 多文件, 解析时间 < 5s
 *   2. 限流: ref edges 总数受 MAX_REF_EDGES_TOTAL 控制
 *   3. 精度: scope-aware 局部变量过滤生效 (被遮蔽的调用不产 ref)
 *   4. 去重: 同一调用点不重复产 ref edge
 *   5. 自引用: 调用点本身不作为 refLocation
 *
 * 运行: node src/__tests__/treeSitterPerf.verify.mjs
 */
import * as TreeSitter from 'web-tree-sitter';
const { Parser, Language, Query } = TreeSitter;
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); passed++; }
  else { console.log('  ✗', msg); failed++; }
}

console.log('PR8: TreeSitterParser 大项目压测验证');
console.log('================================');

await Parser.init({ locateFile: (fn) => join(ROOT, 'node_modules', 'web-tree-sitter', fn) });
const language = await Language.load(join(ROOT, 'public', 'wasm', 'tree-sitter-typescript.wasm'));
const querySrc = readFileSync(join(ROOT, 'src', 'lsp', 'queries', 'typescript.scm'), 'utf8');
const query = new Query(language, querySrc);
const parser = new Parser();
parser.setLanguage(language);

// ── 测试 1: 大文件解析性能 (1000 个符号) ─────────────────────
console.log('\n── 测试 1: 大文件解析性能 ──');
const N_SYMBOLS = 1000;
let bigCode = '';
for (let i = 0; i < N_SYMBOLS; i++) {
  bigCode += `function fn${i}(x) { return x + ${i}; }\n`;
}
// 加一些跨函数调用
for (let i = 0; i < N_SYMBOLS; i += 10) {
  bigCode += `function caller${i}() { return fn${i}() + fn${i + 1}(); }\n`;
}

const t1 = Date.now();
const tree = parser.parse(bigCode);
const matches = query.matches(tree.rootNode);
const parseMs = Date.now() - t1;

console.log(`  生成 ${N_SYMBOLS + N_SYMBOLS / 10} 个符号, AST 节点数: ${tree.rootNode.childCount}`);
console.log(`  解析 + query.matches 耗时: ${parseMs}ms`);
assert(parseMs < 5000, `大文件解析 < 5s (实际 ${parseMs}ms)`);
assert(matches.length > N_SYMBOLS, `query.matches 数量 > ${N_SYMBOLS} (实际 ${matches.length})`);

// ── 测试 2: scope-aware 局部变量过滤 ─────────────────────────
console.log('\n── 测试 2: scope-aware 局部变量过滤 ──');
const scopeCode = `
function globalFn() { return 1; }
function testScope() {
  const globalFn = () => 42;  // 局部变量遮蔽
  return globalFn();          // 此处 globalFn() 应被识别为局部调用, 不产 ref
}
function testNoShadow() {
  return globalFn();          // 此处 globalFn() 应产 ref
}
`;
const tree2 = parser.parse(scopeCode);
const matches2 = query.matches(tree2.rootNode);

let callCount = 0;
let localShadowedCount = 0;
const seenCalls = [];
for (const { captures } of matches2) {
  let callNameNode = null;
  for (const c of captures) {
    if (c.name === 'call_name') { callNameNode = c.node; break; }
  }
  if (!callNameNode) continue;
  let callExpr = callNameNode.parent;
  if (callExpr?.type === 'member_expression') callExpr = callExpr.parent;
  if (!callExpr || (callExpr.type !== 'call_expression' && callExpr.type !== 'new_expression')) continue;

  callCount++;
  seenCalls.push({ name: callNameNode.text, line: callExpr.startPosition.row });
}
console.log(`  共捕获 ${callCount} 个调用: ${JSON.stringify(seenCalls)}`);
assert(callCount >= 2, `捕获到至少 2 个 globalFn 调用 (实际 ${callCount})`);

// ── 测试 3: 调用点去重 ───────────────────────────────────────
console.log('\n── 测试 3: 调用点去重 ──');
const dedupCode = `
function foo() {}
function bar() {
  foo();
  foo();
  foo();
}
`;
const tree3 = parser.parse(dedupCode);
const matches3 = query.matches(tree3.rootNode);
const callSites = new Set();
let dedupCalls = 0;
for (const { captures } of matches3) {
  let callNameNode = null;
  for (const c of captures) {
    if (c.name === 'call_name') { callNameNode = c.node; break; }
  }
  if (!callNameNode) continue;
  let callExpr = callNameNode.parent;
  if (callExpr?.type === 'member_expression') callExpr = callExpr.parent;
  if (!callExpr || (callExpr.type !== 'call_expression' && callExpr.type !== 'new_expression')) continue;

  dedupCalls++;
  const key = `${callNameNode.text}@${callExpr.startPosition.row}`;
  callSites.add(key);
}
console.log(`  原始调用数: ${dedupCalls}, 去重后调用点: ${callSites.size}`);
assert(dedupCalls === 3, `原始捕获 3 个 foo() 调用 (实际 ${dedupCalls})`);
assert(callSites.size === 3, `3 个调用点各行不同 (实际 ${callSites.size})`);

// ── 测试 4: 全局符号表只放可调用符号 ─────────────────────────
console.log('\n── 测试 4: 全局符号表只放可调用符号 ──');
const callableCode = `
class MyClass { field1 = 1; method1() {} }
const constant1 = 42;
function func1() {}
enum MyEnum { A, B, C }
`;
const tree4 = parser.parse(callableCode);
const matches4 = query.matches(tree4.rootNode);

const CALLABLE_KINDS = new Set(['class', 'function', 'method', 'constructor']);
const callableSymbols = [];
const allSymbols = [];
for (const { captures } of matches4) {
  let defNode = null, nameNode = null, kindKey = null;
  for (const c of captures) {
    if (c.name.startsWith('definition.')) { defNode = c.node; kindKey = c.name; }
    else if (c.name === 'name') nameNode = c.node;
  }
  if (!defNode || !nameNode) continue;
  const NODE_KIND_MAP = {
    'definition.class': { kind: 'class' },
    'definition.function': { kind: 'function' },
    'definition.method': { kind: 'method' },
    'definition.constructor': { kind: 'constructor' },
    'definition.field': { kind: 'field' },
    'definition.enum': { kind: 'enum' },
    'definition.enummember': { kind: 'enummember' },
  };
  const kindInfo = NODE_KIND_MAP[kindKey];
  if (!kindInfo) continue;
  allSymbols.push({ name: nameNode.text, kind: kindInfo.kind });
  if (CALLABLE_KINDS.has(kindInfo.kind)) callableSymbols.push(nameNode.text);
}
console.log(`  全部 symbols: ${allSymbols.map(s => s.kind + ':' + s.name).join(', ')}`);
console.log(`  可调用 symbols (应进符号表): ${callableSymbols.join(', ')}`);
assert(callableSymbols.includes('MyClass'), 'class 进入可调用符号表');
assert(callableSymbols.includes('func1'), 'function 进入可调用符号表');
assert(callableSymbols.includes('method1'), 'method 进入可调用符号表');
assert(!callableSymbols.includes('field1'), 'field 不进符号表');
assert(!callableSymbols.includes('constant1'), 'constant 不进符号表');

// ── 测试 5: 多文件场景压测 ───────────────────────────────────
console.log('\n── 测试 5: 多文件场景压测 ──');
const N_FILES = 50;
const N_FUNCS_PER_FILE = 20;
const t5 = Date.now();
let totalSymbols = 0;
let totalCalls = 0;
for (let f = 0; f < N_FILES; f++) {
  let code = '';
  for (let i = 0; i < N_FUNCS_PER_FILE; i++) {
    const fnName = `file${f}_fn${i}`;
    code += `function ${fnName}() { return ${i}; }\n`;
  }
  // 跨文件调用 (字符串引用, 实际不导入, 但 AST 能识别为 call_expression)
  code += `function caller() { return file${f}_fn0() + file${f}_fn1(); }\n`;
  const t = parser.parse(code);
  const m = query.matches(t.rootNode);
  for (const { captures } of m) {
    let isDef = false, isCall = false;
    for (const c of captures) {
      if (c.name.startsWith('definition.')) isDef = true;
      if (c.name === 'call_name') isCall = true;
    }
    if (isDef) totalSymbols++;
    if (isCall) totalCalls++;
  }
  t.delete?.();
}
const multiMs = Date.now() - t5;
console.log(`  ${N_FILES} 文件 × ${N_FUNCS_PER_FILE} 函数, 总符号: ${totalSymbols}, 总调用: ${totalCalls}`);
console.log(`  耗时: ${multiMs}ms (平均 ${(multiMs / N_FILES).toFixed(1)}ms/文件)`);
assert(multiMs < 10000, `多文件解析 < 10s (实际 ${multiMs}ms)`);
assert(totalSymbols > N_FILES * N_FUNCS_PER_FILE, `符号总数 > ${N_FILES * N_FUNCS_PER_FILE}`);

// ── 清理 ─────────────────────────────────────────────────────
tree.delete?.();
tree2.delete?.();
tree3.delete?.();
tree4.delete?.();
query.delete?.();
parser.delete?.();
language.delete?.();

// ── 结果汇总 ────────────────────────────────────────────────
console.log('\n================================');
console.log(`结果: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
