import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * LogTailer watches autobot backend log files and emits structured LogEvents.
 *
 * Signal sources (all under java-backend/logs/):
 *   - autobot-backend.log : [EXCEPTION] <class>: <msg>    (app errors)
 *                        : [REQUEST] <METHOD> <URI> - Time: <N>ms  (request latency)
 *   - llm_stream.log      : <model> <N>ms  (LLM latency)
 *   - code_agent.log      : Step failed: <reason>  (agent failures)
 */
export class LogTailer extends EventEmitter {
  constructor({ logsDir, onEvent, logger = console }) {
    super();
    this.logsDir = logsDir;
    this.onEvent = onEvent;
    this.logger = logger;
    this.offsets = new Map();
    this.watcher = null;
  }

  async start() {
    if (this.watcher) return;
    if (!fs.existsSync(this.logsDir)) {
      this.logger.warn?.(`[LogTailer] logs dir not found: ${this.logsDir}`);
      return;
    }

    const targets = [
      'autobot-backend.log',
      'llm_stream.log',
      'code_agent.log'
    ].map(f => path.join(this.logsDir, f));

    this.watcher = chokidar.watch(targets, {
      persistent: true,
      ignoreInitial: false,
      usePolling: true,
      interval: 500,
      awaitWriteFinish: false
    });

    this.watcher.on('add', filePath => this._onFileAdded(filePath));
    this.watcher.on('change', filePath => this._readNewLines(filePath));
    this.watcher.on('error', err => this.logger.error?.(`[LogTailer] watcher error: ${err.message}`));
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  _onFileAdded(filePath) {
    try {
      const stat = fs.statSync(filePath);
      this.offsets.set(filePath, stat.size);
    } catch (e) {
      this.offsets.set(filePath, 0);
    }
  }

  _readNewLines(filePath) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      return;
    }
    const prev = this.offsets.get(filePath) || 0;
    if (stat.size < prev) {
      this.offsets.set(filePath, 0);
      return this._readNewLines(filePath);
    }
    if (stat.size === prev) return;

    const stream = fs.createReadStream(filePath, {
      start: prev,
      end: stat.size,
      encoding: 'utf-8'
    });
    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk;
    });
    stream.on('end', () => {
      this.offsets.set(filePath, stat.size);
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const ev = this._parseLine(filePath, line);
        if (ev) {
          this.emit('event', ev);
          if (this.onEvent) this.onEvent(ev);
        }
      }
    });
  }

  _parseLine(filePath, line) {
    const ts = new Date().toISOString();
    const file = path.basename(filePath);

    if (file === 'autobot-backend.log') {
      const exMatch = line.match(/\[EXCEPTION\]\s+([\w$.]+(?:\.[\w$]+)+)\s*:\s*(.+?)(?:\s+at\s+|$)/);
      if (exMatch) {
        const stack = this._extractStack(filePath, line);
        return {
          kind: 'app_error',
          ts,
          source: file,
          class: exMatch[1],
          message: exMatch[2].trim(),
          raw: line,
          stack
        };
      }
      const reqMatch = line.match(/\[REQUEST\]\s+(\w+)\s+(\S+)\s+-\s+Time:\s+(\d+)ms/);
      if (reqMatch) {
        return {
          kind: 'request_latency',
          ts,
          source: file,
          method: reqMatch[1],
          uri: reqMatch[2],
          latencyMs: Number(reqMatch[3]),
          raw: line
        };
      }
    }

    if (file === 'llm_stream.log') {
      const m = line.match(/^(\S+)\s+(\d+)ms/);
      if (m) {
        return {
          kind: 'llm_latency',
          ts,
          source: file,
          model: m[1],
          latencyMs: Number(m[2]),
          raw: line
        };
      }
    }

    if (file === 'code_agent.log') {
      const m = line.match(/Step failed:\s*(.+)$/);
      if (m) {
        return {
          kind: 'agent_step_failure',
          ts,
          source: file,
          reason: m[1].trim(),
          raw: line
        };
      }
    }

    return null;
  }

  _extractStack(filePath, firstLine) {
    return [firstLine];
  }
}
