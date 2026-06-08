import path from 'path';

/**
 * FixGate runs safety checks on a proposed fix before it is applied.
 *
 * The fix_proposal is a { file_path, unified_diff, predicted_effect, lines_added, lines_deleted }
 * blob. FixGate returns { allow: true, reason? } or { allow: false, reason }.
 *
 * Safety rules:
 *   1. Exactly 1 file touched.
 *   2. File path under java-backend/src/main/java/com/autobot/
 *   3. File path is NOT a forbidden path (test files, controllers, agents, config).
 *   4. lines_added <= 20, lines_deleted <= 5.
 *   5. The diff hunks each match at least one allowed pattern regex.
 */

const ALLOWED_PATTERNS = [
  { name: 'requireNonNull', re: /Objects\.requireNonNull\s*\(/ },
  { name: 'nullGuard', re: /if\s*\([^)]*==\s*null[^)]*\)\s*(throw|return)/ },
  { name: 'tryCatch', re: /try\s*\{/ },
  { name: 'logReturn', re: /log\.(error|warn|info)\s*\(.*\);?\s*return/ },
  { name: 'illegalArg', re: /throw new IllegalArgumentException/ },
  { name: 'badRequest', re: /ResponseEntity\.(badRequest|notFound)\(/ },
  { name: 'httpStatus', re: /HttpStatus\.(BAD_REQUEST|NOT_FOUND|UNAUTHORIZED)/ }
];

const FORBIDDEN_PATHS = [
  /\/test\//,
  /Test\.java$/,
  /Tests\.java$/,
  /pom\.xml$/,
  /application\.yml$/,
  /application\.properties$/,
  /ChatController\.java$/,
  /AdminController\.java$/,
  /ErpAdminController\.java$/,
  /CodeAgent\.java$/,
  /CodeAnalysisAgent\.java$/,
  /RouterService\.java$/,
  /AgentEngine\.java$/,
  /LanguageAdapter\.java$/,
  /JavaLanguageAdapter\.java$/,
  /NodeLanguageAdapter\.java$/,
  /CommandSpec\.java$/,
  /ImplementationResult\.java$/
];

const MAX_ADDED = 20;
const MAX_DELETED = 5;

export class FixGate {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  check(fixProposal) {
    if (!fixProposal) {
      return { allow: false, reason: 'No fix_proposal provided' };
    }

    const { file_path, unified_diff, lines_added, lines_deleted } = fixProposal;

    if (!file_path || !unified_diff) {
      return { allow: false, reason: 'fix_proposal missing file_path or unified_diff' };
    }

    const added = Number(lines_added) || this._countAdded(unified_diff);
    const deleted = Number(lines_deleted) || this._countDeleted(unified_diff);
    if (added > MAX_ADDED) {
      return { allow: false, reason: `lines_added=${added} exceeds ${MAX_ADDED}` };
    }
    if (deleted > MAX_DELETED) {
      return { allow: false, reason: `lines_deleted=${deleted} exceeds ${MAX_DELETED}` };
    }

    const files = this._filesInDiff(unified_diff);
    if (files.length !== 1) {
      return { allow: false, reason: `expected exactly 1 file, got ${files.length}` };
    }

    const norm = file_path.replace(/\\/g, '/');
    if (!norm.includes('java-backend/src/main/java/com/autobot/')) {
      return { allow: false, reason: `file path is not under java-backend/src/main/java/com/autobot/: ${file_path}` };
    }

    for (const forbidden of FORBIDDEN_PATHS) {
      if (forbidden.test(norm)) {
        return { allow: false, reason: `forbidden path: ${file_path}` };
      }
    }

    const hunks = this._extractHunks(unified_diff);
    if (hunks.length === 0) {
      return { allow: false, reason: 'no hunks in diff' };
    }
    for (const hunk of hunks) {
      const match = this._hunkMatchesAllowed(hunk);
      if (!match) {
        return { allow: false, reason: `hunk does not match any allowed pattern: ${hunk.lines.find(l => l.startsWith('+') && !l.startsWith('+++'))?.slice(0, 80)}` };
      }
    }

    return { allow: true, added, deleted, file: file_path };
  }

  _countAdded(diff) {
    return diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  }

  _countDeleted(diff) {
    return diff.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length;
  }

  _filesInDiff(diff) {
    const files = [];
    const re = /^diff --git a\/(\S+) b\/(\S+)/gm;
    let m;
    while ((m = re.exec(diff)) !== null) {
      files.push(m[1]);
    }
    return files;
  }

  _extractHunks(diff) {
    const hunks = [];
    const lines = diff.split('\n');
    let current = null;
    for (const line of lines) {
      const h = line.match(/^@@\s+-(\d+),?(\d*) \+(\d+),?(\d*)\s+@@/);
      if (h) {
        if (current) hunks.push(current);
        current = { header: line, lines: [] };
      } else if (current && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        current.lines.push(line);
      }
    }
    if (current) hunks.push(current);
    return hunks;
  }

  _hunkMatchesAllowed(hunk) {
    const added = hunk.lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    for (const pat of ALLOWED_PATTERNS) {
      if (pat.re.test(added)) return pat.name;
    }
    return null;
  }
}
