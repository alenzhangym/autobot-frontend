import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const BACKEND_BASE = process.env.BACKEND_BASE_URL || 'http://localhost:8000';

/**
 * RestartService handles the optional backend restart after a successful fix.
 *
 * Flow:
 *   1. POST /api/admin/monitor/shutdown (backend calls Spring's graceful close)
 *   2. Poll /api/admin/monitor/health until unreachable (5s max)
 *   3. Spawn `mvn spring-boot:run` detached, return immediately
 *
 * The user must opt in via a UI toggle. RestartService never auto-decides.
 */

export class RestartService {
  constructor({ repoRoot, logger = console } = {}) {
    this.repoRoot = repoRoot;
    this.logger = logger;
  }

  async shutdownBackend() {
    try {
      const res = await axios.post(`${BACKEND_BASE}/api/admin/monitor/shutdown`, {}, {
        timeout: 10_000
      });
      return { ok: true, response: res.data };
    } catch (e) {
      if (e.response) {
        return { ok: true, response: e.response.data };
      }
      return { ok: false, error: e.message };
    }
  }

  async waitForBackendDown(maxMs = 8000) {
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
    return false;
  }

  async startBackend() {
    const cwd = path.join(this.repoRoot, 'java-backend');
    if (!fs.existsSync(cwd)) {
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
    return { ok: true, pid: child.pid };
  }

  async restart() {
    const sd = await this.shutdownBackend();
    if (!sd.ok) {
      return { ok: false, error: `shutdown failed: ${sd.error}` };
    }
    await this.waitForBackendDown();
    await new Promise(r => setTimeout(r, 1500));
    const sb = await this.startBackend();
    return sb;
  }
}
