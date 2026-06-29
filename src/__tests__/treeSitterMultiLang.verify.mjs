/**
 * PR6 验证脚本 — 验证 javascript/python/go/java 4 个语言的 query + wasm.
 *
 * 不依赖测试框架, 直接 node 执行. 退出码 0 = 全部通过.
 *
 * 运行: node src/__tests__/treeSitterMultiLang.verify.mjs
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

console.log('PR6: 多语言 TreeSitterParser 验证');
console.log('================================');

await Parser.init({ locateFile: (fn) => join(ROOT, 'node_modules', 'web-tree-sitter', fn) });

// ── 各语言测试样本 ─────────────────────────────────────────
const SAMPLES = {
  javascript: `
class UserService {
  constructor() { this.users = []; }
  addUser(name) {
    this.users.push(name);
    this.logChange(name);
  }
  logChange(name) { console.log(name); }
}
function main() {
  const svc = new UserService();
  svc.addUser('bob');
}
`,
  python: `
class UserService:
    def __init__(self):
        self.users = []

    def add_user(self, name):
        self.users.append(name)
        self.log_change(name)

    def log_change(self, name):
        print(name)

def main():
    svc = UserService()
    svc.add_user('bob')
`,
  go: `
package main

import "fmt"

type UserService struct {
	users []string
}

func (s *UserService) AddUser(name string) {
	s.users = append(s.users, name)
	s.logChange(name)
}

func (s *UserService) logChange(name string) {
	fmt.Println(name)
}

func main() {
	svc := &UserService{}
	svc.AddUser("bob")
}
`,
  java: `
public class UserService {
    private String[] users;

    public UserService() {
        this.users = new String[0];
    }

    public void addUser(String name) {
        this.users = append(this.users, name);
        this.logChange(name);
    }

    private void logChange(String name) {
        System.out.println(name);
    }

    public static void main(String[] args) {
        UserService svc = new UserService();
        svc.addUser("bob");
    }
}
`,
};

// 各语言期望出现的符号/调用 (name 子串匹配, 跨语言统一)
const EXPECTATIONS = {
  javascript: {
    symbols: ['UserService', 'main', 'addUser', 'constructor'],
    calls: ['push', 'logChange', 'UserService', 'addUser', 'log'],
  },
  python: {
    symbols: ['UserService', 'main', 'add_user', 'log_change', '__init__'],
    calls: ['append', 'log_change', 'UserService', 'add_user', 'print'],
  },
  go: {
    symbols: ['UserService', 'main', 'AddUser', 'logChange'],
    calls: ['append', 'logChange', 'AddUser', 'Println'],
  },
  java: {
    symbols: ['UserService', 'main', 'addUser', 'logChange'],
    calls: ['append', 'logChange', 'addUser', 'println', 'UserService'],
  },
};

const LANG_CONFIG = {
  javascript: { wasm: 'tree-sitter-javascript.wasm', query: 'javascript.scm' },
  python:     { wasm: 'tree-sitter-python.wasm',     query: 'python.scm' },
  go:         { wasm: 'tree-sitter-go.wasm',         query: 'go.scm' },
  java:       { wasm: 'tree-sitter-java.wasm',       query: 'java.scm' },
};

for (const [lang, cfg] of Object.entries(LANG_CONFIG)) {
  console.log(`\n── ${lang} ──────────────────────────────────────`);

  // 加载 grammar
  let language;
  try {
    language = await Language.load(join(ROOT, 'public', 'wasm', cfg.wasm));
    assert(!!language, `${lang}: Language.load 成功`);
  } catch (e) {
    console.error(`  ${lang} grammar 加载失败:`, e.message);
    failed++;
    continue;
  }

  // 编译 query
  let query;
  try {
    const querySrc = readFileSync(join(ROOT, 'src', 'lsp', 'queries', cfg.query), 'utf8');
    query = new Query(language, querySrc);
    assert(!!query, `${lang}: Query 编译成功`);
  } catch (e) {
    console.error(`  ${lang} Query 编译失败:`, e.message);
    failed++;
    continue;
  }

  // 解析样本
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(SAMPLES[lang]);

  // 提取 symbols
  const matches = query.matches(tree.rootNode);
  const symbols = [];
  const calls = [];
  for (const { captures } of matches) {
    let defNode = null, nameNode = null, callNameNode = null;
    for (const c of captures) {
      if (c.name.startsWith('definition.')) defNode = c.node;
      else if (c.name === 'name') nameNode = c.node;
      else if (c.name === 'call_name') callNameNode = c.node;
    }
    if (defNode && nameNode) {
      symbols.push(nameNode.text);
    }
    if (callNameNode) {
      // 验证调用节点父链 (与 TreeSitterParser 逻辑保持一致)
      let callExpr = callNameNode.parent;
      if (callExpr?.type === 'member_expression' || callExpr?.type === 'attribute' ||
          callExpr?.type === 'selector_expression') {
        callExpr = callExpr.parent;
      }
      if (callExpr) {
        calls.push(callNameNode.text);
      }
    }
  }

  console.log(`  symbols: ${symbols.join(', ')}`);
  console.log(`  calls:   ${calls.join(', ')}`);

  const expect = EXPECTATIONS[lang];
  for (const sym of expect.symbols) {
    assert(symbols.some(s => s === sym), `${lang}: 提取到符号 ${sym}`);
  }
  for (const callName of expect.calls) {
    assert(calls.some(c => c === callName), `${lang}: 提取到调用 ${callName}`);
  }

  tree.delete?.();
  query.delete?.();
  parser.delete?.();
  language.delete?.();
}

// ── 结果汇总 ──────────────────────────────────────────────
console.log('\n================================');
console.log(`结果: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
