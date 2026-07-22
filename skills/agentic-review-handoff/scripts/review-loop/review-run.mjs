/**
 * Pure ReviewRun state transitions — no filesystem, no product I/O.
 * Durable truth is projected by repositories; this module only enforces invariants.
 */

export const ROLES = Object.freeze(['reviewer', 'fixer']);
export const PROFILES = Object.freeze(['standard', 'deep']);
export const RUNTIMES = Object.freeze(['visible', 'headless']);

/**
 * @typedef {'off'|'on'} LoopMode
 * @typedef {'standard'|'deep'} ReviewProfile
 * @typedef {'visible'|'headless'} RuntimeMode
 * @typedef {'reviewer'|'fixer'} Role
 * @typedef {'idle'|'bound'|'active'|'suspect'|'released'} ClaimStatus
 */

/**
 * Normalize skill arms. Headless is never inferred from failure — only explicit.
 * @param {{ loop?: string|boolean, profile?: string, runtime?: string }} raw
 */
export function normalizeArms(raw = {}) {
  const loopRaw = raw.loop;
  let loop = 'off';
  if (loopRaw === true || loopRaw === 'on' || loopRaw === 'true' || loopRaw === 1) {
    loop = 'on';
  } else if (loopRaw === false || loopRaw === 'off' || loopRaw === 'false' || loopRaw === 0 || loopRaw == null || loopRaw === '') {
    loop = 'off';
  } else if (typeof loopRaw === 'string') {
    const v = loopRaw.toLowerCase();
    if (v === 'on') loop = 'on';
    else if (v === 'off') loop = 'off';
    else throw new Error(`Invalid loop value: ${loopRaw}`);
  } else {
    throw new Error(`Invalid loop value: ${loopRaw}`);
  }

  if (loop === 'off') {
    return { loop: 'off', profile: null, runtime: null };
  }

  const profile = (raw.profile ?? 'standard').toLowerCase();
  if (!PROFILES.includes(profile)) {
    throw new Error(`Invalid profile: ${raw.profile} (expected standard|deep)`);
  }

  const runtime = (raw.runtime ?? 'visible').toLowerCase();
  if (!RUNTIMES.includes(runtime)) {
    throw new Error(`Invalid runtime: ${raw.runtime} (expected visible|headless)`);
  }

  return { loop: 'on', profile, runtime };
}

/**
 * Empty run skeleton for reconstruction.
 * @returns {import('./review-run.mjs').ReviewRunState}
 */
export function createEmptyRun({
  packetId,
  branch,
  packetPath,
  repoRoot,
  loop = 'off',
  profile = null,
  runtime = null,
} = {}) {
  return {
    packetId: packetId ?? null,
    branch: branch ?? null,
    packetPath: packetPath ?? null,
    repoRoot: repoRoot ?? null,
    loop,
    profile: loop === 'on' ? profile ?? 'standard' : null,
    runtime: loop === 'on' ? runtime ?? 'visible' : null,
    bindings: {
      reviewer: null,
      fixer: null,
    },
    lastAnchor: null,
    lifecycleState: 'in_progress',
    round: 1,
    claim: null,
    claimGeneration: 0,
    gate: null,
    driverStatus: 'unknown',
    stopped: false,
    events: [],
  };
}

/**
 * @param {object} run
 * @param {{ role: Role, product?: string, bindingId?: string, profile?: string, runtime?: string, loop?: string }} binding
 */
export function applyBind(run, binding) {
  assertNotStopped(run);
  if (run.loop !== 'on') {
    throw new Error('bind requires loop=on; use single-session packet protocol when loop is off/absent');
  }

  const role = binding.role;
  if (!ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }

  if (run.bindings[role]?.live) {
    throw new Error(`Duplicate live binding for role=${role}`);
  }

  // Both sides must agree on arms when second binds
  if (binding.profile && run.profile && binding.profile !== run.profile) {
    throw new Error(`Profile mismatch: run has ${run.profile}, bind has ${binding.profile}`);
  }
  if (binding.runtime && run.runtime && binding.runtime !== run.runtime) {
    throw new Error(`Runtime mismatch: run has ${run.runtime}, bind has ${binding.runtime}`);
  }

  const next = cloneRun(run);
  if (binding.profile) next.profile = binding.profile;
  if (binding.runtime) next.runtime = binding.runtime;

  next.bindings[role] = {
    role,
    product: binding.product ?? 'unknown',
    bindingId: binding.bindingId ?? `${role}-${Date.now()}`,
    live: true,
    boundAt: binding.boundAt ?? new Date().toISOString(),
  };
  pushEvent(next, { type: 'bind', role, product: next.bindings[role].product });
  return next;
}

export function bothRolesBound(run) {
  return Boolean(run.bindings.reviewer?.live && run.bindings.fixer?.live);
}

/**
 * Derive next action for a role without claiming.
 * @param {object} run
 * @param {Role} [forRole] if set, only return action when this role should act
 */
export function deriveNextAction(run, forRole) {
  if (run.stopped) {
    return { kind: 'stop', message: 'run stopped' };
  }
  if (run.loop !== 'on') {
    return { kind: 'loop_off', message: 'loop is off; dual-session runtime routing disabled' };
  }
  if (run.gate?.status === 'pending') {
    return {
      kind: 'gate',
      gateType: run.gate.type,
      message: 'Human/Runtime Gate pending; resolve before routing',
      allowedResolutions: run.gate.allowedResolutions ?? [],
    };
  }
  if (run.driverStatus === 'unavailable' || run.driverStatus === 'h1_ineligible') {
    return {
      kind: 'gate',
      gateType: 'runtime',
      message: 'Driver unavailable or H1-ineligible; Runtime Gate',
      allowedResolutions: ['stop', 'choose_other_surface', 'arm_headless_explicit'],
    };
  }
  if (!bothRolesBound(run)) {
    return {
      kind: 'wait_bind',
      missing: ROLES.filter((r) => !run.bindings[r]?.live),
      message: 'Waiting for both roles to bind',
    };
  }
  if (run.claim?.status === 'active') {
    return {
      kind: 'busy',
      claim: summarizeClaim(run.claim),
      message: `Claim active for role=${run.claim.role} generation=${run.claim.generation}`,
    };
  }

  const expectedRole = expectedRoleFromPacket(run);
  if (!expectedRole) {
    return { kind: 'stop', message: 'No further dual-session action (archived or terminal)' };
  }

  // Deep profile: before first review_findings, require blind skeleton marker when deep
  if (run.profile === 'deep' && needsInitialBlind(run)) {
    const action = {
      kind: 'act',
      role: 'both',
      action: 'blind_position',
      expectedTransition: null,
      message: 'Deep profile: submit blind positions (skeleton/stub in v1)',
    };
    if (forRole && forRole !== 'reviewer' && forRole !== 'fixer') {
      return { kind: 'idle', message: 'Not your turn' };
    }
    return action;
  }

  if (forRole && forRole !== expectedRole) {
    return {
      kind: 'idle',
      nextRole: expectedRole,
      message: `Waiting for role=${expectedRole}`,
    };
  }

  return {
    kind: 'act',
    role: expectedRole,
    action: actionNameForAnchor(run.lastAnchor, run.lifecycleState),
    expectedTransition: expectedTransitionFor(run.lastAnchor, run.lifecycleState),
    message: `Role ${expectedRole} should perform ${actionNameForAnchor(run.lastAnchor, run.lifecycleState)}`,
  };
}

/**
 * Open a claim for the role that should act.
 */
export function applyOpenClaim(
  run,
  { role, packetFingerprint, worktreeManifest, worktreeManifestHash, now } = {},
) {
  assertNotStopped(run);
  if (run.loop !== 'on') throw new Error('claim requires loop=on');
  if (run.gate?.status === 'pending') throw new Error('cannot claim while gate pending');
  if (run.claim?.status === 'active') {
    throw new Error(`claim already active generation=${run.claim.generation} role=${run.claim.role}`);
  }
  if (!run.bindings[role]?.live) throw new Error(`role ${role} is not bound`);

  const nextAction = deriveNextAction(run, role);
  if (nextAction.kind !== 'act' || (nextAction.role !== role && nextAction.role !== 'both')) {
    throw new Error(`role ${role} cannot claim: ${nextAction.message}`);
  }

  const next = cloneRun(run);
  next.claimGeneration += 1;
  next.claim = {
    generation: next.claimGeneration,
    role,
    status: 'active',
    packetFingerprint: packetFingerprint ?? null,
    worktreeManifest: worktreeManifest ?? null,
    worktreeManifestHash: worktreeManifestHash ?? null,
    fromLifecycleState: run.lifecycleState,
    expectedTransition: nextAction.expectedTransition,
    openedAt: now ?? new Date().toISOString(),
  };
  pushEvent(next, { type: 'claim_open', role, generation: next.claim.generation });
  return next;
}

/**
 * Complete a claim after packet stage advanced.
 * @param {object} opts
 * @param {number} opts.generation
 * @param {Role} opts.role
 * @param {string|null} opts.newLastAnchor
 * @param {string|null} opts.newLifecycleState
 * @param {string|null} [opts.packetFingerprintAfter]
 * @param {boolean} [opts.packetChanged]
 */
export function applyComplete(run, opts) {
  assertNotStopped(run);
  const claim = run.claim;
  if (!claim || claim.status !== 'active') {
    throw new Error('no active claim to complete');
  }
  if (claim.generation !== opts.generation) {
    throw new Error(`claim generation mismatch: active=${claim.generation} provided=${opts.generation}`);
  }
  if (claim.role !== opts.role) {
    throw new Error(`claim role mismatch: active=${claim.role} provided=${opts.role}`);
  }
  if (opts.packetChanged === false) {
    throw new Error('complete rejected: packet fingerprint did not advance');
  }

  // Optional: verify expected transition if provided on claim
  if (claim.expectedTransition && opts.newLastAnchor) {
    const ok = claim.expectedTransition.to === opts.newLastAnchor
      || claim.expectedTransition.to === '*'
      || (Array.isArray(claim.expectedTransition.to) && claim.expectedTransition.to.includes(opts.newLastAnchor));
    if (!ok && opts.strictTransition !== false) {
      // allow if lifecycle archived terminal
      if (opts.newLifecycleState !== 'archived') {
        throw new Error(
          `complete rejected: expected last_anchor=${JSON.stringify(claim.expectedTransition.to)} got ${opts.newLastAnchor}`,
        );
      }
    }
  }

  const next = cloneRun(run);
  next.lastAnchor = opts.newLastAnchor ?? next.lastAnchor;
  next.lifecycleState = opts.newLifecycleState ?? next.lifecycleState;
  if (opts.newLifecycleState === 'archived' || opts.newLastAnchor === 'archived') {
    next.stopped = true;
    next.lifecycleState = 'archived';
  }
  next.claim = {
    ...claim,
    status: 'released',
    releasedAt: opts.now ?? new Date().toISOString(),
  };
  pushEvent(next, {
    type: 'claim_complete',
    role: opts.role,
    generation: claim.generation,
    lastAnchor: next.lastAnchor,
  });
  return next;
}

export function applyGate(run, { type, evidence, triggeringRole, allowedResolutions } = {}) {
  assertNotStopped(run);
  if (run.gate?.status === 'pending') {
    throw new Error(`gate already pending type=${run.gate.type}`);
  }
  const next = cloneRun(run);
  // Active claim is released without complete (stage incomplete)
  if (next.claim?.status === 'active') {
    next.claim = { ...next.claim, status: 'released', releasedAt: new Date().toISOString(), incomplete: true };
  }
  next.gate = {
    status: 'pending',
    type: type ?? 'protocol',
    evidence: evidence ?? '',
    triggeringRole: triggeringRole ?? null,
    allowedResolutions: allowedResolutions ?? defaultResolutions(type),
    openedAt: new Date().toISOString(),
  };
  pushEvent(next, { type: 'gate_open', gateType: next.gate.type });
  return next;
}

export function applyResolve(run, { decision } = {}) {
  if (!run.gate || run.gate.status !== 'pending') {
    throw new Error('no pending gate to resolve');
  }
  const allowed = run.gate.allowedResolutions ?? [];
  if (allowed.length && decision && !allowed.includes(decision)) {
    throw new Error(`decision ${decision} not in allowed: ${allowed.join(',')}`);
  }
  const next = cloneRun(run);
  next.gate = {
    ...next.gate,
    status: 'resolved',
    decision: decision ?? 'continue',
    resolvedAt: new Date().toISOString(),
  };
  if (decision === 'stop' || decision === 'disarm') {
    next.stopped = true;
  }
  // Runtime recovery: mark driver available again if user chose another surface
  if (decision === 'choose_other_surface' || decision === 'retry_driver') {
    next.driverStatus = 'ok';
  }
  if (decision === 'arm_headless_explicit') {
    // Never auto-infer; only explicit resolve may set headless arm intent
    next.runtime = 'headless';
    next.driverStatus = 'ok';
  }
  pushEvent(next, { type: 'gate_resolve', decision: next.gate.decision });
  // Clear pending so routing resumes
  next.gate = { ...next.gate, status: 'resolved' };
  return next;
}

/** After resolve, clear gate so deriveNextAction can proceed (keep history in events). */
export function clearResolvedGate(run) {
  if (!run.gate || run.gate.status !== 'resolved') return run;
  const next = cloneRun(run);
  next.gate = null;
  return next;
}

export function applyDisarm(run) {
  const next = cloneRun(run);
  next.stopped = true;
  next.loop = 'off';
  if (next.claim?.status === 'active') {
    next.claim = { ...next.claim, status: 'released', releasedAt: new Date().toISOString() };
  }
  for (const role of ROLES) {
    if (next.bindings[role]) next.bindings[role] = { ...next.bindings[role], live: false };
  }
  pushEvent(next, { type: 'disarm' });
  return next;
}

export function applyDriverStatus(run, status) {
  const next = cloneRun(run);
  next.driverStatus = status;
  pushEvent(next, { type: 'driver_status', status });
  if (status === 'unavailable' || status === 'h1_ineligible') {
    return applyGate(next, {
      type: 'runtime',
      evidence: `driver_status=${status}`,
      allowedResolutions: ['stop', 'choose_other_surface', 'arm_headless_explicit', 'retry_driver'],
    });
  }
  return next;
}

export function applyPacketProjection(run, { lastAnchor, lifecycleState } = {}) {
  const next = cloneRun(run);
  if (lastAnchor != null) next.lastAnchor = lastAnchor;
  if (lifecycleState != null) next.lifecycleState = lifecycleState;
  if (lifecycleState === 'archived') next.stopped = true;
  return next;
}

// --- helpers ---

function expectedRoleFromPacket(run) {
  if (run.lifecycleState === 'archived' || run.stopped) return null;
  const anchor = run.lastAnchor;

  // Fresh packet / no findings yet → reviewer
  if (!anchor || anchor === 'review_handoff' || anchor === 'review_intake') {
    return 'reviewer';
  }
  if (anchor === 'review_findings') {
    // Should have fix_handoff in same stage for blocked; if still here with concerns, fixer if fix_handoff missing treat as fixer when lifecycle in_progress with findings needing fix
    // Simpler rule: review_findings alone without fix means PASS path — stop handled by lifecycle
    if (run.lifecycleState === 'in_progress') return 'fixer'; // incomplete group or awaiting fix handoff consumption
    return null;
  }
  if (anchor === 'fix_handoff') return 'fixer';
  if (anchor === 'fix_completion') return 'reviewer';
  if (anchor === 're_review') {
    if (run.lifecycleState === 'blocked') return 'fixer';
    if (run.lifecycleState === 'awaiting_user_decision') return null; // gate
    return null; // pass archived
  }
  if (anchor === 'blind_discussion') return 'reviewer';
  return 'reviewer';
}

function needsInitialBlind(run) {
  if (run.profile !== 'deep') return false;
  if (!run.lastAnchor || run.lastAnchor === 'review_handoff' || run.lastAnchor === 'review_intake') {
    return !run.blindCompleted;
  }
  return false;
}

function actionNameForAnchor(lastAnchor, lifecycleState) {
  if (!lastAnchor || lastAnchor === 'review_handoff' || lastAnchor === 'review_intake') return 'review';
  if (lastAnchor === 'fix_handoff') return 'fix';
  if (lastAnchor === 'fix_completion') return 're_review';
  if (lastAnchor === 're_review' && lifecycleState === 'blocked') return 'fix';
  if (lastAnchor === 'blind_discussion') return 'review';
  if (lastAnchor === 'review_findings') return 'fix';
  return 'review';
}

function expectedTransitionFor(lastAnchor, lifecycleState) {
  if (!lastAnchor || lastAnchor === 'review_handoff' || lastAnchor === 'review_intake') {
    return { from: lastAnchor ?? null, to: ['review_findings', 'fix_handoff'] };
  }
  if (lastAnchor === 'fix_handoff' || lastAnchor === 'review_findings') {
    return { from: lastAnchor, to: 'fix_completion' };
  }
  if (lastAnchor === 'fix_completion') {
    return { from: 'fix_completion', to: 're_review' };
  }
  if (lastAnchor === 're_review' && lifecycleState === 'blocked') {
    return { from: 're_review', to: 'fix_completion' };
  }
  return { from: lastAnchor, to: '*' };
}

function defaultResolutions(type) {
  if (type === 'runtime') return ['stop', 'choose_other_surface', 'arm_headless_explicit', 'retry_driver'];
  if (type === 'concerns') return ['fix_concerns', 'archive_anyway', 'stop'];
  return ['continue', 'stop'];
}

function summarizeClaim(claim) {
  if (!claim) return null;
  return {
    generation: claim.generation,
    role: claim.role,
    status: claim.status,
    expectedTransition: claim.expectedTransition,
  };
}

function assertNotStopped(run) {
  if (run.stopped) throw new Error('run is stopped');
}

function cloneRun(run) {
  return structuredClone(run);
}

function pushEvent(run, event) {
  run.events = [...(run.events ?? []), { ...event, at: new Date().toISOString() }];
}

/** Mark deep blind complete (skeleton). */
export function applyBlindComplete(run) {
  const next = cloneRun(run);
  next.blindCompleted = true;
  next.lastAnchor = 'blind_discussion';
  pushEvent(next, { type: 'blind_complete' });
  return next;
}
