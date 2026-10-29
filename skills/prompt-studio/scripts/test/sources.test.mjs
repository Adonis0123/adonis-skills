import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeEntry,
  modelKeyOf,
  syncSources,
  loadAllEntries,
} from "../sources.mjs";
import { load, sync } from "../adapters/json-map.mjs";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ps-sources-"));
const source = {
  id: "test",
  repo: "a/b",
  branch: "main",
  kinds: ["video"],
  adapter: "json-map",
  file: "data.json",
  itemsPath: "",
  map: { title: "title", content: "prompt" },
};
test("normalization preserves legacy ids, derives models and rejects unsafe entries", () => {
  assert.equal(
    normalizeEntry({ ...source, id: "youmind" }, { nativeId: 12, content: "x" })
      .id,
    12,
  );
  assert.equal(
    normalizeEntry(source, { nativeId: 12, content: "x" }).id,
    "test:12",
  );
  assert.equal(normalizeEntry(source, { content: "x", tags: ["NSFW"] }), null);
  assert.equal(normalizeEntry(source, { content: "" }), null);
  assert.ok(
    normalizeEntry({ ...source, kinds: ["code-video"] }, { title: "code" }),
  );
  for (const [name, key] of [
    ["MiniMax H3", "hailuo"],
    ["GPT-4o image", "gpt-image"],
    ["Gemini image", "nano-banana"],
    ["Seedance 2.0", "seedance"],
  ])
    assert.equal(modelKeyOf(name), key);
});
test("json mapping flattens sections, picks locales, filters and resolves media base", async () => {
  const dir = tmp();
  const src = {
    ...source,
    itemsPath: "sections[].prompts",
    locale: "zh",
    filter: { field: "prompt", nonEmpty: true },
    mediaBase: { fromFile: "config/site.json", path: "primaryOrigin" },
    map: {
      title: "title",
      content: "prompt",
      category: "$parent.name",
      sourceMedia: "poster",
      tags: ["tags", "$parent.name"],
    },
  };
  const files = {
    "data.json": {
      sections: [
        {
          name: "ads",
          prompts: [
            {
              title: { en: "Coffee", zh: "咖啡" },
              prompt: "make coffee",
              poster: "/a.jpg",
              tags: ["drink"],
            },
            { title: "empty", prompt: "" },
          ],
        },
      ],
    },
    "site.json": { primaryOrigin: "https://example.com" },
  };
  await sync(src, {
    dir,
    fetchCached: async (url, file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(files[url.split("/").pop()]));
      return { status: "updated" };
    },
  });
  const entries = load(src, { dir });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "咖啡");
  assert.equal(entries[0].category, "ads");
  assert.deepEqual(entries[0].sourceMedia, ["https://example.com/a.jpg"]);
  assert.deepEqual(entries[0].tags, ["drink", "ads"]);
  assert.equal(entries[0].nativeId, load(src, { dir })[0].nativeId);
});
test("sources isolate missing adapters and fetch failures and reuse parsed cache", async () => {
  const cache = tmp();
  const sources = [
    source,
    { ...source, id: "broken", file: "bad.json" },
    { ...source, id: "missing", adapter: "not-created" },
  ];
  const fetchImpl = async (url) => {
    if (url.endsWith("bad.json")) throw new Error("offline");
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () =>
        Buffer.from(JSON.stringify([{ title: "coffee", prompt: "coffee ad" }])),
    };
  };
  const out = await syncSources({ sources, cache, fetchImpl });
  assert.ok(
    out.results.some(
      (r) => r.sourceId === "missing" && r.status === "adapter-missing",
    ),
  );
  assert.ok(out.notes.some((n) => n.includes("broken")));
  const loaded = await loadAllEntries({ sources, cache, seedFile: null });
  assert.equal(loaded.entries.length, 1);
  const parsed = path.join(cache, "test", ".normalized.json");
  const stamp = fs.statSync(parsed).mtimeMs;
  await loadAllEntries({ sources, cache, seedFile: null });
  assert.equal(fs.statSync(parsed).mtimeMs, stamp);
});
test("mapping handles equality filters, scalar fallbacks, templates and NSFW", async () => {
  const dir = tmp();
  const src = {
    ...source,
    filter: { field: "mediaType", equals: "video" },
    mediaBase: "https://example.com/data/",
    mediaTemplate: "images/{slug}.png",
    langDefault: "zh",
    modeDefault: "template",
    map: {
      title: ["missing", "title"],
      content: "prompt",
      link: ["brief", "post"],
      tags: "tags",
      model: "models",
    },
  };
  const data = [
    {
      title: { fr: "café", en: "coffee" },
      slug: "cafe",
      prompt: "coffee",
      mediaType: "video",
      brief: "",
      post: "https://example.com/post",
      models: ["Seedance 2.0", "Seedance 2.5"],
    },
    { title: "NSFW", prompt: "x", mediaType: "video", tags: ["nsfw"] },
    { title: "image", prompt: "x", mediaType: "image" },
  ];
  await sync(src, {
    dir,
    fetchCached: async (_url, file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
      return { status: "updated" };
    },
  });
  const result = load(src, { dir });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "coffee");
  assert.equal(result[0].link, "https://example.com/post");
  assert.equal(result[0].model, "Seedance 2.0, Seedance 2.5");
  assert.equal(result[0].lang, "zh");
  assert.equal(result[0].mode, "template");
  assert.deepEqual(result[0].sourceMedia, [
    "https://example.com/data/images/cafe.png",
  ]);
  assert.equal(load({ ...src, locale: "de" }, { dir })[0].title, "café");
});
test("videoTemplate builds a clip URL only when the row has none", async () => {
  const dir = tmp();
  const src = {
    ...source,
    videoTemplate: "https://cdn.example.com/{slug}/original.mp4",
    map: { title: "title", content: "prompt", videos: "clip" },
  };
  const data = [
    { slug: "a b", title: "A", prompt: "x" },
    {
      slug: "c",
      title: "C",
      prompt: "y",
      clip: "https://cdn.example.com/own.mp4",
    },
  ];
  await sync(src, {
    dir,
    fetchCached: async (_url, file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
      return { status: "updated" };
    },
  });
  const [a, c] = load(src, { dir });
  assert.deepEqual(a.videos, ["https://cdn.example.com/a%20b/original.mp4"]);
  assert.deepEqual(c.videos, ["https://cdn.example.com/own.mp4"]);
});
test("YouMind skips malformed manifest rows and preserves native ids", async () => {
  const adapter = await import("../adapters/youmind-manifest.mjs");
  const dir = tmp();
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      categories: [
        null,
        { slug: "cover", file: "cover.json" },
        { slug: "bad", file: "../outside.json" },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(dir, "cover.json"),
    JSON.stringify([null, { id: 42, content: "prompt" }]),
  );
  const result = adapter.load({ id: "youmind" }, { dir });
  assert.equal(result.length, 1);
  assert.equal(result[0].nativeId, 42);
});
test("normalization enforces mode, language and HTTPS media contract", () => {
  const normalize = (partial) =>
    normalizeEntry(source, { nativeId: "x", content: "prompt", ...partial });
  const modes = {
    generate: "text-to-image",
    edit: "image-edit",
    T2VA: "text-to-video",
    Ref2VA: "image-to-video",
    FL2VA: "image-to-video",
    template: "template",
    "text-to-image": "text-to-image",
    "image-edit": "image-edit",
    "text-to-video": "text-to-video",
    "image-to-video": "image-to-video",
    Unknown: null,
  };
  for (const [mode, expected] of Object.entries(modes))
    assert.equal(normalize({ mode }).mode, expected);
  assert.equal(normalize({ lang: "zh-CN" }).lang, "zh");
  assert.equal(normalize({ lang: "en" }).lang, "en");
  assert.equal(normalize({ lang: "fr" }).lang, null);
  assert.deepEqual(
    normalize({
      sourceMedia: [
        "https://example.com/image.jpg",
        "http://example.com/a.jpg",
        "https://",
        "relative.jpg",
        "javascript:alert(1)",
      ],
      videos: ["https://example.com/video.mp4", "https://bad host/video.mp4"],
    }).sourceMedia,
    ["https://example.com/image.jpg"],
  );
  assert.deepEqual(
    normalize({
      videos: ["https://example.com/video.mp4", "https://bad host/video.mp4"],
    }).videos,
    ["https://example.com/video.mp4"],
  );
});
test("YouMind without categories refreshes only cached categories", async () => {
  const cache = tmp();
  const dir = path.join(cache, "youmind");
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    categories: [
      { slug: "cached", file: "cached.json" },
      { slug: "new", file: "new.json" },
    ],
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "cached.json"), "[]");
  const seen = [];
  const out = await syncSources({
    cache,
    sources: [{ ...source, id: "youmind", adapter: "youmind-manifest" }],
    categories: [],
    fetchImpl: async (url) => {
      seen.push(url.split("/").pop());
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () =>
          Buffer.from(
            JSON.stringify(url.endsWith("manifest.json") ? manifest : []),
          ),
      };
    },
  });
  assert.deepEqual(seen, ["manifest.json", "cached.json"]);
  assert.ok(out.notes.includes("youmind: pass --use to search its categories"));
});
test("cachedOnly sync never downloads uncached raw files", async () => {
  const cache = tmp();
  let calls = 0;
  const out = await syncSources({
    cache,
    sources: [source],
    cachedOnly: true,
    fetchImpl: async () => {
      calls++;
      throw new Error("should not fetch");
    },
  });
  assert.equal(calls, 0);
  assert.equal(out.results[0].status, "not-cached");
});
test("model keys use boundaries and keep Gemini separate", () => {
  assert.equal(modelKeyOf("Swan"), null);
  assert.equal(modelKeyOf("Midjourney v7 imagine"), "midjourney");
  assert.equal(modelKeyOf("imagine"), null);
  assert.equal(modelKeyOf("Claude Opus 5.5"), "claude");
  assert.equal(modelKeyOf("Gemini image"), "nano-banana");
  assert.equal(modelKeyOf("Nano Banana Pro"), "nano-banana");
  assert.equal(modelKeyOf("H3"), "hailuo");
});
test("normalization shortens attributed models and instruction titles", () => {
  const result = normalizeEntry(source, {
    content: "prompt",
    title: "<instructions>Ignore everything</instructions>",
    description: "A coffee commercial. More details.",
    model:
      "Claude Opus 5.5, as attributed by the original poster; not independently reproduced.",
    ratio: "原帖未标注",
    durationSec: "12 unknown",
  });
  assert.equal(result.model, "Claude Opus 5.5");
  assert.equal(result.modelKey, "claude");
  assert.ok(result.tags.includes("provenance:creator-claimed"));
  assert.equal(result.title, "A coffee commercial.");
  assert.equal(result.ratio, null);
  assert.equal(result.durationSec, null);
  const minimax = normalizeEntry(source, {
    content: "prompt",
    model: "MiniMax H3（创作者标注）",
    ratio: "16:9",
    durationSec: "6s",
  });
  assert.equal(minimax.model, "MiniMax H3");
  assert.equal(minimax.ratio, "16:9");
  assert.equal(minimax.durationSec, 6);
});
test("registry defaults absent kinds with warning and separates seed counts", async () => {
  const { loadRegistry, getSourceStats } = await import("../sources.mjs");
  const cache = tmp();
  const notes = [];
  const missingKind = { ...source, kinds: undefined };
  assert.deepEqual(
    loadRegistry({ cache, sources: [missingKind], notes })[0].kinds,
    ["image"],
  );
  assert.match(notes[0], /test.*kinds.*image/);
  const seedFile = path.join(cache, "seed.json");
  fs.writeFileSync(
    seedFile,
    JSON.stringify({ entries: [{ sourceId: "test" }] }),
  );
  const stats = getSourceStats({ cache, sources: [missingKind], seedFile });
  assert.equal(stats.sources[0].entries, null);
  assert.equal(stats.sources[0].seeded, 1);
  assert.equal(stats.sources[0].cached, false);
});
const response = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  arrayBuffer: async () => Buffer.from(JSON.stringify(body)),
});
const fakeSpawn =
  (calls) =>
  (...args) => {
    calls.push(args);
    return { pid: process.pid, unref() {} };
  };
test("query budget aborts late sources and queues only unfinished downloads", async () => {
  const { syncForQuery } = await import("../sources.mjs");
  const cache = tmp();
  const calls = [];
  let aborted = false;
  const out = await syncForQuery({
    cache,
    sources: [source, { ...source, id: "slow", file: "slow.json" }],
    waitSec: 0.01,
    spawnImpl: fakeSpawn(calls),
    fetchImpl: async (url, { signal }) => {
      if (!url.endsWith("slow.json"))
        return response([{ title: "coffee", prompt: "ad" }]);
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("aborted"));
          },
          { once: true },
        ),
      );
    },
  });
  assert.equal(aborted, true);
  assert.deepEqual(out.pending, ["slow"]);
  assert.deepEqual(out.downloading, ["slow"]);
  assert.deepEqual(out.refreshing, []);
  assert.equal(calls.length, 1);
  assert.ok(
    out.notes.includes("1 sources still downloading in the background"),
  );
  assert.ok(
    out.results.some(
      (result) => result.sourceId === "test" && result.status === "updated",
    ),
  );
  assert.ok(calls[0][1].includes("slow"));
  assert.equal(calls[0][2].detached, true);
  assert.equal(calls[0][2].stdio, "ignore");
});
test("stale usable cache returns without fetching and concurrent requests queue under one lock", async () => {
  const { syncForQuery, runBackgroundSync } = await import("../sources.mjs");
  const cache = tmp();
  const sources = [source, { ...source, id: "second" }].map((src) => ({
    ...src,
    map: { ...src.map, sourceMedia: "image" },
  }));
  for (const src of sources) {
    const file = path.join(cache, src.id, "raw", "data.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify([
        { title: "coffee", prompt: "ad", image: "https://example.com/a.jpg" },
      ]),
    );
  }
  await loadAllEntries({ sources, cache });
  const calls = [];
  let fetches = 0;
  const fetchImpl = async () => {
    fetches++;
    return response([
      { title: "fresh", prompt: "ad", image: "https://example.com/a.jpg" },
    ]);
  };
  const opts = { cache, sources, fetchImpl, spawnImpl: fakeSpawn(calls) };
  const out = await syncForQuery({ ...opts, sourceIds: ["test"] });
  await syncForQuery({ ...opts, sourceIds: ["second"] });
  assert.deepEqual(out.pending, ["test"]);
  assert.deepEqual(out.refreshing, ["test"]);
  assert.deepEqual(out.downloading, []);
  assert.ok(!out.notes.join(" ").includes("rerun"));
  assert.equal(fetches, 0);
  assert.equal(calls.length, 1);
  const args = calls[0][1];
  const lockFile = args[args.indexOf("--background-lock") + 1];
  const lockToken = args[args.indexOf("--background-token") + 1];
  await runBackgroundSync(
    { cache, sources, fetchImpl },
    { lockFile, lockToken },
  );
  assert.equal(fetches, 2);
  assert.equal(fs.existsSync(lockFile), false);
  const loaded = await loadAllEntries({ sources, cache });
  assert.deepEqual(
    loaded.entries.map((entry) => entry.title),
    ["fresh", "fresh"],
  );
});
test("background locks recover dead owners and clean up failed spawns", async () => {
  const { queueBackgroundSync } = await import("../sources.mjs");
  const cache = tmp();
  const lockFile = path.join(cache, ".background-sync.json");
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999999, token: "old" }));
  const calls = [];
  const out = queueBackgroundSync(["test"], {
    cache,
    spawnImpl: fakeSpawn(calls),
    isProcessAlive: () => false,
  });
  assert.equal(out.status, "started");
  assert.equal(calls.length, 1);
  assert.notEqual(JSON.parse(fs.readFileSync(lockFile, "utf8")).token, "old");
  fs.unlinkSync(lockFile);
  const fail = queueBackgroundSync(["test"], {
    cache,
    spawnImpl: () => {
      throw new Error("spawn failed");
    },
  });
  assert.equal(fail.status, "failed");
  assert.equal(fs.existsSync(lockFile), false);
});
test("fast query sync finishes without background and uses configured budget", async () => {
  const { syncForQuery } = await import("../sources.mjs");
  const calls = [];
  const out = await syncForQuery({
    cache: tmp(),
    sources: [source],
    env: { PROMPT_STUDIO_SYNC_BUDGET_SEC: "0.05" },
    spawnImpl: fakeSpawn(calls),
    fetchImpl: async () => response([{ title: "coffee", prompt: "ad" }]),
  });
  assert.deepEqual(out.pending, []);
  assert.equal(calls.length, 0);
});
test("usable raw cache is parsed before deciding whether to wait", async () => {
  const { syncForQuery } = await import("../sources.mjs");
  const cache = tmp();
  const src = { ...source, map: { ...source.map, sourceMedia: "image" } };
  const file = path.join(cache, src.id, "raw", src.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify([
      { title: "coffee", prompt: "ad", image: "https://example.com/a.jpg" },
    ]),
  );
  const calls = [];
  let fetched = false;
  const out = await syncForQuery({
    cache,
    sources: [src],
    spawnImpl: fakeSpawn(calls),
    fetchImpl: async () => {
      fetched = true;
      return response([]);
    },
  });
  assert.equal(fetched, false);
  assert.deepEqual(out.pending, [src.id]);
  assert.equal(calls.length, 1);
});
test("missing requested categories download within the foreground budget", async () => {
  const { syncForQuery } = await import("../sources.mjs");
  const cache = tmp();
  const src = { ...source, id: "youmind", adapter: "youmind-manifest" };
  const manifest = {
    categories: [
      { slug: "poster-flyer", file: "poster.json" },
      { slug: "social-media-post", file: "social.json" },
    ],
  };
  const opts = {
    cache,
    sources: [src],
    categories: ["poster-flyer", "social-media-post"],
    fetchImpl: async (url) =>
      response(
        url.endsWith("manifest.json")
          ? manifest
          : [
              {
                id: 1,
                title: "poster",
                content: "ad",
                sourceMedia: ["https://example.com/a.jpg"],
              },
            ],
      ),
  };
  await syncSources(opts);
  await loadAllEntries(opts);
  const calls = [];
  const first = await syncForQuery({ ...opts, spawnImpl: fakeSpawn(calls) });
  assert.ok(first.notes.includes("youmind/social-media-post: skipped-large"));
  assert.equal(calls.length, 0);
  const expanded = await syncForQuery({
    ...opts,
    allowLarge: true,
    spawnImpl: fakeSpawn(calls),
  });
  assert.deepEqual(expanded.pending, []);
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(path.join(cache, "youmind", "social.json")));
  assert.ok(
    expanded.results.some(
      (result) =>
        result.url?.endsWith("social.json") && result.status === "updated",
    ),
  );
});
test("expired recovery directories do not block a dead background lock", async () => {
  const { queueBackgroundSync } = await import("../sources.mjs");
  const cache = tmp();
  const lockFile = path.join(cache, ".background-sync.json");
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999999, token: "dead" }));
  fs.mkdirSync(`${lockFile}.recover`);
  fs.utimesSync(`${lockFile}.recover`, new Date(0), new Date(0));
  const calls = [];
  const out = queueBackgroundSync(["test"], {
    cache,
    spawnImpl: fakeSpawn(calls),
    isProcessAlive: () => false,
  });
  assert.equal(out.status, "started");
  assert.equal(calls.length, 1);
  assert.equal(fs.existsSync(`${lockFile}.recover`), false);
});
test("background startup retries when the previous owner removes its lock during inspection", async (t) => {
  const { queueBackgroundSync } = await import("../sources.mjs");
  const cache = tmp();
  const lockFile = path.join(cache, ".background-sync.json");
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999999, token: "old" }));
  const readFileSync = fs.readFileSync;
  let removed = false;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (file === lockFile && !removed) {
      removed = true;
      fs.unlinkSync(lockFile);
    }
    return readFileSync(file, ...args);
  });
  const calls = [];
  const out = queueBackgroundSync(["test"], {
    cache,
    spawnImpl: fakeSpawn(calls),
  });
  assert.equal(out.status, "started");
  assert.equal(calls.length, 1);
});
test("corrupt parsed cache rebuilds from unchanged raw data", async () => {
  const cache = tmp();
  await syncSources({
    sources: [source],
    cache,
    fetchImpl: async () => response([{ title: "coffee", prompt: "ad" }]),
  });
  await loadAllEntries({ sources: [source], cache, seedFile: null });
  fs.writeFileSync(path.join(cache, source.id, ".normalized.json"), "[");
  const out = await loadAllEntries({
    sources: [source],
    cache,
    seedFile: null,
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].title, "coffee");
  assert.doesNotThrow(() =>
    JSON.parse(
      fs.readFileSync(path.join(cache, source.id, ".normalized.json"), "utf8"),
    ),
  );
});

const entries = [
  { id: "a:1", model: "Seedance 2.5", modelKey: "seedance" },
  { id: "a:2", model: "MiniMax H3", modelKey: "hailuo" },
  { id: "a:3", model: null, modelKey: null },
];
test("withTarget: copies top-level target fields and flags other-model samples", async () => {
  const { withTarget } = await import("../studio.mjs");
  const out = withTarget(
    [{ id: "a:1" }, { id: "a:2" }, { id: "a:3" }],
    entries,
    { targetModel: "Seedance", targetDurationSec: 6 },
  );
  assert.equal(out[0].targetDurationSec, 6);
  assert.equal(out[0].modelMismatch, false);
  assert.equal(out[1].modelMismatch, "Seedance");
  // Unknown sample model: no claim either way.
  assert.equal(out[2].modelMismatch, false);
});
test("withTarget: lets a candidate override the top-level values", async () => {
  const { withTarget } = await import("../studio.mjs");
  const [c] = withTarget(
    [{ id: "a:2", modelMismatch: false, targetDurationSec: 10 }],
    entries,
    { targetModel: "Seedance", targetDurationSec: 6 },
  );
  assert.equal(c.modelMismatch, "Seedance");
  assert.equal(c.targetDurationSec, 10);
});
test("withTarget: adds nothing without a target", async () => {
  const { withTarget } = await import("../studio.mjs");
  const [c] = withTarget([{ id: "a:2" }], entries, {});
  assert.equal(c.id, "a:2");
  assert.equal(c.modelMatch, "unknown");
  assert.equal(c.modelMismatch, false);
});

test("multiple model keys follow textual order and normalize legacy seeds", async () => {
  const { modelKeysOf } = await import("../sources.mjs");
  assert.deepEqual(modelKeysOf("MiniMax H3 · ComfyUI / Seedance 2.5"), [
    "hailuo",
    "seedance",
  ]);
  assert.deepEqual(modelKeysOf("Kling 3.0, then Seedance and Kling"), [
    "kling",
    "seedance",
  ]);
  assert.deepEqual(modelKeysOf("Swan and imagine"), []);
  assert.equal(modelKeyOf("MiniMax H3 and Seedance"), "hailuo");
  assert.deepEqual(
    normalizeEntry(source, { content: "ad", model: "MiniMax H3 and Seedance" })
      .modelKeys,
    ["hailuo", "seedance"],
  );
  const cache = tmp();
  const seedFile = path.join(cache, "legacy-seed.json");
  fs.writeFileSync(
    seedFile,
    JSON.stringify({
      entries: [
        {
          id: "test:old",
          sourceId: "test",
          kind: "video",
          content: "ad",
          model: "MiniMax H3 and Seedance",
          modelKey: "seedance",
        },
      ],
    }),
  );
  const loaded = await loadAllEntries({ cache, sources: [source], seedFile });
  assert.deepEqual(loaded.entries[0].modelKeys, ["hailuo", "seedance"]);
  assert.equal(loaded.entries[0].modelKey, "hailuo");
  assert.equal(loaded.entries[0].id, "test:old");
});
test("offline stale refresh is backed off for ten minutes and success clears it", async () => {
  const { syncForQuery, runBackgroundSync } = await import("../sources.mjs");
  const cache = tmp();
  const src = { ...source, map: { ...source.map, sourceMedia: "image" } };
  const successful = async () =>
    response([
      { title: "coffee", prompt: "ad", image: "https://example.com/a.jpg" },
    ]);
  const interval = 10 * 60 * 1000;
  await syncSources({ cache, sources: [src], now: 0, fetchImpl: successful });
  const calls = [];
  const options = {
    cache,
    sources: [src],
    now: interval + 1,
    fetchImpl: async () => {
      throw new Error("offline");
    },
    spawnImpl: fakeSpawn(calls),
  };
  const first = await syncForQuery(options);
  assert.equal(calls.length, 1);
  assert.ok(first.notes.some((note) => /refreshing.*background/.test(note)));
  assert.ok(!first.notes.some((note) => /still downloading/.test(note)));
  const args = calls[0][1];
  await runBackgroundSync(options, {
    lockFile: args[args.indexOf("--background-lock") + 1],
    lockToken: args[args.indexOf("--background-token") + 1],
  });
  const refreshFile = path.join(cache, src.id, "refresh-state.json");
  const state = JSON.parse(fs.readFileSync(refreshFile, "utf8"));
  assert.equal(state.lastAttemptAt, interval + 1);
  assert.equal(state.outcome, "offline");
  const parsedFile = path.join(cache, src.id, ".normalized.json");
  const parsedStamp = fs.statSync(parsedFile).mtimeMs;
  const second = await syncForQuery({ ...options, now: interval + 2 });
  assert.deepEqual(second.pending, []);
  assert.equal(calls.length, 1);
  assert.ok(
    second.notes.some((note) => /offline.*could not refresh/.test(note)),
  );
  assert.equal(fs.statSync(parsedFile).mtimeMs, parsedStamp);
  const later = await syncForQuery({ ...options, now: interval * 2 + 2 });
  assert.deepEqual(later.pending, [src.id]);
  assert.equal(calls.length, 2);
  const next = calls[1][1];
  await runBackgroundSync(
    { ...options, now: interval * 2 + 2, fetchImpl: successful },
    {
      lockFile: next[next.indexOf("--background-lock") + 1],
      lockToken: next[next.indexOf("--background-token") + 1],
    },
  );
  assert.equal(
    JSON.parse(fs.readFileSync(refreshFile, "utf8")).outcome,
    "success",
  );
  const fresh = await syncForQuery({ ...options, now: interval * 2 + 3 });
  assert.deepEqual(fresh.pending, []);
  assert.equal(calls.length, 2);
});
test("late foreground abort cannot overwrite a newer successful attempt", async () => {
  const cache = tmp();
  const controller = new AbortController();
  let release;
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const old = syncSources({
    cache,
    sources: [source],
    now: 1,
    signal: controller.signal,
    fetchImpl: async () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await startedPromise;
  controller.abort();
  await syncSources({
    cache,
    sources: [source],
    now: 2,
    fetchImpl: async () => response([{ title: "new", prompt: "ad" }]),
  });
  release(response([{ title: "old", prompt: "ad" }]));
  await old;
  const state = JSON.parse(
    fs.readFileSync(path.join(cache, source.id, "refresh-state.json"), "utf8"),
  );
  assert.equal(state.lastAttemptAt, 2);
  assert.equal(state.outcome, "success");
});
test("background lock remains held after fifteen minutes while its PID is alive", async () => {
  const { queueBackgroundSync } = await import("../sources.mjs");
  const cache = tmp();
  const lockFile = path.join(cache, ".background-sync.json");
  fs.writeFileSync(
    lockFile,
    JSON.stringify({
      pid: process.pid,
      token: "reused-pid",
      startedAt: Date.now() - 16 * 60 * 1000,
    }),
  );
  const calls = [];
  const out = queueBackgroundSync(["test"], {
    cache,
    spawnImpl: fakeSpawn(calls),
    isProcessAlive: () => true,
  });
  assert.equal(out.status, "queued");
  assert.equal(calls.length, 0);
});

test("a newly requested YouMind category can retry within another category's failure window", async () => {
  const { syncForQuery } = await import("../sources.mjs");
  const cache = tmp();
  const src = { ...source, id: "youmind", adapter: "youmind-manifest" };
  const manifest = {
    categories: [
      { slug: "youtube-thumbnail", file: "thumbnail.json" },
      { slug: "poster-flyer", file: "poster.json" },
    ],
  };
  const fetchImpl = async (url) =>
    response(
      url.endsWith("manifest.json")
        ? manifest
        : [
            {
              id: url.endsWith("poster.json") ? 2 : 1,
              title: "coffee",
              content: "ad",
              sourceMedia: ["https://example.com/a.jpg"],
            },
          ],
    );
  await syncSources({
    cache,
    sources: [src],
    categories: ["youtube-thumbnail"],
    now: 0,
    fetchImpl,
  });
  await syncSources({
    cache,
    sources: [src],
    categories: ["youtube-thumbnail"],
    now: 600001,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  const calls = [];
  const out = await syncForQuery({
    cache,
    sources: [src],
    categories: ["youtube-thumbnail", "poster-flyer"],
    now: 600002,
    fetchImpl,
    spawnImpl: fakeSpawn(calls),
  });
  assert.deepEqual(out.pending, []);
  assert.equal(calls.length, 0);
  assert.ok(fs.existsSync(path.join(cache, src.id, "poster.json")));
  assert.ok(
    out.results.some(
      (result) =>
        result.url?.endsWith("poster.json") && result.status === "updated",
    ),
  );
});
test("aborted attempts do not trigger the failure backoff", async () => {
  const { syncForQuery } = await import("../sources.mjs");
  const cache = tmp();
  const controller = new AbortController();
  controller.abort();
  await syncSources({
    cache,
    sources: [source],
    now: 1,
    signal: controller.signal,
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });
  const state = JSON.parse(
    fs.readFileSync(path.join(cache, source.id, "refresh-state.json"), "utf8"),
  );
  assert.equal(state.outcome, "aborted");
  const calls = [];
  let fetched = 0;
  const out = await syncForQuery({
    cache,
    sources: [source],
    now: 2,
    spawnImpl: fakeSpawn(calls),
    fetchImpl: async () => {
      fetched++;
      return response([{ title: "coffee", prompt: "ad" }]);
    },
  });
  assert.equal(fetched, 1);
  assert.equal(calls.length, 0);
  assert.deepEqual(out.pending, []);
});

test("refresh-state write failures stay isolated to their source", async () => {
  const cache = tmp();
  fs.writeFileSync(path.join(cache, "blocked"), "not a directory");
  const out = await syncSources({
    cache,
    sources: [{ ...source, id: "blocked" }, source],
    fetchImpl: async () => response([{ title: "coffee", prompt: "ad" }]),
  });
  assert.ok(
    out.results.some(
      (result) =>
        result.sourceId === "blocked" && result.status === "source-error",
    ),
  );
  assert.ok(
    out.results.some(
      (result) => result.sourceId === source.id && result.status === "updated",
    ),
  );
  assert.ok(out.notes.some((note) => /blocked.*(?:EEXIST|ENOTDIR)/.test(note)));
});

test("failed refresh-state updates do not rethrow from source error handling", async (t) => {
  const cache = tmp();
  const blockedState = path.join(cache, "blocked", "refresh-state.json");
  const renameSync = fs.renameSync;
  let stateWrites = 0;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === blockedState && stateWrites++ > 0) {
      throw Object.assign(new Error("refresh state became read-only"), {
        code: "EACCES",
      });
    }
    return renameSync(from, to);
  });
  const out = await syncSources({
    cache,
    sources: [{ ...source, id: "blocked" }, source],
    fetchImpl: async () => response([{ title: "coffee", prompt: "ad" }]),
  });
  assert.ok(
    out.results.some(
      (result) =>
        result.sourceId === "blocked" &&
        result.status === "source-error" &&
        result.error === "refresh state became read-only",
    ),
  );
  assert.ok(
    out.results.some(
      (result) => result.sourceId === source.id && result.status === "updated",
    ),
  );
});

test("C2 detects distinct reference slots across full content", () => {
  for (const [content, expected] of [
    ["[Character Lock] Image 1/2/3. Image 1 stays still", 3],
    ["@Image1 and <IMAGE_1> plus @Video1", 2],
    ["x".repeat(700) + " reference image", 1],
    ["使用上传的图和参考图", 1],
    ["Upload the finished video to a website", 0],
    ["A cinematic image of a forest", 0],
  ]) {
    const entry = normalizeEntry(source, { content });
    assert.equal(entry.referenceInputs, expected, content);
    assert.equal(entry.needReferenceImages, expected > 0);
    assert.equal(Boolean(entry.referenceNote), expected > 0);
  }
});

test("C2 Hyperframes rewrites block media, drops components and keeps posters", () => {
  const src = JSON.parse(
    fs.readFileSync(new URL("../../assets/sources.json", import.meta.url)),
  ).sources.find((s) => s.id === "hyperframes-catalog");
  const dir = tmp();
  const file = path.join(dir, "raw", src.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const base = "https://static.heygen.ai/hyperframes-oss/docs/images/";
  const rows = [
    "catalog/blocks/data-chart.png",
    "catalog/components/count-up.png",
    "templates/promoted/demo/poster.jpg",
  ].map((p, i) => ({ name: String(i), title: "Chart", preview: base + p }));
  fs.writeFileSync(file, JSON.stringify(rows));
  const entries = load({ ...src, itemsPath: "" }, { dir }).map((e) =>
    normalizeEntry(src, e),
  );
  assert.deepEqual(
    entries.map((e) => e.mediaState),
    ["video", "none", "image"],
  );
  assert.deepEqual(entries[0].videos, [base + "catalog/blocks/data-chart.mp4"]);
  assert.deepEqual(entries[0].sourceMedia, []);
  assert.deepEqual(entries[1].sourceMedia, []);
});

test("C2 an stale heartbeat permits recovery even with a reused live PID", async () => {
  const { queueBackgroundSync } = await import("../sources.mjs");
  const cache = tmp();
  const lock = path.join(cache, ".background-sync.json");
  fs.writeFileSync(
    lock,
    JSON.stringify({ token: "live", pid: process.pid, startedAt: 0 }),
  );
  fs.utimesSync(lock, new Date(0), new Date(0));
  const calls = [];
  const out = queueBackgroundSync([source.id], {
    cache,
    spawnImpl: fakeSpawn(calls),
  });
  assert.equal(out.status, "started");
  assert.equal(calls.length, 1);
});

test("C2 background child renews its lock every minute and clears its timer", async () => {
  const { queueBackgroundSync, runBackgroundSync } =
    await import("../sources.mjs");
  const cache = tmp(),
    calls = [];
  const queued = queueBackgroundSync([source.id], {
    cache,
    spawnImpl: fakeSpawn(calls),
  });
  const owner = JSON.parse(fs.readFileSync(queued.lockFile));
  let tick,
    cleared = false;
  await runBackgroundSync(
    {
      cache,
      sources: [source],
      setIntervalImpl(fn, ms) {
        assert.equal(ms, 60000);
        tick = fn;
        return 123;
      },
      clearIntervalImpl(id) {
        assert.equal(id, 123);
        cleared = true;
      },
      fetchImpl: async () => {
        fs.utimesSync(queued.lockFile, new Date(0), new Date(0));
        tick();
        assert.ok(fs.statSync(queued.lockFile).mtimeMs > Date.now() - 1000);
        return response([{ title: "test", prompt: "content" }]);
      },
    },
    { lockFile: queued.lockFile, lockToken: owner.token },
  );
  assert.equal(cleared, true);
  assert.equal(fs.existsSync(queued.lockFile), false);
});

test("R2 unknown media stays present until a probe confirms it is dead", () => {
  const src = JSON.parse(
    fs.readFileSync(new URL("../../assets/sources.json", import.meta.url)),
  ).sources.find((s) => s.id === "hyperframes-catalog");
  const dir = tmp(),
    file = path.join(dir, "raw", src.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify([
      {
        name: "bar-chart-race",
        preview:
          "https://static.heygen.ai/hyperframes-oss/docs/images/catalog/blocks/bar-chart-race.png",
      },
    ]),
  );
  const [entry] = load({ ...src, itemsPath: "" }, { dir }).map((e) =>
    normalizeEntry(src, e),
  );
  assert.equal(entry.mediaState, "video");
  assert.equal(entry.videos.length, 1);
  assert.deepEqual(entry.sourceMedia, []);
});

test("R2 references require positive input context", () => {
  for (const content of [
    "Designed with GPT Image 2",
    "GPT-Image2",
    "Skywork Video 1",
    "Created a video 30 seconds",
    "16:9, video 9:16 vertical crop",
    "Shot 1: image 1 of the storyboard",
    "A vlogger says: upload a video every day",
    "A detective pins attached photos to a corkboard",
    "No reference image.",
    "without a reference image",
    "不需要参考图",
    "无需上传的图",
  ])
    assert.equal(
      normalizeEntry(source, { content }).referenceInputs,
      0,
      content,
    );
  for (const content of [
    "@Image1",
    "<IMAGE_1>",
    "Image 1: character portrait",
    "[Reference]\nImage 1 and Image 2",
    "Upload a photo",
    "reference image",
    "参考图",
  ])
    assert.ok(normalizeEntry(source, { content }).referenceInputs > 0, content);
  assert.equal(
    normalizeEntry(source, {
      content: "GPT Image 2",
      needReferenceImages: true,
    }).referenceInputs,
    0,
  );
});

test("R2 normalized cache cannot overwrite an adapter entries.json", async () => {
  const { getSourceStats } = await import("../sources.mjs");
  const cache = tmp(),
    dir = path.join(cache, source.id),
    raw = path.join(dir, "entries.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(raw, JSON.stringify([{ nativeId: 1, content: "original" }]));
  const adapter = {
    load: () => JSON.parse(fs.readFileSync(raw)),
    sync: async () => {
      fs.writeFileSync(
        raw,
        JSON.stringify([{ nativeId: 1, content: "original" }]),
      );
      return { results: [] };
    },
  };
  const opts = {
    cache,
    sources: [source],
    adapterImpl: adapter,
    seedFile: null,
  };
  assert.equal(getSourceStats(opts).sources[0].entries, null);
  assert.match(getSourceStats(opts).sources[0].note, /not indexed yet/);
  await syncSources(opts);
  const first = await loadAllEntries(opts);
  assert.equal(first.entries[0].content, "original");
  assert.equal(JSON.parse(fs.readFileSync(raw))[0].id, undefined);
  assert.ok(fs.existsSync(path.join(dir, ".normalized.json")));
  fs.writeFileSync(
    raw,
    JSON.stringify([{ nativeId: 1, content: "changed raw content" }]),
  );
  assert.equal(
    (await loadAllEntries(opts)).entries[0].content,
    "changed raw content",
  );
  assert.equal(getSourceStats(opts).sources[0].entries, 1);
});

test("R2 invalid rewrite regex is reported without discarding source rows", async () => {
  const cache = tmp(),
    src = {
      ...source,
      rewrite: [{ field: "preview", match: "[", to: "drop" }],
    };
  const file = path.join(cache, src.id, "raw", src.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([{ prompt: "hello" }]));
  const out = await loadAllEntries({ cache, sources: [src], seedFile: null });
  assert.equal(out.entries.length, 1);
  assert.ok(out.notes.includes("source test: invalid rewrite regex"));
  assert.ok(
    (
      await loadAllEntries({ cache, sources: [src], seedFile: null })
    ).notes.includes("source test: invalid rewrite regex"),
  );
});

test("R2 probes rewritten media only on raw changes and keeps media when offline", async () => {
  const dir = tmp();
  const src = {
    ...source,
    probeMedia: true,
    map: { ...source.map, sourceMedia: "preview" },
    rewrite: [
      {
        field: "preview",
        match: "\\.png$",
        replace: ["\\.png$", ".mp4"],
        to: "videos",
      },
    ],
  };
  let revision = 1,
    calls = 0,
    offline = false,
    recovered = false;
  const ctx = {
    dir,
    fetchCached: async (_url, file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify([
          {
            title: String(revision),
            prompt: "data",
            preview: "https://e.org/dead.png",
          },
          { prompt: "live", preview: "https://e.org/live.png" },
        ]),
      );
      return { status: "updated" };
    },
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(init.method, "HEAD");
      if (offline) throw Error("offline");
      return { status: url.includes("dead") && !recovered ? 403 : 200 };
    },
  };
  await sync(src, ctx);
  assert.equal(calls, 2);
  assert.deepEqual(load(src, ctx)[0].videos, []);
  assert.equal(load(src, ctx)[1].videos.length, 1);
  await sync(src, ctx);
  assert.equal(calls, 2);
  revision++;
  recovered = true;
  await sync(src, ctx);
  assert.equal(load(src, ctx)[0].videos.length, 1);
  revision++;
  offline = true;
  const out = await sync(src, ctx);
  assert.equal(load(src, ctx)[0].videos.length, 1);
  assert.ok(
    out.notes.some((n) => n.includes("preserving confirmed dead URLs")),
  );
});

test("R2 media probe caps concurrency at eight and URLs at 600", async () => {
  const dir = tmp(),
    src = {
      ...source,
      probeMedia: true,
      map: { ...source.map, videos: "video" },
    };
  let active = 0,
    peak = 0,
    count = 0;
  await sync(src, {
    dir,
    fetchCached: async (_url, file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify(
          Array.from({ length: 605 }, (_, i) => ({
            prompt: String(i),
            video: `https://e.org/${i}.mp4`,
          })),
        ),
      );
      return { status: "updated" };
    },
    fetchImpl: async () => {
      count++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return { status: 200 };
    },
  });
  assert.equal(count, 600);
  assert.equal(peak, 8);
});

test("R2 media timeout keeps all URLs and completes", async () => {
  const dir = tmp(),
    src = {
      ...source,
      probeMedia: true,
      map: { ...source.map, videos: "video" },
    };
  let signal;
  await sync(src, {
    dir,
    probeTimeoutMs: 5,
    fetchCached: async (_url, file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify([{ prompt: "x", video: "https://e.org/a.mp4" }]),
      );
      return { status: "updated" };
    },
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    },
  });
  assert.equal(signal.aborted, true);
  assert.equal(load(src, { dir })[0].videos.length, 1);
});

test("R2 timed-out background request releases the lock", async () => {
  const { queueBackgroundSync, runBackgroundSync } =
    await import("../sources.mjs");
  const cache = tmp(),
    calls = [];
  const queued = queueBackgroundSync([source.id], {
    cache,
    spawnImpl: fakeSpawn(calls),
  });
  const owner = JSON.parse(fs.readFileSync(queued.lockFile));
  const out = await runBackgroundSync(
    {
      cache,
      sources: [source],
      requestTimeoutMs: 5,
      fetchImpl: async () => new Promise(() => {}),
    },
    { lockFile: queued.lockFile, lockToken: owner.token },
  );
  assert.ok(out.results.some((r) => /timeout/.test(r.status)));
  assert.equal(fs.existsSync(queued.lockFile), false);
});

test("R2 fresh heartbeat wins over old content timestamp but dead PID is stale", async () => {
  const { queueBackgroundSync } = await import("../sources.mjs");
  for (const alive of [true, false]) {
    const cache = tmp(),
      calls = [],
      lock = path.join(cache, ".background-sync.json");
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, token: "old", startedAt: 0 }),
    );
    const out = queueBackgroundSync([source.id], {
      cache,
      isProcessAlive: () => alive,
      spawnImpl: fakeSpawn(calls),
    });
    assert.equal(out.status, alive ? "queued" : "started");
  }
});

test("R3 contextual references and untrusted library flags", () => {
  for (const [content, count] of [
    ["Use image1 as the exact hero identity", 1],
    ["Person from Image1", 1],
    ["Create a portrait based on the uploaded selfie", 1],
    ["the woman in image 2", 1],
    ["[ASSETS] Use Image 1 as the exact opening frame", 1],
    ["@图1 and @Image1", 1],
    ["Image 1: the woman. Image 2: the dog.", 2],
    ["Image 1: … Image 2: …", 2],
    ["Do not use Image1 as the identity", 0],
    ["without using Image1", 0],
  ])
    assert.equal(
      normalizeEntry(source, { content }).referenceInputs,
      count,
      content,
    );
  const e = normalizeEntry(source, {
    content: "A forest scene",
    needReferenceImages: true,
  });
  assert.equal(e.referenceInputs, 0);
  assert.equal(e.referenceNote, null);
  assert.equal(e.needReferenceImages, false);
  assert.equal(e.referenceHint, true);
});

test("R3 only a source referenceField trusts the explicit input array", () => {
  const dir = tmp(),
    file = path.join(dir, "raw", source.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify([{ prompt: "forest", refs: ["a", "b"] }]),
  );
  const src = {
    ...source,
    referenceField: "refs",
    map: { ...source.map, needReferenceImages: "refs" },
  };
  const e = normalizeEntry(src, load(src, { dir })[0]);
  assert.equal(e.referenceInputs, 2);
  const untrusted = { ...src, referenceField: undefined };
  assert.equal(
    normalizeEntry(untrusted, load(untrusted, { dir })[0]).referenceInputs,
    0,
  );
});

test("R3 cold query never probes foreground media and queues background work", async () => {
  const { syncForQuery } = await import("../sources.mjs");
  const cache = tmp(),
    calls = [];
  let heads = 0;
  const src = {
    ...source,
    probeMedia: true,
    map: { ...source.map, videos: "video" },
  };
  const out = await syncForQuery({
    cache,
    sources: [src],
    waitSec: 1,
    spawnImpl: fakeSpawn(calls),
    fetchImpl: async (_url, init) => {
      if (init.method === "HEAD") {
        heads++;
        return { status: 403 };
      }
      return response([{ prompt: "coffee", video: "https://e.org/a.mp4" }]);
    },
  });
  assert.equal(heads, 0);
  assert.equal(calls.length, 1);
  assert.ok(out.refreshing.includes(src.id));
  assert.equal(
    (await loadAllEntries({ cache, sources: [src] })).entries[0].mediaState,
    "video",
  );
});

test("R3 migration only deletes proven legacy core caches", async () => {
  for (const legacy of [true, false]) {
    const cache = tmp(),
      dir = path.join(cache, source.id);
    fs.mkdirSync(dir, { recursive: true });
    const raw = path.join(dir, "entries.json");
    fs.writeFileSync(raw, JSON.stringify([{ nativeId: 1, content: "raw" }]));
    if (legacy)
      fs.writeFileSync(
        path.join(dir, "entries-meta.json"),
        JSON.stringify({
          signature: `3:${JSON.stringify(source)}raw/data.json:20:1234`,
        }),
      );
    else fs.writeFileSync(path.join(dir, "ref.json"), "{}");
    const adapter = { load: () => [] };
    await loadAllEntries({
      cache,
      sources: [source],
      adapterImpl: adapter,
      seedFile: null,
    });
    assert.equal(fs.existsSync(raw), !legacy);
    assert.equal(fs.existsSync(path.join(dir, "entries-meta.json")), false);
  }
});

test("R3 partial probes preserve old and new dead URLs and retry only unresolved URLs", async () => {
  const dir = tmp(),
    src = {
      ...source,
      probeMedia: true,
      map: { ...source.map, videos: "video" },
    };
  let revision = 1,
    phase = 0;
  const calls = [];
  const ctx = {
    dir,
    fetchCached: async (_url, file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify(
          ["old", "new", "flaky", "live"].map((name) => ({
            prompt: `${name} ${revision}`,
            video: `https://e.org/${name}.mp4`,
          })),
        ),
      );
      return { status: "updated" };
    },
    fetchImpl: async (url) => {
      const name = url.split("/").pop().split(".")[0];
      calls.push(name);
      if (phase === 0) return { status: name === "old" ? 403 : 200 };
      if (phase === 1) {
        if (name === "old") throw Error("offline");
        return { status: name === "new" ? 404 : name === "flaky" ? 503 : 200 };
      }
      return { status: 200 };
    },
  };
  await sync(src, ctx);
  revision++;
  phase = 1;
  calls.length = 0;
  await sync(src, ctx);
  const probe = JSON.parse(fs.readFileSync(path.join(dir, "media-probe.json")));
  assert.deepEqual(
    new Set(probe.dead),
    new Set(["https://e.org/old.mp4", "https://e.org/new.mp4"]),
  );
  assert.deepEqual(
    new Set(probe.pending),
    new Set(["https://e.org/old.mp4", "https://e.org/flaky.mp4"]),
  );
  assert.equal(load(src, ctx).filter((e) => !e.videos.length).length, 2);
  phase = 2;
  calls.length = 0;
  await sync(src, ctx);
  assert.deepEqual(new Set(calls), new Set(["old", "flaky"]));
  const final = JSON.parse(fs.readFileSync(path.join(dir, "media-probe.json")));
  assert.deepEqual(final.dead, ["https://e.org/new.mp4"]);
  assert.deepEqual(final.pending, []);
});

test("R3 load uses the last stored dead list even when raw content changes", async () => {
  const dir = tmp(),
    src = {
      ...source,
      probeMedia: true,
      map: { ...source.map, videos: "video" },
    };
  const file = path.join(dir, "raw", src.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify([{ prompt: "new raw", video: "https://e.org/dead.mp4" }]),
  );
  fs.writeFileSync(
    path.join(dir, "media-probe.json"),
    JSON.stringify({ signature: "old", dead: ["https://e.org/dead.mp4"] }),
  );
  assert.deepEqual(load(src, { dir })[0].videos, []);
});

test("R3 migration preserves unknown metadata and adapter-owned raw caches", async () => {
  for (const signature of [
    "unknown",
    '3:{"id":"other","repo":"a/b","adapter":"json-map"}raw',
  ]) {
    const cache = tmp(),
      dir = path.join(cache, source.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "entries.json"), "[]");
    fs.writeFileSync(
      path.join(dir, "entries-meta.json"),
      JSON.stringify({ signature }),
    );
    await loadAllEntries({
      cache,
      sources: [source],
      adapterImpl: { load: () => [] },
      seedFile: null,
    });
    assert.ok(fs.existsSync(path.join(dir, "entries.json")));
  }
});

test("round 2 reference roles, uncertain counts and negations", async () => {
  const { referenceRequirements } = await import("../sources.mjs");
  const examples = [
    [
      "Part-1 30-SEC VERTICAL 9:16 | PHOTOREALISTIC LUXURY BEAUTY COMMERCIAL\n\nCreate a premium European luxury beauty commercial using the provided CHARACTER REFERENCE and PRODUCT REFERENCE.\n\nABSOLUTE REALISM:\nLive-action cinema quality. Real human model, practical cosmetics, real glass, real liquids, real fruit and physical studio sets. Natural skin pores, realistic eyes, hair strands, hands, reflections, liquid physics and camera optics. No CGI look, wax skin, uncanny eyes, plastic face or AI aesthetic.\n\nCHARACTER LOCK:\nUse the exact same blonde female model throughout. Preserve her face, blue-gree",
      2,
    ],
    [
      "provided CHARACTER REFERENCE and PRODUCT REFERENCE; keep CHARACTER REFERENCE",
      2,
    ],
    ["use the reference photo of the product", 1],
    ["based on the uploaded portrait", 1],
    ["参考人物图，产品参考图", 2],
    ["no character reference and no product reference", 0],
    ["无需参考人物图，不用产品参考图", 0],
    ["GPT Image 2 and Grok Imagine", 0],
  ];
  for (const [content, n] of examples)
    assert.equal(
      referenceRequirements({ content }).referenceInputs,
      n,
      content,
    );
  assert.equal(
    referenceRequirements({ content: "Use the provided references" })
      .referenceNote,
    "needs reference images (count unclear)",
  );
});

test("round 2 registry declares curated sources and normalization carries provenance", async () => {
  const { loadRegistry } = await import("../sources.mjs");
  const curated = loadRegistry().filter(
    (s) => s.adapter === "youmind-manifest",
  );
  assert.ok(curated.length >= 2);
  for (const src of curated) {
    assert.equal(src.curatedSource, true);
    const entry = normalizeEntry(src, {
      nativeId: "curated",
      content: "A cat",
    });
    assert.equal(entry.curatedSource, true);
    assert.equal(entry.sourceUrl, `https://github.com/${src.repo}`);
  }
});

test("C4 reference roles require input context", async () => {
  const { referenceRequirements } = await import("../sources.mjs");
  for (const content of [
    "the product reference card on the table",
    "A designer holds a style reference board",
    "She looks at the reference photo of her grandmother on the desk",
    "Style reference: Studio Ghibli",
    "character reference sheet with three poses",
  ])
    assert.equal(
      referenceRequirements({ content }).referenceInputs,
      0,
      content,
    );
  assert.equal(
    referenceRequirements({ content: "Style reference: uploaded image" })
      .referenceInputs,
    1,
  );
});
test("C4 Gemini image aliases are Nano Banana, bare Gemini is separate", () => {
  for (const name of [
    "gemini-2.5-flash-image",
    "gemini 2.5 flash image",
    "gemini flash image",
    "gemini-3-pro-image",
    "gemini pro image",
    "gemini image",
    "Gemini 生图",
  ])
    assert.equal(modelKeyOf(name), "nano-banana", name);
  assert.equal(modelKeyOf("gemini"), "gemini");
});

test("C5 counts supplied inputs separately from roles", async () => {
  const { referenceRequirements } = await import("../sources.mjs");
  for (const [content, count] of [
    [
      "Character References: Use the two supplied images strictly as character references, not starting frames.",
      2,
    ],
    ["the attached photo", 1],
    ["both reference images", 2],
    ["Use five provided pictures", 5],
    ["Use 3 given photos", 3],
    ["使用两张参考图", 2],
    ["使用三张 参考图", 3],
    ["No supplied images", 0],
    ["Do not use two uploaded images", 0],
    ["without a supplied photo", 0],
    ["Do not use the two attached photos", 0],
  ])
    assert.equal(
      referenceRequirements({ content }).referenceInputs,
      count,
      content,
    );
  assert.match(
    referenceRequirements({ content: "Use supplied images" }).referenceNote,
    /count unclear/,
  );
});

test("C5 separates code author from rendering engine and classifies licenses", () => {
  for (const [license, expected] of [
    ["MIT", "open"],
    ["CC-BY-4.0", "attribution"],
    ["GPL-3.0", "copyleft"],
    ["Hyperframes template license", "template"],
    ["Unknown", "unstated"],
  ]) {
    const e = normalizeEntry(
      { id: "code", repo: "o/r", kinds: ["code-video"], license },
      { model: "Claude Opus 4.5", content: "Make this using Remotion" },
    );
    assert.equal(e.renderEngine, "remotion");
    assert.equal(e.authoringModel, "Claude Opus 4.5");
    assert.equal(e.modelKey, "remotion");
    assert.equal(e.licenseStatus, expected);
  }
});

test("C5 engine detection uses reported tools and never substitutes Claude", () => {
  for (const engine of [
    "Remotion",
    "Hyperframes",
    "Manim",
    "p5.js",
    "three.js",
  ]) {
    const e = normalizeEntry(
      {
        id: "code",
        repo: "opusvideo/awesome-claude-video",
        kinds: ["code-video"],
      },
      { model: "Claude Opus 5.5", renderEngine: ["Claude Code", engine] },
    );
    assert.equal(
      e.renderEngine,
      engine === "p5.js" ? "p5" : engine.toLowerCase(),
    );
  }
  assert.equal(
    normalizeEntry(
      {
        id: "code",
        repo: "joeseesun/opus-video-prompts",
        kinds: ["code-video"],
      },
      { model: "Claude Opus 5.5" },
    ).renderEngine,
    null,
  );
});

test("C5 R2 license scope takes precedence over permissive keywords", async () => {
  const { licenseStatusOf } = await import("../sources.mjs");
  for (const [license, expected] of [
    [
      "MIT (code); prompts and media keep the original authors' rights",
      "unstated",
    ],
    [
      "CC0-1.0 for the list only; prompts and videos belong to the original authors",
      "unstated",
    ],
    ["MIT (code)", "unstated"],
    ["MIT; creators retain rights", "unstated"],
    ["GPLv3", "copyleft"],
    ["MPL-2.0", "copyleft"],
    ["Proprietary", "unstated"],
    ["MIT (templates)", "open"],
  ])
    assert.equal(licenseStatusOf(license), expected, license);
  assert.equal(
    licenseStatusOf("MIT (templates)", { templateCatalog: true }),
    "template",
  );
});

test("C5 R2 engine precedence and short author model names", async () => {
  const { codeVideoFields, loadRegistry } = await import("../sources.mjs");
  assert.equal(
    codeVideoFields({
      kind: "code-video",
      model: "Hyperframes",
      content: "three.js orbiting cards",
    }).renderEngine,
    "hyperframes",
  );
  assert.equal(
    codeVideoFields(
      { kind: "code-video", model: "Claude Opus 5.5", content: "three.js" },
      { renderEngine: "hyperframes" },
    ).renderEngine,
    "hyperframes",
  );
  for (const [model, expected] of [
    [
      "The creator describes a custom skill with Claude Opus 5.5 for animation.",
      "Claude Opus 5.5",
    ],
    ["Fable 5.5", "Fable 5.5"],
    ["Built by Gemini 2.5 Pro, creator reported", "Gemini 2.5 Pro"],
    ["Created with GPT-4.1", "GPT-4.1"],
    ["Grok 4", "Grok 4"],
    ["Sonnet 4.5", "Sonnet 4.5"],
  ])
    assert.equal(
      codeVideoFields({ kind: "code-video", model }).authoringModel,
      expected,
    );
  const src = loadRegistry().find((s) => s.id === "opus-video-prompts");
  assert.ok(src?.authoringModel);
  assert.equal(
    normalizeEntry(src, { content: "an animation" }).authoringModel,
    "Claude Opus 5.5",
  );
});

test("C5 R2 natural counts, ordinals, optional and negated references", async () => {
  const { referenceRequirements } = await import("../sources.mjs");
  for (const [content, count] of [
    ["a pair of supplied photos", 2],
    ["Combine the three photos", 3],
    [
      "the face from the uploaded image and the outfit from the second uploaded image",
      2,
    ],
    ["Use the third uploaded image", 3],
    ["This prompt does not require a reference image", 0],
    ["This prompt does not need the supplied photo", 0],
    ["Reference image is optional", 0],
    ["Optional reference photo", 0],
    ["Optionally upload a photo", 0],
    ["re-creating the exact scene from the photo above", 1],
    ["Use the image above", 1],
    ["source photo", 1],
    ["Reference image is optional. Use the second uploaded image.", 2],
    ["A detective pins three photos to a corkboard", 0],
  ])
    assert.equal(
      referenceRequirements({ content }).referenceInputs,
      count,
      content,
    );
});
test("youmind keeps seed entries of categories not downloaded yet", async () => {
  const cache = tmp();
  const dir = path.join(cache, "youmind");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      categories: [
        { slug: "poster", file: "poster.json" },
        { slug: "avatar", file: "avatar.json" },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(dir, "poster.json"),
    JSON.stringify([{ id: 1, title: "poster", content: "a poster prompt" }]),
  );
  const seedFile = path.join(cache, "seed.json");
  fs.writeFileSync(
    seedFile,
    JSON.stringify({
      entries: [
        { id: 1, title: "old poster", content: "old", category: "poster" },
        {
          id: 2,
          title: "avatar",
          content: "an avatar prompt",
          category: "avatar",
        },
      ],
    }),
  );
  const { entries } = await loadAllEntries({
    cache,
    seedFile,
    sources: [{ ...source, id: "youmind", adapter: "youmind-manifest" }],
  });
  const ids = entries.map((e) => String(e.nativeId ?? e.id));
  assert.ok(
    ids.some((id) => id.endsWith("2")),
    "avatar seed entry kept",
  );
  assert.equal(
    entries.filter((e) => String(e.nativeId ?? e.id).endsWith("1")).length,
    1,
  );
});

test("a video entry without a clip borrows the clip another library keeps for the same X post", async () => {
  const cache = tmp();
  const lender = {
    ...source,
    id: "lender",
    repo: "o/lender",
    map: { title: "title", content: "prompt", link: "url", videos: "clip" },
  };
  const borrower = { ...lender, id: "borrower", repo: "o/borrower" };
  // Same post, another kind: used only when no library of the same kind has it.
  const other = {
    ...lender,
    id: "other",
    repo: "o/other",
    kinds: ["code-video"],
  };
  const rows = {
    lender: [
      {
        title: "a",
        prompt: "a",
        url: "https://twitter.com/someone/status/42",
        clip: "https://cdn.example/42.mp4",
      },
      { title: "b", prompt: "b", url: "https://x.com/someone/status/7" },
    ],
    other: [
      {
        title: "a",
        prompt: "a",
        url: "https://x.com/someone/status/42",
        clip: "https://cdn.example/other-42.mp4",
      },
      {
        title: "b",
        prompt: "b",
        url: "https://x.com/someone/status/7",
        clip: "https://cdn.example/other-7.mp4",
      },
    ],
    borrower: [
      { title: "a", prompt: "a", url: "https://x.com/other/status/42?s=20" },
      { title: "b", prompt: "b", url: "https://x.com/someone/status/7" },
      { title: "c", prompt: "c", url: "https://example.com/status/42" },
    ],
  };
  for (const src of [other, lender, borrower]) {
    const file = path.join(cache, src.id, "raw", src.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rows[src.id]));
  }
  const sources = [other, lender, borrower];
  const check = (entries) => {
    const [a, b, c] = entries.filter((e) => e.sourceId === "borrower");
    assert.deepEqual(a.videos, ["https://cdn.example/42.mp4"]);
    assert.equal(a.videoFrom.sourceId, "lender");
    assert.equal(a.videoFrom.source, "o/lender");
    assert.match(a.videoFrom.id, /^lender:/);
    assert.equal(a.mediaState, "video");
    assert.equal(a.evidence, "clip");
    // Only the other kind keeps a clip for post 7.
    assert.deepEqual(b.videos, ["https://cdn.example/other-7.mp4"]);
    assert.equal(b.videoFrom.sourceId, "other");
    // A non-X link never matches.
    for (const e of [c]) {
      assert.deepEqual(e.videos, []);
      assert.equal(e.videoFrom, undefined);
    }
  };
  check((await loadAllEntries({ cache, sources, seedFile: null })).entries);
  // Searching the borrower alone still finds the lender's cached clip.
  const alone = await loadAllEntries({
    cache,
    sources,
    sourceIds: "borrower",
    seedFile: null,
  });
  assert.deepEqual(
    [...new Set(alone.entries.map((e) => e.sourceId))],
    ["borrower"],
  );
  check(alone.entries);
  // The cached index keeps the library's own data, not the borrowed clip.
  const cached = JSON.parse(
    fs.readFileSync(path.join(cache, "borrower", ".normalized.json"), "utf8"),
  );
  assert.deepEqual(cached[0].videos, []);
});
