import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  ENTRIES_FILE,
  detectLang,
  globToRegExp,
  inferDuration,
  inferRatio,
  load,
  mapDoc,
  parseSeconds,
  parseTarball,
  parseYamlSubset,
  readTar,
  sync,
  YamlSubsetError,
} from "../adapters/yaml-tree.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ps-yaml-"));
const SHA = "0123456789abcdef0123456789abcdef01234567";

const SRC = {
  id: "ai-boost",
  repo: "ai-boost/awesome-image-video-prompts",
  branch: "main",
  kinds: ["image", "video"],
  adapter: "yaml-tree",
  include: ["prompts/image/*.yaml", "prompts/video/*.yaml"],
  previewBase: "previews/",
  locale: "en",
};

const IMAGE_YAML = `id: gpt-image-festival
title:
  en: Festival crowd, 1969
  zh: 1969 年的音乐节人群
model: GPT Image 2.5
mode: text-to-image
category: realism
tags:
- historical
- crowd
source:
  name: OpenAI image prompting guide
  url: https://developers.openai.com/api/docs/guides/image-prompting
  credit: OpenAI
  captured: '2026-10-28'
notes:
  en: 'A place and a date are enough. Preview: the Sunburst variant.'
  zh: 只给地点和日期。
prompt: |
  Create a realistic outdoor crowd scene in Bethel, New York on August 16, 1969.
  Photorealistic, period-accurate clothing, staging, and environment.
`;

const VIDEO_YAML = `id: kling-garden-run
title:
  en: Woman in green runs across a moonlit garden, 15 s
  zh: 绿裙女子奔过月下花园，15 秒
model: Kling 3.0
mode: image-to-video
tags:
- long-take
source:
  name: Kling VIDEO 3.0 user guide
  url: https://app.klingai.com/global/quickstart/guide
  credit: Kling AI
video: https://static.klingai-cdn-aws.com/kling-blog/clip_0.mp4
inputs:
- https://static.klingai-cdn-aws.com/kling-blog/reference.png
notes:
  en: 'A 15-second continuous shot, 16:9.'
prompt: |
  Opening with an ultra-wide-angle medium-long shot tracking horizontally, 16:9 aspect ratio.
`;

// ---------- a tiny in-memory tar.gz ----------

function tarHeader(name, size, type = "0") {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.fill(32, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}

function tarMember(name, body, type = "0") {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return [tarHeader(name, data.length, type), data, pad];
}

function pax(records) {
  let out = "";
  for (const [k, v] of Object.entries(records)) {
    const body = ` ${k}=${v}\n`;
    // pax lengths count bytes, not UTF-16 code units.
    let len = Buffer.byteLength(body) + 1;
    while (Buffer.byteLength(`${len}${body}`) !== len)
      len = Buffer.byteLength(`${len}${body}`);
    out += `${len}${body}`;
  }
  return out;
}

function buildTar(members, comment = SHA) {
  const parts =
    comment == null
      ? []
      : [...tarMember("pax_global_header", pax({ comment }), "g")];
  for (const [name, body, type] of members)
    parts.push(...tarMember(name, body, type));
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const buildTarGz = (members, comment = SHA) =>
  zlib.gzipSync(buildTar(members, comment));

const TOP = "awesome-image-video-prompts-main";
const longName = `${TOP}/prompts/video/${"x".repeat(120)}.yaml`;
const sampleMembers = (TOP = "awesome-image-video-prompts-main") => [
  [`${TOP}/`, "", "5"],
  [`${TOP}/README.md`, "# readme"],
  [`${TOP}/prompts/image/gpt-image-festival.yaml`, IMAGE_YAML],
  [`${TOP}/prompts/video/kling-garden-run.yaml`, VIDEO_YAML],
  [`${TOP}/prompts/video/broken.yaml`, "id: broken\nalias: *nope\n"],
  [`${TOP}/recipes/not-included.yaml`, "id: recipe\n"],
  [`${TOP}/previews/gpt-image-festival.jpg`, Buffer.from([0xff, 0xd8, 0xff])],
  [`${TOP}/previews/kling-garden-run.gif`, "GIF89a"],
  [`${TOP}/previews/kling-garden-run.jpg`, Buffer.from([0xff, 0xd8, 0xff])],
  [
    "PaxHeader",
    pax({ path: `${TOP}/prompts/video/${"x".repeat(120)}.yaml` }),
    "x",
  ],
  ["shortened-by-pax", "id: long-name\nprompt: from a pax path\n"],
];
const SAMPLE_TGZ = buildTarGz(sampleMembers());

// ---------- YAML subset ----------

describe("parseYamlSubset", () => {
  it("parses block scalars with chomping, folding and indent digits", () => {
    const doc = parseYamlSubset(
      [
        "lit: |",
        "  one",
        "    two",
        "",
        "  three",
        "",
        "strip: |-",
        "  a",
        "  b",
        "",
        "keep: |+",
        "  a",
        "",
        "",
        "fold: >",
        "  one",
        "  two",
        "",
        "  three",
        "    more",
        "  four",
        "digit: |2",
        "    indented",
        "  base",
        "last: x",
      ].join("\n"),
    );
    assert.equal(doc.lit, "one\n  two\n\nthree\n");
    assert.equal(doc.strip, "a\nb");
    assert.equal(doc.keep, "a\n\n\n");
    assert.equal(doc.fold, "one two\nthree\n  more\nfour\n");
    assert.equal(doc.digit, "  indented\nbase\n");
    assert.equal(doc.last, "x");
  });

  it("parses nested maps, compact lists and lists of maps", () => {
    const doc = parseYamlSubset(
      [
        "---",
        "source:",
        "  name: Guide",
        "  meta:",
        "    likes: 178",
        "    ok: true",
        "    none: ~",
        "    ratio: 2.5",
        "    date: 2026-10-28",
        "tags:",
        "- a",
        "- b",
        "shots:",
        "  - at: 0",
        "    text: open",
        "  -   at: 4",
        "      text: cut",
        "  - - x",
        "    - y",
        "  -",
        "    k: v",
        "flow: [one, 'two', \"three\", 4]",
        "empty: {}",
        "...",
      ].join("\n"),
    );
    assert.deepEqual(doc, {
      source: {
        name: "Guide",
        meta: {
          likes: 178,
          ok: true,
          none: null,
          ratio: 2.5,
          date: "2026-10-28",
        },
      },
      tags: ["a", "b"],
      shots: [
        { at: 0, text: "open" },
        { at: 4, text: "cut" },
        ["x", "y"],
        { k: "v" },
      ],
      flow: ["one", "two", "three", 4],
      empty: {},
    });
  });

  it("decodes quoted strings, escapes and multi-line folding", () => {
    const doc = parseYamlSubset(
      [
        "single: 'it''s",
        "  folded",
        "",
        "  para'",
        'double: "tab\\t \\u00e9 \\x41 \\"q\\" \\\\ \\/ cut\\',
        '  \\ here"',
        "'quoted key': 1",
        '"k: 2": 2',
        "plain: first",
        "  second # comment",
        "url: https://example.com/a#frag",
        "csharp: C# rocks",
      ].join("\n"),
    );
    assert.equal(doc.single, "it's folded\npara");
    assert.equal(doc.double, 'tab\t é A "q" \\ / cut here');
    assert.equal(doc["quoted key"], 1);
    assert.equal(doc["k: 2"], 2);
    assert.equal(doc.plain, "first second");
    assert.equal(doc.url, "https://example.com/a#frag");
    assert.equal(doc.csharp, "C# rocks");
  });

  it("does not read the final line break as an extra blank line", () => {
    assert.equal(parseYamlSubset("a: |+\n  x\n").a, "x\n");
    assert.equal(parseYamlSubset("a: |+\n  x\n\n").a, "x\n\n");
    assert.equal(parseYamlSubset("a: |\n  x\n").a, "x\n");
    assert.equal(parseYamlSubset("a: |-\n  x\n\n").a, "x");
    assert.equal(parseYamlSubset("a: >+\n  x\n  y\n").a, "x y\n");
  });

  it("ignores comments and blank lines", () => {
    const doc = parseYamlSubset(
      "# head\n\nid: x # trailing\n  # indented comment\nlist:\n# between\n- a # c\n",
    );
    assert.deepEqual(doc, { id: "x", list: ["a"] });
  });

  it("rejects syntax outside the subset with YamlSubsetError", () => {
    for (const text of [
      "a: &anchor 1\nb: *anchor\n",
      "a: !!str 1\n",
      "? complex\n: key\n",
      "a: {b: 1}\n",
      "a: [1,\n  2]\n",
      "a: 1\na: 2\n",
      "%YAML 1.2\n---\na: 1\n",
      "a: 1\n---\nb: 2\n",
      "a:\n\tb: 1\n",
      "a: b: c\n",
      'a: "unterminated\n',
      'a: "\\q"\n',
      "__proto__: 1\n",
    ]) {
      assert.throws(() => parseYamlSubset(text), YamlSubsetError, text);
    }
  });
});

// ---------- tar ----------

describe("tar reading", () => {
  it("lists regular files with ustar names, pax paths and the git SHA", () => {
    const { files, globalComment } = readTar(zlib.gunzipSync(SAMPLE_TGZ));
    const names = files.map((f) => f.name);
    assert.equal(globalComment, SHA);
    assert.ok(names.includes(`${TOP}/prompts/image/gpt-image-festival.yaml`));
    assert.ok(names.includes(longName));
    assert.ok(!names.includes(`${TOP}/`), "directories are not files");
    const readme = files.find((f) => f.name.endsWith("README.md"));
    assert.equal(readme.data().toString(), "# readme");
  });

  it("rejects a corrupt header", () => {
    const tar = Buffer.from(zlib.gunzipSync(SAMPLE_TGZ));
    tar[1024 + 10] ^= 0xff; // the name field of the second header
    assert.throws(() => readTar(tar), /checksum/);
  });

  it("rejects truncated archives, partial blocks and missing end blocks", () => {
    const full = buildTar(sampleMembers());
    const body = full.subarray(0, full.length - 1024);
    assert.throws(() => readTar(body), /end-of-archive/);
    assert.throws(
      () => readTar(full.subarray(0, full.length - 512)),
      /end-of-archive/,
    );
    assert.throws(
      () => readTar(Buffer.concat([body, Buffer.alloc(100)])),
      /end-of-archive/,
    );
    assert.throws(() => readTar(full.subarray(0, 512 * 3 + 10)), /truncated/);
    assert.throws(() => readTar(Buffer.alloc(0)), /end-of-archive/);
  });

  it("reads pax records by bytes, so CJK paths stay intact", () => {
    const cjk = `${TOP}/prompts/image/中文提示词-海报.yaml`;
    const { files } = readTar(
      buildTar([
        ["PaxHeader", pax({ path: cjk, mtime: "1700000000" }), "x"],
        ["short", "id: cjk\nprompt: p\n"],
      ]),
    );
    assert.deepEqual(
      files.map((f) => f.name),
      [cjk],
    );
  });

  it("refuses an archive with no matching YAML", () => {
    assert.throws(
      () => parseTarball(buildTarGz([[`${TOP}/README.md`, "x"]]), SRC),
      /no YAML/,
    );
  });

  it("parses only the include globs and counts skipped files", () => {
    const parsed = parseTarball(SAMPLE_TGZ, SRC);
    assert.equal(parsed.sha, SHA);
    assert.deepEqual(
      parsed.records.map((r) => r.path),
      [
        "prompts/image/gpt-image-festival.yaml",
        "prompts/video/kling-garden-run.yaml",
        `prompts/video/${"x".repeat(120)}.yaml`,
      ],
    );
    assert.deepEqual(
      parsed.skipped.map((s) => s.path),
      ["prompts/video/broken.yaml"],
    );
    assert.match(parsed.skipped[0].reason, /aliases/);
    assert.deepEqual(parsed.previews, [
      "previews/gpt-image-festival.jpg",
      "previews/kling-garden-run.gif",
      "previews/kling-garden-run.jpg",
    ]);
  });

  it("matches globs segment by segment", () => {
    assert.ok(
      globToRegExp("prompts/image/*.yaml").test("prompts/image/a.yaml"),
    );
    assert.ok(
      !globToRegExp("prompts/image/*.yaml").test("prompts/image/x/a.yaml"),
    );
    assert.ok(globToRegExp("**/*.yaml").test("a.yaml"));
    assert.ok(globToRegExp("**/*.yaml").test("a/b/c.yaml"));
  });
});

// ---------- mapping ----------

describe("mapDoc", () => {
  const previews = new Set([
    "previews/gpt-image-festival.jpg",
    "previews/kling-garden-run.gif",
    "previews/kling-garden-run.jpg",
  ]);

  it("maps an image entry", () => {
    const entry = mapDoc(parseYamlSubset(IMAGE_YAML), {
      path: "prompts/image/gpt-image-festival.yaml",
      src: SRC,
      previews,
    });
    assert.deepEqual(entry, {
      nativeId: "gpt-image-festival",
      kind: "image",
      title: "Festival crowd, 1969",
      description:
        "A place and a date are enough. Preview: the Sunburst variant.",
      content:
        "Create a realistic outdoor crowd scene in Bethel, New York on August 16, 1969.\nPhotorealistic, period-accurate clothing, staging, and environment.",
      lang: "en",
      sourceMedia: [
        "https://raw.githubusercontent.com/ai-boost/awesome-image-video-prompts/main/previews/gpt-image-festival.jpg",
      ],
      videos: [],
      model: "GPT Image 2.5",
      tags: ["historical", "crowd", "realism"],
      category: "realism",
      author: "OpenAI",
      link: "https://developers.openai.com/api/docs/guides/image-prompting",
      needReferenceImages: false,
      mode: "text-to-image",
    });
  });

  it("maps a video entry: direct mp4 only, jpg preview before gif, zh title", () => {
    const entry = mapDoc(parseYamlSubset(VIDEO_YAML), {
      path: "prompts/video/kling-garden-run.yaml",
      src: { ...SRC, locale: "zh" },
      previews,
    });
    assert.equal(entry.kind, "video");
    assert.equal(entry.title, "绿裙女子奔过月下花园，15 秒");
    assert.equal(entry.description, "A 15-second continuous shot, 16:9.");
    assert.deepEqual(entry.videos, [
      "https://static.klingai-cdn-aws.com/kling-blog/clip_0.mp4",
    ]);
    assert.deepEqual(entry.sourceMedia, [
      "https://raw.githubusercontent.com/ai-boost/awesome-image-video-prompts/main/previews/kling-garden-run.jpg",
      "https://raw.githubusercontent.com/ai-boost/awesome-image-video-prompts/main/previews/kling-garden-run.gif",
    ]);
    assert.equal(entry.needReferenceImages, true);
    assert.equal(entry.author, "Kling AI");
    assert.equal(entry.model, "Kling 3.0");
    assert.equal(entry.durationSec, 15);
    assert.equal(entry.ratio, "16:9");
  });

  it("drops post links, keeps posters and gifs as media", () => {
    const entry = mapDoc(
      {
        id: "v",
        prompt: "p",
        video: [
          "https://x.com/someone/status/1",
          {
            url: "https://cdn.example.com/a.webm",
            poster: "https://cdn.example.com/a.jpg",
          },
          "https://cdn.example.com/b.gif",
          "http://insecure.example.com/c.mp4",
        ],
      },
      { path: "prompts/video/v.yaml", src: SRC },
    );
    assert.deepEqual(entry.videos, ["https://cdn.example.com/a.webm"]);
    assert.deepEqual(entry.sourceMedia, [
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.gif",
    ]);
  });

  it("checks file extensions on the URL path, not the query", () => {
    const entry = mapDoc(
      {
        id: "q",
        prompt: "p",
        video: [
          "https://example.com/post?file=a.mp4",
          "https://example.com/view?img=b.jpg",
          "https://cdn.example.com/c.mp4?sig=1",
        ],
      },
      { path: "prompts/video/q.yaml", src: SRC },
    );
    assert.deepEqual(entry.videos, ["https://cdn.example.com/c.mp4?sig=1"]);
    assert.deepEqual(entry.sourceMedia, []);
  });

  it("reads durations only from full number+unit values and explicit phrasing", () => {
    assert.equal(parseSeconds("10ms"), null);
    assert.equal(parseSeconds("15s"), 15);
    assert.equal(parseSeconds("8 seconds"), 8);
    assert.equal(parseSeconds(12), 12);
    assert.equal(inferDuration({ duration: "10ms" }, [], ""), null);
    assert.equal(inferDuration({ duration: "6s" }, [], ""), 6);
    assert.equal(inferDuration({}, ["Garden run, 15 s"], ""), 15);
    assert.equal(inferDuration({}, ["Robot, 10ms latency"], ""), null);
    const pause = "A woman turns. Hold a 2-second pause, then she smiles.";
    assert.equal(inferDuration({}, [], pause), null);
    assert.equal(
      inferDuration({}, [], "Create a 15-second cinematic video of a fox."),
      15,
    );
    assert.equal(inferDuration({}, [], "15s, handheld, a fox in snow."), 15);
    assert.equal(inferDuration({}, [], "Duration: 8 seconds. A fox."), 8);
  });

  it("ignores pauses, holds and beats, even at the start of the prompt", () => {
    for (const text of [
      "A 2-second pause, then she smiles.",
      "2s pause. Then she smiles.",
      "2 seconds hold on her face, then cut.",
      "Hold for 3 seconds, then cut to black.",
      "A 1-second beat of silence before the drop.",
      "3s transition clip into the next scene.",
      "A 0.5s delay, then the 2-second wait ends.",
    ])
      assert.equal(inferDuration({}, [], text), null, text);
  });

  it("ignores numbers inside a time-coded shot list", () => {
    for (const text of [
      "0-3s: Low-angle close-up. 3-7s: Wide tracking shot of her.",
      "3s: Wide shot of the court. 6s: close-up.",
      "[Shot 1] 0-4s open. [Shot 2] a 4-second shot of the bridge.",
      "00:00 open on rain. A 5-second clip of the street follows.",
      "Shot 2: a 3-second shot of the door.",
    ])
      assert.equal(inferDuration({}, [], text), null, text);
  });

  it("accepts durations that describe the whole clip", () => {
    assert.equal(inferDuration({}, [], "A 10s video of a fox."), 10);
    assert.equal(
      inferDuration({}, [], "Create a 15-second shot of a fox."),
      15,
    );
    assert.equal(
      inferDuration({}, [], "Create a 30-second, ultra-cinematic teaser."),
      30,
    );
    assert.equal(inferDuration({}, [], "10 seconds. A fox in snow."), 10);
    assert.equal(inferDuration({}, [], "Duration: 8s | 16:9 | 0-3s: open"), 8);
    assert.equal(inferDuration({}, [], "时长 12 秒，雪中的狐狸。"), 12);
  });

  it("reads the aspect ratio only from fields or explicit aspect phrasing", () => {
    assert.equal(inferRatio({}, "A wide 16:9 shot of the sea."), null);
    assert.equal(inferRatio({}, "Cut at 00:04.500 to 1:1 close-up."), null);
    assert.equal(inferRatio({}, "Aspect ratio 9:16, a dancer."), "9:16");
    assert.equal(inferRatio({}, "A dancer, 16:9 aspect."), "16:9");
    assert.equal(inferRatio({}, "Vertical 9:16 frame of a dancer."), "9:16");
    assert.equal(inferRatio({}, "a dancer --ar 2.39:1"), "2.39:1");
    assert.equal(inferRatio({ ratio: "4:5" }, "aspect ratio 9:16"), "4:5");
  });

  it("detects the prompt language", () => {
    assert.equal(detectLang("A cat on a windowsill"), "en");
    assert.equal(detectLang("一只猫坐在窗台上，午后阳光"), "zh");
    assert.equal(
      detectLang("高品質アニメ映像。夢幻的ファンタジーの植物温室"),
      null,
    );
    assert.equal(detectLang(""), null);
  });
});

// ---------- sync / load ----------

function fakeCtx(dir, { sha = SHA, tgz = null, refThrows = false } = {}) {
  const calls = [];
  return {
    dir,
    cache: path.dirname(dir),
    now: Date.parse("2026-10-29T00:00:00Z"),
    calls,
    async fetchCached(url, file) {
      calls.push(url);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (url.includes("/git/ref/heads/")) {
        if (refThrows) throw new Error("socket hang up");
        fs.writeFileSync(file, JSON.stringify({ object: { sha } }));
      } else fs.writeFileSync(file, tgz || buildTarGz(sampleMembers(), sha));
      return { url, file, status: "updated" };
    },
  };
}

describe("sync and load", () => {
  it("load() with no cache returns []", () => {
    assert.deepEqual(load(SRC, { dir: path.join(tmp(), "missing") }), []);
  });

  it("load() ignores a corrupt entries.json", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, ENTRIES_FILE), "{not json");
    assert.deepEqual(load(SRC, { dir }), []);
  });

  it("downloads once, skips the tarball while the SHA is unchanged", async () => {
    const dir = path.join(tmp(), "ai-boost");
    const ctx = fakeCtx(dir);
    const first = await sync(SRC, ctx);
    assert.equal(first.status, "updated");
    assert.equal(first.entries, 3);
    assert.equal(first.skipped.length, 1);
    assert.ok(!fs.existsSync(path.join(dir, "repo.tar.gz")), "tarball deleted");
    assert.equal(ctx.calls.filter((u) => u.includes("codeload")).length, 1);
    assert.ok(
      ctx.calls.includes(
        `https://codeload.github.com/${SRC.repo}/tar.gz/${SHA}`,
      ),
    );

    const second = await sync(SRC, ctx);
    assert.equal(second.status, "unchanged");
    assert.equal(ctx.calls.filter((u) => u.includes("codeload")).length, 1);

    const entries = load(SRC, ctx);
    assert.deepEqual(
      entries.map((e) => [e.nativeId, e.kind]),
      [
        ["gpt-image-festival", "image"],
        ["kling-garden-run", "video"],
        ["long-name", "video"],
      ],
    );

    const moved = fakeCtx(dir, { sha: "f".repeat(40) });
    assert.equal((await sync(SRC, moved)).status, "updated");
    assert.equal(moved.calls.filter((u) => u.includes("codeload")).length, 1);
  });

  it("keeps the old entries when the new tarball is corrupt", async () => {
    const dir = path.join(tmp(), "ai-boost");
    await sync(SRC, fakeCtx(dir));
    const bad = fakeCtx(dir, { sha: "e".repeat(40), tgz: Buffer.from("nope") });
    const result = await sync(SRC, bad);
    assert.equal(result.status, "stale");
    assert.ok(result.results.some((r) => r.status === "parse-error"));
    assert.equal(load(SRC, bad).length, 3);
  });

  it("refuses an archive of another commit and keeps the old entries", async () => {
    const dir = path.join(tmp(), "ai-boost");
    const fresh = fakeCtx(dir, {
      sha: "a".repeat(40),
      tgz: buildTarGz(sampleMembers(), "b".repeat(40)),
    });
    const none = await sync(SRC, fresh);
    assert.equal(none.status, "unavailable");
    const mismatch = none.results.find((r) => r.status === "sha-mismatch");
    assert.equal(mismatch.expected, "a".repeat(40));
    assert.equal(mismatch.got, "b".repeat(40));
    assert.deepEqual(load(SRC, fresh), []);

    await sync(SRC, fakeCtx(dir));
    const stale = await sync(
      SRC,
      fakeCtx(dir, {
        sha: "c".repeat(40),
        tgz: buildTarGz(sampleMembers(), SHA),
      }),
    );
    assert.equal(stale.status, "stale");
    assert.equal(stale.sha, SHA);
    assert.equal(load(SRC, fakeCtx(dir)).length, 3);
  });

  it("verifies the top folder when the archive has no SHA comment", async () => {
    const sha = "d".repeat(40);
    const good = buildTarGz(
      sampleMembers(`awesome-image-video-prompts-${sha}`),
      null,
    );
    const dir = path.join(tmp(), "ai-boost");
    assert.equal(
      (await sync(SRC, fakeCtx(dir, { sha, tgz: good }))).status,
      "updated",
    );
    const other = "9".repeat(40);
    const result = await sync(SRC, fakeCtx(dir, { sha: other, tgz: good }));
    assert.equal(result.status, "stale");
    assert.ok(result.results.some((r) => r.status === "sha-mismatch"));
  });

  it("keeps the old entries for truncated or empty archives", async () => {
    const dir = path.join(tmp(), "ai-boost");
    await sync(SRC, fakeCtx(dir));
    const full = buildTar(sampleMembers(), "e".repeat(40));
    for (const tar of [
      full.subarray(0, full.length - 1024),
      full.subarray(0, full.length - 700),
      buildTar([], "e".repeat(40)),
      Buffer.alloc(0),
    ]) {
      const ctx = fakeCtx(dir, {
        sha: "e".repeat(40),
        tgz: zlib.gzipSync(tar),
      });
      const result = await sync(SRC, ctx);
      assert.equal(result.status, "stale");
      assert.equal(result.sha, SHA);
      assert.ok(result.results.some((r) => r.status === "parse-error"));
      assert.equal(load(SRC, ctx).length, 3);
    }
  });

  it("does not throw when the ref request fails", async () => {
    const dir = path.join(tmp(), "ai-boost");
    const none = await sync(SRC, fakeCtx(dir, { refThrows: true }));
    assert.equal(none.status, "unavailable");
    assert.equal(none.results[0].status, "unavailable-error");
    await sync(SRC, fakeCtx(dir));
    const stale = await sync(SRC, fakeCtx(dir, { refThrows: true }));
    assert.equal(stale.status, "stale");
    assert.equal(stale.entries, 3);
  });

  it("rejects an invalid repo without fetching", async () => {
    const ctx = fakeCtx(tmp());
    const result = await sync({ ...SRC, repo: "../etc" }, ctx);
    assert.equal(result.results[0].status, "invalid-source");
    assert.equal(ctx.calls.length, 0);
  });
});
