/**
 * Product adapters for headless read-only reviewer invocation.
 *
 * Hard rules (T0/T1):
 * - Sandbox / allowed-tool flags are hardcoded here; callers cannot disable them.
 * - Subprocesses always start with cwd = repoRoot.
 * - Non-zero / empty / timeout → DELIVERY_UNKNOWN (no retry).
 * - Resume degrades to newSession only on the mechanical whitelist (a/b/c).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DELIVERY_UNKNOWN = "DELIVERY_UNKNOWN";
export const RESUME_DEGRADED = "RESUME_DEGRADED";

/** Default single-hand timeout: 20 minutes. */
export const DEFAULT_TIMEOUT_MS = 1_200_000;
export const DEFAULT_PROGRESS_INTERVAL_MS = 30_000;

export function resolveTimeoutMs(value = process.env.REVIEW_LOOP_TIMEOUT_MS) {
  if (value == null || value === "") return DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("REVIEW_LOOP_TIMEOUT_MS must be a positive finite number");
  }
  return timeoutMs;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Strict session-not-found class only — never broad "cannot resume" (gray-zone false positive). */
const SESSION_NOT_FOUND_RE =
  /session not found|unknown session|no such session|invalid session|session(?: id)?\s*(?:does not exist|not found)/i;

/** Connection / mid-flight failures must never degrade to newSession (double delivery). */
const GRAY_ZONE_RE =
  /connection (?:reset|interrupted|refused|closed)|econnreset|etimedout|network|mid-flight|after request|timeout/i;

/** CLI "immediately rejects" window for whitelist (c); longer exits are gray-zone. */
const IMMEDIATE_REJECT_MS = 5_000;

/**
 * @typedef {'codex'|'grok'|'claude'} Product
 * @typedef {{ ok: true, text: string, sessionId: string|null, degraded?: boolean, reason?: string }} AdapterOk
 * @typedef {{ ok: false, code: typeof DELIVERY_UNKNOWN, error: string, exitCode?: number|null, timedOut?: boolean, stopped?: boolean }} AdapterFail
 * @typedef {AdapterOk|AdapterFail} AdapterResult
 */

/**
 * @param {Product} product
 * @param {{
 *   repoRoot: string,
 *   packetId?: string|null,
 *   timeoutMs?: number,
 *   progressIntervalMs?: number,
 *   onProgress?: (event: {
 *     status: 'active',
 *     product: Product,
 *     mode: 'new'|'resume',
 *     elapsedMs: number,
 *     timeoutMs: number,
 *     pid: number|null,
 *   }) => void,
 *   bin?: string,
 *   env?: NodeJS.ProcessEnv,
 *   resumeSupported?: boolean,
 *   globalStopPath?: string,
 *   packetStopPath?: string,
 *   sessionStorePath?: string|null,
 * }} opts
 */
export function createAdapter(product, opts) {
  const p = String(product || "").toLowerCase();
  if (p !== "codex" && p !== "grok" && p !== "claude") {
    throw new Error(`unknown product adapter: ${product}`);
  }
  if (!opts?.repoRoot) throw new Error("createAdapter: repoRoot required");

  const timeoutMs = resolveTimeoutMs(opts.timeoutMs);
  const progressIntervalMs =
    opts.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  if (!Number.isFinite(progressIntervalMs) || progressIntervalMs <= 0) {
    throw new Error("progressIntervalMs must be a positive finite number");
  }
  const onProgress = opts.onProgress;
  const bin = opts.bin ?? defaultBin(p);
  const resumeSupported = opts.resumeSupported !== false;
  const globalStopPath =
    opts.globalStopPath ?? path.join(opts.repoRoot, ".review-handoff", "STOP");
  const packetStopPath =
    opts.packetStopPath ??
    (opts.packetId
      ? path.join(
          opts.repoRoot,
          ".review-handoff",
          "runtime",
          opts.packetId,
          "STOP",
        )
      : null);
  const sessionStorePath =
    opts.sessionStorePath ??
    (opts.packetId
      ? path.join(
          opts.repoRoot,
          ".review-handoff",
          "runtime",
          opts.packetId,
          "reviewer-session.json",
        )
      : null);

  /** @type {{ product: Product, sessionId: string|null }} */
  const stored = loadSessionRecord(sessionStorePath);
  // A4: never resume a session id from a different product
  const sessionId =
    stored.sessionId && stored.product && stored.product !== p
      ? null
      : stored.sessionId;
  const state = {
    product: /** @type {Product} */ (p),
    sessionId,
  };

  return {
    product: state.product,
    getSessionId: () => state.sessionId,
    /**
     * @param {string} prompt
     * @returns {Promise<AdapterResult>}
     */
    async newSession(prompt) {
      const result = await invokeProduct({
        product: state.product,
        mode: "new",
        prompt,
        sessionId: null,
        repoRoot: opts.repoRoot,
        bin,
        env: opts.env,
        timeoutMs,
        progressIntervalMs,
        onProgress,
        globalStopPath,
        packetStopPath,
      });
      if (result.ok && result.sessionId) {
        state.sessionId = result.sessionId;
        persistSession(sessionStorePath, {
          product: state.product,
          sessionId: result.sessionId,
          updated: new Date().toISOString(),
        });
      }
      return result;
    },
    /**
     * @param {string|null|undefined} sessionId
     * @param {string} prompt
     * @returns {Promise<AdapterResult>}
     */
    async resume(sessionId, prompt) {
      const sid = sessionId ?? state.sessionId;

      // Whitelist (a): no local session id
      if (!sid) {
        const r = await this.newSession(prompt);
        if (r.ok) {
          return { ...r, degraded: true, reason: "no_session_id" };
        }
        return r;
      }

      // Whitelist (b): T0 judged resume unsupported for this product
      if (!resumeSupported) {
        const r = await this.newSession(prompt);
        if (r.ok) {
          return { ...r, degraded: true, reason: "resume_unsupported" };
        }
        return r;
      }

      const result = await invokeProduct({
        product: state.product,
        mode: "resume",
        prompt,
        sessionId: sid,
        repoRoot: opts.repoRoot,
        bin,
        env: opts.env,
        timeoutMs,
        progressIntervalMs,
        onProgress,
        globalStopPath,
        packetStopPath,
      });

      // Whitelist (c): CLI immediately rejects with session-not-found class error
      // Must be mechanical proof the model call never started — not gray-zone mid-flight text.
      const errText = result.error || "";
      const immediate =
        result.elapsedMs == null || result.elapsedMs <= IMMEDIATE_REJECT_MS;
      if (
        !result.ok &&
        result.code === DELIVERY_UNKNOWN &&
        SESSION_NOT_FOUND_RE.test(errText) &&
        !GRAY_ZONE_RE.test(errText) &&
        !result.timedOut &&
        !result.stopped &&
        immediate
      ) {
        const r = await this.newSession(prompt);
        if (r.ok) {
          return { ...r, degraded: true, reason: "session_not_found" };
        }
        return r;
      }

      // Gray zone (e.g. non-zero exit mid-call / connection drop): do NOT degrade
      if (result.ok && result.sessionId) {
        state.sessionId = result.sessionId;
        persistSession(sessionStorePath, {
          product: state.product,
          sessionId: result.sessionId,
          updated: new Date().toISOString(),
        });
      } else if (result.ok && sid) {
        state.sessionId = sid;
      }
      return result;
    },
  };
}

function defaultBin(product) {
  if (product === "codex") return "codex";
  if (product === "grok") return "grok";
  return "claude";
}

/**
 * Build argv for a product. Sandbox flags are hardcoded (never caller-controlled).
 * @param {{ product: Product, mode: 'new'|'resume', prompt: string, sessionId: string|null, outFile?: string }} args
 */
export function buildArgv({ product, mode, prompt, sessionId, outFile }) {
  if (product === "codex") {
    // codex exec -s read-only --skip-git-repo-check -o <file> [resume <uuid>] "<prompt>"
    const argv = ["exec", "-s", "read-only", "--skip-git-repo-check"];
    if (outFile) argv.push("-o", outFile);
    if (mode === "resume") {
      if (!sessionId) throw new Error("codex resume requires sessionId");
      argv.push("resume", sessionId, prompt);
    } else {
      argv.push(prompt);
    }
    return argv;
  }

  if (product === "grok") {
    // grok [-r id] -p "<prompt>" --output-format json --sandbox read-only
    const argv = [];
    if (mode === "resume") {
      if (!sessionId) throw new Error("grok resume requires sessionId");
      argv.push("-r", sessionId);
    }
    argv.push(
      "-p",
      prompt,
      "--output-format",
      "json",
      "--sandbox",
      "read-only",
    );
    return argv;
  }

  // claude -p [ --resume id ] --allowedTools ... --disallowedTools ... --output-format json "<prompt>"
  // T0: allowedTools alone failed write isolation; disallowedTools required.
  const argv = ["-p"];
  if (mode === "resume") {
    if (!sessionId) throw new Error("claude resume requires sessionId");
    argv.push("--resume", sessionId);
  }
  argv.push(
    "--allowedTools",
    "Read,Grep,Glob",
    "--disallowedTools",
    "Write,Edit,MultiEdit,NotebookEdit,Bash",
    "--output-format",
    "json",
    prompt,
  );
  return argv;
}

/**
 * @param {{
 *   product: Product,
 *   mode: 'new'|'resume',
 *   prompt: string,
 *   sessionId: string|null,
 *   repoRoot: string,
 *   bin: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs: number,
 *   progressIntervalMs: number,
 *   onProgress?: (event: {
 *     status: 'active',
 *     product: Product,
 *     mode: 'new'|'resume',
 *     elapsedMs: number,
 *     timeoutMs: number,
 *     pid: number|null,
 *   }) => void,
 *   globalStopPath: string,
 *   packetStopPath: string|null,
 * }} cfg
 * @returns {Promise<AdapterResult>}
 */
export function invokeProduct(cfg) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;

    // F6: refuse to spawn if STOP already present
    if (
      fs.existsSync(cfg.globalStopPath) ||
      (cfg.packetStopPath && fs.existsSync(cfg.packetStopPath))
    ) {
      resolve({
        ok: false,
        code: DELIVERY_UNKNOWN,
        error: "STOP interrupt (pre-spawn)",
        exitCode: null,
        timedOut: false,
        stopped: true,
        elapsedMs: elapsed(),
      });
      return;
    }

    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "review-loop-adapter-"),
    );
    const outFile = path.join(tmpDir, "out.txt");
    const argv = buildArgv({
      product: cfg.product,
      mode: cfg.mode,
      prompt: cfg.prompt,
      sessionId: cfg.sessionId,
      outFile: cfg.product === "codex" ? outFile : undefined,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let stopped = false;

    // detached so we own a process group and can kill sleep grandchildren on timeout/STOP
    const child = spawn(cfg.bin, argv, {
      cwd: cfg.repoRoot,
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const reportProgress = () => {
      if (!cfg.onProgress) return;
      try {
        cfg.onProgress({
          status: "active",
          product: cfg.product,
          mode: cfg.mode,
          elapsedMs: elapsed(),
          timeoutMs: cfg.timeoutMs,
          pid: child.pid ?? null,
        });
      } catch {
        // Observability must not change delivery semantics.
      }
    };
    reportProgress();
    const progressPoll = cfg.onProgress
      ? setInterval(reportProgress, cfg.progressIntervalMs)
      : null;
    progressPoll?.unref?.();

    child.stdout.on("data", (buf) => {
      stdout += buf.toString("utf8");
    });
    child.stderr.on("data", (buf) => {
      stderr += buf.toString("utf8");
    });

    const killChild = (signal = "SIGTERM") => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* ignore */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killChild("SIGKILL");
    }, cfg.timeoutMs);

    const stopPoll = setInterval(() => {
      if (
        fs.existsSync(cfg.globalStopPath) ||
        (cfg.packetStopPath && fs.existsSync(cfg.packetStopPath))
      ) {
        stopped = true;
        killChild("SIGTERM");
      }
    }, 200);
    stopPoll.unref?.();

    const finish = (/** @type {AdapterResult} */ result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(stopPoll);
      if (progressPoll) clearInterval(progressPoll);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve({ ...result, elapsedMs: result.elapsedMs ?? elapsed() });
    };

    child.on("error", (err) => {
      finish({
        ok: false,
        code: DELIVERY_UNKNOWN,
        error: `spawn failed: ${err.message}`,
        exitCode: null,
        timedOut: false,
        stopped: false,
      });
    });

    child.on("close", (exitCode) => {
      // F6: re-check STOP at close to cover race with poll interval
      if (
        stopped ||
        fs.existsSync(cfg.globalStopPath) ||
        (cfg.packetStopPath && fs.existsSync(cfg.packetStopPath))
      ) {
        finish({
          ok: false,
          code: DELIVERY_UNKNOWN,
          error: "STOP interrupt",
          exitCode,
          timedOut: false,
          stopped: true,
        });
        return;
      }
      if (timedOut) {
        finish({
          ok: false,
          code: DELIVERY_UNKNOWN,
          error: `timeout after ${cfg.timeoutMs}ms`,
          exitCode,
          timedOut: true,
          stopped: false,
        });
        return;
      }

      const combined = `${stdout}\n${stderr}`;
      let text = "";
      let sessionId = null;

      try {
        if (cfg.product === "codex") {
          if (fs.existsSync(outFile)) {
            text = fs.readFileSync(outFile, "utf8");
          }
          if (!text.trim()) text = stdout;
          const sidLine = combined.match(/session id:\s*([0-9a-f-]{36})/i);
          sessionId = sidLine?.[1] ?? cfg.sessionId;
        } else if (cfg.product === "grok") {
          const json = tryParseJson(stdout) ?? tryParseJson(combined);
          if (json) {
            text = String(json.text ?? json.result ?? json.output ?? "");
            sessionId = json.sessionId ?? json.session_id ?? cfg.sessionId;
          } else {
            text = stdout;
            sessionId = cfg.sessionId;
          }
        } else {
          // claude
          const json = tryParseJson(stdout) ?? tryParseJson(combined);
          if (json) {
            text = String(json.result ?? json.text ?? "");
            sessionId = json.session_id ?? json.sessionId ?? cfg.sessionId;
          } else {
            text = stdout;
            sessionId = cfg.sessionId;
          }
        }
      } catch (err) {
        finish({
          ok: false,
          code: DELIVERY_UNKNOWN,
          error: `parse failed: ${err instanceof Error ? err.message : String(err)}`,
          exitCode,
          timedOut: false,
          stopped: false,
        });
        return;
      }

      if (exitCode !== 0) {
        finish({
          ok: false,
          code: DELIVERY_UNKNOWN,
          error: `non-zero exit ${exitCode}: ${(stderr || stdout).slice(0, 2000)}`,
          exitCode,
          timedOut: false,
          stopped: false,
        });
        return;
      }

      if (!String(text).trim()) {
        finish({
          ok: false,
          code: DELIVERY_UNKNOWN,
          error: "empty output",
          exitCode,
          timedOut: false,
          stopped: false,
        });
        return;
      }

      finish({
        ok: true,
        text: String(text),
        sessionId: sessionId ? String(sessionId) : null,
      });
    });
  });
}

function tryParseJson(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  // Prefer last JSON object in the stream
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function loadSessionId(storePath) {
  return loadSessionRecord(storePath).sessionId;
}

function loadSessionRecord(storePath) {
  if (!storePath || !fs.existsSync(storePath)) {
    return { sessionId: null, product: null };
  }
  try {
    const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return {
      sessionId: data.sessionId ?? data.session_id ?? null,
      product: data.product ?? null,
    };
  } catch {
    return { sessionId: null, product: null };
  }
}

function persistSession(storePath, payload) {
  if (!storePath) return;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Test helper: assert sandbox flags always present in argv. */
export function assertSandboxHardcoded(product, argv) {
  if (product === "codex") {
    const i = argv.indexOf("-s");
    if (i === -1 || argv[i + 1] !== "read-only") {
      throw new Error("codex sandbox flag missing");
    }
  } else if (product === "grok") {
    if (
      !argv.includes("--sandbox") ||
      argv[argv.indexOf("--sandbox") + 1] !== "read-only"
    ) {
      throw new Error("grok sandbox flag missing");
    }
  } else if (product === "claude") {
    if (
      !argv.includes("--allowedTools") ||
      !argv.includes("--disallowedTools")
    ) {
      throw new Error("claude isolation flags missing");
    }
    const allowed = argv[argv.indexOf("--allowedTools") + 1];
    const denied = argv[argv.indexOf("--disallowedTools") + 1];
    if (!String(allowed).includes("Read"))
      throw new Error("claude allowedTools incomplete");
    if (!String(denied).includes("Write") || !String(denied).includes("Bash")) {
      throw new Error("claude disallowedTools incomplete");
    }
  }
}

export { UUID_RE, SESSION_NOT_FOUND_RE, GRAY_ZONE_RE, IMMEDIATE_REJECT_MS };
