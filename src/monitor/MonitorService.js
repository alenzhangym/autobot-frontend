import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { LogTailer } from './LogTailer.js';
import { SignalAggregator } from './SignalAggregator.js';
import { IssueStore, STATES } from './IssueStore.js';
import { AnalysisClient, buildMonitorPrompt } from './AnalysisClient.js';
import { FixGate } from './FixGate.js';
import { GitOps } from './GitOps.js';
import { RestartService } from './RestartService.js';

/**
 * MonitorService is the orchestrator. It wires LogTailer -> SignalAggregator
 * -> IssueStore -> AnalysisClient -> FixGate -> GitOps -> (optional) RestartService.
 *
 * On every trigger:
 *   1. IssueStore.findByFingerprint() to skip ignored/recently-failed
 *   2. IssueStore.create() if no recent issue
 *   3. IssueStore.markAnalyzing()
 *   4. AnalysisClient.runAnalysis() (round-driven)
 *   5. IssueStore.markProposed() with diagnosis + fix_proposal
 *   6. FixGate.check()
 *   7. If allow: apply via AnalysisClient (write+run), commit, markFixed
 *      If reject: markNeedsReview() and emit 'review-requested' for UI
 *   8. If auto-restart enabled and markFixed: RestartService.restart()
 */

export class MonitorService extends EventEmitter {
  constructor({ repoRoot, logsDir, storePath, autoRestart = false, logger = console } = {}) {
    super();
    this.repoRoot = repoRoot;
    this.logsDir = logsDir;
    this.storePath = storePath;
    this.autoRestart = autoRestart;
    this.logger = logger;

    this.tailer = new LogTailer({ logsDir, logger });
    this.aggregator = new SignalAggregator({ logger });
    this.store = new IssueStore({ storePath, logger });
    this.fixGate = new FixGate({ logger });
    this.gitOps = new GitOps({ repoRoot, logger });
    this.restarter = new RestartService({ repoRoot, logger });
    this.running = false;

    this.aggregator.on('trigger', t => this._onTrigger(t));
    this.tailer.on('event', e => this.aggregator.onEvent(e));
  }

  async start() {
    if (this.running) return;
    await this.tailer.start();
    this.running = true;
    this.logger.log?.('[MonitorService] started');
  }

  async stop() {
    if (!this.running) return;
    await this.tailer.stop();
    this.running = false;
    this.logger.log?.('[MonitorService] stopped');
  }

  /**
   * Hot-swap the project root and log directory.
   * Stops the tailer, swaps in the new paths, and re-starts.
   * IssueStore is preserved (it doesn't care about the path).
   */
  async setRepoRoot(newRepoRoot, newLogsDir = null) {
    if (!newRepoRoot) throw new Error('repoRoot is required');
    this.logger.log?.(`[MonitorService] hot-swap: repoRoot ${this.repoRoot} -> ${newRepoRoot}`);
    await this.tailer.stop();
    this.repoRoot = newRepoRoot;
    this.logsDir = newLogsDir || path.join(newRepoRoot, 'java-backend', 'logs');
    this.tailer = new LogTailer({ logsDir: this.logsDir, logger: this.logger });
    this.tailer.on('event', e => this.aggregator.onEvent(e));
    this.gitOps = new GitOps({ repoRoot: this.repoRoot, logger: this.logger });
    this.restarter = new RestartService({ repoRoot: this.repoRoot, logger: this.logger });
    await this.tailer.start();
    this.logger.log?.(`[MonitorService] reattached to logs=${this.logsDir}`);
  }

  getStatus() {
    return {
      repoRoot: this.repoRoot,
      logsDir: this.logsDir,
      storePath: this.storePath,
      autoRestart: this.autoRestart,
      running: this.running,
      reactCounters: this.aggregator.getReactCounters()
    };
  }

  setAutoRestart(enabled) {
    this.autoRestart = !!enabled;
    this.logger.log?.(`[MonitorService] autoRestart=${this.autoRestart}`);
  }

  async _onTrigger(trigger) {
    const { fingerprint, kind } = trigger;
    const fpCheck = this.store.findByFingerprint(fingerprint);
    if (fpCheck?.blocked) {
      this.logger.log?.(`[MonitorService] trigger suppressed (${fpCheck.blocked}) for fp=${fingerprint}`);
      this.aggregator.releaseActive(fingerprint);
      return;
    }
    let issue;
    if (fpCheck?.found && [STATES.DETECTED, STATES.PROPOSED, STATES.NEEDS_REVIEW].includes(fpCheck.found.status)) {
      issue = fpCheck.found;
    } else {
      issue = this.store.create({ fingerprint, kind, payload: trigger });
      this.logger.log?.(`[MonitorService] created issue ${issue.id} for fp=${fingerprint} (${kind})`);
      this.emit('issue-created', issue);
    }
    this._processIssue(issue).catch(e => {
      this.logger.error?.(`[MonitorService] issue ${issue.id} processing failed: ${e.message}`);
      this.store.markFailed(issue.id, e.message);
      this.emit('issue-failed', { issue, error: e.message });
    }).finally(() => {
      this.aggregator.releaseActive(fingerprint);
    });
  }

  async _processIssue(issue) {
    const tr = this.store.markAnalyzing(issue.id);
    if (!tr.ok) {
      this.logger.log?.(`[MonitorService] cannot mark analyzing for ${issue.id}: ${tr.reason}`);
      return;
    }
    this.emit('issue-analyzing', issue);

    let headSha = 'unknown';
    try { headSha = await this.gitOps.headSha(); } catch (e) {}

    const client = new AnalysisClient({
      repoRoot: this.repoRoot,
      sessionId: `monitor-${issue.id}`,
      logger: this.logger
    });
    const prompt = buildMonitorPrompt({ issue, headSha });
    const result = await client.runAnalysis({ issue, contextMessage: prompt });

    this.logger.log?.(`[MonitorService] issue ${issue.id} analysis done. finalJson=${result.finalJson ? 'present' : 'absent'}`);

    if (!result.finalJson) {
      this.store.markFailed(issue.id, 'Agent did not return a JSON block in its final response');
      this.emit('issue-failed', { issue, error: 'no JSON block' });
      return;
    }

    const { diagnosis, fix_needed, fix_proposal } = result.finalJson;
    this.store.update(issue.id, { diagnosis, fixProposal: fix_needed ? fix_proposal : null });
    const pr = this.store.transition(issue.id, STATES.ANALYZING, STATES.PROPOSED);
    if (!pr.ok) {
      this.logger.log?.(`[MonitorService] cannot mark proposed for ${issue.id}: ${pr.reason}`);
      return;
    }

    if (!fix_needed || !fix_proposal) {
      this.logger.log?.(`[MonitorService] issue ${issue.id}: no fix needed (${diagnosis?.slice(0, 80)}...)`);
      this.emit('issue-diagnosed', { issue, diagnosis, fixNeeded: false });
      return;
    }

    const gate = this.fixGate.check(fix_proposal);
    if (!gate.allow) {
      this.logger.log?.(`[MonitorService] issue ${issue.id}: FixGate rejected: ${gate.reason}`);
      this.store.markNeedsReview(issue.id, gate.reason);
      this.emit('review-requested', { issue, fixProposal: fix_proposal, diagnosis, reason: gate.reason });
      return;
    }

    this.logger.log?.(`[MonitorService] issue ${issue.id}: FixGate allowed (${gate.added}+/${gate.deleted}-). Applying.`);
    const ar = this.store.markApplying(issue.id);
    if (!ar.ok) {
      this.logger.log?.(`[MonitorService] cannot mark applying for ${issue.id}: ${ar.reason}`);
      return;
    }
    this.emit('issue-applying', issue);

    try {
      await this._applyFix(fix_proposal, issue);
      const branchName = await this._commitFix(fix_proposal, issue);
      this.store.markFixed(issue.id, branchName);
      this.emit('issue-fixed', { issue, branch: branchName });
      if (this.autoRestart) {
        this.logger.log?.(`[MonitorService] auto-restart enabled. Restarting backend...`);
        const rr = await this.restarter.restart();
        this.emit('backend-restarted', { issue, result: rr });
      } else {
        this.logger.log?.(`[MonitorService] auto-restart disabled. User can restart manually: cd java-backend && mvn spring-boot:run`);
      }
    } catch (e) {
      this.logger.error?.(`[MonitorService] apply/commit failed: ${e.message}`);
      await this._restoreFromBackup(fix_proposal).catch(() => {});
      this.store.markFailed(issue.id, e.message);
      this.emit('issue-failed', { issue, error: e.message });
    }
  }

  async _applyFix(fix_proposal, issue) {
    const client = new AnalysisClient({ repoRoot: this.repoRoot, sessionId: `monitor-${issue.id}-apply`, logger: this.logger });
    const filePath = this._absPath(fix_proposal.file_path);
    const bak = filePath + '.monitor-' + issue.id + '.bak';
    const writeCmd = {
      id: 'write-fix',
      action: 'write',
      path: fix_proposal.file_path,
      content: this._applyUnifiedDiff(fix_proposal.file_path, fix_proposal.unified_diff),
      backup: '.monitor-' + issue.id + '.bak'
    };
    const writeRes = await client._executeCommand(writeCmd);
    if (writeRes.startsWith('Error')) throw new Error(`write failed: ${writeRes}`);

    const compileRes = await client._executeCommand({
      id: 'compile',
      action: 'run',
      command: 'mvn',
      args: ['compile', '-q', '-DskipTests'],
      cwd: 'java-backend',
      timeout_seconds: 300,
      tail_lines: 50
    });
    if (!this._isCompileOk(compileRes)) {
      throw new Error(`mvn compile failed:\n${compileRes}`);
    }
  }

  async _commitFix(fix_proposal, issue) {
    const branch = await this.gitOps.createFixBranch(issue.id);
    const filePath = this._absPath(fix_proposal.file_path);
    const rel = path.relative(this.repoRoot, filePath);
    const msg = `auto/fix(${issue.id}): ${issue.payload?.exceptionClass || 'exception'} at ${issue.payload?.lastEvent?.uri || 'unknown'}`;
    await this.gitOps.commit(rel, msg);
    return branch;
  }

  async _restoreFromBackup(fix_proposal) {
    const filePath = this._absPath(fix_proposal.file_path);
    const candidates = fs.readdirSync(path.dirname(filePath)).filter(f => f.startsWith(path.basename(filePath) + '.monitor-'));
    for (const c of candidates) {
      fs.copyFileSync(path.join(path.dirname(filePath), c), filePath);
      fs.unlinkSync(path.join(path.dirname(filePath), c));
    }
  }

  _absPath(p) {
    if (path.isAbsolute(p)) return p;
    return path.join(this.repoRoot, p);
  }

  _isCompileOk(output) {
    return /BUILD SUCCESS/.test(output) || /exit_code=0/.test(output);
  }

  _applyUnifiedDiff(filePath, diff) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`file not found: ${filePath}`);
    }
    const original = fs.readFileSync(filePath, 'utf-8');
    const origLines = original.split('\n');
    const hunks = this._parseHunks(diff);
    if (hunks.length === 0) throw new Error('no hunks in diff');

    const out = [];
    let cursor = 0;
    for (const h of hunks) {
      if (h.oldStart - 1 > cursor) {
        out.push(...origLines.slice(cursor, h.oldStart - 1));
      }
      cursor = h.oldStart - 1;
      for (const line of h.lines) {
        if (line.startsWith('+')) {
          out.push(line.slice(1));
        } else if (line.startsWith('-')) {
          cursor++;
        } else if (line.startsWith(' ')) {
          if (origLines[cursor] !== line.slice(1)) {
            throw new Error(`context mismatch at line ${cursor + 1}: expected "${origLines[cursor]}", got "${line.slice(1)}"`);
          }
          out.push(line.slice(1));
          cursor++;
        }
      }
    }
    if (cursor < origLines.length) out.push(...origLines.slice(cursor));
    return out.join('\n');
  }

  _parseHunks(diff) {
    const lines = diff.split('\n');
    const hunks = [];
    let current = null;
    for (const line of lines) {
      const m = line.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
      if (m) {
        if (current) hunks.push(current);
        current = {
          oldStart: Number(m[1]),
          oldCount: Number(m[2] || 1),
          newStart: Number(m[3]),
          newCount: Number(m[4] || 1),
          lines: []
        };
      } else if (current && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        current.lines.push(line);
      }
    }
    if (current) hunks.push(current);
    return hunks;
  }

  // Public API for /api/monitor/* endpoints
  getIssues() { return this.store.list(); }
  getIssue(id) { return this.store.get(id); }
  ignoreIssue(id) { return this.store.markIgnored(id); }
  retryIssue(id) {
    const issue = this.store.get(id);
    if (!issue) return null;
    if (issue.status === STATES.FAILED || issue.status === STATES.NEEDS_REVIEW) {
      issue.status = STATES.DETECTED;
      issue.updatedAt = new Date().toISOString();
      this.store._flush();
      setImmediate(() => this._processIssue(issue).catch(e => this.logger.error?.(e.message)));
      return issue;
    }
    return null;
  }
  async applyReview(id) {
    const issue = this.store.get(id);
    if (!issue || issue.status !== STATES.NEEDS_REVIEW || !issue.fixProposal) return null;
    const rr = this.store.resumeFromNeedsReview(id);
    if (!rr.ok) return null;
    try {
      await this._applyFix(issue.fixProposal, issue);
      const branch = await this._commitFix(issue.fixProposal, issue);
      this.store.markFixed(issue.id, branch);
      this.emit('issue-fixed', { issue, branch });
      if (this.autoRestart) {
        await this.restarter.restart();
      }
      return this.store.get(id);
    } catch (e) {
      await this._restoreFromBackup(issue.fixProposal).catch(() => {});
      this.store.markFailed(issue.id, e.message);
      return this.store.get(id);
    }
  }
  rejectReview(id) {
    return this.store.markFailed(id, 'Rejected by user');
  }
}
