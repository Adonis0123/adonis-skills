import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { cmdConsult } from "../review-loop/consult.mjs";
import { cmdSessions } from "../review-loop/sessions.mjs";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "consult-"));
  cleanup.push(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# t\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", "i"], { cwd: dir });
  return dir;
}

describe("consult", () => {
  it("one-shot advisory records to runtime/consults", async () => {
    const dir = initTempRepo();
    const qf = path.join(dir, "q.md");
    fs.writeFileSync(
      qf,
      `## 用户原话\n该用 A 还是 B？\n\n## 需要决定的问题\n选型\n\n## 已知事实\n- x\n`,
    );
    const result = await cmdConsult({
      repoRoot: dir,
      peer: "codex",
      questionFile: qf,
      adapterFactory: () => ({
        product: "codex",
        getSessionId: () => null,
        async newSession() {
          return {
            ok: true,
            text: "Stance: prefer A because ...",
            sessionId: "c1",
          };
        },
        async resume() {
          throw new Error("consult should not resume");
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, "advisory");
    assert.ok(fs.existsSync(result.recordPath));
    const rec = fs.readFileSync(result.recordPath, "utf8");
    assert.match(rec, /DecisionConsult/);
    assert.match(rec, /prefer A/);
    assert.match(result.message, /advisory/i);
  });

  it("passes the peer launcher to the adapter and records it", async () => {
    const dir = initTempRepo();
    let seenCommand;
    const result = await cmdConsult({
      repoRoot: dir,
      peer: "grok",
      peerCommand: "grok002",
      question: "A or B?",
      adapterFactory: (_product, cfg) => {
        seenCommand = cfg.command;
        return {
          product: "grok",
          getSessionId: () => null,
          async newSession() {
            return { ok: true, text: "Stance: B", sessionId: "g1" };
          },
          async resume() {
            throw new Error("consult should not resume");
          },
        };
      },
    });
    assert.equal(seenCommand, "grok002");
    assert.equal(result.peerCommand, "grok002");
    assert.match(
      fs.readFileSync(result.recordPath, "utf8"),
      /- command: grok002/,
    );
  });

  it("records the consult session so review-loop sessions can resume it", async () => {
    const dir = initTempRepo();
    const fake = (sessionId) => () => ({
      product: "claude",
      getSessionId: () => null,
      async newSession() {
        return { ok: true, text: "Stance: A", sessionId };
      },
      async resume() {
        throw new Error("consult should not resume");
      },
    });
    const withId = await cmdConsult({
      repoRoot: dir,
      peer: "claude",
      peerCommand: "cc002",
      question: "A or B?",
      adapterFactory: fake("eeeeeeee-0000-0000-0000-000000000005"),
    });
    assert.equal(withId.sessionId, "eeeeeeee-0000-0000-0000-000000000005");
    const noId = await cmdConsult({
      repoRoot: dir,
      peer: "grok",
      question: "A or B?",
      adapterFactory: fake(null),
    });
    assert.equal(
      fs.existsSync(noId.recordPath.replace(/\.md$/, ".session.json")),
      false,
    );

    const listed = cmdSessions({ repoRoot: dir });
    assert.equal(listed.count, 1);
    assert.equal(listed.sessions[0].packetId, null);
    assert.equal(listed.sessions[0].consultRecord, withId.recordPath);
    assert.equal(
      listed.sessions[0].resume.interactive,
      "cc002 --resume eeeeeeee-0000-0000-0000-000000000005",
    );
  });
});
