/**
 * review-loop auto run — single-writer Fixer-driven loop with headless Reviewer.
 *
 * Commands (via cmdRun / cmdContinue):
 *   run --repo --reviewer [--base] [--rounds 3] [--packet]
 *   run --continue --repo [--packet] [--rounds]
 */
import fs from "node:fs";
import path from "node:path";
import {
  resolveRepoRoot,
  resolveBranch,
  ensureReviewHandoffLayout,
  createPacketFile,
  readPacketMeta,
  runtimeDir,
  latestActivePacket,
  validatePacketPath,
  lastPhysicalH1,
} from "./repositories.mjs";
import { createAdapter, DELIVERY_UNKNOWN } from "./adapters.mjs";
import { freezeRoundEvidence, resolveBaseSha } from "./evidence.mjs";
import {
  parseReviewFindings,
  parseReReview,
  formatReviewFindingsStage,
  formatReReviewStage,
  formatDecisionClosureStage,
  lifecycleForVerdict,
} from "./schema.mjs";
import {
  appendStageAuto,
  seedPacketHash,
  loadRunState,
  saveRunState,
  contentHash,
} from "./stage-writer.mjs";

const DEFAULT_ROUNDS = 3;

/**
 * Build Reviewer prompt for a round.
 */
export function buildReviewerPrompt({
  round,
  packetPath,
  baseSha,
  evidencePath,
  paths,
  priorFindingIds,
  correctionNote,
}) {
  const schemaRound1 = `Output MUST include:
1. A markdown findings table with columns:
   ID | 严重度 | 标题 | 证据 | Target files | Required fix | Acceptance check
   Severity must be [阻塞] or [非阻塞].
2. A final Verdict line exactly one of: PASS | PASS_WITH_CONCERNS | BLOCKED | NO_FINDINGS
Rules:
- PASS / NO_FINDINGS: zero blocking findings.
- BLOCKED: ≥1 [阻塞] finding with falsifiable breakage.
- PASS_WITH_CONCERNS: only [非阻塞] remaining.
- Style/taste is never blocking.
- Never place a literal pipe character in table cells (TypeScript unions, shell pipes, etc.). Use &#124; instead.`;

  const schemaRoundN = `Output MUST include ALL of:
1. ## Prior Findings Reassessment — table: ID | 状态(resolved|partially|unresolved) | 复核证据
   Cover every prior finding ID: ${priorFindingIds.join(", ") || "(none)"}
2. ## New Findings — same columns as first-round findings table (only load-bearing blockers allowed)
3. ## Regression Surface — short conclusion
4. Exactly one terminal Verdict: PASS | PASS_WITH_CONCERNS | BLOCKED | NO_FINDINGS
Missing any section (including Verdict) is malformed.
Never place a literal pipe character in table cells. Use &#124; instead.`;

  const parts = [
    "You are a read-only code reviewer in an auto review loop.",
    `Packet path: ${packetPath}`,
    `Base SHA (pinned): ${baseSha}`,
    `Frozen evidence file (authoritative — read this file): ${evidencePath}`,
    `Paths in scope: ${(paths || []).join(", ") || "(see evidence file)"}`,
    `Round: ${round}`,
    round <= 1 ? schemaRound1 : schemaRoundN,
    "Do not modify any files. Do not write the packet. Stdout only.",
  ];
  if (correctionNote) {
    parts.push(`CORRECTION (previous output was malformed): ${correctionNote}`);
    parts.push("Re-emit a complete valid response only.");
  }
  return parts.join("\n");
}

/**
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {string} [opts.cwd]
 * @param {string} opts.reviewer  codex|grok|claude
 * @param {string} [opts.base]
 * @param {number} [opts.rounds]
 * @param {string} [opts.packetPath]
 * @param {string} [opts.packetId]
 * @param {boolean} [opts.continue]
 * @param {string} [opts.scopeSlug]
 * @param {(cfg: object) => ReturnType<typeof createAdapter>} [opts.adapterFactory]
 * @param {object} [opts.adapterOpts] extra adapter options (bin, timeoutMs, ...)
 */
export async function cmdRun(opts) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  ensureReviewHandoffLayout(repoRoot);
  const branch = resolveBranch(repoRoot);
  const isContinue = Boolean(opts.continue || opts.cont);
  // Resolve / create packet
  let packetPath = opts.packetPath || null;
  let packetId = opts.packetId || null;
  if (!packetPath && packetId) {
    // Locate by packet_id's own slug (never recompute slug from current branch algorithm)
    const segments = String(packetId).split("/");
    if (segments.length === 2 && segments[0] && segments[1]) {
      const candidate = path.join(
        repoRoot,
        ".review-handoff",
        "active",
        segments[0],
        `${segments[1]}.md`,
      );
      if (fs.existsSync(candidate)) packetPath = candidate;
    }
  }
  if (!packetPath && isContinue) {
    packetPath = latestActivePacket(repoRoot, branch);
  }

  if (!packetPath) {
    if (isContinue) throw new Error("run --continue requires an active packet");
    const created = createPacketFile(
      repoRoot,
      branch,
      opts.scopeSlug || "auto-loop",
    );
    packetPath = created.packetPath;
    packetId = created.packetId;
  }

  // Containment: writes/continues require active packet; read of archive only if already archived terminal
  const absPacket = path.isAbsolute(packetPath)
    ? packetPath
    : path.resolve(repoRoot, packetPath);
  const validated = validatePacketPath(repoRoot, branch, absPacket, {
    activeOnly: isContinue || Boolean(opts.packetPath),
  });
  // First create path already under active; continue/explicit packet must stay active
  packetPath = validated.packetPath;
  packetId = validated.packetId;

  // Reviewer: explicit flag wins; else continue inherits prior; else default codex
  const priorState = loadRunState(repoRoot, packetId) ?? {};
  let reviewer = opts.reviewer || opts.productReviewer || null;
  if (!reviewer && isContinue && priorState.reviewer) {
    reviewer = priorState.reviewer;
  }
  reviewer = String(reviewer || "codex").toLowerCase();
  if (!["codex", "grok", "claude"].includes(reviewer)) {
    throw new Error(`--reviewer must be codex|grok|claude, got ${reviewer}`);
  }

  // F4: continue inherits persisted roundsBudget unless explicit --rounds.
  // `--rounds +N` is additive authorization (T5); bare N is absolute ceiling.
  const roundsBudget = resolveRoundsBudget(opts.rounds, priorState, isContinue);

  return withPacketLock(repoRoot, packetId, () =>
    runBody({
      ...opts,
      repoRoot,
      branch,
      packetPath,
      packetId,
      reviewer,
      roundsBudget,
      isContinue,
    }),
  );
}

/**
 * Per-packet recoverable async lock (mkdir + dead-pid reclaim).
 * Holds the lock across awaited reviewer invokes.
 */
export async function withPacketLock(repoRoot, packetId, operation) {
  const lockDir = path.join(runtimeDir(repoRoot, packetId), ".auto-run.lock");
  const ownerFile = path.join(lockDir, "owner");
  const ownerToken = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const tryAcquire = () => {
    fs.mkdirSync(lockDir);
    // N1: publish owner immediately after mkdir (no await between)
    fs.writeFileSync(ownerFile, `${ownerToken}\n${process.pid}\n`, "utf8");
  };

  const GRACE_MS = 2000;
  try {
    tryAcquire();
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
    let owner = "";
    let ownerMissing = false;
    try {
      owner = fs.readFileSync(ownerFile, "utf8");
    } catch {
      ownerMissing = true;
    }
    if (ownerMissing || !String(owner).trim()) {
      // N1/N2: incomplete or empty owner — honor short grace based on dir mtime, then reclaim
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(lockDir).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      if (mtimeMs && Date.now() - mtimeMs < GRACE_MS) {
        const e = new Error("packet lock held (owner not published yet)");
        // @ts-expect-error
        e.code = "PACKET_LOCK_HELD";
        throw e;
      }
      fs.rmSync(lockDir, { recursive: true, force: true });
      tryAcquire();
    } else {
      const oldPid = Number(String(owner).split("\n")[1] || 0);
      let alive = false;
      if (oldPid > 0) {
        try {
          process.kill(oldPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (alive || !oldPid) {
        // invalid/zero pid with non-empty owner → treat as held unless stale mtime
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(lockDir).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        if (alive || (mtimeMs && Date.now() - mtimeMs < GRACE_MS)) {
          const e = new Error(`packet lock held by pid ${oldPid || "unknown"}`);
          // @ts-expect-error
          e.code = "PACKET_LOCK_HELD";
          throw e;
        }
      }
      // reclaim stale lock only when owner pid is dead (or grace expired for invalid pid)
      fs.rmSync(lockDir, { recursive: true, force: true });
      tryAcquire();
    }
  }

  try {
    return await operation();
  } finally {
    // Only delete if we still own the lock
    try {
      const cur = fs.readFileSync(ownerFile, "utf8");
      if (cur.startsWith(ownerToken)) {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  }
}

async function runBody(ctx) {
  const {
    repoRoot,
    packetPath: initialPacketPath,
    packetId,
    reviewer,
    roundsBudget,
    isContinue,
    base,
    adapterFactory,
    adapterOpts,
  } = ctx;

  let packetPath = initialPacketPath;
  let state = loadRunState(repoRoot, packetId) ?? {};

  // Pin base SHA BEFORE any external call (A6)
  let baseSha = state.baseSha;
  if (!baseSha) {
    baseSha = resolveBaseSha(repoRoot, base);
  }
  if (!state.packetHash) {
    seedPacketHash(repoRoot, packetId, packetPath);
    state = loadRunState(repoRoot, packetId);
  }
  // Persist base + reviewer early so DELIVERY_UNKNOWN retries cannot drift
  saveRunState(repoRoot, packetId, {
    ...state,
    baseSha,
    reviewer,
    updated: new Date().toISOString(),
  });
  state = loadRunState(repoRoot, packetId);

  const round = Number(state.round ?? 0);
  const nextRound = isContinue ? round + 1 : Math.max(round, 0) + 1;
  // On first start: if never ran, nextRound=1. On continue after BLOCKED fix: increment.

  // F4: recover round from packet if runtime state lost
  const metaNow = readPacketMeta(packetPath);
  const physical = lastPhysicalH1(metaNow.text);
  if (!isContinue) {
    if (round > 0) {
      throw new Error(
        `packet already has round=${round} (lastVerdict=${state.lastVerdict ?? "n/a"}); use run --continue or a new packet`,
      );
    }
    if (
      physical &&
      physical.anchor !== "review_handoff" &&
      metaNow.lastAnchor &&
      metaNow.lastAnchor !== "review_handoff"
    ) {
      throw new Error(
        `packet already has stages (last_anchor=${metaNow.lastAnchor}); use run --continue or a new packet`,
      );
    }
  }

  // If continuing from BLOCKED, require legitimate Fix Completion (A2)
  if (isContinue) {
    const meta = readPacketMeta(packetPath);
    if (meta.lifecycleState === "archived") {
      return terminalReport({
        status: "already_archived",
        packetPath,
        state,
        message: "Packet already archived",
      });
    }
    if (state.lastVerdict === "BLOCKED" || meta.lifecycleState === "blocked") {
      const last = lastPhysicalH1(meta.text);
      const lastIsFixCompletion =
        last &&
        (last.anchor === "fix_completion" ||
          /^fix_completion/.test(last.anchor));
      if (!lastIsFixCompletion || meta.lastAnchor !== "fix_completion") {
        throw new Error(
          "run --continue after BLOCKED requires a trailing # Fix Completion stage (use fix-completion)",
        );
      }
    }
  }

  const effectiveRound = isContinue ? nextRound : 1;
  if (effectiveRound > roundsBudget && !state.budgetOverride) {
    return budgetExhaustedReport({ packetPath, state, roundsBudget });
  }

  // Freeze evidence (reuse same-round file if already frozen — A6)
  // F3: continue inherits pinned path scope unless explicit new paths provided
  /** @type {string[]|undefined} */
  let pathFilter = ctx.paths;
  if (!pathFilter && ctx.path) {
    pathFilter = Array.isArray(ctx.path) ? ctx.path : [ctx.path];
  }
  if (typeof pathFilter === "string") {
    pathFilter = pathFilter
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (
    (!pathFilter || !pathFilter.length) &&
    Array.isArray(state.paths) &&
    state.paths.length
  ) {
    pathFilter = state.paths;
  }
  if (pathFilter?.length) {
    // Paths live only in auto-run-state.json. Never rewrite packet + reseed hash here:
    // that would absorb external packet edits and defeat PACKET_HASH_MISMATCH (R1 #1).
    saveRunState(repoRoot, packetId, {
      ...loadRunState(repoRoot, packetId),
      paths: pathFilter,
      baseSha,
      reviewer,
      updated: new Date().toISOString(),
    });
    state = loadRunState(repoRoot, packetId);
  }

  const evidenceDir = path.join(runtimeDir(repoRoot, packetId), "evidence");
  const evidencePath = path.join(evidenceDir, `round-${effectiveRound}.diff`);
  let evidence;
  if (fs.existsSync(evidencePath) && state[`evidenceRound${effectiveRound}`]) {
    const diffText = fs.readFileSync(evidencePath, "utf8");
    const digest = contentHash(diffText);
    if (state[`evidenceDigest${effectiveRound}`]) {
      if (state[`evidenceDigest${effectiveRound}`] !== digest) {
        return {
          ok: false,
          status: "evidence_hash_mismatch",
          message: `Frozen evidence round-${effectiveRound}.diff digest mismatch; refuse to proceed`,
          packetPath,
        };
      }
    } else {
      // F6: backfill digest on first resume of legacy state
      saveRunState(repoRoot, packetId, {
        ...loadRunState(repoRoot, packetId),
        [`evidenceDigest${effectiveRound}`]: digest,
      });
    }
    evidence = {
      evidencePath,
      diffText,
      lineCount: diffText.split("\n").length,
      paths: pathFilter || state.paths || [],
      digest,
    };
  } else {
    evidence = freezeRoundEvidence({
      repoRoot,
      packetId,
      baseSha,
      round: effectiveRound,
      paths: pathFilter,
    });
    const digest = contentHash(evidence.diffText);
    saveRunState(repoRoot, packetId, {
      ...loadRunState(repoRoot, packetId),
      [`evidenceRound${effectiveRound}`]: true,
      [`evidenceDigest${effectiveRound}`]: digest,
      evidencePath: evidence.evidencePath,
      paths: pathFilter || state.paths || null,
      baseSha,
      reviewer,
      updated: new Date().toISOString(),
    });
    evidence.digest = digest;
  }

  const adapter = (adapterFactory || createAdapter)(reviewer, {
    repoRoot,
    packetId,
    ...(adapterOpts || {}),
  });

  const priorFindingIds =
    Array.isArray(state.findingIds) && state.findingIds.length
      ? state.findingIds
      : Object.keys(state.findingCatalog || {});
  // All historical blockers in catalog (not only currently open) so re-opened
  // blockers still gate PASS after a prior resolve.
  const priorBlockingIds = catalogBlockingIds(state.findingCatalog);
  let prompt = buildReviewerPrompt({
    round: effectiveRound,
    packetPath,
    baseSha,
    evidencePath: evidence.evidencePath,
    paths: evidence.paths,
    priorFindingIds,
  });

  // Invoke reviewer
  let invokeResult =
    effectiveRound <= 1 || !adapter.getSessionId?.()
      ? await adapter.newSession(prompt)
      : await adapter.resume(adapter.getSessionId(), prompt);

  if (!invokeResult.ok) {
    return deliveryUnknownReport({
      packetPath,
      state,
      error: invokeResult.error,
      code: invokeResult.code || DELIVERY_UNKNOWN,
    });
  }

  // Parse + one correction
  let parsed =
    effectiveRound <= 1
      ? parseReviewFindings(invokeResult.text)
      : parseReReview(invokeResult.text, priorFindingIds, {
          priorBlockingIds:
            priorBlockingIds.length > 0
              ? priorBlockingIds
              : state.openBlocking || priorFindingIds,
        });

  if (!parsed.ok) {
    const correction = buildReviewerPrompt({
      round: effectiveRound,
      packetPath,
      baseSha,
      evidencePath: evidence.evidencePath,
      paths: evidence.paths,
      priorFindingIds,
      correctionNote: parsed.error,
    });
    const retry = await adapter.resume(adapter.getSessionId(), correction);
    if (!retry.ok) {
      return deliveryUnknownReport({
        packetPath,
        state,
        error: retry.error,
        code: retry.code || DELIVERY_UNKNOWN,
      });
    }
    parsed =
      effectiveRound <= 1
        ? parseReviewFindings(retry.text)
        : parseReReview(retry.text, priorFindingIds, {
            priorBlockingIds:
              priorBlockingIds.length > 0
                ? priorBlockingIds
                : state.openBlocking || priorFindingIds,
          });
    if (!parsed.ok) {
      return {
        ok: false,
        status: "malformed_reviewer_output",
        message: `Reviewer output malformed after one correction: ${parsed.error}`,
        packetPath,
        error: parsed.error,
        // packet must have no half-write
      };
    }
    invokeResult = retry;
  }

  // Structured finding ledger (runtime state) — single source for PWC concerns / close
  let findingCatalog;
  let openBlocking;
  let openConcerns;
  let findingIds;
  try {
    const sets = computeFindingLedger({
      effectiveRound,
      parsed,
      priorCatalog: state.findingCatalog || {},
      priorFindingIds,
    });
    findingCatalog = sets.findingCatalog;
    openBlocking = sets.openBlocking;
    openConcerns = sets.openConcerns;
    findingIds = sets.findingIds;
    assertVerdictOpenSets(parsed.verdict, openBlocking, openConcerns);
  } catch (err) {
    return {
      ok: false,
      status: "malformed_reviewer_output",
      message: `Finding ledger / verdict invariant failed: ${err?.message || err}`,
      packetPath,
      error: err?.message || String(err),
    };
  }

  // Lifecycle matches auto-loop contract (plan T2 §6):
  // PASS/NO_FINDINGS → archived; PWC → awaiting_user_decision; BLOCKED → blocked.
  // Fix Handoff is only for BLOCKED (not PWC).
  const lifecycle = lifecycleForVerdict(
    effectiveRound <= 1 ? "review_findings" : "re_review",
    parsed.verdict,
  );

  let sectionMarkdown;
  let lastAnchor;
  if (effectiveRound <= 1) {
    sectionMarkdown = formatReviewFindingsStage({
      verdict: parsed.verdict,
      findings: parsed.findings,
      reviewer,
      baseSha,
      evidencePath: evidence.evidencePath,
    });
    // Plan T2: first-round Fix Handoff only when BLOCKED
    lastAnchor =
      parsed.verdict === "BLOCKED" ? "fix_handoff" : "review_findings";
  } else {
    sectionMarkdown = formatReReviewStage({
      verdict: parsed.verdict,
      reassessments: parsed.reassessments,
      newFindings: parsed.newFindings,
      regressionSurface: parsed.regressionSurface,
      reviewer,
      round: effectiveRound,
      evidencePath: evidence.evidencePath,
    });
    lastAnchor = "re_review";
  }

  let writeResult;
  try {
    writeResult = appendStageAuto({
      repoRoot,
      packetPath,
      packetId,
      sectionMarkdown,
      lastAnchor,
      lifecycleState: lifecycle,
      extra: {
        base_sha: baseSha,
        reviewer,
        round: String(effectiveRound),
        mode: "auto",
      },
    });
    packetPath = writeResult.packetPath;
  } catch (err) {
    if (err?.code === "PACKET_HASH_MISMATCH") {
      return {
        ok: false,
        status: "packet_hash_mismatch",
        message: err.message,
        packetPath,
      };
    }
    throw err;
  }

  const nextState = {
    ...loadRunState(repoRoot, packetId),
    baseSha,
    round: effectiveRound,
    roundsBudget,
    reviewer,
    lastVerdict: parsed.verdict,
    findingIds,
    findingCatalog,
    openBlocking,
    openConcerns,
    lifecycle,
    packetPath,
    evidencePath: evidence.evidencePath,
    lineCount: evidence.lineCount,
    updated: new Date().toISOString(),
  };
  saveRunState(repoRoot, packetId, nextState);

  // Clean packet STOP if present on terminal
  const packetStop = path.join(runtimeDir(repoRoot, packetId), "STOP");
  if (lifecycle === "archived" && fs.existsSync(packetStop)) {
    fs.unlinkSync(packetStop);
  }

  const concernRows = openConcerns.map((id) =>
    catalogEntryToConcern(id, findingCatalog[id]),
  );

  if (parsed.verdict === "BLOCKED") {
    // Budget is a ceiling: on the final budgeted round, BLOCKED exits immediately
    // (plan flowchart: 轮次 < 预算? 否 → 预算耗尽). Do not ask for another fix pass.
    if (effectiveRound >= roundsBudget && !nextState.budgetOverride) {
      const unresolvedReassessments =
        effectiveRound > 1
          ? (parsed.reassessments || []).filter(
              (r) => r.status === "unresolved" || r.status === "partially",
            )
          : [];
      return budgetExhaustedReport({
        packetPath,
        state: nextState,
        roundsBudget,
        openBlocking,
        // Round 1: findings; Re-review: open blockers from ledger + unresolved reassessments
        findings:
          effectiveRound <= 1
            ? parsed.findings
            : openBlocking.map((id) =>
                catalogEntryToConcern(id, findingCatalog[id]),
              ),
        reassessments: unresolvedReassessments,
      });
    }
    return {
      ok: true,
      status: "blocked",
      verdict: parsed.verdict,
      round: effectiveRound,
      packetPath,
      packetId,
      openBlocking,
      openConcerns,
      findings:
        effectiveRound <= 1
          ? parsed.findings
          : openBlocking.map((id) =>
              catalogEntryToConcern(id, findingCatalog[id]),
            ),
      message:
        "BLOCKED — Fixer should address open blocking findings, append # Fix Completion, then: review-loop run --continue",
      warning: evidence.warning,
      needsContinue: true,
    };
  }

  if (parsed.verdict === "PASS_WITH_CONCERNS") {
    return {
      ok: true,
      status: "awaiting_user_decision",
      verdict: parsed.verdict,
      round: effectiveRound,
      packetPath,
      packetId,
      openConcerns,
      concerns: concernRows,
      message:
        "PASS_WITH_CONCERNS — non-blocking concerns remain; user decides archive or another round",
      warning: evidence.warning,
    };
  }

  // PASS / NO_FINDINGS
  return {
    ok: true,
    status: "archived",
    verdict: parsed.verdict,
    round: effectiveRound,
    packetPath,
    packetId,
    message: `✅ auto loop complete — Verdict ${parsed.verdict} after ${effectiveRound} round(s)`,
    warning: evidence.warning,
    report: {
      verdict: parsed.verdict,
      rounds: effectiveRound,
      findingIds,
      lineCount: evidence.lineCount,
    },
  };
}

function deliveryUnknownReport({ packetPath, state, error, code }) {
  return {
    ok: false,
    status: "DELIVERY_UNKNOWN",
    code: code || DELIVERY_UNKNOWN,
    message: `Reviewer invoke failed (no retry): ${error}`,
    packetPath,
    state,
  };
}

/**
 * Parse --rounds: absolute N, or additive +N on continue (T5 budget re-authorization).
 * @param {string|number|null|undefined} raw
 * @param {Record<string, unknown>} prior
 * @param {boolean} isContinue
 */
export function resolveRoundsBudget(raw, prior = {}, isContinue = false) {
  if (raw == null || raw === "") {
    const inherited =
      isContinue && prior.roundsBudget != null
        ? Number(prior.roundsBudget)
        : DEFAULT_ROUNDS;
    return Number.isFinite(inherited) && inherited >= 1
      ? inherited
      : DEFAULT_ROUNDS;
  }
  const text = String(raw).trim();
  if (text.startsWith("+")) {
    const delta = Number(text.slice(1));
    if (!Number.isFinite(delta) || delta < 1) {
      throw new Error("--rounds +N requires a positive finite N");
    }
    const base =
      prior.roundsBudget != null
        ? Number(prior.roundsBudget)
        : prior.round != null
          ? Number(prior.round)
          : DEFAULT_ROUNDS;
    const baseBudget =
      Number.isFinite(base) && base >= 1 ? base : DEFAULT_ROUNDS;
    return baseBudget + delta;
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("--rounds must be a positive finite number");
  }
  return n;
}

/**
 * Latest # Fix Completion stance from packet (actual stage text, not canned copy).
 * `count` is the number of # Fix Completion stages physically on the packet —
 * the only truthful "fix rounds completed" figure (reviewer rounds may run ahead).
 * @param {string|null|undefined} packetPath
 * @returns {{ present: boolean, count: number, conclusion: string|null, findingStatus: string|null, verification: string|null }}
 */
export function extractLatestFixCompletionStance(packetPath) {
  const empty = {
    present: false,
    count: 0,
    conclusion: null,
    findingStatus: null,
    verification: null,
  };
  if (!packetPath || !fs.existsSync(packetPath)) return empty;
  let body = fs.readFileSync(packetPath, "utf8");
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  /** @type {string|null} */
  let lastSection = null;
  let count = 0;
  // Split on top-level H1 (fence-unaware is ok: Fix Completion stages are not fenced titles)
  for (const chunk of body.split(/^# /m)) {
    if (/^Fix Completion(?:\s*\(round\s+\d+\))?\s*(?:\n|$)/i.test(chunk)) {
      lastSection = chunk;
      count += 1;
    }
  }
  if (!lastSection) return empty;

  const h2Body = (heading) => {
    const re = new RegExp(
      `##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      "i",
    );
    const m = lastSection.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    present: true,
    count,
    conclusion: h2Body("Fix Conclusion"),
    findingStatus: h2Body("Finding Status"),
    verification: h2Body("Verification"),
  };
}

function budgetExhaustedReport({
  packetPath,
  state,
  roundsBudget,
  openBlocking,
  findings,
  reassessments,
}) {
  const unresolved = openBlocking || state.openBlocking || [];
  const fixerStance = extractLatestFixCompletionStance(packetPath);
  const unresolvedReassessments = Array.isArray(reassessments)
    ? reassessments
    : [];

  /** @type {Record<string, unknown>} */
  const fixerPosition = fixerStance.present
    ? {
        present: true,
        conclusion: fixerStance.conclusion,
        findingStatus: fixerStance.findingStatus,
        verification: fixerStance.verification,
        // Actual # Fix Completion stages on packet — never the reviewer round counter
        fixRoundsCompleted: fixerStance.count,
      }
    : {
        present: false,
        conclusion: null,
        findingStatus: null,
        verification: null,
        fixRoundsCompleted: 0,
        // First-round budget exhaust (--rounds 1) never had a Fix Completion stage
        note: "No # Fix Completion stage on packet (budget exhausted before a fix pass, or Fix Completion missing)",
      };

  return {
    ok: false,
    status: "budget_exhausted",
    message: `Round budget (${roundsBudget}) exhausted with unresolved blockers`,
    packetPath,
    openBlocking: unresolved,
    unresolved,
    lastVerdict: state.lastVerdict || "BLOCKED",
    roundsUsed: state.round,
    roundsBudget,
    // 双方立场：Reviewer 末轮真实证据 + Fixer 最新 Fix Completion 实际结论
    positions: {
      reviewer: {
        lastVerdict: state.lastVerdict || "BLOCKED",
        openBlocking: unresolved,
        findingIds: state.findingIds || [],
        // New findings this round (may be empty when only prior blockers remain)
        findings: findings || [],
        // Unresolved/partially reassessments with Reviewer 复核证据 (re-review exhaust)
        reassessments: unresolvedReassessments,
      },
      fixer: fixerPosition,
    },
    recommendation:
      "Authorize more rounds: run --continue --rounds +N (additive) or --rounds N (absolute ceiling)",
  };
}

function terminalReport(x) {
  return { ok: true, ...x };
}

/**
 * Historical blocker IDs from findingCatalog (blocking identity never demotes).
 * @param {Record<string, {blocking?: boolean}>|null|undefined} catalog
 * @returns {string[]}
 */
export function catalogBlockingIds(catalog) {
  return Object.entries(catalog || {})
    .filter(([, e]) => e && e.blocking)
    .map(([id]) => id);
}

/**
 * @param {{ id: string, severity?: string, title?: string, targetFiles?: string, blocking?: boolean, evidence?: string, requiredFix?: string, acceptanceCheck?: string }} f
 */
function catalogEntryFromFinding(f) {
  return {
    severity: f.severity || "",
    title: f.title || "",
    targetFiles: f.targetFiles || "",
    blocking: Boolean(f.blocking),
    evidence: f.evidence || "",
    requiredFix: f.requiredFix || "",
    acceptanceCheck: f.acceptanceCheck || "",
  };
}

/**
 * @param {string} id
 * @param {{ severity?: string, title?: string, targetFiles?: string, blocking?: boolean }|undefined} entry
 */
function catalogEntryToConcern(id, entry) {
  return {
    id,
    severity: entry?.severity || "",
    title: entry?.title || "",
    targetFiles: entry?.targetFiles || "",
    blocking: Boolean(entry?.blocking),
  };
}

/**
 * Build findingCatalog + openBlocking + openConcerns from a parsed round.
 * Recomputes open sets from full catalog + latest reassessment (not only prior open sets).
 *
 * @param {{
 *   effectiveRound: number,
 *   parsed: { findings?: any[], newFindings?: any[], reassessments?: {id:string,status:string}[] },
 *   priorCatalog: Record<string, object>,
 *   priorFindingIds: string[],
 * }} opts
 */
export function computeFindingLedger(opts) {
  const { effectiveRound, parsed, priorCatalog, priorFindingIds } = opts;
  /** @type {Record<string, ReturnType<typeof catalogEntryFromFinding>>} */
  const findingCatalog = { ...(priorCatalog || {}) };

  if (effectiveRound <= 1) {
    const findings = parsed.findings || [];
    const seen = new Set();
    for (const f of findings) {
      if (seen.has(f.id)) {
        throw new Error(`duplicate finding id in round 1: ${f.id}`);
      }
      seen.add(f.id);
      findingCatalog[f.id] = catalogEntryFromFinding(f);
    }
    return {
      findingCatalog,
      openBlocking: findings.filter((f) => f.blocking).map((f) => f.id),
      openConcerns: findings.filter((f) => !f.blocking).map((f) => f.id),
      findingIds: findings.map((f) => f.id),
    };
  }

  for (const f of parsed.newFindings || []) {
    if (findingCatalog[f.id]) {
      throw new Error(`New Findings reuses existing finding id: ${f.id}`);
    }
    findingCatalog[f.id] = catalogEntryFromFinding(f);
  }

  const reassessMap = new Map(
    (parsed.reassessments || []).map((r) => [
      r.id,
      String(r.status).toLowerCase(),
    ]),
  );
  const newIds = new Set((parsed.newFindings || []).map((f) => f.id));
  /** @type {string[]} */
  const openBlocking = [];
  /** @type {string[]} */
  const openConcerns = [];

  for (const [id, entry] of Object.entries(findingCatalog)) {
    if (newIds.has(id)) {
      if (entry.blocking) openBlocking.push(id);
      else openConcerns.push(id);
      continue;
    }
    const status = reassessMap.get(id);
    if (!status) {
      throw new Error(`missing reassessment status for catalog id ${id}`);
    }
    if (status === "resolved") continue;
    if (status === "unresolved" || status === "partially") {
      if (entry.blocking) openBlocking.push(id);
      else openConcerns.push(id);
      continue;
    }
    throw new Error(`invalid reassessment status for ${id}: ${status}`);
  }

  const findingIds = [
    ...priorFindingIds,
    ...(parsed.newFindings || []).map((f) => f.id),
  ].filter((v, i, a) => a.indexOf(v) === i);

  return { findingCatalog, openBlocking, openConcerns, findingIds };
}

/**
 * Fail-closed verdict vs open-set invariants (before packet write).
 * @param {string} verdict
 * @param {string[]} openBlocking
 * @param {string[]} openConcerns
 */
export function assertVerdictOpenSets(verdict, openBlocking, openConcerns) {
  const v = String(verdict).toUpperCase();
  const b = openBlocking || [];
  const c = openConcerns || [];
  if (v === "PASS_WITH_CONCERNS") {
    if (b.length) {
      throw new Error("PASS_WITH_CONCERNS requires openBlocking empty");
    }
    if (!c.length) {
      throw new Error("PASS_WITH_CONCERNS requires at least one openConcern");
    }
  }
  if (v === "PASS" || v === "NO_FINDINGS") {
    if (b.length || c.length) {
      throw new Error(
        `${v} requires openBlocking and openConcerns both empty (got blocking=${b.join(",") || "∅"} concerns=${c.join(",") || "∅"})`,
      );
    }
  }
  if (v === "BLOCKED" && !b.length) {
    throw new Error("BLOCKED requires at least one openBlocking id");
  }
}

/**
 * Resolve accepted concerns for close from structured runtime state only.
 * Round-1 PWC without ledger may one-time backfill from openConcerns empty + catalog empty
 * is not allowed for re-review packets.
 *
 * @param {{
 *   state: Record<string, unknown>|null,
 *   lastAnchor: string|null,
 * }} opts
 * @returns {{ id: string, severity: string, title: string, targetFiles?: string, blocking?: boolean }[]}
 */
export function resolveConcernsForClose(opts) {
  const state = opts.state || {};
  const lastAnchor = opts.lastAnchor || "";
  const catalog = /** @type {Record<string, any>} */ (
    state.findingCatalog || null
  );
  const openConcerns = Array.isArray(state.openConcerns)
    ? state.openConcerns.map(String)
    : null;
  const openBlocking = Array.isArray(state.openBlocking)
    ? state.openBlocking.map(String)
    : [];

  if (openBlocking.length) {
    throw new Error(
      `close refuses openBlocking still set (${openBlocking.join(", ")}); only PASS_WITH_CONCERNS with no blockers may close`,
    );
  }

  if (
    catalog &&
    typeof catalog === "object" &&
    openConcerns &&
    openConcerns.length
  ) {
    /** @type {ReturnType<typeof catalogEntryToConcern>[]} */
    const rows = [];
    for (const id of openConcerns) {
      if (!catalog[id]) {
        throw new Error(
          `close openConcerns id ${id} missing from findingCatalog`,
        );
      }
      if (catalog[id].blocking) {
        throw new Error(
          `close openConcerns id ${id} is blocking in catalog (expected non-blocking concern)`,
        );
      }
      rows.push(catalogEntryToConcern(id, catalog[id]));
    }
    return rows;
  }

  // One-time first-round backfill only: review_findings + missing structured state
  // (legacy packets written before findingCatalog). Re-review must fail closed.
  if (lastAnchor === "review_findings" || lastAnchor === "fix_handoff") {
    throw new Error(
      "close missing findingCatalog/openConcerns in auto-run-state.json for first-round PWC; re-run review-loop run so ledger is written, then close again",
    );
  }

  throw new Error(
    "close fail-closed: re-review/terminal PWC requires findingCatalog + non-empty openConcerns in runtime auto-run-state.json (no Markdown reparse). Recovery: re-run the loop from a clean packet, or restore runtime state.",
  );
}

/**
 * User Decision Closure: accept PASS_WITH_CONCERNS and archive without re-review.
 * Does not rewrite original Verdict to PASS.
 *
 * @param {{
 *   repoRoot?: string,
 *   cwd?: string,
 *   packetPath: string,
 *   reason?: string,
 * }} opts
 */
export async function cmdClose(opts) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  const branch = resolveBranch(repoRoot);
  const reason = String(opts.reason || "").trim();
  if (reason !== "accept-concerns") {
    throw new Error(
      "close --reason must be accept-concerns (only supported reason this version)",
    );
  }
  if (!opts.packetPath) throw new Error("--packet required");
  const abs = path.isAbsolute(opts.packetPath)
    ? opts.packetPath
    : path.resolve(repoRoot, opts.packetPath);
  const { packetPath, packetId, meta } = validatePacketPath(
    repoRoot,
    branch,
    abs,
    {
      activeOnly: true,
    },
  );
  if (meta.lifecycleState === "archived") {
    throw new Error("close refuses lifecycle_state=archived (already closed)");
  }
  if (meta.lifecycleState !== "awaiting_user_decision") {
    throw new Error(
      `close refuses lifecycle_state=${meta.lifecycleState} (need awaiting_user_decision after PASS_WITH_CONCERNS)`,
    );
  }
  const last = lastPhysicalH1(meta.text);
  const okPrior =
    last &&
    (last.anchor === "review_findings" ||
      last.anchor === "re_review" ||
      /^re_review/.test(last.anchor));
  if (!okPrior) {
    throw new Error(
      `close refuses last_anchor=${meta.lastAnchor ?? last?.anchor ?? "none"} (need review_findings or re_review after PASS_WITH_CONCERNS)`,
    );
  }

  return withPacketLock(repoRoot, packetId, async () => {
    const metaLocked = readPacketMeta(packetPath);
    if (metaLocked.lifecycleState !== "awaiting_user_decision") {
      throw new Error(
        `close under lock refuses lifecycle_state=${metaLocked.lifecycleState} (need awaiting_user_decision)`,
      );
    }
    const lastLocked = lastPhysicalH1(metaLocked.text);
    const ok =
      lastLocked &&
      (lastLocked.anchor === "review_findings" ||
        lastLocked.anchor === "re_review" ||
        /^re_review/.test(lastLocked.anchor));
    if (!ok) {
      throw new Error(
        `close under lock refuses last_anchor=${metaLocked.lastAnchor ?? lastLocked?.anchor ?? "none"}`,
      );
    }

    const state = loadRunState(repoRoot, packetId);
    const concerns = resolveConcernsForClose({
      state,
      lastAnchor: metaLocked.lastAnchor ?? lastLocked?.anchor ?? null,
    });

    const closedAt = new Date().toISOString();
    const section = formatDecisionClosureStage({
      reason,
      originalVerdict: "PASS_WITH_CONCERNS",
      concerns,
      closedAt,
    });

    const written = appendStageAuto({
      repoRoot,
      packetPath,
      packetId,
      sectionMarkdown: section,
      lastAnchor: "decision_closure",
      lifecycleState: "archived",
      extra: {
        close_reason: reason,
        closed_at: closedAt,
      },
    });
    const reportMeta = readPacketMeta(written.packetPath);
    // Clear open concerns in runtime after archive
    saveRunState(repoRoot, packetId, {
      ...(loadRunState(repoRoot, packetId) || {}),
      openConcerns: [],
      openBlocking: [],
      lifecycle: "archived",
      packetPath: written.packetPath,
      closedAt,
      closeReason: reason,
      updated: closedAt,
    });
    return {
      ok: true,
      status: "archived",
      reason,
      packetPath: written.packetPath,
      packetId,
      lastAnchor: "decision_closure",
      lifecycleState: "archived",
      originalVerdict: "PASS_WITH_CONCERNS",
      acceptedConcernIds: concerns.map((c) => c.id),
      message:
        "PASS_WITH_CONCERNS accepted as backlog — packet archived via Decision Closure (original Verdict not rewritten to PASS)",
      report: {
        originalVerdict: "PASS_WITH_CONCERNS",
        closeReason: reason,
        acceptedConcernIds: concerns.map((c) => c.id),
        closedAt,
        lastAnchor: reportMeta.lastAnchor,
        lifecycleState: reportMeta.lifecycleState,
      },
    };
  });
}

/**
 * Fixer helper: append Fix Completion stage (claim-free) after addressing BLOCKED findings.
 */
export async function cmdAppendFixCompletion(opts) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  const branch = resolveBranch(repoRoot);
  if (!opts.packetPath) throw new Error("--packet required");
  const abs = path.isAbsolute(opts.packetPath)
    ? opts.packetPath
    : path.resolve(repoRoot, opts.packetPath);
  // F4: writes only accept active packets
  const { packetPath, packetId, meta } = validatePacketPath(
    repoRoot,
    branch,
    abs,
    {
      activeOnly: true,
    },
  );
  if (meta.lifecycleState === "archived") {
    throw new Error("fix-completion refuses lifecycle_state=archived");
  }
  // F3: legal stage gate — must follow Fix Handoff or blocked re-review
  const last = lastPhysicalH1(meta.text);
  const okPrior =
    last &&
    (last.anchor === "fix_handoff" ||
      last.anchor === "re_review" ||
      /^re_review/.test(last.anchor) ||
      last.anchor === "fix_completion");
  if (!okPrior) {
    throw new Error(
      `fix-completion refuses last_anchor=${meta.lastAnchor ?? last?.anchor ?? "none"} (need fix_handoff or re_review after BLOCKED)`,
    );
  }
  const body =
    opts.body ||
    (opts.bodyFile ? fs.readFileSync(opts.bodyFile, "utf8") : null);
  if (!body) throw new Error("--body-file or body required");
  let section = String(body).trim();
  // Must be a top-level H1 (# Title), not ## subsection
  if (!/^# [^#\n]/.test(section)) {
    section = `# Fix Completion\n\n${section}\n`;
  }
  // Canonical title required (A2) — reject forged non-fix-completion H1s
  const firstH1 = section.split("\n").find((l) => /^# [^#]/.test(l)) ?? "";
  if (!/^#\s*Fix Completion(\s*\(round\s+\d+\))?\s*$/i.test(firstH1.trim())) {
    throw new Error(
      'fix-completion body must start with "# Fix Completion" H1',
    );
  }
  // F2/F3: require full Fix Completion H2 set — no placeholder auto-fabricate
  const requiredH2 = [
    "Fix Conclusion",
    "Original Findings Snapshot",
    "Finding Status",
    "Verification",
    "Re-review Instructions",
  ];
  const missing = requiredH2.filter(
    (h) => !new RegExp(`##\\s*${h}`, "i").test(section),
  );
  if (missing.length) {
    throw new Error(
      `fix-completion missing required H2 sections: ${missing.join(", ")}`,
    );
  }
  // F3: hold same packet lock as run; re-check last anchor under lock
  return withPacketLock(repoRoot, packetId, async () => {
    const metaLocked = readPacketMeta(packetPath);
    const lastLocked = lastPhysicalH1(metaLocked.text);
    const ok =
      lastLocked &&
      (lastLocked.anchor === "fix_handoff" ||
        lastLocked.anchor === "re_review" ||
        /^re_review/.test(lastLocked.anchor));
    if (!ok) {
      throw new Error(
        `fix-completion under lock refuses last_anchor=${metaLocked.lastAnchor} (need fix_handoff or re_review)`,
      );
    }
    return appendStageAuto({
      repoRoot,
      packetPath,
      packetId,
      sectionMarkdown: section,
      lastAnchor: "fix_completion",
      lifecycleState: "in_progress",
    });
  });
}
