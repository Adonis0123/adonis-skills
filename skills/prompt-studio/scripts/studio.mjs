#!/usr/bin/env node
// prompt-studio helper: prompt-library sync and search, GitHub access tier,
// third-party source change checks, image size checks and generation records.
// Zero dependencies; Node 18+ (global fetch).
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildCandidates, serveGallery, writeGallery } from "./gallery.mjs";
import {
  loadRegistry,
  loadAllEntries,
  syncSources,
  syncForQuery,
  runBackgroundSync,
  getSourceStats,
  modelKeyOf,
  modelKeysOf,
  referenceRequirements,
  codeVideoFields,
  evidenceOf,
  licenseStatusOf,
} from "./sources.mjs";
import {
  USE_MAP,
  LARGE_SLUGS,
  sync as syncYoumind,
} from "./adapters/youmind-manifest.mjs";
export { USE_MAP, LARGE_SLUGS };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEED_FILE = path.join(HERE, "..", "assets", "seed-prompts.json");
export const LIBRARY = {
  id: "youmind",
  repo: "YouMind-OpenLab/ai-image-prompts-skill",
  rawBase:
    "https://raw.githubusercontent.com/YouMind-OpenLab/ai-image-prompts-skill/main/references",
  license: "Prompts CC BY 4.0 (curated by YouMind); repository MIT",
};
export const CHECK_INTERVAL_MS = 10 * 60 * 1000;

// ---------- paths ----------

export function cacheDir(env = process.env) {
  if (env.PROMPT_STUDIO_CACHE) return env.PROMPT_STUDIO_CACHE;
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "prompt-studio");
}

export function recordsDir(project, env = process.env) {
  return env.PROMPT_STUDIO_RECORDS || path.join(project, ".prompt-studio");
}

export function findStylePack(project, env = process.env) {
  const candidates = [path.join(project, ".agents", "style-pack.md")];
  if (env.PROMPT_STUDIO_STYLE_PACK)
    candidates.push(env.PROMPT_STUDIO_STYLE_PACK);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    // A short project file may just point at a shared pack: follow one hop.
    const text = fs.readFileSync(file, "utf8");
    const pointer =
      text.length < 2000 && text.match(/`([^`]*style-pack[^`]*\.md)`/);
    if (pointer) {
      const target = [
        path.resolve(project, pointer[1]),
        path.resolve(path.dirname(file), pointer[1]),
      ].find((t) => t !== path.resolve(file) && fs.existsSync(t));
      if (target) return { found: true, path: target, via: path.resolve(file) };
    }
    return { found: true, path: path.resolve(file) };
  }
  return { found: false, searched: candidates };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------- GitHub access tier ----------

function commandOk(cmd, args, run) {
  try {
    run(cmd, args);
    return true;
  } catch {
    return false;
  }
}

// gh (logged in) > GITHUB_TOKEN/GH_TOKEN > anonymous raw downloads only.
export function detectAccess({ env = process.env, run = defaultRun } = {}) {
  if (commandOk("gh", ["auth", "status"], run)) {
    return { tier: "gh", onlineSearch: true };
  }
  if (env.GITHUB_TOKEN || env.GH_TOKEN) {
    return { tier: "token", onlineSearch: true };
  }
  return {
    tier: "anonymous",
    onlineSearch: false,
    hint: "Install GitHub CLI and run `gh auth login` to enable online repository search. Library updates still work without it.",
  };
}

function defaultRun(cmd, args) {
  return execFileSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

// Token stays in memory: never printed, never written.
function authToken({ env = process.env, run = defaultRun } = {}) {
  if (env.GITHUB_TOKEN || env.GH_TOKEN) return env.GITHUB_TOKEN || env.GH_TOKEN;
  try {
    return run("gh", ["auth", "token"]).trim() || null;
  } catch {
    return null;
  }
}

// ---------- transport ----------

// Node's fetch ignores HTTP(S)_PROXY before Node 24, so behind a proxy we use
// curl, which honours it. Returns the subset of Response that callers use.
const execFileAsync = promisify(execFile);
const runCurl = async (cmd, args, opts) =>
  (await execFileAsync(cmd, args, opts)).stdout;

export async function curlFetch(
  url,
  {
    headers = {},
    signal,
    method = "GET",
    onProgress,
    progressIntervalMs = 1000,
  } = {},
  run = runCurl,
) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-studio-"));
  const bodyFile = path.join(tmp, "body");
  if (onProgress)
    fs.watchFile(
      bodyFile,
      { interval: progressIntervalMs, persistent: false },
      (current, previous) => {
        if (current.size > previous.size) onProgress();
      },
    );
  try {
    const args = [
      "-sS",
      "-L",
      "--compressed",
      "--no-buffer",
      "--max-time",
      "600",
      "--speed-limit",
      "1",
      "--speed-time",
      "60",
      "-D",
      "-",
      "-o",
      bodyFile,
    ];
    if (method === "HEAD") args.unshift("--head");
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    args.push(url);
    const raw = await run("curl", args, {
      encoding: "utf8",
      maxBuffer: 1 << 20,
      signal,
    });
    if (signal?.aborted)
      throw Object.assign(new Error("Request aborted"), { code: "ABORT_ERR" });
    // With -L there may be several header blocks; the last one is the answer.
    const blocks = raw
      .trim()
      .split(/\r?\n\r?\n/)
      .filter((b) => /^HTTP\//.test(b));
    const last = blocks[blocks.length - 1] || "";
    const [statusLine, ...lines] = last.split(/\r?\n/);
    const status = Number(statusLine.split(" ")[1]);
    const map = new Map();
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i > 0)
        map.set(
          line.slice(0, i).trim().toLowerCase(),
          line.slice(i + 1).trim(),
        );
    }
    const body = fs.existsSync(bodyFile)
      ? fs.readFileSync(bodyFile)
      : Buffer.alloc(0);
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k) => map.get(k.toLowerCase()) ?? null },
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      json: async () => JSON.parse(body.toString("utf8")),
    });
  } catch (error) {
    // execFile errors include the command line, which may contain auth headers.
    const code =
      typeof error.code === "number" ||
      /^[A-Z][A-Z0-9_]{0,31}$/.test(String(error.code || ""))
        ? error.code
        : "UNKNOWN";
    const failure = new Error(`curl request failed (${code})`);
    failure.code = code;
    throw failure;
  } finally {
    if (onProgress) fs.unwatchFile(bodyFile);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function defaultFetch(env = process.env) {
  const proxied = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"].some(
    (k) => env[k],
  );
  if (proxied) return (url, init) => curlFetch(url, init);
  return async (url, init) => {
    try {
      return await globalThis.fetch(url, init);
    } catch (error) {
      if (init?.signal?.aborted || error.name === "AbortError") throw error;
      return curlFetch(url, init);
    }
  };
}

// ---------- fetch with ETag, throttle and rate-limit backoff ----------

export async function fetchCached(url, file, opts = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", abort, { once: true });
  if (opts.signal?.aborted) abort();
  let idleTimer, totalTimer, resolveTimeout;
  const timeout = new Promise((resolve) => {
    resolveTimeout = resolve;
  });
  const expire = (kind) => {
    resolveTimeout({
      url,
      file,
      status: fs.existsSync(file) ? "stale-timeout" : "unavailable-timeout",
      error: `request exceeded its ${kind} timeout`,
    });
    controller.abort();
  };
  const progress = () => {
    clearTimeout(idleTimer);
    if (!controller.signal.aborted)
      idleTimer = setTimeout(
        () => expire("idle"),
        opts.requestTimeoutMs ?? 60000,
      );
  };
  progress();
  totalTimer = setTimeout(() => expire("total"), opts.totalTimeoutMs ?? 600000);
  try {
    return await Promise.race([
      fetchCachedRequest(url, file, {
        ...opts,
        signal: controller.signal,
        onProgress: progress,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    opts.signal?.removeEventListener("abort", abort);
  }
}

async function fetchCachedRequest(url, file, opts = {}) {
  const {
    cache = cacheDir(),
    now = Date.now(),
    force = false,
    fetchImpl = defaultFetch(),
    token = null,
    signal,
  } = opts;
  const stateFile = path.join(cache, "state.json");
  const state = readJson(stateFile, { sources: {}, rateLimitResetAt: 0 });
  const entry = state.sources[url] || {};
  const saveState = () => {
    const latest = readJson(stateFile, { sources: {}, rateLimitResetAt: 0 });
    writeJson(stateFile, {
      ...latest,
      rateLimitResetAt: Math.max(
        latest.rateLimitResetAt || 0,
        state.rateLimitResetAt || 0,
      ),
      sources: {
        ...latest.sources,
        ...(state.sources[url] ? { [url]: state.sources[url] } : {}),
      },
    });
  };
  const haveFile = fs.existsSync(file);
  const report = (status, extra = {}) => ({
    url,
    file,
    status,
    fetchedAt: entry.fetchedAt || null,
    ...extra,
  });

  if (
    haveFile &&
    !force &&
    entry.checkedAt != null &&
    now - entry.checkedAt < CHECK_INTERVAL_MS
  ) {
    return report("fresh");
  }
  if (state.rateLimitResetAt && now < state.rateLimitResetAt) {
    return haveFile
      ? report("stale-rate-limited", {
          retryAt: new Date(state.rateLimitResetAt).toISOString(),
        })
      : report("unavailable-rate-limited", {
          retryAt: new Date(state.rateLimitResetAt).toISOString(),
        });
  }

  const headers = {};
  if (haveFile && entry.etag && !force) headers["If-None-Match"] = entry.etag;
  const trustedHosts = new Set([
    "api.github.com",
    "raw.githubusercontent.com",
    "codeload.github.com",
    "github.com",
  ]);
  const target = new URL(url);
  if (
    token &&
    target.protocol === "https:" &&
    trustedHosts.has(target.hostname)
  )
    headers.Authorization = `Bearer ${token}`;
  const aborted = () =>
    report(haveFile ? "stale-aborted" : "unavailable-aborted");
  if (signal?.aborted) return aborted();

  let res;
  try {
    res = await fetchImpl(url, {
      headers,
      signal,
      onProgress: opts.onProgress,
    });
    opts.onProgress?.();
  } catch (error) {
    if (signal?.aborted) return aborted();
    return haveFile
      ? report("stale-offline", { error: String(error.message || error) })
      : report("unavailable-offline", {
          error: String(error.message || error),
        });
  }

  if (signal?.aborted) return aborted();
  if (res.status === 304) {
    state.sources[url] = { ...entry, checkedAt: now };
    saveState();
    return report("unchanged");
  }
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    state.rateLimitResetAt =
      Number.isFinite(reset) && reset > 0
        ? reset * 1000
        : now + CHECK_INTERVAL_MS;
    saveState();
    return report(
      haveFile ? "stale-rate-limited" : "unavailable-rate-limited",
      {
        retryAt: new Date(state.rateLimitResetAt).toISOString(),
      },
    );
  }
  if (!res.ok) {
    return report(haveFile ? "stale-error" : "unavailable-error", {
      httpStatus: res.status,
    });
  }

  let body;
  try {
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      try {
        while (!signal?.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) {
            chunks.push(Buffer.from(value));
            opts.onProgress?.();
          }
        }
      } finally {
        if (signal?.aborted) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      body = Buffer.concat(chunks);
    } else body = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    if (signal?.aborted) return aborted();
    throw error;
  }
  if (signal?.aborted) return aborted();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  state.sources[url] = {
    etag: res.headers.get("etag") || null,
    checkedAt: now,
    fetchedAt: new Date(now).toISOString(),
  };
  saveState();
  return {
    url,
    file,
    status: "updated",
    fetchedAt: state.sources[url].fetchedAt,
  };
}

// ---------- library sync ----------

// Compatibility wrapper for callers of the original single-library helper.
export async function syncLibrary(opts = {}) {
  const cache = opts.cache || cacheDir();
  const dir = path.join(cache, LIBRARY.id);
  const result = await syncYoumind(LIBRARY, {
    ...opts,
    cache,
    dir,
    fetchCached: (url, file, extra = {}) =>
      fetchCached(url, file, { ...opts, ...extra, cache }),
  });
  return { library: LIBRARY.id, ...result };
}

// ---------- search ----------

export const STOPWORDS = new Set(
  (
    "a an the for of in on to and or with from by is are be as at this that it its into over under " +
    "make made create image images prompt prompts generate using use me my your you we can will some about please"
  ).split(" "),
);

export function tokenize(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.match(/[a-z0-9]+/g) || [];
  const tokens = words.filter((w) => w.length > 1 && !STOPWORDS.has(w));
  // CJK has no spaces: index character bigrams.
  for (const run of lower.match(/[㐀-鿿]+/g) || []) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i < run.length - 1; i += 1)
      tokens.push(run.slice(i, i + 2));
  }
  return [...new Set(tokens)];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ASCII tokens match on word boundaries ("art" must not hit "start"); CJK has no
// word boundaries, so it keeps substring matching.
function tokenMatcher(t) {
  return /^[a-z0-9]+$/.test(t)
    ? (lower) => new RegExp(`\\b${escapeRegExp(t)}\\b`).test(lower)
    : (lower) => lower.includes(t);
}

function matchedTokens(matchers, text) {
  const lower = String(text || "").toLowerCase();
  return matchers.filter(([, m]) => m(lower)).map(([t]) => t);
}

export function loadRatings(project, env = process.env) {
  const file = path.join(recordsDir(project, env), "runs.jsonl");
  const ratings = new Map();
  if (!fs.existsSync(file)) return ratings;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const run = JSON.parse(line);
      if (run.promptId != null && typeof run.score === "number") {
        const prev = ratings.get(String(run.promptId)) || 0;
        ratings.set(String(run.promptId), Math.max(prev, run.score));
      }
    } catch {
      // skip malformed lines
    }
  }
  return ratings;
}

export function loadEntries({ cache = cacheDir(), categories = [] } = {}) {
  const dir = path.join(cache, LIBRARY.id);
  const manifest = readJson(path.join(dir, "manifest.json"), null);
  const entries = [];
  if (manifest) {
    for (const cat of manifest.categories || []) {
      if (categories.length && !categories.includes(cat.slug)) continue;
      const items = readJson(path.join(dir, cat.file), null);
      if (!Array.isArray(items)) continue;
      for (const item of items)
        entries.push({
          ...item,
          category: cat.slug,
          source: LIBRARY.repo,
          license: LIBRARY.license,
        });
    }
  }
  if (entries.length) return { origin: "cache", entries };
  const seed = readJson(SEED_FILE, { entries: [] }).entries || [];
  const filtered = categories.length
    ? seed.filter((e) => categories.includes(e.category))
    : seed;
  return { origin: "seed", entries: filtered };
}

const MAGAZINE_RE =
  /\b(magazine|vogue|elle|cosmo|harper'?s|gq|editorial\s+cover|magazine\s+cover)\b/i;

// `a b | c d` searches two keyword groups; an entry keeps its best group score.
export function splitQueries(query) {
  return String(query || "")
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean);
}

// Generic words ("ai", "tech") sit in most entries and must not outrank a rare
// subject word: each token is weighted by inverse document frequency.
function idfWeights(docs, tokens) {
  const n = docs.length || 1;
  const weights = new Map();
  for (const t of tokens) {
    const m = tokenMatcher(t);
    const df = docs.reduce((c, d) => c + (m(d) ? 1 : 0), 0);
    weights.set(t, Math.log(1 + n / (1 + df)));
  }
  return weights;
}

// Small prior for prompts that are ready to reuse: detailed but not a wall of
// JSON, several sample images, no placeholders left to fill.
function readiness(e, content, hasPlaceholders) {
  let q = 0;
  if (content.length >= 200 && content.length <= 2500) q += 0.5;
  if ((e.sourceMedia || []).length > 1) q += 0.3;
  if (hasPlaceholders) q -= 0.3;
  if (e.kind === "video" && e.videos?.length) q += 0.4;
  if (e.kind === "code-video" && !content) q -= 0.4;
  return q;
}

function entryModelKeys(entry) {
  if (entry?.kind === "code-video")
    return modelKeysOf(codeVideoFields(entry).renderEngine);
  if (Array.isArray(entry?.modelKeys) && entry.modelKeys.length)
    return entry.modelKeys;
  const keys = modelKeysOf(entry?.model);
  return keys.length ? keys : entry?.modelKey ? [entry.modelKey] : [];
}

function invalidLimit(limit) {
  return !Number.isSafeInteger(limit) || limit <= 0;
}

const limitError = () => ({
  error: "invalid-limit",
  hint: "--limit must be a positive integer.",
});

export function modelMatchOf(entry, target) {
  if (!target || (!entry?.model && !entryModelKeys(entry).length))
    return "unknown";
  if (/^(?:unknown|none|n\/?a|未标注)$/i.test(String(entry?.model || "")))
    return "unknown";
  const wanted = modelKeysOf(target);
  if (!wanted.length || !entryModelKeys(entry).length) return "unknown";
  const matched = entryModelKeys(entry).some((key) => wanted.includes(key));
  return matched ? "matched" : "mismatched";
}

function versionFields(entry, target) {
  const sampleName =
    entry?.kind === "code-video"
      ? codeVideoFields(entry).renderEngine
      : entry?.model;
  const version = (name) =>
    String(name || "")
      .replace(/\bp5(?:\.js)?\b/i, "")
      .match(/(\d+(?:\.\d+)*)(?=$|[^\d.])/i)?.[1] || null;
  const sampleVersion = version(sampleName),
    targetVersion = version(target);
  const normalized = (value) => value?.replace(/(?:\.0)+$/, "");
  const tier = (name) =>
    String(name || "")
      .match(/\b(?:Lite|Pro|Fast|Turbo|Flash|Master)\b/i)?.[0]
      .toLowerCase() || null;
  const versionMatch =
    modelMatchOf(entry, target) !== "matched"
      ? null
      : !sampleVersion || !targetVersion
        ? "unknown"
        : normalized(sampleVersion) === normalized(targetVersion) &&
            tier(sampleName) === tier(target)
          ? "same"
          : "different";
  return { sampleVersion, targetVersion, versionMatch };
}

function versionNoteOf(entry, target) {
  if (modelMatchOf(entry, target) !== "matched") return null;
  const { sampleVersion, targetVersion, versionMatch } = versionFields(
    entry,
    target,
  );
  if (!sampleVersion) return null;
  if (!targetVersion)
    return `sample: ${entry.model}; your channel's version is not stated`;
  return versionMatch === "different"
    ? `sample: ${entry.model}; target: ${target}`
    : null;
}

function modeScore(entry, mode) {
  if (!mode) return 0;
  const desired = { image: "text-to-image", edit: "image-edit" }[mode] || mode;
  let score = entry.mode === desired ? 8 : entry.mode ? -4 : 0;
  if (mode === "image-to-video") {
    const clocks = String(entry.content || "").replace(
      /\b(?:9:16|16:9|4:5|5:4|3:4|4:3|21:9|2:3|3:2|1:1)\b/g,
      "",
    );
    const markers =
      clocks.match(
        /\b\d{1,2}:\d{2}\b|\b\d+\s*[-–]\s*\d+\s*(?:s|sec|seconds?)\b/gi,
      ) || [];
    const knownDuration = Number(entry.durationSec) > 0;
    const scripted = knownDuration
      ? entry.durationSec > 10
      : markers.length >= 3;
    if (scripted) score -= 18;
    else if (
      (entry.durationSec > 0 && entry.durationSec <= 10) ||
      String(entry.content || "").length < 1500
    )
      score += 8;
  }
  return score;
}

// Camera, motion, lighting, quality and style terms still score, but never
// establish relevance or a shared subject on their own.
export const GENERIC_TECHNIQUE_WORDS = Object.freeze([
  "close",
  "up",
  "closeup",
  "slow",
  "motion",
  "push",
  "pull",
  "in",
  "out",
  "pan",
  "tilt",
  "zoom",
  "dolly",
  "tracking",
  "orbit",
  "shot",
  "camera",
  "wide",
  "medium",
  "macro",
  "cinematic",
  "film",
  "light",
  "lighting",
  "soft",
  "warm",
  "cool",
  "dramatic",
  "golden",
  "hour",
  "bokeh",
  "4k",
  "8k",
  "hd",
  "ultra",
  "realistic",
  "photorealistic",
  "style",
  "aesthetic",
  "vibe",
  "minimal",
  "clean",
  "premium",
  "luxury",
  "product",
  "commercial",
  "ad",
  "video",
  "clip",
  "scene",
  "background",
  "detailed",
  "high",
  "quality",
  "beautiful",
  "render",
  "3d",
]);

export function searchEntries(
  entries,
  query,
  {
    limit = 30,
    ratings = new Map(),
    dropTokens = [],
    perSource = Infinity,
    model,
    mode,
    subject,
    refs = 0,
  } = {},
) {
  const drop = new Set(dropTokens.map((t) => String(t).toLowerCase()));
  const groups = splitQueries(query).map((q) =>
    tokenize(q).filter((t) => !drop.has(t)),
  );
  // Normalize the subject family before intersection (kitten and cat are one subject).
  const subjectToken = (token) =>
    /^(?:cat|cats|kitten|kittens|kitty)$/.test(token) ? "cat" : token;
  const relevanceGroups = groups.map((tokens) =>
    tokens.filter((token) => !GENERIC_TECHNIQUE_WORDS.includes(token)),
  );
  const subjectGroups = relevanceGroups.map((tokens) =>
    tokens.map(subjectToken),
  );
  const subjects = subject
    ? tokenize(subject)
        .filter((token) => !GENERIC_TECHNIQUE_WORDS.includes(token))
        .map(subjectToken)
    : subjectGroups.length > 1
      ? subjectGroups[0].filter((t) =>
          subjectGroups.every((g) => g.includes(t)),
        )
      : [];
  const subjectMatches = (entry) => {
    const text =
      `${entry.title || ""} ${entry.description || ""} ${(entry.tags || []).join(" ")} ${entry.content || ""}`.toLowerCase();
    return subjects.some((t) =>
      t === "cat"
        ? !(
            /\b(?:girl|boy|woman|man|person|selfie)\b/i.test(
              entry.title || "",
            ) && !/\b(?:cats?|kittens?|kitty)\b/i.test(entry.title || "")
          ) &&
          /\b(?:cats?|kittens?|kitty)\b/.test(
            text.replace(
              /\bcat[- ]?(?:girls?|boys?|eared|ears?|woman|women|man|men)\b/g,
              "",
            ),
          ) &&
          !(
            /\bcat[- ]?(?:girls?|boys?|eared|woman|women)\b/.test(text) &&
            !/\b(?:kittens?|kitty)\b/.test(text)
          )
        : tokenMatcher(t)(text),
    );
  };
  const allTokens = [...new Set(groups.flat())];
  // Stopword-only queries match nothing. If dropTokens removed every token
  // (e.g. recommend --use cover with query "cover"), fall through and list by rating.
  if (!allTokens.length && String(query || "").trim() && drop.size === 0)
    return [];
  const unique = [];
  const seen = new Set();
  for (const e of entries) {
    // The same prompt can sit in several categories: list it once.
    if (seen.has(String(e.id))) continue;
    seen.add(String(e.id));
    // A recommendation without a sample image cannot be judged: skip it.
    if (e.kind !== "code-video" && !e.sourceMedia?.length && !e.videos?.length)
      continue;
    unique.push(e);
  }
  const docs = unique.map((e) =>
    `${e.title || ""} ${e.description || ""} ${(e.tags || []).join(" ")} ${e.content || ""}`.toLowerCase(),
  );
  const idf = idfWeights(docs, allTokens);
  const matchers = allTokens.map((t) => [t, tokenMatcher(t)]);
  const scored = [];
  const directionScores = new Map();
  const directionCoverage = new Map();
  const contentHashes = new Map();
  for (const e of unique) {
    const inTitle = new Set(matchedTokens(matchers, e.title));
    const inDesc = new Set(
      matchedTokens(
        matchers,
        `${e.description || ""} ${(e.tags || []).join(" ")}`,
      ),
    );
    const inContent = new Set(matchedTokens(matchers, e.content));
    let best = { match: 0, matched: [] };
    const scores = [];
    const coverages = [];
    for (const tokens of groups.length ? groups : [[]]) {
      // Body text alone is weak evidence: count it only with a title/description
      // hit or when at least two distinct tokens appear in it.
      const headHit = tokens.some((t) => inTitle.has(t) || inDesc.has(t));
      const bodyCount = tokens.filter((t) => inContent.has(t)).length;
      const useBody = headHit || bodyCount >= 2;
      let raw = 0;
      const matched = [];
      for (const t of tokens) {
        const field = inTitle.has(t)
          ? 3
          : inDesc.has(t)
            ? 2
            : useBody && inContent.has(t)
              ? 1
              : 0;
        if (!field) continue;
        raw += field * idf.get(t);
        matched.push(t);
      }
      // Covering more of the request beats repeating one word.
      const coverage = tokens.length ? matched.length / tokens.length : 0;
      const match = raw * coverage;
      scores.push(match);
      coverages.push(coverage);
      if (match > best.match) best = { match, matched };
    }
    const relevant =
      subjects.length > 0
        ? subjectMatches(e)
        : relevanceGroups.some((tokens) => {
            const hits = tokens
              .filter(
                (token) =>
                  inTitle.has(token) ||
                  inDesc.has(token) ||
                  inContent.has(token),
              )
              .reduce((sum, token) => sum + idf.get(token), 0);
            const weight = tokens.reduce(
              (sum, token) => sum + idf.get(token),
              0,
            );
            return hits > 0 && hits >= weight / 2;
          });
    let { match } = best;
    // Cover/thumbnail categories still contain fashion-magazine "covers"; demote them.
    if (
      (e.category === "youtube-thumbnail" || e.category === "poster-flyer") &&
      MAGAZINE_RE.test(`${e.title || ""} ${e.description || ""}`)
    ) {
      match -= 8;
    }
    if (allTokens.length && match <= 0 && !subjectMatches(e)) continue;
    const content = String(e.content || "");
    const hasPlaceholders =
      /\{argument\b/i.test(content) || /\{[a-z_]+=/i.test(content);
    const rating = ratings.get(String(e.id)) || 0;
    const ratingBoost = rating >= 4 ? 5 * (rating - 3) : 0;
    const quality = allTokens.length
      ? readiness(e, content, hasPlaceholders)
      : 0;
    directionScores.set(String(e.id), scores);
    directionCoverage.set(String(e.id), coverages);
    const normalizedContent = content
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s\u200b-\u200d\ufeff]+/g, " ")
      .trim();
    if (normalizedContent)
      contentHashes.set(
        String(e.id),
        createHash("sha256").update(normalizedContent).digest("hex"),
      );
    const requirements = referenceRequirements(e);
    scored.push({
      ...requirements,
      mediaState: e.videos?.length
        ? "video"
        : e.sourceMedia?.length
          ? "image"
          : "none",
      sampleRatio: e.sampleRatio ?? e.ratio ?? null,
      sampleDurationSec: e.sampleDurationSec ?? e.durationSec ?? null,
      id: e.id,
      kind: e.kind || "image",
      title: String(e.title || "").slice(0, 200),
      description: String(e.description || "").slice(0, 600),
      images: (e.sourceMedia || []).slice(0, 4),
      videos: (e.videos || []).slice(0, 2),
      ...(e.videoFrom ? { videoFrom: e.videoFrom } : {}),
      model: e.model || null,
      modelKey: entryModelKeys(e)[0] || null,
      modelKeys: entryModelKeys(e),
      targetModelKey: modelKeyOf(model),
      versionNote: versionNoteOf(e, model),
      ...versionFields(e, model),
      ...codeVideoFields(e),
      evidence: evidenceOf(e),
      licenseStatus: licenseStatusOf(e.license, e),
      sourceUrl:
        e.sourceUrl || (e.source ? `https://github.com/${e.source}` : null),
      curatedSource: Boolean(e.curatedSource),
      subjectMatch: subjectMatches(e),
      relevant,
      modePreference: modeScore(e, mode),
      category: e.category || null,
      tags: (e.tags || []).slice(0, 8).map((tag) => String(tag).slice(0, 100)),
      author: e.author || null,
      link: e.link || null,
      lang: e.lang || null,
      mode: e.mode || null,
      durationSec: e.durationSec ?? null,
      ratio: e.ratio || null,
      sourceId: e.sourceId || "youmind",
      hasPlaceholders,
      matched: best.matched,
      contentPreview: content.slice(0, 600),
      source: e.source,
      license: e.license,
      yourBestScore: rating || null,
      score:
        Math.round(
          (match +
            quality +
            ratingBoost -
            3 * Math.max(0, requirements.referenceInputs - refs)) *
            100,
        ) / 100,
    });
  }
  // Encode the existing no-media demotion in scores too, so final score sorting
  // cannot promote an unavailable code example above a visible one.
  const visibleCode = scored.filter(
    (e) => e.kind === "code-video" && e.mediaState !== "none",
  );
  const missingCode = scored.filter(
    (e) => e.kind === "code-video" && e.mediaState === "none",
  );
  if (visibleCode.length && missingCode.length) {
    const penalty = Math.max(
      0,
      Math.max(...missingCode.map((e) => e.score)) -
        Math.min(...visibleCode.map((e) => e.score)) +
        1,
    );
    for (const entry of missingCode)
      entry.score = Math.round((entry.score - penalty) * 100) / 100;
  }
  const byId = new Map(unique.map((entry) => [String(entry.id), entry]));
  scored.forEach((entry) => {
    entry.modelMatch = modelMatchOf(byId.get(String(entry.id)), model);
    entry.modelMismatch = entry.modelMatch === "mismatched";
  });
  const modelRank = { matched: 0, unknown: 1, mismatched: 2 };
  const bestRelevantScore = Math.max(
    ...scored.filter((entry) => entry.relevant).map((entry) => entry.score),
  );
  for (const entry of scored) {
    const original = byId.get(String(entry.id));
    const header = { ...original, content: "" };
    const headerMatch = subjects.length
      ? subjectMatches(header)
      : relevanceGroups
          .flat()
          .some((token) =>
            tokenMatcher(token)(
              `${header.title || ""} ${header.description || ""} ${(header.tags || []).join(" ")}`.toLowerCase(),
            ),
          );
    entry.relevance = entry.relevant
      ? headerMatch || entry.score >= bestRelevantScore * 0.5
        ? "strong"
        : "weak"
      : false;
    entry.relevant = entry.relevance === "strong";
  }
  const hasRelevant = scored.some((entry) => entry.relevant);
  const band = (entry) =>
    entry.relevant
      ? model
        ? modelRank[entry.modelMatch]
        : 0
      : entry.relevance === "weak"
        ? 3
        : 4;
  if (!hasRelevant && relevanceGroups.some((tokens) => tokens.length)) {
    const label = subject || subjects.join(" ") || String(query);
    for (const entry of scored)
      entry.relevanceNote = `no close match for ${label}; showing nearest by ${model ? "model" : "keywords"}`;
  }
  const priority = (a, b) =>
    band(a) - band(b) ||
    (a.relevance === "weak" && b.relevance === "weak"
      ? b.score - a.score || modelRank[a.modelMatch] - modelRank[b.modelMatch]
      : !a.relevance && !b.relevance && model
        ? modelRank[a.modelMatch] - modelRank[b.modelMatch]
        : 0) ||
    (a.relevant && b.relevant && mode === "image-to-video"
      ? b.modePreference - a.modePreference
      : 0) ||
    Number(a.kind === "code-video" && a.mediaState === "none") -
      Number(b.kind === "code-video" && b.mediaState === "none");
  const hintOrder = (a, b) => Number(a.referenceHint) - Number(b.referenceHint);
  scored.sort(
    (a, b) =>
      priority(a, b) ||
      b.score + b.modePreference - a.score - a.modePreference ||
      hintOrder(a, b),
  );
  const counts = new Map();
  const selected = [];
  const ids = new Set(),
    hashes = new Set(),
    media = new Set();
  const add = (entry, direction, reserve = false) => {
    const hash = contentHashes.get(String(entry.id));
    const firstMedia = entry.videos[0] || entry.images[0];
    const source = entry.sourceId;
    if (
      ids.has(String(entry.id)) ||
      (hash && hashes.has(hash)) ||
      (firstMedia && media.has(firstMedia))
    )
      return false;
    if (!reserve && !model && (counts.get(source) || 0) >= perSource)
      return false;
    counts.set(source, (counts.get(source) || 0) + 1);
    ids.add(String(entry.id));
    if (hash) hashes.add(hash);
    if (firstMedia) media.add(firstMedia);
    selected.push({
      ...entry,
      direction: splitQueries(query)[direction] || String(query),
    });
    return true;
  };
  const bands = [...new Set(scored.map(band))].sort((a, b) => a - b);
  const buckets = bands.flatMap((rank) => {
    const members = scored.filter((e) => band(e) === rank);
    if (rank === 3) return [members];
    // Shot preference cannot cross the relevance/model boundary. Subject preference
    // remains inside that band, so a cat direction cannot reserve a human example.
    const modes =
      members.some((e) => e.relevant) && mode === "image-to-video"
        ? [...new Set(members.map((e) => e.modePreference))].sort(
            (a, b) => b - a,
          )
        : [null];
    return modes.flatMap((preference) => {
      const items = members.filter(
        (e) => preference === null || e.modePreference === preference,
      );
      return subjects.length
        ? [
            items.filter((e) => e.subjectMatch),
            items.filter((e) => !e.subjectMatch),
          ]
        : [items];
    });
  });
  for (const bucket of buckets) {
    if (selected.length >= limit) break;
    if (
      bucket[0]?.relevance !== "weak" &&
      groups.length >= 2 &&
      groups.length <= 3
    ) {
      const queues = groups.map((_, i) =>
        bucket
          .filter((e) => directionCoverage.get(String(e.id))[i] >= 0.5)
          .sort(
            (a, b) =>
              priority(a, b) ||
              directionScores.get(String(b.id))[i] +
                b.score +
                b.modePreference -
                Math.max(...directionScores.get(String(b.id))) -
                (directionScores.get(String(a.id))[i] +
                  a.score +
                  a.modePreference -
                  Math.max(...directionScores.get(String(a.id)))) ||
              hintOrder(a, b),
          ),
      );
      // Reassign an overlapping sample when another direction has no alternative.
      // At most three directions participate; no unbounded assignment search.
      const reservations = new Map();
      const duplicate = (a, b) => {
        const hash = contentHashes.get(String(a.id));
        const firstMedia = a.videos[0] || a.images[0];
        return (
          String(a.id) === String(b.id) ||
          (hash && hash === contentHashes.get(String(b.id))) ||
          (firstMedia && firstMedia === (b.videos[0] || b.images[0]))
        );
      };
      const reserve = (direction, visited = new Set()) => {
        const visiting = new Set([...visited, direction]);
        for (const entry of queues[direction]) {
          const conflicts = [...reservations]
            .filter(([i, other]) => i !== direction && duplicate(entry, other))
            .map(([i]) => i);
          if (conflicts.some((i) => visiting.has(i))) continue;
          const previous = new Map(reservations);
          reservations.set(direction, entry);
          if (conflicts.every((i) => reserve(i, visiting))) return true;
          reservations.clear();
          for (const [i, other] of previous) reservations.set(i, other);
        }
        return false;
      };
      for (
        let i = 0;
        i < queues.length && reservations.size < limit - selected.length;
        i++
      )
        reserve(i);
      for (const [i, entry] of [...reservations].sort(([a], [b]) => a - b))
        add(entry, i, true);
      let progress = true;
      while (selected.length < limit && progress) {
        progress = false;
        for (let i = 0; i < queues.length && selected.length < limit; i++) {
          while (queues[i].length) {
            if (add(queues[i].shift(), i)) {
              progress = true;
              break;
            }
          }
        }
      }
    } else {
      for (const entry of bucket) {
        if (selected.length >= limit) break;
        const scores = directionScores.get(String(entry.id));
        add(entry, scores.indexOf(Math.max(...scores)));
        if (selected.length >= limit) break;
      }
    }
    // Fill weak-coverage matches in this group before considering the next group.
    for (const entry of bucket) {
      if (selected.length >= limit) break;
      const scores = directionScores.get(String(entry.id));
      add(entry, scores.indexOf(Math.max(...scores)));
    }
  }
  return groups.length >= 2 && groups.length <= 3
    ? selected.sort(
        (a, b) =>
          priority(a, b) ||
          Number(b.subjectMatch) - Number(a.subjectMatch) ||
          b.score - a.score ||
          hintOrder(a, b),
      )
    : selected;
}

export function showEntry(entries, id) {
  return entries.find((e) => String(e.id) === String(id)) || null;
}

// `show 1 2 3` and `show 1,2,3` both work.
export function parseIds(values) {
  return [
    ...new Set(
      (values || [])
        .flatMap((v) => String(v).split(","))
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function showEntries(entries, ids) {
  const found = [];
  const missing = [];
  for (const id of ids) {
    const entry = showEntry(entries, id);
    if (entry) found.push(entry);
    else missing.push(id);
  }
  return { entries: found, missing };
}

// ---------- recommend: one call from intent to ranked candidates ----------

const USE_KEYWORDS = [
  ["cover", /\bcovers?\b|封面/i],
  ["thumbnail", /\bthumbnails?\b|缩略图/i],
  ["poster", /\bposters?\b|\bflyers?\b|海报|传单/i],
  ["avatar", /\bavatars?\b|头像/i],
  ["infographic", /\binfographics?\b|信息图/i],
  ["comic", /\bcomics?\b|\bstoryboards?\b|漫画|分镜/i],
  ["product", /\bproducts?\b|产品|商品/i],
  ["game", /\bgames?\b|游戏/i],
  ["app", /\bapps?\b|\bweb\s?design\b/i],
  ["illustration", /\billustrations?\b|插画|插图/i],
];

export function inferUse(query) {
  const hit = USE_KEYWORDS.find(([, re]) => re.test(String(query || "")));
  return hit ? hit[0] : null;
}

export async function recommend(
  query,
  {
    use,
    kind = "image",
    model,
    mode,
    subject,
    refs = 0,
    sourceIds = [],
    limit = 8,
    project,
    categories,
    ...syncOpts
  } = {},
) {
  if (
    mode &&
    !["image-to-video", "text-to-video", "image", "edit"].includes(mode)
  )
    return {
      error: "invalid-mode",
      hint: "--mode must be image-to-video, text-to-video, image or edit",
    };
  if (invalidLimit(limit)) return limitError();
  if (!Number.isSafeInteger(refs) || refs < 0)
    return {
      error: "invalid-refs",
      hint: "--refs must be a non-negative integer.",
    };
  if (!["image", "video", "code-video"].includes(kind))
    return {
      error: "unknown-kind",
      hint: "kind must be image, video or code-video",
    };
  const tokens = tokenize(query);
  if (!tokens.length)
    return {
      error: "need-query",
      hint: "Pass descriptive keywords to recommend.",
    };
  const known = loadRegistry(syncOpts).filter((src) =>
    src.kinds?.includes(kind),
  );
  const unknown = sourceIds.filter((id) => !known.some((src) => src.id === id));
  if (unknown.length)
    return {
      error: "unknown-source",
      unknown,
      knownIds: known.map((src) => src.id),
      hint: "Run sources to list available ids.",
    };
  if (tokens.length && !tokens.some((t) => /^[a-z0-9]+$/.test(t))) {
    return {
      error: "translate-to-english",
      hint: "Include English keywords; mixed English and Chinese queries are supported.",
    };
  }
  const chosenUse = use || (kind === "image" ? inferUse(query) : null);
  if (chosenUse && !USE_MAP[chosenUse])
    return {
      error: "unknown-use",
      hint: `use must be one of: ${Object.keys(USE_MAP).join(", ")}`,
    };
  const cats = chosenUse ? USE_MAP[chosenUse] : categories || [];
  const opts = { ...syncOpts, kind, sourceIds, categories: cats };
  const sync = await syncForQuery(opts);
  const { origin, entries, notes: loadNotes = [] } = await loadAllEntries(opts);
  const ratings = project
    ? loadRatings(project, syncOpts.env || process.env)
    : new Map();
  const dropTokens =
    chosenUse === "cover" || chosenUse === "thumbnail"
      ? ["cover", "covers"]
      : [];
  const results = searchEntries(entries, query, {
    limit,
    ratings,
    dropTokens,
    model,
    mode,
    subject,
    refs,
    perSource: sourceIds.length || model ? Infinity : 2,
  });
  const notes = [`origin=${origin}`, ...(sync.notes || []), ...loadNotes];
  if (results[0]?.relevanceNote) notes.push(results[0].relevanceNote);
  else if (
    !results.length &&
    tokenize(query).some((t) => !GENERIC_TECHNIQUE_WORDS.includes(t))
  )
    notes.push(
      `no close match for ${subject || query}; showing nearest by ${model ? "model" : "keywords"}`,
    );
  if (model && !results.some((e) => e.modelMatch === "matched"))
    notes.push(`no ${model} samples in the libraries; showing other models`);
  if (sync.downloading?.length && results.length < 3)
    notes.push(
      "Few results available; rerun after the initial downloads finish",
    );
  const out = {
    kind,
    use: chosenUse,
    categories: cats,
    origin,
    results,
    pending: sync.pending || [],
    downloading: sync.downloading || [],
    refreshing: sync.refreshing || [],
    directions: splitQueries(query).map((query) => ({
      query,
      hits: results.filter((e) => e.direction === query).length,
    })),
    cacheNote: [...new Set(notes)].join("; "),
  };
  if (origin === "seed")
    out.access = detectAccess({
      env: syncOpts.env || process.env,
      run: syncOpts.run,
    });
  return out;
}

// ---------- seed (maintainer) ----------

export function buildSeed(entries, perCategory = 5, sources = loadRegistry()) {
  const allowed = new Set(
    sources.filter((s) => s.seed === "allowed").map((s) => s.id),
  );
  const groups = new Map();
  const seen = new Set();
  for (const e of entries) {
    const sourceId = e.sourceId || "youmind";
    if (!allowed.has(sourceId) || seen.has(String(e.id))) continue;
    if (e.kind !== "code-video" && !e.sourceMedia?.length && !e.videos?.length)
      continue;
    const category = e.category || e.tags?.[0] || "other";
    const categories = groups.get(sourceId) || new Map();
    const bucket = categories.get(category) || [];
    if (bucket.length >= perCategory) continue;
    bucket.push(e);
    seen.add(String(e.id));
    categories.set(category, bucket);
    groups.set(sourceId, categories);
  }
  // Alternate sources, and within each source alternate categories/tags.
  const queues = [...groups.values()].map((categories) => {
    const buckets = [...categories.values()];
    const queue = [];
    for (let i = 0; i < perCategory; i += 1)
      for (const bucket of buckets) if (bucket[i]) queue.push(bucket[i]);
    return queue;
  });
  const selected = [];
  let bytes = 200;
  for (let i = 0; queues.some((queue) => queue[i]); i += 1) {
    for (const queue of queues) {
      const entry = queue[i];
      if (!entry) continue;
      const size = Buffer.byteLength(JSON.stringify(entry, null, 2)) + 100;
      if (bytes + size > 950000) continue;
      selected.push(entry);
      bytes += size;
    }
  }
  return {
    note: "Offline samples from sources permitting redistribution. Credit each entry's source and license.",
    entries: selected,
  };
}

// ---------- third-party source change check ----------

export async function checkSource(url, { confirm = false, ...opts } = {}) {
  const cache = opts.cache || cacheDir();
  const hashKey = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const file = path.join(cache, "sources", `${hashKey}.latest`);
  const fetchResult = await fetchCached(url, file, { ...opts, cache });
  if (!fs.existsSync(file))
    return { url, status: "unavailable", fetch: fetchResult.status };

  const body = fs.readFileSync(file);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const confirmedFile = path.join(cache, "confirmed.json");
  const confirmed = readJson(confirmedFile, {});
  const prev = confirmed[url];
  const confirmedCopy = path.join(cache, "sources", `${hashKey}.confirmed`);

  if (confirm) {
    fs.copyFileSync(file, confirmedCopy);
    confirmed[url] = {
      sha256,
      confirmedAt: new Date(opts.now || Date.now()).toISOString(),
    };
    writeJson(confirmedFile, confirmed);
    return { url, status: "confirmed", sha256, latest: file };
  }
  if (!prev)
    return {
      url,
      status: "new",
      sha256,
      latest: file,
      fetch: fetchResult.status,
    };
  if (prev.sha256 === sha256)
    return {
      url,
      status: "unchanged",
      sha256,
      latest: file,
      fetch: fetchResult.status,
    };
  return {
    url,
    status: "changed",
    sha256,
    previousSha256: prev.sha256,
    confirmedAt: prev.confirmedAt,
    latest: file,
    confirmedCopy: fs.existsSync(confirmedCopy) ? confirmedCopy : null,
    fetch: fetchResult.status,
  };
}

// ---------- online repository search (needs gh or token) ----------

export async function searchGithub(
  query,
  {
    limit = 10,
    env = process.env,
    run = defaultRun,
    fetchImpl = defaultFetch(env),
  } = {},
) {
  const access = detectAccess({ env, run });
  if (!access.onlineSearch)
    return {
      access,
      results: [],
      skipped: "anonymous tier: online search disabled",
    };
  const q = `${query} prompts`;
  if (access.tier === "gh") {
    const out = run("gh", [
      "search",
      "repos",
      q,
      "--sort",
      "stars",
      "--limit",
      String(limit),
      "--json",
      "fullName,stargazersCount,pushedAt,license,description,url",
    ]);
    return { access, results: JSON.parse(out) };
  }
  const res = await fetchImpl(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${authToken({ env, run })}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!res.ok)
    return {
      access,
      results: [],
      error: `HTTP ${res.status}`,
      retryAt: res.headers.get("x-ratelimit-reset"),
    };
  const data = await res.json();
  return {
    access,
    results: (data.items || []).map((r) => ({
      fullName: r.full_name,
      stargazersCount: r.stargazers_count,
      pushedAt: r.pushed_at,
      license: r.license ? { key: r.license.spdx_id } : null,
      description: r.description,
      url: r.html_url,
    })),
  };
}

// ---------- image size check ----------

export function imageSize(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return {
      format: "png",
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        return {
          format: "jpeg",
          width: buf.readUInt16BE(i + 7),
          height: buf.readUInt16BE(i + 5),
        };
      }
      i += 2 + len;
    }
  }
  if (
    buf.length >= 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X")
      return {
        format: "webp",
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return {
        format: "webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8 ")
      return {
        format: "webp",
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
  }
  return null;
}

export function checkImage(file, { size, ratio, tolerance = 0.01 } = {}) {
  const dims = imageSize(fs.readFileSync(file));
  if (!dims)
    return {
      file,
      ok: false,
      problems: ["unrecognized image format (expected PNG, JPEG or WebP)"],
    };
  const problems = [];
  const positive = (n) => Number.isFinite(n) && n > 0;
  if (size && !/^\d+x\d+$/.test(size))
    problems.push(`invalid --size ${size}; use WxH, for example 1280x720`);
  if (ratio && !/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(ratio))
    problems.push(`invalid --ratio ${ratio}; use A:B, for example 16:9`);
  if (size && /^\d+x\d+$/.test(size)) {
    const [w, h] = size.split("x").map(Number);
    if (dims.width !== w || dims.height !== h) {
      problems.push(
        `size is ${dims.width}x${dims.height}, expected ${w}x${h}; resize or regenerate at this size`,
      );
    }
  }
  const [ra, rb] = ratio ? ratio.split(":").map(Number) : [];
  if (
    ratio &&
    /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(ratio) &&
    !(positive(ra) && positive(rb))
  )
    problems.push(`invalid --ratio ${ratio}; both sides must be above 0`);
  else if (ratio && positive(ra) && positive(rb)) {
    const want = ra / rb;
    const got = dims.width / dims.height;
    if (Math.abs(got - want) / want > tolerance) {
      problems.push(
        `aspect ratio is ${got.toFixed(3)}, expected ${ratio} (${want.toFixed(3)}); crop or regenerate`,
      );
    }
  }
  return { file, ...dims, ok: problems.length === 0, problems };
}

// ---------- generation records ----------

export function logRun(
  project,
  run,
  { env = process.env, now = Date.now() } = {},
) {
  const dir = recordsDir(project, env);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    runId: run.runId || `run-${now}`,
    at: new Date(now).toISOString(),
    ...run,
  };
  fs.appendFileSync(
    path.join(dir, "runs.jsonl"),
    `${JSON.stringify(record)}\n`,
  );
  return record;
}

export function rateRun(
  project,
  runId,
  score,
  { env = process.env, now = Date.now() } = {},
) {
  if (!Number.isInteger(score) || score < 1 || score > 5)
    throw new Error("score must be an integer from 1 to 5");
  const file = path.join(recordsDir(project, env), "runs.jsonl");
  const lines = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    : [];
  const original = lines
    .map((l) => JSON.parse(l))
    .find((r) => r.runId === runId);
  if (!original)
    throw new Error(
      `run ${runId} not found in ${file}; log it first with \`log\``,
    );
  // Append-only: a rating is a new line that carries the prompt id forward.
  return logRun(
    project,
    {
      runId: `${runId}-rating`,
      ratingOf: runId,
      promptId: original.promptId,
      score,
    },
    { env, now },
  );
}

// ---------- session probe ----------

// One call that answers "what can I use here?". Reports only whether an
// API-key variable is set, never its value.
export function detectSession({
  project,
  env = process.env,
  run = defaultRun,
} = {}) {
  const proj = path.resolve(project || process.cwd());
  const access = detectAccess({ env, run });
  const stylePack = findStylePack(proj, env);
  let stylePackText;
  const apiKeyVars = [];
  if (stylePack.found) {
    try {
      const text = fs.readFileSync(stylePack.path, "utf8");
      stylePackText = text.slice(0, 4000);
      for (const name of new Set(
        text.match(/[A-Z][A-Z0-9_]*(?:_API_KEY|_TOKEN)/g) || [],
      )) {
        apiKeyVars.push({ name, set: Boolean(env[name]) });
      }
    } catch {
      // unreadable style pack: report it as found, without text
    }
  }
  const major = Number(process.versions.node.split(".")[0]);
  const capabilities = coverCapabilities(run);
  const session = {
    ...capabilities,
    access,
    stylePack,
    channels: {
      codex: commandOk("codex", ["--version"], run),
      grok: commandOk("grok", ["--version"], run),
      ffmpeg: capabilities.ffmpeg.available,
      nodeOk: major >= 18,
      apiKeyVars,
    },
  };
  if (stylePackText !== undefined) session.stylePackText = stylePackText;
  return session;
}

// ---------- cover check: contact-sheet previews ----------

export function findCjkFont(run = defaultRun, exists = fs.existsSync) {
  try {
    // fc-match may silently return a Latin fallback; verify the actual language set.
    const out = String(
      run("fc-match", ["-f", "%{file}\n%{lang}", ":lang=zh"]) || "",
    ).trim();
    const [file, languages = ""] = out.split("\n");
    if (file && /(?:^|[|,\s])zh(?:-|$|[|,\s])/.test(languages) && exists(file))
      return file;
  } catch {
    /* fontconfig is optional on macOS */
  }
  return (
    [
      "/System/Library/Fonts/PingFang.ttc",
      "/System/Library/Fonts/Hiragino Sans GB.ttc",
      "/System/Library/Fonts/STHeiti Medium.ttc",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ].find(exists) || null
  );
}
export function coverCapabilities(run = defaultRun, exists = fs.existsSync) {
  const available = commandOk("ffmpeg", ["-version"], run);
  let drawtext = false;
  if (available) {
    try {
      drawtext = /\bdrawtext\s/.test(String(run("ffmpeg", ["-filters"]) || ""));
    } catch {
      /* unavailable filter listing */
    }
  }
  return { ffmpeg: { available, drawtext }, cjkFont: findCjkFont(run, exists) };
}

// Escape a value for use inside an ffmpeg filter option.
const filterEscape = (s) => String(s).replace(/[\\:',;[\]]/g, "\\$&");

export function coverCheck(
  files,
  {
    title,
    size,
    outDir,
    run = defaultRun,
    capabilities = coverCapabilities(run),
  } = {},
) {
  const list = Array.isArray(files) ? files : [files];
  const sizeChecks = list.map((file) =>
    size ? checkImage(file, { size }) : null,
  );
  const sizeProblems = sizeChecks.flatMap((c) =>
    c ? c.problems.map((p) => `${path.basename(c.file)}: ${p}`) : [],
  );

  if (!capabilities.ffmpeg.available) {
    return {
      ok: false,
      problems: ["ffmpeg missing", ...sizeProblems],
      checks: sizeChecks.filter(Boolean).map((check) => ({
        ...check,
        status: check.ok ? "pass" : "unverified",
      })),
    };
  }

  const dir =
    outDir || fs.mkdtempSync(path.join(os.tmpdir(), "prompt-studio-cover-"));
  fs.mkdirSync(dir, { recursive: true });
  const font = capabilities.cjkFont;
  const problems = [...sizeProblems];
  const used = new Set();
  const variants = list.map((file, i) => {
    let base = path.basename(file, path.extname(file));
    if (used.has(base)) base = `${base}-${i}`;
    used.add(base);
    const previews = { w340: null, crop120: null, title: null };
    const checks = {
      size: {
        status: sizeChecks[i]?.ok ? "pass" : "unverified",
        ...(sizeChecks[i]?.problems.length
          ? { error: sizeChecks[i].problems.join("; ") }
          : {}),
      },
      w340: { status: "unverified" },
      crop120: { status: "unverified" },
      title: { status: "unverified" },
    };
    const render = (key, suffix, vf) => {
      const target = path.join(dir, `${base}-${suffix}.png`);
      try {
        run("ffmpeg", [
          "-y",
          "-v",
          "error",
          "-i",
          file,
          "-vf",
          vf,
          "-frames:v",
          "1",
          target,
        ]);
        previews[key] = target;
        checks[key] = { status: "written" };
      } catch {
        const error = `${path.basename(file)}: ffmpeg could not write ${suffix} preview; check image decoding and output permissions`;
        checks[key] = { status: "unverified", error };
        problems.push(error);
      }
    };
    render("w340", "340", "scale=340:-1");
    render(
      "crop120",
      "crop120",
      "crop='min(iw,ih)':'min(iw,ih)',scale=120:120",
    );
    if (title && (!capabilities.ffmpeg.drawtext || !font)) {
      const missing = [
        !capabilities.ffmpeg.drawtext && "ffmpeg drawtext filter",
        !font && "CJK-capable font",
      ].filter(Boolean);
      const escape = (value) =>
        String(value).replace(
          /[&<>"']/g,
          (ch) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[ch],
        );
      try {
        const image = fs.readFileSync(previews.w340 || file).toString("base64");
        const target = path.join(dir, `${base}-title.html`);
        fs.writeFileSync(
          target,
          `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Cover title preview</title><style>body{margin:24px;background:#eee;font-family:"PingFang SC","Noto Sans CJK SC",sans-serif}.cover{position:relative;width:340px;overflow:hidden}.cover img{display:block;width:100%}.title{position:absolute;inset:auto 0 0;padding:32px 14px 12px;color:white;font-size:22px;line-height:1.3;overflow-wrap:anywhere;background:linear-gradient(transparent,rgba(0,0,0,.8));white-space:pre-wrap}</style><div class="cover"><img alt="Cover" src="data:image/png;base64,${image}"><div class="title">${escape(title)}</div></div></html>`,
        );
        previews.title = target;
        checks.title = {
          status: "unverified",
          artifactStatus: "written",
          error: `Missing ${missing.join(" and ")}; HTML preview written; browser visual inspection required`,
        };
      } catch {
        const error =
          "Could not write HTML title preview; check input image and output permissions";
        checks.title = { status: "unverified", error };
        problems.push(error);
      }
    } else if (title) {
      const textFile = path.join(dir, `${base}-title.txt`);
      fs.writeFileSync(textFile, title);
      const fontPart = font ? `fontfile=${filterEscape(font)}:` : "";
      const vf =
        "scale=340:-1,drawbox=x=0:y=ih-44:w=iw:h=44:color=black@0.6:t=fill," +
        `drawtext=${fontPart}textfile=${filterEscape(textFile)}:fontcolor=white:fontsize=22:x=(w-text_w)/2:y=h-33`;
      render("title", "title", vf);
    }
    return { file, sizeCheck: sizeChecks[i], previews, checks };
  });
  // ok only means no hard errors; an unverified check still needs a human look.
  const unverified = variants.flatMap((v) =>
    Object.entries(v.checks || {})
      .filter(([, c]) => c?.status === "unverified")
      .map(([name]) => `${path.basename(v.file)}: ${name}`),
  );
  return {
    ok: problems.length === 0,
    unverified,
    outDir: dir,
    variants,
    problems,
  };
}

// ---------- brief: provenance record for one generation ----------

// Gallery: an HTML page of candidates (sample images, full prompt, source,
// license) for terminals that cannot show images.
// The page states the length to generate and flags samples from another model;
// the caller passes both once at the top, each candidate may override them.
export function withTarget(
  candidates,
  entries,
  { targetModel, targetDurationSec },
) {
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  return candidates.map((c) => {
    const e = byId.get(String(c.id));
    const wantedModel = c.targetModel ?? targetModel;
    const sample = { ...e, ...c };
    if (c.model !== undefined) {
      sample.modelKeys = c.modelKeys;
      sample.modelKey = c.modelKey;
      if (c.renderEngine === undefined) delete sample.renderEngine;
    }
    const inferred = modelMatchOf(sample, wantedModel);
    const modelMatch = inferred;
    return {
      ...(targetModel ? { targetModel } : {}),
      ...(targetDurationSec ? { targetDurationSec } : {}),
      ...referenceRequirements(e || c),
      sampleRatio: e?.sampleRatio ?? e?.ratio ?? null,
      sampleDurationSec: e?.sampleDurationSec ?? e?.durationSec ?? null,
      mediaState:
        e?.mediaState ||
        (e?.videos?.length
          ? "video"
          : e?.sourceMedia?.length
            ? "image"
            : "none"),
      ...c,
      modelKeys: entryModelKeys(sample),
      targetModelKey: modelKeyOf(wantedModel),
      versionNote: versionNoteOf(sample, wantedModel),
      ...versionFields(sample, wantedModel),
      ...codeVideoFields(sample),
      modelKey: entryModelKeys(sample)[0] || null,
      evidence: evidenceOf({ ...e, ...c }),
      licenseStatus: licenseStatusOf(c.license ?? e?.license, { ...e, ...c }),
      sourceUrl:
        c.sourceUrl ||
        e?.sourceUrl ||
        (c.source || e?.source
          ? `https://github.com/${c.source || e.source}`
          : null),
      curatedSource: c.curatedSource ?? e?.curatedSource ?? false,
      videos: c.videos ?? e?.videos ?? [],
      videoFrom: c.videoFrom ?? e?.videoFrom ?? null,
      modelMatch,
      modelMismatch: modelMatch === "mismatched" ? String(wantedModel) : false,
    };
  });
}

export async function galleryPage({
  project,
  runId,
  title,
  request,
  query,
  targetModel,
  targetDurationSec,
  targetRatio,
  locale,
  candidates = [],
  posterRunner = promisify(execFile),
  out,
  entries,
  env = process.env,
  now = Date.now(),
} = {}) {
  if (!Array.isArray(candidates) || !candidates.length)
    throw new Error("gallery needs candidates: [{id, fit, ...}]");
  const id = String(runId || `gallery-${now}`).replace(/[^\w.-]/g, "-");
  const file = out
    ? path.resolve(out)
    : path.join(recordsDir(project, env), "gallery", `${id}.html`);
  const pool = entries || loadEntries({}).entries;
  const prepared = withTarget(candidates, pool, {
    targetModel,
    targetDurationSec,
  });
  const byId = new Map(pool.map((e) => [String(e.id), e]));
  let next = 0;
  const posterDir = path.join(recordsDir(project, env), "gallery", "posters");
  const pending = new Map();
  const extract = (url, duration) => {
    const knownDuration =
      Number.isFinite(Number(duration)) && Number(duration) > 0
        ? Number(duration)
        : null;
    const times = [
      ...new Set(
        [1, knownDuration ? knownDuration * 0.4 : 3].map((time) => {
          const clamped = knownDuration
            ? Math.min(time, knownDuration * 0.9)
            : time;
          return Math.min(
            knownDuration ? knownDuration * 0.9 : Infinity,
            Number(clamped.toFixed(2)) || clamped,
          );
        }),
      ),
    ];
    const cacheKey = JSON.stringify(["independent-frames-v2", url, times]);
    try {
      if (new URL(url).protocol !== "https:") return null;
    } catch {
      return null;
    }
    if (!pending.has(cacheKey))
      pending.set(
        cacheKey,
        (async () => {
          const poster = path.join(
            posterDir,
            `${createHash("sha256").update(cacheKey).digest("hex")}.jpg`,
          );
          const failure = poster.replace(/\.jpg$/, ".fail");
          try {
            if (
              fs.existsSync(failure) &&
              Date.now() - fs.statSync(failure).mtimeMs < 3600000
            )
              return null;
            if (!fs.existsSync(poster) || !fs.statSync(poster).size) {
              fs.mkdirSync(posterDir, { recursive: true });
              const temporary = `${poster}.${process.pid}.${Math.random().toString(16).slice(2)}.jpg`;
              for (const time of times) {
                try {
                  await posterRunner(
                    "ffmpeg",
                    [
                      "-nostdin",
                      "-y",
                      "-loglevel",
                      "error",
                      "-ss",
                      String(time),
                      "-protocol_whitelist",
                      "https,tls,tcp",
                      "-i",
                      url,
                      "-frames:v",
                      "1",
                      "-vf",
                      "scale=640:-2",
                      temporary,
                    ],
                    { timeout: 15000 },
                  );
                  if (!fs.statSync(temporary).size)
                    throw new Error("empty poster");
                  if (
                    !fs.existsSync(poster) ||
                    fs.statSync(temporary).size > fs.statSync(poster).size
                  )
                    fs.renameSync(temporary, poster);
                } catch {
                  // One seek or download failure must not discard another frame.
                } finally {
                  fs.rmSync(temporary, { force: true });
                }
              }
              if (!fs.existsSync(poster) || !fs.statSync(poster).size)
                throw new Error("No usable frames");
            }
            fs.rmSync(failure, { force: true });
            return poster;
          } catch {
            try {
              fs.mkdirSync(posterDir, { recursive: true });
              fs.writeFileSync(failure, "failed");
            } catch {}
            return null;
          }
        })(),
      );
    return pending.get(cacheKey);
  };
  await Promise.all(
    Array.from({ length: Math.min(3, prepared.length) }, async () => {
      while (next < prepared.length) {
        const candidate = prepared[next++];
        const entry = byId.get(String(candidate.id));
        const images =
          candidate.images ??
          (candidate.image ? [candidate.image] : entry?.sourceMedia) ??
          [];
        if (!candidate.videos.length) continue;
        const poster = await extract(
          candidate.videos[0],
          candidate.sampleDurationSec,
        );
        if (poster)
          candidate.images = [
            poster,
            ...images.filter((image) => image !== poster),
          ];
        candidate.evidence = evidenceOf(candidate);
      }
    }),
  );
  const built = buildCandidates(prepared, pool);
  writeGallery({
    file,
    title,
    request,
    runId: id,
    candidates: built.candidates,
    targetModel,
    targetDurationSec,
    targetRatio,
    locale:
      locale || (/[\u3400-\u9fff]/.test(request || query || "") ? "zh" : "en"),
  });
  return {
    file,
    runId: id,
    url: `file://${file}`,
    shown: built.candidates.map((c) => c.id),
    missing: built.missing,
  };
}

export async function checkVideo(
  file,
  { ratio, duration, size, probeRunner = promisify(execFile) } = {},
) {
  const pair = (value, separator) => {
    const match = String(value || "").match(separator);
    return match && Number(match[1]) > 0 && Number(match[2]) > 0
      ? [Number(match[1]), Number(match[2])]
      : null;
  };
  const targetRatio = pair(ratio, /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  const targetSize = pair(size, /^(\d+)x(\d+)$/);
  if (ratio != null && !targetRatio)
    throw new Error("--ratio must be positive W:H");
  if (size != null && !targetSize)
    throw new Error("--size must be positive WxH");
  if (
    duration != null &&
    !(Number.isFinite(Number(duration)) && Number(duration) > 0)
  )
    throw new Error("--duration must be positive seconds");
  const result = {
    status: "unverified",
    width: null,
    height: null,
    durationSec: null,
    ratio: null,
    checks: [],
  };
  const unreadable = (message) => ({
    ...result,
    status: "fail",
    error: message,
    checks: [
      {
        name: "readable",
        status: "fail",
        expected: "readable video file",
        actual: message,
        fix: "Provide an existing, readable video file.",
        alternative: null,
      },
    ],
  });
  if (typeof file !== "string" || !file)
    return unreadable("No input video file was provided.");
  try {
    if (!fs.statSync(file).isFile())
      return unreadable("Input path is not a video file.");
  } catch (error) {
    return unreadable(`Cannot read input file: ${error.code || error.message}`);
  }
  try {
    const response = await probeRunner(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration:stream_side_data=rotation:format=duration",
        "-of",
        "json",
        path.resolve(file),
      ],
      { timeout: 15000 },
    );
    const data = JSON.parse(
      typeof response === "string" ? response : response.stdout,
    );
    const stream = data.streams?.[0];
    result.width = Number(stream?.width) || null;
    result.height = Number(stream?.height) || null;
    const rotation = Number(
      stream?.side_data_list?.find((item) => item.rotation != null)?.rotation ||
        0,
    );
    if (Math.abs(rotation % 180) === 90)
      [result.width, result.height] = [result.height, result.width];
    result.durationSec =
      Number(stream?.duration ?? data.format?.duration) || null;
    if (!(result.width > 0 && result.height > 0))
      throw new Error("No video dimensions");
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const divisor = gcd(result.width, result.height);
    result.ratio = `${result.width / divisor}:${result.height / divisor}`;
    const add = (
      name,
      expected,
      actual,
      pass,
      fix = null,
      alternative = null,
    ) =>
      result.checks.push({
        name,
        status: actual == null ? "unverified" : pass ? "pass" : "fail",
        expected,
        actual,
        fix: pass ? null : fix,
        alternative: pass ? null : alternative,
      });
    if (targetRatio) {
      const r = targetRatio[0] / targetRatio[1];
      const quote = (value) =>
        "'" + String(value).replaceAll("'", "'\\''") + "'";
      const input = quote(path.resolve(file));
      const output = quote(
        path.resolve(path.dirname(file), path.parse(file).name + "-padded.mp4"),
      );
      const cropped = quote(
        path.resolve(
          path.dirname(file),
          path.parse(file).name + "-cropped.mp4",
        ),
      );
      const fix = `ffmpeg -i ${input} -vf "pad=w='ceil(max(iw,ih*${r})/2)*2':h='ceil(max(ih,iw/${r})/2)*2':x=(ow-iw)/2:y=(oh-ih)/2" -c:a copy ${output}`;
      const alternative = `ffmpeg -i ${input} -vf "crop=w='floor(min(iw,ih*${r})/2)*2':h='floor(min(ih,iw/${r})/2)*2'" -c:a copy ${cropped}`;
      add(
        "ratio",
        ratio,
        result.ratio,
        Math.abs(result.width / result.height / r - 1) <= 0.01,
        fix,
        alternative,
      );
    }
    if (duration != null)
      add(
        "duration",
        Number(duration),
        result.durationSec,
        result.durationSec != null &&
          Math.abs(result.durationSec - Number(duration)) <=
            0.3 + Number.EPSILON,
      );
    if (targetSize)
      add(
        "size",
        size,
        `${result.width}x${result.height}`,
        result.width === targetSize[0] && result.height === targetSize[1],
      );
    if (!result.checks.length)
      add("probe", "readable video", result.ratio, true);
    result.status = result.checks.some((c) => c.status === "fail")
      ? "fail"
      : result.checks.some((c) => c.status === "unverified")
        ? "unverified"
        : "pass";
  } catch (error) {
    if (error.code !== "ENOENT")
      return unreadable(
        `Unable to probe input video: ${error.message || error}`,
      );
    result.error = "ffprobe executable is unavailable.";
    result.checks.push({
      name: "probe",
      status: "unverified",
      expected: "ffprobe video metadata",
      actual: null,
      fix: "Install ffprobe and retry.",
      alternative: null,
    });
  }
  return result;
}

export function attributionFor(license) {
  const value = String(license || "");
  if (
    /\bcc[ -]*by(?:\b|-)|\bMIT\b|\bApache(?:[ -]2(?:\.0)?)?\b|\b(?:A?GPL|LGPL)(?:[ -]\d)?\b/i.test(
      value,
    )
  )
    return true;
  if (/^\s*(?:CC[ -]*0(?:[ -]1\.0)?|public domain)\s*$/i.test(value))
    return false;
  return "unknown";
}
function briefEntry(promptId, env) {
  for (const src of loadRegistry({ env })) {
    const entries = readJson(
      path.join(cacheDir(env), src.id, ".normalized.json"),
      [],
    );
    const found = Array.isArray(entries) ? showEntry(entries, promptId) : null;
    if (found) return found;
  }
  return showEntry(loadEntries({ cache: cacheDir(env) }).entries, promptId);
}

export function writeBrief({
  project,
  runId,
  promptId,
  entries,
  author,
  link,
  title,
  source,
  license,
  channel,
  model,
  outputPath,
  size,
  content,
  styleNotes,
  extra,
  env = process.env,
  now = Date.now(),
} = {}) {
  const entry =
    promptId == null
      ? null
      : entries
        ? showEntry(entries, promptId)
        : briefEntry(promptId, env);
  title = title ?? entry?.title;
  author = author ?? entry?.author;
  link = link ?? entry?.link;
  source = source ?? entry?.source;
  license = license ?? entry?.license;
  const id = runId || `run-${now}`;
  const dir = path.join(
    recordsDir(path.resolve(project || process.cwd()), env),
    "briefs",
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(id).replace(/[^\w.-]+/g, "-")}.md`);
  const attributionRequired = attributionFor(license);
  const val = (v) => (v == null || v === "" ? "-" : String(v));
  const lines = [
    `# ${title || id}`,
    "",
    `Run: ${id}${promptId != null ? ` (prompt ${promptId})` : ""}`,
    "",
    "## Source / License",
    "",
    `- Source: ${val(source)}`,
    `- Author: ${val(author)}`,
    `- Link: ${val(link)}`,
    `- License: ${val(license)}`,
    `- Attribution required: ${attributionRequired === "unknown" ? "unknown" : attributionRequired ? "yes" : "no"}`,
    "",
    "## Channel / Model",
    "",
    `- Channel: ${val(channel)}`,
    `- Model: ${val(model)}`,
    "",
    "## Output",
    "",
    `- File: ${val(outputPath)}`,
    `- Size: ${val(size)}`,
    "",
    "## Style",
    "",
    val(styleNotes),
    "",
    "## Prompt",
    "",
    "```text",
    String(content || ""),
    "```",
    "",
  ];
  if (extra != null) {
    lines.push(
      "## Extra",
      "",
      "```json",
      JSON.stringify(extra, null, 2),
      "```",
      "",
    );
  }
  fs.writeFileSync(file, lines.join("\n"));
  return { path: file, attributionRequired };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

const list = (v) =>
  typeof v === "string"
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

export async function addSource(
  repo,
  {
    kind,
    adapter,
    file,
    itemsPath,
    map,
    videoTemplate,
    cache = cacheDir(),
    detectSource,
    env = process.env,
    run = defaultRun,
    fetchImpl = defaultFetch(env),
  } = {},
) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo || "")
  )
    throw new Error("sources add needs owner/repo");
  if (kind && !["image", "video", "code-video"].includes(kind))
    throw new Error("Invalid --kind");
  if (adapter && !/^[a-z][a-z0-9-]*$/.test(adapter))
    throw new Error("Invalid --adapter");
  let detector = detectSource;
  if (!adapter && !detector) {
    if (!fs.existsSync(path.join(HERE, "adapters", "detect.mjs")))
      throw new Error("Source detection is unavailable; pass --adapter");
    detector = (await import("./adapters/detect.mjs")).detectSource;
    if (typeof detector !== "function")
      throw new Error("Source detection is unavailable; pass --adapter");
  }
  const token = authToken({ env, run });
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const useGh = detectAccess({ env, run }).tier === "gh";
  const githubJson = async (endpoint) => {
    if (useGh) return JSON.parse(run("gh", ["api", endpoint]));
    const response = await fetchImpl(`https://api.github.com/${endpoint}`, {
      headers,
    });
    if (!response.ok)
      throw new Error(`GitHub metadata HTTP ${response.status}`);
    return JSON.parse(
      Buffer.from(await response.arrayBuffer()).toString("utf8"),
    );
  };
  const metadata = await githubJson(`repos/${repo}`);
  const branch = metadata.default_branch || "main";
  let detected = {};
  if (!adapter) {
    const tree = await githubJson(
      `repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );
    const fetchText = async (repoPath) => {
      if (
        typeof repoPath !== "string" ||
        !repoPath ||
        path.isAbsolute(repoPath) ||
        repoPath.split(/[\\/]/).includes("..")
      )
        throw new Error("Unsafe detected repository path");
      const rawPath = repoPath.split("/").map(encodeURIComponent).join("/");
      const response = await fetchImpl(
        `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${rawPath}`,
        { headers },
      );
      if (!response.ok) throw new Error(`GitHub data HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer()).toString("utf8");
    };
    detected = (await detector({ repo, branch, tree, fetchText })) || {};
    adapter = detected.adapter;
    if (!adapter)
      throw new Error("Could not detect an adapter; pass --adapter");
  }
  if (!/^[a-z][a-z0-9-]*$/.test(adapter)) throw new Error("Invalid --adapter");
  const options = detected.options || {};
  const mapping =
    typeof map === "string" ? JSON.parse(map) : map || options.map;
  const dataFile = file || options.file;
  if (adapter === "json-map") {
    if (
      !mapping ||
      typeof mapping !== "object" ||
      Array.isArray(mapping) ||
      !Object.keys(mapping).length
    )
      throw new Error(
        "json-map needs --map with a non-empty JSON field mapping",
      );
    if (
      typeof dataFile !== "string" ||
      !dataFile ||
      path.isAbsolute(dataFile) ||
      dataFile.split(/[\\/]/).includes("..")
    )
      throw new Error("json-map needs a safe repository --file path");
  }
  const chosenKind = kind || detected.kinds?.[0] || "image";
  if (!["image", "video", "code-video"].includes(chosenKind))
    throw new Error("Invalid detected kind");
  const source = {
    ...options,
    id: repo
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-$/, ""),
    title: metadata.full_name || repo,
    repo,
    branch,
    kinds: [chosenKind],
    adapter,
    license:
      metadata.license?.spdx_id ||
      metadata.license?.name ||
      "No license declared",
    seed: "never",
    userAdded: true,
    ...(dataFile ? { file: dataFile } : {}),
    ...(itemsPath !== undefined ? { itemsPath } : {}),
    ...(mapping ? { map: mapping } : {}),
    ...(videoTemplate ? { videoTemplate } : {}),
  };
  const registryFile = path.join(cache, "user-sources.json");
  const registry = readJson(registryFile, { sources: [] });
  const existing = loadRegistry({ cache }).find((s) => s.id === source.id);
  if (
    existing &&
    (!existing.userAdded || existing.repo.toLowerCase() !== repo.toLowerCase())
  )
    throw new Error("Source id conflicts with an existing source");
  fs.mkdirSync(cache, { recursive: true });
  const validationCache = fs.mkdtempSync(path.join(cache, "source-check-"));
  try {
    const validation = {
      sources: [source],
      all: true,
      cache: validationCache,
      seedFile: null,
      env,
      run,
      fetchImpl,
      token: authToken({ env, run }),
    };
    const synced = await syncSources(validation);
    const loaded = await loadAllEntries(validation);
    if (!loaded.entries.length)
      throw new Error(
        `Source has 0 entries; registration unchanged. ${[...new Set([...(synced.notes || []), ...loaded.notes])].join("; ") || "Check --file, --items-path and --map."}`,
      );
    fs.cpSync(
      path.join(validationCache, source.id),
      path.join(cache, source.id),
      { recursive: true },
    );
    registry.sources = [
      ...(registry.sources || []).filter((s) => s.id !== source.id),
      source,
    ];
    writeJson(registryFile, registry);
    return {
      source,
      file: registryFile,
      entries: loaded.entries.length,
      titles: loaded.entries.slice(0, 2).map((e) => e.title),
    };
  } finally {
    fs.rmSync(validationCache, { recursive: true, force: true });
  }
}

const USAGE = `Usage: node studio.mjs <command> [options]

  access                              Show the GitHub access tier (gh / token / anonymous)
  session [--project DIR]             One-shot probe: access tier, style pack, channels (codex/grok/ffmpeg/node, key var names)
  sources [--kind image|video|code-video]  List registered sources and cached entries
  sources add <owner/repo> --kind <kind> [--adapter <adapter>] [--file <repo-path>] [--items-path <path>] [--map '{"title":"title","content":"prompt"}'] [--video-template 'https://host/{slug}/clip.mp4']
  sync [--source a,b | --kind video | --category a,b | --all] [--force] [--allow-large]
                                      Refresh matching sources (ETag, at most every 10 min);
                                      social-media-post and product-marketing need --allow-large
  search "<keywords>" [--kind image|video|code-video] [--source a,b] [--category a,b] [--limit 30] [--wait-sec 6] [--project DIR]
                                      Rank prompts (default image); cached library first, bundled seed offline
  check-video <file> [--ratio W:H] [--duration S] [--size WxH]
  recommend "<english keywords> [| more keywords]" [--use cover|poster|illustration|infographic|avatar|thumbnail|comic|product|game|app]
            [--kind image|video|code-video] [--model key-or-name] [--mode image-to-video|text-to-video|image|edit] [--subject "words"] [--source a,b]
            [--category a,b] [--wait-sec 6] [--limit 8] [--allow-large] [--project DIR]
                                      Sync sources and return ranked candidates; --use scopes YouMind categories
                                      Budget: --wait-sec or PROMPT_STUDIO_SYNC_BUDGET_SEC (default 6 seconds)
  build-seed [--per 5]                Rebuild licensed offline samples
  show <id...> [--category a,b]       Print prompts in full (ids space- or comma-separated)
  cover-check <files...> [--title "..."] [--size WxH] [--out DIR]
                                      Size check plus 340px / 120px-crop / title-overlay previews (needs ffmpeg)
  gallery --json '{"runId","title","request","targetModel","targetDurationSec","candidates":[{"id","fit","ratio","adapted","default"}]}'
          [--project DIR] [--out FILE] [--serve [--timeout-min 30]]
                                      Write <records>/gallery/<runId>.html (sample images, editable prompt,
                                      source, license). --serve hosts it on 127.0.0.1, prints the url, waits
                                      for the user's 选这个 click and prints {pick}; background it only where the host reports when it ends
  brief --json '<fields>' [--project DIR]
                                      Write briefs/<runId>.md (source, license, channel, model, output, prompt)
  github "<topic>" [--limit 10]       Search GitHub repositories (needs gh or a token)
  source <url> [--confirm]            Compare a third-party file with the version you confirmed
  check-image <file> [--size WxH] [--ratio A:B]
                                      Verify image dimensions
  style-pack [--project DIR]          Locate the style pack
  log --json '<record>' [--project DIR]
  rate <runId> <1-5> [--project DIR]  Append a score for a logged run
`;

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  const project = path.resolve(flags.project || process.cwd());
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  const token = () => authToken();
  if (
    flags.limit !== undefined &&
    ["recommend", "search", "github"].includes(command) &&
    (typeof flags.limit !== "string" || invalidLimit(Number(flags.limit)))
  ) {
    process.exitCode = 2;
    return out(limitError());
  }

  if (["recommend", "search", "sync", "show", "sources"].includes(command)) {
    if (flags.kind && !["image", "video", "code-video"].includes(flags.kind)) {
      process.exitCode = 2;
      return out({
        error: "unknown-kind",
        hint: "kind must be image, video or code-video",
      });
    }
    if (flags.source) {
      const kind =
        flags.kind ||
        (["recommend", "search"].includes(command) ? "image" : undefined);
      const known = loadRegistry().filter(
        (src) => !kind || src.kinds?.includes(kind),
      );
      const unknown = list(flags.source).filter(
        (id) => !known.some((src) => src.id === id),
      );
      if (unknown.length) {
        process.exitCode = 2;
        return out({
          error: "unknown-source",
          unknown,
          knownIds: known.map((src) => src.id),
        });
      }
    }
  }

  switch (command) {
    case "check-video": {
      const result = await checkVideo(positional[0], {
        ratio: flags.ratio,
        duration: flags.duration,
        size: flags.size,
      });
      out(result);
      // Match check-image: a failed check exits non-zero; unverified stays 0.
      if (result.status === "fail") process.exitCode = 1;
      return;
    }
    case "sources": {
      if (positional[0] === "add")
        return out(
          await addSource(positional[1], {
            kind: flags.kind,
            adapter: flags.adapter,
            file: flags.file || flags.path,
            itemsPath: flags["items-path"],
            map: flags.map,
            videoTemplate: flags["video-template"],
          }),
        );
      return out(getSourceStats({ kind: flags.kind }));
    }
    case "access":
      return out(detectAccess());
    case "session":
      return out(detectSession({ project }));
    case "sync": {
      if (flags.use && !USE_MAP[flags.use]) {
        process.exitCode = 2;
        return out({
          error: "unknown-use",
          hint: `use must be one of: ${Object.keys(USE_MAP).join(", ")}`,
        });
      }
      const opts = {
        kind: flags.kind,
        sourceIds: list(flags.source),
        categories: flags.use
          ? USE_MAP[flags.use]
          : list(flags.category || flags.categories),
        all: Boolean(flags.all),
        force: Boolean(flags.force),
        allowLarge: Boolean(flags["allow-large"]),
        token: token(),
        cachedOnly:
          Boolean(flags["cached-only"]) ||
          !(
            flags.source ||
            flags.kind ||
            flags.all ||
            flags.category ||
            flags.categories ||
            flags.use
          ),
      };
      return out(
        flags["background-lock"]
          ? await runBackgroundSync(opts, {
              lockFile: flags["background-lock"],
              lockToken: flags["background-token"],
            })
          : await syncSources(opts),
      );
    }
    case "recommend": {
      const result = await recommend(positional.join(" "), {
        kind: flags.kind || "image",
        model: flags.model,
        mode: flags.mode,
        subject: flags.subject,
        refs: flags.refs === undefined ? 0 : Number(flags.refs),
        waitSec:
          flags["wait-sec"] === undefined
            ? undefined
            : Number(flags["wait-sec"]),
        sourceIds: list(flags.source),
        use: typeof flags.use === "string" ? flags.use : undefined,
        categories: list(flags.category),
        limit: flags.limit === undefined ? 8 : Number(flags.limit),
        project,
        allowLarge: Boolean(flags["allow-large"]),
        force: Boolean(flags.force),
        token: token(),
      });
      out(result);
      if (result.error) process.exitCode = 2;
      return;
    }
    case "cover-check": {
      if (!positional.length)
        throw new Error("cover-check needs at least one image file");
      const result = coverCheck(positional, {
        title: typeof flags.title === "string" ? flags.title : undefined,
        size: typeof flags.size === "string" ? flags.size : undefined,
        outDir:
          typeof flags.out === "string" ? path.resolve(flags.out) : undefined,
      });
      out(result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "gallery": {
      if (typeof flags.json !== "string")
        throw new Error("gallery needs --json '<fields>'");
      const fields = JSON.parse(flags.json);
      const result = await galleryPage({
        ...fields,
        entries: (await loadAllEntries({})).entries,
        project,
        out: typeof flags.out === "string" ? flags.out : fields.out,
      });
      if (result.missing.length) {
        // A page missing a candidate must not be opened: drop it and its link.
        fs.rmSync(result.file, { force: true });
        const { file, url, ...rest } = result;
        out(rest);
        process.exitCode = 1;
        return;
      }
      if (!flags.serve) return out(result);
      // Serve mode: print the URL now, then block until the user clicks 选这个
      // (or the timeout) and print the pick; run it in the background.
      const pick = await serveGallery({
        file: result.file,
        ids: result.shown,
        pickFile: result.file.replace(/\.html$/, ".pick.json"),
        timeoutMs: (Number(flags["timeout-min"]) || 30) * 60 * 1000,
        onReady: (url) => out({ ...result, url, waiting: "pick" }),
      });
      out({ pick });
      if (pick.status !== "picked") process.exitCode = 3;
      return;
    }
    case "brief": {
      if (typeof flags.json !== "string")
        throw new Error("brief needs --json '<fields>'");
      const fields = JSON.parse(flags.json);
      return out(
        writeBrief({
          ...fields,
          entries: (await loadAllEntries({})).entries,
          project: flags.project ? project : fields.project || project,
        }),
      );
    }
    case "search": {
      const query = positional.join(" ");
      const kind = flags.kind || "image";
      const use = flags.use || (kind === "image" ? inferUse(query) : null);
      if (use && !USE_MAP[use]) {
        process.exitCode = 2;
        return out({ error: "unknown-use" });
      }
      const categories = use ? USE_MAP[use] : list(flags.category);
      const sourceIds = list(flags.source);
      const known = loadRegistry().filter((src) => src.kinds?.includes(kind));
      const unknown = sourceIds.filter(
        (id) => !known.some((src) => src.id === id),
      );
      if (unknown.length) {
        process.exitCode = 2;
        return out({
          error: "unknown-source",
          unknown,
          knownIds: known.map((src) => src.id),
        });
      }
      const opts = {
        categories,
        kind,
        sourceIds,
        waitSec:
          flags["wait-sec"] === undefined
            ? undefined
            : Number(flags["wait-sec"]),
        token: token(),
        allowLarge: Boolean(flags["allow-large"]),
        force: Boolean(flags.force),
      };
      const synced = await syncForQuery(opts);
      const { origin, entries, notes } = await loadAllEntries(opts);
      const results = searchEntries(entries, query, {
        limit: flags.limit === undefined ? 30 : Number(flags.limit),
        ratings: loadRatings(project),
        model: flags.model,
        mode: flags.mode,
        subject: flags.subject,
      });
      const cacheNotes = [...(synced.notes || []), ...notes];
      if (results[0]?.relevanceNote) cacheNotes.push(results[0].relevanceNote);
      else if (
        !results.length &&
        tokenize(query).some((t) => !GENERIC_TECHNIQUE_WORDS.includes(t))
      )
        cacheNotes.push(
          `no close match for ${flags.subject || query}; showing nearest by ${flags.model ? "model" : "keywords"}`,
        );
      if (flags.model && !results.some((entry) => !entry.modelMismatch))
        cacheNotes.push(
          `no ${flags.model} samples in the libraries; showing other models`,
        );
      return out({
        kind,
        origin,
        total: entries.length,
        results,
        pending: synced.pending || [],
        cacheNote: [...new Set(cacheNotes)].join("; "),
      });
    }
    case "show": {
      const { entries } = await loadAllEntries({
        categories: list(flags.category),
        kind: flags.kind,
        sourceIds: list(flags.source),
      });
      const ids = parseIds(positional);
      if (!ids.length) throw new Error("show needs at least one prompt id");
      if (ids.length === 1) {
        const entry = showEntry(entries, ids[0]);
        if (!entry)
          throw new Error(
            `prompt ${ids[0]} not found; run \`search\` first or widen --category`,
          );
        return out(entry);
      }
      const { entries: found, missing } = showEntries(entries, ids);
      if (!found.length)
        throw new Error(
          `prompts ${ids.join(", ")} not found; run \`search\` first or widen --category`,
        );
      return out(
        missing.length ? { entries: found, missing } : { entries: found },
      );
    }
    case "github":
      return out(
        await searchGithub(positional.join(" "), {
          limit: flags.limit === undefined ? 10 : Number(flags.limit),
        }),
      );
    case "source":
      if (!positional[0]) throw new Error("source needs a URL");
      return out(
        await checkSource(positional[0], {
          confirm: Boolean(flags.confirm),
          token: token(),
        }),
      );
    case "check-image": {
      const result = checkImage(positional[0], {
        size: flags.size,
        ratio: flags.ratio,
      });
      out(result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "style-pack":
      return out(findStylePack(project));
    case "log":
      if (typeof flags.json !== "string")
        throw new Error("log needs --json '<record>'");
      return out(logRun(project, JSON.parse(flags.json)));
    case "rate":
      return out(rateRun(project, positional[0], Number(positional[1])));
    case "build-seed": {
      const sources = loadRegistry().filter((s) => s.seed === "allowed");
      await syncSources({
        sources,
        all: true,
        allowLarge: true,
        token: token(),
      });
      const seed = buildSeed(
        (await loadAllEntries({ sources })).entries,
        Math.min(50, Math.max(1, Math.floor(Number(flags.per) || 5))),
        sources,
      );
      writeJson(SEED_FILE, seed);
      return out({ file: SEED_FILE, entries: seed.entries.length });
    }
    default:
      process.stdout.write(USAGE);
      process.exitCode = command ? 2 : 0;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`prompt-studio: ${error.message}\n`);
    process.exitCode = 1;
  });
}
