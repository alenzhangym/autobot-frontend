/**
 * P7-9: 前端代码文件指纹存储 (localStorage).
 *
 * 用于增量同步 — 仅对 mtime 或 md5 变化的文件重新跑 LSP.
 * 每个 workspaceId + languageId 一个独立条目 (PR8: 多语言混合项目按语言隔离):
 *   key: autobot.lsp.fp.<workspaceId>:<languageId>
 *   val: { "<relPath>": { mtime, md5, size }, ... }
 *
 * 容量: localStorage 5MB 足够存几千个文件指纹.
 */

const PREFIX = 'autobot.lsp.fp.';

export class LocalLspFingerprintStore {
  /**
   * @param {string} workspaceId  会话标识
   * @param {string} languageId   语言标识 (PR8: 多语言隔离, 避免 java/go/ts 互相污染 diff)
   */
  constructor(workspaceId, languageId = '') {
    if (!workspaceId) throw new Error('workspaceId required');
    this.workspaceId = workspaceId;
    this.languageId = languageId;
    // 兼容旧数据: 无 languageId 时退化为纯 workspaceId key (老调用方)
    this.key = languageId
      ? `${PREFIX}${workspaceId}:${languageId}`
      : `${PREFIX}${workspaceId}`;
  }

  /** 加载当前 workspace 全部指纹. 返 Map<relPath, {mtime, md5, size}>. */
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    } catch (_) {
      return new Map();
    }
  }

  /** 保存指纹 Map. */
  save(fpMap) {
    try {
      localStorage.setItem(this.key, JSON.stringify(Object.fromEntries(fpMap.entries())));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[FingerprintStore] save failed', e);
    }
  }

  /**
   * 比对当前文件列表与已存指纹, 返回增量分类.
   * @param {Array<{relPath, mtime, md5, size}>} currentFiles
   * @returns {{ added: string[], modified: string[], deleted: string[], unchanged: string[] }}
   */
  diff(currentFiles) {
    const old = this.load();
    const currentPaths = new Set(currentFiles.map(f => f.relPath));
    const added = [], modified = [], unchanged = [];
    for (const f of currentFiles) {
      const oldFp = old.get(f.relPath);
      if (!oldFp) {
        added.push(f.relPath);
      } else if (f.mtime === oldFp.mtime && f.size === oldFp.size) {
        // mtime + size 都没变 → 内容极大概率没变 (rsync 启发式)
        unchanged.push(f.relPath);
      } else if (f.md5 === oldFp.md5) {
        // mtime 变了但 md5 没变 (e.g. git checkout) → 跳过
        unchanged.push(f.relPath);
      } else {
        modified.push(f.relPath);
      }
    }
    const deleted = [];
    for (const p of old.keys()) {
      if (!currentPaths.has(p)) deleted.push(p);
    }
    return { added, modified, deleted, unchanged };
  }

  /** 更新单文件指纹 (解析完后调用). */
  update(file) {
    const m = this.load();
    m.set(file.relPath, { mtime: file.mtime, md5: file.md5, size: file.size });
    this.save(m);
  }

  /** 删除指纹 (文件被删时调用). */
  remove(relPath) {
    const m = this.load();
    if (m.delete(relPath)) this.save(m);
  }

  /** 清空整个 workspace 的指纹 (全量重建前调). */
  clear() {
    try { localStorage.removeItem(this.key); } catch (_) {}
  }
}
