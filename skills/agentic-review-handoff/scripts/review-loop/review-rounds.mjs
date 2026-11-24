/**
 * Round budget for code reviews sent through `consult` instead of `review-loop run`.
 *
 * A caller that loops `consult` over a diff bypasses run's 3-round budget and its
 * blocking/non-blocking split, so reviews keep finding P2/P3 edge cases forever.
 * This counts rounds per review target and blocks round 4+ unless the user granted more.
 * Counting is best effort: any failure here lets the consult through with a warning.
 *
 * State: ${XDG_STATE_HOME:-~/.local/state}/agentic-review-handoff/consult-rounds.json
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const REVIEW_ROUND_LIMIT = 3;
export const ROUND_IDLE_RESET_MS = 8 * 60 * 60 * 1000;
export const GRANT_ENV = "REVIEW_EXTRA_ROUNDS_GRANTED_BY_USER";

// ASCII path chars only: questions are Chinese and a path is often followed by `，` with no space.
const ABS_PATH = /(?:~|\/)[A-Za-z0-9._\-/@+~]+/g;
const DIFF_RANGE =
  /(?:^|[\s(（`'"：:])[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*\.\.\.?[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*/m;
const DIFF_WORDS = /git\s+diff|新增提交|new commits?\b/i;
const WORKTREE_PATH = /worktree\s*[:：]?\s*`?((?:~|\/)[A-Za-z0-9._\-/@+~]+)/gi;
// `review` inside a file or skill name (H4-review-r4.md, agentic-review-handoff, code-review) is not a review request.
const REVIEW_WORDS =
  /审查|复审|评审|代码审核|(?<![-/.\w])re-?review(?![-/\w]|\.\w)|(?<![-/.\w])review(?![-/\w]|\.\w)|PASS\s*\/\s*FAIL/i;

const CN_DIGITS = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function trimPath(p) {
  return p.replace(/[.\-/]+$/, "") || p;
}

function expandHome(p, env) {
  return p.startsWith("~")
    ? path.join(env.HOME || os.homedir(), p.slice(1))
    : p;
}

/** Paths named right after the word "worktree", in order. */
function worktreeMentions(text) {
  return [...String(text).matchAll(WORKTREE_PATH)].map((m) => trimPath(m[1]));
}

/** A code-review question: a diff range or worktree path, plus a review word. */
export function detectReviewIntent(text) {
  const t = String(text ?? "");
  if (!REVIEW_WORDS.test(t)) return false;
  const hasDiff = DIFF_RANGE.test(t) || DIFF_WORDS.test(t);
  const hasWorktree =
    worktreeMentions(t).length > 0 || /\/\.?worktrees\//.test(t);
  return hasDiff || hasWorktree;
}

function parseCnNumber(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  const m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m)
    return (m[1] ? CN_DIGITS[m[1]] : 1) * 10 + (m[2] ? CN_DIGITS[m[2]] : 0);
  return CN_DIGITS[s] ?? NaN;
}

/**
 * Highest round the caller declared. `-rN-` is read from the file name only:
 * question bodies cite earlier rounds' files (`H4-r4-fix.md`) and other lanes'.
 */
export function declaredRound(text, questionFile) {
  const found = [];
  for (const m of String(text ?? "").matchAll(
    /第\s*([0-9]+|[一二两三四五六七八九十]+)\s*轮/g,
  ))
    found.push(parseCnNumber(m[1]));
  for (const m of String(text ?? "").matchAll(/\bround\s*#?\s*(\d+)\b/gi))
    found.push(Number(m[1]));
  if (questionFile) {
    for (const m of path.basename(questionFile).matchAll(/-r(\d+)(?=[-_.])/gi))
      found.push(Number(m[1]));
  }
  const valid = found.filter((n) => Number.isInteger(n) && n > 0 && n < 1000);
  return valid.length ? Math.max(...valid) : 0;
}

function gitOut(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function gitToplevel(p) {
  try {
    if (!fs.statSync(p).isDirectory()) return null;
    return fs.realpathSync(gitOut(p, ["rev-parse", "--show-toplevel"]));
  } catch {
    return null;
  }
}

/** First path in the question that is a Git work tree; paths after "worktree" win. */
export function resolveReviewWorktree(text, repoRoot, env = process.env) {
  const t = String(text ?? "");
  const candidates = [
    ...worktreeMentions(t),
    ...[...t.matchAll(ABS_PATH)].map((m) => trimPath(m[0])),
  ];
  for (const raw of candidates) {
    const top = gitToplevel(expandHome(raw, env));
    if (top) return top;
  }
  return fs.realpathSync(repoRoot);
}

/** Separates reviews of one branch by lane: `H4-review-r2-question.md` → `H4`. */
export function questionPrefix(questionFile) {
  if (!questionFile) return null;
  const i = path.basename(questionFile).indexOf("-review");
  return i > 0 ? path.basename(questionFile).slice(0, i) : null;
}

export function reviewTargetKey({ repoRoot, text, questionFile, env }) {
  const worktree = resolveReviewWorktree(text, repoRoot, env);
  let branch = null;
  try {
    branch = gitOut(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    /* not a Git work tree: the path alone identifies the target */
  }
  const parts = [fs.realpathSync(repoRoot), worktree, branch ?? ""];
  const prefix = questionPrefix(questionFile);
  if (prefix) parts.push(prefix);
  return { key: parts.join("|"), worktree, branch, prefix };
}

export function roundsStatePath(env = process.env) {
  const base =
    env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME
      : path.join(env.HOME || os.homedir(), ".local", "state");
  return path.join(base, "agentic-review-handoff", "consult-rounds.json");
}

function readState(file) {
  if (!fs.existsSync(file)) return { targets: {} };
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data || typeof data.targets !== "object" || data.targets === null)
    throw new Error(`malformed round state: ${file}`);
  return data;
}

/** User grant: extra rounds beyond the limit. Anything but a positive integer grants nothing. */
export function parseGrant(env = process.env) {
  const raw = env[GRANT_ENV];
  if (raw === undefined || raw === "") return 0;
  return /^\d+$/.test(String(raw).trim()) && Number(raw) > 0 ? Number(raw) : 0;
}

/**
 * Round number of this review and whether it may run. Throws on state or Git
 * errors; the caller treats a throw as "let it through".
 */
export function assessReviewRound({ repoRoot, text, questionFile, env, now }) {
  const target = reviewTargetKey({ repoRoot, text, questionFile, env });
  const stateFile = roundsStatePath(env);
  const entry = readState(stateFile).targets[target.key];
  const idle =
    !entry || !(now - Date.parse(entry.updated) <= ROUND_IDLE_RESET_MS);
  const counted = idle ? 0 : Number(entry.round) || 0;
  const declared = declaredRound(text, questionFile);
  const round = Math.max(counted + 1, declared);
  const grant = parseGrant(env);
  const limit = REVIEW_ROUND_LIMIT + grant;
  // Reported only when the grant is what lets this round run.
  const granted = round > REVIEW_ROUND_LIMIT ? grant : 0;
  return {
    ...target,
    stateFile,
    round,
    counted,
    declared,
    limit,
    granted,
    allowed: round <= limit,
  };
}

/** Saves the round after the peer answered; a failed delivery does not use up a round. */
export function recordReviewRound(assessment, now) {
  const { stateFile, key, round, worktree, branch, prefix, granted } =
    assessment;
  const state = readState(stateFile);
  state.targets[key] = {
    round,
    worktree,
    branch,
    ...(prefix ? { prefix } : {}),
    updated: new Date(now).toISOString(),
  };
  // Drop targets idle past the reset window so the file does not grow forever.
  for (const [k, v] of Object.entries(state.targets)) {
    if (!(now - Date.parse(v.updated) <= ROUND_IDLE_RESET_MS))
      delete state.targets[k];
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, stateFile);
  if (granted > 0) {
    fs.appendFileSync(
      path.join(path.dirname(stateFile), "consult-rounds.log"),
      `${new Date(now).toISOString()} round=${round} limit=${assessment.limit} ${GRANT_ENV}=${granted} key=${key}\n`,
      "utf8",
    );
  }
}

export function refusalMessage(a) {
  return [
    `[review-loop consult] 已拒绝：这是对 ${a.worktree}${a.branch ? `（分支 ${a.branch}）` : ""}${a.prefix ? ` ${a.prefix}` : ""} 的第 ${a.round} 轮代码审查，上限 ${a.limit} 轮。没有调用审查方。`,
    "下一步：",
    "1. 用户在场：停下，把剩余发现和各轮结论汇报给用户，由用户决定是否加轮。",
    '2. 无人值守：运行 sideby unattended defer "<N> 条审查发现在 <分支> 上 <轮数> 轮后仍未关闭"，继续做不依赖它的部分。',
    "3. 只剩几行、能用确定性检查（lint、test、脚本）验证的小问题：coordinator 自己修，复跑检查，汇报里注明未再送审。",
    "4. 仍有 P0/P1 时不合并、不提交。",
    `用户授权加轮：由用户本人设置 ${GRANT_ENV}=<n>，上限变为 ${REVIEW_ROUND_LIMIT}+n。agent 不能自己设置它。`,
    "多轮审查优先用 review-loop run，它有轮次预算和阻塞分级。",
  ].join("\n");
}

/** Replaces the decision-consult framing for code reviews; the question follows unchanged. */
export function reviewFraming(round, limit) {
  const lines = [
    "你是只读代码审查方（advisory，不改文件，不提交）。",
    `这是对同一审查目标的第 ${round} 轮审查，上限 ${limit} 轮。`,
    "",
    "本框架的输出格式优先于下方问题里的格式要求：问题若要求「结论 PASS/FAIL」，改用下面的三选一。",
    "",
    "结论三选一：BLOCKED / PASS_WITH_CONCERNS / PASS。",
    "- BLOCKED：至少一条阻塞发现。",
    "- PASS_WITH_CONCERNS：没有阻塞发现，有非阻塞发现。",
    "- PASS：没有发现。",
    "",
    "阻塞条件（满足其一才标 [阻塞]）：",
    "- P0/P1：正确性、数据丢失、安全、契约破坏，真实用户会碰到。",
    "- P2，且同时满足三项：已复现、由本次 diff 引入、在真实用户路径上。",
    "其余一律标 [非阻塞]，进待办，不阻塞合并。",
    "以下默认 [非阻塞]，除非你能说明真实用户会碰到：React StrictMode 双挂载、毫秒级人为时序、未验证的宿主或平台行为。",
    "",
    "每条发现开头标三项：[阻塞]/[非阻塞]、本次引入/存量、已复现/推测。然后给 文件:行、触发场景、建议改法，按严重度排序。",
  ];
  if (round >= 2) {
    lines.push(
      "",
      `第 ${round} 轮的范围：`,
      "- 只核对上一轮的阻塞项是否修好，以及修复 diff 是否引入回归。",
      "- 上一轮阻塞项若只修了被点名的那一处，指出同类的其他实例。",
      "- 其余新发现，除 P0/P1 外都标 [非阻塞]。",
    );
  }
  lines.push("", "--- 原问题 ---");
  return lines.join("\n");
}
