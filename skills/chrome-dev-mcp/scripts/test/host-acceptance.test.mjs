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
  agy: `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"chrome-dev-mcp-cli list_pages"},"output":"{\\"ok\\":true,\\"protocol\\":\\"mcp\\",\\"operation\\":\\"list_pages\\",\\"data\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"1: Example [selected]\\"}]}}"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`,
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

test("cursor adds --auto-review only on opt-in and --force only with --bypass", () => {
  const saved = fakes["cursor-agent"];
  const ready = `print -r -- '{"type":"tool_call","command":"zsh scripts/uxc-readiness.zsh"}'
print -r -- '{"type":"result","result":"CHROME_DEV_MCP_READY"}'`;
  const noWide = `[[ " $* " != *" --force "* && " $* " != *" --yolo "* ]] || exit 4`;
  try {
    fakes["cursor-agent"] = `[[ " $* " != *" --auto-review "* ]] || exit 3
${noWide}
${ready}`;
    const normal = run(["--host", "cursor"]);
    assert.equal(normal.hosts.cursor.EXIT, "0");

    fakes["cursor-agent"] = `[[ " $* " == *" --auto-review "* ]] || exit 3
${noWide}
${ready}`;
    const optIn = run(["--host", "cursor", "--cursor-auto-review"]);
    assert.equal(optIn.hosts.cursor.EXIT, "0");
    assert.equal(optIn.hosts.cursor.RESULT, "VERIFIED");

    fakes["cursor-agent"] = `[[ " $* " == *" --force "* ]] || exit 3
${ready}`;
    const bypass = run(["--host", "cursor", "--bypass"]);
    assert.equal(bypass.hosts.cursor.EXIT, "0");
    assert.equal(bypass.hosts.cursor.RESULT, "VERIFIED");
  } finally {
    fakes["cursor-agent"] = saved;
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

test("agy uses --sandbox --mode plan by default and --dangerously-skip-permissions only with --bypass", () => {
  const saved = fakes.agy;
  try {
    fakes.agy = `[[ " $* " == *" --sandbox "* && " $* " == *" --mode plan "* && " $* " != *" --mode accept-edits "* ]] || exit 3
[[ " $* " != *" --dangerously-skip-permissions "* ]] || exit 4
print -r -- 'jetski: no output produced — a tool required the "command" permission.'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":""}}'`;
    const normal = run(["--host", "agy"]);
    assert.equal(normal.hosts.agy.EXIT, "0");
    assert.equal(normal.hosts.agy.SENTINEL, "NONE");
    assert.equal(normal.hosts.agy.RESULT, "UNVERIFIED");

    fakes.agy = `[[ " $* " == *" --dangerously-skip-permissions "* ]] || exit 3
${saved}`;
    const bypass = run(["--host", "agy", "--bypass"]);
    assert.equal(bypass.hosts.agy.EXIT, "0");
    assert.equal(bypass.hosts.agy.SENTINEL, "READY");
    assert.equal(bypass.hosts.agy.TOOL_TRACE, "YES");
    assert.equal(bypass.hosts.agy.RESULT, "VERIFIED");
  } finally {
    fakes.agy = saved;
  }
});

test("agy rejects request-only, tool errors, plain-text, and ERROR results; catches URL leaks", () => {
  const saved = fakes.agy;
  try {
    // Request-only ACTIVE event with no output must not verify
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"ACTIVE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"chrome-dev-mcp-cli list_pages"}}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const reqOnly = run(["--host", "agy", "--bypass"]);
    assert.equal(reqOnly.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(reqOnly.hosts.agy.RESULT, "UNVERIFIED");

    // Errored tool result must not count as completed trace
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"chrome-dev-mcp-cli list_pages"},"error":{"type":"PermissionDenied","message":"denied"}}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const toolErr = run(["--host", "agy", "--bypass"]);
    assert.equal(toolErr.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(toolErr.hosts.agy.RESULT, "UNVERIFIED");

    // Plain-text READY without structured SUCCESS envelope must not fall back
    fakes.agy = `print -r -- 'exec chrome-dev-mcp-cli list_pages'
print -r -- 'CHROME_DEV_MCP_READY'`;
    const plainText = run(["--host", "agy", "--bypass"]);
    assert.equal(plainText.hosts.agy.SENTINEL, "NONE");
    assert.equal(plainText.hosts.agy.RESULT, "UNVERIFIED");

    // Terminal ERROR result after an earlier SUCCESS must fail/remain unverified
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"chrome-dev-mcp-cli list_pages"},"output":"{\\"ok\\":true,\\"protocol\\":\\"mcp\\",\\"operation\\":\\"list_pages\\",\\"data\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"1: Example [selected]\\"}]}}"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'
print -r -- '{"event":"result","result":{"status":"ERROR","response":"CHROME_DEV_MCP_READY"}}'`;
    const errResult = run(["--host", "agy", "--bypass"]);
    assert.equal(errResult.hosts.agy.SENTINEL, "NONE");
    assert.equal(errResult.hosts.agy.RESULT, "UNVERIFIED");

    // Helper script printing only help or SHARED_TRANSPORT=FAIL must not count as TOOL_TRACE=YES
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"zsh scripts/uxc-readiness.zsh --help"},"output":"usage: uxc-readiness.zsh"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const helpOnly = run(["--host", "agy", "--bypass"]);
    assert.equal(helpOnly.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(helpOnly.hosts.agy.RESULT, "UNVERIFIED");

    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"zsh scripts/uxc-readiness.zsh"},"output":"SHARED_TRANSPORT=FAIL"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const transportFail = run(["--host", "agy", "--bypass"]);
    assert.equal(transportFail.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(transportFail.hosts.agy.RESULT, "UNVERIFIED");

    // Shell-printed echo list_pages text or wrong JSON operation (take_snapshot) must not count as TOOL_TRACE=YES
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"echo chrome-dev-mcp-cli list_pages"},"output":"list_pages\\n1: Example [selected]"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const echoListPages = run(["--host", "agy", "--bypass"]);
    assert.equal(echoListPages.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(echoListPages.hosts.agy.RESULT, "UNVERIFIED");

    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"chrome-dev-mcp-cli list_pages"},"output":"{\\"ok\\":true,\\"protocol\\":\\"mcp\\",\\"operation\\":\\"take_snapshot\\",\\"data\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"snap\\"}]}}"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const wrongOp = run(["--host", "agy", "--bypass"]);
    assert.equal(wrongOp.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(wrongOp.hosts.agy.RESULT, "UNVERIFIED");

    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"echo uxc-readiness.zsh"},"output":"STATUS=READY\\nSHARED_TRANSPORT=OK"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const echoReadiness = run(["--host", "agy", "--bypass"]);
    assert.equal(echoReadiness.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(echoReadiness.hosts.agy.RESULT, "UNVERIFIED");

    // Valid zsh scripts/uxc-readiness.zsh invocation with both STATUS=READY and SHARED_TRANSPORT=OK verifies cleanly
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"zsh scripts/uxc-readiness.zsh"},"output":"STATUS=READY\\nSHARED_TRANSPORT=OK"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const readinessOk = run(["--host", "agy", "--bypass"]);
    assert.equal(readinessOk.hosts.agy.TOOL_TRACE, "YES");
    assert.equal(readinessOk.hosts.agy.RESULT, "VERIFIED");

    // list_pages returning data.isError=true must not count as TOOL_TRACE=YES
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"chrome-dev-mcp-cli list_pages"},"output":"{\\"ok\\":true,\\"protocol\\":\\"mcp\\",\\"operation\\":\\"list_pages\\",\\"data\\":{\\"isError\\":true}}"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY"}}'`;
    const isErr = run(["--host", "agy", "--bypass"]);
    assert.equal(isErr.hosts.agy.TOOL_TRACE, "NO");
    assert.equal(isErr.hosts.agy.RESULT, "UNVERIFIED");

    // Non-exact narrative sentinel like "READY maybe" must not verify (and leak check still runs before sentinel pass)
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"zsh scripts/uxc-readiness.zsh"},"output":"STATUS=READY\\nSHARED_TRANSPORT=OK"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"Result: CHROME_DEV_MCP_READY_EXTRA"}}'`;
    const badSentinel = run(["--host", "agy", "--bypass"]);
    assert.equal(badSentinel.hosts.agy.SENTINEL, "NONE");
    assert.equal(badSentinel.hosts.agy.RESULT, "UNVERIFIED");

    // Leak check in valid SUCCESS response
    fakes.agy = `print -r -- '{"event":"step_update","step_update":{"step_type":"tool","state":"DONE","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"zsh scripts/uxc-readiness.zsh"},"output":"STATUS=READY\\nSHARED_TRANSPORT=OK"}}}'
print -r -- '{"event":"result","result":{"status":"SUCCESS","response":"CHROME_DEV_MCP_READY ${secretUrl}"}}'`;
    const leaked = run(["--host", "agy", "--bypass"]);
    assert.equal(leaked.hosts.agy.LEAK, "YES");
    assert.equal(leaked.hosts.agy.RESULT, "FAIL");
    assert.ok(!leaked.stdout.includes(secretUrl));
  } finally {
    fakes.agy = saved;
  }
});
