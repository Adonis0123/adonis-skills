import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  deriveState,
  extractPlan,
  parseHeartbeat,
  parseQuestions,
  parseSeat,
  parseVerdicts,
  readRun,
} from "../grill-watch.mjs";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "grill-watch.mjs",
);

const ROUND_1 = `You are the **Proxy** in a grill session.

## The plan

Add Markdown rendering to the detail page.

## Answer format (required, one block per question)

\`\`\`
### Q<n>
- Decision: <the choice> | OPEN
### Q9
\`\`\`

❓ **Q1** - **Where to render**: Build time or in the browser?

Build time keeps the first paint fast.

➡️ Build time, with \`pnpm skills:index\`.

---

❓ **Q2** - **Which highlighter**: Shiki, Prism or highlight.js?

➡️ Shiki.
`;

const ANSWERS_1 = `### Q1
- Decision: Build time
- Reason: the index is already generated at build time
- Evidence: apps/web/src/generated/skills-detail-index.json
- Confidence: high
- Reversibility: easy
- Kind: solution
- Revisit if: pages fetch SKILL.md at runtime
`;

const entry = (name, text, mtimeMs) => ({
  name,
  text: typeof text === "string" ? text : JSON.stringify(text),
  mtimeMs,
});
const meta = entry(
  "watch.json",
  {
    topic: "detail-markdown",
    startedAt: new Date(1000).toISOString(),
    seats: { interviewer: { product: "claude", account: "cc008" } },
  },
  1000,
);

describe("parsers", () => {
  it("reads seats from product:account or launcher names", () => {
    assert.deepEqual(parseSeat("codex:codex003"), {
      product: "codex",
      account: "codex003",
    });
    assert.deepEqual(parseSeat("cc008"), {
      product: "claude",
      account: "cc008",
    });
    assert.deepEqual(parseSeat("grok"), { product: "grok", account: null });
    assert.deepEqual(parseSeat("pi-local"), {
      product: "pi",
      account: "pi-local",
    });
    assert.equal(parseSeat("none"), null);
    assert.equal(parseSeat(undefined), null);
    assert.equal(parseSeat("mystery").product, "unknown");
  });

  it("reads grilling questions and skips the brief's fenced example", () => {
    const qs = parseQuestions(ROUND_1);
    assert.deepEqual(
      qs.map((q) => q.id),
      ["Q1", "Q2"],
    );
    assert.equal(qs[0].title, "Where to render");
    assert.match(
      qs[0].body,
      /Build time or in the browser\?\n\nBuild time keeps/,
    );
    assert.equal(qs[0].recommendation, "Build time, with `pnpm skills:index`.");
    assert.equal(qs[1].recommendation, "Shiki.");
  });

  it("reads heading-style questions and keeps the first copy of an id", () => {
    const qs = parseQuestions(
      "### Q3: Name the role\nBody\nRecommended: Proxy\n### Q3 again\n",
    );
    assert.equal(qs.length, 1);
    assert.equal(qs[0].title, "Name the role");
    assert.equal(qs[0].recommendation, "Proxy");
  });

  it("extracts the plan, red-team verdicts and the last heartbeat", () => {
    assert.equal(
      extractPlan(ROUND_1),
      "Add Markdown rendering to the detail page.",
    );
    assert.equal(extractPlan("no plan here"), "");
    assert.deepEqual(
      parseVerdicts("- Q4 — hold: proven\n- Q7: overturn: no evidence\n"),
      [
        { id: "Q4", verdict: "hold", why: "proven" },
        { id: "Q7", verdict: "overturn", why: "no evidence" },
      ],
    );
    assert.deepEqual(
      parseHeartbeat(
        "noise\n[review-loop] reviewer=codex status=active elapsed=30s timeout=10m\n[review-loop] reviewer=claude status=active elapsed=1m timeout=10m\n",
      ),
      { product: "claude", status: "active", elapsed: "1m", timeout: "10m" },
    );
    assert.equal(parseHeartbeat(""), null);
  });
});

describe("deriveState", () => {
  it("starts with the Interviewer mapping the design tree", () => {
    const s = deriveState([meta], 5000);
    assert.equal(s.phase, "live");
    assert.deepEqual(s.activity, {
      seat: "interviewer",
      task: "map",
      since: 1000,
    });
    assert.equal(s.messages.length, 0);
  });

  it("follows a round from questions to the Proxy, the gate and the next round", () => {
    const round = entry("round-1.md", ROUND_1, 2000);
    let s = deriveState([meta, round], 3000);
    assert.equal(s.activity.seat, "proxy");
    assert.equal(s.activity.task, "answer");
    assert.equal(s.activity.since, 2000);
    assert.deepEqual(
      s.messages.map((m) => m.role),
      ["user", "interviewer"],
    );

    const answers = entry("answers-1.md", ANSWERS_1, 4000);
    s = deriveState([meta, round, answers], 4500);
    assert.equal(s.activity.seat, "judge");
    assert.equal(s.messages.at(-1).answers[0].decision, "Build time");

    const gate = entry(
      "gate-1.json",
      {
        results: [{ id: "Q1", status: "Decided", why: "reversible" }],
        reask: [],
        stop: [],
      },
      5000,
    );
    s = deriveState([meta, round, answers, gate], 6000);
    assert.deepEqual(s.activity, {
      seat: "interviewer",
      task: "next",
      round: 2,
      since: 5000,
    });
  });

  it("sends a re-ask back to the Proxy, then to the gate again", () => {
    const files = [
      meta,
      entry("round-1.md", ROUND_1, 2000),
      entry("answers-1.md", ANSWERS_1, 3000),
      entry(
        "gate-1.json",
        {
          results: [{ id: "Q1", status: "Invalid", fix: ["x"] }],
          reask: [{ id: "Q1" }],
        },
        4000,
      ),
    ];
    let s = deriveState(files, 5000);
    assert.equal(s.activity.task, "retry");
    s = deriveState(
      [...files, entry("answers-1-retry.md", ANSWERS_1, 6000)],
      7000,
    );
    assert.equal(s.activity.seat, "judge");
    assert.equal(s.messages.at(-1).retry, true);
  });

  it("shows the red-team, then closing work, then the finished run", () => {
    const base = [
      meta,
      entry("round-1.md", ROUND_1, 2000),
      entry("answers-1.md", ANSWERS_1, 3000),
      entry(
        "gate-1.json",
        { results: [], reask: [], stop: ["2 rounds without a new decision"] },
        4000,
      ),
    ];
    assert.equal(deriveState(base, 5000).activity.task, "close");
    const red = entry("redteam-question.md", "Q1", 5000);
    assert.equal(deriveState([...base, red], 6000).activity.seat, "redteam");
    const done = [
      ...base,
      red,
      entry("redteam.md", "- Q1 — hold: fine", 7000),
      entry(
        "ledger.json",
        {
          questions: {
            Q1: {
              status: "Escalation",
              decision: "OPEN",
              why: "a fact only the user knows",
            },
          },
        },
        7000,
      ),
      entry(
        "events.jsonl",
        `${JSON.stringify({ kind: "done", text: "docs/grill/x.md", at: new Date(8000).toISOString() })}\n`,
        8000,
      ),
    ];
    const s = deriveState(done, 9000);
    assert.equal(s.phase, "done");
    assert.equal(s.activity, null);
    assert.equal(s.endedAt, 8000);
    assert.equal(s.logPath, "docs/grill/x.md");
    assert.deepEqual(s.totals.Escalation, [
      {
        id: "Q1",
        title: "Where to render",
        decision: "OPEN",
        why: "a fact only the user knows",
        kind: "",
        reversibility: "",
        redteam: { verdict: "hold", why: "fine" },
        amended: null,
      },
    ]);
    assert.deepEqual(
      s.messages.map((m) => m.role),
      ["user", "interviewer", "proxy", "judge", "redteam", "system"],
    );
  });

  it("carries the red-team verdict and the amendment of each decision into totals", () => {
    const amended = { from: "Build time", by: "redteam", round: 2 };
    const s = deriveState(
      [
        meta,
        entry("round-1.md", ROUND_1, 2000),
        entry(
          "ledger.json",
          {
            questions: {
              Q1: {
                status: "Decided",
                decision: "Build time, per package",
                why: "hard to reverse, evidence strong enough",
                kind: "solution",
                reversibility: "costly",
                redteam: {
                  verdict: "overturn",
                  why: "two apps",
                  resolved: true,
                },
                amended,
              },
              Q2: { status: "Decided", decision: "Shiki", why: "reversible" },
            },
          },
          3000,
        ),
      ],
      4000,
    );
    assert.deepEqual(s.totals.Decided, [
      {
        id: "Q1",
        title: "Where to render",
        decision: "Build time, per package",
        why: "hard to reverse, evidence strong enough",
        kind: "solution",
        reversibility: "costly",
        redteam: { verdict: "overturn", why: "two apps" },
        amended,
      },
      {
        id: "Q2",
        title: "Which highlighter",
        decision: "Shiki",
        why: "reversible",
        kind: "",
        reversibility: "",
        redteam: null,
        amended: null,
      },
    ]);
  });

  it("sends an overturn to one more round before the Interviewer closes", () => {
    const decided = (redteam) =>
      entry(
        "ledger.json",
        { questions: { Q1: { status: "Decided", decision: "A", redteam } } },
        4000,
      );
    const gate = (n, at) =>
      entry(`gate-${n}.json`, { results: [], reask: [], stop: [] }, at);
    const base = [
      meta,
      entry("round-1.md", ROUND_1, 2000),
      entry("answers-1.md", ANSWERS_1, 3000),
      gate(1, 4000),
      entry("redteam-question.md", "Q1", 5000),
      entry("redteam.md", "Q1: overturn: two apps", 6000),
    ];
    const open = { verdict: "overturn", why: "two apps" };
    assert.deepEqual(deriveState([...base, decided(open)], 6500).activity, {
      seat: "interviewer",
      task: "next",
      round: 2,
      since: 6000,
    });

    // The red-team round is a normal round: Proxy, gate, then closing.
    const round2 = [
      ...base,
      entry("round-2.md", "❓ **Q1** - **Where**: again", 7000),
    ];
    const asking = deriveState([...round2, decided(open)], 7500).activity;
    assert.equal(asking.seat, "proxy");
    assert.equal(asking.round, 2);
    const answered = [...round2, entry("answers-2.md", ANSWERS_1, 8000)];
    assert.equal(
      deriveState([...answered, decided(open)], 8500).activity.seat,
      "judge",
    );
    assert.deepEqual(
      deriveState(
        [...answered, gate(2, 9000), decided({ ...open, resolved: true })],
        9500,
      ).activity,
      { seat: "interviewer", task: "close", since: 9000 },
    );
  });

  it("keeps the plan first even when round 1 predates start", () => {
    const s = deriveState([meta, entry("round-1.md", ROUND_1, 10)], 2000);
    assert.equal(s.messages[0].role, "user");
  });
});

describe("cli", () => {
  it("serves the run on 127.0.0.1 only, records events and stops by pid", async (t) => {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), "grill-watch-"));
    t.after(() => {
      spawnSync(process.execPath, [SCRIPT, "stop", `--run=${run}`]);
      fs.rmSync(run, { recursive: true, force: true });
    });
    fs.writeFileSync(path.join(run, "round-1.md"), ROUND_1);
    const started = spawnSync(process.execPath, [
      SCRIPT,
      "start",
      `--run=${run}`,
      "--topic=detail-markdown",
      "--interviewer=cc008",
      "--proxy=codex:codex003",
      "--redteam=none",
      "--no-open",
    ]);
    const line = started.stdout.toString();
    const url = line.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
    assert.ok(url, line);

    const state = await (await fetch(new URL("state", url))).json();
    assert.equal(state.topic, "detail-markdown");
    assert.deepEqual(state.seats.proxy, {
      product: "codex",
      account: "codex003",
    });
    assert.equal(state.seats.redteam, null);
    assert.equal(state.activity.seat, "proxy");
    const page = await fetch(url);
    assert.match(await page.text(), /Grill 现场/);
    // fetch drops a custom Host header, so DNS rebinding is simulated with http.get.
    const foreign = await new Promise((resolve, reject) =>
      http
        .get(url, { headers: { host: "evil.example" } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject),
    );
    assert.equal(foreign, 403);

    const ev = spawnSync(process.execPath, [
      SCRIPT,
      "event",
      `--run=${run}`,
      "--kind=done",
      "--text=docs/grill/x.md",
    ]);
    assert.equal(ev.status, 0);
    assert.equal(ev.stdout.toString(), "");
    const bad = spawnSync(process.execPath, [
      SCRIPT,
      "event",
      `--run=${run}`,
      "--kind=oops",
    ]);
    assert.equal(bad.status, 2);

    const again = spawnSync(process.execPath, [
      SCRIPT,
      "start",
      `--run=${run}`,
      "--no-open",
    ]);
    assert.match(again.stdout.toString(), /already running/);
    const stopped = spawnSync(process.execPath, [
      SCRIPT,
      "stop",
      `--run=${run}`,
    ]);
    assert.match(stopped.stdout.toString(), /stopped pid/);
    assert.equal(
      readRun(run).some((f) => f.name === "events.jsonl"),
      true,
    );
  });
});
