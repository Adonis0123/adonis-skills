import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendStageAtEof } from "../review-loop/repositories.mjs";

const skill = new URL("../../SKILL.md", import.meta.url);
const cli = fileURLToPath(new URL("../review-loop.mjs", import.meta.url));
test("commit-only exclusion precedes review routes; positive routes remain", () => {
  const evals = JSON.parse(
    fs.readFileSync(new URL("../../evals/evals.json", import.meta.url)),
  );
  const negative = evals.trigger_evals.find(
    (e) => e.id === "neg-ordinary-impl",
  );
  assert.equal(negative.should_trigger, false);
  assert.match(negative.query, /不需要 review/);
  const text = fs.readFileSync(skill, "utf8");
  assert.match(
    text.split("\n").find((l) => l.startsWith("description:")),
    /ordinary implementation or commit-only requests do not start a review loop/,
  );
  const fast = text.split("## Fast Path")[1].split("## Direct Grok")[0];
  assert.match(
    fast.split("\n").find((l) => l.startsWith("- ")),
    /commit only, no review.*do not authorize review/,
  );
  assert.match(
    fast,
    /Explicit review-fix-re-review with same-session implementer context/,
  );
  assert.doesNotMatch(
    text,
    /\*\*Same-session implementer closure\*\*|Visible same-session implementation context uses default/,
  );
  for (const route of [
    "Explicit auto loop",
    "Decision consult",
    "session recovery",
    "Fresh-eyes",
    "feedback_validation",
    "manual_continuation",
  ])
    assert.ok(fast.includes(route), route);
});

test("classic-append writes body and frontmatter and refuses auto-owned packets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classic-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  // Reuse an existing commit object through alternates; no test commit needed.
  const gitDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  fs.writeFileSync(
    path.join(root, ".git/objects/info/alternates"),
    path.resolve(gitDir, "objects") + "\n",
  );
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["update-ref", "refs/heads/test", sha], { cwd: root });
  execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/test"], {
    cwd: root,
  });
  const dir = path.join(root, ".review-handoff/active/test");
  fs.mkdirSync(dir, { recursive: true });
  const packet = path.join(dir, "sample.md");
  const original =
    "---\npacket_id: test/sample\nbranch: test\nmode: classic\nclassic_reason: intake\nlast_anchor: intake\nlifecycle_state: in_progress\n---\n# Review Intake\nOriginal body.\n";
  const body = path.join(root, "body.md");
  fs.writeFileSync(body, "# Review Findings\nVerified findings.\n");
  const args = [
    cli,
    "classic-append",
    "--repo",
    root,
    "--packet",
    packet,
    "--body-file",
    body,
    "--anchor",
    "review_findings",
    "--lifecycle",
    "in_progress",
  ];
  fs.writeFileSync(packet, original);
  let result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const written = fs.readFileSync(packet, "utf8");
  assert.match(written, /last_anchor: review_findings/);
  assert.match(
    written,
    /# Review Intake\nOriginal body\.\n\n# Review Findings\nVerified findings\.\n$/,
  );
  for (const mode of ["auto", "classic"]) {
    fs.writeFileSync(
      packet,
      original.replace("mode: classic", `mode: ${mode}`),
    );
    if (mode === "classic") {
      const runtime = path.join(root, ".review-handoff/runtime/test/sample");
      fs.mkdirSync(runtime, { recursive: true });
      fs.writeFileSync(path.join(runtime, "auto-run-state.json"), "{}");
    }
    result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(
      fs.readFileSync(packet, "utf8"),
      original.replace("mode: classic", `mode: ${mode}`),
    );
  }
});

test("packet append detects changed body bytes even when anchors still match", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "packet-proof-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packet = path.join(root, "packet.md");
  fs.writeFileSync(packet, "---\nlast_anchor: intake\n---\n# Review Intake\n");
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    rename(from, to);
    fs.writeFileSync(
      to,
      fs.readFileSync(to, "utf8").replace("Expected body", "Corrupted body"),
    );
  });
  assert.throws(
    () =>
      appendStageAtEof(packet, {
        sectionMarkdown: "# Review Findings\nExpected body",
        lastAnchor: "review_findings",
        lifecycleState: "in_progress",
      }),
    /disk bytes differ/,
  );
});
