import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectChangedGeneratedIndexPaths,
  collectNewSkillSlugsFromStatus,
} from "../finalize-new-skills.ts";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, "../..");

test("detects a new skill when SKILL.md is untracked", () => {
  const rawStatus = [
    "?? skills/new-skill/SKILL.md",
    "?? skills/new-skill/references/guide.md",
  ].join("\n");

  const slugs = collectNewSkillSlugsFromStatus(rawStatus);
  assert.deepEqual(slugs, ["new-skill"]);
});

test("detects a new skill when SKILL.md is staged as added", () => {
  const rawStatus = [
    "A  skills/alpha-skill/SKILL.md",
    "A  skills/alpha-skill/references/examples.md",
  ].join("\n");

  const slugs = collectNewSkillSlugsFromStatus(rawStatus);
  assert.deepEqual(slugs, ["alpha-skill"]);
});

test("does not treat existing skills as new when only non-SKILL.md files are added", () => {
  const rawStatus = [
    "A  skills/existing-skill/references/new-note.md",
    "?? skills/existing-skill/assets/demo.png",
  ].join("\n");

  const slugs = collectNewSkillSlugsFromStatus(rawStatus);
  assert.deepEqual(slugs, []);
});

test("returns unique sorted skill slugs", () => {
  const rawStatus = [
    "?? skills/zeta-skill/SKILL.md",
    "A  skills/alpha-skill/SKILL.md",
    "?? skills/zeta-skill/references/readme.md",
    "A  skills/alpha-skill/references/readme.md",
  ].join("\n");

  const slugs = collectNewSkillSlugsFromStatus(rawStatus);
  assert.deepEqual(slugs, ["alpha-skill", "zeta-skill"]);
});

test("does not infer slug from directory-only untracked status line", () => {
  const rawStatus = "?? skills/";

  const slugs = collectNewSkillSlugsFromStatus(rawStatus);
  assert.deepEqual(slugs, []);
});

test("recognizes both generated skill index files from git status", () => {
  const changedPaths = collectChangedGeneratedIndexPaths(
    [
      " M apps/web/src/generated/skills-index-lite.json",
      " M apps/web/src/generated/skills-detail-index.json",
      " M apps/web/src/generated/unrelated.json",
    ].join("\n"),
  );

  assert.deepEqual(changedPaths, [
    "apps/web/src/generated/skills-index-lite.json",
    "apps/web/src/generated/skills-detail-index.json",
  ]);
});

test("dry run does not create a skill when none is discoverable", (t) => {
  const temporaryRepo = mkdtempSync(
    path.join(os.tmpdir(), "finalize-new-skills-"),
  );
  t.after(() => rmSync(temporaryRepo, { force: true, recursive: true }));

  mkdirSync(path.join(temporaryRepo, "scripts"));
  copyFileSync(
    path.join(repoRoot, "scripts/finalize-new-skills.ts"),
    path.join(temporaryRepo, "scripts/finalize-new-skills.ts"),
  );

  const gitInit = spawnSync("git", ["init"], {
    cwd: temporaryRepo,
    encoding: "utf8",
  });
  assert.equal(gitInit.status, 0, gitInit.stderr);

  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/finalize-new-skills.ts",
      "--dry-run",
    ],
    {
      cwd: temporaryRepo,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No new skills found from git status/);
  assert.doesNotMatch(result.stdout, /pnpm skills:new/);
});
