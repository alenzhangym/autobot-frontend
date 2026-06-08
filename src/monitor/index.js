import path from 'path';
import fs from 'fs';
import { MonitorService } from './MonitorService.js';

/**
 * Start the autobot-monitor and return a service handle that exposes
 * - service: MonitorService instance
 * - router: an Express router with /api/monitor/* endpoints
 *
 * The caller (frontend/server.js) is responsible for mounting the router
 * and starting the service.
 */

export async function startMonitor({ repoRoot, storePath, autoRestart = false, logger = console } = {}) {
  const logsDir = path.join(repoRoot, 'java-backend', 'logs');
  if (!fs.existsSync(path.dirname(storePath))) {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
  }
  const service = new MonitorService({
    repoRoot,
    logsDir,
    storePath,
    autoRestart,
    logger
  });
  await service.start();
  return service;
}

export { MonitorService } from './MonitorService.js';
export { IssueStore, STATES } from './IssueStore.js';
