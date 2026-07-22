/**
 * Session Runtime Port + Fake / VisibleWait drivers.
 * Kernel never imports product SDKs; only drivers may touch product surfaces.
 * Headless is never inferred from failure — only explicit runtime=headless arming.
 */
import fs from 'node:fs';

/** Fake driver for tests and dry-run: never blocks, never switches to headless. */
export function createFakeDriver(options = {}) {
  const {
    available = true,
    h1Eligible = true,
    label = 'fake',
  } = options;

  return {
    kind: 'fake',
    label,
    available,
    h1Eligible,
    waitForAction(ctx) {
      if (!available || !h1Eligible) {
        return {
          ok: false,
          reason: !h1Eligible ? 'h1_ineligible' : 'unavailable',
          nextAction: ctx.nextAction,
        };
      }
      return {
        ok: true,
        waitedMs: 0,
        nextAction: ctx.nextAction,
        heartbeat: { healthy: true },
      };
    },
    reportHealth() {
      return {
        healthy: available && h1Eligible,
        status: !available ? 'unavailable' : !h1Eligible ? 'h1_ineligible' : 'ok',
      };
    },
    cancel() {
      return { cancelled: true };
    },
  };
}

/**
 * Visible wait driver — H1-gated. Does not auto-fallback to headless.
 * Default is non-blocking wake (CLI prints next action). Long idle measurement is h1-probe.mjs.
 */
export function createVisibleWaitDriver(options = {}) {
  const {
    h1Passed = false,
    requireH1 = true,
    pollMs = 20,
    maxWaitMs = 0,
    signalFile = null,
  } = options;

  return {
    kind: 'visible-wait',
    h1Passed,
    waitForAction(ctx) {
      if (requireH1 && !h1Passed) {
        return {
          ok: false,
          reason: 'h1_ineligible',
          message:
            'VisibleWaitDriver requires H1 pass for production use; use --driver=fake for dry-run or run h1-probe',
          nextAction: ctx.nextAction,
        };
      }
      if (!maxWaitMs || maxWaitMs <= 0) {
        return {
          ok: true,
          waitedMs: 0,
          nextAction: ctx.nextAction,
          mode: 'nonblock',
        };
      }
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        if (signalFile && fs.existsSync(signalFile)) {
          return {
            ok: true,
            waitedMs: Date.now() - start,
            nextAction: ctx.nextAction,
            mode: 'signal',
          };
        }
        sleepMs(pollMs);
      }
      return {
        ok: true,
        waitedMs: Date.now() - start,
        nextAction: ctx.nextAction,
        mode: 'timeout_return',
      };
    },
    reportHealth() {
      return {
        healthy: !requireH1 || h1Passed,
        status: !requireH1 || h1Passed ? 'ok' : 'h1_ineligible',
      };
    },
  };
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* short spin only */
  }
}

/**
 * Select driver. runtime=headless never selected from failure.
 */
export function selectDriver({
  runtime = 'visible',
  driverKind = 'visible-wait',
  h1Passed = false,
  fakeAvailable = true,
} = {}) {
  if (runtime === 'headless') {
    return {
      kind: 'headless-stub',
      waitForAction() {
        return {
          ok: false,
          reason: 'headless_not_implemented',
          message:
            'Headless driver is explicit-only and not implemented in v1; never auto-arm from VisibleWait failure',
        };
      },
      reportHealth() {
        return { healthy: false, status: 'unavailable' };
      },
    };
  }

  if (driverKind === 'fake' || driverKind === 'test') {
    return createFakeDriver({ available: fakeAvailable, h1Eligible: true });
  }

  if (driverKind === 'visible-dev') {
    return createVisibleWaitDriver({ h1Passed: true, requireH1: false });
  }

  return createVisibleWaitDriver({ h1Passed: Boolean(h1Passed), requireH1: true });
}
