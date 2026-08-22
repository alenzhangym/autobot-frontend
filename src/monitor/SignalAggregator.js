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
    // 完整版 B ReAct 续接裁决计数器 (供监控大盘展示)
    this.reactCounters = { appends: 0, compensated: 0, compensationFailed: 0 };
    this.reactAppendSamples = [];
  }

  /** 返回 ReAct 续接计数 (接入 MonitorService.getStatus / 监控大盘). */
  getReactCounters() {
    return { ...this.reactCounters };
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
    } else if (ev.kind === 'react_compensation_failed') {
      this._trackReactCompensationFailed(ev);
    } else if (ev.kind === 'react_compensated') {
      this.reactCounters.compensated += 1;
    } else if (ev.kind === 'react_decide_next_append') {
      this._trackReactAppend(ev);
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

  /**
   * 完整版 B: 补偿失败 (回滚缺口) → 立即触发 issue (门槛=1), 按 action 去重.
   * 一旦出现即代表追加写步骤失败且补偿也失败, 必须第一时间呈现到监控大盘.
   */
  _trackReactCompensationFailed(ev) {
    this.reactCounters.compensationFailed += 1;
    const fp = `react_rollback_gap:${ev.action}`;
    if (this.activeIssue.has(fp)) return;
    this.activeIssue.set(fp, { firstSeen: Date.now(), lastEv: ev });
    this.emit('trigger', {
      kind: 'react_compensation_failed',
      fingerprint: fp,
      count: 1,
      windowMs: this.windowMs,
      exceptionClass: ev.class,
      action: ev.action,
      undoAction: ev.undoAction,
      message: ev.message,
      rawEvents: [ev],
      lastEvent: ev
    });
  }

  /**
   * 完整版 B: 续接裁决追加命中 → 累计计数; 高频追加 (>=5 次/窗口) 提示提示词过激.
   * 正常续接仅计数, 不轻易打扰.
   */
  _trackReactAppend(ev) {
    this.reactCounters.appends += 1;
    const cutoff = Date.now() - this.windowMs;
    this.reactAppendSamples = this.reactAppendSamples.filter(x => x.ts >= cutoff);
    this.reactAppendSamples.push({ ts: Date.now(), ev });
    if (this.reactAppendSamples.length < 5) return;
    const fp = 'react_decide_next_append_high_frequency';
    if (this.activeIssue.has(fp)) return;
    this.activeIssue.set(fp, { firstSeen: Date.now() });
    this.emit('trigger', {
      kind: 'react_decide_next_append',
      fingerprint: fp,
      count: this.reactAppendSamples.length,
      windowMs: this.windowMs,
      exceptionClass: 'ReactDecideNextAppendHigh',
      message: `${this.reactAppendSamples.length} 次 ReAct 续接追加在窗口内 — 可能提示词过激, 需收敛`,
      lastEvent: ev
    });
  }

  releaseActive(fingerprint) {
    this.activeIssue.delete(fingerprint);
  }
}
