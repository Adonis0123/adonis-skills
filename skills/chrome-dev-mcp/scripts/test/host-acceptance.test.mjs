import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "host-acceptance.zsh",
);

const secretUrl = "http://secret.example/private";

// Fake host CLIs: each prints what a real headless session would capture.
const fakes = {
  "chrome-dev-mcp-cli": `print -r -- '{"ok":true,"data":{"content":[{"type":"text","text":"1: Private (${secretUrl}) [selected]"}]}}'`,
  claude: `print -r -- '{"type":"assistant","message":{"content":[{"type":"tool_use","input":{"command":"zsh scripts/uxc-readiness.zsh"}}]}}'
print -r -- '{"type":"result","result":"CHROME_DEV_MCP_READY"}'`,
  codex: `while (( $# > 0 )); do [[ "$1" == -o ]] && { print -r -- CHROME_DEV_MCP_READY >| "$2"; }; shift; done
print -r -- 'exec chrome-dev-mcp-cli list_pages'`,
  grok: `print -r -- '{"type":"thought","data":"prompt says reply CHROME_DEV_MCP_FAIL on failure"}'
print -r -- 'CHROME_DEV_MCP_READY'`,
  "cursor-agent": `print -r -- '{"type":"tool_call","command":"zsh scripts/uxc-readiness.zsh"}'
print -r -- '{"type":"result","result":"CHROME_DEV_MCP_READY ${secretUrl}"}'`,
};

function run(args) {
  const dir = mkdtempSync(join(tmpdir(), "cdm-acceptance-"));
  try {
    for (const [name, body] of Object.entries(fakes)) {
      const file = join(dir, name);
      writeFileSync(file, `#!/bin/zsh\n${body}\n`);
      chmodSync(file, 0o755);
    }
    const result = spawnSync(
      "/bin/zsh",
      [script, "--out", join(dir, "out"), ...args],
      {
        encoding: "utf8",
        env: { HOME: dir, TMPDIR: dir, PATH: `${dir}:/usr/bin:/bin` },
      },
    );
    const lines = Object.fromEntries(
      result.stdout
        .split("\n")
        .filter((line) => line.startsWith("HOST="))
        .map((line) => {
          const fields = Object.fromEntries(
            line.split(" ").map((pair) => pair.split("=")),
          );
          return [fields.HOST, fields];
        }),
    );
    return { ...result, hosts: lines };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("hosts with a tool trace and clean sentinel are VERIFIED", () => {
  const { hosts } = run(["--host", "claude", "--host", "codex"]);
  assert.equal(hosts.claude.RESULT, "VERIFIED");
  assert.equal(hosts.codex.RESULT, "VERIFIED");
});

test("a sentinel without a real tool call stays UNVERIFIED", () => {
  const { hosts, status } = run(["--host", "grok"]);
  assert.equal(hosts.grok.SENTINEL, "READY");
  assert.equal(hosts.grok.TOOL_TRACE, "NO");
  assert.equal(hosts.grok.RESULT, "UNVERIFIED");
  assert.equal(status, 1);
});

test("a page URL in the final answer fails as a leak without printing it", () => {
  const { hosts, stdout } = run(["--host", "cursor"]);
  assert.equal(hosts.cursor.LEAK, "YES");
  assert.equal(hosts.cursor.RESULT, "FAIL");
  assert.ok(!stdout.includes(secretUrl));
});

test("--bypass passes the host's approve-everything flag", () => {
  const saved = fakes.claude;
  fakes.claude = `[[ " $* " == *" --permission-mode bypassPermissions "* ]] || exit 3
${saved}`;
  try {
    const { hosts } = run(["--host", "claude", "--bypass"]);
    assert.equal(hosts.claude.RESULT, "VERIFIED");
    assert.equal(hosts.claude.EXIT, "0");
  } finally {
    fakes.claude = saved;
  }
});

test("grok answer ignores sentinels quoted in thoughts", () => {
  const saved = fakes.grok;
  fakes.grok = `print -r -- '{"type":"thought","data":"reply CHROME_DEV_MCP_FAIL on failure"}'
print -r -- '{"type":"tool_call_update","command":"zsh scripts/uxc-readiness.zsh"}'
print -r -- '{"type":"text","data":"CHROME_DEV_MCP_READY"}'`;
  try {
    const { hosts } = run(["--host", "grok"]);
    assert.equal(hosts.grok.SENTINEL, "READY");
    assert.equal(hosts.grok.RESULT, "VERIFIED");
  } finally {
    fakes.grok = saved;
  }
});

test("an unknown host fails closed", () => {
  const { status, stderr } = run(["--host", "hermes"]);
  assert.equal(status, 69);
  assert.match(stderr, /ERROR_CLASS=unknown_host/);
});
