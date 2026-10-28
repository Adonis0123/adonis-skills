#!/usr/bin/env node
// prompt-studio helper: prompt-library sync and search, GitHub access tier,
// third-party source change checks, image size checks and generation records.
// Zero dependencies; Node 18+ (global fetch).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCandidates, serveGallery, writeGallery } from "./gallery.mjs";

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
export function curlFetch(url, { headers = {} } = {}, run = execFileSync) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-studio-"));
  const bodyFile = path.join(tmp, "body");
  try {
    const args = ["-sS", "-L", "--max-time", "300", "-D", "-", "-o", bodyFile];
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    args.push(url);
    const raw = run("curl", args, { encoding: "utf8", maxBuffer: 1 << 20 });
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
    return Promise.reject(error);
  } finally {
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
    } catch {
      return curlFetch(url, init);
    }
  };
}

// ---------- fetch with ETag, throttle and rate-limit backoff ----------

export async function fetchCached(url, file, opts = {}) {
  const {
    cache = cacheDir(),
    now = Date.now(),
    force = false,
    fetchImpl = defaultFetch(),
    token = null,
  } = opts;
  const stateFile = path.join(cache, "state.json");
  const state = readJson(stateFile, { sources: {}, rateLimitResetAt: 0 });
  const entry = state.sources[url] || {};
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
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetchImpl(url, { headers });
  } catch (error) {
    return haveFile
      ? report("stale-offline", { error: String(error.message || error) })
      : report("unavailable-offline", {
          error: String(error.message || error),
        });
  }

  if (res.status === 304) {
    state.sources[url] = { ...entry, checkedAt: now };
    writeJson(stateFile, state);
    return report("unchanged");
  }
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    state.rateLimitResetAt =
      Number.isFinite(reset) && reset > 0
        ? reset * 1000
        : now + CHECK_INTERVAL_MS;
    writeJson(stateFile, state);
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

  const body = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  state.sources[url] = {
    etag: res.headers.get("etag") || null,
    checkedAt: now,
    fetchedAt: new Date(now).toISOString(),
  };
  writeJson(stateFile, state);
  return {
    url,
    file,
    status: "updated",
    fetchedAt: state.sources[url].fetchedAt,
  };
}

// ---------- library sync ----------

// Intended use -> library categories (see recommend).
export const USE_MAP = {
  cover: ["youtube-thumbnail", "poster-flyer"],
  illustration: ["poster-flyer", "others", "social-media-post"],
  infographic: ["infographic-edu-visual"],
  avatar: ["profile-avatar"],
  thumbnail: ["youtube-thumbnail"],
  comic: ["comic-storyboard"],
  product: ["product-marketing", "ecommerce-main-image"],
  game: ["game-asset"],
  app: ["app-web-design"],
};

// Very large category files: downloaded only on explicit request.
export const LARGE_SLUGS = ["social-media-post", "product-marketing"];

export async function syncLibrary({
  categories = [],
  all = false,
  allowLarge = false,
  ...opts
} = {}) {
  const cache = opts.cache || cacheDir();
  const dir = path.join(cache, LIBRARY.id);
  const manifestFile = path.join(dir, "manifest.json");
  const results = [
    await fetchCached(`${LIBRARY.rawBase}/manifest.json`, manifestFile, {
      ...opts,
      cache,
    }),
  ];
  const manifest = readJson(manifestFile, null);
  if (!manifest) return { library: LIBRARY.id, results, categories: [] };

  const known = manifest.categories || [];
  const wanted = all ? known.map((c) => c.slug) : categories;
  for (const slug of wanted) {
    const cat = known.find((c) => c.slug === slug);
    if (!cat) {
      results.push({ url: null, status: "unknown-category", slug });
      continue;
    }
    if (LARGE_SLUGS.includes(slug) && !allowLarge) {
      results.push({
        url: null,
        status: "skipped-large",
        slug,
        hint: `${slug} is a very large file; pass allowLarge: true (CLI: --allow-large) to download it`,
      });
      continue;
    }
    results.push(
      await fetchCached(
        `${LIBRARY.rawBase}/${cat.file}`,
        path.join(dir, cat.file),
        { ...opts, cache },
      ),
    );
  }
  return {
    library: LIBRARY.id,
    updatedAt: manifest.updatedAt || null,
    results,
    categories: known.map((c) => ({
      slug: c.slug,
      title: c.title,
      count: c.count,
      cached: fs.existsSync(path.join(dir, c.file)),
    })),
  };
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
  if (e.sourceMedia.length > 1) q += 0.3;
  if (hasPlaceholders) q -= 0.3;
  return q;
}

export function searchEntries(
  entries,
  query,
  { limit = 30, ratings = new Map(), dropTokens = [] } = {},
) {
  const drop = new Set(dropTokens.map((t) => String(t).toLowerCase()));
  const groups = splitQueries(query).map((q) =>
    tokenize(q).filter((t) => !drop.has(t)),
  );
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
    if (!Array.isArray(e.sourceMedia) || e.sourceMedia.length === 0) continue;
    unique.push(e);
  }
  const docs = unique.map((e) =>
    `${e.title || ""} ${e.description || ""} ${e.content || ""}`.toLowerCase(),
  );
  const idf = idfWeights(docs, allTokens);
  const matchers = allTokens.map((t) => [t, tokenMatcher(t)]);
  const scored = [];
  for (const e of unique) {
    const inTitle = new Set(matchedTokens(matchers, e.title));
    const inDesc = new Set(matchedTokens(matchers, e.description));
    const inContent = new Set(matchedTokens(matchers, e.content));
    let best = { match: 0, matched: [] };
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
      if (match > best.match) best = { match, matched };
    }
    let { match } = best;
    // Cover/thumbnail categories still contain fashion-magazine "covers"; demote them.
    if (
      (e.category === "youtube-thumbnail" || e.category === "poster-flyer") &&
      MAGAZINE_RE.test(`${e.title || ""} ${e.description || ""}`)
    ) {
      match -= 8;
    }
    if (allTokens.length && match <= 0) continue;
    const content = String(e.content || "");
    const hasPlaceholders =
      /\{argument\b/i.test(content) || /\{[a-z_]+=/i.test(content);
    const rating = ratings.get(String(e.id)) || 0;
    const ratingBoost = rating >= 4 ? 5 * (rating - 3) : 0;
    const quality = allTokens.length
      ? readiness(e, content, hasPlaceholders)
      : 0;
    scored.push({
      id: e.id,
      title: e.title,
      description: e.description,
      image: e.sourceMedia[0],
      images: e.sourceMedia.slice(0, 4),
      category: e.category,
      needReferenceImages: Boolean(e.needReferenceImages),
      hasPlaceholders,
      matched: best.matched,
      contentPreview: content.slice(0, 600),
      source: e.source,
      license: e.license,
      yourBestScore: rating || null,
      score: Math.round((match + quality + ratingBoost) * 100) / 100,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
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
  { use, limit = 5, project, categories, ...syncOpts } = {},
) {
  const tokens = tokenize(query);
  // The library is English: a purely CJK query would match nothing useful.
  if (tokens.length && !tokens.some((t) => /^[a-z0-9]+$/.test(t))) {
    return {
      error: "translate-to-english",
      hint: "The prompt library is English. Translate the keywords into English (e.g. 封面 -> cover, 科技 -> tech) and call recommend again.",
    };
  }
  let chosenUse = use || null;
  let cats = [];
  if (chosenUse) {
    if (!USE_MAP[chosenUse])
      return {
        error: "unknown-use",
        hint: `use must be one of: ${Object.keys(USE_MAP).join(", ")}`,
      };
    cats = USE_MAP[chosenUse];
  } else if (categories && categories.length) {
    cats = categories;
  } else {
    chosenUse = inferUse(query);
    if (!chosenUse) {
      return {
        error: "need-category",
        hint: `Pass use (${Object.keys(USE_MAP).join(", ")}) or categories, or include a keyword such as "cover" in the query.`,
      };
    }
    cats = USE_MAP[chosenUse];
  }

  const sync = await syncLibrary({ ...syncOpts, categories: cats });
  const { origin, entries } = loadEntries({
    cache: syncOpts.cache,
    categories: cats,
  });
  const ratings = project
    ? loadRatings(project, syncOpts.env || process.env)
    : new Map();
  // `--use cover` already selected the categories; keeping the word "cover" in the
  // query mostly surfaces fashion-magazine covers instead of the user's subject.
  const dropTokens =
    chosenUse === "cover" || chosenUse === "thumbnail"
      ? ["cover", "covers"]
      : [];
  const results = searchEntries(entries, query, { limit, ratings, dropTokens });

  const notes = [`origin=${origin}`];
  const skipped = sync.results
    .filter((r) => r.status === "skipped-large")
    .map((r) => r.slug);
  if (skipped.length)
    notes.push(
      `skipped large categories: ${skipped.join(", ")} (allowLarge / --allow-large to include)`,
    );
  const stale = sync.results
    .filter((r) => /^(stale|unavailable)/.test(r.status))
    .map((r) => r.status);
  if (stale.length)
    notes.push(
      `library may be out of date (${[...new Set(stale)].join(", ")})`,
    );
  const unknown = sync.results
    .filter((r) => r.status === "unknown-category")
    .map((r) => r.slug);
  if (unknown.length) notes.push(`unknown categories: ${unknown.join(", ")}`);

  const out = {
    use: chosenUse,
    categories: cats,
    origin,
    results,
    cacheNote: notes.join("; "),
  };
  if (origin === "seed")
    out.access = detectAccess({
      env: syncOpts.env || process.env,
      run: syncOpts.run,
    });
  return out;
}

// ---------- seed (maintainer) ----------

export function buildSeed(entries, perCategory = 5) {
  const byCat = new Map();
  for (const e of entries) {
    if (!Array.isArray(e.sourceMedia) || !e.sourceMedia.length) continue;
    const list = byCat.get(e.category) || [];
    if (list.length < perCategory) list.push(e);
    byCat.set(e.category, list);
  }
  return {
    note: `Offline fallback sample from ${LIBRARY.repo}. ${LIBRARY.license}. Credit the source when reusing a prompt.`,
    entries: [...byCat.values()].flat(),
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
  if (size) {
    const [w, h] = size.split("x").map(Number);
    if (dims.width !== w || dims.height !== h) {
      problems.push(
        `size is ${dims.width}x${dims.height}, expected ${w}x${h}; resize or regenerate at this size`,
      );
    }
  }
  if (ratio) {
    const [a, b] = ratio.split(":").map(Number);
    const want = a / b;
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
  const session = {
    access,
    stylePack,
    channels: {
      codex: commandOk("codex", ["--version"], run),
      grok: commandOk("grok", ["--version"], run),
      ffmpeg: commandOk("ffmpeg", ["-version"], run),
      nodeOk: major >= 18,
      apiKeyVars,
    },
  };
  if (stylePackText !== undefined) session.stylePackText = stylePackText;
  return session;
}

// ---------- cover check: contact-sheet previews ----------

function findFont(run) {
  try {
    const out = String(
      run("fc-match", ["-f", "%{file}", ":lang=zh"]) || "",
    ).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {
    // fall through to fixed paths
  }
  return (
    [
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/TTF/DejaVuSans.ttf",
    ].find((f) => fs.existsSync(f)) || null
  );
}

// Escape a value for use inside an ffmpeg filter option.
const filterEscape = (s) => String(s).replace(/[\\:',;[\]]/g, "\\$&");

export function coverCheck(
  files,
  { title, size, outDir, run = defaultRun } = {},
) {
  const list = Array.isArray(files) ? files : [files];
  const sizeChecks = list.map((file) =>
    size ? checkImage(file, { size }) : null,
  );
  const sizeProblems = sizeChecks.flatMap((c) =>
    c ? c.problems.map((p) => `${path.basename(c.file)}: ${p}`) : [],
  );

  if (!commandOk("ffmpeg", ["-version"], run)) {
    return {
      ok: false,
      problems: ["ffmpeg missing", ...sizeProblems],
      checks: sizeChecks.filter(Boolean),
    };
  }

  const dir =
    outDir || fs.mkdtempSync(path.join(os.tmpdir(), "prompt-studio-cover-"));
  fs.mkdirSync(dir, { recursive: true });
  const font = title ? findFont(run) : null;
  const problems = [...sizeProblems];
  const used = new Set();
  const variants = list.map((file, i) => {
    let base = path.basename(file, path.extname(file));
    if (used.has(base)) base = `${base}-${i}`;
    used.add(base);
    const previews = { w340: null, crop120: null, title: null };
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
      } catch (error) {
        problems.push(
          `${path.basename(file)}: ffmpeg ${suffix} failed: ${String(error.message || error).split("\n")[0]}`,
        );
      }
    };
    render("w340", "340", "scale=340:-1");
    render(
      "crop120",
      "crop120",
      "crop='min(iw,ih)':'min(iw,ih)',scale=120:120",
    );
    if (title) {
      const textFile = path.join(dir, `${base}-title.txt`);
      fs.writeFileSync(textFile, title);
      const fontPart = font ? `fontfile=${filterEscape(font)}:` : "";
      const vf =
        "scale=340:-1,drawbox=x=0:y=ih-44:w=iw:h=44:color=black@0.6:t=fill," +
        `drawtext=${fontPart}textfile=${filterEscape(textFile)}:fontcolor=white:fontsize=22:x=(w-text_w)/2:y=h-33`;
      render("title", "title", vf);
    }
    return { file, sizeCheck: sizeChecks[i], previews };
  });
  return { ok: problems.length === 0, outDir: dir, variants, problems };
}

// ---------- brief: provenance record for one generation ----------

// Gallery: an HTML page of candidates (sample images, full prompt, source,
// license) for terminals that cannot show images.
export function galleryPage({
  project,
  runId,
  title,
  request,
  query,
  candidates = [],
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
  const built = buildCandidates(candidates, entries || loadEntries({}).entries);
  writeGallery({
    file,
    title,
    request,
    runId: id,
    candidates: built.candidates,
  });
  return {
    file,
    runId: id,
    url: `file://${file}`,
    shown: built.candidates.map((c) => c.id),
    missing: built.missing,
  };
}

export function writeBrief({
  project,
  runId,
  promptId,
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
  const id = runId || `run-${now}`;
  const dir = path.join(
    recordsDir(path.resolve(project || process.cwd()), env),
    "briefs",
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(id).replace(/[^\w.-]+/g, "-")}.md`);
  const attributionRequired = /CC BY/i.test(String(license || ""));
  const val = (v) => (v == null || v === "" ? "-" : String(v));
  const lines = [
    `# ${title || id}`,
    "",
    `Run: ${id}${promptId != null ? ` (prompt ${promptId})` : ""}`,
    "",
    "## Source / License",
    "",
    `- Source: ${val(source)}`,
    `- License: ${val(license)}`,
    `- Attribution required: ${attributionRequired ? "yes" : "no"}`,
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

const USAGE = `Usage: node studio.mjs <command> [options]

  access                              Show the GitHub access tier (gh / token / anonymous)
  session [--project DIR]             One-shot probe: access tier, style pack, channels (codex/grok/ffmpeg/node, key var names)
  sync [--category a,b | --all] [--force] [--allow-large]
                                      Refresh the prompt library (ETag, at most every 10 min);
                                      social-media-post and product-marketing need --allow-large
  search "<keywords>" [--category a,b] [--limit 30] [--project DIR]
                                      Rank prompts; cached library first, bundled seed offline
  recommend "<english keywords> [| more keywords]" --use cover|illustration|infographic|avatar|thumbnail|comic|product|game|app
            [--category a,b] [--limit 5] [--allow-large] [--project DIR]
                                      Sync the matching categories and return ranked candidates
  show <id...> [--category a,b]       Print prompts in full (ids space- or comma-separated)
  cover-check <files...> [--title "..."] [--size WxH] [--out DIR]
                                      Size check plus 340px / 120px-crop / title-overlay previews (needs ffmpeg)
  gallery --json '{"runId","title","request","query","candidates":[{"id","fit","model","ratio","adapted","default"}]}'
          [--project DIR] [--out FILE] [--serve [--timeout-min 30]]
                                      Write <records>/gallery/<runId>.html (sample images, editable prompt,
                                      source, license). --serve hosts it on 127.0.0.1, prints the url, waits
                                      for the user's 选这个 click and prints {pick}; run it in the background
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

  switch (command) {
    case "access":
      return out(detectAccess());
    case "session":
      return out(detectSession({ project }));
    case "sync":
      return out(
        await syncLibrary({
          categories: list(flags.category),
          all: Boolean(flags.all),
          force: Boolean(flags.force),
          allowLarge: Boolean(flags["allow-large"]),
          token: token(),
        }),
      );
    case "recommend": {
      const result = await recommend(positional.join(" "), {
        use: typeof flags.use === "string" ? flags.use : undefined,
        categories: list(flags.category),
        limit: Number(flags.limit) || 5,
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
      const result = galleryPage({
        ...fields,
        project,
        out: typeof flags.out === "string" ? flags.out : fields.out,
      });
      if (result.missing.length) {
        out(result);
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
          project: flags.project ? project : fields.project || project,
        }),
      );
    }
    case "search": {
      const categories = list(flags.category);
      if (categories.length) await syncLibrary({ categories, token: token() });
      const { origin, entries } = loadEntries({ categories });
      const results = searchEntries(entries, positional.join(" "), {
        limit: Number(flags.limit) || 30,
        ratings: loadRatings(project),
      });
      return out({ origin, total: entries.length, results });
    }
    case "show": {
      const { entries } = loadEntries({ categories: list(flags.category) });
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
          limit: Number(flags.limit) || 10,
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
      await syncLibrary({ all: true, token: token() });
      const seed = buildSeed(loadEntries({}).entries, Number(flags.per) || 5);
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
