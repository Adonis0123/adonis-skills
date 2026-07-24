/**
 * T1: product adapter unit tests with fake CLIs (no live login).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAdapter,
  buildArgv,
  assertSandboxHardcoded,
  DEFAULT_TIMEOUT_MS,
  DELIVERY_UNKNOWN,
  resolveTimeoutMs,
} from "../review-loop/adapters.mjs";

const cleanup = [];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  while (cleanup.length) {
    const p = cleanup.pop();
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tmpDir(prefix = "adapter-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

/**
 * Write an executable fake CLI script.
 * @param {string} dir
 * @param {string} name
 * @param {string} body  bash body (no shebang)
 */
function writeFakeBin(dir, name, body) {
  const binDir = path.join(dir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
    mode: 0o755,
  });
  return file;
}

function makeRepo() {
  const dir = tmpDir("adapter-repo-");
  fs.mkdirSync(path.join(dir, ".review-handoff", "runtime", "pkt-1"), {
    recursive: true,
  });
  return dir;
}

describe("buildArgv sandbox hardcoding", () => {
  it("codex always includes -s read-only", () => {
    const argv = buildArgv({
      product: "codex",
      mode: "new",
      prompt: "hi",
      sessionId: null,
      outFile: "/tmp/out",
    });
    assertSandboxHardcoded("codex", argv);
    assert.ok(argv.includes("exec"));
  });

  it("grok always includes --sandbox read-only", () => {
    const argv = buildArgv({
      product: "grok",
      mode: "new",
      prompt: "hi",
      sessionId: null,
    });
    assertSandboxHardcoded("grok", argv);
  });

  it("claude always includes allowedTools + disallowedTools", () => {
    const argv = buildArgv({
      product: "claude",
      mode: "new",
      prompt: "hi",
      sessionId: null,
    });
    assertSandboxHardcoded("claude", argv);
  });

  it("codex resume includes resume <uuid>", () => {
    const argv = buildArgv({
      product: "codex",
      mode: "resume",
      prompt: "again",
      sessionId: "019f0000-0000-0000-0000-000000000001",
      outFile: "/tmp/out",
    });
    assert.ok(argv.includes("resume"));
    assert.ok(argv.includes("019f0000-0000-0000-0000-000000000001"));
  });
});

describe("timeout configuration", () => {
  it("uses a 20-minute default and accepts positive finite overrides", () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 1_200_000);
    assert.equal(resolveTimeoutMs(null), 1_200_000);
    assert.equal(resolveTimeoutMs("900000"), 900_000);
    assert.equal(resolveTimeoutMs(1_500), 1_500);
  });

  it("rejects invalid timeout overrides before spawning", () => {
    for (const value of ["nope", "Infinity", 0, -1]) {
      assert.throws(
        () => resolveTimeoutMs(value),
        /REVIEW_LOOP_TIMEOUT_MS must be a positive finite number/,
      );
    }
  });
});

describe("createAdapter delivery semantics (fake CLI)", () => {
  it("silent healthy reviewer emits progress before completing", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-silent-healthy",
      `sleep 0.12
printf '%s\\n' '{"result":"done","session_id":"019f0000-0000-0000-0000-000000000066"}'`,
    );
    const progressEvents = [];
    const adapter = createAdapter("claude", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 1_000,
      progressIntervalMs: 20,
      onProgress: (event) => progressEvents.push(event),
    });

    const result = await adapter.newSession("prompt");

    assert.equal(result.ok, true);
    assert.equal(result.text, "done");
    assert.ok(progressEvents.length >= 2);
    assert.equal(progressEvents[0].status, "active");
    assert.equal(progressEvents[0].product, "claude");
    assert.equal(progressEvents[0].timeoutMs, 1_000);
    assert.equal(typeof progressEvents[0].elapsedMs, "number");
    assert.equal(typeof progressEvents[0].pid, "number");
  });

  it("timeout kills process and returns DELIVERY_UNKNOWN", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-slow",
      `echo "session id: 019f0000-0000-0000-0000-000000000099" >&2
sleep 30
echo "too late"`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 400,
    });
    const started = Date.now();
    const r = await adapter.newSession("prompt");
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.equal(r.code, DELIVERY_UNKNOWN);
    assert.equal(r.timedOut, true);
    assert.ok(elapsed < 5000, `timeout should be fast, got ${elapsed}ms`);
  });

  it("STOP interrupt returns DELIVERY_UNKNOWN stopped=true", async () => {
    const repoRoot = makeRepo();
    const stopPath = path.join(repoRoot, ".review-handoff", "STOP");
    const bin = writeFakeBin(
      repoRoot,
      "fake-stop",
      `echo "session id: 019f0000-0000-0000-0000-000000000088" >&2
# poll for parent STOP by sleeping; parent will create STOP
for i in $(seq 1 50); do sleep 0.1; done
echo "never"`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 10_000,
      globalStopPath: stopPath,
    });
    const p = adapter.newSession("prompt");
    // create STOP shortly after start
    await new Promise((r) => setTimeout(r, 150));
    fs.writeFileSync(stopPath, "stop\n");
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.code, DELIVERY_UNKNOWN);
    assert.equal(r.stopped, true);
  });

  it("empty output → DELIVERY_UNKNOWN", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-empty",
      `# success but empty out file for codex
# parse -o from args
OUT=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then OUT="$2"; shift 2; continue; fi
  shift
done
: > "$OUT"
echo "session id: 019f0000-0000-0000-0000-000000000077" >&2
exit 0`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.newSession("prompt");
    assert.equal(r.ok, false);
    assert.equal(r.code, DELIVERY_UNKNOWN);
    assert.match(r.error, /empty/i);
  });

  it("non-zero exit → DELIVERY_UNKNOWN (gray zone, no resume degrade)", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-fail",
      `echo "connection reset by peer" >&2
exit 1`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    // seed a session id so resume path is taken
    fs.writeFileSync(
      path.join(
        repoRoot,
        ".review-handoff",
        "runtime",
        "pkt-1",
        "reviewer-session.json",
      ),
      JSON.stringify({
        product: "codex",
        sessionId: "019f0000-0000-0000-0000-000000000066",
      }),
    );
    const r = await adapter.resume(null, "prompt");
    assert.equal(r.ok, false);
    assert.equal(r.code, DELIVERY_UNKNOWN);
    assert.equal(r.degraded, undefined);
    assert.match(r.error, /non-zero|connection/i);
  });

  it("successful codex newSession captures session id + text", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-codex-ok",
      `OUT=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then OUT="$2"; shift 2; continue; fi
  shift
done
echo "session id: 019f0000-0000-0000-0000-000000000055" >&2
printf 'REVIEW_OK' > "$OUT"
exit 0`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.newSession("prompt");
    assert.equal(r.ok, true);
    assert.equal(r.text, "REVIEW_OK");
    assert.equal(r.sessionId, "019f0000-0000-0000-0000-000000000055");
    const store = JSON.parse(
      fs.readFileSync(
        path.join(
          repoRoot,
          ".review-handoff",
          "runtime",
          "pkt-1",
          "reviewer-session.json",
        ),
        "utf8",
      ),
    );
    assert.equal(store.sessionId, "019f0000-0000-0000-0000-000000000055");
  });
});

describe("resume degrade whitelist", () => {
  it("(a) no session id → degrade to newSession", async () => {
    const repoRoot = makeRepo();
    let calls = 0;
    const bin = writeFakeBin(
      repoRoot,
      "fake-codex-a",
      `OUT=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then OUT="$2"; shift 2; continue; fi
  # if resume present, fail (should not be called for (a))
  if [[ "$1" == "resume" ]]; then echo "should-not-resume" >&2; exit 9; fi
  shift
done
echo "session id: 019f0000-0000-0000-0000-000000000044" >&2
printf 'FROM_NEW' > "$OUT"
exit 0`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    // no session store → resume degrades
    const r = await adapter.resume(null, "prompt");
    assert.equal(r.ok, true);
    assert.equal(r.degraded, true);
    assert.equal(r.reason, "no_session_id");
    assert.equal(r.text, "FROM_NEW");
    void calls;
  });

  it("(b) resumeSupported=false → degrade to newSession", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-codex-b",
      `OUT=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then OUT="$2"; shift 2; continue; fi
  if [[ "$1" == "resume" ]]; then echo "should-not-resume" >&2; exit 9; fi
  shift
done
echo "session id: 019f0000-0000-0000-0000-000000000033" >&2
printf 'ONE_SHOT' > "$OUT"
exit 0`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
      resumeSupported: false,
    });
    const r = await adapter.resume(
      "019f0000-0000-0000-0000-000000000099",
      "prompt",
    );
    assert.equal(r.ok, true);
    assert.equal(r.degraded, true);
    assert.equal(r.reason, "resume_unsupported");
    assert.equal(r.text, "ONE_SHOT");
  });

  it("(c) session not found → degrade to newSession", async () => {
    const repoRoot = makeRepo();
    // first call (resume) fails with session not found; second (new) succeeds
    const stateFile = path.join(repoRoot, "fake-state");
    fs.writeFileSync(stateFile, "0");
    const bin = writeFakeBin(
      repoRoot,
      "fake-codex-c",
      `STATE="${stateFile}"
N=$(cat "$STATE")
N=$((N+1))
echo "$N" > "$STATE"
OUT=""
ARGS=("$@")
HAS_RESUME=0
for a in "\${ARGS[@]}"; do
  if [[ "$a" == "resume" ]]; then HAS_RESUME=1; fi
  if [[ "$a" == "-o" ]]; then
    # next is out — handled below by scanning
    :
  fi
done
# parse -o
i=0
while [[ $i -lt \$# ]]; do
  eval "arg=\\\${$((i+1))}"
  if [[ "$arg" == "-o" ]]; then
    eval "OUT=\\\${$((i+2))}"
  fi
  i=$((i+1))
done
# simpler: walk "$@"
set -- "\${ARGS[@]}"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then OUT="$2"; shift 2; continue; fi
  if [[ "$1" == "resume" ]]; then
    echo "Error: session not found" >&2
    exit 1
  fi
  shift
done
echo "session id: 019f0000-0000-0000-0000-000000000022" >&2
printf 'RECOVERED' > "$OUT"
exit 0`,
    );
    // rewrite with cleaner logic
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env bash
set -euo pipefail
OUT=""
MODE=new
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) OUT="$2"; shift 2 ;;
    resume) MODE=resume; shift; shift; shift; break ;; # resume uuid prompt...
    *) shift ;;
  esac
done
if [[ "$MODE" == "resume" ]]; then
  echo "Error: session not found" >&2
  exit 1
fi
echo "session id: 019f0000-0000-0000-0000-000000000022" >&2
printf 'RECOVERED' > "$OUT"
exit 0
`,
      { mode: 0o755 },
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.resume(
      "019f0000-dead-0000-0000-000000000000",
      "prompt",
    );
    assert.equal(r.ok, true);
    assert.equal(r.degraded, true);
    assert.equal(r.reason, "session_not_found");
    assert.equal(r.text, "RECOVERED");
  });

  it("gray-zone non-zero on resume does NOT degrade to second call", async () => {
    const repoRoot = makeRepo();
    const countFile = path.join(repoRoot, "call-count");
    fs.writeFileSync(countFile, "0");
    const bin = writeFakeBin(
      repoRoot,
      "fake-gray",
      `N=$(cat "${countFile}")
echo $((N+1)) > "${countFile}"
echo "connection interrupted mid-flight" >&2
exit 42`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.resume(
      "019f0000-0000-0000-0000-000000000011",
      "prompt",
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, DELIVERY_UNKNOWN);
    assert.equal(
      fs.readFileSync(countFile, "utf8").trim(),
      "1",
      "must not second-call",
    );
  });

  it("cannot resume + connection reset is gray-zone (no newSession)", async () => {
    const repoRoot = makeRepo();
    const countFile = path.join(repoRoot, "call-count-cr");
    fs.writeFileSync(countFile, "0");
    const bin = writeFakeBin(
      repoRoot,
      "fake-cannot-resume",
      `N=$(cat "${countFile}")
echo $((N+1)) > "${countFile}"
echo "cannot resume: connection reset after request" >&2
exit 1`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.resume(
      "019f0000-0000-0000-0000-000000000099",
      "prompt",
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, DELIVERY_UNKNOWN);
    assert.equal(
      fs.readFileSync(countFile, "utf8").trim(),
      "1",
      "must not degrade cannot-resume gray zone to newSession",
    );
  });
});

describe("cwd is repoRoot", () => {
  it("child process sees cwd=repoRoot", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-cwd",
      `OUT=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then OUT="$2"; shift 2; continue; fi
  shift
done
echo "session id: 019f0000-0000-0000-0000-000000000001" >&2
printf 'CWD=%s' "$(pwd -P)" > "$OUT"
exit 0`,
    );
    const adapter = createAdapter("codex", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.newSession("prompt");
    assert.equal(r.ok, true);
    assert.equal(r.text, `CWD=${fs.realpathSync(repoRoot)}`);
  });
});

describe("grok/claude fake JSON paths", () => {
  it("grok parses sessionId + text from JSON stdout", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-grok",
      `printf '%s' '{"text":"GROK_OK","sessionId":"019f0000-0000-0000-0000-00000000g001"}'
exit 0`,
    );
    const adapter = createAdapter("grok", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.newSession("prompt");
    assert.equal(r.ok, true);
    assert.equal(r.text, "GROK_OK");
    assert.equal(r.sessionId, "019f0000-0000-0000-0000-00000000g001");
  });

  it("claude parses session_id + result from JSON stdout", async () => {
    const repoRoot = makeRepo();
    const bin = writeFakeBin(
      repoRoot,
      "fake-claude",
      `printf '%s' '{"result":"CLAUDE_OK","session_id":"claude-sess-1"}'
exit 0`,
    );
    const adapter = createAdapter("claude", {
      repoRoot,
      packetId: "pkt-1",
      bin,
      timeoutMs: 5000,
    });
    const r = await adapter.newSession("prompt");
    assert.equal(r.ok, true);
    assert.equal(r.text, "CLAUDE_OK");
    assert.equal(r.sessionId, "claude-sess-1");
  });
});
