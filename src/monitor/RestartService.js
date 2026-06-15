import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';

const BACKEND_BASE = process.env.BACKEND_BASE_URL || 'http://localhost:8000';

/**
 * Parse the port number out of BACKEND_BASE (e.g. http://localhost:8000 → 8000).
 * Falls back to 8000 if the URL is malformed.
 */
function backendPort() {
  try {
    const u = new URL(BACKEND_BASE);
    return u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return 8000;
  }
}

/**
 * Probe whether a TCP port is free by attempting to bind it. Returns when
 * the bind succeeds or when the deadline elapses. Used to detect OS-level
 * port release (TIME_WAIT) after a backend has stopped responding to HTTP.
 */
function waitForPortFree(port, maxMs = 5000, tickMs = 200, logger = null) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryOnce = () => {
      const tester = net.createServer();
      tester.once('error', () => {
        tester.removeAllListeners();
        if (Date.now() - start >= maxMs) {
          logger?.warn?.(`[RestartService] port ${port} still busy after ${maxMs}ms`);
          resolve(false);
        } else {
          setTimeout(tryOnce, tickMs);
        }
      });
      tester.once('listening', () => {
        tester.close(() => resolve(true));
      });
      try {
        tester.listen(port, '0.0.0.0');
      } catch {
        // listen() can throw synchronously on some platforms; treat as busy.
        if (Date.now() - start >= maxMs) resolve(false);
        else setTimeout(tryOnce, tickMs);
      }
    };
    tryOnce();
  });
}

/**
 * Declarative state machine for the backend restart flow.
 *
 * States: IDLE → SHUTTING_DOWN → WAITING → STARTING → DONE
 * Any state can transition to FAILED on error.
 *
 * Benefits over imperative chaining:
 *   - Every state transition is logged and observable
 *   - Callers can inspect current state (e.g. for UI progress)
 *   - Timeout/error boundaries are explicit per-phase
 *   - The flow is self-documenting
 */
const STATES = {
  IDLE:           'IDLE',
  SHUTTING_DOWN:  'SHUTTING_DOWN',
  WAITING:        'WAITING',
  STARTING:       'STARTING',
  DONE:           'DONE',
  FAILED:         'FAILED',
};

export class RestartService {
  constructor({ repoRoot, logger = console } = {}) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.state = STATES.IDLE;
  }

  transition(to) {
    const from = this.state;
    this.state = to;
    this.logger.log?.(`[RestartService] ${from} → ${to}`);
  }

  async shutdownBackend() {
    this.transition(STATES.SHUTTING_DOWN);
    try {
      const res = await axios.post(`${BACKEND_BASE}/api/admin/monitor/shutdown`, {}, {
        timeout: 10_000
      });
      return { ok: true, response: res.data };
    } catch (e) {
      if (e.response) {
        return { ok: true, response: e.response.data };
      }
      this.transition(STATES.FAILED);
      return { ok: false, error: e.message };
    }
  }

  async waitForBackendDown(maxMs = 8000) {
    this.transition(STATES.WAITING);
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        await axios.get(`${BACKEND_BASE}/api/admin/monitor/health`, { timeout: 1000 });
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        this.logger.log?.(`[RestartService] backend unreachable after ${Date.now() - start}ms`);
        return true;
      }
    }
    this.transition(STATES.FAILED);
    return false;
  }

  async startBackend() {
    this.transition(STATES.STARTING);
    const cwd = path.join(this.repoRoot, 'java-backend');
    if (!fs.existsSync(cwd)) {
      this.transition(STATES.FAILED);
      return { ok: false, error: `java-backend dir not found: ${cwd}` };
    }
    const logPath = path.join(cwd, 'logs', 'autobot-backend.log');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(logPath, 'a');
    const err = fs.openSync(logPath, 'a');
    const child = spawn('mvn', ['spring-boot:run', '-Dspring-boot.run.jvmArguments=-Xms256m -Xmx768m'], {
      cwd,
      detached: true,
      stdio: ['ignore', out, err],
      env: process.env
    });
    child.unref();
    this.logger.log?.(`[RestartService] mvn spring-boot:run spawned pid=${child.pid}`);
    this.transition(STATES.DONE);
    return { ok: true, pid: child.pid };
  }

  async restart() {
    if (this.state !== STATES.IDLE) {
      this.logger.warn?.(`[RestartService] restart called while state=${this.state} — resetting`);
      this.state = STATES.IDLE;
    }
    const sd = await this.shutdownBackend();
    if (!sd.ok) {
      return { ok: false, error: `shutdown failed: ${sd.error}` };
    }
    const down = await this.waitForBackendDown();
    if (!down) {
      return { ok: false, error: 'backend did not go down within timeout' };
    }
    // A2 fix: replace the hard-coded setTimeout(1500) with a port-bindable
    // probe. The HTTP server may have stopped responding (waitForBackendDown
    // returned true) but the OS may still be holding the port (TIME_WAIT or
    // zombie child). Wait up to 5s on a 200ms tick; on success the bind
    // closes immediately so the total wait is usually <200ms.
    const portFree = await waitForPortFree(backendPort(), 5000, 200, this.logger);
    if (!portFree) {
      return { ok: false, error: `backend port ${backendPort()} not released within 5s` };
    }
    return this.startBackend();
  }
}
