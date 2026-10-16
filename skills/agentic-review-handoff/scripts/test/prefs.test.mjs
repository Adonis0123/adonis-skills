/**
 * Reviewer preference: saved order picks the Reviewer and the timeout fallbacks when a run or consult names none.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  prefsPath,
  readPrefs,
  resolveFromPrefs,
  writePrefs,
} from "../review-loop/prefs.mjs";
import { cmdRun } from "../review-loop/auto-run.mjs";
import { cmdConsult } from "../review-loop/consult.mjs";

const cleanup = [];
afterEach(() => {
  while (cleanup.length)
    fs.rmSync(cleanup.pop(), { recursive: true, force: true });
});
const tmp = (p) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  cleanup.push(d);
  return d;
};
const envAt = () => ({
  HOME: tmp("prefs-home-"),
  XDG_CONFIG_HOME: tmp("prefs-xdg-"),
});

function initTempRepo() {
  const dir = tmp("prefs-repo-");
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
const answering = (calls) => (product) => ({
  product,
  getSessionId: () => null,
  async newSession() {
    calls.push(product);
    return { ok: true, text: PASS, sessionId: `${product}-1` };
  },
  async resume() {
    throw new Error("not used");
  },
});

describe("Reviewer preference", () => {
  it("defaults to claude, codex, grok and keeps the host unless skipHost", () => {
    const env = envAt();
    const p = readPrefs(env);
    assert.deepEqual(
      [p.order, p.skipHost, p.source],
      [["claude", "codex", "grok"], false, "default"],
    );
    assert.deepEqual(resolveFromPrefs({ host: "claude", env }), {
      reviewer: "claude",
      fallback: ["codex", "grok"],
      prefs: p,
    });
    assert.equal(
      resolveFromPrefs({ host: "claude", env, forceSkipHost: true }).reviewer,
      "codex",
    );
  });

  it("saves a change, keeps unnamed fields, lets one shell override it, and resets", () => {
    const env = envAt();
    writePrefs(env, { order: "codex,claude" });
    writePrefs(env, { skipHost: true });
    const saved = JSON.parse(fs.readFileSync(prefsPath(env), "utf8"));
    assert.deepEqual(saved, { order: ["codex", "claude"], skipHost: true });
    assert.equal(resolveFromPrefs({ host: "codex", env }).reviewer, "claude");
    assert.equal(
      readPrefs({ ...env, REVIEW_LOOP_REVIEWERS: "grok" }).order[0],
      "grok",
    );
    assert.throws(
      () => writePrefs(env, { order: "claude,gemini" }),
      /codex\|grok\|claude/,
    );
    writePrefs(env, { reset: true });
    assert.equal(readPrefs(env).source, "default");
  });

  it("names the file when it is broken", () => {
    const env = envAt();
    fs.mkdirSync(path.dirname(prefsPath(env)), { recursive: true });
    fs.writeFileSync(prefsPath(env), "{nope");
    assert.throws(() => readPrefs(env), /not valid JSON.*prefs --reset/);
  });

  it("picks the Reviewer and its fallbacks for a run and a consult that pass only --host", async () => {
    const env = envAt();
    writePrefs(env, { order: "codex,claude,grok" });
    const calls = [];
    const r = await cmdRun({
      repoRoot: initTempRepo(),
      host: "claude",
      env,
      rounds: 1,
      adapterFactory: answering(calls),
    });
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(calls, ["codex"]);
    assert.deepEqual(r.reviewerFrom, {
      source: "file",
      order: ["codex", "claude", "grok"],
      host: "claude",
    });
    const c = await cmdConsult({
      repoRoot: initTempRepo(),
      host: "claude",
      env,
      question: "A?",
      adapterFactory: answering(calls),
    });
    assert.equal(c.peer, "codex");
  });

  it("the CLI shows and saves it", () => {
    const env = { ...process.env, ...envAt() };
    const cli = fileURLToPath(new URL("../review-loop.mjs", import.meta.url));
    const set = spawnSync(
      process.execPath,
      [cli, "prefs", "--order=claude,grok", "--skip-host=true"],
      { env, encoding: "utf8" },
    );
    assert.equal(set.status, 0, set.stderr);
    const shown = JSON.parse(
      spawnSync(process.execPath, [cli, "prefs"], { env, encoding: "utf8" })
        .stdout,
    );
    assert.deepEqual(
      [shown.order, shown.skipHost, shown.source],
      [["claude", "grok"], true, "file"],
    );
  });
});
