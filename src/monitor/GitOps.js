import { simpleGit } from 'simple-git';
import path from 'path';

/**
 * GitOps wraps simple-git for the monitor's branch + commit operations.
 * The monitor commits fixes to auto/fix-<issueId>-<timestamp> branches
 * without ever touching the user's main branch.
 */

export class GitOps {
  constructor({ repoRoot, logger = console }) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.git = simpleGit({ baseDir: repoRoot });
  }

  async status() {
    return this.git.status();
  }

  async currentBranch() {
    const s = await this.git.status();
    return s.current;
  }

  async headSha() {
    return this.git.revparse(['HEAD']);
  }

  async isClean() {
    const s = await this.git.status();
    return s.isClean();
  }

  async createFixBranch(issueId) {
    const ts = Date.now();
    const branch = `auto/fix-${issueId}-${ts}`;
    await this.git.checkoutLocalBranch(branch);
    this.logger.log?.(`[GitOps] created branch ${branch}`);
    return branch;
  }

  async commit(filePath, message) {
    await this.git.add(filePath);
    await this.git.commit(message);
    const sha = await this.git.revparse(['HEAD']);
    this.logger.log?.(`[GitOps] committed ${filePath} -> ${sha}`);
    return sha;
  }

  async checkout(branch) {
    await this.git.checkout(branch);
  }
}
