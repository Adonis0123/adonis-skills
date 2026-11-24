import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cmdConsult } from "../review-loop/consult.mjs";
import {
  declaredRound,
  detectReviewIntent,
  resolveReviewWorktree,
} from "../review-loop/review-rounds.mjs";
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

  it("resumes a recorded consult in the same session and appends the round", async () => {
    const dir = initTempRepo();
    const calls = [];
    const factory = (_product, cfg) => ({
      product: "codex",
      getSessionId: () => null,
      async newSession(prompt) {
        calls.push({ mode: "new", prompt, cfg });
        return { ok: true, text: "Round one answer", sessionId: "s-1" };
      },
      async resume(sid, prompt) {
        calls.push({ mode: "resume", sid, prompt, cfg });
        return { ok: true, text: "Round two answer", sessionId: sid };
      },
    });
    const first = await cmdConsult({
      repoRoot: dir,
      peer: "codex",
      peerCommand: "codex003",
      question: "You are the Proxy. Q1?",
      raw: true,
      web: true,
      adapterFactory: factory,
    });
    assert.equal(calls[0].prompt, "You are the Proxy. Q1?");
    assert.equal(calls[0].cfg.web, true);
    assert.equal(first.round, 1);

    const second = await cmdConsult({
      repoRoot: dir,
      resume: first.recordPath,
      question: "Q2?",
      raw: true,
      adapterFactory: factory,
    });
    assert.equal(calls[1].mode, "resume");
    assert.equal(calls[1].sid, "s-1");
    assert.equal(calls[1].cfg.command, "codex003");
    assert.equal(second.recordPath, first.recordPath);
    assert.equal(second.round, 2);
    assert.equal(second.resumed, true);
    assert.equal(second.contextLost, false);
    const rec = fs.readFileSync(first.recordPath, "utf8");
    assert.match(rec, /## Follow-up 2\n\nQ2\?/);
    assert.match(rec, /Round two answer/);
    const sidecar = JSON.parse(
      fs.readFileSync(
        first.recordPath.replace(/\.md$/, ".session.json"),
        "utf8",
      ),
    );
    assert.equal(sidecar.round, 2);
  });

  it("keeps the advisory framing unless raw is set", async () => {
    const dir = initTempRepo();
    let seen;
    await cmdConsult({
      repoRoot: dir,
      peer: "claude",
      question: "A or B?",
      adapterFactory: () => ({
        product: "claude",
        getSessionId: () => null,
        async newSession(prompt) {
          seen = prompt;
          return { ok: true, text: "A", sessionId: null };
        },
        async resume() {
          throw new Error("unused");
        },
      }),
    });
    assert.match(seen, /decision consult peer/);
  });

  it("rejects a peer that does not own the resumed session", async () => {
    const dir = initTempRepo();
    const first = await cmdConsult({
      repoRoot: dir,
      peer: "grok",
      question: "Q1?",
      adapterFactory: () => ({
        product: "grok",
        getSessionId: () => null,
        async newSession() {
          return { ok: true, text: "A", sessionId: "g-1" };
        },
        async resume() {
          throw new Error("unused");
        },
      }),
    });
    await assert.rejects(
      cmdConsult({
        repoRoot: dir,
        resume: first.recordPath,
        peer: "claude",
        question: "Q2?",
      }),
      /belongs to grok/,
    );
  });
});

describe("consult as code review: round budget and review framing", () => {
  const HOUR = 60 * 60 * 1000;
  const T0 = Date.parse("2026-11-20T10:00:00Z");

  function setup() {
    const dir = initTempRepo();
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "consult-state-"));
    cleanup.push(state);
    const env = { HOME: state, XDG_STATE_HOME: state };
    const stateFile = path.join(
      state,
      "agentic-review-handoff",
      "consult-rounds.json",
    );
    return { dir, env, stateFile };
  }

  function fakePeer(answer = { ok: true, text: "PASS", sessionId: null }) {
    const prompts = [];
    return {
      prompts,
      factory: () => ({
        product: "codex",
        getSessionId: () => null,
        async newSession(prompt) {
          prompts.push(prompt);
          return answer;
        },
        async resume(_sid, prompt) {
          prompts.push(prompt);
          return answer;
        },
      }),
    };
  }

  function reviewQuestion(dir, extra = "") {
    return `审查 worktree ${dir}，git diff main..HEAD。只读，不改文件。${extra}\n回复：结论 PASS/FAIL。`;
  }

  async function consultReview(s, opts) {
    const lines = [];
    const peer = opts.peer ?? fakePeer();
    const result = await cmdConsult({
      repoRoot: s.dir,
      peer: "codex",
      env: s.env,
      now: T0,
      stderr: (l) => lines.push(l),
      adapterFactory: peer.factory,
      ...opts,
      peer: "codex",
    });
    return { result, lines, prompts: peer.prompts };
  }

  it("detects review intent only with a diff or worktree plus a review word", () => {
    const r1 =
      "审查 worktree /Users/x/.worktrees/lane/h4-home 上 git diff feat/mcp-app-shell..HEAD（3 个提交）。只读，不改文件。回复：结论 PASS/FAIL";
    const r5 =
      "第 5 轮审查：worktree /Users/x/.worktrees/lane/h4-home，新增提交 2cad7c32ad0（git diff 7f508c4ab89..HEAD）。只读，不改文件。";
    assert.equal(detectReviewIntent(r1), true);
    assert.equal(detectReviewIntent(r5), true);
    assert.equal(detectReviewIntent("Please review a1b2c3d..HEAD"), true);
    assert.equal(detectReviewIntent("该用 A 还是 B？"), false);
    assert.equal(detectReviewIntent("请评审这个方案：A 还是 B？"), false);
    assert.equal(
      detectReviewIntent("worktree /Users/x/.worktrees/a 上该选 A 还是 B？"),
      false,
    );
    assert.equal(detectReviewIntent("git diff a..b 之后选 A 还是 B？"), false);
    assert.equal(
      detectReviewIntent("review-loop 的 worktree /tmp/w 该怎么设计？"),
      false,
    );
    assert.equal(
      detectReviewIntent(
        "参考 /Users/x/.worktrees/a/specs/H4-review-r4.md，缓存该用 A 还是 B？",
      ),
      false,
    );
    assert.equal(
      detectReviewIntent(
        "agentic-review-handoff 的 git diff a1..HEAD 引入了新状态文件，该不该保留？",
      ),
      false,
    );
    assert.equal(detectReviewIntent("git diff a1..HEAD, please review."), true);
    assert.equal(detectReviewIntent("re-review worktree /tmp/w"), true);
  });

  it("reads declared rounds from text and from the file name's -rN-, not from cited files", () => {
    assert.equal(
      declaredRound("第 5 轮审查。你第 4 轮的发现见 H4-r4-fix.md"),
      5,
    );
    assert.equal(declaredRound("第五轮复审"), 5);
    assert.equal(declaredRound("round 6 re-review"), 6);
    assert.equal(declaredRound("返工见 H4-r8-fix.md"), 0);
    assert.equal(declaredRound("x", "/s/H4-review-r7-question.md"), 7);
    assert.equal(declaredRound("x", "/s/dialog-size-review-question.md"), 0);
  });

  it("finds the worktree even when a full-width comma follows the path", () => {
    const s = setup();
    const text = `第 5 轮审查：worktree ${s.dir}，新增提交（git diff a1..HEAD）`;
    assert.equal(resolveReviewWorktree(text, s.dir), fs.realpathSync(s.dir));
  });

  it("counts rounds per target, refuses round 4 before calling the peer", async () => {
    const s = setup();
    const q = reviewQuestion(s.dir);
    for (const n of [1, 2, 3]) {
      const { result, prompts } = await consultReview(s, { question: q });
      assert.equal(result.ok, true);
      assert.equal(result.reviewRound.round, n);
      assert.equal(result.reviewRound.limit, 3);
      assert.match(prompts[0], new RegExp(`第 ${n} 轮审查，上限 3 轮`));
    }
    const before = fs.readFileSync(s.stateFile, "utf8");
    const peer = fakePeer();
    const { result, lines } = await consultReview(s, { question: q, peer });
    assert.equal(result.ok, false);
    assert.equal(result.status, "review_round_limit");
    assert.equal(result.reviewRound.round, 4);
    assert.equal(peer.prompts.length, 0, "peer must not be called");
    assert.match(lines.join("\n"), /已拒绝.*第 4 轮代码审查，上限 3 轮/);
    assert.match(lines.join("\n"), /sideby unattended defer/);
    assert.match(lines.join("\n"), /P0\/P1 时不合并/);
    assert.equal(fs.readFileSync(s.stateFile, "utf8"), before);
  });

  it("separates lanes on one branch by the question-file prefix", async () => {
    const s = setup();
    for (const lane of ["H4", "H4", "F23"]) {
      const qf = path.join(s.dir, `${lane}-review-question.md`);
      fs.writeFileSync(qf, reviewQuestion(s.dir));
      var { result } = await consultReview(s, { questionFile: qf });
    }
    assert.equal(result.reviewRound.round, 1);
    assert.equal(result.reviewRound.prefix, "F23");
  });

  it("restarts the count after 8 idle hours", async () => {
    const s = setup();
    const q = reviewQuestion(s.dir);
    await consultReview(s, { question: q });
    await consultReview(s, { question: q, now: T0 + HOUR });
    const within = await consultReview(s, {
      question: q,
      now: T0 + 9 * HOUR - 1,
    });
    assert.equal(within.result.reviewRound.round, 3);
    const after = await consultReview(s, {
      question: q,
      now: T0 + 17 * HOUR + 1,
    });
    assert.equal(after.result.reviewRound.round, 1);
  });

  it("uses the declared round when it is ahead of the count", async () => {
    const s = setup();
    const second = await consultReview(s, {
      question: `第 2 轮复审：${reviewQuestion(s.dir)}`,
    });
    assert.equal(second.result.reviewRound.round, 2);
    assert.match(second.prompts[0], /只核对上一轮的阻塞项是否修好/);
    assert.match(second.prompts[0], /同类的其他实例/);

    const qf = path.join(s.dir, "H4-review-r5-question.md");
    fs.writeFileSync(qf, reviewQuestion(s.dir));
    const peer = fakePeer();
    const fifth = await consultReview(s, { questionFile: qf, peer });
    assert.equal(fifth.result.status, "review_round_limit");
    assert.equal(fifth.result.reviewRound.round, 5);
    assert.equal(peer.prompts.length, 0);
  });

  it("lets a user grant extra rounds and reports the grant", async () => {
    const s = setup();
    const early = await consultReview(s, {
      question: reviewQuestion(s.dir),
      env: { ...s.env, REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER: "2" },
    });
    assert.equal(early.result.reviewRound.extraRoundsGrantedByUser, undefined);
    assert.equal(early.lines.length, 0);
    const qf = path.join(s.dir, "H4-review-r5-question.md");
    fs.writeFileSync(qf, reviewQuestion(s.dir));
    const denied = await consultReview(s, {
      questionFile: qf,
      env: { ...s.env, REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER: "abc" },
    });
    assert.equal(denied.result.status, "review_round_limit");

    const { result, lines } = await consultReview(s, {
      questionFile: qf,
      env: { ...s.env, REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER: "2" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.reviewRound.round, 5);
    assert.equal(result.reviewRound.limit, 5);
    assert.equal(result.reviewRound.extraRoundsGrantedByUser, 2);
    assert.match(
      lines.join("\n"),
      /REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER=2 granted by the user/,
    );
    assert.match(
      fs.readFileSync(result.recordPath, "utf8"),
      /review round: 5\/5 \(REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER=2, granted by the user\)/,
    );
    const log = fs.readFileSync(
      path.join(path.dirname(s.stateFile), "consult-rounds.log"),
      "utf8",
    );
    assert.match(log, /round=5 limit=5 REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER=2/);
  });

  it("lets the review through with one warning when the round state is unreadable", async () => {
    const s = setup();
    fs.mkdirSync(path.dirname(s.stateFile), { recursive: true });
    fs.writeFileSync(s.stateFile, "{ not json");
    const { result, lines, prompts } = await consultReview(s, {
      question: `第 6 轮审查：${reviewQuestion(s.dir)}`,
    });
    assert.equal(result.ok, true);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /BLOCKED \/ PASS_WITH_CONCERNS \/ PASS/);
    assert.equal(lines.filter((l) => /warning/.test(l)).length, 1);
    assert.match(lines[0], /round count unavailable, continuing/);
  });

  it("does not use up a round when the peer delivery fails", async () => {
    const s = setup();
    const peer = fakePeer({ ok: false, error: "boom" });
    const { result } = await consultReview(s, {
      question: reviewQuestion(s.dir),
      peer,
    });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(s.stateFile), false);
  });

  it("frames a review with the blocking rubric and keeps the question whole after it", async () => {
    const s = setup();
    const q = reviewQuestion(s.dir);
    const { prompts } = await consultReview(s, { question: q });
    const prompt = prompts[0];
    assert.doesNotMatch(prompt, /decision consult peer/);
    assert.match(prompt, /BLOCKED \/ PASS_WITH_CONCERNS \/ PASS/);
    assert.match(prompt, /已复现、由本次 diff 引入、在真实用户路径上/);
    assert.match(prompt, /StrictMode 双挂载/);
    assert.match(prompt, /\[阻塞\]\/\[非阻塞\]、本次引入\/存量、已复现\/推测/);
    assert.match(prompt, /优先于下方问题里的格式要求/);
    assert.doesNotMatch(prompt, /只核对上一轮/);
    assert.ok(prompt.endsWith(`--- 原问题 ---\n${q.trim()}`));
  });

  it("--raw keeps the prompt unchanged but still counts rounds", async () => {
    const s = setup();
    const q = reviewQuestion(s.dir);
    for (const n of [1, 2, 3]) {
      const { prompts, result } = await consultReview(s, {
        question: q,
        raw: true,
      });
      assert.equal(prompts[0], q.trim());
      assert.equal(result.reviewRound.round, n);
    }
    const { result } = await consultReview(s, { question: q, raw: true });
    assert.equal(result.status, "review_round_limit");
  });

  it("leaves decision consults and grill rounds alone", async () => {
    const s = setup();
    const { prompts, result } = await consultReview(s, {
      question: "第 9 轮：worktree 布局该用 A 还是 B？",
    });
    assert.match(prompts[0], /decision consult peer/);
    assert.equal(result.reviewRound, undefined);
    const raw = await consultReview(s, {
      question: "You are the Proxy. Round 7: should the plan keep /tmp/x?",
      raw: true,
    });
    assert.equal(raw.result.ok, true);
    assert.equal(fs.existsSync(s.stateFile), false);
  });

  it("CLI exits non-zero with the Chinese next steps on stderr", () => {
    const s = setup();
    const qf = path.join(s.dir, "H4-review-r4-question.md");
    fs.writeFileSync(qf, reviewQuestion(s.dir));
    const cli = fileURLToPath(new URL("../review-loop.mjs", import.meta.url));
    const env = { ...process.env, ...s.env };
    delete env.REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER;
    const run = spawnSync(
      process.execPath,
      [
        cli,
        "consult",
        `--repo=${s.dir}`,
        "--peer=codex",
        `--question-file=${qf}`,
      ],
      { encoding: "utf8", env },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /已拒绝/);
    assert.match(run.stderr, /下一步/);
    assert.equal(JSON.parse(run.stdout).status, "review_round_limit");
  });
});
