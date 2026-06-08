import crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * SignalAggregator counts LogEvents in a 10-minute rolling window.
 *
 * For app_error events:
 *   fingerprint = sha1(exceptionClass + normalizedMessage)
 *
 * Triggers are emitted when:
 *   - 2+ occurrences of the same fingerprint within the window
 *   - LLM p95 latency exceeds 30s (3 consecutive samples)
 *   - Request p95 latency exceeds 10s (3 consecutive samples)
 *   - 3+ agent_step_failure events within the window
 */
export class SignalAggregator extends EventEmitter {
  constructor({ windowMs = 10 * 60 * 1000, appErrorThreshold = 2, logger = console } = {}) {
    super();
    this.windowMs = windowMs;
    this.appErrorThreshold = appErrorThreshold;
    this.logger = logger;
    this.fingerprints = new Map();
    this.llmSamples = [];
    this.requestSamples = [];
    this.agentFailures = [];
    this.activeIssue = new Map();
  }

  onEvent(ev) {
    if (!ev) return;
    if (ev.kind === 'app_error') {
      this._trackAppError(ev);
    } else if (ev.kind === 'llm_latency') {
      this._trackLlmLatency(ev);
    } else if (ev.kind === 'request_latency') {
      this._trackRequestLatency(ev);
    } else if (ev.kind === 'agent_step_failure') {
      this._trackAgentFailure(ev);
    }
  }

  fingerprintFor(ev) {
    const norm = ev.message
      .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
      .replace(/\b\d{4,}\b/g, '<num>')
      .replace(/\b[0-9a-f-]{36}\b/gi, '<uuid>')
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>');
    const raw = `${ev.class}|${norm}`;
    return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
  }

  _trackAppError(ev) {
    const fp = this.fingerprintFor(ev);
    if (this.activeIssue.has(fp)) {
      return;
    }
    const now = Date.now();
    const arr = this.fingerprints.get(fp) || [];
    arr.push({ ts: now, ev });
    this.fingerprints.set(fp, arr);
    this._prune(arr, now);
    if (arr.length >= this.appErrorThreshold) {
      this.activeIssue.set(fp, { firstSeen: arr[0].ts, lastEv: ev });
      this.emit('trigger', {
        kind: 'app_error',
        fingerprint: fp,
        count: arr.length,
        windowMs: this.windowMs,
        exceptionClass: ev.class,
        message: ev.message,
        rawEvents: arr.map(x => x.ev),
        lastEvent: ev
      });
    }
  }

  _trackLlmLatency(ev) {
    this.llmSamples.push({ ts: ev.ts, latencyMs: ev.latencyMs });
    this._prune(this.llmSamples.map(x => ({ ts: new Date(x.ts).getTime() })), Date.now());
    this.llmSamples = this.llmSamples.slice(-100);
    if (this.llmSamples.length >= 3) {
      const recent = this.llmSamples.slice(-3);
      if (recent.every(s => s.latencyMs > 30000)) {
        const fp = 'llm_latency_p95';
        if (!this.activeIssue.has(fp)) {
          this.activeIssue.set(fp, { firstSeen: Date.now() });
          this.emit('trigger', {
            kind: 'llm_latency',
            fingerprint: fp,
            count: recent.length,
            windowMs: this.windowMs,
            samples: recent,
            message: `LLM p95 >30s for ${recent.length} consecutive calls`,
            exceptionClass: 'LLMLatencyHigh',
            lastEvent: ev
          });
        }
      }
    }
  }

  _trackRequestLatency(ev) {
    this.requestSamples.push({ ts: ev.ts, latencyMs: ev.latencyMs, uri: ev.uri, method: ev.method });
    this.requestSamples = this.requestSamples.slice(-200);
    if (this.requestSamples.length >= 3) {
      const recent = this.requestSamples.slice(-3);
      if (recent.every(s => s.latencyMs > 10000)) {
        const fp = `request_latency:${ev.method}:${ev.uri}`;
        if (!this.activeIssue.has(fp)) {
          this.activeIssue.set(fp, { firstSeen: Date.now() });
          this.emit('trigger', {
            kind: 'request_latency',
            fingerprint: fp,
            count: recent.length,
            windowMs: this.windowMs,
            samples: recent,
            message: `Request p95 >10s for ${recent.length} consecutive calls: ${ev.method} ${ev.uri}`,
            exceptionClass: 'RequestLatencyHigh',
            lastEvent: ev
          });
        }
      }
    }
  }

  _trackAgentFailure(ev) {
    this.agentFailures.push({ ts: ev.ts, reason: ev.reason });
    const cutoff = Date.now() - this.windowMs;
    this.agentFailures = this.agentFailures.filter(x => new Date(x.ts).getTime() >= cutoff);
    if (this.agentFailures.length >= 3) {
      const fp = 'agent_step_failures';
      if (!this.activeIssue.has(fp)) {
        this.activeIssue.set(fp, { firstSeen: Date.now() });
        this.emit('trigger', {
          kind: 'agent_failures',
          fingerprint: fp,
          count: this.agentFailures.length,
          windowMs: this.windowMs,
          message: `${this.agentFailures.length} agent step failures in the last ${Math.round(this.windowMs / 60000)} min`,
          exceptionClass: 'AgentStepFailures',
          lastEvent: ev
        });
      }
    }
  }

  _prune(arr, now) {
    const cutoff = now - this.windowMs;
    while (arr.length && arr[0].ts < cutoff) {
      arr.shift();
    }
  }

  releaseActive(fingerprint) {
    this.activeIssue.delete(fingerprint);
  }
}
