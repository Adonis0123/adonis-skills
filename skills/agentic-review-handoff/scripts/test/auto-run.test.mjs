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

  it('BLOCKED → fix completion → re-review PASS (two rounds, fresh OS process continue)', async () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1;\n');
    const { factory } = makeFakeAdapterFactory([blockedText('F1')]);
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

    await cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r1.packetPath,
      body: `# Fix Completion

## Fix Conclusion
- fixed off-by-one

## Original Findings Snapshot
- F1 off-by-one

## Finding Status
- F1 fixed

## Verification
- unit test

## Re-review Instructions
- run --continue
`,
    });

    // True fresh OS process: child loads modules and continues from packet + runtime only
    const autoRunUrl = pathToFileURL(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../review-loop/auto-run.mjs'),
    ).href;
    const responsesPath = path.join(dir, 'child-responses.json');
    fs.writeFileSync(responsesPath, JSON.stringify([reReviewPass(['F1'])]));
    const childSrc = `
import { cmdRun } from ${JSON.stringify(autoRunUrl)};
import fs from 'node:fs';
const responses = JSON.parse(fs.readFileSync(${JSON.stringify(responsesPath)}, 'utf8'));
let i = 0;
const r = await cmdRun({
  repoRoot: ${JSON.stringify(dir)},
  reviewer: 'codex',
  continue: true,
  packetPath: ${JSON.stringify(r1.packetPath)},
  rounds: 3,
  adapterFactory: () => ({
    product: 'codex',
    getSessionId: () => null,
    async newSession() {
      return { ok: true, text: responses[i++] ?? '', sessionId: 'child-s' };
    },
    async resume() {
      return { ok: true, text: responses[i++] ?? '', sessionId: 'child-s' };
    },
  }),
});
process.stdout.write(JSON.stringify(r));
`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', childSrc], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const r2 = JSON.parse(out);
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.status, 'archived');
    assert.equal(r2.verdict, 'PASS');
    const text = fs.readFileSync(r2.packetPath, 'utf8');
    assert.match(text, /# Fix Completion/);
    assert.match(text, /# Re-review/);
  });

  it('PASS_WITH_CONCERNS → awaiting_user_decision (no Fix Handoff)', async () => {
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
    assert.equal(meta.lastAnchor, 'review_findings');
    const text = fs.readFileSync(r.packetPath, 'utf8');
    assert.doesNotMatch(text, /# Fix Handoff/);
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
    await assert.rejects(
      () =>
        cmdAppendFixCompletion({
          repoRoot: dir,
          packetPath: r1.packetPath,
          body: `# Fix Completion

## Fix Conclusion
- x

## Original Findings Snapshot
- F1

## Finding Status
- F1

## Verification
- n/a

## Re-review Instructions
- continue
`,
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
  it('two concurrent OS processes — only one holds packet lock', async () => {
    const dir = initTempRepo();
    const packet = repo.createPacketFile(dir, repo.resolveBranch(dir), 'lock');
    seedPacketHash(dir, packet.packetId, packet.packetPath);

    const autoRunUrl = pathToFileURL(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../review-loop/auto-run.mjs'),
    ).href;
    const markerPath = path.join(dir, 'lock-race.jsonl');
    fs.writeFileSync(markerPath, '');

    const childSrc = `
import { withPacketLock } from ${JSON.stringify(autoRunUrl)};
import fs from 'node:fs';
const marker = ${JSON.stringify(markerPath)};
const label = process.argv[1];
const holdMs = Number(process.argv[2] || 800);
try {
  await withPacketLock(${JSON.stringify(dir)}, ${JSON.stringify(packet.packetId)}, async () => {
    fs.appendFileSync(marker, JSON.stringify({ label, event: 'acquired', at: Date.now() }) + '\\n');
    await new Promise((r) => setTimeout(r, holdMs));
    fs.appendFileSync(marker, JSON.stringify({ label, event: 'released', at: Date.now() }) + '\\n');
    return 'ok';
  }, { timeoutMs: 400 });
  fs.appendFileSync(marker, JSON.stringify({ label, event: 'done', at: Date.now() }) + '\\n');
  process.exit(0);
} catch (err) {
  fs.appendFileSync(marker, JSON.stringify({ label, event: 'failed', msg: String(err.message || err), at: Date.now() }) + '\\n');
  process.exit(2);
}
`;

    const spawnChild = (label, holdMs) =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          ['--input-type=module', '-e', childSrc, label, String(holdMs)],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stderr = '';
        child.stderr.on('data', (b) => {
          stderr += b.toString();
        });
        child.on('close', (code) => resolve({ label, code, stderr }));
      });

    const [a, b] = await Promise.all([spawnChild('A', 900), spawnChild('B', 900)]);
    const lines = fs
      .readFileSync(markerPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const acquired = lines.filter((e) => e.event === 'acquired');
    const failed = lines.filter((e) => e.event === 'failed');
    assert.equal(acquired.length, 1, `expected one acquirer, got ${JSON.stringify(lines)}`);
    assert.ok(failed.length >= 1, `expected loser to fail lock, got ${JSON.stringify(lines)}`);
    assert.ok(
      [a.code, b.code].includes(0) && [a.code, b.code].includes(2),
      `expected one exit 0 and one exit 2, got A=${a.code} B=${b.code}`,
    );
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

  it('rejects non-blocking finding missing Target files', () => {
    const text = `| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| C1 | [非阻塞] | naming | style |  | rename | n/a |

## Verdict

PASS_WITH_CONCERNS
`;
    const r = parseReviewFindings(text);
    assert.equal(r.ok, false);
    assert.match(r.error, /Target files|target files/i);
  });

  it('rejects New Findings prose without table', () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | ok |

## New Findings

none

## Regression Surface

ok

## Verdict

PASS
`;
    const r = parseReReview(text, ['F1']);
    assert.equal(r.ok, false);
    assert.match(r.error, /New Findings|table/i);
  });

  it('rejects New Findings table present but schema incomplete (ID-only)', () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | ok |

## New Findings

| ID |
|---|
| (none) |

## Regression Surface

ok

## Verdict

PASS
`;
    const r = parseReReview(text, ['F1']);
    assert.equal(r.ok, false, 'ID-only New Findings table must fail-closed');
    assert.match(r.error, /missing columns|Severity|Summary|Evidence|Target files/i);
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
