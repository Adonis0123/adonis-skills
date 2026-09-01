import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const skillDir = path.join(repoRoot, "skills/uxc-facade");

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

test("public uxc-facade source is portable and contains no local runtime contract", async () => {
  const files = await collectFiles(skillDir);
  assert.ok(files.some((file) => file.endsWith("/SKILL.md")));

  const forbidden = [
    /\/Users\//,
    /127\.0\.0\.1:\d+/,
    /~\/\.(?:agents|claude|codex|config)/,
    /\$HOME\/\.(?:agents|claude|codex|config)/,
  ];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        content,
        pattern,
        `${path.relative(repoRoot, file)} contains ${pattern}`,
      );
    }
  }
});

test("uxc-facade owns generic packaging while chrome-dev-mcp owns task acceptance", async () => {
  const facade = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const chrome = await readFile(
    path.join(repoRoot, "skills/chrome-dev-mcp/SKILL.md"),
    "utf8",
  );

  assert.match(facade, /one-off API calls/i);
  assert.match(facade, /chrome-dev-mcp/);
  assert.match(facade, /service-specific skill stays authoritative/i);
  assert.match(facade, /transport proof/i);
  assert.match(facade, /TASK_ACCEPTANCE/);
  assert.match(facade, /NATIVE_COMPAT/);
  assert.match(facade, /binary owner/i);
  assert.match(facade, /sole installer and updater/i);
  assert.match(facade, /link and readiness/i);
  assert.match(facade, /ownership gates/i);
  assert.match(facade, /version conflict/i);
  assert.match(facade, /fail closed/i);
  assert.match(chrome, /UXC packaging for Chrome DevTools/);
  assert.match(chrome, /pinned UXC 0\.17\.0 facade/);
  assert.match(chrome, /explicit compatibility and rollback path/);
  assert.doesNotMatch(
    chrome.split("\n").find((line) => line.startsWith("description:")) ?? "",
    /, UXC packaging,/,
  );
});

test("uxc-facade evals cover explicit use, reusable packaging, near miss, and Chrome handoff", async () => {
  const evals = JSON.parse(
    await readFile(path.join(skillDir, "evals/evals.json"), "utf8"),
  ) as {
    evals: Array<{ name: string; prompt: string }>;
    skill_name: string;
  };

  assert.equal(evals.skill_name, "uxc-facade");
  assert.deepEqual(
    new Set(evals.evals.map((entry) => entry.name)),
    new Set([
      "explicit-method-contract",
      "mcp-stdio-packaging",
      "openapi-link-packaging",
      "one-off-api-near-miss",
      "chrome-devtools-handoff",
      "binary-pin-conflict",
      "multi-protocol-packaging",
    ]),
  );

  const triggers = JSON.parse(
    await readFile(path.join(skillDir, "evals/trigger-eval.json"), "utf8"),
  ) as Array<{ query: string; should_trigger: boolean }>;
  assert.equal(triggers.length, 20);
  assert.ok(triggers.some((entry) => entry.should_trigger));
  assert.ok(triggers.some((entry) => !entry.should_trigger));
});
