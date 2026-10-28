import { buildCandidates, renderGallery } from "../gallery.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSeed,
  checkImage,
  checkSource,
  LARGE_SLUGS,
  LIBRARY,
  USE_MAP,
  coverCheck,
  curlFetch,
  detectAccess,
  detectSession,
  parseIds,
  recommend,
  showEntries,
  showEntry,
  syncLibrary,
  writeBrief,
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
      sourceMedia: ["i"],
    },
    {
      id: 2,
      title: "Landscape",
      description: "the sky is for all of the people",
      content: "with the and for",
      sourceMedia: ["i"],
    },
    {
      id: 3,
      title: "Start",
      description: "art deco",
      content: "start",
      sourceMedia: ["i"],
    },
    {
      id: 4,
      title: "Body only once",
      description: "none",
      content: "a cover somewhere",
      sourceMedia: ["i"],
    },
    {
      id: 5,
      title: "Body twice",
      description: "none",
      content: "cover and thumbnail",
      sourceMedia: ["i"],
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
      sourceMedia: ["i"],
    }));
    const subject = {
      id: 200,
      title: "Robot plugging a glowing connector",
      description: "tools hub",
      content: "connector port",
      sourceMedia: ["i"],
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
        sourceMedia: ["i"],
      },
      {
        id: 2,
        title: "Neon city",
        description: "",
        content: "",
        sourceMedia: ["i"],
      },
      {
        id: 3,
        title: "Bowl of fruit",
        description: "",
        content: "",
        sourceMedia: ["i"],
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
        sourceMedia: ["i"],
      },
      {
        id: 2,
        title: "Poster",
        description: "",
        content: "{style=flat} poster",
        sourceMedia: ["i"],
      },
      {
        id: 3,
        title: "Poster",
        description: "",
        content: "plain {braces}",
        sourceMedia: ["i"],
        needReferenceImages: true,
      },
    ];
    const byId = Object.fromEntries(
      searchEntries(list, "poster").map((r) => [r.id, r]),
    );
    assert.equal(byId[1].hasPlaceholders, true);
    assert.equal(byId[2].hasPlaceholders, true);
    assert.equal(byId[3].hasPlaceholders, false);
    assert.equal(byId[3].needReferenceImages, true);
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
        content: "c",
        sourceMedia: ["i"],
      },
    ],
    "poster.json": [
      {
        id: 2,
        title: "Cover poster",
        description: "d",
        content: "c",
        sourceMedia: ["i"],
      },
    ],
    "social.json": [
      {
        id: 3,
        title: "Cover social",
        description: "d",
        content: "c",
        sourceMedia: ["i"],
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
    assert.deepEqual(LARGE_SLUGS, ["social-media-post", "product-marketing"]);
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
    });
    assert.deepEqual(out.categories, USE_MAP.illustration);
    assert.match(out.cacheNote, /social-media-post/);
    assert.ok(!out.results.some((r) => r.id === 3));
    const more = await recommend("cover", {
      use: "illustration",
      cache,
      force: true,
      allowLarge: true,
      fetchImpl: makeFetch(),
    });
    assert.ok(more.results.some((r) => r.id === 3));
  });

  it("infers the category from the query and asks for English when all tokens are CJK", async () => {
    const cache = tmp();
    const inferred = await recommend("tech cover", {
      cache,
      fetchImpl: makeFetch(),
    });
    assert.equal(inferred.use, "cover");
    const cjk = await recommend("公众号封面", {
      use: "cover",
      cache,
      fetchImpl: makeFetch(),
    });
    assert.equal(cjk.error, "translate-to-english");
    assert.ok(cjk.hint);
    const none = await recommend("sunset", { cache, fetchImpl: makeFetch() });
    assert.equal(none.error, "need-category");
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
      if (cmd === "ffmpeg" && args[0] !== "-version") ffmpegCalls.push(args);
      return "";
    };
    const res = coverCheck([file], {
      title: "Hello",
      size: "1800x766",
      outDir: out,
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
      false,
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
    assert.ok(html.includes("默认推荐"));
  });

  it("shows an empty state without candidates", () => {
    assert.ok(renderGallery({ candidates: [] }).includes("没有合适的候选"));
  });
});
