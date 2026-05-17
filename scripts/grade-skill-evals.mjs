#!/usr/bin/env node
/**
 * grade-skill-evals.mjs — local CI-friendly runner that checks a skill's
 * evals.json against pre-collected output transcripts.
 *
 * Usage:
 *   node scripts/grade-skill-evals.mjs <skill-slug> <outputs-dir>
 *
 * Expected outputs-dir layout (compatible with skill-creator workspace):
 *   <outputs-dir>/eval-<id>/with_skill/run-*\/outputs/output.txt
 *
 * For each collected (eval, run), extracts the emitted "Workflow Gate" block
 * (or any skill-defined Route format), asserts the Route matches the eval's
 * expected_route, and rolls up a pass-rate report. Missing eval directories are
 * reported but allowed so a workspace can grade a focused subset. Exits
 * non-zero on zero collected runs or any route regression.
 *
 * Designed for skills with a structured `Route:` field; gracefully reports
 * "no Route field" for skills that emit free-form output.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const [, , skillSlug, outputsDir] = process.argv;
if (!skillSlug || !outputsDir) {
  console.error("Usage: node scripts/grade-skill-evals.mjs <skill-slug> <outputs-dir>");
  process.exit(2);
}

const evalsPath = path.join(repoRoot, "skills", skillSlug, "evals", "evals.json");
if (!fs.existsSync(evalsPath)) {
  console.error(`evals.json not found: ${evalsPath}`);
  process.exit(2);
}

const evals = JSON.parse(fs.readFileSync(evalsPath, "utf8")).evals ?? [];
if (evals.length === 0) {
  console.error("evals.json contains no evals[]");
  process.exit(2);
}

const skipSentinel = /^\s*SKIPPED\b/i;

function parseRoute(text) {
  // Accept either "SKIPPED" sentinel or a "- Route: X" line within a block.
  if (skipSentinel.test(text.trim().split("\n")[0])) return "SKIPPED";
  const m = text.match(/^\s*-\s+Route:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function normalizeExpected(expected) {
  // expected_route may be a single value ("Light") or an "or" alternation
  // ("skip-or-Direct", "Discuss or Brainstorm", "skip-or-Light").
  if (!expected) return [];
  return expected
    .split(/\s+or\s+|-or-/i)
    .map((s) => s.trim())
    .map((s) => (/^skip$/i.test(s) ? "SKIPPED" : s));
}

function matches(actual, expectedList) {
  if (!actual) return false;
  if (actual.toUpperCase() === "SKIPPED") {
    return expectedList.some((e) => e.toUpperCase() === "SKIPPED");
  }
  return expectedList.some((e) => e.toLowerCase() === actual.toLowerCase());
}

const results = [];
let totalRuns = 0;
let totalPass = 0;

for (const ev of evals) {
  const expectedList = normalizeExpected(ev.expected_route);
  const evalDir = path.join(outputsDir, `eval-${ev.id}`, "with_skill");
  if (!fs.existsSync(evalDir)) {
    results.push({ id: ev.id, name: ev.name, status: "MISSING", runs: 0 });
    continue;
  }
  const runDirs = fs
    .readdirSync(evalDir)
    .filter((d) => /^run-/.test(d))
    .sort();

  const runResults = [];
  for (const runDir of runDirs) {
    const outputFile = path.join(evalDir, runDir, "outputs", "output.txt");
    if (!fs.existsSync(outputFile)) continue;
    const text = fs.readFileSync(outputFile, "utf8");
    const actual = parseRoute(text);
    const ok = matches(actual, expectedList);
    runResults.push({ run: runDir, actual: actual ?? "<unparseable>", ok });
    totalRuns += 1;
    if (ok) totalPass += 1;
  }
  const passed = runResults.filter((r) => r.ok).length;
  results.push({
    id: ev.id,
    name: ev.name,
    expected: ev.expected_route,
    runs: runResults.length,
    passed,
    rate: runResults.length ? passed / runResults.length : 0,
    failures: runResults.filter((r) => !r.ok),
  });
}

const overallRate = totalRuns > 0 ? totalPass / totalRuns : 0;

const evalsWithRuns = results.filter((r) => r.runs > 0).length;
const missingEvals = results.filter((r) => r.status === "MISSING").length;

console.log(`Skill: ${skillSlug}`);
console.log(`Outputs dir: ${outputsDir}`);
console.log(`Evals defined: ${evals.length}, evals with runs: ${evalsWithRuns}, missing: ${missingEvals}`);
console.log(`Runs collected: ${totalRuns}, passed: ${totalPass} (${(overallRate * 100).toFixed(1)}%)`);
console.log("");

for (const r of results) {
  if (r.status === "MISSING") {
    console.log(`  eval-${r.id} [${r.name}] — no runs collected`);
    continue;
  }
  const tag = r.passed === r.runs ? "PASS" : "FAIL";
  console.log(`  eval-${r.id} [${r.name}] ${tag} ${r.passed}/${r.runs} expected=${r.expected}`);
  for (const f of r.failures) {
    console.log(`    × ${f.run}: emitted Route=${f.actual}`);
  }
}

if (totalRuns === 0) {
  console.error("\nNo runs collected; nothing was graded.");
  process.exit(1);
}

// Exit non-zero if any collected eval failed any run (regression gate).
const regressions = results.filter((r) => r.runs > 0 && r.passed < r.runs).length;
if (regressions > 0) {
  console.error(`\n${regressions} eval(s) regressed.`);
  process.exit(1);
}
