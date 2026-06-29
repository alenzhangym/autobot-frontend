import express from 'express';
import cors from 'cors';
import { exec, execSync, execFile, execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || process.env.VITE_PORT || 3000;

const AUTOBOT_MONITOR_ENABLED = process.env.AUTOBOT_MONITOR !== '0' && process.env.AUTOBOT_MONITOR !== 'false';
const AUTOBOT_REPO_ROOT = process.env.AUTOBOT_REPO_ROOT || path.resolve(__dirname, '..');
const AUTOBOT_LOGS_DIR = process.env.AUTOBOT_LOGS_DIR || path.join(AUTOBOT_REPO_ROOT, 'java-backend', 'logs');
const AUTOBOT_MONITOR_STORE = process.env.AUTOBOT_MONITOR_STORE || path.join(__dirname, 'data', 'monitor-issues.json');
const AUTOBOT_MONITOR_CONFIG = process.env.AUTOBOT_MONITOR_CONFIG || path.join(__dirname, 'data', 'monitor-config.json');
let monitorService = null;
let monitorAutoRestart = false;
let monitorConfig = null; // { repoRoot, logsDir, updatedAt }

// Effective config resolution (highest priority wins):
//   1. Environment variables (typically loaded from `.env` by dotenv)
//   2. `monitor-config.json` — treated as a one-time default / fallback
//      for first-time setup. It is NOT auto-rewritten, so paths
//      committed by another developer will not pollute this machine.
//   3. Hardcoded default (<frontend>/..).
//
// `.env` is the recommended per-device source of truth; see `.env.example`.
function loadMonitorConfig() {
  const fromEnvRepo = !!process.env.AUTOBOT_REPO_ROOT;
  const fromEnvLogs = !!process.env.AUTOBOT_LOGS_DIR;
  let fileCfg = null;
  try {
    if (fs.existsSync(AUTOBOT_MONITOR_CONFIG)) {
      fileCfg = JSON.parse(fs.readFileSync(AUTOBOT_MONITOR_CONFIG, 'utf-8'));
    }
  } catch (e) {
    console.error(`[Monitor] failed to load config: ${e.message}`);
  }
  const enabledFromFile = fileCfg && typeof fileCfg.enabled === 'boolean' ? fileCfg.enabled : null;
  monitorConfig = {
    repoRoot: AUTOBOT_REPO_ROOT,
    logsDir: AUTOBOT_LOGS_DIR,
    enabled: enabledFromFile !== null ? enabledFromFile : AUTOBOT_MONITOR_ENABLED,
  };
  const sources = [
    fromEnvRepo ? 'repoRoot=env' : (fileCfg && fileCfg.repoRoot ? 'repoRoot=file' : 'repoRoot=default'),
    fromEnvLogs ? 'logsDir=env' : (fileCfg && fileCfg.logsDir ? 'logsDir=file' : 'logsDir=default'),
  ];
  console.log(`[Monitor] config: ${monitorConfig.repoRoot} logs=${monitorConfig.logsDir} (${sources.join(', ')})`);
}

function saveMonitorConfig(cfg) {
  const dir = path.dirname(AUTOBOT_MONITOR_CONFIG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = AUTOBOT_MONITOR_CONFIG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  fs.renameSync(tmp, AUTOBOT_MONITOR_CONFIG);
  monitorConfig = cfg;
}

// Increase JSON body limit and add error handling middleware for JSON parsing
app.use(express.json({ limit: '10mb' }));
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('Bad JSON in request:', err.message, req.body);
        return res.status(400).json({ status: 'error', message: 'Invalid JSON body' });
    }
    next();
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// Add error handling middleware for route matching
app.use((req, res, next) => {
    console.log(`[Local Agent] Received request: ${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url.startsWith('/api/local/')) {
        // Skip serving static files for local API routes
    }
    next();
});

// 1. 本地状态检查接口
app.get('/api/local/status', (req, res) => {
    res.json({ status: 'success', message: 'Local agent is running', version: '1.0.0' });
});

// 2. 本地脚本命令执行接口
app.post('/api/local/execute', (req, res) => {
    const { command, cwd } = req.body;
    if (!command) {
        return res.status(400).json({ status: 'error', message: 'Command is required' });
    }
    
    console.log(`[Local Agent] Executing command: ${command}`);
    exec(command, { cwd: cwd || process.cwd() }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Local Agent] Command error: ${error.message}`);
            return res.status(500).json({ status: 'error', error: error.message, stderr, stdout });
        }
        res.json({ status: 'success', stdout, stderr });
    });
});

// 2. 本地数据库执行接口
app.post('/api/local/db', async (req, res) => {
    const { type, config, query, operation, table } = req.body;
    if (!type || !config) {
        return res.status(400).json({ status: 'error', message: 'Missing type or config' });
    }

    console.log(`[Local Agent] Executing DB [${type}] operation=${operation || 'run_query'}`);
    console.log(`[Local Agent] DB raw: type=${type} op=${operation} query=${typeof query === 'string' ? query.substring(0, 120) : query}`);
    try {
        if (type === 'mysql') {
            const mysql = await import('mysql2/promise');
            let connection;
            try {
                // Sanitize config: mysql2 crashes on null/undefined values
                const sanitized = {
                    host: config.host || '127.0.0.1',
                    port: config.port || 3306,
                    user: config.user || '',
                    password: config.password || '',
                    database: config.database || '',
                    multipleStatements: true
                };
                connection = await mysql.createConnection(sanitized);
                let resultData;
                if (operation === 'list_tables') {
                    const [rows] = await connection.execute('SHOW TABLES', []);
                    resultData = rows;
                } else if (operation === 'describe_table') {
                    const [rows] = await connection.execute(`SHOW FULL COLUMNS FROM \`${table}\``, []);
                    resultData = rows;
                } else {
                    const [rows] = await connection.query(query, []);
                    resultData = rows;
                }
                return res.json({ status: 'success', data: resultData });
            } catch (error) {
                console.error(`[Local Agent] MySQL error:`, error.message, error.stack);
                return res.json({ status: 'error', error: error.message, _stack: error.stack?.split('\n').slice(0, 4).join('\n') });
            } finally {
                if (connection) await connection.end();
            }
        } else if (type === 'postgres') {
            const pg = await import('pg');
            const client = new pg.Client(config);
            try {
                await client.connect();
                let resultData;
                if (operation === 'list_tables') {
                    const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
                    resultData = result.rows;
                } else if (operation === 'describe_table') {
                    const result = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1", [table]);
                    resultData = result.rows;
                } else {
                    const result = await client.query(query, []);
                    resultData = result.rows;
                }
                return res.json({ status: 'success', data: resultData });
            } catch (error) {
                console.error(`[Local Agent] MySQL error:`, error.message, error.stack);
                return res.json({ status: 'error', error: error.message, _stack: error.stack?.split('\n').slice(0, 4).join('\n') });
            } finally {
                await client.end();
            }
        } else if (type === 'sqlserver') {
            const sqlModule = await import('mssql');
            const sql = sqlModule.default || sqlModule;
            const mssqlConfig = {
                user: config.user,
                password: config.password,
                database: config.database,
                server: config.host || config.server,
                port: parseInt(config.port) || 1433,
                options: { encrypt: true, trustServerCertificate: true }
            };
            try {
                await sql.connect(mssqlConfig);
                let resultData;
                if (operation === 'list_tables') {
                    const result = await sql.query("SELECT TABLE_NAME as table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
                    resultData = result.recordset;
                } else if (operation === 'describe_table') {
                    const result = await sql.query(`SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table}'`);
                    resultData = result.recordset;
                } else {
                    const result = await sql.query(query, []);
                    resultData = result.recordset;
                }
                return res.json({ status: 'success', data: resultData });
            } catch (error) {
                console.error(`[Local Agent] MySQL error:`, error.message, error.stack);
                return res.json({ status: 'error', error: error.message, _stack: error.stack?.split('\n').slice(0, 4).join('\n') });
            } finally {
                await sql.close();
            }
        } else {
            return res.status(400).json({ status: 'error', message: `Unsupported DB type: ${type}` });
        }
    } catch (error) {
        console.error(`[Local Agent] DB error: ${error.message}`);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// 3. 本地数据库测试连接接口
app.post('/api/local/db/test', async (req, res) => {
    const { type, config } = req.body;
    if (!type || !config) {
        return res.status(400).json({ status: 'error', message: 'Missing type or config' });
    }

    console.log(`[Local Agent] Testing DB connection [${type}] host=${config.host}:${config.port}`);
    try {
        if (type === 'mysql') {
            const mysql = await import('mysql2/promise');
            let connection;
            try {
                const sanitized = {
                    host: config.host || '127.0.0.1',
                    port: config.port || 3306,
                    user: config.user || '',
                    password: config.password || '',
                    database: config.database || '',
                    connectTimeout: 5000
                };
                connection = await mysql.createConnection(sanitized);
                await connection.ping();
                return res.json({ status: 'success', message: 'Connection successful' });
            } catch (error) {
                console.error(`[Local Agent] MySQL test failed: ${error.message}`);
                return res.json({ status: 'error', message: error.message });
            } finally {
                if (connection) await connection.end().catch(() => {});
            }
        } else if (type === 'postgres') {
            const pg = await import('pg');
            const client = new pg.Client({
                ...config,
                host: config.host || '127.0.0.1',
                port: config.port || 5432,
                connectionTimeoutMillis: 5000
            });
            try {
                await client.connect();
                await client.query('SELECT 1');
                return res.json({ status: 'success', message: 'Connection successful' });
            } catch (error) {
                console.error(`[Local Agent] PG test failed: ${error.message}`);
                return res.json({ status: 'error', message: error.message });
            } finally {
                await client.end().catch(() => {});
            }
        } else if (type === 'sqlserver') {
            const sqlModule = await import('mssql');
            const sql = sqlModule.default || sqlModule;
            const mssqlConfig = {
                user: config.user || '',
                password: config.password || '',
                database: config.database || '',
                server: config.host || '127.0.0.1',
                port: parseInt(config.port) || 1433,
                options: { encrypt: true, trustServerCertificate: true },
                connectTimeout: 5000
            };
            try {
                await sql.connect(mssqlConfig);
                return res.json({ status: 'success', message: 'Connection successful' });
            } catch (error) {
                console.error(`[Local Agent] MSSQL test failed: ${error.message}`);
                return res.json({ status: 'error', message: error.message });
            } finally {
                await sql.close().catch(() => {});
            }
        } else {
            return res.status(400).json({ status: 'error', message: `Unsupported DB type: ${type}` });
        }
    } catch (error) {
        console.error(`[Local Agent] DB Test error: ${error.message}`);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 4. 本地更新接口
app.post('/api/local/update', async (req, res) => {
    // Check if the body was successfully parsed
    if (!req.body || Object.keys(req.body).length === 0) {
        console.error(`[Local Agent] Empty or invalid body received. Headers:`, req.headers);
        return res.status(400).json({ status: 'error', message: 'Missing or invalid request body' });
    }
    
    const { downloadUrl } = req.body;
    if (!downloadUrl) {
        return res.status(400).json({ status: 'error', message: 'Missing downloadUrl' });
    }

    try {
        console.log(`[Local Agent] Downloading update from ${downloadUrl}`);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autobot-update-'));
        const zipPath = path.join(tempDir, 'update.zip');
        const extractDir = path.join(tempDir, 'extract');
        fs.mkdirSync(extractDir);

        // Download zip
        const getModule = downloadUrl.startsWith('https') ? https : http;
        await new Promise((resolve, reject) => {
            getModule.get(downloadUrl, (response) => {
                if (response.statusCode !== 200) {
                    return reject(new Error(`Failed to download, status code: ${response.statusCode}`));
                }
                const file = fs.createWriteStream(zipPath);
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', reject);
        });

        console.log(`[Local Agent] Extracting update to ${extractDir}`);
        if (os.platform() === 'win32') {
            execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`);
        } else {
            execSync(`unzip -o "${zipPath}" -d "${extractDir}"`);
        }

        console.log(`[Local Agent] Replacing dist folder`);
        const distPath = path.join(__dirname, 'dist');
        const backupPath = path.join(__dirname, 'dist_backup_' + Date.now());
        
        if (fs.existsSync(distPath)) {
            try {
                fs.renameSync(distPath, backupPath);
            } catch (error) {
                // Fallback for EXDEV
                fs.cpSync(distPath, backupPath, { recursive: true });
                fs.rmSync(distPath, { recursive: true, force: true });
            }
        }

        // Move extracted contents to dist
        const extractedItems = fs.readdirSync(extractDir);
        let sourceDist = extractDir;
        if (extractedItems.includes('dist')) {
            sourceDist = path.join(extractDir, 'dist');
        } else if (extractedItems.includes('index.html')) {
            sourceDist = extractDir;
        }
        
        try {
            fs.renameSync(sourceDist, distPath);
        } catch (error) {
            fs.cpSync(sourceDist, distPath, { recursive: true });
        }

        // Cleanup
        try {
            if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true, force: true });
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
            console.warn(`[Local Agent] Cleanup warning: ${cleanupError.message}`);
        }

        console.log(`[Local Agent] Update successful`);
        return res.status(200).json({ status: 'success', message: 'Update applied successfully' });

    } catch (error) {
        console.error(`[Local Agent] Update failed: ${error.message}`);
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

const DEFAULT_WORKSPACE_SKIP_DIRS = new Set([
    '.git', 'node_modules', '.worktrees', '.claude', '.deepseek',
    'target', 'dist', 'build', '__pycache__', '.next', '.idea', '.vscode',
    'venv', '.venv', '.npm', '.yarn', '.pnpm-store', 'coverage', 'out'
]);

function createExtSet(extensions) {
    return new Set((extensions || '').split(',').map(s => s.trim()).filter(Boolean));
}

function shouldIncludeWorkspaceFile(fileName, extSet) {
    const ext = path.extname(fileName);
    return extSet.size === 0 || extSet.has(ext) || fileName === 'Dockerfile' || fileName === 'pom.xml';
}

function scanWorkspaceEntries(rootPath, options = {}) {
    const {
        maxDepth = 4,
        maxEntries = 5000,
        extensions = '',
        excludeDirs = []
    } = options;

    const extSet = createExtSet(extensions);
    const skipDirs = new Set([...DEFAULT_WORKSPACE_SKIP_DIRS, ...excludeDirs]);
    const rootResolved = path.resolve(rootPath);
    const entries = [];
    let truncated = false;

    const pushEntry = (entry) => {
        if (entries.length >= maxEntries) {
            truncated = true;
            return false;
        }
        entries.push(entry);
        return true;
    };

    const walk = (currentPath, depth) => {
        if (depth > maxDepth || truncated) return;
        const items = fs.readdirSync(currentPath, { withFileTypes: true });
        items.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        for (const item of items) {
            if (truncated) break;
            if (skipDirs.has(item.name) || item.name.startsWith('.')) continue;
            const fullPath = path.join(currentPath, item.name);
            const relative = path.relative(rootResolved, fullPath).replace(/\\/g, '/');
            if (!relative) continue;

            const parent = path.dirname(relative).replace(/\\/g, '/');
            const normalizedParent = parent === '.' ? '' : parent;
            if (item.isDirectory()) {
                if (!pushEntry({
                    path: relative,
                    type: 'dir',
                    ext: '',
                    depth,
                    parent: normalizedParent
                })) {
                    break;
                }
                walk(fullPath, depth + 1);
            } else if (item.isFile() && shouldIncludeWorkspaceFile(item.name, extSet)) {
                if (!pushEntry({
                    path: relative,
                    type: 'file',
                    ext: path.extname(item.name),
                    depth,
                    parent: normalizedParent
                })) {
                    break;
                }
            }
        }
    };

    walk(rootResolved, 0);
    return { root: rootResolved, entries, truncated };
}

function splitFileLines(content) {
    return content.split(/\r?\n/);
}

function lineWindow(lines, startLine, endLine) {
    const safeStart = Math.max(1, Number.isFinite(startLine) ? startLine : 1);
    const safeEnd = Math.max(safeStart, Number.isFinite(endLine) ? endLine : lines.length);
    return lines.slice(safeStart - 1, safeEnd).join('\n');
}

function detectReadLanguage(filePath) {
    const ext = path.extname(filePath || '').toLowerCase();
    const mapping = {
        '.java': 'java',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.py': 'python',
        '.sql': 'sql',
        '.xml': 'xml',
        '.json': 'json',
        '.yml': 'yaml',
        '.yaml': 'yaml',
        '.md': 'markdown',
        '.properties': 'properties',
        '.sh': 'shell'
    };
    return mapping[ext] || 'text';
}

function normalizeBackendHost(rawHost) {
    const host = (rawHost || process.env.VITE_BACKEND_HOST || process.env.BACKEND_HOST || '127.0.0.1:8000').trim()
    if (!host) return 'http://127.0.0.1:8000'
    if (host.startsWith('http://') || host.startsWith('https://')) {
        return host.replace(/\/$/, '')
    }
    return `http://${host.replace(/\/$/, '')}`
}

function getBackendApiBaseUrl(rawHost) {
    return `${normalizeBackendHost(rawHost)}/api`
}

async function requestJavaAstSummary(filePath, content, backendHost, startLine, endLine) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
        const response = await fetch(`${getBackendApiBaseUrl(backendHost)}/code/ast/java/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: filePath,
                content,
                startLine,
                endLine
            }),
            signal: controller.signal
        })
        if (!response.ok) {
            const detail = await response.text()
            throw new Error(detail || `HTTP ${response.status}`)
        }
        const payload = await response.json()
        if (payload?.astStatus !== 'ok') {
            throw new Error(payload?.error || payload?.astStatus || 'AST parse failed')
        }
        return payload
    } finally {
        clearTimeout(timeout)
    }
}

function mergeAstSummary(baseEnvelope, astSummary) {
    if (!astSummary || astSummary.parserMode !== 'ast') return baseEnvelope
    return {
        ...baseEnvelope,
        parserMode: 'ast',
        parserLanguage: astSummary.parserLanguage || 'java',
        importPaths: Array.isArray(astSummary.importPaths) ? astSummary.importPaths : [],
        imports: Array.isArray(astSummary.imports) && astSummary.imports.length ? astSummary.imports : baseEnvelope.imports,
        symbols: Array.isArray(astSummary.symbols) && astSummary.symbols.length ? astSummary.symbols : baseEnvelope.symbols,
        callRefs: Array.isArray(astSummary.callRefs) && astSummary.callRefs.length ? astSummary.callRefs : baseEnvelope.callRefs,
        anchors: Array.isArray(astSummary.anchors) && astSummary.anchors.length ? astSummary.anchors : baseEnvelope.anchors,
        symbolCalls: Array.isArray(astSummary.symbolCalls) && astSummary.symbolCalls.length ? astSummary.symbolCalls : baseEnvelope.symbolCalls
    }
}

function extractReadImports(content, language) {
    const results = new Set();
    const patterns = [];
    if (language === 'java') {
        patterns.push(/import\s+([\w.]+);/g);
    }
    if (language === 'javascript' || language === 'typescript') {
        patterns.push(/import\s+.+?\s+from\s+['"]([^'"]+)['"]/g);
        patterns.push(/require\(\s*['"]([^'"]+)['"]\s*\)/g);
    }
    if (language === 'python') {
        patterns.push(/^\s*from\s+([\w.]+)\s+import\s+/gm);
        patterns.push(/^\s*import\s+([\w.]+)/gm);
    }
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            if (match[1]) results.add(match[1].trim());
            if (results.size >= 40) return Array.from(results);
        }
    }
    return Array.from(results);
}

function extractReadSymbols(content, language) {
    const results = new Set();
    const patterns = {
        java: [
            /\b(class|interface|enum|record)\s+([A-Za-z_]\w*)/g,
            /\b(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\(/g
        ],
        javascript: [
            /\b(function|class)\s+([A-Za-z_]\w*)/g,
            /\bconst\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/g,
            /\bexport\s+(?:default\s+)?function\s+([A-Za-z_]\w*)/g
        ],
        typescript: [
            /\b(function|class|interface|type|enum)\s+([A-Za-z_]\w*)/g,
            /\bconst\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/g,
            /\bexport\s+(?:default\s+)?function\s+([A-Za-z_]\w*)/g
        ],
        python: [
            /^\s*(class|def)\s+([A-Za-z_]\w*)/gm
        ]
    };
    const active = patterns[language] || [];
    for (const pattern of active) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const symbol = (match[2] || match[1] || '').trim();
            if (symbol) results.add(symbol);
            if (results.size >= 40) return Array.from(results);
        }
    }
    return Array.from(results);
}

function extractReadCallRefs(content, language) {
    const results = new Set();
    const patterns = {
        java: /\b([A-Za-z_]\w*)\s*\(/g,
        javascript: /\b([A-Za-z_]\w*)\s*\(/g,
        typescript: /\b([A-Za-z_]\w*)\s*\(/g,
        python: /\b([A-Za-z_]\w*)\s*\(/g
    };
    const ignored = new Set([
        'if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'super', 'this',
        'function', 'class', 'def', 'print', 'console', 'typeof', 'await'
    ]);
    const pattern = patterns[language];
    if (!pattern) return [];
    let match;
    while ((match = pattern.exec(content)) !== null) {
        const ref = (match[1] || '').trim();
        if (!ref || ignored.has(ref)) continue;
        results.add(ref);
        if (results.size >= 80) break;
    }
    return Array.from(results);
}

function extractReadAnchors(lines, language) {
    const anchors = [];
    const patterns = {
        java: [
            { kind: 'class', regex: /\bclass\s+([A-Za-z_]\w*)/ },
            { kind: 'interface', regex: /\binterface\s+([A-Za-z_]\w*)/ },
            { kind: 'enum', regex: /\benum\s+([A-Za-z_]\w*)/ },
            { kind: 'record', regex: /\brecord\s+([A-Za-z_]\w*)/ },
            { kind: 'method', regex: /\b(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\(/ }
        ],
        javascript: [
            { kind: 'class', regex: /\bclass\s+([A-Za-z_]\w*)/ },
            { kind: 'function', regex: /\bfunction\s+([A-Za-z_]\w*)/ },
            { kind: 'function', regex: /\bconst\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/ },
            { kind: 'function', regex: /\bexport\s+(?:default\s+)?function\s+([A-Za-z_]\w*)/ }
        ],
        typescript: [
            { kind: 'class', regex: /\bclass\s+([A-Za-z_]\w*)/ },
            { kind: 'interface', regex: /\binterface\s+([A-Za-z_]\w*)/ },
            { kind: 'type', regex: /\btype\s+([A-Za-z_]\w*)/ },
            { kind: 'enum', regex: /\benum\s+([A-Za-z_]\w*)/ },
            { kind: 'function', regex: /\bfunction\s+([A-Za-z_]\w*)/ },
            { kind: 'function', regex: /\bconst\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/ },
            { kind: 'function', regex: /\bexport\s+(?:default\s+)?function\s+([A-Za-z_]\w*)/ }
        ],
        python: [
            { kind: 'class', regex: /^\s*class\s+([A-Za-z_]\w*)/ },
            { kind: 'function', regex: /^\s*def\s+([A-Za-z_]\w*)/ }
        ]
    };
    const matchers = patterns[language];
    if (!matchers) return anchors;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const matcher of matchers) {
            const match = line.match(matcher.regex);
            if (!match) continue;
            const name = (match[1] || '').trim();
            if (!name) continue;
            anchors.push({ name, line: i + 1, kind: matcher.kind });
            break;
        }
        if (anchors.length >= 40) break;
    }
    return anchors;
}

function getLineIndent(line) {
    let indent = 0;
    for (const ch of line || '') {
        if (ch === ' ') indent += 1
        else if (ch === '\t') indent += 4
        else break
    }
    return indent
}

function isBlankOrCommentLine(line, language) {
    const trimmed = (line || '').trim()
    if (!trimmed) return true
    if (language === 'python') return trimmed.startsWith('#')
    return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')
}

function findBraceScopedEndLine(lines, startLine, maxEndLine) {
    let depth = 0
    let seenOpeningBrace = false
    const safeStart = Math.max(1, startLine)
    const safeMax = Math.max(safeStart, maxEndLine)
    for (let lineNumber = safeStart; lineNumber <= safeMax; lineNumber++) {
        const line = lines[lineNumber - 1] || ''
        for (const ch of line) {
            if (ch === '{') {
                depth += 1
                seenOpeningBrace = true
            } else if (ch === '}' && seenOpeningBrace) {
                depth -= 1
                if (depth <= 0) return lineNumber
            }
        }
    }
    return safeMax
}

function findPythonScopedEndLine(lines, startLine, maxEndLine) {
    const safeStart = Math.max(1, startLine)
    const safeMax = Math.max(safeStart, maxEndLine)
    const baseIndent = getLineIndent(lines[safeStart - 1] || '')
    let bodyStarted = false
    let bodyIndent = baseIndent + 1
    for (let lineNumber = safeStart + 1; lineNumber <= safeMax; lineNumber++) {
        const line = lines[lineNumber - 1] || ''
        if (isBlankOrCommentLine(line, 'python')) {
            continue
        }
        const indent = getLineIndent(line)
        if (!bodyStarted) {
            if (indent > baseIndent) {
                bodyStarted = true
                bodyIndent = indent
                continue
            }
            return Math.max(safeStart, lineNumber - 1)
        }
        if (indent < bodyIndent || indent <= baseIndent) {
            return Math.max(safeStart, lineNumber - 1)
        }
    }
    return safeMax
}

function refineSymbolEndLine(lines, language, startLine, nextAnchorLine) {
    const maxEndLine = nextAnchorLine ? Math.max(startLine, nextAnchorLine - 1) : lines.length
    if (language === 'python') {
        return findPythonScopedEndLine(lines, startLine, maxEndLine)
    }
    if (language === 'java' || language === 'javascript' || language === 'typescript') {
        return findBraceScopedEndLine(lines, startLine, maxEndLine)
    }
    return maxEndLine
}

function isTypeLikeSymbolKind(kind) {
    return ['class', 'interface', 'enum', 'record', 'type'].includes((kind || '').toLowerCase())
}

function buildSymbolKey(segment) {
    const enclosingClass = segment.enclosingClass || ''
    const kind = (segment.kind || 'symbol').toLowerCase()
    return `${enclosingClass}::${kind}:${segment.name}@${segment.startLine}-${segment.endLine}`
}

function buildSymbolSegments(lines, language) {
    const anchors = extractReadAnchors(lines, language);
    const segments = [];
    for (let i = 0; i < anchors.length; i++) {
        const current = anchors[i];
        const next = anchors[i + 1];
        const startLine = current.line;
        const endLine = refineSymbolEndLine(lines, language, startLine, next ? next.line : 0);
        segments.push({
            name: current.name,
            line: current.line,
            kind: current.kind || 'symbol',
            startLine,
            endLine,
            content: lineWindow(lines, startLine, endLine)
        });
    }
    const scopeStack = [];
    for (const segment of segments) {
        while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].endLine < segment.line) {
            scopeStack.pop()
        }
        segment.enclosingClass = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1].name : ''
        segment.symbolKey = buildSymbolKey(segment)
        if (isTypeLikeSymbolKind(segment.kind)) {
            scopeStack.push(segment)
        }
    }
    return segments;
}

function extractReadSymbolCalls(lines, language, segments) {
    const sourceSegments = Array.isArray(segments) ? segments : buildSymbolSegments(lines, language);
    return sourceSegments
        .slice(0, 30)
        .map(segment => ({
            sourceSymbol: segment.name,
            sourceKind: segment.kind,
            sourceKey: segment.symbolKey,
            sourceEnclosingClass: segment.enclosingClass || '',
            line: segment.line,
            startLine: segment.startLine,
            endLine: segment.endLine,
            callRefs: extractReadCallRefs(segment.content, language).slice(0, 40)
        }))
        .filter(entry => entry.sourceSymbol && entry.callRefs.length > 0);
}

function serializeAnchorSegments(segments) {
    return segments
        .slice(0, 40)
        .map(segment => ({
            name: segment.name,
            line: segment.line,
            startLine: segment.startLine,
            endLine: segment.endLine,
            kind: segment.kind,
            enclosingClass: segment.enclosingClass || '',
            symbolKey: segment.symbolKey
        }));
}

function buildCompactReadEnvelope(filePath, content, size) {
    const lines = splitFileLines(content);
    const language = detectReadLanguage(filePath);
    const segments = buildSymbolSegments(lines, language);
    const headCount = Math.min(lines.length, 120);
    const tailStart = Math.max(headCount + 1, lines.length - 79);
    const tail = tailStart <= lines.length ? lineWindow(lines, tailStart, lines.length) : '';
    return {
        format: 'code_read_v2',
        mode: 'compact',
        path: filePath,
        language,
        size,
        lineCount: lines.length,
        truncated: true,
        imports: extractReadImports(content, language),
        symbols: extractReadSymbols(content, language),
        callRefs: extractReadCallRefs(content, language),
        anchors: serializeAnchorSegments(segments),
        symbolCalls: extractReadSymbolCalls(lines, language, segments),
        headStartLine: 1,
        headEndLine: headCount,
        head: lineWindow(lines, 1, headCount),
        tailStartLine: tail ? tailStart : 0,
        tailEndLine: tail ? lines.length : 0,
        tail
    };
}

async function buildCompactReadEnvelopeWithAst(filePath, content, size, backendHost) {
    const envelope = buildCompactReadEnvelope(filePath, content, size)
    if (detectReadLanguage(filePath) !== 'java') return envelope
    try {
        const astSummary = await requestJavaAstSummary(filePath, content, backendHost)
        return mergeAstSummary(envelope, astSummary)
    } catch (e) {
        console.warn(`[Local Agent] Java AST compact fallback for ${filePath}: ${e.message}`)
        return envelope
    }
}

function buildFocusedReadEnvelope(filePath, content, size, startLine, endLine) {
    const lines = splitFileLines(content);
    const language = detectReadLanguage(filePath);
    const safeStart = Math.max(1, Number.isFinite(startLine) ? startLine : 1);
    const safeEnd = Math.min(lines.length, Math.max(safeStart, Number.isFinite(endLine) ? endLine : safeStart + 199));
    const focusedContent = lineWindow(lines, safeStart, safeEnd);
    const focusedLines = splitFileLines(focusedContent);
    const focusedSegments = buildSymbolSegments(focusedLines, language);
    return {
        format: 'code_read_v2',
        mode: 'focused',
        path: filePath,
        language,
        size,
        lineCount: lines.length,
        startLine: safeStart,
        endLine: safeEnd,
        content: focusedContent,
        symbols: extractReadSymbols(focusedContent, language),
        callRefs: extractReadCallRefs(focusedContent, language),
        anchors: serializeAnchorSegments(focusedSegments).map(anchor => ({
            ...anchor,
            line: anchor.line + safeStart - 1,
            startLine: anchor.startLine + safeStart - 1,
            endLine: anchor.endLine + safeStart - 1,
            symbolKey: `${anchor.enclosingClass || ''}::${anchor.kind}:${anchor.name}@${anchor.startLine + safeStart - 1}-${anchor.endLine + safeStart - 1}`
        })),
        symbolCalls: extractReadSymbolCalls(focusedLines, language, focusedSegments).map(entry => ({
            ...entry,
            line: entry.line + safeStart - 1,
            startLine: entry.startLine + safeStart - 1,
            endLine: entry.endLine + safeStart - 1,
            sourceKey: `${entry.sourceEnclosingClass || ''}::${entry.sourceKind}:${entry.sourceSymbol}@${entry.startLine + safeStart - 1}-${entry.endLine + safeStart - 1}`
        }))
    };
}

async function buildFocusedReadEnvelopeWithAst(filePath, content, size, startLine, endLine, backendHost) {
    const envelope = buildFocusedReadEnvelope(filePath, content, size, startLine, endLine)
    if (detectReadLanguage(filePath) !== 'java') return envelope
    try {
        const astSummary = await requestJavaAstSummary(filePath, content, backendHost, envelope.startLine, envelope.endLine)
        return mergeAstSummary(envelope, astSummary)
    } catch (e) {
        console.warn(`[Local Agent] Java AST focused fallback for ${filePath}: ${e.message}`)
        return envelope
    }
}

function enumerateWindowsDrives() {
    const drives = [];
    const seenDrives = new Set();

    const addDrive = (driveRoot) => {
        if (!driveRoot || typeof driveRoot !== 'string') return;
        const normalized = driveRoot.trim().replace(/\//g, '\\');
        const match = normalized.match(/^([A-Za-z]):\\?$/);
        if (!match) return;
        const letter = match[1].toUpperCase();
        if (seenDrives.has(letter)) return;
        seenDrives.add(letter);
        drives.push({ name: letter, root: `${letter}:\\`, type: 'disk' });
    };

    try {
        const fsutilResult = execSync('fsutil fsinfo drives', { encoding: 'utf8' });
        const driveMatches = fsutilResult.replace(/\r?\n/g, ' ').match(/[A-Za-z]:\\/g) || [];
        for (const drive of driveMatches) {
            addDrive(drive);
        }
    } catch (e) {
        console.error('[Workspace] fsutil drive listing failed:', e.message);
    }

    try {
        const psScript = 'Get-CimInstance Win32_LogicalDisk | Select-Object -ExpandProperty DeviceID | ConvertTo-Json';
        const psResult = execSync(`powershell -NoProfile -Command "${psScript}"`, {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            timeout: 5000
        });
        if (psResult && psResult.trim()) {
            const parsed = JSON.parse(psResult.trim());
            const driveArray = Array.isArray(parsed) ? parsed : [parsed];
            for (const deviceId of driveArray) {
                addDrive(deviceId);
            }
        }
    } catch (e) {
        console.error('[Workspace] PowerShell CIM drive listing failed:', e.message);
    }

    try {
        for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
            const root = `${letter}:\\`;
            if (fs.existsSync(root)) {
                addDrive(root);
            }
        }
    } catch (e) {
        console.error('[Workspace] fs.existsSync drive probing failed:', e.message);
    }

    if (drives.length === 0) {
        drives.push({ name: 'C', root: 'C:\\', type: 'disk' });
    }
    return drives.sort((a, b) => a.name.localeCompare(b.name));
}

// 5. Local workspace file operations — read local filesystem
app.post('/api/local/workspace/list', (req, res) => {
    const { path: dirPath, extensions } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'path is required' });

    try {
        const SKIP_DIRS = new Set(['.git', 'node_modules', '.worktrees', '.claude', '.deepseek', 'target', 'dist', 'build', '__pycache__', '.next']);
        const result = [];
        const extSet = new Set((extensions || '').split(',').filter(Boolean));

        // Single-level: only return direct children of dirPath, no recursion
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                result.push({ path: entry.name, absolute: fullPath, isFile: false, size: 0 });
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (extSet.size === 0 || extSet.has(ext)) {
                    try {
                        result.push({ path: entry.name, absolute: fullPath, isFile: true, size: fs.statSync(fullPath).size });
                    } catch (e) {}
                }
            }
        }
        result.sort((a, b) => {
            if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
            return a.path.localeCompare(b.path);
        });
        res.json({ root: dirPath, count: result.length, files: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/read', async (req, res) => {
    const { path: filePath, mode = 'full', startLine, endLine, backendHost } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path is required' });
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const size = fs.statSync(filePath).size;
        if (size > 500_000) return res.status(400).json({ error: 'File too large: ' + size });
        if (mode === 'compact') {
            return res.json(await buildCompactReadEnvelopeWithAst(filePath, content, size, backendHost));
        }
        if (mode === 'focused') {
            return res.json(await buildFocusedReadEnvelopeWithAst(
                filePath,
                content,
                size,
                Number(startLine),
                Number(endLine),
                backendHost
            ));
        }
        res.json({ path: filePath, content, size, format: 'code_read_v2', mode: 'full' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/scan', (req, res) => {
    const { path: rootPath, maxDepth = 4, extensions } = req.body;
    if (!rootPath) return res.status(400).json({ error: 'path is required' });

    try {
        const scanned = scanWorkspaceEntries(rootPath, { maxDepth, maxEntries: 5000, extensions });
        const flattened = scanned.entries.map(entry => entry.type === 'dir' ? `${entry.path}/` : entry.path);
        res.json({
            root: scanned.root,
            count: flattened.length,
            entries: flattened,
            truncated: scanned.truncated
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/tree', (req, res) => {
    const { path: rootPath, maxDepth = 12, maxEntries = 30000, extensions, excludeDirs } = req.body;
    if (!rootPath) return res.status(400).json({ error: 'path is required' });

    try {
        const scanned = scanWorkspaceEntries(rootPath, {
            maxDepth,
            maxEntries,
            extensions,
            excludeDirs: Array.isArray(excludeDirs) ? excludeDirs : []
        });
        res.json({
            root: scanned.root,
            scannedAt: new Date().toISOString(),
            truncated: scanned.truncated,
            entryCount: scanned.entries.length,
            entries: scanned.entries
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/browse', (req, res) => {
    const { path: dirPath } = req.body;
    const isWindows = os.platform() === 'win32';

    if (!dirPath) {
        const home = os.homedir();
        if (isWindows) {
            const drives = enumerateWindowsDrives();

            const entries = [{ name: '..', path: path.dirname(home), isDir: true }];
            for (const dl of drives) {
                const drivePath = dl.root || (dl.name + ':\\');
                entries.push({ name: dl.name + ':', path: drivePath, isDir: true });
            }
            return res.json({ path: home, entries: entries.slice(0, 50) });
        } else {
            // On macOS/Linux, list root directories
            const entries = [{ name: '..', path: path.dirname(home), isDir: true }];
            const rootDirs = fs.readdirSync('/').filter(d => {
                try { return fs.statSync('/' + d).isDirectory(); } catch (e) { return false; }
            });
            for (const d of rootDirs) entries.push({ name: d, path: '/' + d, isDir: true });
            return res.json({ path: '/', entries });
        }
    }
    try {
        const entries = [];
        const parent = path.dirname(dirPath);
        if (parent !== dirPath) entries.push({ name: '..', path: parent, isDir: true });
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            entries.push({ name: item.name, path: fullPath, isDir: item.isDirectory() });
        }
        entries.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        res.json({ path: dirPath, entries: entries.slice(0, 200) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/validate', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) {
        return res.status(400).json({ valid: false, error: 'path is required' });
    }
    try {
        const exists = fs.existsSync(dirPath);
        if (!exists) {
            return res.json({ valid: false, error: '路径不存在', path: dirPath });
        }
        const isDir = fs.statSync(dirPath).isDirectory();
        if (!isDir) {
            return res.json({ valid: false, error: '路径不是有效目录', path: dirPath });
        }
        // Check read access by trying to read directory
        try {
            fs.readdirSync(dirPath);
        } catch (readErr) {
            return res.json({ valid: false, error: '路径不可读，请检查权限', path: dirPath });
        }
        return res.json({ valid: true, path: dirPath, exists: true, isDirectory: true });
    } catch (e) {
        return res.status(500).json({ valid: false, error: e.message, path: dirPath });
    }
});

app.post('/api/local/workspace/save', (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path is required' });
    try {
        fs.writeFileSync(filePath, content || '', 'utf-8');
        res.json({ saved: true, path: filePath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Toolchain probe ────────────────────────────────────────────────

app.post('/api/local/workspace/probe', (req, res) => {
    const { tools = [] } = req.body || {};
    if (!Array.isArray(tools)) return res.status(400).json({ error: 'tools must be an array' });
    const isWin = os.platform() === 'win32';
    const results = tools.map(tool => {
        const name = String(tool).trim();
        if (!name) return { key: name, found: false };
        const tryVersion = (bin, args) => {
            try {
                const stdout = execFileSync(bin, args, { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
                const version = (stdout || '').split('\n')[0].trim();
                return { key: name, found: true, version };
            } catch { return null; }
        };
        let result = tryVersion(name, ['--version']) || tryVersion(name, ['version']);
        // On Windows, try extension variants for script commands (mvnw → mvnw.cmd, etc.)
        if (!result && isWin && !name.includes('.')) {
            for (const ext of ['.cmd', '.bat', '.exe']) {
                result = tryVersion(name + ext, ['--version']) || tryVersion(name + ext, ['version']);
                if (result) break;
            }
        }
        return result || { key: name, found: false };
    });
    res.json({ platform: os.platform(), arch: os.arch(), tools: results });
});

// ═══════════════════════════════════════════════════════════════════
// CodeAgent implementation pipeline endpoints
//
// These back the __CMD__ actions emitted by the Java backend's
// LanguageAdapter implementations: write, delete, restore_bak, delete_bak,
// run. Every action that mutates user files keeps a sibling .CodeAgent.bak
// snapshot so failed implementations can be undone. The `run` action is
// the only one that can spawn arbitrary subprocesses; the Java backend
// is expected to have gated it with a user confirmation prompt already
// (see agentCommandSafety.js), but we also apply OS-level safeguards
// here (timeouts, no shell, no piping).
// ════════════════════════════════════════════════════════════════════

const BAK_SUFFIX = '.CodeAgent.bak';

/**
 * Make sure {@code childPath} is either inside {@code parentPath} (or equal
 * to it) before we touch it. Returns the resolved absolute path on success,
 * or null if the path would escape the parent.
 */
function resolveInside(parentPath, childPath) {
    if (!parentPath || !childPath) return null;
    const normParent = path.resolve(parentPath);
    const resolved = path.resolve(childPath);
    // path.resolve on Windows is case-insensitive at the OS layer, but
    // path.relative normalizes case, so a trailing check is enough.
    const rel = path.relative(normParent, resolved);
    if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        return resolved;
    }
    return null;
}

app.post('/api/local/workspace/write', (req, res) => {
    const { path: targetPath, content, backup_path: backupPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'path is required' });
    try {
        // If a backup path was provided, copy the current file there first
        // (no-op if the file doesn't exist yet — that's a CREATE).
        if (backupPath && fs.existsSync(targetPath)) {
            fs.copyFileSync(targetPath, backupPath);
        }
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(targetPath, content || '', 'utf-8');
        res.json({
            written: true,
            path: targetPath,
            bytes: Buffer.byteLength(content || '', 'utf-8'),
            backup: backupPath && fs.existsSync(backupPath) ? backupPath : null,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/delete_file', (req, res) => {
    const { path: targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'path is required' });
    try {
        if (!fs.existsSync(targetPath)) {
            return res.json({ deleted: false, path: targetPath, reason: 'not_found' });
        }
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
            return res.status(400).json({ error: 'Refusing to delete a directory; use a recursive flag explicitly' });
        }
        fs.unlinkSync(targetPath);
        res.json({ deleted: true, path: targetPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/restore_bak', (req, res) => {
    const { from: fromPath, to: toPath } = req.body;
    if (!fromPath || !toPath) {
        return res.status(400).json({ error: 'from and to are required' });
    }
    try {
        if (!fs.existsSync(fromPath)) {
            return res.status(404).json({ error: 'Backup not found: ' + fromPath });
        }
        const dir = path.dirname(toPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(fromPath, toPath);
        res.json({ restored: true, from: fromPath, to: toPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/local/workspace/delete_bak', (req, res) => {
    const { path: targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'path is required' });
    try {
        // Refuse to delete anything that doesn't look like a CodeAgent backup
        // — protects against malicious __CMD__ actions trying to nuke
        // unrelated files.
        if (!targetPath.endsWith(BAK_SUFFIX)) {
            return res.status(400).json({
                error: `Refusing to delete ${targetPath}; only paths ending in ${BAK_SUFFIX} are allowed`,
            });
        }
        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
        }
        res.json({ deleted: true, path: targetPath });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Run a command on the user's machine. This endpoint is invoked by the
 * frontend AFTER the user has confirmed a `run` command via the safety
 * dialog. The Java backend is the source of trust — the `requires_confirmation`
 * flag on the wire and the local DANGEROUS_PATTERNS scan have both been
 * satisfied by the time we get here. The endpoint applies one more layer
 * of defence: argv-only spawn (no shell), a hard timeout, and a cap on
 * captured output size.
 */
const MAX_RUN_OUTPUT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_RUN_TIMEOUT_SECONDS = 600;
const DEFAULT_RUN_TIMEOUT_SECONDS = 60;

app.post('/api/local/workspace/run', (req, res) => {
    const {
        command,
        args = [],
        cwd,
        code,
        extension,
        timeoutSeconds = DEFAULT_RUN_TIMEOUT_SECONDS,
        tailLines = 200,
        skipIfNoTestScript = false,
    } = req.body;

    if (!command) return res.status(400).json({ error: 'command is required' });
    if (!Array.isArray(args)) return res.status(400).json({ error: 'args must be an array' });

    const timeout = Math.max(1, Math.min(MAX_RUN_TIMEOUT_SECONDS, Number(timeoutSeconds) || DEFAULT_RUN_TIMEOUT_SECONDS));
    const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();

    // If the backend wants to run an inline code blob (the legacy Python /
    // Node / Java case), write it to a temp file inside the cwd and pass
    // the path in args. We deliberately do NOT shell-eval the code.
    let effectiveArgs = args.map((a) => String(a));
    let tempFile = null;
    if (typeof code === 'string' && code.length > 0) {
        const ext = (extension || '.tmp').replace(/[^.\w]/g, '');
        tempFile = path.join(resolvedCwd, `.CodeAgent_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
        try {
            fs.writeFileSync(tempFile, code, 'utf-8');
        } catch (e) {
            return res.status(500).json({ error: 'Failed to write temp code file: ' + e.message });
        }
        // Replace any ${CODE_FILE} placeholder with the real path
        effectiveArgs = effectiveArgs.map((a) => a === '${CODE_FILE}' ? tempFile : a);
        if (!effectiveArgs.some((a) => a === tempFile)) {
            effectiveArgs.push(tempFile);
        }
    }

    console.log(`[Local Agent] run: ${command} ${effectiveArgs.map((a) => /\s/.test(a) ? `"${a}"` : a).join(' ')} (cwd=${resolvedCwd}, timeout=${timeout}s)`);

    // On Windows, resolve script commands without extension to their .cmd/.bat variant.
    // execFile with shell:false cannot execute bare batch files directly.
    let resolvedCommand = command;
    if (os.platform() === 'win32' && !path.extname(command)) {
        for (const ext of ['.cmd', '.bat', '.exe']) {
            const candidate = path.join(resolvedCwd, command + ext);
            if (fs.existsSync(candidate)) {
                resolvedCommand = command + ext;
                break;
            }
        }
    }

    // Special-case: skip npm test if there's no "test" script (saves the
    // user a useless failed build).
    if (skipIfNoTestScript && (command === 'npm' || command === 'pnpm' || command === 'yarn')) {
        const pkgPath = path.join(resolvedCwd, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            cleanupTemp();
            return res.json({ output: '[no package.json, skipped]', exit_code: 0, timed_out: false });
        }
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (!pkg.scripts || !pkg.scripts.test) {
                cleanupTemp();
                return res.json({ output: '[no "test" script, skipped]', exit_code: 0, timed_out: false });
            }
        } catch (e) {
            // fall through and let npm complain
        }
    }

    const startedAt = Date.now();
    const child = execFile(resolvedCommand, effectiveArgs, {
        cwd: resolvedCwd,
        timeout: timeout * 1000,
        maxBuffer: MAX_RUN_OUTPUT_BYTES,
        windowsHide: true,
        // shell:false is the default for execFile; keep argv-only
    }, (error, stdout, stderr) => {
        cleanupTemp();
        const elapsed = Date.now() - startedAt;
        const timedOut = error && (error.killed || error.signal === 'SIGTERM') && error.code === null;
        const exitCode = error && typeof error.code === 'number' ? error.code : (error ? 1 : 0);

        // Keep tail of stdout+stderr
        const combined = (stdout || '') + (stderr || '');
        const tail = trimToTail(combined, tailLines);
        res.json({
            output: tail,
            exit_code: exitCode,
            timed_out: !!timedOut,
            duration_ms: elapsed,
        });
    });

    child.on('error', (err) => {
        cleanupTemp();
        res.status(500).json({ error: err.message });
    });

    function cleanupTemp() {
        if (tempFile) {
            try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
        }
    }
});

/**
 * Keep only the last N lines of a (possibly huge) string. Used to bound
 * the output the backend sees so the LLM context window isn't blown out.
 */
function trimToTail(text, lines) {
    if (!text) return '';
    const arr = text.split(/\r?\n/);
    if (arr.length <= lines) return text;
    return `... (${arr.length - lines} earlier lines omitted) ...\n` + arr.slice(-lines).join('\n');
}

// ── Phase 1 / C-1+C-2: persistent shell (bash) ────────────────────────
//
// New unified command-execution surface. The legacy `workspace/run`,
// `local/execute`, and `local/db` endpoints are NOT removed; they remain
// in place for backwards compat. New callers should prefer this endpoint
// because it provides:
//   - cwd / env preservation across requests (same shellId)
//   - explicit per-command timeout (capped at 10 min)
//   - output truncation (2 MB)
//   - structured status / exitCode / timedOut response
//
// The safety model is unchanged: the Java backend is the trust boundary
// and only forwards commands that the frontend's `agentCommandSafety`
// dialog has cleared. This endpoint deliberately does NOT re-run that
// scan — that would require duplicating the entire DANGEROUS_PATTERN /
// EXPLICIT_SAFE_SHAPES machinery on the server.
import { getOrCreate, get, kill as killShellById, list as listShells, killAll as killAllShells } from './src/runtime/shellRegistry.js';
import { analyzeCommand, setDefaultRules as setAnalyzerRules, setDefaultAction as setAnalyzerAction, DEFAULT_RULES as ANALYZER_DEFAULT_RULES } from './src/runtime/commandAnalyzer.js';
import { createTask as createBgTask, get as getTask, list as listTasks, kill as killTask, killAll as killAllTasks, summarize as summarizeTask } from './src/runtime/taskRegistry.js';
import { webfetch, WebfetchError } from './src/runtime/webfetch.js';
import { websearch, WebsearchError } from './src/runtime/websearch.js';
import { write as todoWrite, read as todoRead, updateItem as todoUpdate, clear as todoClear } from './src/runtime/todoStore.js';
import { create as qCreate, get as qGet, listPending as qListPending, listAll as qListAll, answer as qAnswer } from './src/runtime/questionQueue.js';

app.post('/api/local/bash', async (req, res) => {
    const {
        shellId,
        command,
        cwd,
        env,
        timeoutMs = 60_000,
        // Phase 2 (C-7): the frontend's permission dialog sets this to
        // `true` after the user clicks "Allow" for an `ask` decision.
        // `deny` decisions are still rejected server-side regardless.
        confirmed = false,
        // Phase 2 (C-7): rule namespace, default 'default'.
        namespace = 'default',
        // Phase 3 (C-3): when true, the command runs asynchronously
        // and the response is `{ taskId, status: 'running' }` instead
        // of the full result. Use `GET /api/local/bash/tasks/:id`
        // to poll or `DELETE` to cancel.
        background = false,
    } = req.body || {};

    if (typeof command !== 'string' || command.length === 0) {
        return res.status(400).json({ status: 'error', error: 'command is required' });
    }
    if (command.length > 64 * 1024) {
        return res.status(400).json({ status: 'error', error: 'command exceeds 64KB limit' });
    }
    if (typeof timeoutMs !== 'number' || timeoutMs < 1000 || timeoutMs > 600_000) {
        return res.status(400).json({ status: 'error', error: 'timeoutMs must be 1000..600000' });
    }

    // Phase 2 (C-5+C-7): run the AST-style analyzer. It evaluates each
    // subcommand independently and reports deny/ask/allow. This runs
    // BEFORE shell allocation so denied commands are cheap to reject.
    const analysis = analyzeCommand(command, { namespace });
    if (analysis.decision === 'deny') {
        return res.status(403).json({
            status: 'denied',
            reason: analysis.reason,
            analysis,
        });
    }
    if (analysis.decision === 'ask' && !confirmed) {
        return res.status(200).json({
            status: 'needs_confirmation',
            reason: analysis.reason,
            analysis,
        });
    }

    // Phase 3 (C-3): background tasks skip the persistent-shell queue
    // and run in a freshly-spawned child. We still pass cwd/env so
    // the user gets the same "feel" of working in their project.
    if (background) {
        const task = createBgTask({
            command,
            cwd: typeof cwd === 'string' ? cwd : process.cwd(),
            env: (env && typeof env === 'object') ? { ...process.env, ...env } : process.env,
            timeoutMs,
            analysisReason: analysis.reason,
        });
        return res.status(202).json({
            status: 'running',
            taskId: task.id,
            analysis,
        });
    }

    let created = false;
    let shell;
    try {
        const result = getOrCreate({
            id: shellId,
            cwd: typeof cwd === 'string' ? cwd : undefined,
            env: (env && typeof env === 'object') ? env : undefined,
        });
        shell = result.shell;
        created = result.created;
    } catch (err) {
        return res.status(500).json({ status: 'error', error: 'Failed to start shell: ' + err.message });
    }

    if (!shell.alive) {
        return res.status(503).json({ status: 'error', error: 'Shell not alive', shellId: shell.id });
    }

    try {
        const execResult = await shell.exec(command, { timeoutMs });
        return res.json({
            status: execResult.status,
            shellId: shell.id,
            created,
            exitCode: execResult.exitCode,
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            timedOut: execResult.timedOut,
            durationMs: execResult.durationMs,
            analysis,
        });
    } catch (err) {
        return res.status(500).json({ status: 'error', error: err.message, shellId: shell.id });
    }
});

app.get('/api/local/bash', (req, res) => {
    res.json({ shells: listShells() });
});

app.delete('/api/local/bash/:id', (req, res) => {
    const ok = killShellById(req.params.id);
    res.json({ killed: ok });
});

// Phase 3 (C-3+C-4): background-task endpoints. We expose three
// operations on `/api/local/bash/tasks`:
//   GET    /                → list of tasks
//   GET    /:id             → single task snapshot
//   DELETE /:id             → terminate (process-group kill)
app.get('/api/local/bash/tasks', (req, res) => {
    res.json({ tasks: listTasks() });
});

app.get('/api/local/bash/tasks/:id', (req, res) => {
    const t = getTask(req.params.id);
    if (!t) return res.status(404).json({ status: 'error', error: 'Task not found' });
    res.json({ task: summarizeTask(t) });
});

app.delete('/api/local/bash/tasks/:id', async (req, res) => {
    const ok = await killTask(req.params.id);
    res.json({ killed: ok });
});

// Cleanup on shutdown — kill all persistent shells AND background
// tasks so child processes don't outlive the parent.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
        try { killAllShells(); } catch (_) {}
        try { killAllTasks(); } catch (_) {}
        // Let the default handler run so the server actually exits.
    });
}

// ───────────────────────────────────────────────────────────────────
// Phase 4 (C-6+C-8): webfetch / todowrite / question tool endpoints
// ───────────────────────────────────────────────────────────────────
// These mirror opencode's three "knowledge" tools. They are pure
// server-side primitives the Java backend can call on behalf of the
// LLM. Authorization is the same as `/api/local/bash`: the Java
// backend is the trust boundary and pre-screens requests; these
// endpoints just provide the runtime.

// websearch (P-3 v4) — search the web via Bing / DuckDuckGo / mock.
app.post('/api/local/websearch', async (req, res) => {
    const { query, maxResults, provider, apiKey } = req.body || {};
    if (typeof query !== 'string' || !query) {
        return res.status(400).json({ status: 'error', error: 'query is required' });
    }
    try {
        const result = await websearch(query, { maxResults, provider, apiKey });
        return res.json({ status: 'ok', ...result });
    } catch (err) {
        if (err instanceof WebsearchError) {
            const status = err.code === 'invalid_query' || err.code === 'query_too_long' || err.code === 'unknown_provider' || err.code === 'missing_key' ? 400 : 502;
            return res.status(status).json({ status: 'error', code: err.code, error: err.message });
        }
        return res.status(500).json({ status: 'error', error: err.message });
    }
});

// webfetch (C-6) — fetch a URL, strip HTML, cap at 5 MiB.
app.post('/api/local/webfetch', async (req, res) => {
    const { url, selector, maxBytes } = req.body || {};
    if (typeof url !== 'string' || !url) {
        return res.status(400).json({ status: 'error', error: 'url is required' });
    }
    try {
        const result = await webfetch(url, { selector, maxBytes });
        return res.json({ status: 'ok', ...result });
    } catch (err) {
        if (err instanceof WebfetchError) {
            const status = err.code === 'invalid_url' ? 400 : 502
            return res.status(status).json({ status: 'error', code: err.code, error: err.message });
        }
        return res.status(500).json({ status: 'error', error: err.message });
    }
});

// todowrite / todoread (C-8) — small in-memory TODO list. The Java
// backend is the authoritative planner; this store is the LLM's
// working scratchpad.
app.post('/api/local/todos', (req, res) => {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
        return res.status(400).json({ status: 'error', error: 'items must be an array' });
    }
    try {
        const out = todoWrite(items);
        return res.json({ status: 'ok', ...out });
    } catch (err) {
        return res.status(400).json({ status: 'error', error: err.message });
    }
});

app.get('/api/local/todos', (req, res) => {
    res.json(todoRead());
});

app.patch('/api/local/todos/:id', (req, res) => {
    const out = todoUpdate(req.params.id, req.body || {});
    if (!out) return res.status(404).json({ status: 'error', error: 'todo not found' });
    res.json({ status: 'ok', ...out });
});

app.delete('/api/local/todos', (req, res) => {
    res.json({ status: 'ok', ...todoClear() });
});

// question (C-8) — queue a question for the user. The Java backend
// calls `POST /api/local/questions` when the LLM wants clarification.
// The frontend polls `GET /api/local/questions/pending`, shows a
// dialog, and posts the answer back via
// `POST /api/local/questions/:id/answer`.
app.post('/api/local/questions', (req, res) => {
    const { question, options, default: defaultOpt, header } = req.body || {};
    try {
        const q = qCreate({ question, options, default: defaultOpt, header });
        return res.status(201).json({ status: 'ok', question: q });
    } catch (err) {
        return res.status(400).json({ status: 'error', error: err.message });
    }
});

app.get('/api/local/questions/pending', (req, res) => {
    res.json({ questions: qListPending() });
});

app.get('/api/local/questions', (req, res) => {
    res.json({ questions: qListAll() });
});

app.get('/api/local/questions/:id', (req, res) => {
    const q = qGet(req.params.id);
    if (!q) return res.status(404).json({ status: 'error', error: 'question not found' });
    res.json({ question: q });
});

app.post('/api/local/questions/:id/answer', (req, res) => {
    const { answer } = req.body || {};
    if (typeof answer !== 'string' && typeof answer !== 'number') {
        return res.status(400).json({ status: 'error', error: 'answer is required' });
    }
    const q = qAnswer(req.params.id, answer);
    if (!q) return res.status(404).json({ status: 'error', error: 'question not found or already answered' });
    res.json({ status: 'ok', question: q });
});

// autobot-monitor routes — manage the auto-healer subsystem
// ═══════════════════════════════════════════════════════════════════

// Effective enabled state: file wins, env var is the default.
function effectiveMonitorEnabled() {
  if (monitorConfig && typeof monitorConfig.enabled === 'boolean') return monitorConfig.enabled;
  return AUTOBOT_MONITOR_ENABLED;
}

if (AUTOBOT_MONITOR_ENABLED) {
  loadMonitorConfig();
  const { MonitorService } = await import('./src/monitor/index.js');
  const svc = new MonitorService({
    repoRoot: monitorConfig.repoRoot,
    logsDir: monitorConfig.logsDir,
    storePath: AUTOBOT_MONITOR_STORE,
    autoRestart: false,
    logger: console
  });
  svc.on('issue-created', i => console.log(`[Monitor] issue-created id=${i.id} fp=${i.fingerprint} kind=${i.kind}`));
  svc.on('issue-analyzing', i => console.log(`[Monitor] issue-analyzing id=${i.id}`));
  svc.on('issue-applying', i => console.log(`[Monitor] issue-applying id=${i.id}`));
  svc.on('issue-fixed', e => console.log(`[Monitor] issue-fixed id=${e.issue.id} branch=${e.branch}`));
  svc.on('issue-failed', e => console.log(`[Monitor] issue-failed id=${e.issue.id} error=${e.error}`));
  svc.on('review-requested', e => console.log(`[Monitor] review-requested id=${e.issue.id} reason=${e.reason}`));
  monitorService = svc;
  if (effectiveMonitorEnabled()) {
    svc.start().then(() => {
      console.log(`[Monitor] running. logs=${monitorConfig.logsDir}`);
      console.log(`[Monitor] store=${AUTOBOT_MONITOR_STORE}`);
    }).catch(e => {
      console.error(`[Monitor] failed to start: ${e.message}`);
    });
  } else {
    console.log(`[Monitor] module loaded but disabled (config enabled=false). Use POST /api/monitor/toggle to enable.`);
  }
}

app.get('/api/monitor/status', (req, res) => {
  res.json({
    available: AUTOBOT_MONITOR_ENABLED,
    enabled: effectiveMonitorEnabled(),
    running: !!(monitorService && monitorService.running),
    autoRestart: monitorAutoRestart,
    repoRoot: monitorConfig?.repoRoot || AUTOBOT_REPO_ROOT,
    logsDir: monitorConfig?.logsDir || path.join(AUTOBOT_REPO_ROOT, 'java-backend', 'logs'),
    storePath: AUTOBOT_MONITOR_STORE,
    configPath: AUTOBOT_MONITOR_CONFIG
  });
});

app.get('/api/monitor/config', (req, res) => {
  res.json(monitorConfig || { repoRoot: AUTOBOT_REPO_ROOT, logsDir: path.join(AUTOBOT_REPO_ROOT, 'java-backend', 'logs') });
});

app.post('/api/monitor/config', async (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  const { repoRoot, logsDir } = req.body || {};
  if (!repoRoot || typeof repoRoot !== 'string') {
    return res.status(400).json({ error: 'repoRoot is required' });
  }
  if (!fs.existsSync(repoRoot)) {
    return res.status(400).json({ error: `repoRoot does not exist: ${repoRoot}` });
  }
  const resolvedLogsDir = logsDir && typeof logsDir === 'string'
    ? logsDir
    : path.join(repoRoot, 'java-backend', 'logs');
  try {
    await monitorService.setRepoRoot(repoRoot, resolvedLogsDir);
    const cfg = { repoRoot, logsDir: resolvedLogsDir, updatedAt: new Date().toISOString() };
    saveMonitorConfig(cfg);
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/monitor/config/reset', async (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  try {
    // Reset to env-driven values (.env -> AUTOBOT_REPO_ROOT / AUTOBOT_LOGS_DIR)
    // rather than mutating the shared config file.
    await monitorService.setRepoRoot(AUTOBOT_REPO_ROOT, AUTOBOT_LOGS_DIR);
    loadMonitorConfig();
    res.json({ ok: true, config: monitorConfig });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/monitor/issues', (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  res.json({ issues: monitorService.getIssues() });
});

app.get('/api/monitor/issues/:id', (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  const issue = monitorService.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: 'not found' });
  res.json(issue);
});

app.post('/api/monitor/issues/:id/ignore', (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  const r = monitorService.ignoreIssue(req.params.id);
  if (!r || !r.ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, issue: r.issue });
});

app.post('/api/monitor/issues/:id/retry', (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  const r = monitorService.retryIssue(req.params.id);
  if (!r) return res.status(400).json({ error: 'cannot retry (state or missing issue)' });
  res.json({ ok: true, issue: r });
});

app.post('/api/monitor/issues/:id/apply', async (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  const r = await monitorService.applyReview(req.params.id);
  if (!r) return res.status(400).json({ error: 'cannot apply (state, missing issue, or no fix proposal)' });
  res.json({ ok: true, issue: r });
});

app.post('/api/monitor/issues/:id/reject', (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  const r = monitorService.rejectReview(req.params.id);
  if (!r || !r.ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, issue: r.issue });
});

app.post('/api/monitor/auto-restart', (req, res) => {
  const enabled = !!req.body?.enabled;
  monitorAutoRestart = enabled;
  if (monitorService) monitorService.setAutoRestart(enabled);
  res.json({ ok: true, autoRestart: enabled });
});

app.post('/api/monitor/toggle', async (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor module not loaded (set AUTOBOT_MONITOR=1)' });
  const enabled = !!req.body?.enabled;
  monitorConfig = { ...(monitorConfig || {}), enabled, updatedAt: new Date().toISOString() };
  saveMonitorConfig(monitorConfig);
  try {
    if (enabled && !monitorService.running) {
      await monitorService.start();
    } else if (!enabled && monitorService.running) {
      await monitorService.stop();
    }
    res.json({ ok: true, enabled, running: monitorService.running });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/monitor/test-trigger', async (req, res) => {
  if (!monitorService) return res.status(503).json({ error: 'monitor not running' });
  const { exceptionClass = 'java.lang.NullPointerException', message = 'test trigger from /api/monitor/test-trigger' } = req.body || {};
  const fp = `test_${Date.now()}`;
  const issue = monitorService.store.create({
    fingerprint: fp,
    kind: 'app_error',
    payload: {
      kind: 'app_error',
      fingerprint: fp,
      count: 3,
      exceptionClass,
      message,
      lastEvent: { kind: 'app_error', class: exceptionClass, message, ts: new Date().toISOString() }
    }
  });
  setImmediate(() => monitorService._processIssue(issue).catch(e => console.error(`[Monitor] test-trigger error: ${e.message}`)));
  res.json({ ok: true, issueId: issue.id });
});

// 提供 React 编译后的静态文件服务
// BUT only for GET requests, not for POST API routes!
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.url.startsWith('/api/')) {
    express.static(path.join(__dirname, 'dist'))(req, res, next);
  } else {
    next();
  }
});

// 添加通配符路由以支持 React Router，并将此路由放在所有 API 路由之后
app.get(/(.*)/, (req, res, next) => {
  if (req.method === 'GET' && !req.url.startsWith('/api/')) {
    if (req.url.startsWith('/assets/') || req.url.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      res.status(404).send('Not Found');
    } else {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
  } else {
    next();
  }
});

// 捕获所有路由，返回 index.html 以支持 SPA 路由
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.url.startsWith('/api/')) {
    if (req.url.startsWith('/assets/') || req.url.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      res.status(404).send('Not Found');
    } else {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`=========================================`);
    console.log(`AutoBot Standalone Client is running!`);
    console.log(`Local Web UI: ${url}`);
    console.log(`Local Agent API: ${url}/api/local/*`);
    console.log(`=========================================`);
    if (process.env.AUTOBOT_ELECTRON !== '1' && process.env.NO_OPEN !== '1' && process.env.CI !== 'true') {
        open(url);
    }
});
