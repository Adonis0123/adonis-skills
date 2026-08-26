import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { cmdAppendFixCompletion, cmdRun } from "../review-loop/auto-run.mjs";
import {
  createPacketFile,
  listPhysicalH1s,
  readPacketMeta,
  resolveBranch,
} from "../review-loop/repositories.mjs";

const cleanup = [];

afterEach(() => {
  while (cleanup.length) {
    const target = cleanup.pop();
    fs.rmSync(target, { force: true, recursive: true });
  }
});

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-intake-"));
  cleanup.push(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "subject.js"), "export const value = 1;\n");
  return dir;
}

function passText() {
  return `| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Verdict

PASS
`;
}

function blockedText() {
  return `| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| F1 | [阻塞] | broken value | subject.js still exports 1 | subject.js | export 2 | focused test passes |

## Verdict

BLOCKED
`;
}

function reReviewPassText() {
  return `## Prior Findings Reassessment

| ID | 状态 | 复核证据 |
|---|---|---|
| F1 | resolved | subject.js now exports 2 |

## New Findings

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Regression Surface

Focused diff remains valid.

## Verdict

PASS
`;
}

function fakeAdapterFactory(responses, calls) {
  let index = 0;
  return () => ({
    product: "codex",
    getSessionId: () => "session-intake",
    async newSession() {
      calls.count += 1;
      return {
        ok: true,
        sessionId: "session-intake",
        text: responses[index++] ?? responses.at(-1),
      };
    },
    async resume() {
      calls.count += 1;
      return {
        ok: true,
        sessionId: "session-intake",
        text: responses[index++] ?? responses.at(-1),
      };
    },
  });
}

describe("review-loop run --intake", () => {
  it("keeps default packet creation compatible with Review Handoff", () => {
    const dir = initTempRepo();
    const created = createPacketFile(dir, resolveBranch(dir), "default-seed");
    const meta = readPacketMeta(created.packetPath);

    assert.equal(meta.lastAnchor, "review_handoff");
    assert.deepEqual(listPhysicalH1s(meta.text), [
      { title: "Review Handoff", anchor: "review_handoff" },
    ]);
  });

  it("creates a truthful Review Intake seed without implementer claims", () => {
    const dir = initTempRepo();
    const created = createPacketFile(
      dir,
      resolveBranch(dir),
      "intake-seed",
      "intake",
    );
    const meta = readPacketMeta(created.packetPath);

    assert.equal(meta.lastAnchor, "review_intake");
    assert.deepEqual(listPhysicalH1s(meta.text), [
      { title: "Review Intake", anchor: "review_intake" },
    ]);
    assert.doesNotMatch(
      meta.text,
      /## Goal|Implementation Summary|Intended behavior/i,
    );
    assert.equal(meta.frontmatter.mode, undefined);
  });

  it("rejects an unknown initial anchor before creating a packet", () => {
    const dir = initTempRepo();
    const activeRoot = path.join(dir, ".review-handoff", "active");

    assert.throws(
      () =>
        createPacketFile(dir, resolveBranch(dir), "bad-seed", "unknown-origin"),
      /initial anchor|handoff|intake/i,
    );
    assert.equal(fs.existsSync(activeRoot), false);
  });

  it("runs a first Reviewer round from a Review Intake packet", async () => {
    const dir = initTempRepo();
    const calls = { count: 0 };
    const result = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "intake-pass",
      intake: true,
      adapterFactory: fakeAdapterFactory([passText()], calls),
    });

    assert.equal(result.status, "archived");
    assert.equal(calls.count, 1);
    const text = fs.readFileSync(result.packetPath, "utf8");
    assert.match(text, /# Review Intake/);
    assert.doesNotMatch(text, /# Review Handoff/);
    assert.match(text, /# Review Findings/);
  });

  it("rejects intake with continue without changing the packet or invoking Reviewer", async () => {
    const dir = initTempRepo();
    const created = createPacketFile(dir, resolveBranch(dir), "intake-cont");
    const before = fs.readFileSync(created.packetPath, "utf8");
    const calls = { count: 0 };

    await assert.rejects(
      () =>
        cmdRun({
          repoRoot: dir,
          reviewer: "codex",
          packetPath: created.packetPath,
          continue: true,
          intake: true,
          adapterFactory: fakeAdapterFactory([passText()], calls),
        }),
      /--intake.*--continue|--continue.*--intake/i,
    );
    assert.equal(fs.readFileSync(created.packetPath, "utf8"), before);
    assert.equal(calls.count, 0);
  });

  it("rejects intake with a caller-provided packet before invoking Reviewer", async () => {
    const dir = initTempRepo();
    const created = createPacketFile(dir, resolveBranch(dir), "intake-packet");
    const before = fs.readFileSync(created.packetPath, "utf8");
    const calls = { count: 0 };

    await assert.rejects(
      () =>
        cmdRun({
          repoRoot: dir,
          reviewer: "codex",
          packetPath: created.packetPath,
          intake: true,
          adapterFactory: fakeAdapterFactory([passText()], calls),
        }),
      /--intake.*packet|packet.*--intake/i,
    );
    assert.equal(fs.readFileSync(created.packetPath, "utf8"), before);
    assert.equal(calls.count, 0);
  });

  it("rejects intake with a caller-provided packet id before creating layout", async () => {
    const dir = initTempRepo();
    const calls = { count: 0 };

    await assert.rejects(
      () =>
        cmdRun({
          repoRoot: dir,
          reviewer: "codex",
          packetId: "branch/existing-packet",
          intake: true,
          adapterFactory: fakeAdapterFactory([passText()], calls),
        }),
      /--intake.*packet|packet.*--intake/i,
    );
    assert.equal(fs.existsSync(path.join(dir, ".review-handoff")), false);
    assert.equal(calls.count, 0);
  });

  it("refuses to take over a classic Review Intake packet", async () => {
    const dir = initTempRepo();
    const created = createPacketFile(
      dir,
      resolveBranch(dir),
      "classic-intake",
      "intake",
    );
    const autoSeed = fs.readFileSync(created.packetPath, "utf8");
    const classicPacket = autoSeed.replace(
      "loop: on\n---",
      "mode: classic\nclassic_reason: intake\n---",
    );
    fs.writeFileSync(created.packetPath, classicPacket);
    const calls = { count: 0 };

    await assert.rejects(
      () =>
        cmdRun({
          repoRoot: dir,
          reviewer: "codex",
          packetPath: created.packetPath,
          adapterFactory: fakeAdapterFactory([passText()], calls),
        }),
      /classic.*packet|packet.*classic|mode.*classic/i,
    );
    assert.equal(fs.readFileSync(created.packetPath, "utf8"), classicPacket);
    assert.equal(calls.count, 0);
  });

  it("rejects an initial H1 and last_anchor mismatch before invoking Reviewer", async () => {
    const dir = initTempRepo();
    const created = createPacketFile(dir, resolveBranch(dir), "mismatch");
    const original = fs.readFileSync(created.packetPath, "utf8");
    const mismatched = original.replace(
      "last_anchor: review_handoff",
      "last_anchor: review_intake",
    );
    fs.writeFileSync(created.packetPath, mismatched);
    const calls = { count: 0 };

    await assert.rejects(
      () =>
        cmdRun({
          repoRoot: dir,
          reviewer: "codex",
          packetPath: created.packetPath,
          adapterFactory: fakeAdapterFactory([passText()], calls),
        }),
      /initial.*anchor|anchor.*mismatch|review_handoff.*review_intake/i,
    );
    assert.equal(calls.count, 0);
  });

  it("continues an intake-origin packet without repeating the intake flag", async () => {
    const dir = initTempRepo();
    const firstCalls = { count: 0 };
    const first = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      scopeSlug: "intake-resume",
      intake: true,
      adapterFactory: fakeAdapterFactory([blockedText()], firstCalls),
    });
    assert.equal(first.status, "blocked");

    fs.writeFileSync(path.join(dir, "subject.js"), "export const value = 2;\n");
    await cmdAppendFixCompletion({
      repoRoot: dir,
      packetPath: first.packetPath,
      body: `# Fix Completion

## Fix Conclusion
- F1 fixed.

## Original Findings Snapshot
- F1

## Finding Status
- F1 resolved.

## Verification
- focused test passed.

## Re-review Instructions
- Reassess F1.
`,
    });

    const continueCalls = { count: 0 };
    const second = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      packetPath: first.packetPath,
      continue: true,
      adapterFactory: fakeAdapterFactory([reReviewPassText()], continueCalls),
    });

    assert.equal(second.status, "archived");
    assert.equal(continueCalls.count, 1);
    const h1s = listPhysicalH1s(fs.readFileSync(second.packetPath, "utf8"));
    assert.equal(h1s[0].anchor, "review_intake");
    assert.equal(h1s.at(-1).anchor, "re_review");
    assert.equal(
      h1s.filter((entry) => entry.anchor === "review_intake").length,
      1,
    );
  });

  it("accepts --intake through the real CLI entrypoint", () => {
    const dir = initTempRepo();
    const binDir = path.join(dir, "bin");
    fs.mkdirSync(binDir);
    const grokBin = path.join(binDir, "grok");
    const response = JSON.stringify({
      text: passText(),
      session_id: "019f0000-0000-0000-0000-000000000099",
    });
    fs.writeFileSync(
      grokBin,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${response}\n`)});\n`,
      { mode: 0o755 },
    );
    const cliPath = fileURLToPath(
      new URL("../review-loop.mjs", import.meta.url),
    );

    const cli = spawnSync(
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
        "--scope",
        "cli-intake",
        "--intake",
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

    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    const output = JSON.parse(cli.stdout);
    const text = fs.readFileSync(output.packetPath, "utf8");
    assert.match(text, /# Review Intake/);
    assert.doesNotMatch(text, /# Review Handoff/);
  });

  it("rejects a non-boolean intake CLI value before Reviewer invocation", () => {
    const dir = initTempRepo();
    const binDir = path.join(dir, "bin");
    fs.mkdirSync(binDir);
    const marker = path.join(dir, "reviewer-invoked");
    const grokBin = path.join(binDir, "grok");
    fs.writeFileSync(
      grokBin,
      `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "yes");\n`,
      { mode: 0o755 },
    );
    const cliPath = fileURLToPath(
      new URL("../review-loop.mjs", import.meta.url),
    );

    const cli = spawnSync(
      process.execPath,
      [
        cliPath,
        "run",
        "--repo",
        dir,
        "--reviewer",
        "grok",
        "--intake=unexpected",
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

    assert.notEqual(cli.status, 0);
    assert.match(cli.stdout, /--intake.*boolean|does not accept a value/i);
    assert.equal(fs.existsSync(marker), false);
  });
});
