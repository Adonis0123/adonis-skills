import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

// Runs skills:new non-interactively with stub python3/uv/pnpm on PATH, so the
// test checks which interpreter create-skill picks without touching the repo.
function createSkill(
  t: { after: (callback: () => void) => void },
  bins: { python3HasYaml: boolean; uv: boolean },
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "create-skill-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const bin = path.join(root, "bin");
  const out = path.join(root, "out");
  const log = path.join(root, "calls.log");
  mkdirSync(bin);
  mkdirSync(out);

  // The stub interpreter logs its call; for init_skill.py it creates SKILL.md
  // at <--path>/<name>, as the real initializer would.
  const interpreter = (name: string) =>
    [
      "#!/bin/sh",
      ...(name === "python3"
        ? [`if [ "$1" = "-c" ]; then exit ${bins.python3HasYaml ? 0 : 1}; fi`]
        : ['if [ "$1" = "--version" ]; then exit 0; fi']),
      `echo "${name} $*" >> "${log}"`,
      'prev=""; script=""; skill=""; out=""',
      'for arg in "$@"; do',
      '  case "$arg" in *init_skill.py) script=init ;; esac',
      '  if [ "$script" = init ] && [ -z "$skill" ] && [ "$prev" != "${prev%init_skill.py}" ]; then skill="$arg"; fi',
      '  if [ "$prev" = "--path" ]; then out="$arg"; fi',
      '  prev="$arg"',
      "done",
      'if [ "$script" = init ]; then',
      '  mkdir -p "$out/$skill"',
      '  printf -- "---\\nname: %s\\ndescription: x\\n---\\n" "$skill" > "$out/$skill/SKILL.md"',
      "fi",
      "",
    ].join("\n");

  writeFileSync(path.join(bin, "python3"), interpreter("python3"), {
    mode: 0o755,
  });
  if (bins.uv) {
    writeFileSync(path.join(bin, "uv"), interpreter("uv"), { mode: 0o755 });
  }
  writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(repoRoot, "scripts/create-skill.ts"),
      "--non-interactive",
      "--skip-index",
      "--name",
      "demo-skill",
      "--description",
      "Demo skill for tests",
      "--author",
      "tester",
      "--path",
      out,
    ],
    { cwd: repoRoot, encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin` } },
  );
  const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { calls, out, result };
}

test("skills:new uses system python3 when PyYAML is importable", (t) => {
  const { calls, result } = createSkill(t, { python3HasYaml: true, uv: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls, /^python3 .*init_skill\.py demo-skill/m);
  assert.match(calls, /^python3 .*quick_validate\.py .*demo-skill/m);
  assert.doesNotMatch(calls, /^uv /m);
});

test("skills:new falls back to uv when python3 lacks PyYAML", (t) => {
  const { calls, result } = createSkill(t, { python3HasYaml: false, uv: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    calls,
    /^uv run --with pyyaml python3 .*init_skill\.py demo-skill/m,
  );
  assert.match(
    calls,
    /^uv run --with pyyaml python3 .*quick_validate\.py .*demo-skill/m,
  );
  assert.doesNotMatch(calls, /^python3 /m);
});

test("skills:new stops before writing when neither PyYAML nor uv exists", (t) => {
  const { calls, out, result } = createSkill(t, {
    python3HasYaml: false,
    uv: false,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /python3 -m pip install --user pyyaml/);
  assert.equal(calls, "");
  assert.equal(existsSync(path.join(out, "demo-skill")), false);
});
