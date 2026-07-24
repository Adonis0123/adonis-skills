/**
 * T2: auto-loop core engine tests (fake adapter, no live CLI).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as repo from "../review-loop/repositories.mjs";
import { freezeRoundEvidence } from "../review-loop/evidence.mjs";
import {
  parseReviewFindings,
  parseReReview,
  extractVerdict,
} from "../review-loop/schema.mjs";
// parseReReview used by schema fail-closed tests
import {
  appendStageAuto,
  seedPacketHash,
  contentHash,
  loadRunState,
  saveRunState,
} from "../review-loop/stage-writer.mjs";
import {
  cmdRun,
  cmdAppendFixCompletion,
  cmdClose,
  withPacketLock,
  computeFindingLedger,
  assertVerdictOpenSets,
  rebuildLedgerFromPacketText,
  reconcileRuntimeState,
} from "../review-loop/auto-run.mjs";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-run-"));
  cleanup.push(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
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

describe("CLI reviewer progress", () => {
  it("prints liveness and the configured deadline to stderr", () => {
    const dir = initTempRepo();
    const binDir = path.join(dir, "bin");
    fs.mkdirSync(binDir);
    const grokBin = path.join(binDir, "grok");
    const response = JSON.stringify({
      text: passText(),
      session_id: "019f0000-0000-0000-0000-000000000055",
    });
    fs.writeFileSync(
      grokBin,
      `#!/usr/bin/env node
setTimeout(() => process.stdout.write(${JSON.stringify(`${response}\n`)}), 80);
`,
      { mode: 0o755 },
    );
    const cliPath = fileURLToPath(
      new URL("../review-loop.mjs", import.meta.url),
    );

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "run",
        "--repo",
        dir,
        "--reviewer",
        "grok",
        "--base",
        "HEAD",
        "--rounds",
        "1",
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          REVIEW_LOOP_TIMEOUT_MS: "1000",
        },
        timeout: 5_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stderr,
      /\[review-loop\] reviewer=grok status=active elapsed=00:00 timeout=00:01/,
    );
    assert.equal(JSON.parse(result.stdout).ok, true);
  });
});

function blockedText(id = "F1") {
  return `Found a bug.

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| ${id} | [阻塞] | off-by-one | returns n+1 | demo.ts | return n | unit test |

## Verdict

BLOCKED
`;
}

function reReviewPass(priorIds = ["F1"]) {
  const rows = priorIds
    .map((id) => `| ${id} | resolved | rechecked evidence file |`)
    .join("\n");
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

/** Re-review: prior blockers resolved, non-blocking concerns still open → PWC */
function reReviewPwc({
  resolved = ["F1"],
  openConcerns = [{ id: "C1", title: "naming" }],
} = {}) {
  const reRows = [
    ...resolved.map((id) => `| ${id} | resolved | rechecked blocker fixed |`),
    ...openConcerns.map(
      (c) => `| ${c.id} | unresolved | still ${c.title || "open"} |`,
    ),
  ].join("\n");
  return `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
${reRows}

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

No new blockers.

## Verdict

PASS_WITH_CONCERNS
`;
}

function blockedWithConcernText() {
  return `Found a blocker and a style concern.

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| F1 | [阻塞] | off-by-one | returns n+1 | demo.ts | return n | unit test |
| C1 | [非阻塞] | naming | style | demo.ts | rename | n/a |

## Verdict

BLOCKED
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
      product: "fake",
      getSessionId: () => sessionId,
      async newSession(prompt) {
        calls.push({ mode: "new", prompt });
        sessionId = "fake-session-1";
        const text =
          typeof script === "function"
            ? script(i++, prompt, "new")
            : script[i++];
        if (text === null) {
          return {
            ok: false,
            code: "DELIVERY_UNKNOWN",
            error: "simulated fail",
          };
        }
        return { ok: true, text, sessionId };
      },
      async resume(sid, prompt) {
        calls.push({ mode: "resume", sid, prompt });
        const text =
          typeof script === "function"
            ? script(i++, prompt, "resume")
            : script[i++];
        if (text === null) {
          return {
            ok: false,
            code: "DELIVERY_UNKNOWN",
            error: "simulated fail",
          };
        }
        return { ok: true, text, sessionId: sid || sessionId };
      },
    }),
  };
}

describe("schema parse", () => {
  it("parses PASS findings", () => {
    const r = parseReviewFindings(passText());
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "PASS");
  });

  it("parses BLOCKED with required fields", () => {
    const r = parseReviewFindings(blockedText());
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "BLOCKED");
    assert.equal(r.findings[0].id, "F1");
    assert.equal(r.findings[0].blocking, true);
  });

  it("rejects missing Verdict", () => {
    const r = parseReviewFindings("just some text without verdict");
    assert.equal(r.ok, false);
  });

  it("parses re-review with prior IDs", () => {
    const r = parseReReview(reReviewPass(["F1"]), ["F1"]);
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "PASS");
  });

  it("rejects re-review missing Verdict", () => {
    const r = parseReReview(
      `## Prior Findings Reassessment\n\n| ID | 状态 | 复核证据 |\n|---|---|---|\n| F1 | resolved | x |\n\n## New Findings\n\nnone\n\n## Regression Surface\n\nok\n`,
      ["F1"],
    );
    assert.equal(r.ok, false);
  });
});

describe("frozen evidence includes untracked", () => {
  it("puts untracked file content into round diff", () => {
    const dir = initTempRepo();
    fs.writeFileSync(
      path.join(dir, "new-untracked.ts"),
      'export const X = "UNIQUE_UNTRACKED_MARK";\n',
    );
    const branch = repo.resolveBranch(dir);
    const created = repo.createPacketFile(dir, branch, "ev");
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
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

describe("auto-run happy paths", () => {
  it("1-round PASS archives packet", async () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    const { factory } = makeFakeAdapterFactory([passText()]);
    const result = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "pass-one",
      adapterFactory: factory,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, "archived");
    assert.equal(result.verdict, "PASS");
    assert.ok(
      String(result.packetPath).includes(`${path.sep}archive${path.sep}`),
    );
    const text = fs.readFileSync(result.packetPath, "utf8");
    assert.match(text, /# Review Findings/);
    assert.match(text, /lifecycle_state: archived/);
  });

  it("BLOCKED → fix completion → re-review PASS (two rounds, fresh OS process continue)", async () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, "b.ts"), "export const b = 1;\n");
    const { factory } = makeFakeAdapterFactory([blockedText("F1")]);
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "two-round",
      adapterFactory: factory,
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.status, "blocked");
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
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../review-loop/auto-run.mjs",
      ),
    ).href;
    const responsesPath = path.join(dir, "child-responses.json");
    fs.writeFileSync(responsesPath, JSON.stringify([reReviewPass(["F1"])]));
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
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", childSrc],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    const r2 = JSON.parse(out);
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.status, "archived");
    assert.equal(r2.verdict, "PASS");
    const text = fs.readFileSync(r2.packetPath, "utf8");
    assert.match(text, /# Fix Completion/);
    assert.match(text, /# Re-review/);
  });

  it("PASS_WITH_CONCERNS → awaiting_user_decision (no Fix Handoff)", async () => {
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
      reviewer: "grok",
      scopeSlug: "concerns",
      adapterFactory: factory,
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "awaiting_user_decision");
    assert.equal(r.verdict, "PASS_WITH_CONCERNS");
    const meta = repo.readPacketMeta(r.packetPath);
    assert.equal(meta.lifecycleState, "awaiting_user_decision");
    assert.equal(meta.lastAnchor, "review_findings");
    const text = fs.readFileSync(r.packetPath, "utf8");
    assert.doesNotMatch(text, /# Fix Handoff/);
  });
});

describe("packet hash guard", () => {
  it("external mid-loop rewrite refuses append", async () => {
    const dir = initTempRepo();
    const { factory } = makeFakeAdapterFactory([blockedText("F1")]);
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "hash",
      adapterFactory: factory,
    });
    assert.equal(r1.status, "blocked");
    // external rewrite
    fs.appendFileSync(r1.packetPath, "\n<!-- external edit -->\n");
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

describe("malformed fail-closed", () => {
  it("one correction then still bad → stop without half-write stages", async () => {
    const dir = initTempRepo();
    // first output bad, second (correction resume) also bad
    const { factory } = makeFakeAdapterFactory([
      "not a review at all",
      "still garbage",
    ]);
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "malformed",
      adapterFactory: factory,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "malformed_reviewer_output");
    // packet should only have Review Handoff from create, no Review Findings
    const text = fs.readFileSync(r.packetPath, "utf8");
    assert.doesNotMatch(text, /# Review Findings/);
  });
});

describe("DELIVERY_UNKNOWN", () => {
  it("invoke failure stops without write", async () => {
    const dir = initTempRepo();
    const { factory } = makeFakeAdapterFactory([null]);
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "delivery",
      adapterFactory: factory,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "DELIVERY_UNKNOWN");
    const text = fs.readFileSync(r.packetPath, "utf8");
    assert.doesNotMatch(text, /# Review Findings/);
  });
});

describe("concurrency lock", () => {
  it("two concurrent OS processes — only one holds packet lock", async () => {
    const dir = initTempRepo();
    const packet = repo.createPacketFile(dir, repo.resolveBranch(dir), "lock");
    seedPacketHash(dir, packet.packetId, packet.packetPath);

    const autoRunUrl = pathToFileURL(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../review-loop/auto-run.mjs",
      ),
    ).href;
    const markerPath = path.join(dir, "lock-race.jsonl");
    fs.writeFileSync(markerPath, "");

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
          ["--input-type=module", "-e", childSrc, label, String(holdMs)],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (b) => {
          stderr += b.toString();
        });
        child.on("close", (code) => resolve({ label, code, stderr }));
      });

    const [a, b] = await Promise.all([
      spawnChild("A", 900),
      spawnChild("B", 900),
    ]);
    const lines = fs
      .readFileSync(markerPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const acquired = lines.filter((e) => e.event === "acquired");
    const failed = lines.filter((e) => e.event === "failed");
    assert.equal(
      acquired.length,
      1,
      `expected one acquirer, got ${JSON.stringify(lines)}`,
    );
    assert.ok(
      failed.length >= 1,
      `expected loser to fail lock, got ${JSON.stringify(lines)}`,
    );
    assert.ok(
      [a.code, b.code].includes(0) && [a.code, b.code].includes(2),
      `expected one exit 0 and one exit 2, got A=${a.code} B=${b.code}`,
    );
  });
});

describe("extractVerdict", () => {
  it("reads trailing Verdict line", () => {
    assert.equal(extractVerdict("foo\n\nVerdict: BLOCKED\n"), "BLOCKED");
    assert.equal(extractVerdict("## Verdict\n\nPASS\n"), "PASS");
  });
});

describe("schema fail-closed round-1 full columns", () => {
  it("rejects ID-only findings table with PASS (contract hole closed)", () => {
    const text = `| ID |
|---|
| (none) |

## Verdict

PASS
`;
    const r = parseReviewFindings(text);
    assert.equal(r.ok, false, "ID-only first-round table must fail-closed");
    assert.match(
      r.error,
      /missing columns|Severity|Summary|Evidence|Target files/i,
    );
  });

  it("rejects unescaped pipe causing column count mismatch", () => {
    const text = `| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| F1 | [阻塞] | type | string | number | src/a.ts | use enum | tsc |

## Verdict

BLOCKED
`;
    const r = parseReviewFindings(text);
    assert.equal(
      r.ok,
      false,
      "extra | in evidence must not silently shift columns",
    );
    assert.match(r.error, /column count mismatch|unescaped/i);
  });
});

describe("listPacketsUnder dual-dir sort", () => {
  it("picks v2 newer packet over legacy older when dual-read", () => {
    const dir = initTempRepo();
    const branch = repo.resolveBranch(dir);
    const v2 = repo.branchSlug(branch);
    const legacy = repo.branchSlugLegacy(branch);
    assert.notEqual(v2, legacy);

    const writePacket = (slug, fileBase, branchField = branch) => {
      const d = path.join(dir, ".review-handoff", "active", slug);
      fs.mkdirSync(d, { recursive: true });
      const packetId = `${slug}/${fileBase}`;
      const p = path.join(d, `${fileBase}.md`);
      fs.writeFileSync(
        p,
        `---
packet_id: ${packetId}
branch: ${branchField}
scope: dual
created: 2026-07-23T00:00:00.000Z
updated: 2026-07-23T00:00:00.000Z
last_anchor: review_handoff
lifecycle_state: in_progress
round: 1
loop: on
---

# Review Handoff

## Goal
- dual
`,
      );
      return p;
    };

    const olderLegacy = writePacket(legacy, "2026-07-22_10-00-old");
    const newerV2 = writePacket(v2, "2026-07-23_10-00-new");
    const latest = repo.latestActivePacket(dir, branch);
    assert.equal(fs.realpathSync(latest), fs.realpathSync(newerV2));
    assert.notEqual(fs.realpathSync(latest), fs.realpathSync(olderLegacy));
  });

  it("same basename prefers v2 path over legacy", () => {
    const dir = initTempRepo();
    const branch = repo.resolveBranch(dir);
    const v2 = repo.branchSlug(branch);
    const legacy = repo.branchSlugLegacy(branch);
    const fileBase = "2026-07-23_12-00-same";

    for (const slug of [legacy, v2]) {
      const d = path.join(dir, ".review-handoff", "active", slug);
      fs.mkdirSync(d, { recursive: true });
      const packetId = `${slug}/${fileBase}`;
      fs.writeFileSync(
        path.join(d, `${fileBase}.md`),
        `---
packet_id: ${packetId}
branch: ${branch}
scope: same
created: 2026-07-23T00:00:00.000Z
updated: 2026-07-23T00:00:00.000Z
last_anchor: review_handoff
lifecycle_state: in_progress
round: 1
loop: on
---

# Review Handoff

## Goal
- same
`,
      );
    }

    const latest = repo.latestActivePacket(dir, branch);
    assert.ok(latest.includes(`${path.sep}${v2}${path.sep}`));
    assert.ok(!latest.includes(`${path.sep}${legacy}${path.sep}`));
  });
});

describe("branchSlug v2 isolation", () => {
  it("separates feature/payment, feature-payment, Feature/Payment", () => {
    const a = repo.branchSlug("feature/payment");
    const b = repo.branchSlug("feature-payment");
    const c = repo.branchSlug("Feature/Payment");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(b, c);
    assert.match(a, /--[0-9a-f]{12}$/);
    assert.match(b, /--[0-9a-f]{12}$/);
  });

  it("detached identity uses detached:<sha> and distinct slugs per commit", () => {
    const sha1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sha2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const s1 = repo.branchSlug(`detached:${sha1}`);
    const s2 = repo.branchSlug(`detached:${sha2}`);
    assert.notEqual(s1, s2);
    assert.match(s1, /^detached-aaaaaaaaaaaa--/);
    assert.equal(repo.branchSlugLegacy(`detached:${sha1}`), "head");
  });

  it("legacy packet under v1 dir still validates via packet_id slug (no rewrite)", () => {
    const dir = initTempRepo();
    const branch = repo.resolveBranch(dir);
    const legacySlug = repo.branchSlugLegacy(branch);
    const activeDir = path.join(dir, ".review-handoff", "active", legacySlug);
    fs.mkdirSync(activeDir, { recursive: true });
    const fileBase = "2026-07-23_00-00-legacy";
    const packetId = `${legacySlug}/${fileBase}`;
    const packetPath = path.join(activeDir, `${fileBase}.md`);
    fs.writeFileSync(
      packetPath,
      `---
packet_id: ${packetId}
branch: ${branch}
scope: legacy
created: 2026-07-23T00:00:00.000Z
updated: 2026-07-23T00:00:00.000Z
last_anchor: review_handoff
lifecycle_state: in_progress
round: 1
loop: on
---

# Review Handoff

## Goal
- legacy
`,
    );
    const validated = repo.validatePacketPath(dir, branch, packetPath, {
      activeOnly: true,
    });
    assert.equal(validated.packetId, packetId);
    assert.ok(
      validated.packetPath.includes(`${path.sep}${legacySlug}${path.sep}`),
    );
    // dual-read list finds it (normalize realpath: macOS /var vs /private/var)
    const listed = repo
      .listActivePackets(dir, branch)
      .map((p) => fs.realpathSync(p));
    assert.ok(
      listed.some((p) => p === validated.packetPath),
      `expected ${validated.packetPath} in ${JSON.stringify(listed)}`,
    );
  });

  it("refuses legacy HEAD packet auto-attach to detached identity", () => {
    const dir = initTempRepo();
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
    // create orphan commit then detach
    execFileSync("git", ["checkout", "--detach", "HEAD"], { cwd: dir });
    const branch = repo.resolveBranch(dir);
    assert.equal(branch, `detached:${headSha}`);

    const legacyDir = path.join(dir, ".review-handoff", "active", "head");
    fs.mkdirSync(legacyDir, { recursive: true });
    const fileBase = "2026-07-23_00-00-head";
    const packetPath = path.join(legacyDir, `${fileBase}.md`);
    fs.writeFileSync(
      packetPath,
      `---
packet_id: head/${fileBase}
branch: HEAD
scope: head
created: 2026-07-23T00:00:00.000Z
updated: 2026-07-23T00:00:00.000Z
last_anchor: review_handoff
lifecycle_state: in_progress
round: 1
loop: on
---

# Review Handoff

## Goal
- head
`,
    );
    assert.throws(
      () =>
        repo.validatePacketPath(dir, branch, packetPath, { activeOnly: true }),
      /branch mismatch|HEAD|detached/i,
    );
    // dual-read must not auto-list it
    assert.equal(repo.listActivePackets(dir, branch).length, 0);
  });
});

describe("close accept-concerns", () => {
  it("archives PWC packet with Decision Closure without rewriting Verdict", async () => {
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
      reviewer: "codex",
      scopeSlug: "close-pwc",
      adapterFactory: factory,
    });
    assert.equal(r.status, "awaiting_user_decision");
    assert.deepEqual(
      (r.concerns || []).map((c) => c.id),
      ["C1"],
    );
    const closed = await cmdClose({
      repoRoot: dir,
      packetPath: r.packetPath,
      reason: "accept-concerns",
    });
    assert.equal(closed.ok, true);
    assert.equal(closed.status, "archived");
    assert.equal(closed.originalVerdict, "PASS_WITH_CONCERNS");
    assert.deepEqual(closed.acceptedConcernIds, ["C1"]);
    assert.ok(
      String(closed.packetPath).includes(`${path.sep}archive${path.sep}`),
    );
    const text = fs.readFileSync(closed.packetPath, "utf8");
    assert.match(text, /# Decision Closure/);
    assert.match(text, /last_anchor: decision_closure/);
    assert.match(text, /lifecycle_state: archived/);
    assert.match(text, /close_reason: accept-concerns/);
    assert.match(text, /PASS_WITH_CONCERNS/);
    assert.doesNotMatch(text, /## Verdict\n\nPASS\n/);
    // idempotent refuse
    await assert.rejects(
      () =>
        cmdClose({
          repoRoot: dir,
          packetPath: closed.packetPath,
          reason: "accept-concerns",
        }),
      /archive|active|mismatch|refuses/i,
    );
  });

  it("BLOCKED → fix → re-review PWC → close accepts only open concern C1", async () => {
    const dir = initTempRepo();
    const { factory } = makeFakeAdapterFactory([
      blockedWithConcernText(),
      reReviewPwc({
        resolved: ["F1"],
        openConcerns: [{ id: "C1", title: "naming" }],
      }),
    ]);
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "pwc-rr",
      adapterFactory: factory,
      rounds: 3,
    });
    assert.equal(r1.status, "blocked");
    assert.deepEqual(r1.openBlocking, ["F1"]);

    await cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r1.packetPath,
      body: `# Fix Completion

## Fix Conclusion
- fixed F1

## Original Findings Snapshot
- F1 blocker
- C1 naming

## Finding Status
- F1 fixed
- C1 deferred

## Verification
- unit test

## Re-review Instructions
- continue
`,
    });

    const r2 = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      continue: true,
      packetPath: r1.packetPath,
      adapterFactory: factory,
      rounds: 3,
    });
    assert.equal(r2.status, "awaiting_user_decision", JSON.stringify(r2));
    assert.equal(r2.verdict, "PASS_WITH_CONCERNS");
    assert.deepEqual(
      (r2.concerns || []).map((c) => c.id),
      ["C1"],
      "re-review PWC must surface open non-blocking concerns, not empty newFindings",
    );
    assert.ok(
      !(r2.concerns || []).some((c) => c.id === "F1"),
      "resolved blocker must not appear as concern",
    );

    const closed = await cmdClose({
      repoRoot: dir,
      packetPath: r2.packetPath,
      reason: "accept-concerns",
    });
    assert.equal(closed.ok, true);
    assert.deepEqual(closed.acceptedConcernIds, ["C1"]);
    const text = fs.readFileSync(closed.packetPath, "utf8");
    assert.match(text, /# Decision Closure/);
    // Only assert Decision Closure body — earlier stages still list historical F1
    const closure = text.split("# Decision Closure")[1] || "";
    assert.match(closure, /\| C1 \|/);
    assert.doesNotMatch(closure, /\| F1 \|/);
  });

  it("refuses close when not awaiting_user_decision", async () => {
    const dir = initTempRepo();
    const { factory } = makeFakeAdapterFactory([passText()]);
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "close-pass",
      adapterFactory: factory,
    });
    assert.equal(r.status, "archived");
    await assert.rejects(
      () =>
        cmdClose({
          repoRoot: dir,
          packetPath: r.packetPath,
          reason: "accept-concerns",
        }),
      /archive|awaiting_user_decision|refuses/i,
    );
  });
});

describe("finding ledger helpers", () => {
  it("re-review PWC openConcerns keeps unresolved non-blockers", () => {
    const priorCatalog = {
      F1: {
        severity: "[阻塞]",
        title: "bug",
        targetFiles: "a.ts",
        blocking: true,
      },
      C1: {
        severity: "[非阻塞]",
        title: "naming",
        targetFiles: "a.ts",
        blocking: false,
      },
    };
    const ledger = computeFindingLedger({
      effectiveRound: 2,
      priorCatalog,
      priorFindingIds: ["F1", "C1"],
      parsed: {
        reassessments: [
          { id: "F1", status: "resolved", evidence: "ok" },
          { id: "C1", status: "unresolved", evidence: "still" },
        ],
        newFindings: [],
      },
    });
    assert.deepEqual(ledger.openBlocking, []);
    assert.deepEqual(ledger.openConcerns, ["C1"]);
    assert.doesNotThrow(() =>
      assertVerdictOpenSets(
        "PASS_WITH_CONCERNS",
        ledger.openBlocking,
        ledger.openConcerns,
      ),
    );
  });

  it("rejects New Findings reusing catalog id", () => {
    assert.throws(
      () =>
        computeFindingLedger({
          effectiveRound: 2,
          priorCatalog: {
            F1: {
              severity: "[阻塞]",
              title: "bug",
              targetFiles: "a.ts",
              blocking: true,
            },
          },
          priorFindingIds: ["F1"],
          parsed: {
            reassessments: [{ id: "F1", status: "resolved", evidence: "ok" }],
            newFindings: [
              {
                id: "F1",
                severity: "[阻塞]",
                title: "dup",
                targetFiles: "b.ts",
                blocking: true,
              },
            ],
          },
        }),
      /reuses existing finding id/i,
    );
  });
});

describe("scope slug contract", () => {
  it("rejects scope slugs longer than 24 or more than 3 words", () => {
    const dir = initTempRepo();
    const branch = repo.resolveBranch(dir);
    assert.throws(
      () => repo.createPacketFile(dir, branch, "one-two-three-four"),
      /invalid packet scope slug|1–3|24/i,
    );
    assert.throws(
      () =>
        repo.createPacketFile(
          dir,
          branch,
          "abcdefghijklmnopqrstuvwxy", // 25 chars, 1 word
        ),
      /invalid packet scope slug|24/i,
    );
  });
});

describe("reassessment exact-once", () => {
  it("rejects duplicate reassessment id", () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | ok |
| F1 | unresolved | still open |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

ok

## Verdict

PASS
`;
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /duplicate reassessment/i);
  });

  it("rejects unknown reassessment id not in prior set", () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | ok |
| X9 | unresolved | extra |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

ok

## Verdict

PASS
`;
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /not in prior|X9/i);
  });

  it("rejects New Findings id that collides with prior", () => {
    const text = `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | ok |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| F1 | [阻塞] | again | e | a.ts | fix | t |

## Regression Surface

ok

## Verdict

BLOCKED
`;
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /collides|F1/i);
  });
});

describe("ledger rebuild + pending recovery", () => {
  it("rebuilds catalog from packet Review Findings + Re-review stages", () => {
    const packetText = `---
packet_id: x/y
branch: master
last_anchor: re_review
lifecycle_state: awaiting_user_decision
round: 2
---

# Review Findings

## Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| F1 | [阻塞] | bug | e | a.ts | fix | t |
| C1 | [非阻塞] | naming | s | a.ts | rename | n/a |

## Verdict

BLOCKED

# Re-review

## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | fixed |
| C1 | unresolved | still |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

ok

## Verdict

PASS_WITH_CONCERNS
`;
    const rebuilt = rebuildLedgerFromPacketText(packetText);
    assert.equal(rebuilt.round, 2);
    assert.equal(rebuilt.lastVerdict, "PASS_WITH_CONCERNS");
    assert.deepEqual(rebuilt.openBlocking, []);
    assert.deepEqual(rebuilt.openConcerns, ["C1"]);
    assert.ok(rebuilt.findingCatalog.F1.blocking);
    assert.equal(rebuilt.findingCatalog.C1.blocking, false);
  });

  it("legacy empty catalog on continue rebuilds then re-review PWC close", async () => {
    const dir = initTempRepo();
    const { factory } = makeFakeAdapterFactory([
      blockedWithConcernText(),
      reReviewPwc({
        resolved: ["F1"],
        openConcerns: [{ id: "C1", title: "naming" }],
      }),
    ]);
    const r1 = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "legacy",
      adapterFactory: factory,
      rounds: 3,
    });
    assert.equal(r1.status, "blocked");

    await cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: r1.packetPath,
      body: `# Fix Completion

## Fix Conclusion
- fixed F1

## Original Findings Snapshot
- F1
- C1

## Finding Status
- F1 fixed

## Verification
- ok

## Re-review Instructions
- continue
`,
    });

    // Simulate pre-ledger state: wipe catalog but keep findingIds/round
    const packetId = repo.readPacketMeta(r1.packetPath).packetId;
    const st = loadRunState(dir, packetId);
    saveRunState(dir, packetId, {
      ...st,
      findingCatalog: undefined,
      openBlocking: ["F1"],
      openConcerns: ["C1"],
      findingIds: ["F1", "C1"],
      round: 1,
      lastVerdict: "BLOCKED",
    });

    const r2 = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      continue: true,
      packetPath: r1.packetPath,
      adapterFactory: factory,
      rounds: 3,
    });
    assert.equal(r2.status, "awaiting_user_decision", JSON.stringify(r2));
    assert.deepEqual(
      (r2.concerns || []).map((c) => c.id),
      ["C1"],
    );
  });

  it("leftover pendingStage fails closed (no auto-replay)", async () => {
    const dir2 = initTempRepo();
    const { factory: f2 } = makeFakeAdapterFactory([blockedText("F1")]);
    const b = await cmdRun({
      repoRoot: dir2,
      reviewer: "codex",
      scopeSlug: "pend2",
      adapterFactory: f2,
    });
    assert.equal(b.status, "blocked");
    const meta = repo.readPacketMeta(b.packetPath);
    const packetId = meta.packetId;
    const st = loadRunState(dir2, packetId);
    saveRunState(dir2, packetId, {
      ...st,
      pendingStage: {
        oldHash: "deadbeef",
        round: 1,
        lastAnchor: meta.lastAnchor,
        sectionMarkdown: "# unused",
      },
    });
    const recon = reconcileRuntimeState({
      repoRoot: dir2,
      packetId,
      packetPath: b.packetPath,
      state: loadRunState(dir2, packetId),
    });
    assert.equal(recon.error?.status, "STATE_RECOVERY_REQUIRED");
    assert.match(String(recon.error?.message || ""), /pendingStage|journal/i);
  });

  it("refuses absorb when packet mutates during Reviewer await", async () => {
    const dir = initTempRepo();
    fs.writeFileSync(path.join(dir, "m.ts"), "export const m = 1;\n");
    let packetPathSeen = null;
    const factory = () => ({
      product: "fake",
      getSessionId: () => "s",
      async newSession() {
        // mutate packet while "Reviewer" runs
        if (!packetPathSeen) {
          // discover packet after create: look under active
          const activeRoot = path.join(dir, ".review-handoff", "active");
          const walk = (d) => {
            for (const name of fs.readdirSync(d)) {
              const p = path.join(d, name);
              if (fs.statSync(p).isDirectory()) walk(p);
              else if (p.endsWith(".md")) packetPathSeen = p;
            }
          };
          if (fs.existsSync(activeRoot)) walk(activeRoot);
        }
        if (packetPathSeen && fs.existsSync(packetPathSeen)) {
          fs.appendFileSync(packetPathSeen, "\n<!-- mid-reviewer edit -->\n");
        }
        return { ok: true, text: passText(), sessionId: "s" };
      },
      async resume() {
        return { ok: true, text: passText(), sessionId: "s" };
      },
    });
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "tamper",
      adapterFactory: factory,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, "packet_hash_mismatch");
  });
});

describe("schema fail-closed target files", () => {
  it("rejects BLOCKED finding with empty Target files", () => {
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

  it("rejects non-blocking finding missing Target files", () => {
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

  it("rejects New Findings prose without table", () => {
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
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /New Findings|table/i);
  });

  it("rejects New Findings table present but schema incomplete (ID-only)", () => {
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
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false, "ID-only New Findings table must fail-closed");
    assert.match(
      r.error,
      /missing columns|Severity|Summary|Evidence|Target files/i,
    );
  });

  it("rejects re-review new blocker missing Target files", () => {
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
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /target files|Target files/i);
  });

  it("rejects duplicate Verdict lines (F5)", () => {
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

  it("rejects open status as reassessment (F1)", () => {
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
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /status|open/i);
  });

  it("rejects Regression Surface H1 injection (F2)", () => {
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
    const r = parseReReview(text, ["F1"]);
    assert.equal(r.ok, false);
    assert.match(r.error, /H1|Forged/i);
  });
});
