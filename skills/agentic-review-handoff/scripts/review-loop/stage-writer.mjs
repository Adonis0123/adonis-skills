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

  const meta = appendStageAtEof(packetPath, {
    sectionMarkdown,
    lastAnchor,
    lifecycleState,
    extra,
    preserveFrontmatter: false,
  });

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
