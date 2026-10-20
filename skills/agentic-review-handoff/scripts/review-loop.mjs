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
import path from "node:path";
import fs from "node:fs";
import {
  resolveRepoRoot,
  resolveBranch,
  validatePacketPath,
  appendStageAtEof,
  runtimeDir,
} from "./review-loop/repositories.mjs";
import { fileURLToPath } from "node:url";
import * as autoRun from "./review-loop/auto-run.mjs";
import * as consult from "./review-loop/consult.mjs";
import * as sessions from "./review-loop/sessions.mjs";
import * as prefs from "./review-loop/prefs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function print(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function printReviewerProgress(event) {
  process.stderr.write(
    `[review-loop] reviewer=${event.product} status=${event.status}` +
      ` elapsed=${formatDuration(event.elapsedMs)}` +
      ` timeout=${formatDuration(event.timeoutMs)}\n`,
  );
}

function fail(err, code = 1) {
  print({ ok: false, error: err?.message ?? String(err) });
  process.exit(code);
}

function launcherArg(args, key) {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`--${key} requires a launcher name such as grok002`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        args[key] = val === "true" ? true : val === "false" ? false : val;
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
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
    mode: "auto-loop",
    usage: [
      "review-loop run --repo=PATH --host=PRODUCT | --reviewer=codex|grok|claude [--reviewer-command=LAUNCHER] [--fallback=PRODUCT[,PRODUCT]] [--completion=review|pass] [--until-pass] [--intake] [--base=SHA] [--rounds=3] [--packet=PATH] [--paths=a,b]",
      "review-loop run --continue --repo=PATH [--packet=PATH] [--reviewer=PRODUCT] [--reviewer-command=LAUNCHER] [--rounds=3|+N] [--paths=a,b]",
      "review-loop fix-completion --repo=PATH --packet=PATH --body-file=PATH",
      "review-loop classic-append --repo=PATH --packet=PATH --body-file=PATH --anchor=ANCHOR --lifecycle=STATE",
      "review-loop close --repo=PATH --packet=PATH --reason=accept-concerns",
      "review-loop evidence --repo=PATH --base=SHA [--paths=a,b]",
      "review-loop consult --repo=PATH --host=PRODUCT [--skip-host] | --peer=codex|grok|claude|pi [--peer-command=LAUNCHER] [--fallback=PRODUCT[,PRODUCT]] [--web] [--raw] --question-file=PATH",
      "review-loop consult --repo=PATH --resume=CONSULT_RECORD [--fallback=PRODUCT[,PRODUCT]] [--web] [--raw] --question-file=PATH",
      "review-loop prefs [--order=claude,codex,grok] [--skip-host=true|false] [--reset]",
      "review-loop sessions --repo=PATH [--product=codex|grok|claude]",
    ],
    removed: [
      "open/bind/next/wait/append-eof/complete/board/resolve/gate/disarm/blind-submit/h1-probe",
      "See docs/review-loop-orchestrator/plan-2026-07-22-review-loop-v2-auto-loop.md T8",
    ],
    defaults: {
      autoLoop:
        "single visible Fixer; headless read-only Reviewer; zero mid-loop human",
      reviewer:
        "with --host, the saved preference (review-loop prefs; default claude,codex,grok) picks it and the timeout fallbacks; with neither --host nor --reviewer, REVIEWER_REQUIRED; --continue inherits the prior reviewer, launcher and fallbacks",
      completion:
        "pass (auto-fix PASS_WITH_CONCERNS without a second confirmation; use review to park concerns)",
      rounds: 3,
      reviewerTimeout:
        "20 minutes (REVIEW_LOOP_TIMEOUT_MS override); on a timeout the next --fallback product takes the same round",
      reviewerProgress: "every 30 seconds while the process is alive",
      sandbox:
        "product-specific read-only controls fixed in adapters (Grok uses a tool allowlist)",
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  // Help is global: handle it before parsing/dispatch can write or spawn.
  if (
    argv.length === 0 ||
    argv[0] === "help" ||
    argv.includes("--help") ||
    argv.includes("-h")
  ) {
    print(help());
    return;
  }

  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  const base = {
    cwd: args.cwd ?? process.cwd(),
    repoRoot: args.repo ?? args["repo-root"],
    packetPath: args.packet ?? args["packet-path"],
    bodyFile: args["body-file"] ?? args.bodyFile,
  };

  // Retired dual-window commands: hard fail with migration hint
  const retired = new Set([
    "open",
    "pair",
    "prompts",
    "bind",
    "next",
    "wait",
    "complete",
    "append-eof",
    "append",
    "board",
    "summary",
    "finish",
    "report",
    "status",
    "gate",
    "resolve",
    "disarm",
    "blind-submit",
    "h1-probe",
  ]);
  if (retired.has(command)) {
    fail(
      new Error(
        `command "${command}" removed in auto-loop v2 (T8). Use: review-loop run | fix-completion | close | consult`,
      ),
    );
  }

  try {
    let result;
    switch (command) {
      case "classic-append": {
        const repo = resolveRepoRoot(base.repoRoot ?? base.cwd);
        const { packetPath, packetId, meta } = validatePacketPath(
          repo,
          resolveBranch(repo),
          base.packetPath,
          { activeOnly: true },
        );
        if (
          meta.frontmatter.mode !== "classic" ||
          fs.existsSync(
            path.join(runtimeDir(repo, packetId), "auto-run-state.json"),
          )
        ) {
          throw new Error(
            "classic-append requires a classic packet without auto runtime state",
          );
        }
        const written = appendStageAtEof(packetPath, {
          sectionMarkdown: fs.readFileSync(base.bodyFile, "utf8"),
          lastAnchor: args.anchor,
          lifecycleState: args.lifecycle,
        });
        result = {
          ok: true,
          packetPath,
          lastAnchor: written.lastAnchor,
          lifecycleState: written.lifecycleState,
        };
        break;
      }
      case "run": {
        if (
          args["no-sandbox"] ||
          args["disable-sandbox"] ||
          args.sandbox === "off"
        ) {
          throw new Error(
            "read-only controls are hardcoded in adapters and cannot be disabled",
          );
        }
        if (args.intake !== undefined && typeof args.intake !== "boolean") {
          throw new Error(
            "--intake is a boolean flag and does not accept a value",
          );
        }
        result = await autoRun.cmdRun({
          ...base,
          reviewer: args.reviewer ?? args["product-reviewer"],
          reviewerCommand: launcherArg(args, "reviewer-command"),
          fallback: args.fallback,
          host: args.host,
          base: args.base,
          // Pass raw string so --rounds +N stays additive (do not Number() early)
          rounds: args.rounds,
          completion:
            args.completion ??
            (args["until-pass"] === true ? "pass" : undefined),
          untilPass: args["until-pass"] === true,
          continue: args.continue === true || args.cont === true,
          cont: args.continue === true || args.cont === true,
          intake: args.intake === true,
          scopeSlug: args.scope ?? args["scope-slug"],
          packetPath: base.packetPath,
          paths: args.paths ?? args.path,
          adapterOpts: {
            onProgress: printReviewerProgress,
          },
        });
        break;
      }
      case "fix-completion":
        result = await autoRun.cmdAppendFixCompletion({
          ...base,
          bodyFile: base.bodyFile,
          body: args.body,
        });
        break;
      case "close":
        result = await autoRun.cmdClose({
          ...base,
          packetPath: base.packetPath,
          reason: args.reason,
        });
        break;
      case "evidence":
        result = autoRun.cmdEvidence({
          ...base,
          base: args.base,
          paths: args.paths ?? args.path,
        });
        break;
      case "consult":
        result = await consult.cmdConsult({
          ...base,
          peer: args.peer ?? args.reviewer,
          peerCommand: launcherArg(args, "peer-command"),
          fallback: args.fallback,
          host: args.host,
          skipHost: args["skip-host"] === true,
          questionFile: args["question-file"] ?? args.questionFile,
          question: args.question,
          resume: args.resume ?? null,
          raw: args.raw === true,
          web: args.web === true,
        });
        break;
      case "prefs": {
        // Show, or with --order / --skip-host / --reset save, the Reviewer preference every run and consult uses.
        const change =
          args.reset === true
            ? { reset: true }
            : {
                ...(args.order !== undefined ? { order: args.order } : {}),
                ...(args["skip-host"] !== undefined
                  ? { skipHost: args["skip-host"] === true }
                  : {}),
              };
        const saved = Object.keys(change).length
          ? prefs.writePrefs(process.env, change)
          : prefs.readPrefs(process.env);
        result = { ok: true, status: "prefs", ...saved };
        break;
      }
      case "sessions":
        result = sessions.cmdSessions({
          ...base,
          product: typeof args.product === "string" ? args.product : undefined,
        });
        break;
      default:
        throw new Error(
          `Unknown command: ${command}. Try: run | fix-completion | close | evidence | consult | sessions | prefs | help`,
        );
    }
    print(result);
    if (result && result.ok === false) process.exitCode = 2;
  } catch (err) {
    fail(err);
  }
}

main();
