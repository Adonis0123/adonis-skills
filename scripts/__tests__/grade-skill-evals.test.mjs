import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const graderPath = path.join(repoRoot, "scripts/grade-skill-evals.mjs");

async function runWorkflowEval41(runtimeSkill) {
  const outputsDir = await mkdtemp(
    path.join(os.tmpdir(), "grade-skill-evals-"),
  );
  const outputDir = path.join(
    outputsDir,
    "eval-41",
    "with_skill",
    "run-1",
    "outputs",
  );
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "output.txt"),
    [
      "Workflow Gate",
      "- Route: Architecture",
      `- Runtime skill: ${runtimeSkill}`,
      "- Fallback alias: none",
      "- Execution path: n/a",
    ].join("\n"),
  );

  const result = spawnSync(
    process.execPath,
    [graderPath, "workflow-gate", outputsDir],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  await rm(outputsDir, { recursive: true, force: true });
  return result;
}

test("fails when Route matches but Runtime skill regresses", async () => {
  const result = await runWorkflowEval41("none");

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Runtime skill=none.*expected=architecture-hardening-loop/,
  );
});

test("passes when Route and Runtime skill both match", async () => {
  const result = await runWorkflowEval41("architecture-hardening-loop");

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
