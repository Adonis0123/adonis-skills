/**
 * T5: four automated negative paths for auto loop.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cmdRun, cmdAppendFixCompletion } from '../review-loop/auto-run.mjs';
import { saveRunState, loadRunState } from '../review-loop/stage-writer.mjs';
import * as repo from '../review-loop/repositories.mjs';

const cleanup = [];
afterEach(() => {
  while (cleanup.length) {
    const p = cleanup.pop();
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neg-'));
  cleanup.push(dir);
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# t\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '--quiet', '-m', 'i'], { cwd: dir });
  return dir;
}

function blocked(id = 'F1') {
  return `| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| ${id} | [阻塞] | bug | e | a.ts | fix | test |

## Verdict

BLOCKED
`;
}

function reBlocked(ids = ['F1']) {
  const rows = ids.map((id) => `| ${id} | unresolved | still broken |`).join('\n');
  return `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
${rows}

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

Still broken.

## Verdict

BLOCKED
`;
}

describe('T5 negative paths', () => {
  it('1) Reviewer invoke failure → DELIVERY_UNKNOWN, no half-write', async () => {
    const dir = initTempRepo();
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 't5-del',
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => null,
        async newSession() {
          return { ok: false, code: 'DELIVERY_UNKNOWN', error: 'timeout' };
        },
        async resume() {
          return { ok: false, code: 'DELIVERY_UNKNOWN', error: 'timeout' };
        },
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'DELIVERY_UNKNOWN');
    assert.doesNotMatch(fs.readFileSync(r.packetPath, 'utf8'), /# Review Findings/);
  });

  it('2) budget exhausted still blocked → structured report, packet continuable', async () => {
    const dir = initTempRepo();
    // Round 1 BLOCKED
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 't5-bud',
      rounds: 2,
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => 's',
        async newSession() {
          return { ok: true, text: blocked('F1'), sessionId: 's' };
        },
        async resume() {
          return { ok: true, text: reBlocked(['F1']), sessionId: 's' };
        },
      }),
    });
    assert.equal(r1.status, 'blocked');
    cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r1.packetPath,
      body: '## Changes\n- attempt 1\n',
    });
    // Round 2 still BLOCKED
    const r2 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      continue: true,
      packetPath: r1.packetPath,
      rounds: 2,
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => 's',
        async newSession() {
          return { ok: true, text: reBlocked(['F1']), sessionId: 's' };
        },
        async resume() {
          return { ok: true, text: reBlocked(['F1']), sessionId: 's' };
        },
      }),
    });
    assert.equal(r2.status, 'blocked');
    // Seed state as if budget fully used: round == budget, try continue again
    const meta = repo.readPacketMeta(r2.packetPath);
    const st = loadRunState(dir, meta.packetId);
    saveRunState(dir, meta.packetId, { ...st, round: 2, roundsBudget: 2, openBlocking: ['F1'] });
    cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r2.packetPath,
      body: '## Changes\n- attempt 2\n',
    });
    const r3 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      continue: true,
      packetPath: r2.packetPath,
      rounds: 2,
      adapterFactory: () => {
        throw new Error('should not invoke when budget exhausted');
      },
    });
    assert.equal(r3.ok, false);
    assert.equal(r3.status, 'budget_exhausted');
    assert.match(r3.message, /budget/i);
    assert.ok(fs.existsSync(r2.packetPath), 'packet remains for later continue with higher budget');
  });

  it('3) external packet rewrite → hash refuse + stop', async () => {
    const dir = initTempRepo();
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 't5-hash',
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => null,
        async newSession() {
          return { ok: true, text: blocked('F1'), sessionId: 's' };
        },
        async resume() {
          return { ok: true, text: blocked('F1'), sessionId: 's' };
        },
      }),
    });
    fs.appendFileSync(r1.packetPath, '\n<!-- evil -->\n');
    assert.throws(
      () =>
        cmdAppendFixCompletion({
          repoRoot: dir,
          packetPath: r1.packetPath,
          body: '## Changes\n- x\n',
        }),
      /PACKET_HASH_MISMATCH/,
    );
  });

  it('4) malformed → one correction → still bad → stop, no half-write', async () => {
    const dir = initTempRepo();
    let n = 0;
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 't5-mal',
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => 's',
        async newSession() {
          n += 1;
          return { ok: true, text: 'garbage', sessionId: 's' };
        },
        async resume() {
          n += 1;
          return { ok: true, text: 'still garbage', sessionId: 's' };
        },
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'malformed_reviewer_output');
    assert.equal(n, 2, 'exactly one correction resume');
    assert.doesNotMatch(fs.readFileSync(r.packetPath, 'utf8'), /# Review Findings/);
  });
});
