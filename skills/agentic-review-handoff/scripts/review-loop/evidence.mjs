/**
 * Frozen per-round evidence for Reviewer (tracked + untracked).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runtimeDir } from './repositories.mjs';

/**
 * Resolve review base SHA.
 * @param {string} repoRoot
 * @param {string|undefined} base
 */
export function resolveBaseSha(repoRoot, base) {
  if (base) {
    return execFileSync('git', ['rev-parse', base], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  }
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

/**
 * List changed paths between base and worktree (tracked) plus untracked files.
 * @param {string} repoRoot
 * @param {string} baseSha
 * @param {string[]|undefined} paths filter
 */
export function listChangedPaths(repoRoot, baseSha, paths) {
  const args = ['diff', '--name-only', baseSha, '--'];
  if (paths?.length) args.push(...paths);
  const tracked = execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const untrackedArgs = ['ls-files', '--others', '--exclude-standard'];
  if (paths?.length) untrackedArgs.push('--', ...paths);
  const untracked = execFileSync('git', untrackedArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return { tracked, untracked, all: [...new Set([...tracked, ...untracked])] };
}

/**
 * Count added/removed lines roughly for the 500-line guardrail.
 * @param {string} diffText
 */
export function countDiffLines(diffText) {
  let n = 0;
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) n += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) n += 1;
  }
  return n;
}

/**
 * Build frozen evidence file for a round.
 * Includes tracked `git diff <base>` plus untracked via `git diff --no-index /dev/null <file>`.
 *
 * @param {{
 *   repoRoot: string,
 *   packetId: string,
 *   baseSha: string,
 *   round: number,
 *   paths?: string[],
 * }} opts
 * @returns {{ evidencePath: string, diffText: string, lineCount: number, paths: string[], warning?: string }}
 */
export function freezeRoundEvidence(opts) {
  const { repoRoot, packetId, baseSha, round, paths } = opts;
  const { tracked, untracked, all } = listChangedPaths(repoRoot, baseSha, paths);

  const chunks = [];
  // Tracked changes vs base
  const trackedArgs = ['diff', baseSha, '--'];
  if (paths?.length) trackedArgs.push(...paths);
  else if (tracked.length) trackedArgs.push(...tracked);
  try {
    const trackedDiff = execFileSync('git', trackedArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    if (trackedDiff.trim()) chunks.push(trackedDiff.replace(/\s*$/, ''));
  } catch (err) {
    // git diff returns 0 even with changes; non-zero is real failure
    throw new Error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Untracked: git diff --no-index /dev/null file (exit 1 is expected when different)
  for (const file of untracked) {
    const abs = path.join(repoRoot, file);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
    try {
      execFileSync('git', ['diff', '--no-index', '--', '/dev/null', file], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      // identical to empty — skip
    } catch (err) {
      const out = /** @type {{ stdout?: string, status?: number }} */ (err);
      if (out?.stdout) {
        // Rewrite path headers to look like a new-file diff for the relative path
        chunks.push(String(out.stdout).replace(/\s*$/, ''));
      } else if (out?.status !== 1) {
        throw new Error(`untracked diff failed for ${file}: ${err}`);
      }
    }
  }

  const diffText = chunks.length ? `${chunks.join('\n\n')}\n` : '';
  const lineCount = countDiffLines(diffText);
  const evidenceDir = path.join(runtimeDir(repoRoot, packetId), 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `round-${round}.diff`);
  fs.writeFileSync(evidencePath, diffText, 'utf8');

  /** @type {{ evidencePath: string, diffText: string, lineCount: number, paths: string[], warning?: string }} */
  const result = {
    evidencePath,
    diffText,
    lineCount,
    paths: all,
  };
  if (lineCount > 500) {
    result.warning = `diff has ${lineCount} changed lines (>500). Consider splitting the review scope.`;
  }
  return result;
}
