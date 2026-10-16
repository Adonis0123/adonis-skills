/**
 * Reviewer preference: which products review, in what order, saved once per user so every skill and every repo
 * picks the same Reviewer and the same timeout fallbacks without asking.
 *
 * File: ${XDG_CONFIG_HOME:-~/.config}/agentic-review-handoff/config.json → { "order": [...], "skipHost": bool }
 * Override for one shell: REVIEW_LOOP_REVIEWERS=codex,claude (order only).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PRODUCTS = ["codex", "grok", "claude"];
export const DEFAULT_PREFS = Object.freeze({
  order: ["claude", "codex", "grok"],
  skipHost: false,
});

/** @param {NodeJS.ProcessEnv} env */
export function prefsPath(env = process.env) {
  const base =
    env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : path.join(env.HOME || os.homedir(), ".config");
  return path.join(base, "agentic-review-handoff", "config.json");
}

/** An ordered list of distinct known products; throws on anything else. */
export function parseOrder(raw, label = "order") {
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);
  if (!list.length)
    throw new Error(`${label} must name at least one of ${PRODUCTS.join("|")}`);
  const seen = new Set();
  for (const p of list) {
    if (!PRODUCTS.includes(p))
      throw new Error(`${label} takes ${PRODUCTS.join("|")}, got ${p}`);
    if (seen.has(p)) throw new Error(`${label} lists ${p} twice`);
    seen.add(p);
  }
  return list;
}

/**
 * The saved preference, the environment override applied; the default when nothing is saved. A broken file is an
 * error that names the file, never a silent default.
 * @returns {{ order: string[], skipHost: boolean, source: "default"|"file"|"env", path: string }}
 */
export function readPrefs(env = process.env) {
  const file = prefsPath(env);
  let prefs = {
    order: [...DEFAULT_PREFS.order],
    skipHost: DEFAULT_PREFS.skipHost,
  };
  let source = "default";
  if (fs.existsSync(file)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new Error(
        `${file} is not valid JSON; fix it or reset with \`review-loop prefs --reset\``,
      );
    }
    prefs = {
      order:
        data.order === undefined
          ? prefs.order
          : parseOrder(data.order, `${file} order`),
      skipHost:
        data.skipHost === undefined ? prefs.skipHost : data.skipHost === true,
    };
    source = "file";
  }
  if (env.REVIEW_LOOP_REVIEWERS) {
    prefs = {
      ...prefs,
      order: parseOrder(env.REVIEW_LOOP_REVIEWERS, "REVIEW_LOOP_REVIEWERS"),
    };
    source = "env";
  }
  return { ...prefs, source, path: file };
}

/** Saves a new preference (fields left out keep their saved value); `reset` deletes the file. */
export function writePrefs(env = process.env, { order, skipHost, reset } = {}) {
  const file = prefsPath(env);
  if (reset) {
    fs.rmSync(file, { force: true });
    return readPrefs({ ...env, REVIEW_LOOP_REVIEWERS: "" });
  }
  const cur = readPrefs({ ...env, REVIEW_LOOP_REVIEWERS: "" });
  const next = {
    order: order === undefined ? cur.order : parseOrder(order),
    skipHost: skipHost === undefined ? cur.skipHost : skipHost === true,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return readPrefs(env);
}

/**
 * Reviewer and fallbacks for a run or consult that named no Reviewer: the preference order, without the host's
 * product when `skipHost` (or `forceSkipHost`, for workflows that need products other than the host).
 * @param {{ host?: string|null, env?: NodeJS.ProcessEnv, forceSkipHost?: boolean }} opts
 */
export function resolveFromPrefs({
  host = null,
  env = process.env,
  forceSkipHost = false,
} = {}) {
  const prefs = readPrefs(env);
  const h = host ? String(host).toLowerCase() : null;
  if (h && !PRODUCTS.includes(h))
    throw new Error(`--host takes ${PRODUCTS.join("|")}, got ${host}`);
  const skip = (prefs.skipHost || forceSkipHost) && h;
  const order = prefs.order.filter((p) => !(skip && p === h));
  if (!order.length)
    throw new Error(
      `no Reviewer left: the preference ${prefs.order.join(",")} only names the host ${h}; change it with \`review-loop prefs --order=...\``,
    );
  return { reviewer: order[0], fallback: order.slice(1), prefs };
}
