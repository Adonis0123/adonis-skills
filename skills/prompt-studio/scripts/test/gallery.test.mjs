import { buildCandidates, renderGallery, serveGallery } from "../gallery.mjs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const video = {
  id: "learnprompt-seedance:diner",
  kind: "video",
  sourceId: "learnprompt-seedance",
  title: "Diner rewind",
  content: "A 1950s diner freezes mid-spill, then rewinds.",
  sourceMedia: ["https://cdn.example/poster.jpg"],
  videos: ["https://cdn.example/clip.mp4"],
  model: "Seedance 2.0",
  author: "@techhalla",
  link: "https://x.com/techhalla/status/1",
  lang: "en",
  mode: "text-to-video",
  durationSec: 15,
  ratio: "9:16",
  source: "LearnPrompt/awesome-seedance",
  license: "MIT",
};
const template = {
  id: "hyperframes:agent-cursor",
  kind: "code-video",
  title: "Agent Cursor",
  content: "",
  sourceMedia: ["https://cdn.example/agent-cursor.png"],
  videos: [],
  model: "Hyperframes",
  mode: "template",
  source: "heygen-com/hyperframes",
  license: "Apache-2.0",
};
const page = (picks, entries) =>
  renderGallery({
    title: "t",
    candidates: buildCandidates(picks, entries).candidates,
  });
const script = (html) => html.split("<script>")[1].split("</script>")[0];

// Serve a written page; returns the base URL, the pick promise and a closer.
async function serve(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-gallery-"));
  const file = path.join(dir, "g.html");
  fs.writeFileSync(file, html);
  let base;
  const done = serveGallery({
    file,
    ids: ["x"],
    pickFile: path.join(dir, "g.pick.json"),
    onReady: (u) => (base = u),
  });
  while (!base) await new Promise((r) => setTimeout(r, 5));
  const close = async () => {
    await fetch(`${base}pick`, { method: "POST", body: '{"id":"x"}' });
    await done;
  };
  return { base, close };
}

const rawGet = (base, pathname, headers = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(pathname, base);
    http
      .get(
        { host: u.hostname, port: u.port, path: u.pathname, headers },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      )
      .on("error", reject);
  });

describe("gallery candidates", () => {
  it("carries the contract fields from the entry and lets the pick override them", () => {
    const { candidates } = buildCandidates(
      [{ id: video.id, model: "Seedance 2.0 Fast", ratio: "16:9" }],
      [video],
    );
    const c = candidates[0];
    assert.equal(c.kind, "video");
    assert.deepEqual(c.videos, ["https://cdn.example/clip.mp4"]);
    assert.equal(c.model, "Seedance 2.0 Fast");
    // A pick's bare ratio is the target; the sample keeps the library's ratio.
    assert.equal(c.sampleRatio, "9:16");
    assert.equal(c.targetRatio, "16:9");
    assert.equal(c.sampleDurationSec, 15);
    assert.equal(c.author, "@techhalla");
    assert.equal(c.link, "https://x.com/techhalla/status/1");
    assert.equal(c.lang, "en");
    assert.equal(c.mode, "text-to-video");
    assert.equal(c.durationSec, 15);
    assert.equal(c.sourceId, "learnprompt-seedance");
    assert.equal(c.modelMismatch, null);
  });

  it("renders a video sample with its poster, muted inline playback and duration", () => {
    const html = page([{ id: video.id }], [video]);
    assert.match(
      html,
      /<video src="https:\/\/cdn\.example\/clip\.mp4" poster="https:\/\/cdn\.example\/poster\.jpg" preload="none" muted loop playsinline/,
    );
    assert.ok(html.includes('class="play" aria-label="播放第 1 个样片"'));
    assert.ok(html.includes('aria-label="样片时长 0:15">0:15</span>'));
    assert.ok(html.includes("样片时长 <b>0:15</b>"));
    assert.ok(html.includes("样片模型：<b>Seedance 2.0</b>"));
    assert.ok(html.includes("--ar:9/16"));
    assert.ok(
      html.includes(
        '作者 <b>@techhalla</b> · <a href="https://x.com/techhalla/status/1" target="_blank" rel="noopener">原帖</a>',
      ),
    );
    assert.doesNotThrow(() => new Function(script(html)));
  });

  it("keeps the source id out of sight and folds source and license", () => {
    const html = page([{ id: video.id }], [video]);
    assert.ok(html.includes(`data-id="${video.id}"`));
    assert.ok(!html.includes(`#${video.id}`));
    assert.ok(
      html.includes(
        '<span class="lic is-open">开放许可</span><details><summary>来源与许可</summary><p>LearnPrompt/awesome-seedance · MIT</p><p>MIT · 保留许可声明</p></details>',
      ),
    );
  });

  it("shows a license chip that is always visible and folds the detail", () => {
    const render = (entry, locale) =>
      renderGallery({
        title: "t",
        locale,
        candidates: buildCandidates(
          [{ id: "l" }],
          [{ ...video, id: "l", ...entry }],
        ).candidates,
      });
    const chip = (entry, locale) =>
      render(entry, locale)
        .match(/<span class="lic is-(\w+)">([^<]*)<\/span>/)
        .slice(1)
        .join("|");
    // licenseStatus from the script wins.
    assert.equal(chip({ licenseStatus: "open" }), "open|开放许可");
    assert.equal(
      chip({ licenseStatus: "attribution", license: "CC BY 4.0" }),
      "attribution|需署名",
    );
    assert.equal(
      chip({ licenseStatus: "copyleft", license: "GPL-3.0" }),
      "copyleft|GPL 仅参考",
    );
    assert.equal(
      chip({ licenseStatus: "template", license: "Hyperframes catalog" }),
      "template|模板许可",
    );
    assert.equal(
      chip({ licenseStatus: "unstated", license: "" }),
      "unstated|未声明许可",
    );
    // Without it the status comes from the license string, most restrictive first.
    assert.equal(chip({ license: "CC-BY-4.0" }), "attribution|需署名");
    assert.equal(chip({ license: "AGPL-3.0" }), "copyleft|GPL 仅参考");
    assert.equal(chip({ license: "license unknown" }), "unstated|未声明许可");
    assert.equal(chip({ license: "NOASSERTION" }), "unstated|未声明许可");
    assert.equal(chip({ license: "Apache-2.0" }), "open|开放许可");
    assert.equal(
      chip({ license: "MIT (code); media CC BY 4.0" }),
      "attribution|需署名",
    );
    assert.equal(chip({ license: "Custom terms" }), "other|许可见详情");
    // A license limited to the code or the list does not cover prompts or media.
    assert.equal(
      chip({
        license:
          "MIT (code); prompts and media keep the original authors' rights",
      }),
      "unstated|未声明许可",
    );
    assert.equal(
      chip({ license: "CC0-1.0 for the list only" }),
      "unstated|未声明许可",
    );
    // Restrictions are never dropped from the chip.
    assert.equal(
      chip({ license: "CC BY-NC 4.0" }),
      "attribution|需署名 · 不可商用",
    );
    assert.equal(
      chip({ licenseStatus: "attribution", license: "CC-BY-NC-ND-4.0" }),
      "attribution|需署名 · 不可商用 · 不可改编",
    );
    // The detail text stays folded under 来源与许可.
    const html = render({ license: "CC BY-NC-SA 4.0" });
    const folded = html.slice(html.indexOf("<summary>来源与许可</summary>"));
    assert.ok(
      folded.includes(
        "<p>CC BY-NC-SA 4.0 · 需署名 · 不可商用 · 改编需同样方式共享</p>",
      ),
    );
    assert.ok(
      render({
        license: "MIT (code); prompts keep the original authors' rights",
      }).includes(
        "<p>LearnPrompt/awesome-seedance · MIT (code); prompts keep the original authors' rights</p>",
      ),
    );
    assert.equal(
      chip({ license: "CC-BY-ND-4.0" }, "en"),
      "attribution|Credit required · no derivatives",
    );
    assert.equal(
      chip({ licenseStatus: "unstated" }, "en"),
      "unstated|No license stated",
    );
    assert.equal(
      chip({ licenseStatus: "template" }, "en"),
      "template|Template license",
    );
  });

  it("states the output model, ratio and length and the model note next to the pick button", () => {
    const html = page(
      [
        {
          id: video.id,
          targetDurationSec: 6,
          targetRatio: "16:9",
          modelMismatch: "MiniMax H3",
        },
      ],
      [video],
    );
    assert.ok(
      html.includes(
        '<p class="goal">成品：<b>MiniMax H3</b> · 比例 <b>16:9</b> · <b>6 秒</b>（样片时长只作参考）</p>',
      ),
    );
    assert.ok(
      html.includes(
        '<p class="match is-mismatched">样片来自 Seedance 2.0，你要用 MiniMax H3，效果可能不同。</p>',
      ),
    );
    assert.ok(html.indexOf('class="plan"') < html.indexOf('class="pick"'));
    assert.ok(html.indexOf('class="plan"') > html.indexOf("<textarea"));
    // Same ratio as the sample: no output ratio repeated.
    const same = page([{ id: video.id, targetRatio: "9:16" }], [video]);
    assert.ok(
      !same.includes("比例 <b>9:16</b> ·") && !same.includes('class="goal"'),
    );
    // Page-level targets apply to every card; a card can override them.
    const html2 = renderGallery({
      title: "t",
      targetDurationSec: 6,
      targetModel: "Seedance 2.0",
      candidates: buildCandidates([{ id: video.id }], [video]).candidates,
    });
    assert.ok(html2.includes("成品：<b>Seedance 2.0</b> · <b>6 秒</b>"));
    assert.ok(!page([{ id: video.id }], [video]).includes('class="plan"'));
  });

  it("shows the model state in three forms and never prints true", () => {
    const state = (pick, entry = video, pageArgs = {}) =>
      renderGallery({
        title: "t",
        ...pageArgs,
        candidates: buildCandidates([{ id: entry.id, ...pick }], [entry])
          .candidates,
      });
    const matched = state({
      modelMatch: "matched",
      versionMatch: "same",
      targetModel: "Seedance 2.0",
    });
    assert.ok(
      matched.includes(
        '<p class="match is-matched">样片就是用 Seedance 2.0 生成的。</p>',
      ),
    );
    // Names are never compared as text: same-looking names without keys stay unknown.
    const textOnly = state({}, video, { targetModel: "seedance 2.0" });
    assert.ok(
      textOnly.includes(
        "没法确认样片的 Seedance 2.0 和你要用的 seedance 2.0 是不是同一个模型",
      ),
    );
    assert.ok(!textOnly.includes("样片就是用"));
    const mismatched = state({ modelMismatch: true }, video, {
      targetModel: "Veo 3",
    });
    assert.ok(
      mismatched.includes(
        "样片来自 Seedance 2.0，你要用 Veo 3，效果可能不同。",
      ),
    );
    const unknown = state(
      { targetModel: "Veo 3" },
      { ...video, id: "u", model: null },
    );
    assert.ok(
      unknown.includes(
        '<p class="match is-unknown">样片模型未知，仅作风格参考。</p>',
      ),
    );
    assert.ok(unknown.includes("成品：<b>Veo 3</b>"));
    assert.ok(
      state(
        { modelMatch: "unknown" },
        { ...video, id: "u2", model: null },
      ).includes("样片模型未知"),
    );
    // Keys decide when both sides have them; a stale modelMatch loses.
    const keyed = { ...video, id: "k", modelKeys: ["seedance"] };
    const stale = state({ modelMatch: "matched" }, keyed, {
      targetModel: "Veo 3",
      targetModelKey: "veo",
    });
    assert.ok(
      stale.includes("样片来自 Seedance 2.0，你要用 Veo 3，效果可能不同。"),
    );
    assert.ok(!stale.includes("样片就是用"));
    const staleMismatch = state(
      { modelMatch: "mismatched", modelMismatch: true, versionMatch: "same" },
      keyed,
      { targetModel: "Seedance 2.0 Pro", targetModelKey: "seedance" },
    );
    assert.ok(staleMismatch.includes("样片就是用 Seedance 2.0 生成的。"));
    assert.ok(!staleMismatch.includes("效果可能不同"));
    // Different display names, same key (S8): matched, never "may differ".
    const grok = {
      ...video,
      id: "g",
      model: "grok-imagine-video",
      modelKeys: ["grok-imagine"],
    };
    const alias = state(
      {
        targetModel: "Grok Imagine (reference_to_video)",
        targetModelKey: "grok-imagine",
        versionMatch: "same",
      },
      grok,
      { locale: "en" },
    );
    assert.ok(alias.includes("The sample was made with grok-imagine-video."));
    assert.ok(!alias.includes("may differ"));
    // Script's modelMatch is trusted when the page has no keys.
    assert.ok(
      state({
        modelMatch: "matched",
        versionMatch: "same",
        targetModel: "Seedance",
      }).includes("样片就是用 Seedance 2.0 生成的。"),
    );
    // Known sample model and no target: only the chip, no comparison sentence.
    for (const pick of [
      {},
      { modelMatch: "unknown" },
      { modelMatch: "matched" },
      { modelMismatch: false },
    ]) {
      const html = state(pick);
      assert.ok(html.includes("样片模型：<b>Seedance 2.0</b>"));
      assert.ok(!html.includes('class="match'), JSON.stringify(pick));
    }
    // Unknown sample model: the unknown sentence, with or without a target.
    assert.ok(
      state({}, { ...video, id: "n", model: null }).includes(
        "样片模型未知，仅作风格参考。",
      ),
    );
    for (const mm of [true, "true", "Veo 3", false, null, undefined]) {
      const html = state({ modelMismatch: mm });
      assert.ok(!/(你要用|you are using) true/i.test(html), String(mm));
      assert.ok(!html.includes(">true<"), String(mm));
    }
    assert.ok(state({ modelMismatch: "true" }).includes("和你要用的模型不同"));
    assert.ok(!state({ modelMismatch: false }).includes('class="match'));
  });

  it("puts the reference-image need next to the pick button, also on the default card", () => {
    const html = page(
      [{ id: video.id, default: true }],
      [
        {
          ...video,
          referenceInputs: 3,
          referenceNote: "3 character reference images",
        },
      ],
    );
    assert.ok(
      html.includes(
        '<p class="needs"><span class="need-chip">需要 3 张参考图</span></p>',
      ),
    );
    assert.ok(!html.includes("3 character reference images"));
    const needs = html.indexOf('class="needs"');
    assert.ok(
      needs > html.indexOf("<textarea") && needs < html.indexOf('class="pick"'),
    );
    // Not inside any folded block.
    assert.equal(
      (html.slice(0, needs).match(/<details/g) || []).length,
      (html.slice(0, needs).match(/<\/details>/g) || []).length,
    );
    assert.ok(
      page(
        [{ id: video.id }],
        [{ ...video, needReferenceImages: true }],
      ).includes("需要你提供参考图"),
    );
    assert.ok(
      !page([{ id: video.id }], [{ ...video, referenceInputs: 0 }]).includes(
        'class="needs"',
      ),
    );
  });

  it("renders the whole page in English for the en locale", () => {
    const html = renderGallery({
      title: "Coffee ad",
      request: "make a 6 second coffee ad",
      locale: "en",
      targetDurationSec: 6,
      candidates: buildCandidates(
        [{ id: video.id, modelMismatch: "Veo 3", default: true }],
        [{ ...video, referenceInputs: 2, license: "CC-BY-4.0" }],
      ).candidates,
    });
    assert.ok(html.includes('<html lang="en">'));
    for (const s of [
      "Use this",
      "Recommended",
      "Sample model: <b>Seedance 2.0</b>",
      "Sample length <b>0:15</b>",
      "Output: <b>Veo 3</b> · <b>6 s</b>",
      "The sample is from Seedance 2.0; you are using Veo 3",
      "Needs 2 reference images",
      "CC BY 4.0 · credit required",
      "Source and license",
      "Original reference prompt (the AI adapts it after you pick)",
      "Copy original",
      "Undo",
      "Play sample 1",
    ])
      assert.ok(html.includes(s), s);
    assert.ok(
      !/[\u4e00-\u9fff]/u.test(
        html
          .replace(/<script>[\s\S]*<\/script>/, "")
          .replace(/<style>[\s\S]*<\/style>/, ""),
      ),
    );
    const js = script(html);
    assert.ok(js.includes('"pick {n}"'));
    assert.doesNotThrow(() => new Function(js));
    // No locale: follow the request language; Chinese by default.
    assert.ok(
      renderGallery({
        title: "t",
        request: "a coffee ad",
        candidates: [],
      }).includes('<html lang="en">'),
    );
    assert.ok(
      renderGallery({ title: "t", candidates: [] }).includes(
        '<html lang="zh-CN">',
      ),
    );
  });

  it("makes the agent's fit line the headline and the library title a reference line", () => {
    const long =
      "Minimalist 3D Clay Illustration Template With Giant Bold Typography And A Cute Stylized Character";
    const html = page(
      [{ id: "t", fit: "超大黏土字" }],
      [{ ...video, id: "t", title: long }],
    );
    assert.ok(html.includes('<h2 title="超大黏土字">超大黏土字</h2>'));
    assert.ok(
      html.includes(`<p class="ref" title="${long}">参考样片：${long}</p>`),
    );
    assert.ok(html.indexOf('class="ref"') > html.indexOf("<h2"));
    assert.match(html, /\.body h2\{[^}]*-webkit-line-clamp:2/);
    // No fit line: the library title is the headline, no reference line.
    const bare = page([{ id: "t" }], [{ ...video, id: "t", title: long }]);
    assert.ok(
      bare.includes(`<h2 title="${long}">${long}</h2>`) &&
        !bare.includes('class="ref"'),
    );
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates(
        [{ id: "t", fit: "Big clay letters" }],
        [{ ...video, id: "t", title: long }],
      ).candidates,
    });
    assert.ok(en.includes(`Reference sample: ${long}`));
  });

  it("credits a curated library instead of saying no author and no source", () => {
    const curated = {
      ...video,
      id: "y",
      author: null,
      link: null,
      curatedSource: true,
      source: "YouMind-OpenLab/awesome-nano-banana-pro-prompts",
      sourceUrl:
        "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
    };
    const html = page([{ id: "y" }], [curated]);
    assert.ok(
      html.includes(
        '<p class="who">来自 <a href="https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts" target="_blank" rel="noopener">YouMind-OpenLab/awesome-nano-banana-pro-prompts</a> 精选库</p>',
      ),
    );
    assert.ok(!html.includes("无作者") && !html.includes("无来源链接"));
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates([{ id: "y" }], [curated]).candidates,
    });
    assert.ok(
      en.includes("From the <a ") && en.includes("curated library</p>"),
    );
    // Not curated, no author, repo known: honest "no author" plus the library link.
    const plain = page(
      [{ id: "p" }],
      [{ ...curated, id: "p", curatedSource: false }],
    );
    assert.ok(
      plain.includes(
        '无作者 · <a href="https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts" target="_blank" rel="noopener">来源库</a>',
      ),
    );
    assert.ok(
      page(
        [{ id: "j" }],
        [{ ...curated, id: "j", sourceUrl: "javascript:alert(1)" }],
      ).includes("精选库"),
    );
    assert.ok(
      !page(
        [{ id: "j" }],
        [{ ...curated, id: "j", sourceUrl: "javascript:alert(1)" }],
      ).includes("javascript:"),
    );
  });

  it("labels an unadapted prompt as the original and marks its placeholders", () => {
    const mj = {
      ...video,
      id: "mj",
      kind: "image",
      videos: [],
      content:
        'A woman wearing a {argument name="beanie color" default="neon-green"} beanie, {style=cinematic} --ar 9:16 --v 6',
    };
    const html = page([{ id: "mj" }], [mj]);
    assert.ok(html.includes("原始参考提示词（选后由 AI 改写）"));
    assert.ok(html.includes(">复制原稿</button>"));
    assert.ok(
      html.includes(
        '<mark class="ph">{argument name=&quot;beanie color&quot; default=&quot;neon-green&quot;}</mark>',
      ),
    );
    assert.ok(html.includes('<mark class="ph">{style=cinematic}</mark>'));
    assert.ok(html.includes('<p class="ph-note">高亮处是待填的占位符'));
    assert.ok(html.includes('class="prompt is-original"'));
    // The textarea still holds the raw text for editing and for the pick.
    assert.ok(
      html.includes(
        "{argument name=&quot;beanie color&quot; default=&quot;neon-green&quot;} beanie",
      ),
    );
    assert.ok(!page([{ id: video.id }], [video]).includes('class="ph-note"'));
  });

  it("shows an adapted prompt as the runnable one with the original behind 原稿", () => {
    const html = page(
      [{ id: video.id, adapted: "A 6-second coffee pour, 9:16, single shot." }],
      [video],
    );
    assert.ok(html.includes("可直接用的提示词，可以改"));
    assert.ok(html.includes(">复制可用提示词</button>"));
    assert.ok(html.includes('class="prompt is-adapted"'));
    assert.ok(
      html.includes(">A 6-second coffee pour, 9:16, single shot.</textarea>"),
    );
    assert.ok(
      html.includes(
        '<details class="orig"><summary>原稿</summary><pre>A 1950s diner freezes',
      ),
    );
    assert.ok(!html.includes("原始参考提示词"));
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates([{ id: video.id, adapted: "x" }], [video])
        .candidates,
    });
    assert.ok(
      en.includes(">Copy prompt</button>") &&
        en.includes("<summary>Original</summary>"),
    );
  });

  it("shows a poster-less video's own first frame instead of a black box", () => {
    const noPoster = page(
      [{ id: "np" }],
      [{ ...video, id: "np", sourceMedia: [] }],
    );
    assert.ok(
      noPoster.includes(
        '<video src="https://cdn.example/clip.mp4#t=0.5" preload="metadata" muted loop playsinline',
      ),
    );
    assert.ok(!noPoster.includes("autoplay"));
    assert.ok(!noPoster.includes("没有封面"));
    assert.ok(noPoster.includes('class="play"'));
    // A poster the script supplied (first frame) is used as the poster.
    const framed = page(
      [{ id: "fp" }],
      [{ ...video, id: "fp", sourceMedia: ["/tmp/ps/posters/fp.jpg"] }],
    );
    assert.ok(
      framed.includes('poster="file:///tmp/ps/posters/fp.jpg" preload="none"'),
    );
    assert.ok(!framed.includes("#t=0.5"));
  });

  it("marks nested placeholders as one span and keeps the hint", () => {
    const nested = {
      ...video,
      id: "nest",
      kind: "image",
      videos: [],
      content:
        'Shot of {style={nested}} light, {argument name="hat" default="{red}"} hat, {plain} and {open',
    };
    const html = page([{ id: "nest" }], [nested]);
    assert.ok(html.includes('<mark class="ph">{style={nested}}</mark>'));
    assert.ok(
      html.includes(
        '<mark class="ph">{argument name=&quot;hat&quot; default=&quot;{red}&quot;}</mark>',
      ),
    );
    // Plain braces and an unbalanced tail stay text.
    assert.ok(!html.includes('<mark class="ph">{plain}'));
    assert.ok(html.includes("{plain} and {open"));
    assert.ok(html.includes('<p class="ph-note">'));
  });

  it("keeps a time fragment the video URL already has", () => {
    const html = page(
      [{ id: "tf" }],
      [
        {
          ...video,
          id: "tf",
          sourceMedia: [],
          videos: ["https://cdn.example/clip.mp4#t=2"],
        },
      ],
    );
    assert.ok(
      html.includes(
        '<video src="https://cdn.example/clip.mp4#t=2" preload="metadata"',
      ),
    );
    assert.ok(!html.includes("#t=2#t=0.5"));
  });

  it("renames the copy button for edited text and keeps the original copyable", () => {
    const mj = {
      ...video,
      id: "mj",
      kind: "image",
      videos: [],
      content: "A red beanie, {style=cinematic}",
    };
    const html = page([{ id: "mj" }], [mj]);
    // Unadapted: the original disclosure exists but stays hidden until an edit.
    assert.ok(
      html.includes(
        '<details class="orig" hidden><summary>原稿</summary><pre>A red beanie, {style=cinematic}</pre><button type="button" class="link copy-orig">复制原稿</button></details>',
      ),
    );
    const adapted = page([{ id: video.id, adapted: "x" }], [video]);
    assert.ok(
      adapted.includes('<details class="orig"><summary>原稿</summary>'),
    );
    assert.ok(adapted.includes('class="link copy-orig">复制原稿</button>'));
    const js = script(html);
    assert.ok(js.includes('"copyEdited":"复制修改后的提示词"'));
    assert.ok(js.includes("isEdited() ? T.copyEdited : copy.dataset.label"));
    assert.ok(
      js.includes("copyText(box.value)") &&
        js.includes("copyText(pre.textContent)"),
    );
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates([{ id: "mj" }], [mj]).candidates,
    });
    assert.ok(script(en).includes('"copyEdited":"Copy edited prompt"'));
    assert.ok(en.includes('class="link copy-orig">Copy original</button>'));
  });

  it("copies through a visible temporary node and reports a failure for manual copy", async () => {
    const js = script(page([{ id: video.id }], [video]));
    assert.ok(js.includes('"copyFail":"复制失败，请手动选中复制"'));
    const src = js.slice(
      js.indexOf("async function copyText"),
      js.indexOf("const selectNode"),
    );
    const run = async (clipboardOk, execOk) => {
      const made = [];
      const doc = {
        activeElement: null,
        body: { appendChild: (n) => (n.attached = true) },
        createElement: () => {
          const n = {
            style: {},
            attrs: {},
            setAttribute(k, v) {
              this.attrs[k] = v;
            },
            select() {
              this.selectedWhileAttached = this.attached && !this.hidden;
            },
            remove() {
              this.attached = false;
            },
          };
          made.push(n);
          return n;
        },
        execCommand: () => {
          if (execOk === "throw") throw new Error("x");
          return execOk;
        },
      };
      const nav = {
        clipboard: {
          writeText: async () => {
            if (!clipboardOk) throw new Error("denied");
          },
        },
      };
      const copyText = new Function(
        "navigator",
        "document",
        `${src}; return copyText;`,
      )(nav, doc);
      return { ok: await copyText("hello"), made };
    };
    assert.deepEqual((await run(true, false)).made, []);
    const viaExec = await run(false, true);
    assert.equal(viaExec.ok, true);
    const tmp = viaExec.made[0];
    assert.equal(tmp.value, "hello");
    assert.ok(
      tmp.selectedWhileAttached,
      "the node is attached and not hidden while selected",
    );
    assert.ok(!/display:\s*none|visibility:\s*hidden/.test(tmp.style.cssText));
    assert.equal(tmp.attached, false, "the temporary node is removed again");
    assert.equal((await run(false, false)).ok, false);
    assert.equal((await run(false, "throw")).ok, false);
    // On failure the visible text is selected for a manual copy.
    assert.ok(js.includes("if (!ok) { startEdit(false); selectNode(box); }"));
    assert.ok(js.includes("if (!ok) selectNode(pre);"));
  });

  it("keeps Chinese out of the English page script outside the locale strings", () => {
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates([{ id: video.id }], [video]).candidates,
    });
    const js = script(en);
    const outsideT = js.replace(/const T = \{.*?\};/s, "");
    assert.ok(!/[㐀-鿿]/.test(outsideT), "no CJK text in the en script logic");
    assert.ok(js.includes('"posterAlt":"{l} (poster)"'));
    assert.ok(
      js.includes('fmt(T.posterAlt, { l: video.getAttribute("aria-label") })'),
    );
    assert.ok(
      script(page([{ id: video.id }], [video])).includes(
        '"posterAlt":"{l}封面"',
      ),
    );
  });

  it("says the sample used the target model only when the version is the same", () => {
    const render = (pick, entry, locale) =>
      renderGallery({
        title: "t",
        locale,
        candidates: buildCandidates(
          [{ id: entry.id, modelMatch: "matched", ...pick }],
          [entry],
        ).candidates,
      });
    const s25 = {
      ...video,
      id: "s25",
      model: "Seedance 2.5",
      versionNote: "sample: Seedance 2.5; target: 2.0",
    };
    const diff = render(
      {
        targetModel: "Seedance 2.0",
        versionMatch: "different",
        sampleVersion: "2.5",
        targetVersion: "2.0",
      },
      s25,
    );
    assert.ok(
      diff.includes(
        '<p class="match is-version-diff">同系列，版本不同：参考用的是 Seedance 2.5，你要用 Seedance 2.0，效果可能有差别。</p>',
      ),
    );
    assert.ok(
      !diff.includes("样片就是用") && !diff.includes("sample: Seedance"),
    );
    const gpt = {
      ...video,
      id: "gpt",
      kind: "image",
      videos: [],
      model: "GPT Image 2",
      versionNote: "sample: GPT Image 2; your channel's version is not stated",
    };
    const unk = render(
      {
        targetModel: "GPT Image (Codex image_gen)",
        versionMatch: "unknown",
        sampleVersion: "2",
      },
      gpt,
    );
    assert.ok(
      unk.includes(
        '<p class="match is-version-unknown">同系列，版本未核实：参考用的是 GPT Image 2，你要用 GPT Image (Codex image_gen)，仅作风格参考。</p>',
      ),
    );
    assert.ok(!unk.includes("your channel's version"));
    // Older data without versionMatch never claims the same model either.
    const legacy = render({ targetModel: "Seedance" }, video);
    assert.ok(
      legacy.includes("同系列，版本未核实") && !legacy.includes("样片就是用"),
    );
    // Version is added to a name only when the name lacks it.
    const named = render(
      {
        targetModel: "Seedance",
        versionMatch: "different",
        sampleVersion: "2.0",
        targetVersion: "1.0 Pro",
      },
      video,
    );
    assert.ok(
      named.includes("参考用的是 Seedance 2.0，你要用 Seedance 1.0 Pro"),
    );
    assert.ok(
      render(
        { targetModel: "Seedance 2.0", versionMatch: "same" },
        video,
      ).includes("样片就是用 Seedance 2.0 生成的。"),
    );
    // English page: localized text, no Chinese, no raw versionNote.
    const en = render(
      {
        targetModel: "Seedance 2.0",
        versionMatch: "different",
        sampleVersion: "2.5",
        targetVersion: "2.0",
      },
      s25,
      "en",
    );
    assert.ok(
      en.includes(
        "Same family, different version: the reference used Seedance 2.5; you are using Seedance 2.0, so results may differ.",
      ),
    );
    const enMatch = en.match(/<p class="match[^>]*>([^<]*)<\/p>/)[1];
    assert.ok(!/[㐀-鿿]/.test(enMatch));
    assert.ok(
      render(
        { targetModel: "GPT Image", versionMatch: "unknown" },
        gpt,
        "en",
      ).includes("Same family, version not confirmed"),
    );
  });

  it("shows a code video's render engine and the model that wrote it, never as a framework", () => {
    const code = {
      ...template,
      id: "shot",
      content: "Launch video code",
      videos: ["https://cdn.example/shot.mp4"],
      model: "Claude Opus 5.5",
      renderEngine: "hyperframes",
      authoringModel: "Claude Opus 5.5",
    };
    const html = renderGallery({
      title: "t",
      candidates: buildCandidates(
        [{ id: "shot", modelMatch: "matched", targetModel: "Hyperframes" }],
        [code],
      ).candidates,
    });
    assert.ok(
      html.includes(
        '<span class="chip model">引擎：<b>Hyperframes</b></span><span class="chip">由 Claude Opus 5.5 编写</span>',
      ),
    );
    assert.ok(!html.includes("引擎：<b>Claude") && !html.includes("框架"));
    assert.ok(
      html.includes(
        '<p class="match is-matched">引擎相同：都用 Hyperframes 渲染。</p>',
      ),
    );
    assert.ok(!html.includes("样片就是用"));
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates(
        [{ id: "shot", modelMatch: "mismatched", targetModel: "Remotion" }],
        [code],
      ).candidates,
    });
    assert.ok(
      en.includes("Engine: <b>Hyperframes</b>") &&
        en.includes("Written by Claude Opus 5.5"),
    );
    assert.ok(
      en.includes(
        "This template renders with Hyperframes; you are using Remotion, so it needs a rewrite.",
      ),
    );
    // An author without an engine: no engine chip, and the author is not one.
    const authorOnly = page(
      [{ id: "a" }],
      [
        {
          ...code,
          id: "a",
          renderEngine: null,
          authoringModel: "Claude Opus 5.5",
        },
      ],
    );
    assert.ok(
      authorOnly.includes("由 Claude Opus 5.5 编写") &&
        !authorOnly.includes("引擎："),
    );
    // Old data whose model is not an engine is not called an engine.
    const old = page(
      [{ id: "o" }],
      [
        {
          ...code,
          id: "o",
          renderEngine: undefined,
          authoringModel: undefined,
        },
      ],
    );
    assert.ok(
      old.includes("样片模型：<b>Claude Opus 5.5</b>") &&
        !old.includes("引擎："),
    );
    // No render engine but a match claim: never says the authoring model renders it.
    for (const modelMatch of ["matched", "mismatched", "unknown"]) {
      const html = renderGallery({
        title: "t",
        candidates: buildCandidates(
          [{ id: "a", modelMatch, targetModel: "Hyperframes" }],
          [
            {
              ...code,
              id: "a",
              renderEngine: null,
              authoringModel: "Claude Opus 5.5",
            },
          ],
        ).candidates,
      });
      assert.ok(!/用 Claude Opus 5\.5 渲染/.test(html), modelMatch);
      assert.ok(html.includes("渲染引擎未核实"), modelMatch);
    }
  });

  it("describes a template from its title before its description", () => {
    const slam = {
      ...template,
      id: "slam",
      title: "Caption Kinetic Slam",
      description: "Big words slam in over app UI screens",
      tags: ["ui"],
    };
    const html = page([{ id: "slam" }], [slam]);
    assert.ok(html.includes("文字动画") && !html.includes("界面操作"));
    const untitled = {
      ...template,
      id: "u",
      title: "Orbit",
      description: "A dashboard with KPI counters",
    };
    assert.ok(page([{ id: "u" }], [untitled]).includes("数据图表"));
  });

  it("downgrades the evidence chip when a clip fails to load", () => {
    const js = script(page([{ id: video.id }], [video]));
    assert.ok(js.includes('card.dataset.evidence = still ? "still" : "none"'));
    assert.ok(js.includes("T.evidenceStill") && js.includes("T.evidenceNone"));
    assert.ok(
      page([{ id: video.id }], [video]).includes("只有静图（样片加载失败）"),
    );
  });

  it("states what each card can prove and keeps a card without a sample compact", () => {
    const still = { ...video, id: "st", kind: "video", videos: [] };
    const bare = { ...template, id: "bare", sourceMedia: [], evidence: "none" };
    const html = page(
      [
        { id: video.id },
        { id: "st" },
        {
          id: "bare",
          default: true,
          modelMatch: "matched",
          targetModel: "Hyperframes",
        },
      ],
      [video, still, bare],
    );
    assert.ok(html.includes('<span class="chip ev is-clip">可播放样片</span>'));
    // The still card's post is on X, so the chip points there.
    assert.ok(
      html.includes(
        '<span class="chip ev is-still">只有静图<span class="ev-more">，视频在原帖</span></span>',
      ),
    );
    // A code template has no prompt: it is judged by its description.
    assert.ok(
      html.includes(
        '<span class="chip ev is-none">没有样片<span class="ev-more">，看模板说明判断</span></span>',
      ),
    );
    const card = html.slice(html.indexOf('data-id="bare"'));
    const bareCard = card.slice(0, card.indexOf("</article>"));
    assert.ok(html.includes('class="cand is-template is-bare" data-id="bare"'));
    assert.ok(!bareCard.includes("<figure") && !bareCard.includes("no-media"));
    // Not styled as the recommendation while another card has a sample.
    assert.ok(!bareCard.includes('class="badge"'));
    assert.ok(!html.includes('class="cand is-default'));
    // No "the sample was made with" next to "no sample" (S11).
    assert.ok(
      !bareCard.includes("样片就是用") &&
        bareCard.includes("引擎相同：都用 Hyperframes 渲染。"),
    );
    // When no card has a sample, the recommendation stays.
    const allBare = page([{ id: "bare", default: true }], [bare]);
    assert.ok(
      allBare.includes('class="cand is-default is-template is-bare"') &&
        allBare.includes('class="badge"'),
    );
    // An image entry says sample image; claimed evidence is capped by what can be shown.
    const img = page(
      [{ id: "i" }],
      [{ ...video, id: "i", kind: "image", videos: [] }],
    );
    assert.ok(img.includes('<span class="chip ev is-still">有样图</span>'));
    const claimed = page(
      [{ id: "c" }],
      [{ ...still, id: "c", evidence: "clip" }],
    );
    assert.ok(claimed.includes("is-still") && !claimed.includes("is-clip"));
    const prompt = page(
      [
        {
          id: "p",
          modelMatch: "matched",
          versionMatch: "same",
          targetModel: "Seedance 2.0",
        },
      ],
      [{ ...video, id: "p", sourceMedia: [], videos: [] }],
    );
    assert.ok(
      prompt.includes("原提示词就是写给 Seedance 2.0 的。") &&
        !prompt.includes("样片就是用"),
    );
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates([{ id: "bare" }], [bare]).candidates,
    });
    assert.ok(
      en.includes(
        'No sample<span class="ev-more">; judge it by the template description</span>',
      ),
    );
  });

  it("sends a video card without a playable clip to its post on a video site", () => {
    const still = { ...video, id: "st", videos: [] };
    const bare = {
      ...video,
      id: "bare",
      videos: [],
      sourceMedia: [],
      link: "https://www.youtube.com/watch?v=abc",
    };
    const news = {
      ...video,
      id: "news",
      videos: [],
      sourceMedia: [],
      link: "https://www.theverge.com/veo-3",
    };
    const html = page(
      [{ id: video.id }, { id: "st" }, { id: "bare" }, { id: "news" }],
      [video, still, bare, news],
    );
    const card = (id) => {
      const rest = html.slice(html.indexOf(`data-id="${id}"`));
      return rest.slice(0, rest.indexOf("</article>"));
    };
    assert.ok(!card(video.id).includes('class="watch"'));
    // Over the still image, inside its frame.
    assert.match(
      card("st"),
      /<div class="frame is-loading"[\s\S]*<a class="watch" href="https:\/\/x\.com\/techhalla\/status\/1" target="_blank" rel="noopener"><svg[\s\S]*<span>去 X 看原视频<\/span><\/a>\s*<\/div>/,
    );
    // A card with nothing to show gets the button in its body.
    assert.ok(
      card("bare").includes(
        '<p class="watch-line"><a class="watch" href="https://www.youtube.com/watch?v=abc"',
      ) && card("bare").includes("去 YouTube 看原视频"),
    );
    assert.ok(
      card("bare").includes('<span class="ev-more">，视频在原帖</span>'),
    );
    // A news article is not a video post: no button, the usual chip.
    assert.ok(!card("news").includes('class="watch"'));
    assert.ok(card("news").includes("只能看提示词判断"));
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates([{ id: "st" }], [still]).candidates,
    });
    assert.ok(en.includes("Watch the original on X"));
  });

  it("points a clip that fails to play at its post when the post is on a video site", () => {
    const html = page([{ id: video.id }], [video]);
    assert.ok(
      html.includes(
        '<a class="fallback" href="https://x.com/techhalla/status/1" target="_blank" rel="noopener" hidden><span>视频放不出来，<u>去 X 看原视频</u></span></a>',
      ),
    );
    assert.ok(
      html.includes(
        '<p class="note broken-note">样片加载不出来。<a href="https://x.com/techhalla/status/1" target="_blank" rel="noopener">去 X 看原视频</a></p>',
      ),
    );
    // No video-site post: the links open the clip itself, as before.
    const own = { ...video, link: "https://example.com/case" };
    const plain = page([{ id: video.id }], [own]);
    assert.ok(
      plain.includes(
        '<a class="fallback" href="https://cdn.example/clip.mp4" target="_blank" rel="noopener" hidden><span>视频放不出来，<u>点这里在新窗口打开</u></span></a>',
      ),
    );
    assert.ok(!plain.includes('class="watch"'));
  });

  it("names the library a borrowed clip comes from", () => {
    const lent = {
      ...video,
      id: "lent",
      videoFrom: {
        sourceId: "minimax-h3-cases",
        source: "SkyNotSilent/awesome-MiniMax-H3-cases",
        id: "minimax-h3-cases:x",
      },
    };
    const html = page([{ id: "lent" }], [lent]);
    assert.ok(
      html.includes(
        '<figcaption class="lent">样片取自 <a href="https://github.com/SkyNotSilent/awesome-MiniMax-H3-cases" target="_blank" rel="noopener">SkyNotSilent/awesome-MiniMax-H3-cases</a> 收录的同一条帖子</figcaption>',
      ),
    );
    assert.ok(!page([{ id: video.id }], [video]).includes('class="lent"'));
    const odd = { ...lent, videoFrom: { source: "<b>x</b>" } };
    assert.ok(!page([{ id: "lent" }], [odd]).includes('class="lent"'));
  });

  it("separates a short candidate name from its one-line fit and clamps long titles", () => {
    const one = (pick, entry = video) =>
      page([{ id: entry.id, ...pick }], [entry]);
    const split = one({ fit: "高端极简：大字逐个揭示、大量留白、一个强调色" });
    assert.ok(split.includes(">高端极简</h2>"));
    assert.ok(
      split.includes('<p class="fit">大字逐个揭示、大量留白、一个强调色</p>'),
    );
    assert.ok(
      split.includes(
        '<p class="ref" title="Diner rewind">参考样片：Diner rewind</p>',
      ),
    );
    const named = one({
      name: "Cool macro",
      fit: "Bottle on ice with condensation, fresh and crisp",
    });
    assert.ok(
      named.includes(">Cool macro</h2>") &&
        named.includes(
          '<p class="fit">Bottle on ice with condensation, fresh and crisp</p>',
        ),
    );
    // A split English fit starts with a capital letter.
    assert.ok(
      one({ fit: "Hero spin: the bottle turns on a wet plinth" }).includes(
        '<p class="fit">The bottle turns on a wet plinth</p>',
      ),
    );
    // A long lead before a colon is not a name: the whole fit stays the headline.
    const long = one({
      fit: "Natural outdoor scene with mist and water reflections and a calm, pure mood: sample made with Gemini",
    });
    assert.ok(
      long.includes(
        ">Natural outdoor scene with mist and water reflections and a calm, pure mood: sample made with Gemini</h2>",
      ),
    );
    assert.ok(!long.includes('class="fit"'));
    // No fit: the library title is the headline.
    assert.ok(
      one({}).includes(">Diner rewind</h2>") &&
        !one({}).includes('class="ref"'),
    );
    // Titles clamp to two lines and wrap at word boundaries.
    const css = split.split("<style>")[1].split("</style>")[0];
    const rule = (sel) => css.split("\n").find((l) => l.startsWith(sel));
    for (const sel of [".body h2{", ".ref{", ".fit{"]) {
      assert.ok(rule(sel).includes("-webkit-line-clamp:2"), sel);
      assert.ok(!rule(sel).includes("overflow-wrap:anywhere"), sel);
    }
  });

  it("previews a JSON prompt from its description, leaving the editor text whole", () => {
    const json = JSON.stringify(
      {
        applicable_models: ["Seedream", "GPT Image"],
        model: "x",
        version: "2",
        aspect_ratio: "2:3",
        description: "3D paper-cut new year scene with {style=lanterns}",
        negative: "blurry",
      },
      null,
      2,
    );
    const html = page(
      [{ id: "j" }],
      [{ ...video, id: "j", kind: "image", videos: [], content: json }],
    );
    const pv = html.match(/<div class="pv">([\s\S]*?)<\/div>/)[1];
    assert.ok(
      pv.startsWith(
        'description: 3D paper-cut new year scene with <mark class="ph">{style=lanterns}</mark>',
      ),
    );
    for (const k of [
      "applicable_models",
      "aspect_ratio",
      "negative",
      "version",
    ])
      assert.ok(!pv.includes(k), k);
    assert.ok(
      html.includes("&quot;applicable_models&quot;: [") &&
        html.includes("&quot;negative&quot;: &quot;blurry&quot;\n}</textarea>"),
    );
    assert.ok(html.includes('<p class="ph-note">'));
    // Plain text and JSON without boilerplate keys are shown as they are.
    const plainJson = '{"description": "a cat"}';
    assert.ok(
      page([{ id: "k" }], [{ ...video, id: "k", content: plainJson }]).includes(
        '<div class="pv">{&quot;description&quot;: &quot;a cat&quot;}</div>',
      ),
    );
    assert.ok(
      page(
        [{ id: "b" }],
        [{ ...video, id: "b", content: "{not json" }],
      ).includes('<div class="pv">{not json</div>'),
    );
  });

  it("builds the reference-image line from the dictionary only", () => {
    const needs = (entry, locale) => {
      const html = renderGallery({
        title: "t",
        locale,
        candidates: buildCandidates(
          [{ id: "r" }],
          [{ ...video, id: "r", ...entry }],
        ).candidates,
      });
      return [html.match(/<p class="needs">(.*?)<\/p>/)?.[1] ?? "", html];
    };
    const [unclear, unclearHtml] = needs({
      referenceInputs: 1,
      referenceNote: "needs reference images (count unclear)",
    });
    assert.equal(
      unclear,
      '<span class="need-chip">需要参考图，数量没写明</span>',
    );
    assert.ok(
      !unclearHtml.includes("count unclear") &&
        !unclearHtml.includes("需要 1 张参考图"),
    );
    assert.equal(
      needs({
        referenceInputs: 2,
        referenceNote: "provided CHARACTER REFERENCE and PRODUCT REFERENCE",
      })[0],
      '<span class="need-chip">需要 2 张参考图</span>',
    );
    assert.equal(
      needs({ referenceNote: "count unclear" })[0],
      '<span class="need-chip">需要参考图，数量没写明</span>',
    );
    const [en, enHtml] = needs(
      {
        referenceInputs: 1,
        referenceNote: "needs reference images (count unclear)",
      },
      "en",
    );
    assert.equal(
      en,
      '<span class="need-chip">Needs reference images; the number is not stated</span>',
    );
    assert.ok(!enHtml.includes("count unclear"));
    assert.equal(
      needs(
        { referenceInputs: 1, referenceNote: "1 photo of the place" },
        "en",
      )[0],
      '<span class="need-chip">Needs 1 reference image</span>',
    );
  });

  it("does not call a sampleless card's reference a sample and does not repeat a template's name", () => {
    const bareVideo = page(
      [{ id: "bv", name: "Hero", fit: "Slow spin" }],
      [{ ...video, id: "bv", sourceMedia: [], videos: [] }],
    );
    assert.ok(
      bareVideo.includes(
        '<p class="ref" title="Diner rewind">参考案例：Diner rewind</p>',
      ),
    );
    assert.ok(!bareVideo.includes("参考样片"));
    const shown = page(
      [{ id: video.id, name: "Hero", fit: "Slow spin" }],
      [video],
    );
    assert.ok(shown.includes("参考样片：Diner rewind"));
    // A template names itself in its template note; no extra reference line.
    const tpl = page(
      [{ id: template.id, name: "光标演示", fit: "鼠标点过界面" }],
      [{ ...template, sourceMedia: [] }],
    );
    assert.ok(
      !tpl.includes('class="ref"') && tpl.includes("模板：<b>Agent Cursor</b>"),
    );
    assert.ok(tpl.includes("，看模板说明判断"));
  });

  it("shows the thumbnail strip only for two or more extra images and keeps one as the poster fallback", () => {
    const one = page(
      [{ id: "p1" }],
      [
        {
          ...video,
          id: "p1",
          sourceMedia: [
            "https://cdn.example/frame.jpg",
            "https://cdn.example/poster.jpg",
          ],
        },
      ],
    );
    assert.ok(!one.includes('class="thumbs"'));
    assert.ok(
      one.includes(
        'data-poster="https://cdn.example/frame.jpg" data-poster-alt="https://cdn.example/poster.jpg"',
      ),
    );
    const js = script(one);
    assert.ok(
      js.includes("f.dataset.posterAlt") &&
        js.includes('video.setAttribute("poster", posterUrl)'),
    );
    const two = page(
      [{ id: "p2" }],
      [
        {
          ...video,
          id: "p2",
          sourceMedia: [
            "https://cdn.example/frame.jpg",
            "https://cdn.example/a.jpg",
            "https://cdn.example/b.jpg",
          ],
        },
      ],
    );
    assert.ok(
      two.includes('<div class="thumbs">') && !two.includes("data-poster-alt"),
    );
    assert.equal(
      (two.match(/<a href="https:\/\/cdn\.example\/[ab]\.jpg"/g) || []).length,
      2,
    );
    // Image cards keep their extra image (often a reference input).
    const img = page(
      [{ id: "i" }],
      [
        {
          ...video,
          id: "i",
          kind: "image",
          videos: [],
          sourceMedia: [
            "https://cdn.example/a.jpg",
            "https://cdn.example/ref.jpg",
          ],
        },
      ],
    );
    assert.ok(img.includes('<div class="thumbs">'));
  });

  it("ends a long or cut-off library description at a word with an ellipsis and keeps the full text", () => {
    const cut =
      "Handwritten display text with a scalar-driven word-by-word highlight sweep and a seeded squiggle underline sized to the text; boils";
    const html = page(
      [{ id: "h" }],
      [{ ...template, id: "h", description: cut }],
    );
    assert.ok(html.includes(`title="${cut}">${cut}…</p>`));
    const long =
      Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") + ".";
    const out = page(
      [{ id: "l" }],
      [{ ...template, id: "l", description: long }],
    ).match(/<p class="template-foreign"[^>]*>([^<]*)<\/p>/)[1];
    assert.ok(out.endsWith("…") && out.length <= 221);
    assert.ok(/word\d+…$/.test(out), "cut at a word boundary");
    const css = html.split("<style>")[1];
    assert.ok(
      css.includes(
        ".template-foreign,.template-shows{display:-webkit-box;-webkit-line-clamp:3",
      ),
    );
  });

  it("puts the play control in a corner of the frame", () => {
    const css = page([{ id: video.id }], [video])
      .split("<style>")[1]
      .split("</style>")[0];
    const rule = css.split("\n").find((l) => l.startsWith(".play{"));
    assert.ok(
      rule.includes("left:10px;bottom:10px") && !rule.includes("top:50%"),
    );
  });

  it("shows one page note when no card can show a sample", () => {
    const none = page(
      [{ id: "a" }, { id: "b" }],
      [
        { ...video, id: "a", mediaState: "none" },
        { ...video, id: "b", sourceMedia: [], videos: [] },
      ],
    );
    assert.ok(
      none.includes(
        '<p class="alert show" role="status">样片暂时看不到（可能离线），可以先按提示词选。</p>',
      ),
    );
    assert.ok(!none.includes("<video"));
    const some = page([{ id: video.id }], [video]);
    assert.ok(some.includes('<p class="alert" role="status">'));
    const imageOnly = page(
      [{ id: video.id }],
      [{ ...video, mediaState: "image" }],
    );
    assert.ok(
      !imageOnly.includes("<video") && imageOnly.includes("poster.jpg"),
    );
  });

  it("says when the sample came from another model", () => {
    const named = page(
      [{ id: video.id, modelMismatch: "MiniMax H3" }],
      [video],
    );
    assert.ok(
      named.includes(
        "样片来自 Seedance 2.0，你要用 MiniMax H3，效果可能不同。",
      ),
    );
    const target = page(
      [{ id: video.id, modelMismatch: true, targetModel: "Veo 3" }],
      [video],
    );
    assert.ok(
      target.includes("样片来自 Seedance 2.0，你要用 Veo 3，效果可能不同。"),
    );
    const plain = page([{ id: video.id, modelMismatch: true }], [video]);
    assert.ok(
      plain.includes(
        "样片来自 Seedance 2.0，和你要用的模型不同，效果可能不同。",
      ),
    );
    assert.ok(!page([{ id: video.id }], [video]).includes("效果可能不同"));
  });

  it("explains an empty-content code template instead of showing an empty prompt", () => {
    const html = page([{ id: template.id }], [template]);
    assert.ok(html.includes("模板：<b>Agent Cursor</b>"));
    assert.ok(html.includes("（现成代码模板，选后 AI 照它写动画代码）"));
    assert.ok(html.includes("补充要求，可以不填"));
    assert.ok(
      html.includes('placeholder="比如：把界面上的按钮和文字换成你的产品。"'),
    );
    // Old data without renderEngine: a model that names an engine is labelled as one.
    assert.ok(html.includes("引擎：<b>Hyperframes</b>"));
    assert.ok(!html.includes("框架"));
  });

  it("derives the template example and a Chinese line from the template itself", () => {
    const chart = {
      ...template,
      id: "hyperframes:animated-bar-chart",
      title: "Animated Bar Chart",
      description:
        "Bars grow from zero and the numbers count up to the final values.",
      tags: ["chart", "data-viz"],
    };
    const html = page([{ id: chart.id }], [chart]);
    assert.ok(
      html.includes('placeholder="比如：把图表里的数据换成你的季度数字。"'),
    );
    assert.ok(html.includes("画面：数据图表"));
    assert.ok(
      html.includes(
        '<p class="template-foreign" lang="en" title="Bars grow from zero and the numbers count up to the final values.">Bars grow from zero',
      ),
    );
    const en = renderGallery({
      title: "t",
      locale: "en",
      candidates: buildCandidates([{ id: chart.id }], [chart]).candidates,
    });
    assert.ok(
      en.includes(
        'placeholder="e.g. Replace the chart data with your quarterly numbers."',
      ),
    );
    assert.ok(
      en.includes("Bars grow from zero") &&
        !en.includes('class="template-foreign"'),
    );
    // Template note and description are separate paragraphs, never glued.
    assert.ok(
      en.includes(
        'the AI writes the animation code from it.</p><p class="template-shows" title="Bars grow from zero and the numbers count up to the final values.">Bars grow from zero',
      ),
    );
    assert.ok(!html.includes("生成后再看效果"));
    assert.ok(!/from it\.[A-Z]/.test(en));
    assert.ok(
      html.includes(
        '写动画代码）。</p><p class="template-shows" title="画面：数据图表',
      ),
    );
    const chat = page(
      [{ id: "c" }],
      [{ ...template, id: "c", title: "AI Chat Reveal", tags: ["chat"] }],
    );
    assert.ok(
      chat.includes('placeholder="比如：把对话内容换成你的产品问答。"'),
    );
    const plain = page(
      [{ id: "z" }],
      [
        {
          ...template,
          id: "z",
          title: "Zebra",
          description: "粒子在画面里聚成一个标志。",
        },
      ],
    );
    assert.ok(
      plain.includes(
        'placeholder="比如：把「Zebra」里的文字和颜色换成你的内容。"',
      ),
    );
    assert.ok(plain.includes("粒子在画面里聚成一个标志。"));
    assert.ok(!plain.includes('class="template-foreign"'));
  });

  it("is honest about missing media, author and source link", () => {
    const html = page(
      [{ id: "n:1" }],
      [
        {
          id: "n:1",
          title: "Bare",
          content: "a prompt",
          sourceMedia: [],
          source: "s",
          license: "l",
        },
      ],
    );
    assert.ok(
      html.includes(
        '<span class="chip ev is-none">没有样图<span class="ev-more">，只能看提示词判断</span></span>',
      ),
    );
    assert.ok(html.includes("无作者 · 无来源链接"));
  });

  it("escapes hostile titles, authors and URLs and drops unsafe schemes", () => {
    const hostile = {
      id: 'evil"><script>alert(1)</script>',
      kind: "video",
      title: "<img src=x onerror=alert(1)>",
      content: "</textarea><script>alert(2)</script>",
      author: '"><b onmouseover=alert(3)>',
      link: "javascript:alert(4)",
      sourceMedia: [
        'https://cdn.example/p.jpg"><script>alert(5)</script>',
        "data:image/png;base64,AAAA",
      ],
      videos: [
        "javascript:alert(6)",
        'https://cdn.example/v.mp4" onerror="alert(7)',
      ],
      model: "<i>m</i>",
      ratio: "16:9;background:red",
      source: "<s>",
      license: "<l>",
    };
    const html = renderGallery({
      title: "</title><script>alert(8)</script>",
      runId: "</script><script>alert(9)</script>",
      candidates: buildCandidates([{ id: hostile.id }], [hostile]).candidates,
    });
    for (let n = 1; n <= 9; n += 1)
      assert.ok(!html.includes(`<script>alert(${n})`), `alert(${n})`);
    assert.ok(!html.includes("javascript:"));
    assert.ok(!html.includes("data:image"));
    assert.ok(!html.includes('" onerror="alert'));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(html.includes("无来源链接"));
    assert.ok(html.includes("--ar:16/9"));
    assert.equal(html.split("</script>").length - 1, 2);
    assert.doesNotThrow(() => new Function(script(html)));
  });

  it("keeps local samples as file:// URLs when the page is opened as a file", () => {
    const html = renderGallery({
      title: "t",
      candidates: [
        {
          id: "l",
          title: "L",
          content: "p",
          images: ["/tmp/ps/a poster.png", "/etc/passwd"],
          videos: ["/tmp/ps/clip.mp4"],
        },
      ],
    });
    assert.ok(
      html.includes(`poster="${pathToFileURL("/tmp/ps/a poster.png").href}"`),
    );
    assert.ok(html.includes(`src="${pathToFileURL("/tmp/ps/clip.mp4").href}"`));
    assert.ok(!html.includes("/etc/passwd"));
  });
});

describe("gallery server", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-media-"));
  const clip = path.join(dir, "clip.mp4");
  const poster = path.join(dir, "poster.png");
  const secret = path.join(dir, "secret.png");
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  fs.writeFileSync(clip, bytes);
  fs.writeFileSync(poster, Buffer.from("png"));
  fs.writeFileSync(secret, Buffer.from("not referenced"));
  const html = renderGallery({
    title: "t",
    candidates: buildCandidates(
      [{ id: "x" }],
      [
        {
          id: "x",
          kind: "video",
          title: "Local",
          content: "p",
          sourceMedia: [poster],
          videos: [pathToFileURL(clip).href],
        },
      ],
    ).candidates,
  });

  it("serves only the local samples the page references and rewrites them", async () => {
    const { base, close } = await serve(html);
    try {
      const pageHtml = await (await fetch(base)).text();
      assert.ok(!pageHtml.includes("file://"));
      assert.ok(pageHtml.includes('poster="/media/0/poster.png"'));
      assert.ok(pageHtml.includes('src="/media/1/clip.mp4"'));
      const img = await rawGet(base, "/media/0/poster.png");
      assert.equal(img.status, 200);
      assert.equal(img.headers["content-type"], "image/png");
      const vid = await rawGet(base, "/media/1/clip.mp4");
      assert.equal(vid.status, 200);
      assert.equal(vid.headers["content-type"], "video/mp4");
      assert.equal(vid.headers["accept-ranges"], "bytes");
      assert.deepEqual(vid.body, bytes);
      for (const p of [
        "/media/2/secret.png",
        "/media/0/../secret.png",
        secret,
        "/etc/passwd",
        "/g.html",
        "/media/x/clip.mp4",
      ])
        assert.equal((await rawGet(base, p)).status, 404, p);
      const rebound = await rawGet(base, "/media/1/clip.mp4", {
        host: "evil.example:80",
      });
      assert.equal(rebound.status, 404);
    } finally {
      await close();
    }
  });

  it("follows a symlink only to a real media file and refuses one planted later", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ps-link-"));
    const secretTxt = path.join(d, "secret.txt");
    fs.writeFileSync(secretTxt, "private");
    fs.writeFileSync(path.join(d, "real.png"), "png-bytes");
    fs.symlinkSync(secretTxt, path.join(d, "evil.png"));
    fs.symlinkSync(path.join(d, "real.png"), path.join(d, "alias.png"));
    fs.mkdirSync(path.join(d, "folder.png"));
    const late = path.join(d, "late.png");
    const linked = renderGallery({
      title: "t",
      candidates: [
        {
          id: "x",
          title: "L",
          content: "p",
          images: [
            path.join(d, "alias.png"),
            path.join(d, "evil.png"),
            path.join(d, "folder.png"),
            late,
          ],
        },
      ],
    });
    assert.ok(!linked.includes("evil.png"));
    assert.ok(!linked.includes("folder.png"));
    fs.symlinkSync(secretTxt, late);
    const { base, close } = await serve(linked);
    try {
      const pageHtml = await (await fetch(base)).text();
      assert.ok(
        pageHtml.includes('src="/media/0/alias.png"') ||
          pageHtml.includes('src="/media/0/real.png"'),
      );
      const alias = await rawGet(base, "/media/0/real.png");
      assert.equal(alias.status, 200);
      assert.equal(alias.body.toString(), "png-bytes");
      const planted = await rawGet(base, "/media/1/late.png");
      assert.equal(planted.status, 404);
      assert.ok(!planted.body.toString().includes("private"));
    } finally {
      await close();
    }
  });

  it("survives a vanished file, an unreadable file and a dropped client", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ps-robust-"));
    const gone = path.join(d, "gone.mp4");
    const locked = path.join(d, "locked.mp4");
    const big = path.join(d, "big.mp4");
    fs.writeFileSync(gone, "x");
    fs.writeFileSync(locked, "x");
    fs.writeFileSync(big, Buffer.alloc(8 * 1024 * 1024, 1));
    const robust = renderGallery({
      title: "t",
      candidates: [
        {
          id: "x",
          kind: "video",
          title: "R",
          content: "p",
          videos: [gone, locked, big],
        },
      ],
    });
    fs.unlinkSync(gone);
    fs.chmodSync(locked, 0);
    const { base, close } = await serve(robust);
    try {
      assert.equal((await rawGet(base, "/media/0/gone.mp4")).status, 404);
      const unreadable = await rawGet(base, "/media/1/locked.mp4");
      if (process.getuid?.() !== 0) assert.equal(unreadable.status, 500);
      await new Promise((resolve) => {
        const u = new URL("/media/2/big.mp4", base);
        const req = http.get(
          { host: u.hostname, port: u.port, path: u.pathname },
          (res) => {
            res.once("data", () => {
              req.destroy();
              setTimeout(resolve, 50);
            });
          },
        );
        req.on("error", () => {});
      });
      assert.equal((await fetch(base)).status, 200);
      assert.equal(
        (await rawGet(base, "/media/2/big.mp4", { range: "bytes=0-3" })).status,
        206,
      );
    } finally {
      fs.chmodSync(locked, 0o600);
      await close();
    }
  });

  it("rewrites a poster-less local clip, time fragment included", async () => {
    const bare = renderGallery({
      title: "t",
      candidates: [
        {
          id: "x",
          kind: "video",
          title: "B",
          content: "p",
          videos: [pathToFileURL(clip).href],
        },
      ],
    });
    assert.ok(
      bare.includes(
        `src="${pathToFileURL(clip).href}#t=0.5" preload="metadata"`,
      ),
    );
    const { base, close } = await serve(bare);
    try {
      const served = await (await fetch(base)).text();
      assert.ok(served.includes('src="/media/0/clip.mp4#t=0.5"'));
      assert.ok(!served.includes("file://"));
      assert.equal((await rawGet(base, "/media/0/clip.mp4")).status, 200);
    } finally {
      await close();
    }
  });

  it("answers byte Range requests for video seeking", async () => {
    const { base, close } = await serve(html);
    try {
      const mid = await rawGet(base, "/media/1/clip.mp4", {
        range: "bytes=10-19",
      });
      assert.equal(mid.status, 206);
      assert.equal(mid.headers["content-range"], "bytes 10-19/1000");
      assert.equal(mid.headers["content-length"], "10");
      assert.deepEqual(mid.body, bytes.subarray(10, 20));
      const open = await rawGet(base, "/media/1/clip.mp4", {
        range: "bytes=990-",
      });
      assert.deepEqual(open.body, bytes.subarray(990));
      const tail = await rawGet(base, "/media/1/clip.mp4", {
        range: "bytes=-5",
      });
      assert.equal(tail.headers["content-range"], "bytes 995-999/1000");
      assert.deepEqual(tail.body, bytes.subarray(995));
      const past = await rawGet(base, "/media/1/clip.mp4", {
        range: "bytes=2000-",
      });
      assert.equal(past.status, 416);
      assert.equal(past.headers["content-range"], "bytes */1000");
    } finally {
      await close();
    }
  });
});
