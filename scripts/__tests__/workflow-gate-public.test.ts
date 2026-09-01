import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const workflowDir = path.join(repoRoot, "skills/workflow-gate");

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

test("public workflow-gate source is portable", async () => {
  const files = await collectFiles(workflowDir);
  assert.ok(files.some((file) => file.endsWith("/SKILL.md")));

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(
      content,
      /\/Users\//,
      `${path.relative(repoRoot, file)} contains a machine-private path`,
    );
  }
});

test("workflow-gate keeps intent and fallback contracts internally consistent", async () => {
  const skill = await readFile(path.join(workflowDir, "SKILL.md"), "utf8");
  const core = await readFile(
    path.join(workflowDir, "references/examples-core.md"),
    "utf8",
  );
  const edge = await readFile(
    path.join(workflowDir, "references/examples-edge.md"),
    "utf8",
  );
  const systems = await readFile(
    path.join(workflowDir, "references/workflow-systems.md"),
    "utf8",
  );
  const adjustments = await readFile(
    path.join(workflowDir, "references/route-adjustments.md"),
    "utf8",
  );

  assert.match(skill, /user-intent=<lookup \| ideate \|/);
  assert.match(
    core.split("## Light + direct local work")[0],
    /user-intent=lookup/,
  );
  assert.doesNotMatch(skill, /RFC\/spec ready or broad resolved scope/);
  assert.match(skill, /never turns immediate `implement` intent into Plan/);
  assert.match(
    systems,
    /Plan\*\* only for task breakdown, or \*\*Light\*\* for direct implementation regardless of scope/,
  );
  assert.doesNotMatch(systems, /Light \+ TDD for small direct implementation/);
  assert.match(adjustments, /direct implementation, regardless of file count/);
  assert.match(core, /give me a task breakdown for wiring Google OAuth/);
  assert.match(edge, /先给我一份.*任务拆解，不要实现/);

  const allowedFallbacks = new Set([
    "none",
    "superpowers:test-driven-development",
    "<none | superpowers:test-driven-development>",
  ]);
  for (const content of [skill, core, edge]) {
    for (const match of content.matchAll(/^- Fallback alias: (.+)$/gm)) {
      assert.ok(
        allowedFallbacks.has(match[1]),
        `unsupported fallback alias: ${match[1]}`,
      );
    }
  }
});

test("workflow-gate evals cover lookup, broad direct work, and fail-closed handoff", async () => {
  const evals = JSON.parse(
    await readFile(path.join(workflowDir, "evals/evals.json"), "utf8"),
  ) as {
    evals: Array<{
      expected_route: string;
      expectations: string[];
      name: string;
    }>;
  };

  const byName = new Map(evals.evals.map((entry) => [entry.name, entry]));
  const lookup = byName.get("skip-path-readonly-lookup");
  const debug = byName.get("high-risk-bug-stays-read-only-debug-first");
  const broad = byName.get("broad-resolved-direct-implementation-stays-light");
  const missing = byName.get("required-docs-wrapper-not-callable-fails-closed");

  assert.ok(
    lookup?.expectations.some((item) => item.includes("user-intent=lookup")),
  );
  assert.ok(debug?.expectations.includes("Fallback alias is exactly none"));
  assert.equal(broad?.expected_route, "Light");
  assert.equal(missing?.expected_route, "failure-block");
  assert.ok(
    missing?.expectations.some((item) => item.includes("MISSING_DEPENDENCIES")),
  );
});

test("workflow-gate trigger evals cover routing intent and direct downstream bypass", async () => {
  const triggers = JSON.parse(
    await readFile(path.join(workflowDir, "evals/trigger-eval.json"), "utf8"),
  ) as Array<{ query: string; should_trigger: boolean }>;

  assert.ok(
    triggers.some(
      (entry) =>
        entry.should_trigger &&
        /本轮不执行 migration/.test(entry.query) &&
        /route/.test(entry.query),
    ),
  );
  assert.ok(
    triggers.some(
      (entry) =>
        !entry.should_trigger &&
        /直接用 goal-gate/.test(entry.query) &&
        /不需要.*workflow/.test(entry.query),
    ),
  );
});

test("discuss-before-plan converges design-only destructive choices with a later safety gate", async () => {
  const discussDir = path.join(repoRoot, "skills/discuss-before-plan");
  const skill = await readFile(path.join(discussDir, "SKILL.md"), "utf8");
  const evals = JSON.parse(
    await readFile(path.join(discussDir, "evals/evals.json"), "utf8"),
  ) as { evals: Array<{ name: string }> };

  assert.match(
    skill,
    /design-only comparison of future destructive options is not a hold/i,
  );
  assert.match(skill, /requires a fresh safety gate/i);
  assert.ok(
    evals.evals.some(
      (entry) =>
        entry.name === "design-only-destructive-choice-converges-with-regate",
    ),
  );
});
