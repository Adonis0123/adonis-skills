/**
 * review-loop auto run — single-writer Fixer-driven loop with headless Reviewer.
 *
 * Commands (via cmdRun / cmdContinue):
 *   run --repo --reviewer [--base] [--rounds 3] [--packet]
 *   run --continue --repo [--packet] [--rounds]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveRepoRoot,
  resolveBranch,
  ensureReviewHandoffLayout,
  createPacketFile,
  readPacketMeta,
  runtimeDir,
  latestActivePacket,
  branchSlug,
} from './repositories.mjs';
import { createAdapter, DELIVERY_UNKNOWN } from './adapters.mjs';
import { freezeRoundEvidence, resolveBaseSha } from './evidence.mjs';
import {
  parseReviewFindings,
  parseReReview,
  formatReviewFindingsStage,
  formatReReviewStage,
  lifecycleForVerdict,
} from './schema.mjs';
import {
  appendStageAuto,
  seedPacketHash,
  loadRunState,
  saveRunState,
} from './stage-writer.mjs';

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
- Style/taste is never blocking.`;

  const schemaRoundN = `Output MUST include ALL of:
1. ## Prior Findings Reassessment — table: ID | 状态(resolved|partially|unresolved) | 复核证据
   Cover every prior finding ID: ${priorFindingIds.join(', ') || '(none)'}
2. ## New Findings — same columns as first-round findings table (only load-bearing blockers allowed)
3. ## Regression Surface — short conclusion
4. Exactly one terminal Verdict: PASS | PASS_WITH_CONCERNS | BLOCKED | NO_FINDINGS
Missing any section (including Verdict) is malformed.`;

  const parts = [
    'You are a read-only code reviewer in an auto review loop.',
    `Packet path: ${packetPath}`,
    `Base SHA (pinned): ${baseSha}`,
    `Frozen evidence file (authoritative — read this file): ${evidencePath}`,
    `Paths in scope: ${(paths || []).join(', ') || '(see evidence file)'}`,
    `Round: ${round}`,
    round <= 1 ? schemaRound1 : schemaRoundN,
    'Do not modify any files. Do not write the packet. Stdout only.',
  ];
  if (correctionNote) {
    parts.push(`CORRECTION (previous output was malformed): ${correctionNote}`);
    parts.push('Re-emit a complete valid response only.');
  }
  return parts.join('\n');
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
  const roundsBudget = Number(opts.rounds ?? DEFAULT_ROUNDS) || DEFAULT_ROUNDS;
  const reviewer = String(opts.reviewer || opts.productReviewer || 'codex').toLowerCase();
  if (!['codex', 'grok', 'claude'].includes(reviewer)) {
    throw new Error(`--reviewer must be codex|grok|claude, got ${reviewer}`);
  }

  // Resolve / create packet
  let packetPath = opts.packetPath || null;
  let packetId = opts.packetId || null;
  if (!packetPath && packetId) {
    // try active path reconstruction
    const base = packetId.includes('/') ? packetId.split('/').pop() : packetId;
    const candidate = path.join(
      repoRoot,
      '.review-handoff',
      'active',
      branchSlug(branch),
      `${base}.md`,
    );
    if (fs.existsSync(candidate)) packetPath = candidate;
  }
  if (!packetPath && isContinue) {
    packetPath = latestActivePacket(repoRoot, branch);
  }

  if (!packetPath) {
    if (isContinue) throw new Error('run --continue requires an active packet');
    const created = createPacketFile(repoRoot, branch, opts.scopeSlug || 'auto-loop');
    packetPath = created.packetPath;
    packetId = created.packetId;
  }

  const meta0 = readPacketMeta(packetPath);
  packetId = packetId || meta0.packetId;
  if (!packetId) throw new Error('packet_id missing');

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
  const lockDir = path.join(runtimeDir(repoRoot, packetId), '.auto-run.lock');
  const pidFile = path.join(lockDir, 'pid');
  try {
    fs.mkdirSync(lockDir);
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    let oldPid = 0;
    try {
      oldPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    } catch {
      oldPid = 0;
    }
    let alive = false;
    if (oldPid > 0) {
      try {
        process.kill(oldPid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) {
      const e = new Error(`packet lock held by pid ${oldPid}`);
      // @ts-expect-error
      e.code = 'PACKET_LOCK_HELD';
      throw e;
    }
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.mkdirSync(lockDir);
  }
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  try {
    return await operation();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
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

  // Pin base SHA
  let baseSha = state.baseSha;
  if (!baseSha) {
    baseSha = resolveBaseSha(repoRoot, base);
  }
  if (!state.packetHash) {
    seedPacketHash(repoRoot, packetId, packetPath);
    state = loadRunState(repoRoot, packetId);
  }

  const round = Number(state.round ?? 0);
  const nextRound = isContinue ? round + 1 : Math.max(round, 0) + 1;
  // On first start: if never ran, nextRound=1. On continue after BLOCKED fix: increment.

  if (!isContinue && round > 0) {
    // Re-entry without --continue after partial run: allow only if no review yet
    if (state.lastVerdict && state.lastVerdict !== 'BLOCKED') {
      throw new Error(
        `packet already has verdict ${state.lastVerdict}; use --continue or a new packet`,
      );
    }
  }

  // If continuing from BLOCKED, expect Fix Completion already written by fixer (human/agent)
  if (isContinue) {
    const meta = readPacketMeta(packetPath);
    if (meta.lifecycleState === 'archived') {
      return terminalReport({
        status: 'already_archived',
        packetPath,
        state,
        message: 'Packet already archived',
      });
    }
  }

  const effectiveRound = isContinue ? nextRound : 1;
  if (effectiveRound > roundsBudget && !state.budgetOverride) {
    return budgetExhaustedReport({ packetPath, state, roundsBudget });
  }

  // Freeze evidence
  const evidence = freezeRoundEvidence({
    repoRoot,
    packetId,
    baseSha,
    round: effectiveRound,
    paths: ctx.paths,
  });

  const adapter = (adapterFactory || createAdapter)(reviewer, {
    repoRoot,
    packetId,
    ...(adapterOpts || {}),
  });

  const priorFindingIds = state.findingIds || [];
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
      : parseReReview(invokeResult.text, priorFindingIds);

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
        : parseReReview(retry.text, priorFindingIds);
    if (!parsed.ok) {
      return {
        ok: false,
        status: 'malformed_reviewer_output',
        message: `Reviewer output malformed after one correction: ${parsed.error}`,
        packetPath,
        error: parsed.error,
        // packet must have no half-write
      };
    }
    invokeResult = retry;
  }

  // Format stages + write
  const lifecycle = lifecycleForVerdict(
    effectiveRound <= 1 ? 'review_findings' : 're_review',
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
    // When Fix Handoff is included, last physical H1 is Fix Handoff
    lastAnchor =
      parsed.verdict === 'BLOCKED' || parsed.verdict === 'PASS_WITH_CONCERNS'
        ? 'fix_handoff'
        : 'review_findings';
  } else {
    sectionMarkdown = formatReReviewStage({
      verdict: parsed.verdict,
      reassessments: parsed.reassessments,
      newFindings: parsed.newFindings,
      reviewer,
      round: effectiveRound,
      evidencePath: evidence.evidencePath,
    });
    lastAnchor = 're_review';
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
        mode: 'auto',
      },
    });
    packetPath = writeResult.packetPath;
  } catch (err) {
    if (err?.code === 'PACKET_HASH_MISMATCH') {
      return {
        ok: false,
        status: 'packet_hash_mismatch',
        message: err.message,
        packetPath,
      };
    }
    throw err;
  }

  // Update run state
  const findingIds =
    effectiveRound <= 1
      ? (parsed.findings || []).map((f) => f.id)
      : [
          ...priorFindingIds,
          ...(parsed.newFindings || []).map((f) => f.id),
        ].filter((v, i, a) => a.indexOf(v) === i);

  const openBlocking =
    effectiveRound <= 1
      ? (parsed.findings || []).filter((f) => f.blocking).map((f) => f.id)
      : [
          ...(parsed.reassessments || [])
            .filter((r) => /unresolved|partial/i.test(r.status))
            .map((r) => r.id),
          ...(parsed.newFindings || []).filter((f) => f.blocking).map((f) => f.id),
        ];

  const nextState = {
    ...loadRunState(repoRoot, packetId),
    baseSha,
    round: effectiveRound,
    roundsBudget,
    reviewer,
    lastVerdict: parsed.verdict,
    findingIds,
    openBlocking,
    lifecycle,
    packetPath,
    evidencePath: evidence.evidencePath,
    lineCount: evidence.lineCount,
    updated: new Date().toISOString(),
  };
  saveRunState(repoRoot, packetId, nextState);

  // Clean packet STOP if present on terminal
  const packetStop = path.join(runtimeDir(repoRoot, packetId), 'STOP');
  if (lifecycle === 'archived' && fs.existsSync(packetStop)) {
    fs.unlinkSync(packetStop);
  }

  if (parsed.verdict === 'BLOCKED') {
    return {
      ok: true,
      status: 'blocked',
      verdict: parsed.verdict,
      round: effectiveRound,
      packetPath,
      packetId,
      openBlocking,
      findings: effectiveRound <= 1 ? parsed.findings : parsed.newFindings,
      message:
        'BLOCKED — Fixer should address open blocking findings, append # Fix Completion, then: review-loop run --continue',
      warning: evidence.warning,
      needsContinue: true,
    };
  }

  if (parsed.verdict === 'PASS_WITH_CONCERNS') {
    return {
      ok: true,
      status: 'awaiting_user_decision',
      verdict: parsed.verdict,
      round: effectiveRound,
      packetPath,
      packetId,
      concerns: effectiveRound <= 1 ? parsed.findings : parsed.newFindings,
      message: 'PASS_WITH_CONCERNS — non-blocking concerns remain; user decides archive or another round',
      warning: evidence.warning,
    };
  }

  // PASS / NO_FINDINGS
  return {
    ok: true,
    status: 'archived',
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
    status: 'DELIVERY_UNKNOWN',
    code: code || DELIVERY_UNKNOWN,
    message: `Reviewer invoke failed (no retry): ${error}`,
    packetPath,
    state,
  };
}

function budgetExhaustedReport({ packetPath, state, roundsBudget }) {
  return {
    ok: false,
    status: 'budget_exhausted',
    message: `Round budget (${roundsBudget}) exhausted with unresolved blockers`,
    packetPath,
    openBlocking: state.openBlocking || [],
    lastVerdict: state.lastVerdict,
    recommendation: 'Authorize more rounds: run --continue --rounds N (new budget)',
  };
}

function terminalReport(x) {
  return { ok: true, ...x };
}

/**
 * Fixer helper: append Fix Completion stage (claim-free) after addressing BLOCKED findings.
 */
export function cmdAppendFixCompletion(opts) {
  const repoRoot = opts.repoRoot || resolveRepoRoot(opts.cwd || process.cwd());
  const packetPath = opts.packetPath;
  if (!packetPath) throw new Error('--packet required');
  const meta = readPacketMeta(packetPath);
  const packetId = meta.packetId;
  const body =
    opts.body
    || (opts.bodyFile ? fs.readFileSync(opts.bodyFile, 'utf8') : null);
  if (!body) throw new Error('--body-file or body required');
  let section = String(body).trim();
  // Must be a top-level H1 (# Title), not ## subsection
  if (!/^# [^#\n]/.test(section)) {
    section = `# Fix Completion\n\n${section}\n`;
  }
  return appendStageAuto({
    repoRoot,
    packetPath,
    packetId,
    sectionMarkdown: section,
    lastAnchor: 'fix_completion',
    lifecycleState: 'in_progress',
  });
}
