/** CLI help must return before command handlers, repository writes or workers. */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cli = fileURLToPath(new URL("../review-loop.mjs", import.meta.url));
const cleanup = [];
afterEach(() => {
  for (const root of cleanup.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function guardedProcess(args, script = cli) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-help-"));
  cleanup.push(root);
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd);
  const guard = path.join(root, "guard.cjs");
  // Block before any external process or file mutation. Even the old CLI cannot
  // reach a real Git/model process. The guard lives outside the checked cwd.
  fs.writeFileSync(
    guard,
    `
const fs = require('node:fs');
const cp = require('node:child_process');
const block = name => () => { process.stderr.write('HELP_SIDE_EFFECT_BLOCKED:' + name + String.fromCharCode(10)); throw new Error('HELP_SIDE_EFFECT_BLOCKED:' + name); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = block(name);
for (const name of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'unlink', 'rm', 'rmdir', 'copyFile', 'cp', 'symlink', 'link', 'chmod', 'chown', 'truncate', 'utimes']) {
  if (fs[name]) fs[name] = block(name);
  if (fs[name + 'Sync']) fs[name + 'Sync'] = block(name + 'Sync');
  if (fs.promises[name]) fs.promises[name] = block('promises.' + name);
}
fs.createWriteStream = block('createWriteStream');
require('node:module').syncBuiltinESMExports();
`,
  );
  const result = spawnSync(
    process.execPath,
    ["--require", guard, script, ...args],
    {
      cwd,
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.deepEqual(
    fs.readdirSync(cwd),
    [],
    "CLI must leave the workspace empty",
  );
  return result;
}

describe("side-effect-free CLI help", () => {
  for (const args of [
    [],
    ["help"],
    ["--help"],
    ["-h"],
    ...[
      "run",
      "fix-completion",
      "close",
      "evidence",
      "consult",
      "sessions",
    ].flatMap((command) => [
      [command, "--help"],
      [command, "-h"],
    ]),
    ["run", "--continue", "--repo=/does-not-exist", "--help"],
    ["consult", "--peer=codex", "-h"],
  ]) {
    it(`prints help without writes or child processes: ${args.join(" ") || "(empty)"}`, () => {
      const result = guardedProcess(args);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /HELP_SIDE_EFFECT_BLOCKED/,
      );
      const help = JSON.parse(result.stdout);
      assert.equal(help.ok, true);
      assert.equal(help.mode, "auto-loop");
      assert.ok(help.usage.some((line) => line.startsWith("review-loop run ")));
    });
  }

  it("keeps unknown command errors when help is absent", () => {
    const result = guardedProcess(["not-a-command"]);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /Unknown command/);
  });

  it("guard intercepts normal run before any real child process", () => {
    const result = guardedProcess(["run"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /HELP_SIDE_EFFECT_BLOCKED/);
  });
});
