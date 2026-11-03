import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function fixture(t: { after: (callback: () => void) => void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "finalize-skill-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(path.join(repo, "skills"));
  copyFileSync(
    path.join(repoRoot, "scripts/finalize-skill.ts"),
    path.join(repo, "scripts/finalize-skill.ts"),
  );
  const skill = path.join(repo, "skills/example");
  mkdirSync(skill);
  return { root, repo, skill };
}

function writeSkill(directory: string) {
  writeFileSync(
    path.join(directory, "SKILL.md"),
    "---\nname: example\ndescription: Test fixture\n---\n",
  );
}

function dryRun(repo: string, skillPath = "skills/example") {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(repo, "scripts/finalize-skill.ts"),
      "--dry-run",
      skillPath,
    ],
    { cwd: repo, encoding: "utf8" },
  );
}

function assertPlanned(result: ReturnType<typeof dryRun>) {
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Dry run: pnpm skills:quick-validate skills\/example/,
  );
  assert.match(result.stdout, /Dry run: pnpm skills:validate/);
  assert.match(result.stdout, /Dry run: pnpm skills:index/);
  assert.doesNotMatch(result.stdout, /Running:/);
}

function assertRejected(result: ReturnType<typeof dryRun>, reason: RegExp) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, reason);
  assert.doesNotMatch(result.stdout, /Dry run:|Running:|Done:/);
}

// These CLI tests cover target ownership before any validation/index pipeline runs.
test("plans finalization for a normal repository-owned skill", (t) => {
  const { repo, skill } = fixture(t);
  writeSkill(skill);
  assertPlanned(dryRun(repo));
});

test("rejects a skill directory linked to an external source", (t) => {
  const { root, repo, skill } = fixture(t);
  const external = path.join(root, "external");
  mkdirSync(external);
  writeSkill(external);
  rmSync(skill, { recursive: true });
  symlinkSync(external, skill, "dir");
  assertRejected(dryRun(repo), /repository-owned skill directory/);
});

test("rejects a skill directory linked to another repository skill", (t) => {
  const { repo, skill } = fixture(t);
  const other = path.join(repo, "skills/other");
  mkdirSync(other);
  writeSkill(other);
  rmSync(skill, { recursive: true });
  symlinkSync("other", skill, "dir");
  assertRejected(dryRun(repo), /repository-owned skill directory/);
});

test("rejects SKILL.md linked outside its own skill directory", (t) => {
  const { root, repo, skill } = fixture(t);
  const external = path.join(root, "foreign.md");
  writeFileSync(
    external,
    "---\nname: foreign\ndescription: Foreign source\n---\n",
  );
  symlinkSync(external, path.join(skill, "SKILL.md"), "file");
  assertRejected(dryRun(repo), /SKILL\.md must resolve within its own/);
});

test("allows SKILL.md linked to a file inside the same skill", (t) => {
  const { repo, skill } = fixture(t);
  writeFileSync(
    path.join(skill, "entry.md"),
    "---\nname: example\ndescription: Local source\n---\n",
  );
  symlinkSync("entry.md", path.join(skill, "SKILL.md"), "file");
  assertPlanned(dryRun(repo));
});

test("allows invoking the repository through a directory alias", (t) => {
  const { root, repo, skill } = fixture(t);
  writeSkill(skill);
  const alias = path.join(root, "repo-alias");
  symlinkSync(repo, alias, "dir");
  assertPlanned(dryRun(alias));
});

test("continues rejecting nested skill paths", (t) => {
  const { repo, skill } = fixture(t);
  const nested = path.join(skill, "nested");
  mkdirSync(nested);
  writeSkill(nested);
  assertRejected(
    dryRun(repo, "skills/example/nested"),
    /direct child under skills/,
  );
});

test("continues rejecting paths outside skills", (t) => {
  const { root, repo } = fixture(t);
  const external = path.join(root, "external");
  mkdirSync(external);
  writeSkill(external);
  assertRejected(dryRun(repo, external), /Path must be inside/);
});

// run-yaml-python picks an interpreter that can import PyYAML for quick-validate.
function yamlPython(
  t: { after: (callback: () => void) => void },
  bins: { python3HasYaml?: boolean; uv?: boolean },
  args: string[] = ["validate.py", "skills/example"],
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "run-yaml-python-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const yamlExit = bins.python3HasYaml ? 0 : 1;
  writeFileSync(
    path.join(bin, "python3"),
    `#!/bin/sh\nif [ "$1" = "-c" ]; then exit ${yamlExit}; fi\necho "python3 $*"\n`,
    { mode: 0o755 },
  );
  if (bins.uv) {
    writeFileSync(path.join(bin, "uv"), '#!/bin/sh\necho "uv $*"\n', {
      mode: 0o755,
    });
  }
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(repoRoot, "scripts/run-yaml-python.ts"),
      ...args,
    ],
    { encoding: "utf8", env: { PATH: bin } },
  );
}

test("run-yaml-python uses system python3 when PyYAML is importable", (t) => {
  const result = yamlPython(t, { python3HasYaml: true, uv: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "python3 validate.py skills/example");
});

test("run-yaml-python falls back to uv when python3 lacks PyYAML", (t) => {
  const result = yamlPython(t, { python3HasYaml: false, uv: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    "uv run --with pyyaml python3 validate.py skills/example",
  );
});

test("run-yaml-python explains the fix when neither PyYAML nor uv exists", (t) => {
  const result = yamlPython(t, { python3HasYaml: false, uv: false });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Install uv/);
  assert.match(result.stderr, /python3 -m pip install --user pyyaml/);
});

test("run-yaml-python drops only pnpm's separator and keeps later ones", (t) => {
  const result = yamlPython(t, { python3HasYaml: true }, [
    "validate.py",
    "--",
    "skills/example",
    "--",
    "-draft",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    "python3 validate.py skills/example -- -draft",
  );
});
