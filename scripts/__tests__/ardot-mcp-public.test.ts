import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const skillDir = path.join(repoRoot, "skills/ardot-mcp");

async function readSkill(rel: string): Promise<string> {
  return readFile(path.join(skillDir, rel), "utf8");
}

test("public ardot-mcp source pins UXC 0.22.0 and owns the binary", async () => {
  const skill = await readSkill("SKILL.md");
  const release = await readSkill("scripts/lib/uxc-release.zsh");
  const defaults = await readSkill("scripts/lib/defaults.zsh");
  const owned = await readSkill("scripts/lib/uxc-owned-binary.zsh");

  assert.match(skill, /binary owner/i);
  assert.match(skill, /0\.22\.0/);
  assert.match(release, /typeset -gr UXC_VERSION="0\.22\.0"/);
  assert.match(defaults, /ARDOT_MCP_UXC_OWNER="ardot-mcp"/);
  assert.match(owned, /\$ARDOT_MCP_UXC_OWNER/);
  assert.match(release, /UXC_SHA256_X86_64_UNKNOWN_LINUX_GNU=/);
  assert.match(release, /UXC_SHA256_AARCH64_APPLE_DARWIN=/);
  assert.match(owned, /x86_64-unknown-linux-gnu/);
  assert.match(owned, /aarch64-apple-darwin/);
});

test("ardot-mcp keeps HTTP facade without daemon exclusivity", async () => {
  const skill = await readSkill("SKILL.md");
  const facade = await readSkill("references/uxc-facade.md");
  const defaults = await readSkill("scripts/lib/defaults.zsh");
  const link = await readSkill("scripts/lib/uxc-link-contract.zsh");

  assert.match(skill, /does \*\*not\*\* set `--daemon-exclusive`/);
  assert.match(facade, /Skip `--daemon-exclusive`/);
  assert.doesNotMatch(link, /daemon-exclusive/i);
  assert.match(defaults, /https:\/\/ardot\.tencent\.com\/mcp/);
  assert.match(link, /\$endpoint/);
});

test("ardot-mcp readiness uses sanitized search_style_guide", async () => {
  const readiness = await readSkill("scripts/uxc-readiness.zsh");
  assert.match(readiness, /search_style_guide/);
  assert.match(readiness, /ARDOT_MCP_READY=YES/);
  assert.match(readiness, /oauth_required/);
  assert.match(readiness, /--private-result/);
});

test("ardot-mcp evals cover readiness, oauth, native compat, and ownership", async () => {
  const evals = JSON.parse(await readSkill("evals/evals.json"));
  assert.equal(evals.skill_name, "ardot-mcp");
  const names = evals.evals.map((item: { name: string }) => item.name);
  for (const required of [
    "readiness-only-entry",
    "oauth-handoff",
    "design-task-acceptance",
    "native-compat-opt-in",
    "binary-owner-conflict",
  ]) {
    assert.ok(names.includes(required), `missing eval ${required}`);
  }
});
