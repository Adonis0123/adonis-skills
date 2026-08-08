/**
 * Frozen per-round evidence for Reviewer (tracked + untracked).
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runtimeDir } from "./repositories.mjs";

export function normalizePathFilter(paths) {
  const items = typeof paths === "string" ? paths.split(",") : paths;
  if (!Array.isArray(items) || items.length === 0) return null;
  return [
    ...new Set(items.map((item) => String(item).trim()).filter(Boolean)),
  ].sort();
}

/**
 * Resolve review base SHA.
 * @param {string} repoRoot
 * @param {string|undefined} base
 */
export function resolveBaseSha(repoRoot, base) {
  if (base) {
    return execFileSync("git", ["rev-parse", base], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  }
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

/**
 * List changed paths between base and worktree (tracked) plus untracked files.
 * @param {string} repoRoot
 * @param {string} baseSha
 * @param {string[]|undefined} paths filter
 */
export function listChangedPaths(repoRoot, baseSha, paths) {
  const parseNul = (value) =>
    Buffer.from(value).toString("utf8").split("\0").filter(Boolean);

  const args = ["diff", "--name-only", "-z", baseSha, "--"];
  if (paths?.length) args.push(...paths);
  const tracked = parseNul(execFileSync("git", args, { cwd: repoRoot }));

  const untrackedArgs = ["ls-files", "--others", "--exclude-standard", "-z"];
  if (paths?.length) untrackedArgs.push("--", ...paths);
  const untracked = parseNul(
    execFileSync("git", untrackedArgs, { cwd: repoRoot }),
  );

  return { tracked, untracked, all: [...new Set([...tracked, ...untracked])] };
}

/**
 * Count added/removed lines roughly for the 500-line guardrail.
 * @param {string} diffText
 */
export function countDiffLines(diffText) {
  let n = 0;
  for (const line of String(diffText).split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) n += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) n += 1;
  }
  return n;
}

/**
 * Build the deterministic tracked + untracked diff used by both review rounds
 * and later freshness checks. This function does not write protocol files.
 *
 * @param {{ repoRoot: string, baseSha: string, paths?: string[] }} opts
 */
export function buildEvidenceSnapshot(opts) {
  const { repoRoot, baseSha } = opts;
  const pathFilter = normalizePathFilter(opts.paths);
  const { tracked, untracked, all } = listChangedPaths(
    repoRoot,
    baseSha,
    pathFilter ?? undefined,
  );

  const chunks = [];
  const trackedArgs = ["diff", baseSha, "--"];
  if (pathFilter?.length) trackedArgs.push(...pathFilter);
  else if (tracked.length) trackedArgs.push(...tracked);
  try {
    const trackedDiff = execFileSync("git", trackedArgs, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (trackedDiff.trim()) chunks.push(trackedDiff.replace(/\s*$/, ""));
  } catch (err) {
    throw new Error(
      `git diff failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const file of untracked) {
    const abs = path.join(repoRoot, file);
    let entry;
    try {
      entry = fs.lstatSync(abs);
    } catch (err) {
      if (/** @type {{ code?: string }} */ (err)?.code === "ENOENT") continue;
      throw err;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(abs);
      chunks.push(
        [
          "review-evidence untracked-symlink-v1",
          `path-bytes ${Buffer.byteLength(file, "utf8")}`,
          JSON.stringify(file),
          `target-bytes ${Buffer.byteLength(target, "utf8")}`,
          JSON.stringify(target),
        ].join("\n"),
      );
      continue;
    }
    try {
      execFileSync("git", ["diff", "--no-index", "--", "/dev/null", file], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err) {
      const out = /** @type {{ stdout?: string, status?: number }} */ (err);
      if (out?.stdout) {
        chunks.push(String(out.stdout).replace(/\s*$/, ""));
      } else if (out?.status !== 1) {
        throw new Error(`untracked diff failed for ${file}: ${err}`);
      }
    }
  }

  const diffText = chunks.length ? `${chunks.join("\n\n")}\n` : "";
  return {
    diffText,
    lineCount: countDiffLines(diffText),
    pathFilter,
    coveredPaths: normalizePathFilter(all) ?? [],
  };
}

/**
 * Public freshness identity. Equality is baseSha + pathFilter + digest.
 * coveredPaths is audit metadata and sourceRound identifies the reviewed round.
 *
 * @param {{ repoRoot: string, baseSha: string, paths?: string[], sourceRound?: number|null }} opts
 */
export function computeEvidenceIdentity(opts) {
  const snapshot = buildEvidenceSnapshot(opts);
  return {
    baseSha: opts.baseSha,
    pathFilter: snapshot.pathFilter,
    digest: crypto
      .createHash("sha256")
      .update(snapshot.diffText, "utf8")
      .digest("hex"),
    coveredPaths: snapshot.coveredPaths,
    sourceRound: opts.sourceRound ?? null,
  };
}

/**
 * Build frozen evidence file for a round.
 * Includes tracked `git diff <base>` plus untracked via `git diff --no-index /dev/null <file>`.
 *
 * @param {{
 *   repoRoot: string,
 *   packetId: string,
 *   baseSha: string,
 *   round: number,
 *   paths?: string[],
 * }} opts
 * @returns {{ evidencePath: string, diffText: string, lineCount: number, paths: string[], warning?: string }}
 */
export function freezeRoundEvidence(opts) {
  const { repoRoot, packetId, baseSha, round, paths } = opts;
  const snapshot = buildEvidenceSnapshot({ repoRoot, baseSha, paths });
  const { diffText, lineCount, pathFilter, coveredPaths } = snapshot;
  const evidenceDir = path.join(runtimeDir(repoRoot, packetId), "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `round-${round}.diff`);
  fs.writeFileSync(evidencePath, diffText, "utf8");

  /** @type {{ evidencePath: string, diffText: string, lineCount: number, paths: string[], pathFilter: string[]|null, coveredPaths: string[], warning?: string }} */
  const result = {
    evidencePath,
    diffText,
    lineCount,
    paths: coveredPaths,
    pathFilter,
    coveredPaths,
  };
  if (lineCount > 500) {
    result.warning = `diff has ${lineCount} changed lines (>500). Consider splitting the review scope.`;
  }
  return result;
}
