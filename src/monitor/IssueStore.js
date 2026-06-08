import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * IssueStore is a simple append-only JSON file at frontend/data/monitor-issues.json.
 * Each issue has: id, fingerprint, kind, status, createdAt, updatedAt, plus the
 * SignalAggregator payload. Status transitions are atomic via read-modify-write
 * with a CAS guard (only succeed if current status matches expectedFrom).
 *
 * States: detected -> analyzing -> proposed -> applying -> (fixed | failed | needs_review | ignored)
 * - failed: 24h quiet period before re-analysis allowed
 * - ignored: never re-analyzed
 * - needs_review: human must Apply or Reject
 */

const STATES = {
  DETECTED: 'detected',
  ANALYZING: 'analyzing',
  PROPOSED: 'proposed',
  APPLYING: 'applying',
  FIXED: 'fixed',
  FAILED: 'failed',
  NEEDS_REVIEW: 'needs_review',
  IGNORED: 'ignored'
};

export { STATES };

export class IssueStore {
  constructor({ storePath, logger = console }) {
    this.storePath = storePath;
    this.logger = logger;
    this._cache = null;
    this._load();
  }

  _load() {
    if (this._cache) return this._cache;
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        this._cache = JSON.parse(raw);
      } else {
        this._cache = { issues: [] };
        const dir = path.dirname(this.storePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this._flush();
      }
    } catch (e) {
      this.logger.error?.(`[IssueStore] load failed: ${e.message}, starting fresh`);
      this._cache = { issues: [] };
    }
    return this._cache;
  }

  _flush() {
    const tmp = this.storePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this._cache, null, 2), 'utf-8');
    fs.renameSync(tmp, this.storePath);
  }

  list() {
    return this._cache.issues.slice();
  }

  get(id) {
    return this._cache.issues.find(i => i.id === id) || null;
  }

  findByFingerprint(fingerprint) {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const candidates = this._cache.issues.filter(i => i.fingerprint === fingerprint);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latest = candidates[0];
    if (latest.status === STATES.IGNORED) return { found: latest, blocked: 'ignored' };
    if (latest.status === STATES.FAILED) {
      const failedAt = new Date(latest.updatedAt).getTime();
      if (now - failedAt < twentyFourHours) return { found: latest, blocked: 'failed_recent' };
    }
    if ([STATES.ANALYZING, STATES.PROPOSED, STATES.APPLYING].includes(latest.status)) {
      return { found: latest, blocked: 'in_progress' };
    }
    return { found: latest, blocked: null };
  }

  create({ fingerprint, kind, payload }) {
    const id = `iss_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const issue = {
      id,
      fingerprint,
      kind,
      status: STATES.DETECTED,
      createdAt: now,
      updatedAt: now,
      payload,
      diagnosis: null,
      fixProposal: null,
      fixBranch: null,
      error: null,
      llmCost: 0
    };
    this._cache.issues.push(issue);
    this._flush();
    return issue;
  }

  transition(id, expectedFrom, to, patch = {}) {
    const issue = this.get(id);
    if (!issue) return { ok: false, reason: 'not_found' };
    if (issue.status !== expectedFrom) {
      return { ok: false, reason: 'state_mismatch', current: issue.status };
    }
    issue.status = to;
    issue.updatedAt = new Date().toISOString();
    Object.assign(issue, patch);
    this._flush();
    return { ok: true, issue };
  }

  update(id, patch) {
    const issue = this.get(id);
    if (!issue) return null;
    Object.assign(issue, patch);
    issue.updatedAt = new Date().toISOString();
    this._flush();
    return issue;
  }

  markAnalyzing(id) {
    return this.transition(id, STATES.DETECTED, STATES.ANALYZING);
  }

  markProposed(id, diagnosis, fixProposal) {
    const r = this.transition(id, STATES.ANALYZING, STATES.PROPOSED, { diagnosis });
    if (r.ok && fixProposal) {
      r.issue.fixProposal = fixProposal;
      this._flush();
    }
    return r;
  }

  markApplying(id) {
    return this.transition(id, STATES.PROPOSED, STATES.APPLYING);
  }

  markFixed(id, branchName) {
    return this.transition(id, STATES.APPLYING, STATES.FIXED, { fixBranch: branchName });
  }

  markFailed(id, error) {
    const issue = this.get(id);
    if (!issue) return { ok: false };
    if (issue.status === STATES.FIXED || issue.status === STATES.IGNORED) {
      return { ok: false, reason: 'terminal_state' };
    }
    issue.status = STATES.FAILED;
    issue.updatedAt = new Date().toISOString();
    issue.error = error;
    this._flush();
    return { ok: true, issue };
  }

  markNeedsReview(id, reason) {
    const issue = this.get(id);
    if (!issue) return { ok: false };
    issue.status = STATES.NEEDS_REVIEW;
    issue.updatedAt = new Date().toISOString();
    issue.error = reason;
    this._flush();
    return { ok: true, issue };
  }

  markIgnored(id) {
    const issue = this.get(id);
    if (!issue) return { ok: false };
    issue.status = STATES.IGNORED;
    issue.updatedAt = new Date().toISOString();
    this._flush();
    return { ok: true, issue };
  }

  resumeFromNeedsReview(id) {
    return this.transition(id, STATES.NEEDS_REVIEW, STATES.PROPOSED);
  }
}
