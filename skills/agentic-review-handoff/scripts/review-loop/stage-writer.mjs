/**
 * Claim-free atomic stage writer for auto loop.
 * Invariants: EOF append only, frontmatter sync, pre-write content hash check.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  appendStageAtEof,
  archivePacket,
  readPacketMeta,
  runtimeDir,
  writeJson,
  readJson,
} from './repositories.mjs';

/**
 * @param {string} text
 */
export function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Top-level H1 titles outside fenced code blocks.
 * @param {string} markdown
 * @returns {string[]}
 */
export function listTopLevelH1Titles(markdown) {
  /** @type {string[]} */
  const titles = [];
  let inFence = false;
  for (const raw of String(markdown).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^# [^#\n]/.test(line)) {
      titles.push(line.replace(/^#\s+/, '').trim());
    }
  }
  return titles;
}

/**
 * @param {string} repoRoot
 * @param {string} packetId
 */
export function runStatePath(repoRoot, packetId) {
  return path.join(runtimeDir(repoRoot, packetId), 'auto-run-state.json');
}

/**
 * @param {string} repoRoot
 * @param {string} packetId
 */
export function loadRunState(repoRoot, packetId) {
  return readJson(runStatePath(repoRoot, packetId), null);
}

/**
 * @param {string} repoRoot
 * @param {string} packetId
 * @param {Record<string, unknown>} state
 */
export function saveRunState(repoRoot, packetId, state) {
  writeJson(runStatePath(repoRoot, packetId), state);
}

/**
 * Append a stage without claim. Refuses if packet hash diverged since last write.
 *
 * @param {{
 *   repoRoot: string,
 *   packetPath: string,
 *   packetId: string,
 *   sectionMarkdown: string,
 *   lastAnchor: string,
 *   lifecycleState: string,
 *   extra?: Record<string,string>,
 *   expectedHash?: string|null,
 * }} opts
 */
export function appendStageAuto(opts) {
  const {
    repoRoot,
    packetPath: rawPacketPath,
    packetId,
    sectionMarkdown,
    lastAnchor,
    lifecycleState,
    extra,
    expectedHash,
  } = opts;

  // Always resolve absolute so archive path marker matching works.
  const packetPath = path.isAbsolute(rawPacketPath)
    ? rawPacketPath
    : path.resolve(repoRoot || process.cwd(), rawPacketPath);

  const current = fs.readFileSync(packetPath, 'utf8');
  const currentHash = contentHash(current);
  const state = loadRunState(repoRoot, packetId) ?? {};
  const guard = expectedHash ?? state.packetHash ?? null;

  if (guard && guard !== currentHash) {
    const err = new Error(
      'PACKET_HASH_MISMATCH: packet was modified outside auto loop; refuse append and stop',
    );
    // @ts-expect-error augment
    err.code = 'PACKET_HASH_MISMATCH';
    // @ts-expect-error augment
    err.expectedHash = guard;
    // @ts-expect-error augment
    err.actualHash = currentHash;
    throw err;
  }

  // F2/N1: fence-aware H1 scan (do not treat `#` inside ``` fences as H1)
  const h1s = listTopLevelH1Titles(sectionMarkdown);
  if (!h1s.length) {
    throw new Error('stage section missing H1');
  }
  // free-form prose between H1s must not inject additional unexpected anchors for single-stage writes
  // (Review Findings + Fix Handoff is the only intentional multi-H1 group)
  const allowedMulti = lastAnchor === 'fix_handoff' && h1s.length === 2;
  if (h1s.length > 1 && !allowedMulti) {
    throw new Error(
      `stage section has ${h1s.length} H1s; only fix_handoff group may include Review Findings + Fix Handoff`,
    );
  }

  const meta = appendStageAtEof(packetPath, {
    sectionMarkdown,
    lastAnchor,
    lifecycleState,
    extra,
    preserveFrontmatter: false,
  });

  // Post-write: last physical H1 must match requested lastAnchor
  const after = readPacketMeta(packetPath);
  if (after.lastAnchor !== lastAnchor) {
    throw new Error(
      `post-write last_anchor mismatch: expected ${lastAnchor}, got ${after.lastAnchor}`,
    );
  }

  let finalPath = packetPath;
  if (lifecycleState === 'archived') {
    finalPath = archivePacket(packetPath);
  }

  const afterText = fs.readFileSync(finalPath, 'utf8');
  const afterHash = contentHash(afterText);
  saveRunState(repoRoot, packetId, {
    ...state,
    packetHash: afterHash,
    packetPath: finalPath,
    lastAnchor: meta.lastAnchor,
    lifecycleState: lifecycleState === 'archived' ? 'archived' : meta.lifecycleState,
    updated: new Date().toISOString(),
  });

  return {
    ok: true,
    packetPath: finalPath,
    meta: readPacketMeta(finalPath),
    packetHash: afterHash,
  };
}

/**
 * Seed hash after packet create / before first write.
 */
export function seedPacketHash(repoRoot, packetId, packetPath) {
  const text = fs.readFileSync(packetPath, 'utf8');
  const hash = contentHash(text);
  const prev = loadRunState(repoRoot, packetId) ?? {};
  saveRunState(repoRoot, packetId, {
    ...prev,
    packetHash: hash,
    packetPath,
    updated: new Date().toISOString(),
  });
  return hash;
}
