/**
 * PR5 验证脚本 — 不依赖测试框架, 直接 node 执行.
 *
 * 验证内容:
 *   1. web-tree-sitter wasm 加载成功
 *   2. typescript grammar wasm 加载成功
 *   3. typescript.scm query 编译成功
 *   4. 对典型 TS 代码片段提取出预期的 symbols (class/function/method)
 *   5. 对典型 TS 代码片段提取出预期的 calls
 *
 * 运行方式:
 *   node --experimental-vm-modules src/__tests__/treeSitterParser.verify.mjs
 *
 * 退出码 0 = 全部通过; 非 0 = 失败.
 */
import * as TreeSitter from 'web-tree-sitter';
const { Parser, Language, Query } = TreeSitter;
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// 典型 TS 代码片段 — 覆盖 class/method/function/field/call
const SAMPLE_TS = `
class UserService {
  private users: string[] = [];

  constructor(initial: string[]) {
    this.users = initial;
  }

  addUser(name: string): void {
    this.users.push(name);
    this.logChange(name);
  }

  private logChange(name: string): void {
    console.log('added', name);
  }
}

function main() {
  const svc = new UserService(['alice']);
  svc.addUser('bob');
}
`;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); passed++; }
  else { console.log('  ✗', msg); failed++; }
}

console.log('PR5: TreeSitterParser 验证');
console.log('=========================');

// ── 1. wasm 加载 ──────────────────────────────────────────
try {
  await Parser.init({
    locateFile: (fn) => join(ROOT, 'node_modules', 'web-tree-sitter', fn),
  });
  assert(true, 'Parser.init 加载 tree-sitter.wasm');
} catch (e) {
  console.error('Parser.init 失败:', e);
  process.exit(1);
}

// ── 2. typescript grammar 加载 ────────────────────────────
let language, parser, query;
try {
  language = await Language.load(join(ROOT, 'public', 'wasm', 'tree-sitter-typescript.wasm'));
  assert(!!language, 'Language.load 加载 tree-sitter-typescript.wasm');

  parser = new Parser();
  parser.setLanguage(language);
  assert(true, 'Parser.setLanguage(typescript)');
} catch (e) {
  console.error('TypeScript grammar 加载失败:', e);
  process.exit(1);
}

// ── 3. query 编译 ─────────────────────────────────────────
const querySrc = readFileSync(join(ROOT, 'src', 'lsp', 'queries', 'typescript.scm'), 'utf8');
try {
  query = new Query(language, querySrc);
  assert(!!query, 'Query 编译 typescript.scm');
} catch (e) {
  console.error('Query 编译失败:', e.message);
  process.exit(1);
}

// ── 4. symbols 提取 ───────────────────────────────────────
console.log('\nSymbols 提取:');
const tree = parser.parse(SAMPLE_TS);
const matches = query.matches(tree.rootNode);

const symbols = [];
for (const { captures } of matches) {
  let defNode = null, nameNode = null, kindKey = null;
  for (const c of captures) {
    if (c.name.startsWith('definition.')) { defNode = c.node; kindKey = c.name; }
    else if (c.name === 'name') nameNode = c.node;
  }
  if (defNode && nameNode && kindKey) {
    symbols.push({
      kind: kindKey.replace('definition.', ''),
      name: nameNode.text,
      startLine: defNode.startPosition.row,
      endLine: defNode.endPosition.row,
    });
  }
}

console.log('  发现 symbols:', symbols.map(s => `${s.kind}:${s.name}@${s.startLine}`).join(', '));
assert(symbols.some(s => s.kind === 'class' && s.name === 'UserService'), '提取到 class UserService');
assert(symbols.some(s => s.kind === 'function' && s.name === 'main'), '提取到 function main');
assert(symbols.some(s => s.kind === 'method' && s.name === 'addUser'), '提取到 method addUser');
assert(symbols.some(s => s.kind === 'method' && s.name === 'constructor'), '提取到 constructor');

// ── 5. calls 提取 ─────────────────────────────────────────
console.log('\nCalls 提取:');
const calls = [];
for (const { captures } of matches) {
  let callNameNode = null;
  for (const c of captures) {
    if (c.name === 'call_name') { callNameNode = c.node; break; }
  }
  if (!callNameNode) continue;
  let callExpr = callNameNode.parent;
  if (callExpr?.type === 'member_expression') callExpr = callExpr.parent;
  if (!callExpr) continue;
  if (callExpr.type !== 'call_expression' && callExpr.type !== 'new_expression') continue;
  calls.push({
    name: callNameNode.text,
    line: callExpr.startPosition.row,
  });
}

console.log('  发现 calls:', calls.map(c => `${c.name}@${c.line}`).join(', '));
assert(calls.some(c => c.name === 'push'), '提取到 push 调用');
assert(calls.some(c => c.name === 'logChange'), '提取到 logChange 调用');
assert(calls.some(c => c.name === 'UserService'), '提取到 new UserService() 调用');
assert(calls.some(c => c.name === 'addUser'), '提取到 svc.addUser() 调用');
assert(calls.some(c => c.name === 'log'), '提取到 console.log 调用 (property_identifier=log)');

// 清理
tree.delete?.();
query.delete?.();
parser.delete?.();
language.delete?.();

// ── 结果汇总 ──────────────────────────────────────────────
console.log('\n=========================');
console.log(`结果: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
