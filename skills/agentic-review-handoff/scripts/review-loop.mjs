#!/usr/bin/env node
/**
 * review-loop CLI — absolute-path friendly, never depends on cwd for skill location.
 *
 * Usage:
 *   node /abs/path/to/skills/agentic-review-handoff/scripts/review-loop.mjs <command> [options]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as coord from './review-loop/coordinator.mjs';
import * as autoRun from './review-loop/auto-run.mjs';
import * as consult from './review-loop/consult.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function print(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(err, code = 1) {
  print({ ok: false, error: err?.message ?? String(err) });
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        args[key] = val === 'true' ? true : val === 'false' ? false : val;
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[key] = next;
          i += 1;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function help() {
  return {
    ok: true,
    skillScriptsDir: __dirname,
    usage: [
      '--- AUTO LOOP (v2, preferred) ---',
      'review-loop run --repo=PATH --reviewer=codex|grok|claude [--base=SHA] [--rounds=3] [--packet=PATH]',
      'review-loop run --continue --repo=PATH [--packet=PATH] [--rounds=3]',
      'review-loop fix-completion --repo=PATH --packet=PATH --body-file=PATH',
      'review-loop consult --repo=PATH --peer=codex|grok|claude --question-file=PATH  (T3)',
      '--- LEGACY dual-window (deprecated; dogfood-failed; do not use for new loops) ---',
      'review-loop open --repo=PATH',
      'review-loop board|summary|status|resolve|bind|next|wait|append-eof|complete|gate|disarm …',
    ],
    defaults: {
      autoLoop: 'single visible Fixer session; headless read-only Reviewer; zero mid-loop human',
      reviewer: 'codex|grok|claude',
      rounds: 3,
      packetWrite: 'auto stage writer (claim-free) or legacy append-eof',
      sandbox: 'hardcoded in adapters; cannot be disabled via CLI',
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    print(help());
    return;
  }

  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  const base = {
    cwd: args.cwd ?? process.cwd(),
    repoRoot: args.repo ?? args['repo-root'],
    packetPath: args.packet ?? args['packet-path'],
    role: args.role,
    product: args.product,
    productReviewer: args['product-reviewer'] ?? args.productReviewer,
    productFixer: args['product-fixer'] ?? args.productFixer,
    loop: args.loop,
    profile: args.profile,
    runtime: args.runtime,
    driver: args.driver,
    h1Passed:
      args['h1-passed'] == null
        ? undefined
        : args['h1-passed'] === true || args['h1-passed'] === 'true',
    scopeSlug: args.scope,
    createPacket: args['create-packet'] === true,
    autoStage: args['auto-stage'] === true || args.autoStage === true,
    type: args.type,
    evidence: args.evidence,
    decision: args.decision,
    phase: args.phase,
    forceComplete: args['force-complete'] === true,
    generation: args.generation != null ? Number(args.generation) : undefined,
    once: args.once === true,
    pollMs: args['poll-ms'] != null ? Number(args['poll-ms']) : undefined,
    maxWaitMs:
      args['max-wait-ms'] != null
        ? Number(args['max-wait-ms'])
        : args['max-wait-seconds'] != null
          ? Number(args['max-wait-seconds']) * 1000
          : undefined,
    heartbeatMs: args['heartbeat-ms'] != null ? Number(args['heartbeat-ms']) : undefined,
    stage: args.stage,
    bodyFile: args['body-file'] ?? args.bodyFile,
    lifecycle: args.lifecycle ?? args['lifecycle-state'],
    watch: args.watch === true,
    watchMs: args['watch-ms'] != null ? Number(args['watch-ms']) : 2000,
  };

  try {
    let result;
    switch (command) {
      case 'run': {
        // Refuse flags that would disable sandbox (adapters hardcode isolation).
        if (args['no-sandbox'] || args['disable-sandbox'] || args.sandbox === 'off') {
          throw new Error('sandbox flags are hardcoded in adapters and cannot be disabled');
        }
        result = await autoRun.cmdRun({
          ...base,
          reviewer: args.reviewer ?? base.productReviewer,
          base: args.base,
          rounds: args.rounds != null ? Number(args.rounds) : undefined,
          continue: args.continue === true || args.cont === true,
          cont: args.continue === true || args.cont === true,
          scopeSlug: args.scope ?? args['scope-slug'],
          packetPath: base.packetPath,
          paths: args.paths ?? args.path,
        });
        break;
      }
      case 'fix-completion':
        result = autoRun.cmdAppendFixCompletion({
          ...base,
          bodyFile: base.bodyFile,
          body: args.body,
        });
        break;
      case 'consult':
        result = await consult.cmdConsult({
          ...base,
          peer: args.peer ?? args.reviewer,
          questionFile: args['question-file'] ?? args.questionFile,
          question: args.question,
        });
        break;
      case 'open':
      case 'pair':
      case 'prompts':
        result = coord.cmdOpen({ ...base, loop: 'on' });
        break;
      case 'bind':
        if (!base.role) throw new Error('--role required');
        result = coord.cmdBind({ ...base, loop: base.loop ?? 'on' });
        break;
      case 'next':
        result = coord.cmdNext(base);
        break;
      case 'wait':
        result = coord.cmdWait(base);
        break;
      case 'complete':
        result = coord.cmdComplete(base);
        break;
      case 'status':
        result = coord.cmdStatus(base);
        break;
      case 'board':
        result = coord.cmdBoard(base);
        if (base.watch) {
          // Stream board lines to stderr until Ctrl+C (human control plane)
          const max = Number(args['max-ticks'] ?? 0);
          let ticks = 0;
          while (true) {
            const b = coord.cmdBoard(base);
            process.stderr.write(`[board] ${b.line}\n`);
            if (b.gate) process.stderr.write(`[board] ${b.human.action}\n`);
            if (b.allTasksComplete && b.report?.text) {
              process.stderr.write(`[board]\n${b.report.text}\n`);
            }
            ticks += 1;
            if (max > 0 && ticks >= max) {
              result = b;
              break;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, base.watchMs || 2000);
            result = b;
          }
        }
        break;
      case 'summary':
      case 'finish':
      case 'report':
        result = coord.cmdSummary(base);
        break;
      case 'append-eof':
      case 'append':
        result = coord.cmdAppendEof(base);
        break;
      case 'gate':
        result = coord.cmdGate(base);
        break;
      case 'resolve':
        if (!base.decision) throw new Error('--decision required');
        result = coord.cmdResolve(base);
        break;
      case 'disarm':
        result = coord.cmdDisarm(base);
        break;
      case 'blind-submit':
        result = coord.cmdBlindSubmit(base);
        break;
      case 'h1-probe': {
        const { runH1Probe } = await import('./review-loop/h1-probe.mjs');
        result = await runH1Probe({
          idleSeconds: Number(args['idle-seconds'] ?? args.idle ?? 900),
          outPath: args.out,
          products: args.products,
        });
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
    print(result);
    if (result && result.ok === false) process.exitCode = 2;
  } catch (err) {
    fail(err);
  }
}

main();
