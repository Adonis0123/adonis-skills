import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../sources.mjs";
import { buildCandidates, renderGallery, serveGallery } from "../gallery.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inferUse,
  buildSeed,
  main,
  addSource,
  checkImage,
  checkSource,
  LARGE_SLUGS,
  LIBRARY,
  USE_MAP,
  coverCheck,
  curlFetch,
  detectAccess,
  defaultFetch,
  detectSession,
  parseIds,
  recommend,
  showEntries,
  showEntry,
  syncLibrary,
  writeBrief,
  withTarget,
  fetchCached,
  findStylePack,
  imageSize,
  loadRatings,
  logRun,
  rateRun,
  searchEntries,
  tokenize,
  CHECK_INTERVAL_MS,
} from "../studio.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ps-test-"));
const fakeSpawn = () => ({ pid: process.pid, unref() {} });

function fakeResponse(status, body = "", headers = {}) {
  const buf = Buffer.from(body);
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => map.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

describe("detectAccess", () => {
  it("prefers a logged-in gh", () => {
    assert.equal(detectAccess({ env: {}, run: () => "" }).tier, "gh");
  });
  it("falls back to a token, then to anonymous with a one-line hint", () => {
    const fail = () => {
      throw new Error("no gh");
    };
    assert.equal(
      detectAccess({ env: { GH_TOKEN: "x" }, run: fail }).tier,
      "token",
    );
    const anon = detectAccess({ env: {}, run: fail });
    assert.equal(anon.tier, "anonymous");
    assert.equal(anon.onlineSearch, false);
    assert.match(anon.hint, /gh auth login/);
  });
});

describe("fetchCached", () => {
  it("downloads, then sends If-None-Match and keeps the file on 304", async () => {
    const cache = tmp();
    const file = path.join(cache, "a.json");
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push(init.headers);
      return seen.length === 1
        ? fakeResponse(200, "v1", { etag: '"e1"' })
        : fakeResponse(304);
    };
    const first = await fetchCached("https://x/a", file, {
      cache,
      now: 0,
      fetchImpl,
    });
    assert.equal(first.status, "updated");
    const second = await fetchCached("https://x/a", file, {
      cache,
      now: CHECK_INTERVAL_MS + 1,
      fetchImpl,
    });
    assert.equal(second.status, "unchanged");
    assert.equal(seen[1]["If-None-Match"], '"e1"');
    assert.equal(fs.readFileSync(file, "utf8"), "v1");
  });

  it("does not hit the network again within the check interval", async () => {
    const cache = tmp();
    const file = path.join(cache, "a.json");
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return fakeResponse(200, "v1");
    };
    await fetchCached("https://x/a", file, { cache, now: 0, fetchImpl });
    const again = await fetchCached("https://x/a", file, {
      cache,
      now: 1000,
      fetchImpl,
    });
    assert.equal(again.status, "fresh");
    assert.equal(calls, 1);
  });

  it("backs off until X-RateLimit-Reset and serves the stale copy", async () => {
    const cache = tmp();
    const file = path.join(cache, "a.json");
    fs.writeFileSync(file, "old");
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return fakeResponse(403, "", { "x-ratelimit-reset": "2000" });
    };
    const limited = await fetchCached("https://x/a", file, {
      cache,
      now: 0,
      fetchImpl,
    });
    assert.equal(limited.status, "stale-rate-limited");
    const during = await fetchCached(
      "https://x/b",
      path.join(cache, "b.json"),
      { cache, now: 1000, fetchImpl },
    );
    assert.equal(during.status, "unavailable-rate-limited");
    assert.equal(calls, 1, "no request is sent before the reset time");
  });

  it("reports offline instead of throwing", async () => {
    const cache = tmp();
    const res = await fetchCached("https://x/a", path.join(cache, "a"), {
      cache,
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
    });
    assert.equal(res.status, "unavailable-offline");
  });
});

describe("curlFetch", () => {
  it("parses the last header block after redirects", async () => {
    const run = (cmd, args) => {
      const out = args[args.indexOf("-o") + 1];
      fs.writeFileSync(out, "body");
      return 'HTTP/1.1 301 Moved\r\nLocation: y\r\n\r\nHTTP/2 200\r\netag: "abc"\r\n\r\n';
    };
    const res = await curlFetch("https://x", { headers: { A: "b" } }, run);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("ETag"), '"abc"');
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "body");
  });
});

describe("search", () => {
  const entries = [
    {
      id: 1,
      title: "Neon cyber cover",
      description: "tech",
      content: "a",
      sourceMedia: ["i1"],
    },
    {
      id: 2,
      title: "Watercolor cat",
      description: "cute cat",
      content: "cat",
      sourceMedia: ["i2"],
    },
    {
      id: 3,
      title: "Cyber city",
      description: "no image",
      content: "cyber",
      sourceMedia: [],
    },
    {
      id: 4,
      title: "Plain",
      description: "cyber mention",
      content: "",
      sourceMedia: ["i4"],
    },
  ];

  it("tokenizes CJK into bigrams", () => {
    assert.deepEqual(tokenize("公众号封面"), ["公众", "众号", "号封", "封面"]);
  });

  it("ranks title hits above description hits and skips entries without a sample image", () => {
    const results = searchEntries(entries, "cyber");
    assert.deepEqual(
      results.map((r) => r.id),
      [1, 4],
    );
  });

  it("lists a prompt once even when it sits in several categories", () => {
    const dup = [...entries, { ...entries[0], category: "other" }];
    assert.deepEqual(
      searchEntries(dup, "cyber").map((r) => r.id),
      [1, 4],
    );
  });

  it("boosts prompts the user rated 4 or 5", () => {
    const results = searchEntries(entries, "cyber", {
      ratings: new Map([["4", 5]]),
    });
    assert.equal(results[0].id, 4);
    assert.equal(results[0].yourBestScore, 5);
  });

  it("drops cover tokens and demotes fashion-magazine titles in cover categories", () => {
    const mix = [
      {
        id: 10,
        title: "MCP tech connector",
        description: "AI tools",
        content: "pipes",
        sourceMedia: ["a"],
        category: "youtube-thumbnail",
      },
      {
        id: 11,
        title: "Vogue Magazine Cover",
        description: "fashion cover shoot",
        content: "cover model",
        sourceMedia: ["b"],
        category: "youtube-thumbnail",
      },
    ];
    const results = searchEntries(mix, "MCP cover connector", {
      dropTokens: ["cover", "covers"],
    });
    assert.equal(results[0].id, 10);
    assert.ok(
      !results.some((r) => r.id === 11) ||
        results.find((r) => r.id === 11).score < results[0].score,
    );
  });

  it("builds a seed capped per category", () => {
    const seed = buildSeed(
      [
        { id: 1, category: "a", sourceMedia: ["x"] },
        { id: 2, category: "a", sourceMedia: ["x"] },
        { id: 3, category: "b", sourceMedia: [] },
      ],
      1,
    );
    assert.deepEqual(
      seed.entries.map((e) => e.id),
      [1],
    );
  });
});

describe("checkSource", () => {
  it("reports new, unchanged after confirm, and changed when upstream edits", async () => {
    const cache = tmp();
    let body = "v1";
    let now = 0;
    const fetchImpl = async () => fakeResponse(200, body);
    const opts = () => ({ cache, fetchImpl, now, force: true });
    assert.equal(
      (await checkSource("https://x/SKILL.md", opts())).status,
      "new",
    );
    assert.equal(
      (await checkSource("https://x/SKILL.md", { ...opts(), confirm: true }))
        .status,
      "confirmed",
    );
    assert.equal(
      (await checkSource("https://x/SKILL.md", opts())).status,
      "unchanged",
    );
    body = "v2";
    now += 1;
    const changed = await checkSource("https://x/SKILL.md", opts());
    assert.equal(changed.status, "changed");
    assert.equal(fs.readFileSync(changed.confirmedCopy, "utf8"), "v1");
  });
});

describe("images", () => {
  it("reads PNG dimensions and flags a wrong size with a fix", () => {
    const dir = tmp();
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(1800, 16);
    png.writeUInt32BE(766, 20);
    const file = path.join(dir, "c.png");
    fs.writeFileSync(file, png);
    assert.deepEqual(imageSize(png), {
      format: "png",
      width: 1800,
      height: 766,
    });
    assert.equal(
      checkImage(file, { size: "1800x766", ratio: "2.35:1" }).ok,
      true,
    );
    const bad = checkImage(file, { size: "1080x1080" });
    assert.equal(bad.ok, false);
    assert.match(bad.problems[0], /expected 1080x1080/);
    for (const ratio of ["1:0", "0:1", "garbage"]) {
      const invalid = checkImage(file, { ratio });
      assert.equal(invalid.ok, false, ratio);
      assert.match(invalid.problems[0], /invalid --ratio/);
    }
    assert.match(
      checkImage(file, { size: "1y1" }).problems[0],
      /invalid --size/,
    );
  });
});

describe("records and style pack", () => {
  it("logs runs, appends ratings and feeds them back into ranking", () => {
    const project = tmp();
    const env = {};
    const run = logRun(
      project,
      { runId: "r1", promptId: 42, channel: "grok" },
      { env, now: 0 },
    );
    rateRun(project, run.runId, 5, { env, now: 1 });
    assert.equal(loadRatings(project, env).get("42"), 5);
    assert.throws(() => rateRun(project, "missing", 3, { env }), /not found/);
    assert.throws(() => rateRun(project, "r1", 9, { env }), /1 to 5/);
  });

  it("follows a one-line pointer to a shared style pack", () => {
    const root = tmp();
    const project = path.join(root, "mp");
    fs.mkdirSync(path.join(project, ".agents"), { recursive: true });
    fs.mkdirSync(path.join(root, "brand"));
    fs.writeFileSync(path.join(root, "brand", "style-pack.md"), "# real");
    fs.writeFileSync(
      path.join(project, ".agents", "style-pack.md"),
      "Use `../brand/style-pack.md`.",
    );
    const found = findStylePack(project, {});
    assert.equal(found.path, path.join(root, "brand", "style-pack.md"));
    assert.match(found.via, /\.agents\/style-pack\.md$/);
  });

  it("finds the project style pack before the env path, and reports none when absent", () => {
    const project = tmp();
    assert.equal(findStylePack(project, {}).found, false);
    const envPack = path.join(tmp(), "pack.md");
    fs.writeFileSync(envPack, "x");
    assert.equal(
      findStylePack(project, { PROMPT_STUDIO_STYLE_PACK: envPack }).path,
      envPack,
    );
    fs.mkdirSync(path.join(project, ".agents"));
    fs.writeFileSync(path.join(project, ".agents", "style-pack.md"), "y");
    assert.match(
      findStylePack(project, { PROMPT_STUDIO_STYLE_PACK: envPack }).path,
      /\.agents\/style-pack\.md$/,
    );
  });
});

describe("ranking improvements", () => {
  const entries = [
    {
      id: 1,
      title: "YouTube cover",
      description: "bold",
      content: "x",
      sourceMedia: ["https://example.com/fixture-1.png"],
    },
    {
      id: 2,
      title: "Landscape",
      description: "the sky is for all of the people",
      content: "with the and for",
      sourceMedia: ["https://example.com/fixture-2.png"],
    },
    {
      id: 3,
      title: "Start",
      description: "art deco",
      content: "start",
      sourceMedia: ["https://example.com/fixture-3.png"],
    },
    {
      id: 4,
      title: "Body only once",
      description: "none",
      content: "a cover somewhere",
      sourceMedia: ["https://example.com/fixture-4.png"],
    },
    {
      id: 5,
      title: "Body twice",
      description: "none",
      content: "cover and thumbnail",
      sourceMedia: ["https://example.com/fixture-5.png"],
    },
  ];

  it("drops stopwords from tokens and from matching", () => {
    assert.deepEqual(tokenize("the cover for"), ["cover"]);
    assert.deepEqual(
      searchEntries(entries, "the cover for").map((r) => r.id),
      [1],
    );
    assert.deepEqual(searchEntries(entries, "the for of and"), []);
  });

  it("matches ASCII tokens on word boundaries", () => {
    assert.deepEqual(
      searchEntries(entries, "art").map((r) => r.id),
      [3],
    );
  });

  it("counts content-only hits only when two tokens match", () => {
    assert.deepEqual(
      searchEntries(entries, "cover thumbnail")
        .map((r) => r.id)
        .sort(),
      [1, 5],
    );
  });

  it("weights rare subject words above generic ones and reports matches", () => {
    const generic = Array.from({ length: 6 }, (_, i) => ({
      id: 100 + i,
      title: `AI portrait ${i}`,
      description: "AI art",
      content: "ai",
      sourceMedia: ["https://example.com/fixture-6.png"],
    }));
    const subject = {
      id: 200,
      title: "Robot plugging a glowing connector",
      description: "tools hub",
      content: "connector port",
      sourceMedia: ["https://example.com/fixture-7.png"],
    };
    const results = searchEntries([...generic, subject], "AI connector tools");
    assert.equal(results[0].id, 200);
    assert.deepEqual(results[0].matched.sort(), ["connector", "tools"]);
  });

  it("searches keyword groups split by | and keeps the best group", () => {
    const list = [
      {
        id: 1,
        title: "Robot mascot",
        description: "",
        content: "",
        sourceMedia: ["https://example.com/fixture-8.png"],
      },
      {
        id: 2,
        title: "Neon city",
        description: "",
        content: "",
        sourceMedia: ["https://example.com/fixture-9.png"],
      },
      {
        id: 3,
        title: "Bowl of fruit",
        description: "",
        content: "",
        sourceMedia: ["https://example.com/fixture-10.png"],
      },
    ];
    assert.deepEqual(
      searchEntries(list, "robot mascot | neon city")
        .map((r) => r.id)
        .sort(),
      [1, 2],
    );
  });

  it("returns a preview and detects placeholders", () => {
    const list = [
      {
        id: 1,
        title: "Poster",
        description: "",
        content: `{argument name="x" default="y"} ${"z".repeat(700)}`,
        sourceMedia: ["https://example.com/fixture-11.png"],
      },
      {
        id: 2,
        title: "Poster",
        description: "",
        content: "{style=flat} poster",
        sourceMedia: ["https://example.com/fixture-12.png"],
      },
      {
        id: 3,
        title: "Poster",
        description: "",
        content: "plain {braces}",
        sourceMedia: ["https://example.com/fixture-13.png"],
        needReferenceImages: true,
      },
    ];
    const byId = Object.fromEntries(
      searchEntries(list, "poster").map((r) => [r.id, r]),
    );
    assert.equal(byId[1].hasPlaceholders, true);
    assert.equal(byId[2].hasPlaceholders, true);
    assert.equal(byId[3].hasPlaceholders, false);
    assert.equal(byId[3].needReferenceImages, false);
    assert.equal(byId[3].referenceHint, true);
    assert.equal(byId[1].contentPreview.length, 600);
  });

  it("looks up several ids", () => {
    assert.deepEqual(parseIds(["1,2", "3", "2"]), ["1", "2", "3"]);
    assert.equal(showEntry(entries, "2").id, 2);
    const { entries: found, missing } = showEntries(entries, ["1", "9", "3"]);
    assert.deepEqual(
      found.map((e) => e.id),
      [1, 3],
    );
    assert.deepEqual(missing, ["9"]);
  });
});

describe("library sync and recommend", () => {
  const manifest = {
    updatedAt: "t",
    categories: [
      { slug: "youtube-thumbnail", title: "YT", count: 1, file: "yt.json" },
      { slug: "poster-flyer", title: "P", count: 1, file: "poster.json" },
      { slug: "social-media-post", title: "S", count: 1, file: "social.json" },
      { slug: "product-marketing", title: "M", count: 1, file: "market.json" },
      { slug: "ecommerce-main-image", title: "E", count: 1, file: "ecom.json" },
    ],
  };
  const files = {
    "manifest.json": manifest,
    "yt.json": [
      {
        id: 1,
        title: "Cover thumbnail",
        description: "d",
        content: "content 1",
        sourceMedia: ["https://example.com/image-1.jpg"],
      },
    ],
    "poster.json": [
      {
        id: 2,
        title: "Cover poster",
        description: "d",
        content: "content 2",
        sourceMedia: ["https://example.com/image-2.jpg"],
      },
    ],
    "social.json": [
      {
        id: 3,
        title: "Cover social",
        description: "d",
        content: "content 3",
        sourceMedia: ["https://example.com/image-3.jpg"],
      },
    ],
  };
  const makeFetch =
    (seen = []) =>
    async (url) => {
      const name = url.split("/").pop();
      seen.push(name);
      return files[name]
        ? fakeResponse(200, JSON.stringify(files[name]))
        : fakeResponse(404);
    };

  it("defines the use map", () => {
    assert.deepEqual(USE_MAP.cover, ["youtube-thumbnail", "poster-flyer"]);
    assert.deepEqual(USE_MAP.poster, ["poster-flyer"]);
    assert.deepEqual(LARGE_SLUGS, ["social-media-post", "product-marketing"]);
  });

  it("infers poster use from the request", () => {
    assert.equal(inferUse("春节促销海报"), "poster");
    assert.equal(inferUse("summer sale flyer"), "poster");
    assert.equal(inferUse("wechat cover"), "cover");
  });

  it("skips large categories unless allowLarge", async () => {
    const seen = [];
    const cache = tmp();
    const res = await syncLibrary({
      categories: ["social-media-post", "poster-flyer"],
      cache,
      fetchImpl: makeFetch(seen),
    });
    const skipped = res.results.find((r) => r.slug === "social-media-post");
    assert.equal(skipped.status, "skipped-large");
    assert.match(skipped.hint, /allowLarge|--allow-large/);
    assert.ok(!seen.includes("social.json"));
    assert.ok(seen.includes("poster.json"));

    const allowed = await syncLibrary({
      categories: ["social-media-post"],
      cache,
      force: true,
      allowLarge: true,
      fetchImpl: makeFetch(seen),
    });
    assert.equal(
      allowed.results.find((r) => r.url?.endsWith("social.json")).status,
      "updated",
    );
  });

  it("recommends from the USE_MAP categories", async () => {
    const cache = tmp();
    const out = await recommend("cover", {
      use: "cover",
      cache,
      fetchImpl: makeFetch(),
      spawnImpl: fakeSpawn,
      sourceIds: ["youmind"],
    });
    assert.equal(out.use, "cover");
    assert.deepEqual(out.categories, ["youtube-thumbnail", "poster-flyer"]);
    assert.equal(out.origin, "cache");
    assert.deepEqual(out.results.map((r) => r.id).sort(), [1, 2]);
    assert.match(out.cacheNote, /origin=cache/);
  });

  it("notes skipped large categories and honours allowLarge", async () => {
    const cache = tmp();
    const out = await recommend("cover", {
      use: "illustration",
      cache,
      fetchImpl: makeFetch(),
      spawnImpl: fakeSpawn,
      sourceIds: ["youmind"],
    });
    assert.deepEqual(out.categories, USE_MAP.illustration);
    assert.match(out.cacheNote, /social-media-post/);
    assert.ok(!out.results.some((r) => r.id === 3));
    const more = await recommend("cover", {
      use: "illustration",
      cache: tmp(),
      force: true,
      allowLarge: true,
      fetchImpl: makeFetch(),
      spawnImpl: fakeSpawn,
      sourceIds: ["youmind"],
    });
    assert.ok(more.results.some((r) => r.id === 3));
  });

  it("infers the category from the query and asks for English when all tokens are CJK", async () => {
    const cache = tmp();
    const inferred = await recommend("tech cover", {
      cache,
      fetchImpl: makeFetch(),
      spawnImpl: fakeSpawn,
      sourceIds: ["youmind"],
    });
    assert.equal(inferred.use, "cover");
    const cjk = await recommend("公众号封面", {
      use: "cover",
      cache,
      fetchImpl: makeFetch(),
      spawnImpl: fakeSpawn,
      sourceIds: ["youmind"],
    });
    assert.equal(cjk.error, "translate-to-english");
    assert.ok(cjk.hint);
    const none = await recommend("sunset", {
      cache,
      fetchImpl: makeFetch(),
      spawnImpl: fakeSpawn,
      sourceIds: ["youmind"],
    });
    assert.equal(none.error, undefined);
    assert.deepEqual(none.categories, []);
  });
});

describe("session, cover check and brief", () => {
  it("reports channels and key variable names without values", () => {
    const project = tmp();
    fs.mkdirSync(path.join(project, ".agents"));
    fs.writeFileSync(
      path.join(project, ".agents", "style-pack.md"),
      `Use OPENAI_API_KEY or GROK_TOKEN. ${"x".repeat(5000)}`,
    );
    const calls = [];
    const run = (cmd) => {
      calls.push(cmd);
      if (cmd === "ffmpeg") throw new Error("missing");
      return "";
    };
    const s = detectSession({
      project,
      env: { OPENAI_API_KEY: "secret-value" },
      run,
    });
    assert.equal(s.access.tier, "gh");
    assert.equal(s.stylePack.found, true);
    assert.equal(s.channels.codex, true);
    assert.equal(s.channels.ffmpeg, false);
    assert.equal(s.channels.nodeOk, true);
    assert.deepEqual(s.channels.apiKeyVars, [
      { name: "OPENAI_API_KEY", set: true },
      { name: "GROK_TOKEN", set: false },
    ]);
    assert.equal(s.stylePackText.length, 4000);
    assert.ok(!JSON.stringify(s).includes("secret-value"));
  });

  it("omits style pack text when none exists", () => {
    const s = detectSession({ project: tmp(), env: {}, run: () => "" });
    assert.equal(s.stylePack.found, false);
    assert.equal("stylePackText" in s, false);
    assert.deepEqual(s.channels.apiKeyVars, []);
  });

  const pngFile = (dir, name, w, h) => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(w, 16);
    png.writeUInt32BE(h, 20);
    const file = path.join(dir, name);
    fs.writeFileSync(file, png);
    return file;
  };

  it("falls back to size checks when ffmpeg is missing", () => {
    const dir = tmp();
    const file = pngFile(dir, "a.png", 100, 100);
    const res = coverCheck([file], {
      size: "200x200",
      run: () => {
        throw new Error("no ffmpeg");
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.problems[0], "ffmpeg missing");
    assert.equal(res.checks.length, 1);
    assert.equal(res.checks[0].ok, false);
  });

  it("builds ffmpeg previews for each variant", () => {
    const dir = tmp();
    const out = path.join(dir, "out");
    const file = pngFile(dir, "cover.png", 1800, 766);
    const ffmpegCalls = [];
    const run = (cmd, args) => {
      if (cmd === "ffmpeg" && args[0] === "-y") ffmpegCalls.push(args);
      return "";
    };
    const res = coverCheck([file], {
      title: "Hello",
      size: "1800x766",
      outDir: out,
      capabilities: {
        ffmpeg: { available: true, drawtext: true },
        cjkFont: "/fixture/cjk.ttf",
      },
      run,
    });
    assert.equal(res.ok, true);
    assert.equal(ffmpegCalls.length, 3);
    assert.deepEqual(res.variants[0].previews, {
      w340: path.join(out, "cover-340.png"),
      crop120: path.join(out, "cover-crop120.png"),
      title: path.join(out, "cover-title.png"),
    });
    assert.equal(res.variants[0].sizeCheck.ok, true);
    assert.match(
      ffmpegCalls[2][ffmpegCalls[2].indexOf("-vf") + 1],
      /drawbox.*drawtext/,
    );
  });

  it("writes a brief with attribution flag", () => {
    const project = tmp();
    const res = writeBrief({
      project,
      runId: "run-1",
      promptId: 7,
      title: "Cover",
      source: LIBRARY.repo,
      license: LIBRARY.license,
      channel: "codex",
      model: "gpt-image",
      outputPath: "out.png",
      size: "1800x766",
      content: "A bold cover",
      styleNotes: "flat",
      extra: { seed: 1 },
    });
    assert.equal(
      res.path,
      path.join(project, ".prompt-studio", "briefs", "run-1.md"),
    );
    assert.equal(res.attributionRequired, true);
    const text = fs.readFileSync(res.path, "utf8");
    for (const h of [
      "## Source / License",
      "## Channel / Model",
      "## Output",
      "## Style",
      "## Prompt",
    ])
      assert.match(text, new RegExp(h));
    assert.match(text, /A bold cover/);
    assert.equal(
      writeBrief({ project, runId: "r2", license: "MIT", content: "x" })
        .attributionRequired,
      true,
    );
  });
});

describe("gallery", () => {
  const entries = [
    {
      id: 7,
      title: "Robot <hub>",
      content: 'A robot {argument name="x"} plugs in',
      sourceMedia: ["https://img/a.jpg", "javascript:alert(1)"],
      source: "lib",
      license: "CC BY 4.0",
    },
  ];

  it("fills candidates from the library, marks a default and reports missing ids", () => {
    const { candidates, missing } = buildCandidates(
      [{ id: 7, fit: "fits" }, { id: 8 }],
      entries,
    );
    assert.deepEqual(missing, [8]);
    assert.equal(candidates[0].default, true);
    assert.equal(candidates[0].hasPlaceholders, true);
    assert.equal(candidates[0].license, "CC BY 4.0");
  });

  it("renders the full prompt escaped and drops unsafe image urls", () => {
    const { candidates } = buildCandidates([{ id: 7 }], entries);
    const html = renderGallery({ title: "t", candidates });
    assert.ok(html.includes("Robot &lt;hub&gt;"));
    assert.ok(html.includes("plugs in"));
    assert.ok(html.includes("https://img/a.jpg"));
    assert.ok(!html.includes("javascript:alert"));
    assert.ok(html.includes("推荐"));
    assert.ok(html.includes("<textarea"));
  });

  it("serves the page and resolves with the clicked pick", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-serve-"));
    const file = path.join(dir, "g.html");
    fs.writeFileSync(file, "<p>page</p>");
    let base;
    const done = serveGallery({
      file,
      ids: [3, 7],
      pickFile: path.join(dir, "g.pick.json"),
      onReady: (u) => (base = u),
    });
    while (!base) await new Promise((r) => setTimeout(r, 5));
    assert.equal(await (await fetch(base)).text(), "<p>page</p>");
    const bad = await fetch(`${base}pick`, {
      method: "POST",
      body: '{"id":9}',
    });
    assert.equal(bad.status, 400);
    await fetch(`${base}pick`, {
      method: "POST",
      body: JSON.stringify({ id: 7, number: 9, edited: true, prompt: "new" }),
    });
    const pick = await done;
    assert.equal(pick.status, "picked");
    assert.equal(pick.prompt, "new");
    assert.equal(pick.number, 2, "number comes from the id, not the page");
    assert.equal(JSON.parse(fs.readFileSync(pick.pickFile, "utf8")).id, 7);
  });

  it("emits a page script that parses", () => {
    const { candidates } = buildCandidates([{ id: 7 }], entries);
    const html = renderGallery({ title: "t", candidates });
    const js = html.split("<script>")[1].split("</script>")[0];
    assert.doesNotThrow(() => new Function(js));
  });

  it("shows an empty state without candidates", () => {
    assert.ok(renderGallery({ candidates: [] }).includes("没找到合适的案例"));
  });
});

describe("multi-source ranking", () => {
  const entry = (id, sourceId, extra = {}) => ({
    id,
    sourceId,
    kind: "video",
    title: "Coffee commercial",
    description: "",
    content: `coffee ${id}`,
    sourceMedia: [`https://example.com/poster-${id}.jpg`],
    videos: [],
    ...extra,
  });
  it("caps each source and bypasses the cap for explicit sources", () => {
    const entries = [1, 2, 3, 4].map((id) => entry(id, "a"));
    entries.push(entry(5, "b"));
    assert.deepEqual(
      searchEntries(entries, "coffee", { perSource: 2 }).map((e) => e.id),
      [1, 2, 5],
    );
    assert.equal(searchEntries(entries, "coffee").length, 5);
  });
  it("ranks the requested model first and marks fallback models", () => {
    const entries = [
      entry(1, "a", { model: "Kling 3", modelKey: "kling" }),
      entry(2, "b", { model: "Seedance 2", modelKey: "seedance" }),
    ];
    const results = searchEntries(entries, "coffee", { model: "seedance" });
    assert.equal(results[0].id, 2);
    assert.equal(results[0].modelMismatch, false);
    assert.equal(results[1].modelMismatch, true);
  });
  it("keeps playable videos and empty-content code templates", () => {
    const entries = [
      entry(1, "a", { sourceMedia: [], videos: ["https://example.com/a.mp4"] }),
      entry(2, "b", { kind: "code-video", sourceMedia: [], content: "" }),
      entry(3, "c", { sourceMedia: [] }),
    ];
    assert.deepEqual(
      searchEntries(entries, "coffee").map((e) => e.id),
      [1, 2],
    );
  });
  it("keeps legacy bare ids eligible for saved ratings", () => {
    const entries = [entry(42, "youmind"), entry("new:1", "new")];
    assert.equal(
      searchEntries(entries, "coffee", { ratings: new Map([["42", 5]]) })[0].id,
      42,
    );
  });
});

it("preserves fetch metadata when sources refresh concurrently", async () => {
  const cache = tmp();
  const fetchImpl = async () => fakeResponse(200, "[]", { etag: "v1" });
  await Promise.all(
    ["a", "b"].map((name) =>
      fetchCached(`https://example.com/${name}`, path.join(cache, name), {
        cache,
        fetchImpl,
        now: 100,
      }),
    ),
  );
  const state = JSON.parse(
    fs.readFileSync(path.join(cache, "state.json"), "utf8"),
  );
  assert.equal(Object.keys(state.sources).length, 2);
});

describe("source registration and seed rights", () => {
  it("registers repository metadata without granting seed permission", async () => {
    const cache = tmp();
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, args]);
      return args[0] === "api"
        ? JSON.stringify({
            full_name: "owner/repo",
            default_branch: "master",
            license: { spdx_id: "MIT" },
          })
        : "";
    };
    const result = await addSource("owner/repo", {
      adapter: "json-map",
      kind: "video",
      file: "data.json",
      itemsPath: "cases",
      map: {
        nativeId: "id",
        title: "title",
        content: "prompt",
        videos: "video",
      },
      fetchImpl: async () =>
        fakeResponse(
          200,
          JSON.stringify({
            cases: [
              {
                id: 1,
                title: "Coffee",
                prompt: "coffee",
                video: "https://example.com/a.mp4",
              },
            ],
          }),
        ),
      cache,
      env: {},
      run,
    });
    assert.equal(result.source.license, "MIT");
    assert.equal(result.source.seed, "never");
    assert.equal(result.source.branch, "master");
    assert.equal(result.source.itemsPath, "cases");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(cache, "user-sources.json")))
        .sources[0].id,
      "owner-repo",
    );
    assert.ok(calls.some(([, args]) => args[0] === "api"));
  });
  it("rejects unsafe repository and adapter paths before network access", async () => {
    await assert.rejects(
      addSource("../escape", {
        adapter: "json-map",
        run: () => {
          throw new Error("Unexpected command");
        },
      }),
      /owner\/repo/,
    );
    await assert.rejects(
      addSource("owner/repo", {
        adapter: "../escape",
        run: () => {
          throw new Error("Unexpected command");
        },
      }),
      /Invalid --adapter/,
    );
  });
  it("excludes seed-never entries and caps each source/category", () => {
    const entry = (id, sourceId) => ({
      id,
      sourceId,
      kind: "code-video",
      title: "Chart",
      category: "charts",
      sourceMedia: [],
      videos: [],
      content: "",
    });
    const seed = buildSeed(
      [entry(1, "allowed"), entry(2, "allowed"), entry(3, "private")],
      1,
      [
        { id: "allowed", seed: "allowed" },
        { id: "private", seed: "never" },
      ],
    );
    assert.deepEqual(
      seed.entries.map((e) => e.id),
      [1],
    );
  });
});

it("registers dotted and underscored repository names with loadable ids", async () => {
  const cache = tmp();
  const run = (cmd, args) =>
    args[0] === "api" ? JSON.stringify({ default_branch: "main" }) : "";
  const { source } = await addSource("owner/repo.name_test", {
    cache,
    adapter: "json-map",
    file: "data.json",
    map: { title: "title", content: "prompt" },
    fetchImpl: async () =>
      fakeResponse(
        200,
        JSON.stringify([{ title: "Coffee", prompt: "coffee" }]),
      ),
    env: {},
    run,
  });
  assert.equal(source.id, "owner-repo-name-test");
  assert.ok(
    loadRegistry({ cache }).some((s) => s.repo === "owner/repo.name_test"),
  );
});

it("awaits concurrent curl runners before reading and removing body files", async () => {
  let active = 0;
  let maxActive = 0;
  const run = async (cmd, args) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    fs.writeFileSync(args[args.indexOf("-o") + 1], "body");
    active -= 1;
    return "HTTP/2 200\r\n\r\n";
  };
  const responses = await Promise.all(
    ["a", "b"].map((url) => curlFetch(`https://example.com/${url}`, {}, run)),
  );
  assert.equal(maxActive, 2);
  assert.equal(
    Buffer.from(await responses[0].arrayBuffer()).toString(),
    "body",
  );
});

it("does not expose curl headers in transport errors", async () => {
  const run = () => {
    const error = new Error(
      "Command failed: curl -H Authorization: Bearer secret-token",
    );
    error.code = 7;
    throw error;
  };
  await assert.rejects(
    curlFetch(
      "https://example.com",
      { headers: { Authorization: "Bearer secret-token" } },
      run,
    ),
    (error) => {
      assert.equal(error.message, "curl request failed (7)");
      assert.equal(error.code, 7);
      assert.ok(!String(error).includes("secret-token"));
      return true;
    },
  );
});

describe("reviewed retrieval boundaries", () => {
  const src = {
    id: "fixture",
    repo: "owner/repo",
    kinds: ["video"],
    adapter: "json-map",
    file: "rows.json",
    itemsPath: "",
    map: {
      nativeId: "id",
      title: "title",
      content: "prompt",
      videos: "video",
      model: "model",
    },
  };
  const options = () => ({
    cache: tmp(),
    sources: [src],
    kind: "video",
    spawnImpl: fakeSpawn,
    fetchImpl: async () =>
      fakeResponse(
        200,
        JSON.stringify(
          Array.from({ length: 5 }, (_, i) => ({
            id: i,
            title: `Coffee ${i}`,
            prompt: `coffee commercial ${i}`,
            video: `https://example.com/${i}.mp4`,
            model: "Seedance 2",
          })),
        ),
      ),
  });
  it("does not cap a matching model to two entries from one source", async () => {
    const out = await recommend("coffee", {
      ...options(),
      model: "seedance",
      limit: 5,
    });
    assert.equal(out.results.length, 5);
    assert.ok(out.results.every((e) => !e.modelMismatch));
  });
  it("reports the no-close-match note in recommend output", async () => {
    const out = await recommend("coffee moon robot ocean", {
      ...options(),
      model: "grok-imagine",
      subject: "latte",
    });
    assert.ok(out.results.length);
    assert.ok(out.results.every((entry) => !entry.relevant));
    assert.match(
      out.cacheNote,
      /no close match for latte; showing nearest by model/,
    );
    const empty = await recommend("nebula", {
      ...options(),
      model: "grok-imagine",
    });
    assert.equal(empty.results.length, 0);
    assert.match(
      empty.cacheNote,
      /no close match for nebula; showing nearest by model/,
    );
  });
  it("rejects empty queries and unknown source ids before fetching", async () => {
    let fetched = false;
    const opts = {
      ...options(),
      fetchImpl: async () => {
        fetched = true;
        throw new Error("unexpected");
      },
    };
    assert.equal((await recommend("", opts)).error, "need-query");
    assert.equal((await recommend("the and", opts)).error, "need-query");
    assert.equal(
      (await recommend("coffee", { ...opts, sourceIds: ["missing"] })).error,
      "unknown-source",
    );
    assert.equal(fetched, false);
  });
  it("explains a model fallback and deduplicates notes", async () => {
    const out = await recommend("coffee", { ...options(), model: "kling" });
    assert.match(
      out.cacheNote,
      /no kling samples in the libraries; showing other models/,
    );
    assert.equal(
      new Set(out.cacheNote.split("; ")).size,
      out.cacheNote.split("; ").length,
    );
  });
  it("returns previews without raw fields or complete prompts", () => {
    const result = searchEntries(
      [
        {
          id: 1,
          title: "Coffee",
          content: "x".repeat(5000),
          sourceMedia: ["https://example.com/a.jpg"],
          rawSecret: "private",
          description: "z".repeat(5000),
          tags: Array.from({ length: 100 }, () => "t".repeat(300)),
        },
      ],
      "coffee",
    )[0];
    assert.equal("content" in result, false);
    assert.equal("rawSecret" in result, false);
    assert.ok(result.description.length <= 600);
    assert.ok(result.tags.length <= 8);
    assert.ok(result.tags.every((tag) => tag.length <= 100));
  });
});

it("only sends auth to trusted GitHub hosts and does not cache aborted fetches", async () => {
  const cache = tmp();
  const controller = new AbortController();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init);
    return fakeResponse(200, "ok");
  };
  await fetchCached("https://example.com/data", path.join(cache, "other"), {
    cache,
    token: "secret",
    fetchImpl,
  });
  await fetchCached(
    "https://raw.githubusercontent.com/o/r/main/x",
    path.join(cache, "github"),
    { cache, token: "secret", fetchImpl },
  );
  assert.equal(seen[0].headers.Authorization, undefined);
  assert.equal(seen[1].headers.Authorization, "Bearer secret");
  const aborted = await fetchCached(
    "https://example.com/abort",
    path.join(cache, "abort"),
    {
      cache,
      signal: controller.signal,
      fetchImpl: async (url, init) => {
        assert.equal(init.signal.aborted, false);
        controller.abort();
        assert.equal(init.signal.aborted, true);
        return fakeResponse(200, "bad");
      },
    },
  );
  assert.match(aborted.status, /aborted/);
  assert.equal(fs.existsSync(path.join(cache, "abort")), false);
});

it("builds diverse seeds without repeated ids", () => {
  const entries = [
    { id: 1, sourceId: "a", kind: "code-video", tags: ["chart"], content: "" },
    {
      id: 1,
      sourceId: "a",
      kind: "code-video",
      tags: ["chart"],
      category: "other",
      content: "",
    },
    { id: 2, sourceId: "a", kind: "code-video", tags: ["title"], content: "" },
  ];
  assert.deepEqual(
    buildSeed(entries, 1, [{ id: "a", seed: "allowed" }]).entries.map(
      (e) => e.id,
    ),
    [1, 2],
  );
});

it("rejects incomplete or empty json mappings without keeping a registration", async () => {
  const cache = tmp();
  const run = (cmd, args) =>
    args[0] === "api" ? JSON.stringify({ default_branch: "main" }) : "";
  await assert.rejects(
    addSource("owner/new", {
      cache,
      adapter: "json-map",
      file: "data.json",
      run,
    }),
    /--map/,
  );
  await assert.rejects(
    addSource("owner/new", {
      cache,
      adapter: "json-map",
      file: "data.json",
      map: { title: "missing", content: "missing" },
      run,
      fetchImpl: async () => fakeResponse(200, "[]"),
    }),
    /0 entries/,
  );
  assert.equal(fs.existsSync(path.join(cache, "user-sources.json")), false);
});

it("passes compression and cancellation to the curl subprocess", async () => {
  const controller = new AbortController();
  let observed;
  await curlFetch(
    "https://example.com",
    { signal: controller.signal },
    (cmd, args, opts) => {
      observed = { args, signal: opts.signal };
      return "HTTP/2 200\r\n\r\n";
    },
  );
  assert.ok(observed.args.includes("--compressed"));
  assert.equal(observed.signal, controller.signal);
});

it("loads optional test lanes only when their files are present", () => {
  const dir = tmp();
  const indexFile = fileURLToPath(new URL("./index.js", import.meta.url));
  fs.copyFileSync(indexFile, path.join(dir, "index.js"));
  fs.writeFileSync(
    path.join(dir, "studio.test.mjs"),
    "console.log('studio-core');",
  );
  fs.writeFileSync(
    path.join(dir, "sources.test.mjs"),
    "console.log('sources-core');",
  );
  const run = () =>
    execFileSync(process.execPath, [path.join(dir, "index.js")], {
      encoding: "utf8",
    });
  assert.match(run(), /studio-core/);
  for (const lane of ["yaml-tree", "gallery", "markdown", "detect"])
    fs.writeFileSync(
      path.join(dir, `${lane}.test.mjs`),
      `console.log('${lane}-optional');`,
    );
  const output = run();
  for (const lane of ["yaml-tree", "gallery", "markdown", "detect"])
    assert.match(output, new RegExp(`${lane}-optional`));
});

it("uses the detector object contract and keeps explicit mapping overrides", async () => {
  const cache = tmp();
  const run = (cmd, args) =>
    args[0] !== "api"
      ? ""
      : JSON.stringify(
          args[1].includes("/git/trees/")
            ? { tree: [{ path: "data.json", type: "blob" }] }
            : { default_branch: "master", license: { spdx_id: "MIT" } },
        );
  const payload = JSON.stringify({
    rows: [
      {
        title: "Coffee",
        prompt: "coffee prompt",
        video: "https://example.com/a.mp4",
      },
    ],
  });
  const result = await addSource("owner/detected", {
    cache,
    env: {},
    run,
    file: "override.json",
    itemsPath: "rows",
    map: JSON.stringify({ title: "title", content: "prompt", videos: "video" }),
    fetchImpl: async () => fakeResponse(200, payload),
    detectSource: async ({ repo, branch, tree, fetchText }) => {
      assert.equal(repo, "owner/detected");
      assert.equal(branch, "master");
      assert.equal(tree.tree[0].path, "data.json");
      assert.equal(await fetchText("data.json"), payload);
      return {
        adapter: "json-map",
        options: {
          file: "data.json",
          itemsPath: "wrong",
          map: { title: "wrong" },
        },
        kinds: ["video"],
        confidence: "high",
      };
    },
  });
  assert.equal(result.source.file, "override.json");
  assert.equal(result.source.itemsPath, "rows");
  assert.equal(result.source.kinds[0], "video");
  assert.equal(result.entries, 1);
  assert.deepEqual(result.titles, ["Coffee"]);
});

it("check-video exits non-zero when the check fails", async () => {
  const originalWrite = process.stdout.write;
  const originalExit = process.exitCode;
  try {
    let text = "";
    process.stdout.write = (chunk) => {
      text += chunk;
      return true;
    };
    process.exitCode = 0;
    await main(["check-video"]);
    assert.equal(JSON.parse(text).status, "fail");
    assert.equal(process.exitCode, 1);
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExit;
  }
});

it("validates source ids across CLI commands and defaults search to image", async () => {
  const originalWrite = process.stdout.write;
  const originalExit = process.exitCode;
  try {
    for (const command of ["recommend", "search", "sync", "show"]) {
      let text = "";
      process.stdout.write = (chunk) => {
        text += chunk;
        return true;
      };
      await main([command, "coffee", "--source", "not-registered"]);
      const result = JSON.parse(text);
      assert.equal(result.error, "unknown-source");
      assert.ok(result.knownIds.includes("youmind"));
      if (command === "search")
        assert.ok(!result.knownIds.includes("learnprompt-seedance"));
    }
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExit;
  }
});

it("fills a requested limit after three matching model results", () => {
  const entries = Array.from({ length: 5 }, (_, id) => ({
    id,
    sourceId: "one",
    kind: "video",
    title: "Coffee",
    content: `coffee ${id}`,
    videos: [`https://example.com/${id}.mp4`],
    model: id < 3 ? "Seedance 2" : "Kling 3",
  }));
  const results = searchEntries(entries, "coffee", {
    model: "seedance",
    limit: 5,
    perSource: 2,
  });
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((e) => e.modelMismatch),
    [false, false, false, true, true],
  );
});

it("does not write raw data or state when cancelled while reading a body", async () => {
  const cache = tmp();
  const file = path.join(cache, "raw.json");
  const controller = new AbortController();
  const response = fakeResponse(200, "raw");
  response.arrayBuffer = async () => {
    controller.abort();
    return new Uint8Array([1]).buffer;
  };
  const result = await fetchCached("https://example.com/data", file, {
    cache,
    signal: controller.signal,
    fetchImpl: async () => response,
  });
  assert.equal(result.status, "unavailable-aborted");
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(cache, "state.json")), false);
});

it("does not fall back to curl after a native fetch abort", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(init.signal, controller.signal);
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    };
    await assert.rejects(
      defaultFetch({})("https://example.com", { signal: controller.signal }),
      { name: "AbortError" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("explains a search model fallback using a fresh local source", async () => {
  const cache = tmp();
  const source = {
    id: "local-search",
    repo: "owner/repo",
    branch: "main",
    kinds: ["image"],
    adapter: "json-map",
    file: "data.json",
    map: {
      title: "title",
      content: "prompt",
      sourceMedia: "image",
      model: "model",
    },
  };
  fs.writeFileSync(
    path.join(cache, "user-sources.json"),
    JSON.stringify({ sources: [source] }),
  );
  const dir = path.join(cache, source.id);
  fs.mkdirSync(path.join(dir, "raw"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "raw", "data.json"),
    JSON.stringify([
      {
        title: "Coffee",
        prompt: "Coffee photo",
        image: "https://example.com/a.jpg",
        model: "GPT Image 2",
      },
    ]),
  );
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({
      sources: {
        "https://raw.githubusercontent.com/owner/repo/main/data.json": {
          checkedAt: Date.now(),
          fetchedAt: new Date().toISOString(),
        },
      },
    }),
  );
  const previousCache = process.env.PROMPT_STUDIO_CACHE;
  const previousToken = process.env.GH_TOKEN;
  const originalWrite = process.stdout.write;
  let output = "";
  try {
    process.env.PROMPT_STUDIO_CACHE = cache;
    process.env.GH_TOKEN = "fixture-token";
    process.stdout.write = (chunk) => {
      output += chunk;
      return true;
    };
    await main(["search", "coffee", "--source", source.id, "--model", "kling"]);
  } finally {
    process.stdout.write = originalWrite;
    if (previousCache === undefined) delete process.env.PROMPT_STUDIO_CACHE;
    else process.env.PROMPT_STUDIO_CACHE = previousCache;
    if (previousToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousToken;
  }
  const result = JSON.parse(output);
  assert.equal(result.kind, "image");
  assert.equal(result.results[0].modelMismatch, true);
  assert.match(
    result.cacheNote,
    /no kling samples in the libraries; showing other models/,
  );
});

describe("final limit and model boundaries", () => {
  it("rejects invalid recommendation limits before any retrieval", async () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity, "five"]) {
      const result = await recommend("coffee", {
        limit,
        sources: [],
        cache: tmp(),
        env: {},
        run: () => {
          throw new Error("no command");
        },
        fetchImpl: async () => {
          throw new Error("no network");
        },
      });
      assert.equal(result.error, "invalid-limit");
    }
  });
  it("returns invalid-limit with exit 2 for every CLI limit command", async () => {
    const previousEnv = {
      PATH: process.env.PATH,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
    };
    const originalWrite = process.stdout.write;
    const originalExit = process.exitCode;
    try {
      process.env.PATH = tmp();
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      for (const command of ["recommend", "search", "github"]) {
        for (const value of ["0", "-1", "1.5", "NaN", "abc", undefined]) {
          let output = "";
          process.stdout.write = (chunk) => {
            output += chunk;
            return true;
          };
          await main([
            command,
            "",
            "--source",
            "unregistered",
            "--limit",
            ...(value === undefined ? [] : [value]),
          ]);
          assert.equal(JSON.parse(output).error, "invalid-limit");
          assert.equal(process.exitCode, 2);
        }
      }
    } finally {
      process.stdout.write = originalWrite;
      process.exitCode = originalExit;
      for (const [key, value] of Object.entries(previousEnv))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
  });
  it("matches any model in an entry and exposes modelKeys", () => {
    const rows = [
      {
        id: "mixed",
        title: "Coffee",
        kind: "video",
        model: "MiniMax H3 / Seedance 2.5",
        modelKey: "hailuo",
        modelKeys: ["hailuo", "seedance"],
        content: "coffee mixed",
        videos: ["https://example.com/a.mp4"],
      },
      {
        id: "other",
        title: "Coffee",
        kind: "video",
        model: "Kling 3",
        modelKey: "kling",
        content: "coffee other",
        videos: ["https://example.com/b.mp4"],
      },
    ];
    for (const model of ["seedance", "hailuo"]) {
      const results = searchEntries(rows, "coffee", { model });
      assert.equal(results[0].id, "mixed");
      assert.equal(results[0].modelMismatch, false);
      assert.equal(results[1].modelMismatch, true);
      assert.equal("modelKeys" in results[0], true);
    }
    const legacy = { ...rows[0] };
    delete legacy.modelKeys;
    assert.equal(
      searchEntries([legacy], "coffee", { model: "seedance" })[0].modelMismatch,
      false,
    );
  });
  it("does not mark a secondary model as a gallery target mismatch", () => {
    const entries = [
      {
        id: 1,
        model: "MiniMax H3 / Seedance 2.5",
        modelKey: "hailuo",
        modelKeys: ["hailuo", "seedance"],
      },
    ];
    const matched = withTarget([{ id: 1 }], entries, {
      targetModel: "Seedance 2.5",
      targetDurationSec: 6,
    });
    assert.equal(matched[0].modelMismatch, false);
    assert.equal(matched[0].targetDurationSec, 6);
    assert.equal(
      withTarget([{ id: 1 }], entries, { targetModel: "Kling 3" })[0]
        .modelMismatch,
      "Kling 3",
    );
    assert.equal(
      withTarget([{ id: 1, model: "Kling 3" }], entries, {
        targetModel: "Seedance",
      })[0].modelMismatch,
      "Seedance",
    );
  });
});

it("uses candidate target overrides and derives mismatch decisions from keys", () => {
  const entries = [{ id: 1, model: "Seedance 2.5 / Kling 3" }];
  const result = withTarget(
    [
      { id: 1, targetModel: "Kling" },
      { id: 1, targetModel: "Veo" },
      { id: 1, targetModel: "Veo", modelMismatch: false },
    ],
    entries,
    { targetModel: "Seedance", targetDurationSec: 6 },
  );
  assert.equal(result[0].modelMismatch, false);
  assert.equal(result[1].modelMismatch, "Veo");
  assert.equal(result[2].modelMismatch, "Veo");
});

it("C2 parses license aliases conservatively and fills provenance", () => {
  const project = tmp();
  for (const [license, expected] of [
    ["CC-BY-4.0", true],
    ["CC BY 4.0", true],
    ["CC-BY", true],
    ["CC0", false],
    ["MIT", true],
    ["Apache-2.0", true],
    ["GPL-3.0", true],
    ["none declared", "unknown"],
    ["unknown", "unknown"],
  ]) {
    assert.equal(
      writeBrief({ project, license }).attributionRequired,
      expected,
      license,
    );
  }
  const entry = {
    id: "demo:1",
    title: "Original",
    author: "Alice",
    link: "https://example.org/post",
    source: "a/b",
    license: "CC-BY-4.0",
  };
  const out = writeBrief({
    project,
    promptId: entry.id,
    entries: [entry],
    title: "Override",
  });
  const text = fs.readFileSync(out.path, "utf8");
  for (const expected of [
    "# Override",
    "Alice",
    entry.link,
    "a/b",
    entry.license,
  ])
    assert.ok(text.includes(expected));
});

it("C2 balances directions, dedupes content/media and demotes missing references", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    title:
      i < 6 ? "robot mascot" : i === 6 ? "isometric tech" : "network nodes",
    content: `unique prompt ${i}`,
    sourceMedia: [`https://e.org/${i}.png`],
    referenceInputs: i === 0 ? 3 : 0,
  }));
  const out = searchEntries(
    rows,
    "robot mascot | isometric tech | network nodes",
    { limit: 5 },
  );
  assert.ok(out.some((e) => e.id === 6));
  assert.ok(out.some((e) => e.id === 7));
  assert.ok(!out.slice(0, 3).some((e) => e.id === 0));
  assert.equal(searchEntries(rows.slice(0, 2), "robot", { refs: 3 })[0].id, 0);
  const duplicate = {
    ...rows[1],
    id: 100,
    content: " UNIQUE   PROMPT 1 ",
    sourceMedia: ["https://e.org/other.png"],
  };
  assert.equal(searchEntries([rows[1], duplicate], "robot").length, 1);
  assert.equal(
    searchEntries(
      [rows[1], { ...rows[2], sourceMedia: rows[1].sourceMedia }],
      "robot",
    ).length,
    1,
  );
});

it("C2 exposes model tri-state without boolean gallery targets", () => {
  const entries = [
    { id: 1, model: null },
    { id: 2, model: "Seedance" },
    { id: 3, model: "Kling" },
  ];
  const out = withTarget(
    entries.map((e) => ({ id: e.id, modelMismatch: true })),
    entries,
    { targetModel: "Seedance" },
  );
  assert.deepEqual(
    out.map((e) => e.modelMatch),
    ["unknown", "matched", "mismatched"],
  );
  assert.deepEqual(
    out.map((e) => e.modelMismatch),
    [false, false, "Seedance"],
  );
  assert.equal(withTarget([{ id: 1 }], entries, {})[0].modelMatch, "unknown");
});

it("C2 missing drawtext writes crops and a safe Chinese HTML title preview", () => {
  const dir = tmp();
  const file = path.join(dir, "input.png");
  fs.writeFileSync(file, Buffer.from("png"));
  const run = (cmd, args) => {
    if (cmd === "ffmpeg" && args[0] === "-y")
      fs.writeFileSync(args.at(-1), "preview");
    return "";
  };
  const session = detectSession({ project: dir, env: {}, run });
  assert.equal(session.ffmpeg.drawtext, false);
  const out = coverCheck([file], {
    title: "中文标题 <script>",
    outDir: dir,
    run,
  });
  assert.equal(out.ok, true);
  const v = out.variants[0];
  assert.ok(fs.existsSync(v.previews.w340));
  assert.ok(fs.existsSync(v.previews.crop120));
  assert.ok(v.previews.title.endsWith(".html"));
  assert.equal(v.checks.title.status, "unverified");
  assert.match(v.checks.title.error, /drawtext/);
  assert.ok(out.unverified.includes(`${path.basename(file)}: title`));
  const html = fs.readFileSync(v.previews.title, "utf8");
  assert.ok(html.includes("linear-gradient"));
  assert.ok(html.includes("&lt;script&gt;"));
});

it("C2 model states and media availability are explicit in recommendations", () => {
  const rows = [null, "Seedance", "Kling"].map((model, id) => ({
    id,
    title: "coffee",
    content: `coffee ${id}`,
    videos: [`https://e.org/${id}.mp4`],
    model,
  }));
  const result = searchEntries(rows, "coffee", { model: "seedance" });
  assert.equal(result[0].modelMatch, "matched");
  assert.equal(result.find((e) => e.id === 0).modelMatch, "unknown");
  assert.equal(result.find((e) => e.id === 0).modelMismatch, false);
  assert.ok(result.every((e) => typeof e.modelMismatch === "boolean"));
  assert.ok(
    searchEntries(rows, "coffee").every((e) => e.modelMatch === "unknown"),
  );
  const code = searchEntries(
    [
      {
        id: 1,
        kind: "code-video",
        title: "bar chart growth data animation",
        content: "",
      },
      {
        id: 2,
        kind: "code-video",
        title: "bar chart growth data animation",
        content: "",
        videos: ["https://e.org/clip.mp4"],
      },
    ],
    "bar chart growth data animation",
  );
  assert.deepEqual(
    code.map((e) => e.mediaState),
    ["video", "none"],
  );
});

it("C2 font probe rejects a Latin fallback and cover falls back without CJK", async () => {
  const { findCjkFont } = await import("../studio.mjs");
  assert.equal(
    findCjkFont(
      () => "/font/latin.ttf\nen|fr",
      (p) => p === "/font/latin.ttf",
    ),
    null,
  );
  assert.equal(
    findCjkFont(
      () => "/font/cjk.ttc\nen|zh-cn|ja",
      (p) => p === "/font/cjk.ttc",
    ),
    "/font/cjk.ttc",
  );
  assert.equal(
    findCjkFont(
      () => {
        throw Error("no fc-match");
      },
      (p) => p === "/System/Library/Fonts/PingFang.ttc",
    ),
    "/System/Library/Fonts/PingFang.ttc",
  );
  const dir = tmp(),
    file = path.join(dir, "cover.png");
  fs.writeFileSync(file, "image");
  const result = coverCheck([file], {
    title: "中文",
    outDir: dir,
    capabilities: {
      ffmpeg: { available: true, drawtext: true },
      cjkFont: null,
    },
    run: (_cmd, args) => fs.writeFileSync(args.at(-1), "image"),
  });
  assert.equal(result.ok, true);
  assert.match(result.variants[0].checks.title.error, /CJK-capable font/);
  assert.equal(result.variants[0].checks.w340.status, "written");
});

it("C2 cache note only suggests rerunning initial downloads with fewer than three hits", async () => {
  const src = {
    id: "fixture",
    repo: "o/r",
    kinds: ["image"],
    adapter: "json-map",
    file: "rows.json",
    map: { title: "title", content: "content", sourceMedia: "image" },
  };
  for (const count of [2, 3]) {
    const cache = tmp();
    const dir = path.join(cache, src.id, "raw");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, src.file),
      JSON.stringify(
        Array.from({ length: count }, (_, id) => ({
          id,
          title: "robot",
          content: `robot ${id}`,
          image: `https://e.org/${id}.png`,
        })),
      ),
    );
    const opts = {
      cache,
      sources: [src, { ...src, id: "cold" }],
      sourceIds: ["fixture", "cold"],
      waitSec: 0,
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(Error("abort")), {
            once: true,
          }),
        ),
      spawnImpl: fakeSpawn,
    };
    const out = await recommend("robot", opts);
    assert.deepEqual(out.downloading, ["cold"]);
    assert.deepEqual(out.refreshing, ["fixture"]);
    assert.equal(/rerun/i.test(out.cacheNote), count < 3);
    assert.equal(out.directions[0].hits, count);
  }
});

it("C2 a generic direction cannot consume the only match for a specific direction", () => {
  const rows = [
    {
      id: 1,
      title: "robot robot mascot network nodes",
      content: "a",
      sourceMedia: ["https://e.org/1.png"],
    },
    {
      id: 2,
      title: "robot mascot",
      content: "b",
      sourceMedia: ["https://e.org/2.png"],
    },
  ];
  const out = searchEntries(rows, "robot mascot | network nodes", { limit: 2 });
  assert.deepEqual(
    new Set(out.map((e) => e.direction)),
    new Set(["robot mascot", "network nodes"]),
  );
});

it("C2 reassigns overlapping samples to preserve three feasible directions", () => {
  const rows = [
    {
      id: 1,
      title: "alpha beta gamma",
      content: "one",
      sourceMedia: ["https://e.org/a.png"],
    },
    {
      id: 2,
      title: "alpha",
      content: "two",
      sourceMedia: ["https://e.org/b.png"],
    },
    {
      id: 3,
      title: "beta gamma",
      content: "three",
      sourceMedia: ["https://e.org/c.png"],
    },
  ];
  const out = searchEntries(rows, "alpha | beta | gamma", { limit: 3 });
  assert.deepEqual(
    out.map((e) => e.direction),
    ["alpha", "beta", "gamma"],
  );
});

it("R2 references subtract a scaled penalty without partitioning ranking", () => {
  const rows = [
    {
      id: 1,
      title: "korean friends late night ramen",
      content: "reference image",
      sourceMedia: ["https://e.org/1.png"],
    },
    {
      id: 2,
      title: "ramen",
      content: "food",
      sourceMedia: ["https://e.org/2.png"],
    },
  ];
  const result = searchEntries(rows, "korean friends late night ramen");
  assert.equal(result[0].id, 1);
  const supplied = searchEntries(rows, "korean friends late night ramen", {
    refs: 1,
  });
  assert.equal(supplied[0].score - result[0].score, 3);
  const plain = rows.map((e) => ({
    ...e,
    content: `No reference image. Scene ${e.id}`,
    needReferenceImages: false,
  }));
  assert.deepEqual(
    searchEntries(plain, "korean friends late night ramen").map((e) => [
      e.id,
      e.score,
    ]),
    [
      [1, 9.85],
      [2, 0.31],
    ],
  );
  assert.deepEqual(
    searchEntries(plain, "korean friends late night ramen"),
    searchEntries(plain, "korean friends late night ramen", { refs: 10 }),
  );
});

it("R2 reserved directions need half-token coverage and final scores descend", () => {
  const rows = [
    { id: 1, title: "bar", content: "one", kind: "code-video" },
    { id: 2, title: "data animation", content: "two", kind: "code-video" },
    { id: 3, title: "chart growth", content: "three", kind: "code-video" },
  ];
  const out = searchEntries(rows, "bar chart growth | data animation", {
    limit: 2,
  });
  assert.ok(!out.some((e) => e.id === 1));
  assert.ok(out[0].score >= out[1].score);
});

it("R2 withTarget corrects stale explicit states and keeps both model fields consistent", () => {
  const entries = [{ id: 1, model: "Kling" }];
  const out = withTarget(
    [
      { id: 1, modelMatch: "matched" },
      { id: 1, modelMatch: "mismatched", modelMismatch: false },
      { id: 1, modelMismatch: false },
    ],
    entries,
    { targetModel: "Seedance" },
  );
  assert.deepEqual(
    out.map((e) => [e.modelMatch, e.modelMismatch]),
    [
      ["mismatched", "Seedance"],
      ["mismatched", "Seedance"],
      ["mismatched", "Seedance"],
    ],
  );
});

it("R2 stalled fetch is aborted within the per-request deadline", async () => {
  let signal;
  const dir = tmp();
  const out = await fetchCached(
    "https://example.com/stalled",
    path.join(dir, "raw"),
    {
      cache: dir,
      requestTimeoutMs: 10,
      fetchImpl: async (_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      },
    },
  );
  assert.equal(signal.aborted, true);
  assert.match(out.status, /timeout/);
});

it("R2 final score order keeps unavailable code examples below playable samples", () => {
  const rows = [
    {
      id: 1,
      kind: "code-video",
      title: "bar chart growth bar chart",
      content: "",
    },
    {
      id: 2,
      kind: "code-video",
      title: "data animation",
      content: "",
      videos: ["https://e.org/live.mp4"],
    },
  ];
  const out = searchEntries(rows, "bar chart growth | data animation");
  assert.equal(out[0].id, 2);
  assert.ok(out[0].score > out[1].score);
});

it("R2 proxy media probes use HEAD rather than downloading a video", async () => {
  const result = await curlFetch(
    "https://example.com/video.mp4",
    { method: "HEAD" },
    async (_cmd, args) => {
      assert.ok(args.includes("--head"));
      return "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\n\r\n";
    },
  );
  assert.equal(result.status, 200);
});

it("R3 streaming bytes reset idle timeout while a total cap remains", async () => {
  const dir = tmp();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 10));
          controller.enqueue(new Uint8Array([65]));
        }
        controller.close();
      },
    }),
  });
  const out = await fetchCached("https://e.org/slow", path.join(dir, "slow"), {
    cache: dir,
    requestTimeoutMs: 30,
    totalTimeoutMs: 200,
    fetchImpl,
  });
  assert.equal(out.status, "updated");
  assert.equal(fs.readFileSync(path.join(dir, "slow"), "utf8"), "AAAAA");
  const capped = await fetchCached("https://e.org/cap", path.join(dir, "cap"), {
    cache: dir,
    requestTimeoutMs: 30,
    totalTimeoutMs: 35,
    fetchImpl,
  });
  assert.match(capped.status, /timeout/);
});

it("R3 an untrusted reference flag only breaks score ties", () => {
  const rows = [
    {
      id: 1,
      title: "robot",
      content: "forest",
      sourceMedia: ["https://e.org/1.png"],
      needReferenceImages: true,
    },
    {
      id: 2,
      title: "robot",
      content: "trees",
      sourceMedia: ["https://e.org/2.png"],
    },
  ];
  const out = searchEntries(rows, "robot");
  assert.equal(out[0].id, 2);
  assert.equal(out[0].score, out[1].score);
  assert.ok(
    out.every((e) => e.referenceInputs === 0 && !e.needReferenceImages),
  );
});

it("R3 body inactivity times out without writing a partial cache", async () => {
  const dir = tmp(),
    file = path.join(dir, "partial");
  let signal;
  const out = await fetchCached("https://e.org/idle", file, {
    cache: dir,
    requestTimeoutMs: 10,
    totalTimeoutMs: 100,
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
        }),
      };
    },
  });
  assert.match(out.status, /timeout/);
  assert.match(out.error, /idle/);
  assert.equal(signal.aborted, true);
  assert.equal(fs.existsSync(file), false);
});

it("R3 curl reports arriving bytes to the idle clock", async () => {
  let progress = 0;
  await curlFetch(
    "https://e.org/slow",
    { onProgress: () => progress++, progressIntervalMs: 2 },
    async (_cmd, args) => {
      assert.ok(args.includes("--no-buffer"));
      assert.equal(args[args.indexOf("--max-time") + 1], "600");
      const file = args[args.indexOf("-o") + 1];
      for (let i = 0; i < 3; i++) {
        fs.appendFileSync(file, "bytes");
        await new Promise((r) => setTimeout(r, 10));
      }
      return "HTTP/1.1 200 OK\r\n\r\n";
    },
  );
  assert.ok(progress >= 2);
});

it("round 2 resolves channel keys and preserves curated provenance", () => {
  const [c] = withTarget(
    [{ id: "x" }],
    [
      {
        id: "x",
        model: "GPT Image 2",
        source: "YouMind-OpenLab/test",
        curatedSource: true,
      },
    ],
    { targetModel: "Codex image_gen" },
  );
  assert.equal(c.modelMatch, "matched");
  assert.deepEqual(c.modelKeys, ["gpt-image"]);
  assert.equal(c.targetModelKey, "gpt-image");
  assert.match(c.versionNote, /version is not stated/);
  assert.equal(c.sourceUrl, "https://github.com/YouMind-OpenLab/test");
  assert.equal(c.curatedSource, true);
  assert.equal(
    withTarget([{ model: "grok-imagine-video" }], [], {
      targetModel: "Grok Imagine",
    })[0].modelMatch,
    "matched",
  );
});

it("round 3 measures relevance without technique terms and keeps subjects", () => {
  const entry = (id, title, model) => ({
    id,
    title,
    model,
    content: `${title} ${id}`,
    sourceMedia: [`https://example.com/${id}.jpg`],
  });
  const entries = [
    entry("wrong", "coffee steam cinematic latte close-up", "Seedance"),
    entry("unknown", "coffee steam", null),
    entry("a", "coffee", "Grok"),
    entry("b", "latte", "Grok"),
  ];
  assert.deepEqual(
    searchEntries(entries, "coffee steam cinematic | latte close-up", {
      model: "grok-imagine",
      limit: 4,
    }).map((e) => e.modelMatch),
    ["matched", "unknown", "mismatched", "matched"],
  );
  const cats = [
    entry("person", "pastel kawaii birthday party hat cake", null),
    entry("girl", "pastel kawaii cat-girl birthday party hat cake", null),
    {
      ...entry("human", "Kawaii Girl With Manga Wall Doodle", null),
      content: "A girl with a tiny cat doodle; pastel birthday party hat cake",
    },
    entry("cat1", "kitten birthday", null),
    entry("cat2", "cat cake", null),
    entry("cat3", "kitten party", null),
  ];
  assert.ok(
    searchEntries(
      cats,
      "cute kitten birthday | kitten party hat cake | pastel kawaii cat",
      { limit: 3 },
    ).every((e) => e.id.startsWith("cat")),
  );
  assert.match(
    searchEntries(cats, "pastel kawaii birthday | cake", {
      subject: "kitten cat",
      limit: 1,
    })[0].id,
    /^cat/,
  );
});

it("round 2 prefers short single-shot image-to-video prompts", () => {
  const base = {
    title: "coffee steam",
    sourceMedia: ["https://example.com/a.jpg"],
    model: "Grok",
    kind: "video",
  };
  const entries = [
    {
      ...base,
      id: "long",
      content: "coffee steam 00:00-00:10 shot 1; 00:10-00:30 shot 2",
      durationSec: 30,
      mode: "text-to-video",
    },
    {
      ...base,
      id: "short",
      sourceMedia: ["https://example.com/b.jpg"],
      content: "coffee steam gentle push-in",
      durationSec: 5,
      mode: "image-to-video",
    },
  ];
  assert.equal(
    searchEntries(entries, "coffee steam", { mode: "image-to-video" })[0].id,
    "short",
  );
});

it("round 2 extracts posters with bounded parallelism, cache and silent failure", async () => {
  const { galleryPage } = await import("../studio.mjs");
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "ps-posters-"));
  let active = 0,
    peak = 0,
    calls = 0;
  const entries = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    kind: "code-video",
    title: `Clip ${i}`,
    content: "",
    videos: [`https://example.com/${i}.mp4`],
    sourceMedia: [],
  }));
  const runner = async (cmd, args, opts) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    assert.equal(cmd, "ffmpeg");
    assert.equal(opts.timeout, 15000);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (args.includes("https://example.com/4.mp4")) throw Error("offline");
    fs.writeFileSync(args.at(-1), "poster");
  };
  try {
    const options = {
      project,
      entries,
      candidates: entries.map((e) => ({ id: e.id })),
      posterRunner: runner,
    };
    const result = await galleryPage(options);
    assert.equal(peak, 3);
    assert.equal(calls, 10);
    assert.match(fs.readFileSync(result.file, "utf8"), /posters/);
    await galleryPage(options);
    assert.equal(calls, 10);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

it("C3 revision ranks relevance before model and shot shape within bands", () => {
  const entry = (id, title, model, content = title) => ({
    id,
    title,
    model,
    content,
    kind: "video",
    videos: [`https://example.com/${id}.mp4`],
    durationSec: 5,
  });
  const rows = [
    entry("dragon", "dragon slow motion", "Grok"),
    entry("coffee", "hot coffee cup steam", "Veo"),
    entry("same", "coffee cup steam", "Grok"),
    entry(
      "long",
      "hot coffee cup steam",
      "Grok",
      "coffee cup steam 00:00-00:30 shot 2",
    ),
  ];
  rows.find((e) => e.id === "long").durationSec = 30;
  const opts = { model: "grok-imagine", mode: "image-to-video", limit: 4 };
  const result = searchEntries(
    rows,
    "hot coffee cup steam | latte close-up slow push-in",
    opts,
  );
  assert.deepEqual(
    result.map((e) => e.id),
    ["same", "long", "coffee", "dragon"],
  );
  assert.equal(result[2].modelMismatch, true);
  assert.equal(result[3].relevant, false);
  assert.equal(
    searchEntries(
      rows.filter((e) => !["same", "long"].includes(e.id)),
      "hot coffee cup steam | latte close-up slow push-in",
      opts,
    )[0].id,
    "coffee",
  );
});

it("C3 revision keeps model fallback and explains no relevant match", async () => {
  const rows = [
    {
      id: "v",
      title: "slow dragon",
      content: "slow dragon",
      model: "Veo",
      videos: ["https://example.com/v.mp4"],
    },
    {
      id: "g",
      title: "slow dragon",
      content: "slow dragon g",
      model: "Grok",
      videos: ["https://example.com/g.mp4"],
    },
  ];
  const result = searchEntries(rows, "coffee cup steam slow", {
    model: "grok-imagine",
    subject: "coffee",
  });
  assert.equal(result[0].id, "g");
  assert.ok(result.every((e) => e.relevant === false));
  assert.equal(
    result[0].relevanceNote,
    "no close match for coffee; showing nearest by model",
  );
});

it("C3 round 3 ignores technique-only relevance but still scores technique words", async () => {
  const { GENERIC_TECHNIQUE_WORDS } = await import("../studio.mjs");
  assert.ok(GENERIC_TECHNIQUE_WORDS.includes("close"));
  const entry = (id, title, model) => ({
    id,
    title,
    model,
    content: title,
    kind: "video",
    durationSec: 5,
    videos: [`https://example.com/${id}.mp4`],
  });
  const rows = [
    entry("dragon", "dragon close up slow cinematic", "Grok"),
    entry(
      "coconut",
      "coconut oil slow push in luxury product commercial",
      "Grok",
    ),
    entry("coffee", "hot coffee cup steam", "Veo"),
  ];
  const query = "hot coffee cup steam | latte close-up slow push-in";
  const opts = { model: "grok-imagine", mode: "image-to-video", limit: 5 };
  const results = searchEntries(rows, query, opts);
  assert.equal(results[0].id, "coffee");
  assert.equal(results[0].modelMismatch, true);
  assert.ok(results.slice(1).every((e) => !e.relevant));
  const matched = searchEntries(
    [...rows, entry("same", "latte cup", "Grok")],
    query,
    opts,
  );
  assert.equal(matched[0].id, "same");
  assert.equal(matched.find((e) => e.id === "same").modelMatch, "matched");
  assert.equal(matched.find((e) => e.id === "same").relevance, "strong");
  const generic = searchEntries(
    rows,
    "cinematic slow motion | close up camera",
    opts,
  );
  assert.ok(generic.length > 0);
  assert.ok(generic.every((e) => !e.relevant));
  assert.ok(generic[0].score > 0);
  const mixed = searchEntries(rows, "coffee | cinematic slow motion", opts);
  assert.equal(mixed[0].id, "coffee");
  assert.ok(mixed.slice(1).every((e) => !e.relevant));
  const shared = searchEntries(
    rows,
    "coffee cinematic | latte cinematic",
    opts,
  );
  assert.equal(shared[0].id, "coffee");
  assert.ok(shared.every((e) => !e.subjectMatch));
  const explicit = searchEntries(rows, "coffee | cinematic slow motion", {
    ...opts,
    subject: "latte cinematic",
  });
  assert.ok(explicit.every((e) => !e.relevant));
});

it("C4 duration and aspect ratios do not penalize short clips; score stays relevance", () => {
  const rows = [
    { id: 1, content: "coffee 9:16" },
    {
      id: 2,
      content: "coffee 0-2s: bloom 2-4s: pour 4-6s: finish",
      durationSec: 6,
    },
    {
      id: 3,
      content: "coffee 00:00 pour 00:10 bloom 00:20 finish",
      durationSec: 30,
    },
  ].map((e) => ({
    kind: "video",
    title: "coffee",
    sourceMedia: [`https://example.com/${e.id}.jpg`],
    ...e,
  }));
  const plain = searchEntries(rows, "coffee");
  const result = searchEntries(rows, "coffee", { mode: "image-to-video" });
  for (const id of [1, 2])
    assert.equal(result.find((e) => e.id === id).modePreference, 8);
  assert.equal(result.find((e) => e.id === 3).modePreference, -18);
  for (const e of result)
    assert.equal(e.score, plain.find((p) => p.id === e.id).score);
});
it("C4 IDF relevance rejects incidental cup and steam despite model match", () => {
  const rows = [
    { id: 1, title: "green tea", content: "cup steam", model: "Grok" },
    { id: 2, title: "hot coffee", content: "coffee latte", model: "Veo" },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: i + 3,
      title: `tea ${i}`,
      content: "cup steam",
      model: "Veo",
    })),
  ].map((e) => ({
    kind: "video",
    sourceMedia: [`https://example.com/${e.id}.jpg`],
    ...e,
  }));
  const result = searchEntries(
    rows,
    "hot coffee cup steam | latte close-up slow push-in",
    { model: "grok-imagine", limit: 10 },
  );
  assert.equal(result[0].id, 2);
  assert.equal(result.find((e) => e.id === 1).relevant, false);
});
it("C4 fallback notes respect model and generic-only directions", () => {
  const rows = [
    {
      id: 1,
      title: "tea",
      content: "tea",
      sourceMedia: ["https://example.com/a.jpg"],
    },
  ];
  assert.match(
    searchEntries(rows, "tea coffee nebula galaxy")[0].relevanceNote,
    /nearest by keywords/,
  );
  assert.equal(
    searchEntries(rows, "product commercial")[0]?.relevanceNote,
    undefined,
  );
});
it("C4 known model versions remain matched with both versions in notes", () => {
  for (const [sample, target] of [
    ["Seedance 2.0", "Seedance 2.5"],
    ["GPT Image 2", "GPT Image 1"],
  ]) {
    const [entry] = withTarget([{ model: sample }], [], {
      targetModel: target,
    });
    assert.equal(entry.modelMatch, "matched");
    assert.ok(entry.versionNote.includes(sample));
    assert.ok(entry.versionNote.includes(target));
  }
  for (const [sample, target] of [
    ["Nano Banana", "gemini-2.5-flash-image"],
    ["Gemini 3 Pro Image", "Nano Banana"],
  ])
    assert.equal(
      withTarget([{ model: sample }], [], { targetModel: target })[0]
        .modelMatch,
      "matched",
    );
  assert.equal(
    withTarget([{ model: "Nano Banana" }], [], { targetModel: "Gemini" })[0]
      .modelMatch,
    "mismatched",
  );
});
it("C4 posters reject local URLs and cache failures for one hour", async () => {
  const { galleryPage } = await import("../studio.mjs");
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "ps-c4-"));
  let calls = 0;
  const options = {
    project,
    entries: [],
    candidates: [
      { id: "local", videos: ["file:///tmp/local.mp4"] },
      { id: "remote", videos: ["https://example.com/fail.mp4"] },
    ],
    posterRunner: async (_cmd, args) => {
      calls++;
      assert.equal(
        args[args.indexOf("-i") + 1],
        "https://example.com/fail.mp4",
      );
      assert.ok(args.indexOf("-protocol_whitelist") < args.indexOf("-i"));
      assert.equal(
        args[args.indexOf("-protocol_whitelist") + 1],
        "https,tls,tcp",
      );
      throw Error("offline");
    },
  };
  try {
    await galleryPage(options);
    await galleryPage(options);
    assert.equal(calls, 2);
    const dir = path.join(project, ".prompt-studio", "gallery", "posters");
    const marker = path.join(
      dir,
      fs.readdirSync(dir).find((f) => f.endsWith(".fail")),
    );
    const old = new Date(Date.now() - 3601000);
    fs.utimesSync(marker, old, old);
    await galleryPage(options);
    assert.equal(calls, 4);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

it("C4 round 2 demotes incidental coffee cameraman matches before model ordering", () => {
  const rows = [
    {
      id: "camera",
      title: "Tiny cameraman desk run with timed story beats",
      content: "A tiny cameraman runs past a hot coffee cup with steam",
      model: "Grok",
      durationSec: 6,
    },
    {
      id: "coffee",
      title: "Hot coffee cup steam",
      content: "Coffee bloom resurrection, latte close-up slow push-in",
      model: "Veo",
      durationSec: 6,
    },
    {
      id: "espresso",
      title: "Hot coffee cup steam espresso",
      content: "Coffee espresso latte close-up slow push-in",
      model: null,
      durationSec: 8,
    },
    {
      id: "dragon",
      title: "Dragon cinematic",
      content: "cinematic slow push-in",
      model: "Grok",
    },
  ].map((e) => ({
    kind: "video",
    videos: [`https://example.com/${e.id}.mp4`],
    ...e,
  }));
  const query = "hot coffee cup steam | latte close-up slow push-in";
  const result = searchEntries(rows, query, {
    model: "grok-imagine",
    mode: "image-to-video",
    limit: 4,
  });
  const camera = result.find((e) => e.id === "camera");
  const coffee = result.find((e) => e.id === "coffee");
  assert.equal(camera.relevance, "weak");
  assert.equal(camera.relevant, false);
  assert.ok(camera.score < coffee.score * 0.5);
  assert.equal(coffee.relevance, "strong");
  assert.ok(result.indexOf(camera) > result.indexOf(coffee));
  assert.deepEqual(
    result.map((e) => e.id),
    ["espresso", "coffee", "camera", "dragon"],
  );
  assert.equal(result.at(-1).relevance, false);
  const withoutMode = searchEntries(rows, query, {
    model: "grok-imagine",
    limit: 4,
  });
  for (const e of result)
    assert.equal(e.relevance, withoutMode.find((p) => p.id === e.id).relevance);
});

it("C4 round 2 weak entries use score before model or mode preferences", () => {
  const rows = [
    {
      id: "best",
      title: "coffee cup steam",
      content: "coffee",
      model: "Veo",
    },
    {
      id: "weak-unknown",
      title: "desk",
      content: "coffee cup steam on a desk",
      model: null,
      mode: "text-to-video",
    },
    {
      id: "weak-matched",
      title: "camera",
      content: "coffee cup beside a camera",
      model: "Grok",
      mode: "image-to-video",
    },
  ].map((e) => ({
    kind: "video",
    videos: [`https://example.com/${e.id}.mp4`],
    durationSec: 6,
    ...e,
  }));
  const r = searchEntries(rows, "coffee cup steam", {
    subject: "coffee",
    model: "grok-imagine",
    mode: "image-to-video",
    limit: 3,
  });
  assert.deepEqual(
    r.map((e) => e.relevance),
    ["strong", "weak", "weak"],
  );
  assert.deepEqual(
    r.map((e) => e.id),
    ["best", "weak-unknown", "weak-matched"],
  );
  assert.ok(r[1].score > r[2].score);
});

it("C4 round 3 keeps low-score tag-only coffee strong below a body-heavy leader", () => {
  const rows = [
    {
      id: "long",
      title: "Hot coffee cup steam latte",
      content: "hot coffee cup steam latte close-up slow push-in ".repeat(80),
      model: "Veo",
      durationSec: 30,
    },
    {
      id: "tag",
      title: "Espresso Pour",
      tags: ["coffee"],
      content: "A short crema pour",
      model: "Veo",
      durationSec: 6,
    },
    {
      id: "camera",
      title: "Tiny cameraman desk run",
      content: "hot coffee cup steam beside a camera",
      model: "Grok",
      durationSec: 6,
    },
  ].map((e) => ({
    kind: "video",
    videos: [`https://example.com/${e.id}.mp4`],
    ...e,
  }));
  const query = "hot coffee cup steam | latte close-up slow push-in";
  for (const subject of ["coffee", undefined]) {
    // The tag-only case passes the existing rule through the explicit subject.
    // Without a subject, enough query tokens must still match before header rescue.
    const entries = subject
      ? rows
      : rows.map((e) =>
          e.id === "tag" ? { ...e, content: "hot coffee cup steam pour" } : e,
        );
    const r = searchEntries(entries, query, {
      subject,
      model: "grok-imagine",
      mode: "image-to-video",
      limit: 3,
    });
    const tag = r.find((e) => e.id === "tag"),
      long = r.find((e) => e.id === "long"),
      camera = r.find((e) => e.id === "camera");
    assert.ok(tag.score < long.score * 0.5);
    assert.equal(tag.relevance, "strong");
    assert.equal(tag.relevant, true);
    assert.equal(camera.relevance, "weak");
    assert.ok(r.indexOf(tag) < r.indexOf(camera));
  }
  const irrelevant = searchEntries(rows, query, {
    model: "grok-imagine",
    limit: 3,
  }).find((e) => e.id === "tag");
  assert.equal(irrelevant.relevance, false);
});

it("C5 version and evidence fields on results and gallery candidates", () => {
  for (const [model, target, version] of [
    ["Seedance 2.5", "Seedance 2.0", "different"],
    ["GPT Image 2", "Codex image_gen", "unknown"],
    ["Seedance 2.0", "Seedance 2.0", "same"],
  ]) {
    const e = {
      id: "v",
      title: "coffee",
      content: "coffee",
      model,
      license: "MIT",
      videos: ["https://e.org/v.mp4"],
    };
    for (const c of [
      withTarget([{ id: "v" }], [e], { targetModel: target })[0],
      searchEntries([e], "coffee", { model: target })[0],
    ]) {
      assert.equal(c.modelMatch, "matched");
      assert.equal(c.versionMatch, version);
      assert.equal(c.sampleVersion, model.match(/\d+(?:\.\d+)*/)[0]);
      assert.equal(c.evidence, "clip");
      assert.equal(c.licenseStatus, "open");
    }
  }
  for (const [media, evidence] of [
    [{ sourceMedia: ["https://e.org/a.jpg"] }, "still"],
    [{}, "none"],
  ]) {
    const e = {
      id: "x",
      kind: "code-video",
      title: "coffee",
      content: "coffee",
      ...media,
    };
    assert.equal(withTarget([{ id: "x" }], [e], {})[0].evidence, evidence);
    assert.equal(searchEntries([e], "coffee")[0].evidence, evidence);
  }
  const [c] = withTarget(
    [{ id: "x" }],
    [
      {
        id: "x",
        kind: "code-video",
        model: "Claude Opus 4.5",
        content: "Use Remotion",
      },
    ],
    { targetModel: "Hyperframes" },
  );
  assert.equal(c.modelMatch, "mismatched");
  assert.equal(c.renderEngine, "remotion");
  assert.equal(c.authoringModel, "Claude Opus 4.5");
  assert.equal(c.versionMatch, null);
});

it("C5 check-video validates geometry and unavailable probe", async () => {
  const { checkVideo } = await import("../studio.mjs");
  const file = path.join(tmp(), "clip.mp4");
  fs.writeFileSync(file, "fixture");
  const probeRunner =
    (width, height, duration = "5") =>
    async () => ({
      stdout: JSON.stringify({
        streams: [{ width, height }],
        format: { duration },
      }),
    });
  const fail = await checkVideo(file, {
    ratio: "16:9",
    duration: 5,
    probeRunner: probeRunner(736, 400),
  });
  assert.equal(fail.status, "fail");
  assert.match(fail.checks.find((c) => c.name === "ratio").fix, /ffmpeg.*pad=/);
  assert.equal(
    (
      await checkVideo(file, {
        ratio: "16:9",
        size: "1280x720",
        duration: 5,
        probeRunner: probeRunner(1280, 720),
      })
    ).status,
    "pass",
  );
  assert.equal(
    (
      await checkVideo(file, {
        probeRunner: async () => {
          throw Object.assign(Error("spawn ffprobe ENOENT"), {
            code: "ENOENT",
          });
        },
      })
    ).status,
    "unverified",
  );
});

it("C5 chooses the larger timed poster ahead of library artwork", async () => {
  const { galleryPage } = await import("../studio.mjs");
  const dir = tmp();
  const times = [];
  const result = await galleryPage({
    project: dir,
    entries: [
      {
        id: "v",
        videos: ["https://e.org/v.mp4"],
        sourceMedia: ["https://e.org/library.jpg"],
        durationSec: 10,
      },
    ],
    candidates: [{ id: "v" }],
    posterRunner: async (_cmd, args) => {
      const time = args[args.indexOf("-ss") + 1];
      times.push(time);
      fs.writeFileSync(args.at(-1), Buffer.alloc(time === "4" ? 200 : 20));
    },
  });
  assert.deepEqual(times, ["1", "4"]);
  const html = fs.readFileSync(result.file, "utf8");
  const posterDir = path.join(dir, ".prompt-studio", "gallery", "posters");
  const kept = fs
    .readdirSync(posterDir)
    .map((name) => path.join(posterDir, name))
    .filter((file) => file.endsWith(".jpg") && html.includes(file));
  assert.equal(kept.length, 1);
  assert.equal(fs.statSync(kept[0]).size, 200);
  assert.ok(html.indexOf(kept[0]) < html.indexOf("https://e.org/library.jpg"));
});

it("C5 passes every license summary to search and gallery", () => {
  for (const [license, expected] of [
    ["MIT", "open"],
    ["CC BY 4.0", "attribution"],
    ["AGPL-3.0", "copyleft"],
    ["Apache-2.0 (code template license)", "template"],
    ["No license declared", "unstated"],
  ]) {
    const e = {
      id: "x",
      kind: "code-video",
      title: "coffee",
      content: "coffee",
      license,
    };
    assert.equal(searchEntries([e], "coffee")[0].licenseStatus, expected);
    assert.equal(withTarget([{ id: "x" }], [e], {})[0].licenseStatus, expected);
  }
});

it("C5 R2 keeps either successful frame and marks only total failure", async () => {
  const { galleryPage } = await import("../studio.mjs");
  for (const mode of ["first", "second", "missing-second", "none"]) {
    const project = tmp(),
      times = [];
    const options = {
      project,
      entries: [{ id: "v", videos: ["https://e.org/v.mp4"] }],
      candidates: [{ id: "v" }],
      posterRunner: async (_cmd, args) => {
        const time = Number(args[args.indexOf("-ss") + 1]);
        times.push(time);
        if (
          ((mode === "first" || mode === "missing-second") && time === 1) ||
          (mode === "second" && time === 3)
        )
          fs.writeFileSync(args.at(-1), Buffer.alloc(50));
        else if (mode !== "missing-second") throw Error("frame unavailable");
      },
    };
    const result = await galleryPage(options);
    const files = fs.readdirSync(
      path.join(project, ".prompt-studio", "gallery", "posters"),
    );
    assert.deepEqual(times, [1, 3]);
    assert.equal(
      files.some((f) => f.endsWith(".fail")),
      mode === "none",
    );
    assert.equal(
      files.some((f) => f.endsWith(".jpg")),
      mode !== "none",
    );
    if (mode !== "none")
      assert.ok(
        fs
          .readFileSync(result.file, "utf8")
          .includes(files.find((f) => f.endsWith(".jpg"))),
      );
    await galleryPage(options);
    assert.equal(times.length, 2);
  }
});

it("C5 R2 clamps short-clip timestamps, rounds and deduplicates", async () => {
  const { galleryPage } = await import("../studio.mjs");
  for (const [durationSec, expected] of [
    [0.5, [0.45, 0.2]],
    [7, [1, 2.8]],
    [2.5, [1]],
  ]) {
    const times = [];
    await galleryPage({
      project: tmp(),
      entries: [{ id: "v", durationSec, videos: ["https://e.org/v.mp4"] }],
      candidates: [{ id: "v" }],
      posterRunner: async (_cmd, args) => {
        times.push(Number(args[args.indexOf("-ss") + 1]));
        fs.writeFileSync(args.at(-1), "frame");
      },
    });
    assert.deepEqual(times, expected);
  }
});

it("C5 R2 normalizes versions and distinguishes tiers", () => {
  for (const [model, target, expected] of [
    ["Seedance 2.0", "Seedance 2", "same"],
    ["Veo 3.1,", "Veo 3.1", "same"],
    ["Kling2.5", "Kling 2.5", "same"],
    ["Seedance 1.0 Lite", "Seedance 1.0 Pro", "different"],
    ["Veo 3 Fast", "Veo 3 Turbo", "different"],
    ["Veo 3 Fast", "Veo 3", "different"],
  ]) {
    const c = withTarget([{ model }], [], { targetModel: target })[0];
    assert.equal(c.modelMatch, "matched", model);
    assert.equal(c.versionMatch, expected, model);
    assert.equal(Boolean(c.versionNote), expected === "different", model);
  }
});

it("C5 R2 check-video separates corrections, read errors and rotation", async () => {
  const { checkVideo } = await import("../studio.mjs");
  const file = path.join(tmp(), "clip.mp4");
  fs.writeFileSync(file, "fixture");
  const probe = (rotation) => async () => ({
    stdout: JSON.stringify({
      streams: [{ width: 1280, height: 720, side_data_list: [{ rotation }] }],
      format: { duration: "5" },
    }),
  });
  for (const rotation of [90, -90]) {
    const result = await checkVideo(file, {
      ratio: "9:16",
      probeRunner: probe(rotation),
    });
    assert.equal(result.status, "pass");
    assert.equal(result.width, 720);
    assert.equal(result.height, 1280);
  }
  const failure = await checkVideo(file, {
    ratio: "1:1",
    probeRunner: probe(0),
  });
  assert.match(failure.checks[0].fix, /pad=/);
  assert.doesNotMatch(failure.checks[0].fix, /crop alternative|crop=/);
  assert.match(failure.checks[0].alternative, /crop=/);
  for (const input of [undefined, `${file}.missing`]) {
    const result = await checkVideo(input, {
      probeRunner: async () => {
        throw Error("must not run");
      },
    });
    assert.equal(result.status, "fail");
    assert.equal(result.checks[0].name, "readable");
    assert.match(result.error, /file|input/i);
  }
  const invalid = await checkVideo(file, {
    probeRunner: async () => ({ stdout: '{"streams":[]}' }),
  });
  assert.equal(invalid.status, "fail");
  assert.doesNotMatch(invalid.checks[0].fix, /Install/);
  const missingProbe = await checkVideo(file, {
    probeRunner: async () => {
      throw Object.assign(Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    },
  });
  assert.equal(missingProbe.status, "unverified");
});

it("C5 R2 license scope survives recommend and gallery projections", () => {
  for (const [license, expected, templateCatalog] of [
    [
      "MIT (code); prompts and media keep the original authors' rights",
      "unstated",
      false,
    ],
    [
      "CC0-1.0 for the list only; prompts and videos belong to the original authors",
      "unstated",
      false,
    ],
    ["MIT (templates)", "open", false],
    ["MIT (templates)", "template", true],
  ]) {
    const entry = {
      id: "x",
      kind: "code-video",
      title: "coffee",
      content: "coffee",
      license,
      templateCatalog,
    };
    assert.equal(searchEntries([entry], "coffee")[0].licenseStatus, expected);
    assert.equal(
      withTarget([{ id: "x" }], [entry], {})[0].licenseStatus,
      expected,
    );
  }
});

it("C5 R2 p5 engine name is not itself a stated version", () => {
  const [candidate] = withTarget([{ kind: "code-video", model: "p5" }], [], {
    targetModel: "p5",
  });
  assert.equal(candidate.modelMatch, "matched");
  assert.equal(candidate.versionMatch, "unknown");
  assert.equal(candidate.sampleVersion, null);
  assert.equal(candidate.targetVersion, null);
});
