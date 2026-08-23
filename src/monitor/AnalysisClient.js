import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';
import { parseAllCmdBlocks } from '../utils/cmdBlocks.js'; // S2: 共享解析器

/**
 * AnalysisClient drives the autobot backend's chat endpoint to perform a
 * round-driven analysis of a recurring exception.
 *
 * Round-trip protocol:
 *   1. POST /api/chat with {message, session_id, channel:'code', workspace_dir}
 *      The agent's response may contain __CMD__ blocks.
 *   2. If __CMD__ blocks are present, execute each via local FS or shell.
 *   3. POST /api/chat again with the results wrapped as [COMMAND_RESULTS]...
 *   4. Loop until the response has no more __CMD__ blocks.
 *   5. Parse the final response for a fenced ```json block matching
 *      {diagnosis, fix_needed, fix_proposal?}.
 *
 * The monitor's session_id is the issueId prefixed with "monitor-".
 * The chat endpoint already detects [COMMAND_RESULTS] prefix and treats it
 * as a continuation (ChatController.java line 82).
 */

const BACKEND_BASE = process.env.BACKEND_BASE_URL || 'http://localhost:8000';

// S2: parseCmdBlocks 改为薄包装，共用扫描器
function parseCmdBlocks(text) {
  return parseAllCmdBlocks(text).map(b => b.cmd);
}

// P1 线协议升级: 构造 [COMMAND_RESULTS] 可选的 [META:{json}] 行。
// 仅携带已跟踪字段 (session_id 必有); turn_id / tool_call_id / session_version 尚未跟踪
// 时可缺省, 由后端填权威值。无 sessionId 时返回空串 → 消息保持与 legacy 格式一致。
function buildCommandResultsMeta(sessionId, extra) {
  if (!sessionId) return '';
  const meta = { session_id: sessionId };
  if (extra?.turnId != null) meta.turn_id = extra.turnId;
  if (extra?.toolCallId != null) meta.tool_call_id = extra.toolCallId;
  if (extra?.sessionVersion != null) meta.session_version = extra.sessionVersion;
  return `[META:${JSON.stringify(meta)}]`;
}

function extractFinalJson(text) {
  if (!text) return null;
  const fenceRe = /```json\s*([\s\S]+?)\s*```/g;
  let m;
  let lastJson = null;
  while ((m = fenceRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && (parsed.diagnosis !== undefined || parsed.fix_proposal !== undefined || parsed.fix_needed !== undefined)) {
        lastJson = parsed;
      }
    } catch (e) {}
  }
  return lastJson;
}

export class AnalysisClient extends EventEmitter {
  constructor({ repoRoot, sessionId, logger = console, maxRounds = 8 } = {}) {
    super();
    this.repoRoot = repoRoot;
    this.sessionId = sessionId;
    this.logger = logger;
    this.maxRounds = maxRounds;
  }

  async runAnalysis({ issue, contextMessage }) {
    let round = 0;
    let lastResponse = null;
    let trace = [];

    while (round < this.maxRounds) {
      round++;
      const isFirst = round === 1;
      const payload = {
        session_id: this.sessionId,
        message: isFirst ? contextMessage : lastResponse,
        channel: 'code',
        workspace_dir: this.repoRoot,
        client_info: {
          platform: os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'macos' : 'linux',
          arch: os.arch(),
          path_sep: os.platform() === 'win32' ? '\\' : '/',
        }
      };
      this.logger.log?.(`[AnalysisClient] round=${round} POST /api/chat (first=${isFirst})`);

      let res;
      try {
        res = await axios.post(`${BACKEND_BASE}/api/chat`, payload, {
          timeout: 180_000,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        this.logger.error?.(`[AnalysisClient] /api/chat failed: ${e.message}`);
        throw new Error(`chat round ${round} failed: ${e.message}`);
      }

      if (res.data?.status !== 'success') {
        const msg = res.data?.message || 'unknown error';
        this.logger.error?.(`[AnalysisClient] /api/chat non-success: ${msg}`);
        throw new Error(`chat returned status=${res.data?.status}: ${msg}`);
      }

      const responseText = (res.data.response || '').toString();
      trace.push({ round, length: responseText.length });

      const cmds = parseCmdBlocks(responseText);
      if (cmds.length === 0) {
        const finalJson = extractFinalJson(responseText);
        return {
          finalText: responseText,
          finalJson,
          trace
        };
      }

      this.logger.log?.(`[AnalysisClient] round=${round} executing ${cmds.length} __CMD__ block(s)`);
      const results = [];
      for (const cmd of cmds) {
        const r = await this._executeCommand(cmd);
        results.push(`[RESULT:${cmd.id || '(no-id)'}]\n${r}`);
      }

      const state = this._extractTrailingState(responseText);
      const metaLine = buildCommandResultsMeta(this.sessionId);
      lastResponse = `[COMMAND_RESULTS]\n${metaLine ? metaLine + '\n' : ''}${results.join('\n\n')}\n\n${state}`;
    }

    throw new Error(`AnalysisClient exceeded ${this.maxRounds} rounds without final answer`);
  }

  async _executeCommand(cmd) {
    const onLog = (line) => this.logger.log?.(`[AnalysisClient] ${line}`);
    try {
      switch (cmd.action) {
        case 'read': {
          const target = this._resolvePath(cmd.path);
          if (!fs.existsSync(target)) return `Error: file not found: ${target}`;
          if (fs.statSync(target).size > 500_000) return `Error: file too large: ${target}`;
          const content = fs.readFileSync(target, 'utf-8');
          const startLine = Number(cmd.startLine) || 1;
          const endLine = Number(cmd.endLine) || Number.MAX_SAFE_INTEGER;
          if (cmd.mode === 'compact' || cmd.mode === 'focused') {
            const lines = content.split('\n');
            const sliced = lines.slice(Math.max(0, startLine - 1), endLine);
            return sliced.map((l, i) => `${startLine + i}: ${l}`).join('\n');
          }
          return content;
        }
        case 'scan':
        case 'tree_sync': {
          const target = this._resolvePath(cmd.path || this.repoRoot);
          return this._listEntries(target, cmd.maxDepth || 4);
        }
        case 'write': {
          const target = this._resolvePath(cmd.path);
          if (cmd.backup && !fs.existsSync(target + cmd.backup)) {
            fs.copyFileSync(target, target + cmd.backup);
          }
          fs.writeFileSync(target, cmd.content || '', 'utf-8');
          return `Written ${target} (${(cmd.content || '').length} chars)`;
        }
        case 'delete': {
          const target = this._resolvePath(cmd.path);
          if (fs.existsSync(target)) fs.unlinkSync(target);
          return `Deleted ${target}`;
        }
        case 'restore_bak': {
          const from = this._resolvePath(cmd.from);
          const to = this._resolvePath(cmd.path);
          fs.copyFileSync(from, to);
          return `Restored ${from} -> ${to}`;
        }
        case 'delete_bak': {
          const target = this._resolvePath(cmd.path);
          if (fs.existsSync(target)) fs.unlinkSync(target);
          return `Deleted backup ${target}`;
        }
        case 'run': {
          return await this._runCommand(cmd);
        }
        case 'diff': {
          return '(diff not supported by monitor — backend should include diffs in fix_proposal)';
        }
        default:
          return `Unknown command: ${cmd.action}`;
      }
    } catch (e) {
      return `Error executing ${cmd.action}: ${e.message}`;
    }
  }

  _resolvePath(p) {
    if (!p) return this.repoRoot;
    if (path.isAbsolute(p)) return p;
    return path.join(this.repoRoot, p);
  }

  _listEntries(rootPath, maxDepth) {
    const SKIP = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.worktrees']);
    const result = [];
    const walk = (dir, depth) => {
      if (depth > maxDepth) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const ent of entries) {
        if (SKIP.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          result.push(`${path.relative(this.repoRoot, full)}/`);
          walk(full, depth + 1);
        } else {
          result.push(path.relative(this.repoRoot, full));
        }
      }
    };
    walk(rootPath, 0);
    return result.slice(0, 5000).join('\n');
  }

  _runCommand(cmd) {
    return new Promise(resolve => {
      const cwd = cmd.cwd ? this._resolvePath(cmd.cwd) : this.repoRoot;
      const args = Array.isArray(cmd.args) ? cmd.args : [];
      const ext = cmd.extension || '';
      const child = spawn(cmd.command, args, {
        cwd,
        env: { ...process.env, ...(cmd.env || {}) },
        shell: false
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      const timeoutMs = (cmd.timeout_seconds || 60) * 1000;
      const killer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs);
      child.on('close', code => {
        clearTimeout(killer);
        const tail = (s, n) => s.split('\n').slice(-n).join('\n');
        resolve(`exit_code=${code}\nstdout:\n${tail(stdout, cmd.tail_lines || 200)}\nstderr:\n${tail(stderr, 50)}`);
      });
      child.on('error', e => {
        clearTimeout(killer);
        resolve(`Error: ${e.message}`);
      });
    });
  }

  _extractTrailingState(text) {
    if (!text) return '';
    const match = text.match(/```json\s*(\{[\s\S]+?\})\s*```(?=[^`]*$)/);
    if (!match) return '';
    return match[1];
  }
}

export function buildMonitorPrompt({ issue, contextSha, headSha }) {
  return `[Monitor analysis request — autobot auto-healer]
Issue ID: ${issue.id}
Fingerprint: ${issue.fingerprint}
Trigger kind: ${issue.kind}
Exception class: ${issue.payload?.exceptionClass || 'unknown'}
Message: ${issue.payload?.message || 'n/a'}
Occurrences in last 10 min: ${issue.payload?.count || 0}
Last head SHA: ${headSha || 'unknown'}

This is a recurring defect in the autobot backend. Use __CMD__ to read source files under
java-backend/src/main/java/com/autobot/ as needed (read with mode=compact to save tokens).
Do NOT modify any files; I will apply the fix separately.

When you have a final answer, output exactly one \`\`\`json\`\`\` block at the end of your reply,
with this shape and nothing else inside the fence:

{
  "diagnosis": "<one-paragraph root cause>",
  "fix_needed": <true|false>,
  "fix_proposal": null | {
    "file_path": "<absolute or repo-relative path under java-backend/src/main/java/com/autobot/>",
    "unified_diff": "<a complete unified diff that applies cleanly with 'git apply' or 'patch -p1'>",
    "predicted_effect": "<one-paragraph what this changes>",
    "lines_added": <int>,
    "lines_deleted": <int>
  }
}

If fix_needed is false, set fix_proposal to null. Do not propose fixes that touch test files,
pom.xml, application.yml, or any controller or agent class.`;
}
