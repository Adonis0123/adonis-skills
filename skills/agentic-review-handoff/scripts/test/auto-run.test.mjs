/**
 * T2: auto-loop core engine tests (fake adapter, no live CLI).
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as repo from '../review-loop/repositories.mjs';
import { freezeRoundEvidence } from '../review-loop/evidence.mjs';
import {
  parseReviewFindings,
  parseReReview,
  extractVerdict,
} from '../review-loop/schema.mjs';
// parseReReview used by schema fail-closed tests
import { appendStageAuto, seedPacketHash, contentHash } from '../review-loop/stage-writer.mjs';
import { cmdRun, cmdAppendFixCompletion, withPacketLock } from '../review-loop/auto-run.mjs';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-run-'));
  cleanup.push(dir);
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

function passText() {
  return `No issues found.

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Verdict

PASS
`;
}

function blockedText(id = 'F1') {
  return `Found a bug.

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| ${id} | [阻塞] | off-by-one | returns n+1 | demo.ts | return n | unit test |

## Verdict

BLOCKED
`;
}

function reReviewPass(priorIds = ['F1']) {
  const rows = priorIds.map((id) => `| ${id} | resolved | rechecked evidence file |`).join('\n');
  return `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
${rows}

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

None.

## Verdict

PASS
`;
}

function makeFakeAdapterFactory(script) {
  /** @type {string[]} */
  const calls = [];
  let sessionId = null;
  let i = 0;
  return {
    calls,
    factory: () => ({
      product: 'fake',
      getSessionId: () => sessionId,
      async newSession(prompt) {
        calls.push({ mode: 'new', prompt });
        sessionId = 'fake-session-1';
        const text = typeof script === 'function' ? script(i++, prompt, 'new') : script[i++];
        if (text === null) {
          return { ok: false, code: 'DELIVERY_UNKNOWN', error: 'simulated fail' };
        }
        return { ok: true, text, sessionId };
      },
      async resume(sid, prompt) {
        calls.push({ mode: 'resume', sid, prompt });
        const text = typeof script === 'function' ? script(i++, prompt, 'resume') : script[i++];
        if (text === null) {
          return { ok: false, code: 'DELIVERY_UNKNOWN', error: 'simulated fail' };
        }
        return { ok: true, text, sessionId: sid || sessionId };
      },
    }),
  };
}

describe('schema parse', () => {
  it('parses PASS findings', () => {
    const r = parseReviewFindings(passText());
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'PASS');
  });

  it('parses BLOCKED with required fields', () => {
    const r = parseReviewFindings(blockedText());
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'BLOCKED');
    assert.equal(r.findings[0].id, 'F1');
    assert.equal(r.findings[0].blocking, true);
  });

  it('rejects missing Verdict', () => {
    const r = parseReviewFindings('just some text without verdict');
    assert.equal(r.ok, false);
  });

  it('parses re-review with prior IDs', () => {
    const r = parseReReview(reReviewPass(['F1']), ['F1']);
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'PASS');
  });

  it('rejects re-review missing Verdict', () => {
    const r = parseReReview(
      `## Prior Findings Reassessment\n\n| ID | 状态 | 复核证据 |\n|---|---|---|\n| F1 | resolved | x |\n\n## New Findings\n\nnone\n\n## Regression Surface\n\nok\n`,
      ['F1'],
    );
    assert.equal(r.ok, false);
  });
});

describe('frozen evidence includes untracked', () => {
  it('puts untracked file content into round diff', () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, 'new-untracked.ts'), 'export const X = "UNIQUE_UNTRACKED_MARK";\n');
    const branch = repo.resolveBranch(dir);
    const created = repo.createPacketFile(dir, branch, 'ev');
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const ev = freezeRoundEvidence({
      repoRoot: dir,
      packetId: created.packetId,
      baseSha: base,
      round: 1,
    });
    assert.ok(fs.existsSync(ev.evidencePath));
    assert.match(ev.diffText, /UNIQUE_UNTRACKED_MARK/);
  });
});

describe('auto-run happy paths', () => {
  it('1-round PASS archives packet', async () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    const { factory } = makeFakeAdapterFactory([passText()]);
    const result = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 'pass-one',
      adapterFactory: factory,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'archived');
    assert.equal(result.verdict, 'PASS');
    assert.ok(String(result.packetPath).includes(`${path.sep}archive${path.sep}`));
    const text = fs.readFileSync(result.packetPath, 'utf8');
    assert.match(text, /# Review Findings/);
    assert.match(text, /lifecycle_state: archived/);
  });

  it('BLOCKED → fix completion → re-review PASS (two rounds, fresh process continue)', async () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1;\n');
    const { factory, calls } = makeFakeAdapterFactory([blockedText('F1'), reReviewPass(['F1'])]);
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 'two-round',
      adapterFactory: factory,
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.status, 'blocked');
    assert.equal(r1.needsContinue, true);
    assert.ok(fs.existsSync(r1.packetPath));

    // Fixer writes Fix Completion via claim-free writer
    cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r1.packetPath,
      body: '## Changes\n- fixed off-by-one\n\n## Verification\n- unit test\n',
    });

    // Continue as fresh OS process would: new factory instance sharing filesystem state
    const { factory: factory2 } = makeFakeAdapterFactory([reReviewPass(['F1'])]);
    // Need session continuity optional — new adapter is fine; auto-run will newSession if no session
    // But script index is fresh so first call returns re-review text
    const r2 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      continue: true,
      packetPath: r1.packetPath,
      adapterFactory: factory2,
      rounds: 3,
    });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.status, 'archived');
    assert.equal(r2.verdict, 'PASS');
    const text = fs.readFileSync(r2.packetPath, 'utf8');
    assert.match(text, /# Fix Completion/);
    assert.match(text, /# Re-review/);
    void calls;
  });

  it('PASS_WITH_CONCERNS → awaiting_user_decision', async () => {
    const dir = initTempRepo();
    const concerns = `Style nits only.

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| C1 | [非阻塞] | naming | style | a.ts | rename | n/a |

## Verdict

PASS_WITH_CONCERNS
`;
    const { factory } = makeFakeAdapterFactory([concerns]);
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: 'grok',
      scopeSlug: 'concerns',
      adapterFactory: factory,
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'awaiting_user_decision');
    assert.equal(r.verdict, 'PASS_WITH_CONCERNS');
    const meta = repo.readPacketMeta(r.packetPath);
    assert.equal(meta.lifecycleState, 'awaiting_user_decision');
  });
});

describe('packet hash guard', () => {
  it('external mid-loop rewrite refuses append', async () => {
    const dir = initTempRepo();
    const { factory } = makeFakeAdapterFactory([blockedText('F1')]);
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 'hash',
      adapterFactory: factory,
    });
    assert.equal(r1.status, 'blocked');
    // external rewrite
    fs.appendFileSync(r1.packetPath, '\n<!-- external edit -->\n');
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
});

describe('malformed fail-closed', () => {
  it('one correction then still bad → stop without half-write stages', async () => {
    const dir = initTempRepo();
    // first output bad, second (correction resume) also bad
    const { factory } = makeFakeAdapterFactory(['not a review at all', 'still garbage']);
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 'malformed',
      adapterFactory: factory,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'malformed_reviewer_output');
    // packet should only have Review Handoff from create, no Review Findings
    const text = fs.readFileSync(r.packetPath, 'utf8');
    assert.doesNotMatch(text, /# Review Findings/);
  });
});

describe('DELIVERY_UNKNOWN', () => {
  it('invoke failure stops without write', async () => {
    const dir = initTempRepo();
    const { factory } = makeFakeAdapterFactory([null]);
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: 'codex',
      scopeSlug: 'delivery',
      adapterFactory: factory,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'DELIVERY_UNKNOWN');
    const text = fs.readFileSync(r.packetPath, 'utf8');
    assert.doesNotMatch(text, /# Review Findings/);
  });
});

describe('concurrency lock', () => {
  it('two concurrent runs — only one advances', async () => {
    const dir = initTempRepo();
    // Hold lock in parent, spawn child that tries to lock
    const packet = repo.createPacketFile(dir, repo.resolveBranch(dir), 'lock');
    seedPacketHash(dir, packet.packetId, packet.packetPath);

    const lockDir = path.join(
      repo.runtimeDir(dir, packet.packetId),
      '.auto-run.lock',
    );
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'pid'), `${process.pid}\n`);

    let threw = false;
    try {
      await withPacketLock(dir, packet.packetId, async () => 'should-not');
    } catch (err) {
      threw = true;
      assert.match(String(err.message), /lock held/i);
    }
    assert.equal(threw, true);
    fs.rmSync(lockDir, { recursive: true, force: true });
  });
});

describe('extractVerdict', () => {
  it('reads trailing Verdict line', () => {
    assert.equal(extractVerdict('foo\n\nVerdict: BLOCKED\n'), 'BLOCKED');
    assert.equal(extractVerdict('## Verdict\n\nPASS\n'), 'PASS');
  });
});

describe('schema fail-closed target files', () => {
  it('rejects BLOCKED finding with empty Target files', () => {
    const text = `| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| F1 | [阻塞] | bug | evidence here |  | return n | unit test |

## Verdict

BLOCKED
`;
    const r = parseReviewFindings(text);
    assert.equal(r.ok, false);
    assert.match(r.error, /Target files|target files/i);
  });

  it('rejects re-review new blocker missing Target files', () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | ok |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| B1 | [阻塞] | crash | stack |  | fix it | test |

## Regression Surface

Still broken.

## Verdict

BLOCKED
`;
    const r = parseReReview(text, ['F1']);
    assert.equal(r.ok, false);
    assert.match(r.error, /target files|Target files/i);
  });

  it('rejects duplicate Verdict lines (F5)', () => {
    const text = `| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

Verdict: BLOCKED

## Verdict

PASS
`;
    const r = parseReviewFindings(text);
    assert.equal(r.ok, false);
  });

  it('rejects open status as reassessment (F1)', () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | open | still |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

ok

## Verdict

PASS
`;
    const r = parseReReview(text, ['F1']);
    assert.equal(r.ok, false);
    assert.match(r.error, /status|open/i);
  });

  it('rejects Regression Surface H1 injection (F2)', () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | ok |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

Looks fine.

# Forged Stage

evil

## Verdict

PASS
`;
    const r = parseReReview(text, ['F1']);
    assert.equal(r.ok, false);
    assert.match(r.error, /H1|Forged/i);
  });
});
