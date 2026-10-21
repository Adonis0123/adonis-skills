#!/usr/bin/env node
/**
 * grill-ledger — deterministic gate for grill-autopilot.
 *
 *   node grill-ledger.mjs check --answers=<proxy-reply.md> --ledger=<ledger.json> --round=<n> [--attempt=2]
 *
 * Parses the Proxy's answer blocks, rejects incomplete ones, classifies each
 * answer as Decided / Assumption / Escalation, merges it into the ledger and
 * reports whether a stop rule fired. Prints one JSON object; exit 0 when every
 * block passed, 1 when some block must be re-asked, 2 on usage errors.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_ROUNDS = 8;
export const MAX_REVERSALS = 2;
export const STALL_ROUNDS = 2;

const FIELDS = {
  decision: /^decision$/i,
  reason: /^reason$/i,
  evidence: /^evidence$/i,
  confidence: /^confidence$/i,
  reversibility: /^reversibility$/i,
  kind: /^kind$/i,
  revisit: /^revisit(?: if)?$/i,
};
const CONFIDENCE = ["high", "medium", "low"];
const REVERSIBILITY = ["easy", "costly"];
const KINDS = ["scope", "term", "solution", "taste", "fact", "side-effect"];
const OPEN = /^open(?:\s*$|\s*[:：—–]|\s+-\s)/i;
const NO_EVIDENCE = /^(none|n\/a|-|无)$/i;
// Recognize source references, not claims such as "looked at the repo".
// URL/path shapes are accepted; bare filenames must exist. The host verifies relevance.
const SOURCE_REFERENCE =
  /https?:\/\/[^\s)]+|(?:^|[\s`(;])\/?(?:[\w@.-]+\/)+[\w.-]*/i;

function hasSourceReference(evidence) {
  if (SOURCE_REFERENCE.test(evidence)) return true;
  // Bare filenames, including extensionless ones, must exist in the repo cwd.
  return evidence.split(";").some((citation) => {
    const target =
      citation.trim().match(/^\[[^\]]*\]\(([^)]+)\)$/)?.[1] ?? citation.trim();
    const file = target
      .replace(/^`|`$/g, "")
      .replace(/[:#]\d+(?:[-:]\d+)?$/, "")
      .replace(/`$/, "");
    try {
      return fs.statSync(path.resolve(file)).isFile();
    } catch {
      return false;
    }
  });
}

/** How to fix each missing or invalid field; sent back to the Proxy on re-ask. */
const FIX = {
  decision:
    "add `- Decision: <choice>` or `- Decision: OPEN` when it cannot be settled",
  reason: "add `- Reason: <why this choice beats the alternatives>`",
  evidence:
    "add `- Evidence: <URL or repo path>[; more]`, or `none` for scope/term/taste questions",
  confidence: "set `- Confidence:` to high, medium or low",
  reversibility:
    "set `- Reversibility:` to easy or costly (costly = migration, rework or cross-team change to undo)",
  kind: `set \`- Kind:\` to one of ${KINDS.join(", ")}`,
  revisit: "add `- Revisit if: <evidence that would change this answer>`",
  solutionEvidence:
    "solution answers need at least one URL or repo path in Evidence",
};

/**
 * Splits a Proxy reply into `### Q<n>` blocks of `- Field: value` lines.
 * @param {string} text
 * @returns {{ id: string, fields: Record<string, string> }[]}
 */
export function parseAnswers(text) {
  const blocks = [];
  let current = null;
  for (const raw of String(text ?? "").split("\n")) {
    const head = raw.match(/^#{2,4}\s*(Q\d+)\b/i);
    if (head) {
      current = { id: head[1].toUpperCase(), fields: {} };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const line = raw.match(/^\s*[-*]\s*\**([A-Za-z ]+?)\**\s*:\s*(.*)$/);
    if (!line) continue;
    const key = Object.keys(FIELDS).find((k) => FIELDS[k].test(line[1].trim()));
    if (key && current.fields[key] == null)
      current.fields[key] = line[2].trim();
  }
  return blocks;
}

/**
 * @param {Record<string, string>} f
 * @returns {string[]} problems, each phrased as a fix
 */
export function validate(f) {
  const problems = [];
  for (const key of Object.keys(FIELDS)) {
    if (!f[key]) problems.push(FIX[key]);
  }
  if (f.confidence && !CONFIDENCE.includes(f.confidence.toLowerCase()))
    problems.push(FIX.confidence);
  if (f.reversibility && !REVERSIBILITY.includes(f.reversibility.toLowerCase()))
    problems.push(FIX.reversibility);
  if (f.kind && !KINDS.includes(f.kind.toLowerCase())) problems.push(FIX.kind);
  if (
    f.kind?.toLowerCase() === "solution" &&
    f.decision &&
    !OPEN.test(f.decision) &&
    (!f.evidence ||
      NO_EVIDENCE.test(f.evidence) ||
      !hasSourceReference(f.evidence))
  ) {
    problems.push(FIX.solutionEvidence);
  }
  return [...new Set(problems)];
}

/**
 * Confidence alone never authorizes a choice: reversibility and kind decide first.
 * @param {Record<string, string>} f a block that passed validate()
 * @returns {{ status: 'Decided'|'Assumption'|'Escalation', why: string, hardToReverse: boolean }}
 */
export function classify(f) {
  const kind = f.kind?.toLowerCase();
  const costly = f.reversibility?.toLowerCase() === "costly";
  const confidence = f.confidence?.toLowerCase();
  if (kind === "side-effect") {
    return {
      status: "Escalation",
      why: "side effect (safety, external send, payment or deletion)",
      hardToReverse: costly,
    };
  }
  if (kind === "fact") {
    return {
      status: "Escalation",
      why: "a fact only the user knows",
      hardToReverse: costly,
    };
  }
  if (OPEN.test(f.decision)) {
    return {
      status: "Escalation",
      why:
        kind === "fact"
          ? "a fact only the user knows"
          : "the Proxy could not settle it",
      hardToReverse: costly,
    };
  }
  if (costly && confidence === "low") {
    return {
      status: "Escalation",
      why: "hard to reverse with weak evidence",
      hardToReverse: true,
    };
  }
  if (kind === "taste") {
    return {
      status: "Assumption",
      why: "taste: repo-consistent default, user may overturn",
      hardToReverse: costly,
    };
  }
  return {
    status: "Decided",
    why: costly ? "hard to reverse, evidence strong enough" : "reversible",
    hardToReverse: costly,
  };
}

function loadLedger(file) {
  if (!fs.existsSync(file)) return { rounds: [], questions: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * @param {{ answers: string, ledger: object, round: number, attempt?: number }} input
 */
export function checkRound({ answers, ledger, round, attempt = 1 }) {
  const blocks = parseAnswers(answers);
  const results = [];
  const reask = [];
  let newDecisions = 0;
  for (const { id, fields } of blocks) {
    const problems = validate(fields);
    let entry;
    if (problems.length && attempt < 2) {
      reask.push({ id, fix: problems });
      results.push({ id, status: "Invalid", fix: problems });
      continue;
    }
    if (problems.length) {
      // Missing format cannot remove an already recognized escalation boundary.
      entry = {
        status:
          classify(fields).status === "Escalation"
            ? "Escalation"
            : "Assumption",
        why: `UNVERIFIED: answer still incomplete after re-ask (${problems.length} problem(s))`,
        hardToReverse: (fields.reversibility ?? "").toLowerCase() === "costly",
      };
    } else {
      entry = classify(fields);
    }
    const prev = ledger.questions[id];
    const changed = prev && prev.decision !== fields.decision;
    const reversals = (prev?.reversals ?? 0) + (changed ? 1 : 0);
    if (reversals >= MAX_REVERSALS && entry.status !== "Escalation") {
      entry = {
        ...entry,
        status: "Escalation",
        why: `answer changed ${reversals} times`,
      };
    }
    if (!prev || changed) newDecisions += 1;
    ledger.questions[id] = {
      ...fields,
      ...entry,
      round,
      reversals,
    };
    results.push({ id, ...entry, reversals });
  }

  // A re-ask is the same round: carry its count until every block has passed.
  const carried =
    ledger.pending?.round === round ? ledger.pending.newDecisions : 0;
  if (reask.length) {
    ledger.pending = { round, newDecisions: carried + newDecisions };
  } else if (blocks.length) {
    delete ledger.pending;
    ledger.rounds.push({
      round,
      newDecisions: carried + newDecisions,
      at: new Date().toISOString(),
    });
  }
  const stop = [];
  if (ledger.rounds.length >= MAX_ROUNDS)
    stop.push(`reached ${MAX_ROUNDS} rounds`);
  const tail = ledger.rounds.slice(-STALL_ROUNDS);
  if (tail.length === STALL_ROUNDS && tail.every((r) => r.newDecisions === 0)) {
    stop.push(`${STALL_ROUNDS} rounds without a new decision`);
  }
  const all = Object.entries(ledger.questions);
  const pick = (s) => all.filter(([, q]) => q.status === s).map(([id]) => id);
  return {
    ok: blocks.length > 0 && reask.length === 0,
    ...(blocks.length === 0
      ? {
          error:
            "no `### Q<n>` answer blocks found: ask the Proxy to answer every question under a `### Q<n>` heading using the answer format",
        }
      : {}),
    round,
    attempt,
    parsed: blocks.length,
    results,
    reask,
    stop,
    totals: {
      Decided: pick("Decided"),
      Assumption: pick("Assumption"),
      Escalation: pick("Escalation"),
      hardToReverseDecided: all
        .filter(([, q]) => q.status === "Decided" && q.hardToReverse)
        .map(([id]) => id),
    },
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const usage =
    "usage: grill-ledger.mjs check --answers=<proxy-reply.md> --ledger=<ledger.json> --round=<n> [--attempt=2]";
  if (args._[0] !== "check" || !args.answers || !args.ledger || !args.round) {
    console.log(JSON.stringify({ ok: false, error: usage }));
    process.exit(2);
  }
  const round = Number(args.round);
  if (!Number.isInteger(round) || round < 1) {
    console.log(
      JSON.stringify({
        ok: false,
        error: `--round must be a positive integer. ${usage}`,
      }),
    );
    process.exit(2);
  }
  const answers = fs.readFileSync(args.answers, "utf8");
  const ledger = loadLedger(args.ledger);
  const result = checkRound({
    answers,
    ledger,
    round,
    attempt: Number(args.attempt ?? 1),
  });
  // An unparseable reply is not a completed round and must not touch saved state.
  if (result.parsed > 0) {
    fs.mkdirSync(path.dirname(path.resolve(args.ledger)), { recursive: true });
    fs.writeFileSync(
      args.ledger,
      `${JSON.stringify(ledger, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
)
  main();
