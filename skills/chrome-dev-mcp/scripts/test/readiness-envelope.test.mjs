import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lib = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "readiness-envelope.zsh",
);

function classify(stdout, { stderr = "", exitCode = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cdm-envelope-"));
  try {
    const out = join(dir, "stdout");
    const err = join(dir, "stderr");
    writeFileSync(
      out,
      typeof stdout === "string" ? stdout : JSON.stringify(stdout),
    );
    writeFileSync(err, stderr);
    return execFileSync(
      "/bin/zsh",
      [
        "-c",
        'source "$1"; chrome_dev_mcp_classify_readiness "$2" "$3" "$4"',
        "classify",
        lib,
        out,
        err,
        String(exitCode),
      ],
      { encoding: "utf8" },
    ).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const endpoint = "/Users/example/.claude/scripts/chrome-devtools-mcp-safe";
const envelope = (data, extra = {}) => ({
  ok: true,
  kind: "call_result",
  protocol: "mcp",
  endpoint,
  operation: "list_pages",
  data,
  ...extra,
});

test("healthy list_pages envelope is OK", () => {
  assert.equal(
    classify(
      envelope({
        content: [{ type: "text", text: "## Pages\n1: about:blank" }],
      }),
    ),
    "OK",
  );
});

test("ok=true with data.isError is not readiness", () => {
  const data = {
    content: [
      {
        type: "text",
        text: "Could not connect to Chrome. Check if Chrome is running.",
      },
    ],
    isError: true,
  };
  assert.equal(classify(envelope(data)), "chrome_unreachable");
});

test("other tool-level errors are tool_error, not wrapper_fail_closed", () => {
  assert.equal(
    classify(
      envelope({
        content: [{ type: "text", text: "Error: boom" }],
        isError: true,
      }),
    ),
    "tool_error",
  );
});

test("exclusive key conflict is classified separately", () => {
  const stdout = {
    ok: false,
    error: {
      code: "DAEMON",
      message:
        "Another MCP stdio session is currently using daemon exclusive key",
    },
  };
  assert.equal(classify(stdout, { exitCode: 1 }), "exclusive_key_busy");
});

test("wrong operation or non-zero exit is not OK", () => {
  assert.notEqual(
    classify(envelope({ content: [] }, { operation: "take_snapshot" })),
    "OK",
  );
  assert.notEqual(classify(envelope({ content: [] }), { exitCode: 2 }), "OK");
});

test("non-JSON output is parse_error", () => {
  assert.equal(classify("not json"), "parse_error");
});
