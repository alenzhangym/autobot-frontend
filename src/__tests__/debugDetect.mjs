/**
 * 调试 detectProjectLanguages 逻辑.
 */
import http from 'node:http';
import * as TreeSitter from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = 'E:\\code\\litemall-master';
const BASE = 'http://localhost:3000';

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${BASE}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 60000,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// 复制 LANGUAGE_CONFIG
const LANGUAGE_CONFIG = {
  typescript: { extensions: ['.ts'] },
  tsx: { extensions: ['.tsx'] },
  javascript: { extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
  java: { extensions: ['.java'] },
  python: { extensions: ['.py'] },
  go: { extensions: ['.go'] },
};

function _countAndFilter(files, extToLang, minFiles, useBasename = false) {
  const counts = {};
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
  console.log('  counts:', JSON.stringify(counts));
  return Object.entries(counts)
    .filter(([, n]) => n >= minFiles)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

console.log('=== 模拟 detectProjectLanguages ===');
const extToLang = {};
for (const [langId, cfg] of Object.entries(LANGUAGE_CONFIG)) {
  for (const ext of cfg.extensions) extToLang[ext] = langId;
}
console.log('extToLang:', JSON.stringify(extToLang));

const res = await post('/api/local/workspace/tree', { path: ROOT, maxDepth: 12, maxEntries: 30000 });
const entries = (res?.entries || []).filter(e => e.type === 'file');
console.log(`tree 返回 ${entries.length} 个文件`);

const langs = _countAndFilter(entries.map(e => ({ relPath: e.path })), extToLang, 5, true);
console.log('检测结果:', JSON.stringify(langs));
