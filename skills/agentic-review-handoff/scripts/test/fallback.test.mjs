/**
 * --fallback: a Reviewer or consult peer that times out hands the same round to the next product.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseFallback } from "../review-loop/adapters.mjs";
import { cmdRun } from "../review-loop/auto-run.mjs";
import { cmdConsult } from "../review-loop/consult.mjs";
import { loadRunState } from "../review-loop/stage-writer.mjs";

const cleanup = [];
afterEach(() => {
  while (cleanup.length)
    fs.rmSync(cleanup.pop(), { recursive: true, force: true });
});

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fallback-"));
  cleanup.push(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# t\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", "i"], { cwd: dir });
  return dir;
}

const PASS = `No issues found.

| ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check |
|---|---|---|---|---|---|---|
| (none) | — | — | — | — | — | — |

## Verdict

PASS
`;

/** Per product: "timeout", "fail" (any other failure) or the text it answers. */
function products(behaviour) {
  const calls = [];
  const factory = (product) => ({
    product,
    getSessionId: () => null,
    async newSession() {
      calls.push(product);
      const b = behaviour[product];
      if (b === "timeout")
        return {
          ok: false,
          code: "DELIVERY_UNKNOWN",
          error: "timeout after 1200000ms",
          timedOut: true,
        };
      if (b === "fail")
        return {
          ok: false,
          code: "DELIVERY_UNKNOWN",
          error: "exit 1",
          timedOut: false,
        };
      return { ok: true, text: b, sessionId: `${product}-s1` };
    },
    async resume() {
      throw new Error("not used");
    },
  });
  return { calls, factory };
}

describe("--fallback", () => {
  it("parses an ordered list and refuses unknown or repeated products", () => {
    assert.deepEqual(parseFallback("claude, grok", "codex"), [
      "claude",
      "grok",
    ]);
    assert.deepEqual(parseFallback(undefined, "codex"), []);
    assert.throws(() => parseFallback("codex", "codex"), /repeats the primary/);
    assert.throws(
      () => parseFallback("gemini", "codex"),
      /codex\|grok\|claude/,
    );
  });

  it("hands a timed-out round to the next product and records who reviewed", async () => {
    const dir = initTempRepo();
    const p = products({ grok: "timeout", codex: PASS });
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: "grok",
      fallback: "codex",
      rounds: 1,
      adapterFactory: p.factory,
    });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(p.calls, ["grok", "codex"]);
    assert.deepEqual(
      r.fallbacks.map((f) => [f.from, f.to]),
      [["grok", "codex"]],
    );
    assert.equal(loadRunState(dir, r.packetId).reviewer, "codex");
  });

  it("does not move on for a failure that is not a timeout, nor without a fallback", async () => {
    const dir = initTempRepo();
    const p = products({ codex: "fail", claude: PASS });
    const r = await cmdRun({
      repoRoot: dir,
      reviewer: "codex",
      fallback: "claude",
      adapterFactory: p.factory,
    });
    assert.equal(r.status, "DELIVERY_UNKNOWN");
    assert.deepEqual(p.calls, ["codex"]);
    const dir2 = initTempRepo();
    const q = products({ codex: "timeout" });
    const r2 = await cmdRun({
      repoRoot: dir2,
      reviewer: "codex",
      adapterFactory: q.factory,
    });
    assert.equal(r2.status, "DELIVERY_UNKNOWN");
    assert.equal(r2.fallbacks, undefined);
  });

  it("asks the next consult peer when one times out", async () => {
    const dir = initTempRepo();
    const p = products({ codex: "timeout", claude: "stance: B" });
    const r = await cmdConsult({
      repoRoot: dir,
      peer: "codex",
      fallback: "claude",
      question: "A or B?",
      adapterFactory: p.factory,
    });
    assert.equal(r.ok, true);
    assert.equal(r.peer, "claude");
    assert.deepEqual(
      r.fallbacks.map((f) => f.to),
      ["claude"],
    );
  });
});
