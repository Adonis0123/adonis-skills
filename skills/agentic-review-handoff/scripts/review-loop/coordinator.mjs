/**
 * Application commands: bind, next/wait, complete, status, gate, resolve, disarm, board, append-eof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyBind,
  applyBlindComplete,
  applyComplete,
  applyDisarm,
  applyDriverStatus,
  applyGate,
  applyOpenClaim,
  applyPacketProjection,
  applyResolve,
  bothRolesBound,
  clearResolvedGate,
  createEmptyRun,
  deriveNextAction,
  normalizeArms,
} from './review-run.mjs';
import * as repo from './repositories.mjs';
import { selectDriver } from './session-driver.mjs';

export function reconstructRun({ repoRoot, packetPath, packetId, meta, runtime }) {
  const metaRun = runtime.runMeta ?? {};
  const arms = normalizeArms({
    loop: metaRun.loop ?? meta.frontmatter.loop ?? 'on',
    profile: metaRun.profile ?? meta.frontmatter.profile ?? 'standard',
    runtime: metaRun.runtime ?? meta.frontmatter.runtime_mode ?? 'visible',
  });

  let run = createEmptyRun({
    packetId,
    branch: meta.frontmatter.branch,
    packetPath,
    repoRoot,
    loop: arms.loop,
    profile: arms.profile,
    runtime: arms.runtime,
  });

  run = applyPacketProjection(run, {
    lastAnchor: meta.lastAnchor,
    lifecycleState: meta.lifecycleState,
  });

  run.bindings = {
    reviewer: runtime.bindings?.reviewer ?? null,
    fixer: runtime.bindings?.fixer ?? null,
  };
  run.claimGeneration = runtime.claim?.generation ?? metaRun.claimGeneration ?? 0;
  if (runtime.claim?.status === 'active') {
    run.claim = runtime.claim;
  } else {
    run.claim = runtime.claim?.status === 'released' ? runtime.claim : null;
  }
  if (runtime.gate?.status === 'pending') {
    run.gate = runtime.gate;
  }
  run.blindCompleted = Boolean(metaRun.blindCompleted);
  // run-meta.driverStatus is authoritative after resolve recovery; driver.json is a mirror.
  run.driverStatus =
    metaRun.driverStatus != null
      ? metaRun.driverStatus
      : (runtime.driver?.status ?? 'ok');
  run.stopped = Boolean(metaRun.stopped) || meta.lifecycleState === 'archived';
  return run;
}

function persistRun(repoRoot, packetId, run, extraDriver = null) {
  repo.saveBindings(repoRoot, packetId, run.bindings);
  repo.saveClaim(repoRoot, packetId, run.claim?.status === 'active' ? run.claim : run.claim);
  // Durable gate is pending-only. After resolve/clearResolvedGate, run.gate is null —
  // always delete gate.json so the next process does not reload a stale pending gate.
  if (run.gate?.status === 'pending') {
    repo.saveGate(repoRoot, packetId, run.gate);
  } else {
    repo.saveGate(repoRoot, packetId, null);
  }
  repo.saveRunMeta(repoRoot, packetId, {
    loop: run.loop,
    profile: run.profile,
    runtime: run.runtime,
    claimGeneration: run.claimGeneration,
    blindCompleted: run.blindCompleted ?? false,
    driverStatus: run.driverStatus ?? 'ok',
    stopped: run.stopped,
    packetPath: run.packetPath ?? null,
    lastAnchor: run.lastAnchor ?? null,
    lifecycleState: run.lifecycleState ?? null,
  });
  // Always rewrite driver.json so resolve(retry_driver|…) cannot leave stale unavailable.
  const prev = repo.readJson(
    path.join(repo.runtimeDir(repoRoot, packetId), 'driver.json'),
    null,
  );
  const driverPayload = {
    kind: extraDriver?.kind ?? prev?.kind ?? 'visible-wait',
    status: run.driverStatus ?? extraDriver?.status ?? prev?.status ?? 'ok',
    product: extraDriver?.product ?? prev?.product ?? null,
    h1Passed: extraDriver?.h1Passed ?? prev?.h1Passed ?? false,
    dryRun: extraDriver?.dryRun ?? prev?.dryRun ?? false,
    ...(extraDriver ?? {}),
    status: run.driverStatus ?? extraDriver?.status ?? prev?.status ?? 'ok',
  };
  repo.saveDriver(repoRoot, packetId, driverPayload);
  repo.appendEvent(repoRoot, packetId, { type: 'persist', lastAnchor: run.lastAnchor });
}

/**
 * Human bootstrap: create ONE packet and emit two copy-ready prompts so both
 * Codex/Claude windows can be filled at the same time (no "wait for A bind first").
 */
export function cmdOpen(opts) {
  const repoRoot = opts.repoRoot ?? repo.resolveRepoRoot(opts.cwd);
  const branch = opts.branch ?? repo.resolveBranch(repoRoot);
  repo.ensureReviewHandoffLayout(repoRoot);

  const arms = normalizeArms({
    loop: 'on',
    profile: opts.profile ?? 'standard',
    runtime: opts.runtime ?? 'visible',
  });
  const driverKind = opts.driver ?? 'fake';
  const scopeSlug = opts.scopeSlug ?? 'review-loop';
  const productReviewer = opts.productReviewer ?? opts.product ?? 'codex';
  const productFixer = opts.productFixer ?? opts.product ?? 'codex';
  const rlAbs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../review-loop.mjs');

  let packetPath = opts.packetPath ?? null;
  let packetId = opts.packetId ?? null;
  if (packetPath) {
    const validated = repo.validatePacketPath(repoRoot, branch, packetPath);
    packetPath = validated.packetPath;
    packetId = validated.packetId;
  } else {
    const created = repo.createPacketFile(repoRoot, branch, scopeSlug);
    packetPath = created.packetPath;
    packetId = created.packetId;
  }

  repo.rewriteFrontmatter(packetPath, {
    loop: 'on',
    profile: arms.profile,
    runtime_mode: arms.runtime,
  });

  // Seed runtime so board works before either agent binds
  const run = createEmptyRun({
    packetId,
    branch,
    packetPath,
    repoRoot,
    loop: 'on',
    profile: arms.profile,
    runtime: arms.runtime,
  });
  const meta = repo.readPacketMeta(packetPath);
  run.lastAnchor = meta.lastAnchor;
  run.lifecycleState = meta.lifecycleState;
  persistRun(repoRoot, packetId, run, {
    kind: driverKind,
    status: 'ok',
    h1Passed: opts.h1Passed ?? false,
    dryRun: driverKind === 'fake',
  });

  const prompts = buildPairPrompts({
    rlAbs,
    repoRoot,
    packetPath,
    packetId,
    driverKind,
    profile: arms.profile,
    runtime: arms.runtime,
    productReviewer,
    productFixer,
  });

  const dir = repo.runtimeDir(repoRoot, packetId);
  const promptsFile = path.join(dir, 'PROMPTS.md');
  const reviewerFile = path.join(dir, 'PROMPT_REVIEWER.txt');
  const fixerFile = path.join(dir, 'PROMPT_FIXER.txt');
  const guideText = [
    '# review-loop open — 双窗可同时粘贴',
    '',
    '你（人）只做三步：',
    '1. 开两个 agent 窗（Codex A=Reviewer，Codex B=Fixer）',
    '2. **同时**把下面两段 prompt 分别贴进 A / B（不必等谁先 bind）',
    '3. 进度只看: node review-loop.mjs board --repo "' + repoRoot + '"',
    '   Gate 只 resolve 一次；结束看 summary',
    '',
    '## 文件',
    `- packet: ${packetPath}`,
    `- PROMPT_REVIEWER.txt / PROMPT_FIXER.txt（同目录可 cat 复制）`,
    '',
    '---',
    '',
    '## Codex A — Reviewer（整段复制）',
    '',
    prompts.reviewer,
    '',
    '---',
    '',
    '## Codex B — Fixer（整段复制）',
    '',
    prompts.fixer,
    '',
  ].join('\n');
  fs.writeFileSync(promptsFile, guideText, 'utf8');
  fs.writeFileSync(reviewerFile, prompts.reviewer, 'utf8');
  fs.writeFileSync(fixerFile, prompts.fixer, 'utf8');
  repo.writeJson(path.join(dir, 'pair.json'), {
    packetPath,
    packetId,
    openedAt: new Date().toISOString(),
    driver: driverKind,
    productReviewer,
    productFixer,
  });

  return {
    ok: true,
    command: 'open',
    simultaneous: true,
    packetPath,
    packetId,
    repoRoot,
    rl: rlAbs,
    driver: driverKind,
    profile: arms.profile,
    runtime: arms.runtime,
    promptsFile,
    reviewerPromptFile: reviewerFile,
    fixerPromptFile: fixerFile,
    prompts: {
      reviewer: prompts.reviewer,
      fixer: prompts.fixer,
    },
    human: {
      action:
        '【双窗同时贴】cat PROMPT_REVIEWER.txt → 窗A；cat PROMPT_FIXER.txt → 窗B。不必等谁先 bind。\n' +
        `文件: ${promptsFile}`,
      resolveOnce: false,
    },
    nextStep: [
      `cat "${reviewerFile}"  # 贴进 Codex A`,
      `cat "${fixerFile}"     # 贴进 Codex B（可同时）`,
      `node "${rlAbs}" board --repo "${repoRoot}"`,
    ],
  };
}

function buildPairPrompts({
  rlAbs,
  repoRoot,
  packetPath,
  packetId,
  driverKind,
  profile,
  runtime,
  productReviewer,
  productFixer,
}) {
  const commonRules = [
    '硬规则：',
    '- 禁止用编辑器/ApplyPatch 修改 .review-handoff/** 里的 packet（只能 append-eof）',
    '- Gate：打印 human.action，禁止自行 resolve；不要两边都问 continue',
    '- complete 后若 allTasksComplete：summary 贴用户一次后停；否则 blocking wait',
    `- 本 session 固定 packet：--packet "${packetPath}"（不要 --create-packet）`,
  ].join('\n');

  const autoStageNote =
    driverKind === 'fake'
      ? '干跑可用 complete --auto-stage；真审时去掉 auto-stage，改用 append-eof 写真实 H1。'
      : '禁止 --auto-stage；阶段正文写到 /tmp 后 append-eof，再 complete。';

  const reviewer = [
    '你是 dual-session review-loop 的 **Reviewer**（只审不改 subject 代码）。',
    `REPO="${repoRoot}"`,
    `RL="${rlAbs}"`,
    `PACKET="${packetPath}"  # packet_id=${packetId}`,
    '',
    '1) 只 bind 一次（包已由 open 建好，可与 Fixer 同时 bind）：',
    `node "$RL" bind --repo "$REPO" --packet "$PACKET" --role reviewer --product ${productReviewer} \\`,
    `  --loop=on --profile=${profile} --runtime=${runtime} --driver=${driverKind}`,
    '',
    '2) next；若 wait_bind/idle → blocking wait，不要结束回合：',
    'node "$RL" next --repo "$REPO" --packet "$PACKET" --role reviewer',
    'node "$RL" wait --repo "$REPO" --packet "$PACKET" --role reviewer --poll-ms=500 --heartbeat-ms=15000',
    '',
    '3) 有 claim 后做 review / re-review；' + autoStageNote,
    'node "$RL" complete --repo "$REPO" --packet "$PACKET" --role reviewer' +
      (driverKind === 'fake' ? ' --auto-stage' : ''),
    '',
    '4) complete 后 wait；全部完成则 summary 贴用户。',
    '',
    commonRules,
  ].join('\n');

  const fixer = [
    '你是 dual-session review-loop 的 **Fixer**（按 Fix Handoff 改代码 + Fix Completion）。',
    `REPO="${repoRoot}"`,
    `RL="${rlAbs}"`,
    `PACKET="${packetPath}"  # packet_id=${packetId}`,
    '',
    '1) 只 bind 一次（可与 Reviewer 同时 bind，不必等对方）：',
    `node "$RL" bind --repo "$REPO" --packet "$PACKET" --role fixer --product ${productFixer} \\`,
    `  --loop=on --profile=${profile} --runtime=${runtime} --driver=${driverKind}`,
    '',
    '2) next；若 wait_bind/idle → blocking wait：',
    'node "$RL" next --repo "$REPO" --packet "$PACKET" --role fixer',
    'node "$RL" wait --repo "$REPO" --packet "$PACKET" --role fixer --poll-ms=500 --heartbeat-ms=15000',
    '',
    '3) 有 claim 后修代码并写 Fix Completion；' + autoStageNote,
    'node "$RL" complete --repo "$REPO" --packet "$PACKET" --role fixer' +
      (driverKind === 'fake' ? ' --auto-stage' : ''),
    '',
    '4) complete 后 wait 等 re-review；不要归档 packet。',
    '',
    commonRules,
  ].join('\n');

  return { reviewer, fixer };
}

export function cmdBind(opts) {
  const repoRoot = opts.repoRoot ?? repo.resolveRepoRoot(opts.cwd);
  const branch = opts.branch ?? repo.resolveBranch(repoRoot);
  repo.ensureReviewHandoffLayout(repoRoot);

  const arms = normalizeArms({
    loop: opts.loop ?? 'on',
    profile: opts.profile,
    runtime: opts.runtime,
  });
  if (arms.loop !== 'on') {
    throw new Error('bind requires --loop=on');
  }

  let packetPath = opts.packetPath ?? null;
  let packetId = opts.packetId ?? null;

  if (!packetPath) {
    const latest = repo.latestActivePacket(repoRoot, branch);
    if (latest && !opts.createPacket) {
      packetPath = latest;
    } else if (opts.createPacket || opts.role === 'reviewer') {
      // Reviewer may create; preferred path is still review-loop open (simultaneous prompts).
      const created = repo.createPacketFile(repoRoot, branch, opts.scopeSlug ?? 'review-loop');
      packetPath = created.packetPath;
      packetId = created.packetId;
    } else {
      throw new Error(
        'No active packet for fixer bind. Human should run: review-loop open --repo <repo> ' +
          '(then both windows bind with the same --packet). Or pass --packet explicitly.',
      );
    }
  }

  const validated = repo.validatePacketPath(repoRoot, branch, packetPath);
  packetPath = validated.packetPath;
  const meta = validated.meta;
  packetId = packetId ?? validated.packetId;
  if (packetId !== validated.packetId) {
    throw new Error(`packet_id override mismatch: expected ${validated.packetId}, got ${packetId}`);
  }

  const runtime = repo.loadRuntimeBundle(repoRoot, packetId);
  const driverKind = opts.driver ?? runtime.driver?.kind ?? 'visible-wait';
  if (runtime.driver?.kind && opts.driver && opts.driver !== runtime.driver.kind) {
    throw new Error(`Driver mismatch: run has ${runtime.driver.kind}, bind has ${opts.driver}`);
  }
  let run = reconstructRun({ repoRoot, packetPath, packetId, meta, runtime });
  run.loop = 'on';
  run.profile = arms.profile;
  run.runtime = arms.runtime;
  run.packetPath = packetPath;
  run.packetId = packetId;
  run.repoRoot = repoRoot;

  run = applyBind(run, {
    role: opts.role,
    product: opts.product ?? 'unknown',
    bindingId: opts.bindingId,
    profile: arms.profile,
    runtime: arms.runtime,
  });

  // Project loop arms into packet frontmatter
  repo.rewriteFrontmatter(packetPath, {
    loop: 'on',
    profile: arms.profile,
    runtime_mode: arms.runtime,
    last_anchor: meta.lastAnchor ?? 'review_handoff',
    lifecycle_state: meta.lifecycleState ?? 'in_progress',
  });

  const h1Passed = opts.h1Passed ?? runtime.driver?.h1Passed ?? false;
  const driver = selectDriver({
    runtime: arms.runtime,
    driverKind,
    h1Passed,
  });
  const health = driver.reportHealth?.() ?? { status: 'ok' };
  if (health.status === 'unavailable' || health.status === 'h1_ineligible') {
    if (!run.gate?.status) run = applyDriverStatus(run, health.status);
    else run.driverStatus = health.status;
  } else {
    run.driverStatus = health.status ?? 'ok';
  }

  persistRun(repoRoot, packetId, run, {
    kind: driverKind,
    status: health.status ?? 'ok',
    product: opts.product ?? null,
    h1Passed,
    dryRun: driverKind === 'fake',
  });

  const next = deriveNextAction(run, opts.role);
  const missing = next.kind === 'wait_bind' ? next.missing : [];
  let guide = null;
  if (next.kind === 'wait_bind') {
    guide =
      missing.includes('fixer') && !missing.includes('reviewer')
        ? '【引导】Reviewer 已就绪，请把 open 生成的 Fixer prompt 贴进另一窗（或已贴则等其 bind）。两边可同时贴，不必排队。'
        : missing.includes('reviewer') && !missing.includes('fixer')
          ? '【引导】Fixer 已就绪，请把 open 生成的 Reviewer prompt 贴进另一窗。'
          : '【引导】还缺角色 bind。对人：cat runtime/.../PROMPT_*.txt 同时贴两窗。';
  } else if (next.kind === 'act') {
    guide = `【引导】两边已绑定。你（${opts.role}）应 next/wait 领取 claim 并开始 ${next.action}。`;
  }

  return {
    ok: true,
    command: 'bind',
    packetPath,
    packetId,
    role: opts.role,
    bothBound: bothRolesBound(run),
    profile: run.profile,
    runtime: run.runtime,
    next,
    guide,
    human: guide
      ? { action: guide, resolveOnce: false }
      : { action: 'Run board for status', resolveOnce: false },
  };
}

export function loadContext(opts) {
  const repoRoot = opts.repoRoot ?? repo.resolveRepoRoot(opts.cwd);
  const branch = opts.branch ?? repo.resolveBranch(repoRoot);
  let packetPath =
    opts.packetPath
    ?? repo.latestActivePacket(repoRoot, branch)
    // After PASS archive, active/ is empty — still allow board/summary on latest archive
    ?? repo.latestArchivedPacket(repoRoot, branch);
  if (!packetPath) throw new Error('No active or archived packet; run bind first');
  const validated = repo.validatePacketPath(repoRoot, branch, packetPath);
  packetPath = validated.packetPath;
  const meta = validated.meta;
  const packetId = opts.packetId ?? validated.packetId;
  if (packetId !== validated.packetId) {
    throw new Error(`packet_id override mismatch: expected ${validated.packetId}, got ${packetId}`);
  }
  const runtime = repo.loadRuntimeBundle(repoRoot, packetId);
  const run = reconstructRun({ repoRoot, packetPath, packetId, meta, runtime });
  run.packetPath = packetPath;
  run.packetId = packetId;
  run.repoRoot = repoRoot;
  return { repoRoot, branch, packetPath, packetId, meta, runtime, run };
}

export function cmdStatus(opts) {
  const board = cmdBoard(opts);
  if (opts.boardOnly) return board;
  return {
    ...board,
    command: 'status',
  };
}

/**
 * Single control-plane view: one place for humans to see progress and Gate actions.
 * Workers should still use next/wait/complete; humans use `board` / `status`.
 */
export function cmdBoard(opts) {
  const ctx = loadContext(opts);
  const next = deriveNextAction(ctx.run, opts.role);
  const physical = repo.listPhysicalH1s(ctx.meta.text);
  const lastPhysical = physical.at(-1) ?? null;
  const gate = ctx.run.gate?.status === 'pending' ? ctx.run.gate : null;
  const claim = ctx.run.claim?.status === 'active' ? ctx.run.claim : null;

  let phase = 'unknown';
  let nextHuman = 'Run: node review-loop.mjs board --repo <repo>';
  let nextWorker = null;

  if (gate) {
    phase = `GATE:${gate.type}`;
    // A8: render only durable allowedResolutions (no hardcoded continue|stop overwrite)
    const resolutions = (gate.allowedResolutions || ['continue', 'stop']).join('|');
    nextHuman =
      `【人只需做一次】node review-loop.mjs resolve --repo "${ctx.repoRoot}" --decision <${resolutions}>\n` +
      `证据: ${String(gate.evidence || '').slice(0, 200)}`;
    nextWorker = 'workers: 禁止自行 resolve；wait 会返回 gate，静默等待人 resolve';
  } else if (ctx.run.stopped || ctx.run.lifecycleState === 'archived') {
    phase = 'DONE';
    nextHuman =
      '✅ 任务全部完成。在本 agent 展示 summary（node review-loop.mjs summary），无需再 continue。';
  } else if (claim) {
    phase = `WORKING:${claim.role}`;
    nextHuman = `Wait — ${claim.role} holds claim gen=${claim.generation}`;
    nextWorker = `${claim.role}: finish stage via append-eof + complete`;
  } else if (next.kind === 'act') {
    const who = next.role === 'both' ? 'reviewer+fixer' : next.role;
    phase = `READY:${who}`;
    nextHuman = `No human action. ${who} should next/wait.`;
    nextWorker = `${who}: node review-loop.mjs next --role ${who === 'reviewer+fixer' ? 'reviewer' : who}`;
  } else if (next.kind === 'idle' || next.kind === 'busy' || next.kind === 'wait_bind') {
    phase = `WAIT:${next.nextRole || next.kind}`;
    if (next.kind === 'wait_bind') {
      const missing = next.missing?.length ? next.missing.join('+') : 'peer';
      const dir = repo.runtimeDir(ctx.repoRoot, ctx.packetId);
      const promptsExist = fs.existsSync(path.join(dir, 'PROMPTS.md'));
      nextHuman = promptsExist
        ? `【引导·可同时贴】还缺 bind: ${missing}。\n` +
          `  cat "${path.join(dir, 'PROMPT_REVIEWER.txt')}" → 窗A\n` +
          `  cat "${path.join(dir, 'PROMPT_FIXER.txt')}" → 窗B\n` +
          `不必等谁先成功；两边用同一 --packet。`
        : `【引导】还缺 bind: ${missing}。人对齐：node review-loop.mjs open --repo "${ctx.repoRoot}" 生成双 prompt 后同时贴两窗。`;
      nextWorker = `missing=${missing}; bound roles wait with blocking wait`;
    } else {
      nextHuman = next.message || 'Waiting for peer worker';
      nextWorker = next.nextRole
        ? `${next.nextRole}: next/wait`
        : 'bind missing roles or wait';
    }
  } else {
    phase = next.kind;
    nextHuman = next.message || next.kind;
  }

  const line =
    `loop=${ctx.run.loop}/${ctx.run.profile} | ${ctx.run.lastAnchor}/${ctx.run.lifecycleState} | ` +
    `phase=${phase} | physicalH1=${lastPhysical?.anchor ?? '-'} | ` +
    `claim=${claim ? `${claim.role}#${claim.generation}` : '-'} | gate=${gate ? gate.type : '-'}`;

  const report =
    phase === 'DONE' || ctx.run.lifecycleState === 'archived' || ctx.run.stopped
      ? repo.buildCompletionReport({
          packetPath: ctx.packetPath,
          meta: ctx.meta,
          packetId: ctx.packetId,
          stopped: ctx.run.stopped,
        })
      : null;

  // Durable one-file human view (single control plane artifact)
  try {
    const boardPath = path.join(repo.runtimeDir(ctx.repoRoot, ctx.packetId), 'BOARD.txt');
    const boardText = [
      'review-loop BOARD (single control plane — prefer this over chat history)',
      `updated: ${new Date().toISOString()}`,
      line,
      '',
      `packet: ${ctx.packetPath}`,
      `packet_id: ${ctx.packetId}`,
      `physical H1 order: ${physical.map((h) => h.anchor).join(' → ') || '(none)'}`,
      '',
      'YOU (human):',
      nextHuman,
      '',
      'WORKERS:',
      nextWorker || '-',
      '',
      'Rules:',
      '- Append stages only via: review-loop append-eof (never mid-file edit)',
      '- Gate: resolve once; other window just wait',
      '- Progress: re-run board anytime',
      '- DONE: run summary and paste the report into the agent chat once',
      '',
      report ? '--- SUMMARY ---\n' + report.text : '',
    ].join('\n');
    fs.writeFileSync(boardPath, boardText, 'utf8');
    if (report) {
      fs.writeFileSync(
        path.join(repo.runtimeDir(ctx.repoRoot, ctx.packetId), 'SUMMARY.txt'),
        report.text,
        'utf8',
      );
    }
  } catch {
    /* best-effort */
  }

  return {
    ok: true,
    command: 'board',
    line,
    phase,
    packetPath: ctx.packetPath,
    packetId: ctx.packetId,
    loop: ctx.run.loop,
    profile: ctx.run.profile,
    runtime: ctx.run.runtime,
    lastAnchor: ctx.run.lastAnchor,
    lifecycleState: ctx.run.lifecycleState,
    lastPhysicalH1: lastPhysical,
    physicalH1s: physical,
    bindings: summarizeBindings(ctx.run.bindings),
    claim: claim
      ? { generation: claim.generation, role: claim.role, status: claim.status }
      : null,
    gate: gate
      ? {
          type: gate.type,
          status: gate.status,
          allowedResolutions: gate.allowedResolutions,
          evidence: String(gate.evidence || '').slice(0, 300),
        }
      : null,
    driverStatus: ctx.run.driverStatus,
    next,
    human: {
      summary: line,
      action: nextHuman,
      resolveOnce: Boolean(gate),
      allTasksComplete: Boolean(report?.allTasksComplete),
    },
    worker: { action: nextWorker },
    boardFile: path.join(repo.runtimeDir(ctx.repoRoot, ctx.packetId), 'BOARD.txt'),
    report,
    allTasksComplete: Boolean(report?.allTasksComplete),
  };
}

/**
 * Final report for a single agent chat: "✅ 任务全部完成" + concise summary.
 * Prefer this (or board when phase=DONE) over scrolling dual-window history.
 */
export function cmdSummary(opts) {
  const ctx = loadContext(opts);
  const report = repo.buildCompletionReport({
    packetPath: ctx.packetPath,
    meta: ctx.meta,
    packetId: ctx.packetId,
    stopped: ctx.run.stopped,
  });
  try {
    const dir = repo.runtimeDir(ctx.repoRoot, ctx.packetId);
    fs.writeFileSync(path.join(dir, 'SUMMARY.txt'), report.text, 'utf8');
  } catch {
    /* best-effort */
  }
  return {
    ok: true,
    command: 'summary',
    allTasksComplete: report.allTasksComplete,
    headline: report.headline,
    report,
    text: report.text,
    markdown: report.markdown,
    packetPath: ctx.packetPath,
    packetId: ctx.packetId,
    summaryFile: path.join(repo.runtimeDir(ctx.repoRoot, ctx.packetId), 'SUMMARY.txt'),
    agentInstruction:
      'Paste `text` (or markdown) into the user-visible chat as the final message. ' +
      'If allTasksComplete, do not ask for another continue.',
  };
}

function summarizeBindings(bindings) {
  const out = {};
  for (const role of ['reviewer', 'fixer']) {
    const b = bindings?.[role];
    out[role] = b?.live ? { live: true, product: b.product } : { live: false };
  }
  return out;
}

/**
 * Worker-facing: append a full H1 stage strictly at EOF + update frontmatter atomically.
 * Never mid-file patch. Use this instead of free-form ApplyPatch on the packet.
 */
export function cmdAppendEof(opts) {
  const ctx = loadContext(opts);
  const role = opts.role;
  if (!role) throw new Error('--role required for append-eof');
  if (!ctx.run.claim || ctx.run.claim.status !== 'active' || ctx.run.claim.role !== role) {
    throw new Error('append-eof requires an active claim for this role (call next/wait first)');
  }

  let body = opts.body;
  if (opts.bodyFile) {
    body = fs.readFileSync(opts.bodyFile, 'utf8');
  }
  if (!body || !String(body).trim()) {
    throw new Error('append-eof requires --body-file or body text');
  }

  const rawStage = opts.stage || opts.lastAnchor;
  if (!rawStage) throw new Error('--stage required (review_findings|fix_handoff|fix_completion|re_review|...)');
  const stage = repo.stageAnchor(rawStage);
  if (!stage) throw new Error(`invalid --stage: ${rawStage}`);

  const lifecycle =
    opts.lifecycle
    || opts.lifecycleState
    || defaultLifecycleForStage(stage, body);

  let packetPath = ctx.packetPath;
  const meta = repo.appendStageAtEof(packetPath, {
    sectionMarkdown: body,
    lastAnchor: stage,
    lifecycleState: lifecycle,
    preserveFrontmatter: false,
  });

  // A7: terminal PASS/NO_FINDINGS must archive in the same transition as append
  let finalPath = packetPath;
  if (lifecycle === 'archived') {
    finalPath = repo.archivePacket(packetPath);
  }

  // Keep run projection in sync for subsequent complete in same process
  return {
    ok: true,
    command: 'append-eof',
    packetPath: finalPath,
    lastAnchor: meta.lastAnchor,
    lifecycleState: lifecycle === 'archived' ? 'archived' : meta.lifecycleState,
    lastPhysicalH1: repo.lastPhysicalH1(repo.readPacketMeta(finalPath).text),
    message:
      lifecycle === 'archived'
        ? 'Stage appended and packet archived (terminal verdict).'
        : 'Stage appended at EOF. Next: review-loop complete --role ' + role,
  };
}

function defaultLifecycleForStage(stage, body) {
  if (stage === 're_review') {
    const v = String(body).match(/##\s*Verdict\s*\n+\s*(PASS|NO_FINDINGS|BLOCKED|PASS_WITH_CONCERNS)/i);
    const verdict = v?.[1]?.toUpperCase();
    if (verdict === 'PASS' || verdict === 'NO_FINDINGS') return 'archived';
    if (verdict === 'PASS_WITH_CONCERNS') return 'awaiting_user_decision';
    if (verdict === 'BLOCKED') return 'blocked';
  }
  if (stage === 'review_findings') {
    const v = String(body).match(/##\s*Verdict\s*\n+\s*(PASS|NO_FINDINGS|BLOCKED|PASS_WITH_CONCERNS)/i);
    const verdict = v?.[1]?.toUpperCase();
    if (verdict === 'PASS' || verdict === 'NO_FINDINGS') return 'archived';
  }
  return 'in_progress';
}

export function cmdNext(opts) {
  const initial = loadContext(opts);
  return repo.withRuntimeLock(initial.repoRoot, initial.packetId, () =>
    cmdNextLocked({
      ...opts,
      repoRoot: initial.repoRoot,
      packetPath: initial.packetPath,
      packetId: initial.packetId,
    }),
  );
}

function cmdNextLocked(opts) {
  const ctx = loadContext(opts);
  let run = ctx.run;
  const role = opts.role;
  if (!role) throw new Error('--role required for next/wait');

  // Clear resolved gate for routing
  if (run.gate?.status === 'resolved') {
    run = clearResolvedGate(run);
  }

  const persistedDriver = ctx.runtime.driver;
  const driverKind = opts.driver ?? persistedDriver?.kind ?? 'visible-wait';
  if (persistedDriver?.kind && opts.driver && opts.driver !== persistedDriver.kind) {
    return enterProtocolGate(
      ctx,
      run,
      `driver override mismatch: persisted=${persistedDriver.kind} requested=${opts.driver}`,
      opts.commandName ?? 'next',
    );
  }
  const h1Passed = opts.h1Passed ?? persistedDriver?.h1Passed ?? false;
  const driver = selectDriver({
    runtime: run.runtime ?? 'visible',
    driverKind,
    h1Passed,
    fakeAvailable: opts.fakeAvailable !== false,
  });

  const health = driver.reportHealth?.() ?? { status: 'ok' };
  if (health.status === 'unavailable' || health.status === 'h1_ineligible') {
    if (!run.gate?.status) run = applyDriverStatus(run, health.status);
    else run.driverStatus = health.status;
    persistRun(ctx.repoRoot, ctx.packetId, run, {
      kind: driverKind,
      status: health.status,
      h1Passed,
      dryRun: driverKind === 'fake',
    });
    return withHumanBoard(ctx, {
      ok: false,
      command: 'next',
      runtimeGate: true,
      next: deriveNextAction(run, role),
      driver: health,
      recovery: 'HUMAN: review-loop board then resolve once; workers wait',
    });
  }

  let nextAction = deriveNextAction(run, role);
  const waitResult = driver.waitForAction({ nextAction, role, packetId: ctx.packetId });
  if (!waitResult.ok) {
    const reason = waitResult.reason === 'h1_ineligible' ? 'h1_ineligible' : 'unavailable';
    if (!run.gate?.status) run = applyDriverStatus(run, reason);
    else run.driverStatus = reason;
    persistRun(ctx.repoRoot, ctx.packetId, run, {
      kind: driverKind,
      status: reason,
      h1Passed,
      dryRun: driverKind === 'fake',
    });
    return withHumanBoard(ctx, {
      ok: false,
      command: 'next',
      runtimeGate: true,
      next: deriveNextAction(run, role),
      driver: waitResult,
      recovery: 'HUMAN: review-loop board then resolve once; workers wait',
    });
  }

  nextAction = waitResult.nextAction ?? nextAction;

  // Open claim when this role should act (not for idle/wait_bind)
  let claim = null;
  if (nextAction.kind === 'act' && (nextAction.role === role || nextAction.role === 'both')) {
    const fp = ctx.meta.fingerprint;
    const worktreeManifest = repo.worktreeManifest(ctx.repoRoot);
    run = applyOpenClaim(run, {
      role,
      packetFingerprint: fp,
      worktreeManifest,
      worktreeManifestHash: repo.worktreeManifestHash(ctx.repoRoot, worktreeManifest),
    });
    claim = run.claim;
  }

  persistRun(ctx.repoRoot, ctx.packetId, run, {
    kind: driverKind,
    status: 'ok',
    h1Passed,
    dryRun: driverKind === 'fake',
  });

  return {
    ok: true,
    command: opts.commandName ?? 'next',
    packetPath: ctx.packetPath,
    packetId: ctx.packetId,
    role,
    next: nextAction,
    claim,
    driverWait: waitResult,
  };
}

/**
 * Blocking wait until this role should act, a gate opens, the run stops, or timeout.
 *
 * Design gap fix: after Reviewer complete, `wait` must NOT immediately return idle and
 * end the agent turn. It polls packet/runtime (without holding the runtime lock) until
 * Fixer advances the packet, then opens a claim via cmdNext.
 *
 * - Does not hold withRuntimeLock while sleeping (Fixer can complete concurrently).
 * - Heartbeats on stderr every heartbeatMs (default 30s).
 * - --once or maxWaitMs=0 with once=true: single non-blocking poll (legacy next-like).
 */
export function cmdWait(opts) {
  const role = opts.role;
  if (!role) throw new Error('--role required for wait');

  const once = opts.once === true;
  const pollMs = clampInt(opts.pollMs ?? 200, 20, 60_000);
  const heartbeatMs = clampInt(opts.heartbeatMs ?? 30_000, 1_000, 600_000);
  // Default block up to 30 minutes for dogfood; 0 means no timeout (until stop/gate/act)
  const maxWaitMs =
    opts.maxWaitMs != null
      ? clampInt(opts.maxWaitMs, 0, 24 * 60 * 60 * 1000)
      : once
        ? 0
        : 30 * 60 * 1000;

  if (once) {
    return cmdNext({ ...opts, commandName: 'wait' });
  }

  const start = Date.now();
  let lastHeartbeat = 0;
  let polls = 0;
  let lastKind = null;

  while (true) {
    polls += 1;
    const ctx = loadContext(opts);
    let run = ctx.run;
    if (run.gate?.status === 'resolved') {
      run = clearResolvedGate(run);
    }

    const nextAction = deriveNextAction(run, role);
    lastKind = nextAction.kind;

    // Ready to work: acquire claim under lock via next
    if (
      nextAction.kind === 'act'
      && (nextAction.role === role || nextAction.role === 'both')
    ) {
      const result = cmdNext({ ...opts, commandName: 'wait' });
      return {
        ...result,
        waitedMs: Date.now() - start,
        polls,
        wakeReason: 'role_ready',
      };
    }

    // Terminal / human intervention — return without spinning forever
    if (
      nextAction.kind === 'gate'
      || nextAction.kind === 'stop'
      || nextAction.kind === 'loop_off'
    ) {
      const base = {
        ok: nextAction.kind !== 'gate',
        command: 'wait',
        packetPath: ctx.packetPath,
        packetId: ctx.packetId,
        role,
        next: nextAction,
        waitedMs: Date.now() - start,
        polls,
        wakeReason: nextAction.kind,
        runtimeGate: nextAction.kind === 'gate' && nextAction.gateType === 'runtime',
      };
      if (nextAction.kind === 'gate') {
        return withHumanBoard(ctx, {
          ...base,
          recovery:
            'HUMAN resolves once via board; this worker must not call resolve or re-prompt both windows',
        });
      }
      return base;
    }

    // Timeout
    const elapsed = Date.now() - start;
    if (maxWaitMs > 0 && elapsed >= maxWaitMs) {
      return {
        ok: true,
        command: 'wait',
        packetPath: ctx.packetPath,
        packetId: ctx.packetId,
        role,
        next: nextAction,
        waitedMs: elapsed,
        polls,
        timedOut: true,
        wakeReason: 'timeout',
        message: `wait timed out after ${elapsed}ms still kind=${nextAction.kind}; re-run wait or check peer session`,
      };
    }

    // Heartbeat for visible progress (zero model tokens — process still alive)
    if (elapsed - lastHeartbeat >= heartbeatMs || lastHeartbeat === 0) {
      const line =
        `[review-loop] wait role=${role} packet=${ctx.packetId} ` +
        `elapsed=${formatElapsed(elapsed)} next=${nextAction.kind}` +
        (nextAction.nextRole ? ` peer=${nextAction.nextRole}` : '') +
        (nextAction.message ? ` (${nextAction.message})` : '') +
        '\n';
      try {
        process.stderr.write(line);
      } catch {
        /* ignore */
      }
      lastHeartbeat = elapsed;
    }

    sleepMs(pollMs);
  }
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function sleepMs(ms) {
  if (ms <= 0) return;
  // Cross-platform sleep without busy spin for longer intervals
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* fallback spin */
    }
  }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * Complete after AI advanced the packet. For tests/tools can auto-append stage sections.
 */
export function cmdComplete(opts) {
  const initial = loadContext(opts);
  return repo.withRuntimeLock(initial.repoRoot, initial.packetId, () =>
    cmdCompleteLocked({
      ...opts,
      repoRoot: initial.repoRoot,
      packetPath: initial.packetPath,
      packetId: initial.packetId,
    }),
  );
}

function cmdCompleteLocked(opts) {
  const ctx = loadContext(opts);
  let run = ctx.run;
  const role = opts.role;
  if (!role) throw new Error('--role required');
  if (!run.claim || run.claim.status !== 'active') {
    throw new Error('no active claim; call next/wait first');
  }
  if (run.claim.role !== role) {
    throw new Error(`active claim belongs to ${run.claim.role}`);
  }

  const durableDriver = ctx.runtime.driver;
  if (opts.autoStage) {
    if (durableDriver?.kind !== 'fake' || durableDriver?.dryRun !== true) {
      return enterProtocolGate(ctx, run, '--auto-stage requires an explicitly bound fake dry-run driver');
    }
  }

  let completionPacketPath = ctx.packetPath;
  try {
    if (opts.autoStage) {
      completionPacketPath = applyAutoStage(ctx.packetPath, role, run) ?? ctx.packetPath;
    }

    const after = repo.readPacketMeta(completionPacketPath);
    repo.validateCompletedStage({ packetPath: completionPacketPath, meta: after, role });
    validateSubjectDelta({ repoRoot: ctx.repoRoot, run, role, packetText: after.text });
    const changed = after.fingerprint !== (run.claim.packetFingerprint ?? ctx.meta.fingerprint);

    run = applyComplete(run, {
      generation: opts.generation ?? run.claim.generation,
      role,
      newLastAnchor: after.lastAnchor,
      newLifecycleState: after.lifecycleState,
      packetFingerprintAfter: after.fingerprint,
      packetChanged: opts.packetChanged ?? changed,
      strictTransition: opts.strictTransition !== false,
    });
  } catch (error) {
    return enterProtocolGate(ctx, run, error.message);
  }

  // After archive, packet path may have moved
  run.packetPath = completionPacketPath;
  persistRun(ctx.repoRoot, ctx.packetId, run);

  const afterMeta = repo.readPacketMeta(completionPacketPath);
  const terminal =
    run.lifecycleState === 'archived'
    || run.stopped
    || afterMeta.lifecycleState === 'archived';
  const report = terminal
    ? repo.buildCompletionReport({
        packetPath: completionPacketPath,
        meta: afterMeta,
        packetId: ctx.packetId,
        stopped: run.stopped,
      })
    : null;
  if (report) {
    try {
      fs.writeFileSync(
        path.join(repo.runtimeDir(ctx.repoRoot, ctx.packetId), 'SUMMARY.txt'),
        report.text,
        'utf8',
      );
    } catch {
      /* best-effort */
    }
  }

  return {
    ok: true,
    command: 'complete',
    packetPath: completionPacketPath,
    packetId: ctx.packetId,
    lastAnchor: run.lastAnchor,
    lifecycleState: run.lifecycleState,
    next: deriveNextAction(run),
    allTasksComplete: Boolean(report?.allTasksComplete),
    report,
    text: report?.text ?? null,
    agentInstruction: report?.allTasksComplete
      ? 'Show report.text to the user now: ✅ 任务全部完成 + 简洁总结. Stop asking for continue.'
      : 'Call blocking wait for peer; do not end the turn on idle alone.',
  };
}

function applyAutoStage(packetPath, role, run) {
  // When a claim is active, deriveNextAction returns busy — use claim/packet anchors instead.
  const actionName =
    run.claim?.expectedTransition
      ? actionNameFromClaim(run)
      : null;
  const name =
    actionName
    ?? (() => {
      const a = deriveNextAction({ ...run, claim: null }, role);
      return a.kind === 'act' ? a.action : null;
    })();
  if (!name) return;

  if (name === 'review') {
    // Two H1s in one EOF append (Findings + Fix Handoff) — last H1 is fix_handoff
    repo.appendStageAtEof(packetPath, {
      sectionMarkdown:
        `# Review Findings\n\n## Scope reviewed\nreview-loop auto stage\n\n## Verification\n- autoStage dry-run\n\n## Findings\n- Synthetic dry-run finding\n\n## Verdict\nBLOCKED\n\n# Fix Handoff\n\n## Scope\n- Files affected: \`README.md\`\n\n## Validated Findings To Fix\n| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check |\n|---|---|---|---|---|---|---|---|\n| A1 | P1 | valid | synthetic | autoStage | \`README.md\` | synthetic edit | completion passes |\n\n## Feedback Not To Fix\nNone\n\n## Constraints\n- Fake dry-run only\n\n## Verification Required\n- autoStage\n\n## Required Fix Agent Output\nAppend Fix Completion.\n`,
      lastAnchor: 'fix_handoff',
      lifecycleState: 'in_progress',
    });
    return packetPath;
  }

  if (name === 're_review') {
    repo.appendStageAtEof(packetPath, {
      sectionMarkdown:
        `# Re-review\n\n## Scope preamble\nScoped re-review auto stage\n\n## Prior findings reassessment\n| ID | Status |\n|---|---|\n| A1 | resolved |\n\n## New findings\nNone\n\n## Regression surface\nNone\n\n## Verdict\nPASS\n`,
      lastAnchor: 're_review',
      lifecycleState: 'archived',
    });
    return repo.archivePacket(packetPath);
  }

  if (name === 'fix') {
    const round = run.round ?? 1;
    const title = round > 1 ? `# Fix Completion (round ${round})` : '# Fix Completion';
    repo.appendStageAtEof(packetPath, {
      sectionMarkdown:
        `${title}\n\n## Fix Conclusion\n- Auto stage fix applied\n\n## Fix Scope\n- \`README.md\`\n\n## Original Findings Snapshot\n| ID | Severity | Verdict | Original finding | Evidence | Target files/lines | Required fix | Acceptance check |\n|---|---|---|---|---|---|---|---|\n| A1 | P1 | valid | synthetic | autoStage | \`README.md\` | synthetic edit | completion passes |\n\n## Finding Status\n| Finding ID | Claimed status | Files changed | Verification |\n|---|---|---|---|\n| A1 | resolved | \`README.md\` | autoStage |\n\n## Changes Made\n- synthetic\n\n## Verification\n- autoStage\n\n## Deferred Out-of-Scope\n- None\n\n## Re-review Instructions\n- Reassess A1.\n`,
      lastAnchor: 'fix_completion',
      lifecycleState: 'in_progress',
    });
    return packetPath;
  }
}

function validateSubjectDelta({ repoRoot, run, role, packetText }) {
  const before = run.claim?.worktreeManifest;
  if (before == null) return;
  const after = repo.worktreeManifest(repoRoot);
  const changed = repo.diffWorktreeManifests(before, after);
  if (changed == null) throw new Error('unable to compute worktree manifest');
  if (role === 'reviewer' && changed.length) {
    throw new Error(`Reviewer modified subject files: ${changed.join(', ')}`);
  }
  if (role === 'fixer') {
    const patterns = repo.authorizedFixPatterns(packetText);
    const unauthorized = changed.filter((file) => !repo.pathMatchesAnyPattern(file, patterns));
    if (unauthorized.length) {
      throw new Error(`Fixer modified unauthorized subject files: ${unauthorized.join(', ')}`);
    }
  }
}

function enterProtocolGate(ctx, run, evidence, command = 'complete') {
  let gated = restoreStableProjection(ctx, run);
  if (!gated.gate?.status) {
    gated = applyGate(gated, {
      type: 'protocol',
      evidence,
      triggeringRole: run.claim?.role ?? null,
      allowedResolutions: ['continue', 'stop'],
    });
  }
  persistRun(ctx.repoRoot, ctx.packetId, gated);
  return withHumanBoard(ctx, {
    ok: false,
    command,
    protocolGate: true,
    packetPath: ctx.packetPath,
    packetId: ctx.packetId,
    gate: gated.gate,
    next: deriveNextAction(gated),
    recovery:
      'HUMAN: review-loop board then resolve --decision continue|stop ONCE. ' +
      'WORKERS: do not resolve; after continue use append-eof only (never mid-file edit).',
  });
}

/**
 * Attach single control-plane fields so any command that surfaces a Gate
 * tells agents/humans the same resolve-once action (no dual-window continue).
 */
function withHumanBoard(ctx, result) {
  try {
    const board = cmdBoard({
      repoRoot: ctx.repoRoot,
      packetPath: ctx.packetPath,
    });
    return {
      ...result,
      human: board.human,
      line: board.line,
      phase: board.phase,
      boardFile: board.boardFile,
      worker: board.worker,
    };
  } catch {
    return {
      ...result,
      human: {
        action:
          '【人只需做一次】node review-loop.mjs resolve --decision continue|stop',
        resolveOnce: true,
      },
    };
  }
}

function restoreStableProjection(ctx, run) {
  const from = run.claim?.expectedTransition?.from;
  if (!run.claim || run.claim.status !== 'active' || typeof from !== 'string' || !from) {
    return run;
  }
  const lifecycleState =
    run.claim.fromLifecycleState
    ?? (from === 're_review' ? 'blocked' : 'in_progress');
  repo.rewriteFrontmatter(ctx.packetPath, {
    last_anchor: from,
    lifecycle_state: lifecycleState,
  });
  return applyPacketProjection(run, {
    lastAnchor: from,
    lifecycleState,
  });
}

function actionNameFromClaim(run) {
  const from = run.claim?.expectedTransition?.from;
  const anchor = run.lastAnchor;
  if (!anchor || anchor === 'review_handoff' || anchor === 'review_intake') return 'review';
  if (anchor === 'fix_handoff' || anchor === 'review_findings') return 'fix';
  if (anchor === 'fix_completion') return 're_review';
  if (anchor === 're_review' && run.lifecycleState === 'blocked') return 'fix';
  if (from === 'fix_completion') return 're_review';
  if (from === 'fix_handoff') return 'fix';
  return 'review';
}

export function cmdGate(opts) {
  const ctx = loadContext(opts);
  let run = applyGate(ctx.run, {
    type: opts.type ?? 'protocol',
    evidence: opts.evidence ?? '',
    triggeringRole: opts.role ?? null,
    allowedResolutions: opts.allowedResolutions,
  });
  persistRun(ctx.repoRoot, ctx.packetId, run);
  const board = cmdBoard({ ...opts, repoRoot: ctx.repoRoot, packetPath: ctx.packetPath });
  return {
    ok: true,
    command: 'gate',
    gate: run.gate,
    next: deriveNextAction(run),
    human: board.human,
    boardFile: board.boardFile,
    line: board.line,
  };
}

export function cmdResolve(opts) {
  const ctx = loadContext(opts);
  let run = applyResolve(ctx.run, { decision: opts.decision });
  run = clearResolvedGate(run);
  persistRun(ctx.repoRoot, ctx.packetId, run);
  const board = cmdBoard({ ...opts, repoRoot: ctx.repoRoot, packetPath: ctx.packetPath });
  return {
    ok: true,
    command: 'resolve',
    decision: opts.decision,
    next: deriveNextAction(run),
    human: board.human,
    line: board.line,
    boardFile: board.boardFile,
  };
}

export function cmdDisarm(opts) {
  const ctx = loadContext(opts);
  const run = applyDisarm(ctx.run);
  persistRun(ctx.repoRoot, ctx.packetId, run);
  return { ok: true, command: 'disarm', stopped: true };
}

/** Deep profile skeleton: mark blind complete without full deliberation. */
export function cmdBlindSubmit(opts) {
  const ctx = loadContext(opts);
  if (ctx.run.profile !== 'deep') {
    return {
      ok: false,
      command: 'blind-submit',
      message: 'blind-submit is only for profile=deep (stub/skeleton); standard profile skips blind',
    };
  }
  // v1 skeleton: accept submit and when both "submitted" mark complete via force
  const runtime = ctx.runtime;
  const dir = repo.runtimeDir(ctx.repoRoot, ctx.packetId);
  const phase = opts.phase ?? 'position';
  const role = opts.role;
  const slot = path.join(dir, 'blind', 'stub', `${role}.${phase}.json`);
  repo.writeJson(slot, {
    role,
    phase,
    stub: true,
    body: opts.body ?? { stub: true },
  });

  let run = ctx.run;
  if (opts.forceComplete || opts.phase === 'critique') {
    // simplistic: force complete on second critique or force flag
    run = applyBlindComplete(run);
    repo.rewriteFrontmatter(ctx.packetPath, {
      last_anchor: 'blind_discussion',
      lifecycle_state: 'in_progress',
    });
  }
  persistRun(ctx.repoRoot, ctx.packetId, run);
  return {
    ok: true,
    command: 'blind-submit',
    phase,
    role,
    stub: true,
    next: deriveNextAction(run, role),
  };
}

export { normalizeArms, deriveNextAction, bothRolesBound };
