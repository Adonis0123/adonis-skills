import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globToRegExp, load, sync } from "../adapters/markdown.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ps-md-"));

function write(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const YOUMIND = `# Awesome Seedance

## 🔥 Featured Prompts

### No. 6: Cinematic Street Racing Sequence for Seedance 2

![English](https://img.shields.io/badge/lang-English-blue)

#### 📖 Description

A detailed, multi-shot prompt designed for Seedance 2 to generate a cinematic street racing sequence at night.

#### 📝 Prompt

\`\`\`
cinematic street racing sequence at night, wet asphalt, neon reflections
\`\`\`

#### 🎬 Video

<img src="https://customer-qs6wnyfuv0gcybzj.cloudflarestream.com/3a7fb0a6d706b9f568479bb720ce1ad4/thumbnails/thumbnail.jpg" width="700" alt="Cinematic Street Racing Sequence for Seedance 2">

**[🎬 Watch Video →](https://youmind.com/en-US/seedance-2-0-prompts?id=2530)**

#### 📌 Details

- **Author:** [Pierrick Chevallier | IA](https://x.com/CharaspowerAI)
- **Source:** [Twitter Post](https://x.com/CharaspowerAI/status/2039651574297792688)

### Cherry Lip Serum Ad

\`\`\`
macro commercial of a cherry lip serum drop
\`\`\`

<a href="https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts/releases/download/videos/1402.mp4">
<img src="https://customer-qs6wnyfuv0gcybzj.cloudflarestream.com/7f63ad253175a9ad1dac53de490efac8/thumbnails/thumbnail.jpg" alt="Cherry Lip Serum Ad">
</a>

**[🎬 Watch Video →](https://youmind.com/en-US/seedance-2-0-prompts?id=1402)**

### 🎯 100 more prompts not shown here

See the gallery for the rest.
`;

// Trimmed from Evolink-AI cases/character.md. Case 1's fence is unclosed and
// the next "### " heading sits at column 0 inside it.
const EVOLINK = `# Character Design Cases

### Case 1: [Anime Snapshot Conversion](https://x.com/Thereallo1026/status/2044241997163311569) (by [@Thereallo1026](https://x.com/Thereallo1026))

**Prompt:**

\`\`\`

<!-- Case 30: LEGO Football Collectible Figure (by @ChillaiKalan__) -->
### Case 30: [LEGO Football Collectible Figure](https://x.com/ChillaiKalan__/status/2068717001145778630) (by [@ChillaiKalan__](https://x.com/ChillaiKalan__))

<img src="../images/character_case30/output.jpg" width="100%" alt="LEGO Football Collectible Figure">

**Prompt:**

\`\`\`
A highly detailed collectible toy figure inspired by a LEGO-style minifigure, standing in a professional studio.
\`\`\`
Show me the attached image as a snapshot from an actual anime
\`\`\`

### Case 363: [Persona5 Character Reference Card](https://x.com/iamrednightS/status/2045075682837836265) (by [@iamrednightS](https://x.com/iamrednightS))

**Prompt:**

\`\`\`
基于此角色和背景，请制作一份类似官方设定资料的角色资料卡。包含三视图、表情差分和色板，白色背景，专业概念艺术风格。
\`\`\`

### Case 9: [Chaos Notes Hidden Face Character Art](https://x.com/loglogrog/status/2046448773162033240) (by [@loglogrog](https://x.com/loglogrog))

**Prompt：**

\`\`\`
混沌としたメモ書き・記号の集合体からキャラクターの顔を浮かび上がらせるアート。白い紙の上に黒インクで描かれた手書きメモ。
\`\`\`
`;

const WUYOSCAR = `### No. 4 · Manga relationship map — *A Tale of Two Cities*

- Image: \`docs/anime-manga/manga-relationship.png\`

  <img src="../../../docs/anime-manga/manga-relationship.png" alt="manga relationship" width="420"/>
- Metadata: Anime & Manga · \`portrait\` · \`1024x1536\` · Author: @cht0001 · Source: [X](https://x.com/cht0001)

\`\`\`text
A manga-style illustration showing the person-relationship map for "A Tale of Two Cities" by Charles Dickens. Single full-frame composition, monochrome ink plus screentone.
\`\`\`

### No heading without a prompt

Just an introduction.
`;

const ZEROLU = `## 1. Photorealism & Aesthetics

Intro text without a prompt.

### Sponsor1

| Image | Description |
| :---: | :--- |
| <img src="https://github.com/user-attachments/assets/sponsor" /> | Thanks for sponsoring. |

### 1.1. Hyper-Realistic Crowd Composition
*Handling complex compositions with multiple famous faces and specific lighting.*
<img width="400" alt="Celebrity Crowd" src="https://github.com/user-attachments/assets/3a056a8d-904e-4b3e-b0d2-b5122758b7f5" />

**Prompt:**
\`\`\`text
Create a hyper-realistic, ultra-sharp, full-color large-format image featuring a massive group of celebrities from different eras, all standing together in a single wide cinematic frame.
\`\`\`
*Source: [@SebJefferies](https://x.com/SebJefferies/status/1991531687147360728)*
`;

const VEO_TABLE = `# Awesome Veo 3 Videos

| # | Video link | Original prompt or description | Why it’s awesome |
|---|------------|-----------------|------------------|
| 81 | [Car Show Shopping](https://x.com/laszlogaal_/status/1793009847524094235) | People shopping at a car show with realistic audio and video | "People shopping at a car show with ambient sounds and realistic movement" |
| 82 | [Gen Z Slang Class](https://x.com/HonestBlogging/status/1793012456789123456) | College professor teaching Gen Z slang to interested Boomers | "A college professor doing a class on Gen Z slang and the video pans over to all the boomers taking notes" |
`;

const OPUS_JOINED = `# 推理创业公司发布视频

## 说明

作者称 1 分钟、约 2 美元做完。

## 提示词（提示词原文）

\`\`\`text
make a modern slick and punchy video for a modern startup that works on inference
\`\`\`
`;

const OPUS_INLINE = `# 鸡尾酒配方动态图解（Negroni）

- **作者**：Rory Flynn (@Ror_Fly)
- **原帖 / 来源**：https://x.com/Ror_Fly/status/2102853258582880547

## 提示词（提示词原文）

\`\`\`text
We're going to try a little test. Render a recipe motion graphic animation.
\`\`\`
`;

function youmindSrc(extra = {}) {
  return {
    repo: "YouMind-OpenLab/awesome-seedance-2-prompts",
    branch: "main",
    kinds: ["video"],
    files: ["README.md"],
    mode: "sections",
    modelDefault: "Seedance 2.0",
    joins: [
      {
        file: "video-urls.json",
        kind: "id-map",
        path: "prompts",
        match: "nativeId",
        into: "videos",
      },
    ],
    ...extra,
  };
}

describe("sections", () => {
  it("parses YouMind headings, gallery ids, attribution, and the video join", () => {
    const dir = tmp();
    write(dir, "README.md", YOUMIND);
    write(
      dir,
      "video-urls.json",
      JSON.stringify({
        prompts: {
          2530: "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts/releases/download/videos/2530.mp4",
          1402: "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts/releases/download/videos/1402.mp4",
        },
      }),
    );
    const entries = load(youmindSrc(), { dir });
    assert.equal(entries.length, 2);
    const racing = entries.find((entry) => entry.nativeId === "2530");
    assert.equal(
      racing.title,
      "Cinematic Street Racing Sequence for Seedance 2",
    );
    assert.equal(racing.kind, "video");
    assert.equal(racing.model, "Seedance 2.0");
    assert.equal(racing.lang, "en");
    assert.match(racing.content, /wet asphalt/);
    assert.match(racing.description, /cinematic street racing sequence/i);
    assert.deepEqual(racing.sourceMedia, [
      "https://customer-qs6wnyfuv0gcybzj.cloudflarestream.com/3a7fb0a6d706b9f568479bb720ce1ad4/thumbnails/thumbnail.jpg",
    ]);
    assert.deepEqual(racing.videos, [
      "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts/releases/download/videos/2530.mp4",
    ]);
    assert.equal(racing.author, "Pierrick Chevallier | IA");
    assert.equal(
      racing.link,
      "https://x.com/CharaspowerAI/status/2039651574297792688",
    );

    const cherry = entries.find((entry) => entry.nativeId === "1402");
    assert.equal(cherry.title, "Cherry Lip Serum Ad");
    assert.equal(cherry.videos.length, 1);
    assert.match(cherry.videos[0], /1402\.mp4$/);
    assert.equal(
      entries.some((entry) => /100 more prompts/.test(entry.title)),
      false,
    );
  });

  it("ends an unclosed Evolink fence at a column-0 ### heading", () => {
    const dir = tmp();
    write(dir, "cases/character.md", EVOLINK);
    const entries = load(
      {
        repo: "Evolink-AI/awesome-gpt-image-2-API-Prompts",
        branch: "main",
        kinds: ["image"],
        files: ["cases/character.md"],
        mode: "sections",
        modelDefault: "GPT Image 2",
      },
      { dir },
    );
    const titles = entries.map((entry) => entry.title);
    assert.equal(titles.includes("Anime Snapshot Conversion"), false);
    const lego = entries.find(
      (entry) => entry.nativeId === "character-case-30",
    );
    assert.ok(lego);
    assert.equal(lego.title, "LEGO Football Collectible Figure");
    assert.match(lego.content, /^A highly detailed collectible toy figure/);
    assert.equal(lego.content.includes("Persona5"), false);
    assert.equal(lego.content.includes("Show me the attached"), false);
    assert.equal(lego.author, "@ChillaiKalan__");
    assert.equal(
      lego.link,
      "https://x.com/ChillaiKalan__/status/2068717001145778630",
    );
    assert.deepEqual(lego.sourceMedia, [
      "https://raw.githubusercontent.com/Evolink-AI/awesome-gpt-image-2-API-Prompts/main/images/character_case30/output.jpg",
    ]);
    assert.equal(lego.model, "GPT Image 2");

    const persona = entries.find(
      (entry) => entry.nativeId === "character-case-363",
    );
    assert.equal(persona.title, "Persona5 Character Reference Card");
    assert.equal(persona.lang, "zh");
    assert.equal(persona.author, "@iamrednightS");
    assert.match(persona.content, /^基于此角色和背景/);

    const chaos = entries.find(
      (entry) => entry.nativeId === "character-case-9",
    );
    assert.equal(chaos.author, "@loglogrog");
    assert.equal(chaos.lang, "zh");
    assert.match(chaos.content, /混沌としたメモ書き/);
  });

  it("reads wuyoscar gallery metadata and resolves relative images once", () => {
    const dir = tmp();
    write(
      dir,
      "skills/gpt-image/references/gallery-anime-and-manga.md",
      WUYOSCAR,
    );
    const [entry] = load(
      {
        repo: "wuyoscar/GPT-Image2-Skill",
        branch: "main",
        kinds: ["image"],
        glob: "skills/gpt-image/references/gallery-*.md",
        mode: "sections",
        modelDefault: "GPT Image 2",
      },
      { dir },
    );
    assert.equal(entry.nativeId, "gallery-anime-and-manga-no-4");
    assert.equal(entry.title, "Manga relationship map — A Tale of Two Cities");
    assert.equal(entry.ratio, "1024x1536");
    assert.equal(entry.category, "Anime & Manga");
    assert.equal(entry.author, "@cht0001");
    assert.equal(entry.link, "https://x.com/cht0001");
    assert.deepEqual(entry.sourceMedia, [
      "https://raw.githubusercontent.com/wuyoscar/GPT-Image2-Skill/main/docs/anime-manga/manga-relationship.png",
    ]);
    assert.match(entry.content, /A Tale of Two Cities/);
  });

  it("parses a ZeroLu README section and skips a sponsor block", () => {
    const dir = tmp();
    write(dir, "README.md", ZEROLU);
    const entries = load(
      {
        repo: "ZeroLu/awesome-nanobanana-pro",
        branch: "main",
        kinds: ["image"],
        files: ["README.md"],
        mode: "sections",
        modelDefault: "Nano Banana Pro",
      },
      { dir },
    );
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry.title, "1.1. Hyper-Realistic Crowd Composition");
    assert.equal(entry.model, "Nano Banana Pro");
    assert.equal(entry.lang, "en");
    assert.equal(entry.author, "@SebJefferies");
    assert.equal(
      entry.link,
      "https://x.com/SebJefferies/status/1991531687147360728",
    );
    assert.match(entry.description, /multiple famous faces/);
    assert.deepEqual(entry.sourceMedia, [
      "https://github.com/user-attachments/assets/3a056a8d-904e-4b3e-b0d2-b5122758b7f5",
    ]);
    assert.match(entry.content, /massive group of celebrities/);
  });
});

describe("prompt-files", () => {
  it("uses the file slug and joins cases.json without overwriting inline attribution", () => {
    const dir = tmp();
    write(dir, "prompts/01-inference-startup-launch.md", OPUS_JOINED);
    write(dir, "prompts/08-negroni-recipe-explainer.md", OPUS_INLINE);
    write(
      dir,
      "cases.json",
      JSON.stringify([
        {
          title: "推理创业公司发布视频",
          author: "Deedy",
          url: "https://x.com/deedydas/status/2102787937482252537",
          category: "产品广告",
        },
        {
          title: "Negroni 鸡尾酒动态图解",
          author: "Someone Else",
          url: "https://x.com/example/status/1",
          category: "should-not-apply",
        },
      ]),
    );
    const entries = load(
      {
        repo: "joeseesun/opus-video-prompts",
        branch: "main",
        kinds: ["code-video"],
        glob: "prompts/*.md",
        mode: "prompt-files",
        joins: [
          {
            file: "cases.json",
            kind: "records",
            match: ["title", "slug"],
            copy: { author: "author", link: "url", category: "category" },
          },
        ],
      },
      { dir },
    );
    assert.equal(entries.length, 2);
    const startup = entries.find(
      (entry) => entry.nativeId === "01-inference-startup-launch",
    );
    assert.equal(startup.title, "推理创业公司发布视频");
    assert.match(startup.content, /inference/);
    assert.equal(startup.author, "Deedy");
    assert.equal(
      startup.link,
      "https://x.com/deedydas/status/2102787937482252537",
    );
    assert.equal(startup.category, "产品广告");
    assert.equal(startup.kind, "code-video");
    assert.equal(startup.lang, "en");

    const negroni = entries.find(
      (entry) => entry.nativeId === "08-negroni-recipe-explainer",
    );
    assert.equal(negroni.author, "Rory Flynn");
    assert.equal(
      negroni.link,
      "https://x.com/Ror_Fly/status/2102853258582880547",
    );
    assert.equal(negroni.category, undefined);
  });
});

describe("table", () => {
  it("reads a four-column Veo README and takes the prompt from column 4", () => {
    const dir = tmp();
    write(dir, "README.md", VEO_TABLE);
    const entries = load(
      {
        repo: "akirakai/awesome-veo3-videos",
        branch: "main",
        kinds: ["video"],
        files: ["README.md"],
        mode: "table",
        columns: { title: 2, link: 2, description: 3, content: 4 },
        modelDefault: "Veo 3",
      },
      { dir },
    );
    assert.equal(entries.length, 2);
    assert.equal(entries[0].title, "Car Show Shopping");
    assert.equal(
      entries[0].content,
      "People shopping at a car show with ambient sounds and realistic movement",
    );
    assert.match(entries[0].description, /realistic audio/);
    assert.equal(
      entries[0].link,
      "https://x.com/laszlogaal_/status/1793009847524094235",
    );
    assert.equal(entries[0].model, "Veo 3");
    assert.equal(entries[1].title, "Gen Z Slang Class");
    assert.match(entries[1].content, /boomers taking notes/);
  });
});

describe("sync and load", () => {
  it("lists a glob through the git trees API and does not throw on bad files", async () => {
    const dir = tmp();
    const urls = [];
    const bodies = {
      "https://api.github.com/repos/joeseesun/opus-video-prompts/git/trees/main?recursive=1":
        JSON.stringify({
          tree: [
            { path: "prompts/01-inference-startup-launch.md", type: "blob" },
            { path: "README.md", type: "blob" },
            { path: "cases.json", type: "blob" },
          ],
        }),
      "https://raw.githubusercontent.com/joeseesun/opus-video-prompts/main/prompts/01-inference-startup-launch.md":
        OPUS_JOINED,
      "https://raw.githubusercontent.com/joeseesun/opus-video-prompts/main/cases.json":
        JSON.stringify([
          {
            title: "推理创业公司发布视频",
            author: "Deedy",
            url: "https://x.com/deedydas/status/2102787937482252537",
          },
        ]),
    };
    const fetchCached = async (url, file) => {
      urls.push(url);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bodies[url] || "");
      return {
        url,
        file,
        status: bodies[url] ? "updated" : "unavailable-error",
      };
    };
    const src = {
      repo: "joeseesun/opus-video-prompts",
      branch: "main",
      kinds: ["code-video"],
      glob: "prompts/*.md",
      exclude: ["prompts/*draft*"],
      mode: "prompt-files",
      joins: [{ file: "cases.json", kind: "records", match: ["title"] }],
    };
    const synced = await sync(src, { dir, cache: dir, fetchCached });
    assert.equal(synced.results.length, 3);
    assert.equal(
      urls.some((url) => url.includes("/git/trees/")),
      true,
    );
    assert.equal(
      urls.some((url) => url.endsWith("/README.md")),
      false,
    );
    const entries = load(src, { dir });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].author, "Deedy");

    write(dir, "prompts/02-broken.md", "### \n```\n");
    write(dir, "cases.json", "{");
    assert.doesNotThrow(() => load(src, { dir }));
    assert.deepEqual(load(src, { dir: path.join(dir, "missing") }), []);
    const bare = await sync(src, {});
    assert.equal(bare.results[0].status, "unavailable-error");
  });

  it("skips excluded locale case files", () => {
    const dir = tmp();
    const one = "### Case 1: Alpha\n\n```\nalpha prompt text here\n```\n";
    write(dir, "cases/character.md", one);
    write(dir, "cases/character_zh-CN.md", one.replace("Alpha", "中文"));
    const entries = load(
      {
        repo: "Evolink-AI/awesome-gpt-image-2-API-Prompts",
        branch: "main",
        kinds: ["image"],
        glob: "cases/*.md",
        exclude: ["cases/*_*.md"],
        mode: "sections",
      },
      { dir },
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].nativeId, "character-case-1");
    assert.equal(
      globToRegExp("cases/*_*.md").test("cases/character_zh-CN.md"),
      true,
    );
    assert.equal(
      globToRegExp("cases/*_*.md").test("cases/character.md"),
      false,
    );
  });
});

describe("round 2", () => {
  const src = {
    repo: "example/prompts",
    branch: "main",
    kinds: ["image"],
    files: ["README.md"],
    mode: "sections",
  };

  function entriesFor(text) {
    const dir = tmp();
    write(dir, "README.md", text);
    return load(src, { dir });
  }

  it("keeps duplicate titles stable and globally unique", () => {
    const section = (title, content) =>
      `### ${title}\n\n\`\`\`\n${content}\n\`\`\`\n`;
    const alpha = section("A", "prompt alpha is long enough to stay");
    const beta = section("A", "prompt beta is long enough to stay");
    const suffix = section("A-2", "prompt gamma is long enough to stay");
    const forward = entriesFor(alpha + beta + suffix);
    const backward = entriesFor(suffix + beta + alpha);
    const idOf = (entries, snippet) => {
      const found = entries.filter((entry) => entry.content.includes(snippet));
      assert.equal(found.length, 1);
      return found[0].nativeId;
    };
    const alphaId = idOf(forward, "prompt alpha");
    const betaId = idOf(forward, "prompt beta");
    assert.equal(alphaId, idOf(backward, "prompt alpha"));
    assert.equal(betaId, idOf(backward, "prompt beta"));
    assert.notEqual(alphaId, betaId);
    assert.equal(idOf(forward, "prompt gamma"), "a-2");
    assert.equal(idOf(backward, "prompt gamma"), "a-2");
    assert.equal(new Set(forward.map((entry) => entry.nativeId)).size, 3);
    assert.deepEqual(
      forward.map((entry) => entry.nativeId).sort(),
      backward.map((entry) => entry.nativeId).sort(),
    );
  });

  it("keeps markdown headings inside a closed fence", () => {
    const dir = tmp();
    write(
      dir,
      "README.md",
      `### Street

\`\`\`
Keep this line about a night drive through rain.
### Still inside the prompt
And this line stays in the same prompt too.
\`\`\`

- **Author:** [Outside Person](https://x.com/out/status/5)

### Wrapped

\`\`\`\`markdown
### Embedded heading
\`\`\`
inner fence line that is not a new prompt entry
\`\`\`
The outer prompt continues after the inner fence with enough words.
\`\`\`\`

- **Author:** [Outer Author](https://x.com/outer/status/9)
`,
    );
    const entries = load(src, { dir });
    assert.deepEqual(
      entries.map((entry) => entry.title),
      ["Street", "Wrapped"],
    );
    assert.match(entries[0].content, /Still inside the prompt/);
    assert.match(entries[0].content, /And this line stays/);
    assert.equal(entries[0].author, "Outside Person");
    assert.match(entries[1].content, /Embedded heading/);
    assert.match(entries[1].content, /inner fence line/);
    assert.match(entries[1].content, /outer prompt continues/);
    assert.equal(entries[1].author, "Outer Author");
  });

  it("skips headings and fences inside HTML comments", () => {
    const dir = tmp();
    write(
      dir,
      "README.md",
      `### Real

\`\`\`
A real prompt long enough to be kept in the library today.
\`\`\`

<!--
### Hidden

\`\`\`
secret prompt that must not become an entry
\`\`\`
-->

### Also real

\`\`\`
<!-- keep this comment inside the prompt -->
### Not a heading
Second line of the prompt stays in the fence.
\`\`\`
`,
    );
    const entries = load(src, { dir });
    assert.deepEqual(
      entries.map((entry) => entry.title),
      ["Real", "Also real"],
    );
    assert.match(entries[1].content, /keep this comment inside the prompt/);
    assert.match(entries[1].content, /Not a heading/);
    assert.match(entries[1].content, /Second line of the prompt stays/);
  });

  it("preserves query, fragment, and existing percent escapes in media URLs", () => {
    const dir = tmp();
    write(
      dir,
      "README.md",
      `### Shot

\`\`\`
A sufficiently long prompt about a red bicycle at dusk.
\`\`\`

<img src="./image.png?v=1">
<img src="./my%20file.png#fig">
<img src="./image.png?v=1">
`,
    );
    const [entry] = load(src, { dir });
    assert.deepEqual(entry.sourceMedia, [
      "https://raw.githubusercontent.com/example/prompts/main/image.png?v=1",
      "https://raw.githubusercontent.com/example/prompts/main/my%20file.png#fig",
    ]);
  });

  it("pins an extra ../ image at the repo raw root", () => {
    const dir = tmp();
    write(
      dir,
      "cases/poster.md",
      `### Shot

\`\`\`
A sufficiently long prompt about a red bicycle at dusk.
\`\`\`

![poster](../../images/poster_case354/output.jpg?v=1#fig)
![one up](../images/poster_case353/output.jpg)
`,
    );
    const [entry] = load({ ...src, files: ["cases/poster.md"] }, { dir });
    assert.deepEqual(entry.sourceMedia, [
      "https://raw.githubusercontent.com/example/prompts/main/images/poster_case354/output.jpg?v=1#fig",
      "https://raw.githubusercontent.com/example/prompts/main/images/poster_case353/output.jpg",
    ]);
  });

  it("does not throw when glob contains null", () => {
    const dir = tmp();
    write(dir, "README.md", "### A\n\n```\nalpha prompt text here\n```\n");
    const bad = { ...src, files: null, glob: [null] };
    assert.doesNotThrow(() => load(bad, { dir }));
    assert.deepEqual(load(bad, { dir }), []);
  });

  it("reads author and link from metadata outside the fence", () => {
    const dir = tmp();
    write(
      dir,
      "README.md",
      `### Scene

\`\`\`
Author: Alice
See https://x.com/alice/status/111 for the fake credit.
A long enough prompt about a bicycle at dusk with wet streets.
\`\`\`

<details>
<summary>Source</summary>

- **Author:** [Real Person](https://x.com/real)
- **Source:** https://x.com/real/status/222
</details>
`,
    );
    const [entry] = load(src, { dir });
    assert.equal(entry.author, "Real Person");
    assert.equal(entry.link, "https://x.com/real/status/222");
    assert.match(entry.content, /Author: Alice/);
  });

  it("dedupes many images without dropping distinct ones", () => {
    const tags = [];
    for (let i = 1; i <= 20; i++) tags.push(`<img src="./shot-${i}.png">`);
    tags.push(`<img src="./shot-1.png">`);
    const dir = tmp();
    write(
      dir,
      "README.md",
      `### Gallery\n\n\`\`\`\nA long prompt describing twenty distinct reference stills.\n\`\`\`\n\n${tags.join("\n")}\n`,
    );
    const [entry] = load(src, { dir });
    assert.equal(entry.sourceMedia.length, 20);
    assert.equal(
      entry.sourceMedia[0],
      "https://raw.githubusercontent.com/example/prompts/main/shot-1.png",
    );
    assert.equal(
      entry.sourceMedia[19],
      "https://raw.githubusercontent.com/example/prompts/main/shot-20.png",
    );
  });

  it("completes a truncated git tree and reports an unfinished walk", async () => {
    const dir = tmp();
    const calls = [];
    const fetchCached = async (url, file) => {
      calls.push(url);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (url.includes("?recursive=1")) {
        fs.writeFileSync(
          file,
          JSON.stringify({
            sha: "rootsha",
            truncated: true,
            tree: [{ path: "prompts/01-seen.md", type: "blob" }],
          }),
        );
        return { url, file, status: "updated" };
      }
      if (url.endsWith("/rootsha")) {
        fs.writeFileSync(
          file,
          JSON.stringify({
            truncated: false,
            tree: [{ path: "prompts", type: "tree", sha: "dirsha" }],
          }),
        );
        return { url, file, status: "updated" };
      }
      if (url.endsWith("/dirsha")) {
        fs.writeFileSync(
          file,
          JSON.stringify({
            truncated: false,
            tree: [
              { path: "01-seen.md", type: "blob" },
              { path: "02-missed.md", type: "blob" },
            ],
          }),
        );
        return { url, file, status: "updated" };
      }
      fs.writeFileSync(
        file,
        "### T\n\n```\nprompt text long enough here\n```\n",
      );
      return { url, file, status: "updated" };
    };
    const synced = await sync(
      {
        repo: "example/prompts",
        branch: "main",
        glob: "prompts/*.md",
        mode: "prompt-files",
      },
      { dir, fetchCached },
    );
    assert.equal(
      calls.some((url) => url.endsWith("/02-missed.md")),
      true,
    );
    assert.equal(
      synced.results.some((result) => result.status === "incomplete-tree"),
      false,
    );

    const failed = await sync(
      {
        repo: "example/prompts",
        branch: "main",
        glob: "prompts/*.md",
        mode: "prompt-files",
      },
      {
        dir: tmp(),
        fetchCached: async (url, file) => {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          if (url.includes("?recursive=1")) {
            fs.writeFileSync(
              file,
              JSON.stringify({
                sha: "rootsha",
                truncated: true,
                tree: [{ path: "prompts/01-seen.md", type: "blob" }],
              }),
            );
            return { url, file, status: "updated" };
          }
          return { url, file, status: "unavailable-error" };
        },
      },
    );
    assert.equal(
      failed.results.some((result) => result.status === "incomplete-tree"),
      true,
    );
  });
});

describe("round 3", () => {
  const src = {
    repo: "example/prompts",
    branch: "main",
    kinds: ["image"],
    files: ["README.md"],
    mode: "sections",
  };

  it("keeps a closed case heading and an inner closing fence", () => {
    const dir = tmp();
    write(
      dir,
      "README.md",
      `### Street

\`\`\`
### Case 1
This prompt body stays with the street section.
\`\`\`

- **Author:** [Outside Person](https://x.com/out/status/5)

### Longer

\`\`\`\`
### Case 2
The prompt continues and then an embedded closer sits at the end.
\`\`\`
\`\`\`\`

- **Author:** [Outer Author](https://x.com/outer/status/9)
`,
    );
    const entries = load(src, { dir });
    assert.deepEqual(
      entries.map((entry) => entry.title),
      ["Street", "Longer"],
    );
    assert.match(entries[0].content, /### Case 1/);
    assert.match(entries[0].content, /stays with the street section/);
    assert.equal(entries[0].author, "Outside Person");
    assert.match(entries[1].content, /### Case 2/);
    assert.match(entries[1].content, /embedded closer sits at the end/);
    assert.match(entries[1].content, /^```$/m);
    assert.equal(entries[1].author, "Outer Author");
  });

  it("lists both directories when they share a git tree sha", async () => {
    const dir = tmp();
    const calls = [];
    const fetchCached = async (url, file) => {
      calls.push(url);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (url.includes("?recursive=1")) {
        fs.writeFileSync(
          file,
          JSON.stringify({
            sha: "rootsha",
            truncated: true,
            tree: [],
          }),
        );
        return { url, file, status: "updated" };
      }
      if (url.endsWith("/rootsha")) {
        fs.writeFileSync(
          file,
          JSON.stringify({
            truncated: false,
            tree: [
              { path: "a", type: "tree", sha: "samesha" },
              { path: "b", type: "tree", sha: "samesha" },
            ],
          }),
        );
        return { url, file, status: "updated" };
      }
      if (url.endsWith("/samesha")) {
        fs.writeFileSync(
          file,
          JSON.stringify({
            truncated: false,
            tree: [{ path: "note.md", type: "blob" }],
          }),
        );
        return { url, file, status: "updated" };
      }
      fs.writeFileSync(
        file,
        "### T\n\n```\nprompt text long enough here\n```\n",
      );
      return { url, file, status: "updated" };
    };
    const synced = await sync(
      {
        repo: "example/prompts",
        branch: "main",
        glob: "*/*.md",
        mode: "prompt-files",
      },
      { dir, fetchCached },
    );
    assert.equal(
      calls.some((url) => url.endsWith("/a/note.md")),
      true,
    );
    assert.equal(
      calls.some((url) => url.endsWith("/b/note.md")),
      true,
    );
    assert.equal(
      synced.results.some((result) => result.status === "incomplete-tree"),
      false,
    );
  });
});
