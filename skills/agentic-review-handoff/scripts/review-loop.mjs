#!/usr/bin/env node
/**
 * review-loop CLI (v2 auto loop only).
 *
 * Dual-window bind/next/wait/open/claim/gate path was removed in T8
 * (plan-2026-07-22-review-loop-v2-auto-loop.md D11).
 *
 * Usage:
 *   node /abs/path/to/skills/agentic-review-handoff/scripts/review-loop.mjs <command> [options]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    mode: 'auto-loop',
    usage: [
      'review-loop run --repo=PATH --reviewer=codex|grok|claude [--base=SHA] [--rounds=3] [--packet=PATH] [--paths=a,b]',
      'review-loop run --continue --repo=PATH [--packet=PATH] [--rounds=3] [--paths=a,b]',
      'review-loop fix-completion --repo=PATH --packet=PATH --body-file=PATH',
      'review-loop consult --repo=PATH --peer=codex|grok|claude --question-file=PATH',
    ],
    removed: [
      'open/bind/next/wait/append-eof/complete/board/resolve/gate/disarm/blind-submit/h1-probe',
      'See docs/review-loop-orchestrator/plan-2026-07-22-review-loop-v2-auto-loop.md T8',
    ],
    defaults: {
      autoLoop: 'single visible Fixer; headless read-only Reviewer; zero mid-loop human',
      reviewer: 'codex|grok|claude',
      rounds: 3,
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
    bodyFile: args['body-file'] ?? args.bodyFile,
  };

  // Retired dual-window commands: hard fail with migration hint
  const retired = new Set([
    'open',
    'pair',
    'prompts',
    'bind',
    'next',
    'wait',
    'complete',
    'append-eof',
    'append',
    'board',
    'summary',
    'finish',
    'report',
    'status',
    'gate',
    'resolve',
    'disarm',
    'blind-submit',
    'h1-probe',
  ]);
  if (retired.has(command)) {
    fail(
      new Error(
        `command "${command}" removed in auto-loop v2 (T8). Use: review-loop run | fix-completion | consult`,
      ),
    );
  }

  try {
    let result;
    switch (command) {
      case 'run': {
        if (args['no-sandbox'] || args['disable-sandbox'] || args.sandbox === 'off') {
          throw new Error('sandbox flags are hardcoded in adapters and cannot be disabled');
        }
        result = await autoRun.cmdRun({
          ...base,
          reviewer: args.reviewer ?? args['product-reviewer'],
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
      default:
        throw new Error(`Unknown command: ${command}. Try: run | fix-completion | consult | help`);
    }
    print(result);
    if (result && result.ok === false) process.exitCode = 2;
  } catch (err) {
    fail(err);
  }
}

main();
