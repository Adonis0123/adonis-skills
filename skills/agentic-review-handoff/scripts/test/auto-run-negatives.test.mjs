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

function reBlocked(ids = ['F1'], evidence = 'still broken: off-by-one remains at demo.ts:12') {
  const rows = ids.map((id) => `| ${id} | unresolved | ${evidence} |`).join('\n');
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
    const fixerConclusion =
      'attempted return n instead of n+1 (reason X: off-by-one in demo.ts)';
    const reviewerEvidence = 'still broken: off-by-one remains at demo.ts:12 (evidence Y)';
    // Round 1 BLOCKED (budget 2 → still allow fix)
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
          return { ok: true, text: reBlocked(['F1'], reviewerEvidence), sessionId: 's' };
        },
      }),
    });
    assert.equal(r1.status, 'blocked');
    await cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r1.packetPath,
      body: `# Fix Completion

## Fix Conclusion
- ${fixerConclusion}

## Original Findings Snapshot
- F1

## Finding Status
- F1 claimed fixed via return-n patch

## Verification
- unit test green locally

## Re-review Instructions
- continue
`,
    });
    // Round 2 still BLOCKED → budget exhaust on this final budgeted round (not round 3)
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
          return { ok: true, text: reBlocked(['F1'], reviewerEvidence), sessionId: 's' };
        },
        async resume() {
          return { ok: true, text: reBlocked(['F1'], reviewerEvidence), sessionId: 's' };
        },
      }),
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.status, 'budget_exhausted');
    assert.match(r2.message, /budget/i);
    assert.ok(Array.isArray(r2.unresolved) || Array.isArray(r2.openBlocking));
    assert.ok(r2.positions?.reviewer && r2.positions?.fixer, 'report must include both sides');
    // Content must come from real stages — not empty findings + canned fixer note
    const reassess = r2.positions.reviewer.reassessments || [];
    assert.ok(reassess.length >= 1, 're-review exhaust must surface unresolved reassessments');
    assert.equal(reassess[0].id, 'F1');
    assert.match(String(reassess[0].evidence), /demo\.ts:12|evidence Y|off-by-one remains/i);
    assert.equal(r2.positions.fixer.present, true);
    assert.match(String(r2.positions.fixer.conclusion), /reason X|return n|off-by-one/i);
    assert.doesNotMatch(
      String(r2.positions.fixer.conclusion || r2.positions.fixer.note || ''),
      /submitted Fix Completion through prior rounds/i,
    );
    assert.match(String(r2.recommendation || ''), /\+N|rounds/i);
    assert.ok(fs.existsSync(r2.packetPath), 'packet remains for later continue with higher budget');

    // --rounds +2 must raise ceiling (not treat "+2" as absolute 2)
    const meta = repo.readPacketMeta(r2.packetPath);
    const st = loadRunState(dir, meta.packetId);
    assert.equal(Number(st.roundsBudget), 2);
    await cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r2.packetPath,
      body: '# Fix Completion\n\n## Fix Conclusion\n- attempt after +budget\n\n## Original Findings Snapshot\n- F1\n\n## Finding Status\n- F1 fixed\n\n## Verification\n- n/a\n\n## Re-review Instructions\n- continue\n',
    });
    const r3 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      continue: true,
      packetPath: r2.packetPath,
      rounds: '+2',
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => 's',
        async newSession() {
          return { ok: true, text: reBlocked(['F1'], reviewerEvidence), sessionId: 's' };
        },
        async resume() {
          return { ok: true, text: reBlocked(['F1'], reviewerEvidence), sessionId: 's' };
        },
      }),
    });
    // Budget is now 4; round 3 BLOCKED should still allow continue (not exhaust yet)
    assert.equal(r3.status, 'blocked', JSON.stringify(r3));
    assert.equal(r3.needsContinue, true);
    const st3 = loadRunState(dir, meta.packetId);
    assert.equal(Number(st3.roundsBudget), 4);
  });

  it('2c) --rounds 1 first-round budget exhaust must not claim Fix Completion', async () => {
    const dir = initTempRepo();
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 't5-bud1',
      rounds: 1,
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => 's',
        async newSession() {
          return { ok: true, text: blocked('F1'), sessionId: 's' };
        },
        async resume() {
          return { ok: true, text: blocked('F1'), sessionId: 's' };
        },
      }),
    });
    assert.equal(r.status, 'budget_exhausted', JSON.stringify(r));
    assert.equal(r.positions?.fixer?.present, false);
    assert.equal(r.positions?.fixer?.conclusion, null);
    assert.match(String(r.positions?.fixer?.note || ''), /No # Fix Completion|before a fix pass/i);
    assert.doesNotMatch(
      JSON.stringify(r.positions?.fixer || {}),
      /submitted Fix Completion through prior rounds/i,
    );
    // Round-1 findings still surface on reviewer side
    const findings = r.positions?.reviewer?.findings || [];
    assert.ok(findings.some((f) => f.id === 'F1'));
  });

  it('2b) scoped continue after external packet edit → hash refuse (not absorb)', async () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 't5-paths',
      paths: ['a.ts'],
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
    assert.equal(r1.status, 'blocked');
    // Legitimate Fix Completion first (hash still matches)
    await cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r1.packetPath,
      body: '# Fix Completion\n\n## Fix Conclusion\n- x\n\n## Original Findings Snapshot\n- F1\n\n## Finding Status\n- F1 fixed\n\n## Verification\n- n/a\n\n## Re-review Instructions\n- continue\n',
    });
    // External edit after fix-completion; continue must not rewrite+reseed and absorb it
    fs.appendFileSync(r1.packetPath, '\n<!-- external edit after fix -->\n');
    const r2 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      continue: true,
      packetPath: r1.packetPath,
      paths: ['a.ts'],
      adapterFactory: () => ({
        product: 'codex',
        getSessionId: () => null,
        async newSession() {
          return {
            ok: true,
            text: reBlocked(['F1']),
            sessionId: 's',
          };
        },
        async resume() {
          return { ok: true, text: reBlocked(['F1']), sessionId: 's' };
        },
      }),
    });
    assert.equal(r2.ok, false, JSON.stringify(r2));
    assert.equal(r2.status, 'packet_hash_mismatch');
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
    await assert.rejects(
      () =>
        cmdAppendFixCompletion({
          repoRoot: dir,
          packetPath: r1.packetPath,
          body: '# Fix Completion\n\n## Fix Conclusion\n- x\n\n## Original Findings Snapshot\n- F1\n\n## Finding Status\n- F1 fixed\n\n## Verification\n- n/a\n\n## Re-review Instructions\n- continue\n',
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
