import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkRound,
  classify,
  parseAnswers,
  validate,
} from "../grill-ledger.mjs";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "grill-ledger.mjs",
);

function block(id, over = {}) {
  const f = {
    Decision: "Use library X",
    Reason: "maintained and already a dependency",
    Evidence: "https://github.com/example/x; package.json",
    Confidence: "high",
    Reversibility: "easy",
    Kind: "solution",
    "Revisit if": "X stops being maintained",
    ...over,
  };
  const lines = Object.entries(f)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `- ${k}: ${v}`);
  return `### ${id}\n${lines.join("\n")}\n`;
}

const fresh = () => ({ rounds: [], questions: {} });

describe("parse and validate", () => {
  it("reads every field of a Q block", () => {
    const [b] = parseAnswers(block("Q1"));
    assert.equal(b.id, "Q1");
    assert.deepEqual(validate(b.fields), []);
    assert.equal(b.fields.revisit, "X stops being maintained");
  });

  it("phrases each problem as a fix", () => {
    const [b] = parseAnswers(
      block("Q2", { Evidence: "none", Confidence: "sure" }),
    );
    const problems = validate(b.fields);
    assert.ok(
      problems.some((p) => /solution answers need at least one URL/.test(p)),
    );
    assert.ok(problems.some((p) => /high, medium or low/.test(p)));
  });
});

describe("classify", () => {
  const f = (over) => parseAnswers(block("Q1", over))[0].fields;
  it("escalates side effects, open questions and costly low-confidence choices", () => {
    assert.equal(classify(f({ Kind: "side-effect" })).status, "Escalation");
    assert.equal(
      classify(f({ Kind: "fact", Decision: "OPEN", Evidence: "none" })).status,
      "Escalation",
    );
    assert.equal(
      classify(f({ Reversibility: "costly", Confidence: "low" })).status,
      "Escalation",
    );
  });

  it("decides a costly choice with strong evidence but flags it for red-team", () => {
    const r = classify(f({ Reversibility: "costly", Confidence: "high" }));
    assert.equal(r.status, "Decided");
    assert.equal(r.hardToReverse, true);
  });

  it("records taste as an Assumption", () => {
    assert.equal(
      classify(f({ Kind: "taste", Evidence: "none" })).status,
      "Assumption",
    );
  });
});

describe("checkRound", () => {
  it("rejects empty replies without changing history or a pending re-ask", () => {
    const ledger = fresh();
    checkRound({ answers: block("Q1"), ledger, round: 1 });
    checkRound({
      answers: block("Q2") + block("Q3", { Reason: null }),
      ledger,
      round: 2,
    });
    const before = structuredClone(ledger);
    for (const answers of ["", "No structured answer."]) {
      const result = checkRound({ answers, ledger, round: 2, attempt: 2 });
      assert.equal(result.ok, false);
      assert.match(result.error, /### Q<n>/);
      assert.equal(result.parsed, 0);
      assert.deepEqual(result.stop, []);
      assert.deepEqual(ledger, before);
    }
    checkRound({ answers: block("Q3"), ledger, round: 2, attempt: 2 });
    assert.equal(ledger.rounds[1].newDecisions, 2);
  });

  it("re-asks once, then keeps a still-broken answer as an unverified Assumption", () => {
    const ledger = fresh();
    const broken = block("Q1", { Reason: null });
    const first = checkRound({ answers: broken, ledger, round: 1 });
    assert.equal(first.ok, false);
    assert.equal(first.reask[0].id, "Q1");
    assert.equal(ledger.rounds.length, 0);

    const second = checkRound({
      answers: broken,
      ledger,
      round: 1,
      attempt: 2,
    });
    assert.equal(second.ok, true);
    assert.equal(ledger.questions.Q1.status, "Assumption");
    assert.match(ledger.questions.Q1.why, /^UNVERIFIED/);
    assert.equal(ledger.rounds[0].newDecisions, 1);
  });

  it("carries new decisions across a re-ask of the same round", () => {
    const ledger = fresh();
    checkRound({
      answers: block("Q1") + block("Q2", { Reason: null }),
      ledger,
      round: 1,
    });
    checkRound({ answers: block("Q2"), ledger, round: 1, attempt: 2 });
    assert.equal(ledger.rounds.length, 1);
    assert.equal(ledger.rounds[0].newDecisions, 2);
  });

  it("escalates a question whose answer changed twice", () => {
    const ledger = fresh();
    checkRound({ answers: block("Q1", { Decision: "A" }), ledger, round: 1 });
    checkRound({ answers: block("Q1", { Decision: "B" }), ledger, round: 2 });
    const third = checkRound({
      answers: block("Q1", { Decision: "A" }),
      ledger,
      round: 3,
    });
    assert.equal(ledger.questions.Q1.status, "Escalation");
    assert.ok(third.totals.Escalation.includes("Q1"));
  });

  it("stops after two rounds without a new decision", () => {
    const ledger = fresh();
    checkRound({ answers: block("Q1"), ledger, round: 1 });
    checkRound({ answers: block("Q1"), ledger, round: 2 });
    const r = checkRound({ answers: block("Q1"), ledger, round: 3 });
    assert.deepEqual(r.stop, ["2 rounds without a new decision"]);
  });

  it("stops at the round cap", () => {
    const ledger = fresh();
    let r;
    for (let i = 1; i <= 8; i += 1)
      r = checkRound({ answers: block(`Q${i}`), ledger, round: i });
    assert.ok(r.stop.includes("reached 8 rounds"));
  });
});

describe("cli", () => {
  it("does not create a ledger and exits 1 with a fix when no blocks are found", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grill-ledger-"));
    const answers = path.join(dir, "a.md");
    const ledger = path.join(dir, "state", "ledger.json");
    fs.writeFileSync(answers, "I think we should use X.");
    let out;
    try {
      execFileSync("node", [
        SCRIPT,
        "check",
        `--answers=${answers}`,
        `--ledger=${ledger}`,
        "--round=1",
      ]);
      assert.fail("expected exit 1");
    } catch (err) {
      assert.equal(err.status, 1);
      out = JSON.parse(err.stdout.toString());
    }
    assert.match(out.error, /### Q<n>/);
    assert.equal(fs.existsSync(ledger), false);
    assert.equal(fs.existsSync(path.dirname(ledger)), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

it("cli preserves an existing ledger byte-for-byte on an empty reply", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grill-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const answers = path.join(dir, "a.md");
  const file = path.join(dir, "ledger.json");
  const ledger = fresh();
  checkRound({ answers: block("Q1"), ledger, round: 1 });
  checkRound({
    answers: block("Q2") + block("Q3", { Reason: null }),
    ledger,
    round: 2,
  });
  const before = JSON.stringify(ledger);
  fs.writeFileSync(file, before);
  fs.writeFileSync(answers, "No answer blocks.");
  assert.throws(
    () =>
      execFileSync("node", [
        SCRIPT,
        "check",
        `--answers=${answers}`,
        `--ledger=${file}`,
        "--round=2",
        "--attempt=2",
      ]),
    (err) => {
      assert.equal(err.status, 1);
      assert.match(JSON.parse(err.stdout.toString()).error, /### Q<n>/);
      return true;
    },
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

describe("review regressions", () => {
  it("escalates concrete user-only facts", () => {
    const answers = block("Q1", { Kind: "fact", Evidence: "none" });
    assert.equal(
      classify(parseAnswers(answers)[0].fields).status,
      "Escalation",
    );
    assert.deepEqual(
      checkRound({ answers, ledger: fresh(), round: 1 }).totals.Escalation,
      ["Q1"],
    );
  });
  it("keeps incomplete side effects and facts escalated after re-ask", () => {
    for (const Kind of ["side-effect", "fact"]) {
      const ledger = fresh();
      checkRound({
        answers: block("Q1", { Kind, Reason: null }),
        ledger,
        round: 1,
        attempt: 2,
      });
      assert.equal(ledger.questions.Q1.status, "Escalation");
      assert.match(ledger.questions.Q1.why, /^UNVERIFIED/);
    }
  });
  it("requires a source-shaped solution reference", () => {
    for (const Evidence of ["looked at the repo", "none", "n/a"]) {
      assert.ok(
        validate(parseAnswers(block("Q1", { Evidence }))[0].fields).some((p) =>
          /solution answers/.test(p),
        ),
      );
    }
    for (const Evidence of [
      "https://example.com",
      "http://example.com",
      "package.json",
      "src/index.ts:12",
      "README.md",
      "docs/adr/",
      "`src/index.ts`",
      "[docs](https://example.com)",
    ]) {
      assert.deepEqual(
        validate(parseAnswers(block("Q1", { Evidence }))[0].fields),
        [],
        Evidence,
      );
    }
  });
  it("runs the CLI from an encoded directory using relative and absolute paths", (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grill cli #"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = path.join(dir, "grill-ledger.mjs");
    fs.copyFileSync(SCRIPT, script);
    fs.writeFileSync(path.join(dir, "a.md"), block("Q1"));
    for (const entry of [script, "grill-ledger.mjs"]) {
      const usage = spawnSync(process.execPath, [entry], {
        cwd: dir,
        encoding: "utf8",
      });
      assert.equal(usage.status, 2);
      assert.match(JSON.parse(usage.stdout).error, /usage:/);
      const run = spawnSync(
        process.execPath,
        [entry, "check", "--answers=a.md", "--ledger=l.json", "--round=1"],
        { cwd: dir, encoding: "utf8" },
      );
      assert.equal(run.status, 0);
      assert.equal(JSON.parse(run.stdout).ok, true);
    }
  });
});

it("can be imported with a non-file argv entry without running the CLI", () => {
  const code = `process.argv[1] = 'offline-eval'; await import(${JSON.stringify(SCRIPT)}); console.log('imported');`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "imported");
});

it("preserves recognizable costly-low and OPEN escalation on malformed retries", () => {
  for (const over of [
    { Reversibility: "costly", Confidence: "low" },
    { Decision: "OPEN" },
  ]) {
    const ledger = fresh();
    checkRound({
      answers: block("Q1", { ...over, Reason: null }),
      ledger,
      round: 1,
      attempt: 2,
    });
    assert.equal(ledger.questions.Q1.status, "Escalation");
    assert.match(ledger.questions.Q1.why, /^UNVERIFIED/);
  }
});

it("accepts absolute paths and existing extensionless repository files as evidence", () => {
  for (const Evidence of [
    path.resolve("package.json"),
    "LICENSE",
    "`LICENSE`",
    "none; LICENSE",
  ]) {
    assert.deepEqual(
      validate(parseAnswers(block("Q1", { Evidence }))[0].fields),
      [],
      Evidence,
    );
  }
  assert.ok(
    validate(
      parseAnswers(block("Q1", { Evidence: "looked at the repo" }))[0].fields,
    ).length,
  );
});

it("distinguishes OPEN sentinels from ordinary action decisions", () => {
  for (const Decision of [
    "OPEN",
    "OPEN: missing recipient",
    "OPEN — missing recipient",
    "OPEN - missing recipient",
  ]) {
    assert.equal(
      classify(parseAnswers(block("Q1", { Decision }))[0].fields).status,
      "Escalation",
    );
  }
  assert.equal(
    classify(
      parseAnswers(block("Q1", { Decision: "Open-source library" }))[0].fields,
    ).status,
    "Decided",
  );
  const fields = parseAnswers(
    block("Q1", { Decision: "Open the settings page", Evidence: "none" }),
  )[0].fields;
  assert.equal(classify(fields).status, "Decided");
  assert.ok(validate(fields).some((p) => /solution answers/.test(p)));
});

it("rejects version and prose dots but accepts existing bare file citations", () => {
  for (const Evidence of ["v1.2", "e.g.", "looked at the repo"]) {
    assert.ok(
      validate(parseAnswers(block("Q1", { Evidence }))[0].fields).length,
      Evidence,
    );
  }
  for (const Evidence of [
    "package.json",
    "`package.json`:12",
    "`README.md:12`",
    "package.json:12",
    "[manifest](package.json)",
    "LICENSE",
  ]) {
    assert.deepEqual(
      validate(parseAnswers(block("Q1", { Evidence }))[0].fields),
      [],
      Evidence,
    );
  }
});

it("documents pi pairing through explicit peers rather than unsupported host routing", () => {
  const skill = fs.readFileSync(
    path.join(path.dirname(SCRIPT), "..", "SKILL.md"),
    "utf8",
  );
  assert.match(skill, /Interviewer is pi.*review-loop prefs.*--peer/s);
  assert.match(skill, /Do not pass `--host=pi`/);
});
