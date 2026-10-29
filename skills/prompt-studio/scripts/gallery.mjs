// Candidate gallery: one HTML page that shows each recommended prompt with its
// sample images or clips, an editable prompt, model, author, source and license.
// Served with `--serve`, a click on 选这个 sends the pick (and any edit) straight
// back to the agent; opened as a file, the same click copies a reply to paste
// into the chat.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// JSON that is safe inside an inline <script>.
const scriptJson = (v) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
};
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv)$/i;
const mimeOf = (file) => MIME[path.extname(file).slice(1).toLowerCase()];

// Absolute local path for a file:// URL or an absolute path; null otherwise.
function localPath(u) {
  const s = String(u || "").trim();
  if (/^file:\/\//i.test(s)) {
    try {
      return fileURLToPath(s);
    } catch {
      return null;
    }
  }
  if (/^\/(?!\/)/.test(s) || /^[a-z]:[\\/]/i.test(s)) return path.resolve(s);
  return null;
}

// Only web and local media references are rendered; anything else is dropped.
// Local files become file:// URLs (serveGallery swaps them for served URLs).
function safeMedia(u, ext) {
  const s = String(u || "").trim();
  const local = localPath(s);
  if (local) return ext.test(local) ? pathToFileURL(local).href : null;
  if (/^https?:\/\//i.test(s) || /^\.{1,2}\//.test(s)) return s;
  return /^[\w.-]+$/.test(s) && ext.test(s) ? s : null;
}
const safeImage = (u) => safeMedia(u, IMAGE_EXT);
const safeVideo = (u) => safeMedia(u, VIDEO_EXT);
const safeLink = (u) =>
  /^https?:\/\//i.test(String(u || "")) ? String(u) : null;

// Every visible string, in the page's locale. Library data is never translated.
const TEXT = {
  zh: {
    lang: "zh-CN",
    pageTitle: "选一个方向",
    kind: { image: "图片", video: "视频", "code-video": "代码视频" },
    template: "模板",
    sampleModel: "样片模型",
    engine: "引擎",
    writtenBy: (m) => `由 ${m} 编写`,
    sampleRatio: "样片比例",
    sampleLength: "样片时长",
    promptLang: { zh: "中文提示词", en: "英文提示词" },
    output: "成品",
    outputRatio: "比例",
    seconds: (n) => `${n} 秒`,
    lengthNote: "样片时长只作参考",
    matched: (m) => `样片就是用 ${m} 生成的。`,
    matchedRef: (m) => `原提示词就是写给 ${m} 的。`,
    versionDiff: (a, b) =>
      `同系列，版本不同：参考用的是 ${a}，你要用 ${b}，效果可能有差别。`,
    versionUnknown: (a, b) =>
      `同系列，版本未核实：参考用的是 ${a}，你要用 ${b}，仅作风格参考。`,
    mismatchedRef: (a, b) => `原提示词写给 ${a}，你要用 ${b}，效果可能不同。`,
    unknownRef: "原提示词适用的模型未知，仅作风格参考。",
    engineMatched: (e) => `引擎相同：都用 ${e} 渲染。`,
    engineMismatched: (a, b) => `这个模板用 ${a} 渲染，你要用 ${b}，需要改写。`,
    engineUnknown: "渲染引擎未核实，仅作参考。",
    evidence: {
      clip: "可播放样片",
      still: { image: "有样图", other: "只有静图" },
      none: { image: "没有样图", other: "没有样片" },
    },
    noMediaInline: "只能看提示词判断",
    noMediaTemplate: "看模板说明判断",
    refCase: "参考案例",
    needsUnclear: "需要参考图，数量没写明",
    license: {
      open: "开放许可",
      attribution: "需署名",
      copyleft: "GPL 仅参考",
      template: "模板许可",
      unstated: "未声明许可",
      other: "许可见详情",
      nc: "不可商用",
      nd: "不可改编",
    },
    mismatched: (a, b) => `样片来自 ${a}，你要用 ${b}，效果可能不同。`,
    mismatchedNoTarget: (a) =>
      `样片来自 ${a}，和你要用的模型不同，效果可能不同。`,
    mismatchedNoModel: (b) => `样片不是用 ${b} 做的，效果可能不同。`,
    unknown: "样片模型未知，仅作风格参考。",
    unknownPair: (a, b) =>
      `没法确认样片的 ${a} 和你要用的 ${b} 是不是同一个模型，仅作风格参考。`,
    refSample: "参考样片",
    curated: (lib) => `来自 ${lib} 精选库`,
    library: "来源库",
    promptAdapted: "可直接用的提示词，可以改",
    promptOriginal: "原始参考提示词（选后由 AI 改写）",
    copyAdapted: "复制可用提示词",
    copyOriginal: "复制原稿",
    edit: "编辑",
    placeholders: "高亮处是待填的占位符，选后 AI 会按你的需求填好。",
    needs: (n) => (n > 0 ? `需要 ${n} 张参考图` : "需要你提供参考图"),
    by: "作者",
    noAuthor: "无作者",
    post: "原帖",
    templatePage: "模板页",
    noLink: "无来源链接",
    sourceLicense: "来源与许可",
    promptLabel: "提示词，可以直接改",
    extraLabel: "补充要求，可以不填",
    reset: "恢复",
    copy: "复制",
    more: "展开全文",
    less: "收起",
    original: "原稿",
    pick: "选这个",
    recommended: "推荐",
    templateNote: (t) =>
      `模板：<b>${t}</b>（现成代码模板，选后 AI 照它写动画代码）。`,
    shows: (list) => `画面：${list.join("、")}。`,
    exampleFallback: (t) => `比如：把「${t}」里的文字和颜色换成你的内容。`,
    example: (e) => `比如：${e}。`,
    play: (n) => `播放第 ${n} 个样片`,
    sampleOf: (t) => `${t} 的样片`,
    imageOf: (t) => `${t} 的样图`,
    viewLarge: "看大图",
    imageBroken: "样图加载不出来。",
    videoBroken: "样片加载不出来。",
    tryTab: "在新窗口试试",
    videoFallback: "视频放不出来，",
    videoFallbackLink: "点这里在新窗口打开",
    posterBroken: "封面加载不出来，点播放看样片",
    noPoster: "没有封面，点播放看样片",
    noMedia: (what) =>
      `<b>没有${what}</b>资料库里这一条没有可看的${what}，只能看提示词判断。`,
    sampleWord: { image: "样图", other: "样片" },
    head: (request, anyVideo, n) =>
      `${request ? `${request}。` : ""}${anyVideo ? "看样片挑一个（视频移上去或点一下就播放）" : "看图挑一个"}，点「选这个」或按数字键 <kbd>1</kbd>–<kbd>${n}</kbd>。想改提示词，先在框里改。`,
    offline: "样片暂时看不到（可能离线），可以先按提示词选。",
    empty: "这次没找到合适的案例。回到对话里说一句想要的画面，我直接写一版。",
    undo: "撤销",
  },
  en: {
    lang: "en",
    pageTitle: "Pick a direction",
    kind: { image: "Image", video: "Video", "code-video": "Code video" },
    template: " template",
    sampleModel: "Sample model",
    engine: "Engine",
    writtenBy: (m) => `Written by ${m}`,
    sampleRatio: "Sample ratio",
    sampleLength: "Sample length",
    promptLang: { zh: "Chinese prompt", en: "English prompt" },
    output: "Output",
    outputRatio: "ratio",
    seconds: (n) => `${n} s`,
    lengthNote: "the sample length is only a reference",
    matched: (m) => `The sample was made with ${m}.`,
    matchedRef: (m) => `The original prompt was written for ${m}.`,
    versionDiff: (a, b) =>
      `Same family, different version: the reference used ${a}; you are using ${b}, so results may differ.`,
    versionUnknown: (a, b) =>
      `Same family, version not confirmed: the reference used ${a}; you are using ${b}. Use it as a style reference only.`,
    mismatchedRef: (a, b) =>
      `The original prompt was written for ${a}; you are using ${b}, so results may differ.`,
    unknownRef:
      "The original prompt's model is unknown: use it as a style reference only.",
    engineMatched: (e) => `Same engine: renders with ${e}.`,
    engineMismatched: (a, b) =>
      `This template renders with ${a}; you are using ${b}, so it needs a rewrite.`,
    engineUnknown: "Render engine not confirmed: use it as a reference only.",
    evidence: {
      clip: "Playable sample",
      still: { image: "Sample image", other: "Still only" },
      none: { image: "No sample image", other: "No sample" },
    },
    noMediaInline: "judge it by the prompt",
    noMediaTemplate: "judge it by the template description",
    refCase: "Reference",
    needsUnclear: "Needs reference images; the number is not stated",
    license: {
      open: "Open license",
      attribution: "Credit required",
      copyleft: "GPL: reference only",
      template: "Template license",
      unstated: "No license stated",
      other: "See license details",
      nc: "non-commercial",
      nd: "no derivatives",
    },
    mismatched: (a, b) =>
      `The sample is from ${a}; you are using ${b}, so results may differ.`,
    mismatchedNoTarget: (a) =>
      `The sample is from ${a}, not your model, so results may differ.`,
    mismatchedNoModel: (b) =>
      `The sample was not made with ${b}, so results may differ.`,
    unknown: "Sample model unknown: use it as a style reference only.",
    unknownPair: (a, b) =>
      `Can't tell whether the sample's ${a} is the same model as your ${b}; use it as a style reference only.`,
    refSample: "Reference sample",
    curated: (lib) => `From the ${lib} curated library`,
    library: "Source library",
    promptAdapted: "Prompt ready to use (edit freely)",
    promptOriginal:
      "Original reference prompt (the AI adapts it after you pick)",
    copyAdapted: "Copy prompt",
    copyOriginal: "Copy original",
    edit: "Edit",
    placeholders:
      "Highlighted parts are placeholders; the AI fills them in for your request after you pick.",
    needs: (n) =>
      n > 0
        ? `Needs ${n} reference image${n === 1 ? "" : "s"}`
        : "Needs your reference images",
    by: "By",
    noAuthor: "No author",
    post: "Original post",
    templatePage: "Template page",
    noLink: "No source link",
    sourceLicense: "Source and license",
    promptLabel: "Prompt (edit freely)",
    extraLabel: "Extra requests (optional)",
    reset: "Reset",
    copy: "Copy",
    more: "Show full prompt",
    less: "Collapse",
    original: "Original",
    pick: "Use this",
    recommended: "Recommended",
    templateNote: (t) =>
      `Template: <b>${t}</b>. A ready-made code template; pick it and the AI writes the animation code from it.`,
    shows: (list) => `Shows: ${list.join(", ")}.`,
    exampleFallback: (t) =>
      `e.g. Replace the text and colors in "${t}" with yours.`,
    example: (e) => `e.g. ${e}.`,
    play: (n) => `Play sample ${n}`,
    sampleOf: (t) => `Sample of ${t}`,
    imageOf: (t) => `Sample image of ${t}`,
    viewLarge: "View full size",
    imageBroken: "The sample image failed to load. ",
    videoBroken: "The sample failed to load. ",
    tryTab: "Try in a new tab",
    videoFallback: "The video won't play. ",
    videoFallbackLink: "Open it in a new tab",
    posterBroken: "Poster failed to load; press play",
    noPoster: "No poster; press play",
    noMedia: (what) =>
      `<b>No ${what}</b>This entry has no ${what} to show; judge it by the prompt.`,
    sampleWord: { image: "sample image", other: "sample" },
    head: (request, anyVideo, n) =>
      `${request ? `${request}. ` : ""}Pick one by its ${anyVideo ? "sample (videos play on hover or tap)" : "image"}, then click “Use this” or press <kbd>1</kbd>–<kbd>${n}</kbd>. To change a prompt, edit it in its box first.`,
    offline:
      "Samples can't be shown right now (maybe offline). You can still pick by prompt.",
    empty:
      "No good match this time. Describe the picture you want in the chat and I'll write one.",
    undo: "Undo",
  },
};

// Strings the page script needs, in the page's locale.
const SCRIPT_TEXT = {
  zh: {
    pickedIn: "已选第 {n} 个，{s} 秒后",
    toAi: "发给 AI",
    toCopy: "复制回复",
    sending: "发送中…",
    copying: "复制中…",
    done: "已选第 {n} 个{e}，AI 会接着做。对话没反应的话，「{r}」已复制，粘贴发送即可。",
    doneEdited: "（用你改过的提示词）",
    reply: "选 {n}",
    replyEdited: "选 {n}，提示词改成：\n",
    copied: "已复制「{r}」，回到对话里粘贴发送。",
    copiedEdited: "选 {n} + 改过的提示词",
    replyHint: "回到对话里回复「选 {n}」{e}",
    replyHintEdited: "，并贴上改过的提示词。",
    replyHintPlain: "。",
    picked: "已选",
    copy: "复制",
    copyOk: "已复制",
    copyFail: "复制失败，请手动选中复制",
    copyEdited: "复制修改后的提示词",
    posterAlt: "{l}封面",
    evidenceStill: "只有静图（样片加载失败）",
    evidenceNone: "样片加载失败",
    more: "展开全文",
    less: "收起",
  },
  en: {
    pickedIn: "Picked #{n}. ",
    toAi: "Sending to the AI in {s} s",
    toCopy: "Copying a reply in {s} s",
    sending: "Sending…",
    copying: "Copying…",
    done: "Picked #{n}{e}. The AI will continue. If the chat stays idle, “{r}” is copied: paste it and send.",
    doneEdited: " (with your edited prompt)",
    reply: "pick {n}",
    replyEdited: "pick {n}, prompt changed to:\n",
    copied: "Copied “{r}”. Paste it in the chat and send.",
    copiedEdited: "pick {n} + edited prompt",
    replyHint: "Reply “pick {n}” in the chat{e}",
    replyHintEdited: ", and paste your edited prompt.",
    replyHintPlain: ".",
    picked: "Picked",
    copy: "Copy",
    copyOk: "Copied",
    copyFail: "Copy failed; the text is selected, copy it manually",
    copyEdited: "Copy edited prompt",
    posterAlt: "{l} (poster)",
    evidenceStill: "Still only (clip failed to load)",
    evidenceNone: "Clip failed to load",
    more: "Show full prompt",
    less: "Collapse",
  },
};

// "16:9" -> "16/9", used as the media frame's aspect ratio so slow media does
// not make the card jump when it arrives.
function aspect(ratio, kind) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(
    String(ratio || ""),
  );
  if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return `${m[1]}/${m[2]}`;
  return kind === "image" ? "4/3" : "16/9";
}
const sameRatio = (a, b) => {
  const [x, y] = [aspect(a, "x"), aspect(b, "x")].map((r) => {
    const [w, h] = r.split("/").map(Number);
    return w / h;
  });
  return Math.abs(x - y) < 0.02;
};

function clock(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
};

// Code-video templates often ship an English description only. These words map
// what a template shows to a plain line and an example edit that fits it.
const TEMPLATE_HINTS = [
  [
    /\b(bar|chart|graph|stats?|data|metrics?|kpi|counter|count|numbers?)\b/i,
    ["数据图表", "data chart"],
    [
      "把图表里的数据换成你的季度数字",
      "Replace the chart data with your quarterly numbers",
    ],
  ],
  [
    /\b(chat|messages?|assistant|conversation|answer|reply)\b/i,
    ["聊天对话", "chat"],
    [
      "把对话内容换成你的产品问答",
      "Replace the conversation with your product Q&A",
    ],
  ],
  [
    /\b(cursor|click|ui|app|screens?|dashboard|mock-ui|interface)\b/i,
    ["界面操作", "UI walkthrough"],
    [
      "把界面上的按钮和文字换成你的产品",
      "Replace the buttons and text with your product",
    ],
  ],
  [
    /\b(rank|ranking|ranked|leaderboard|re-ranks?)\b/i,
    ["排名列表", "ranking"],
    ["把排名里的选项换成你自己的", "Replace the ranked items with yours"],
  ],
  [
    /\b(logo|brand|intro|outro)\b/i,
    ["品牌标志", "logo"],
    ["把标志和品牌名换成你的", "Replace the logo and brand name with yours"],
  ],
  [
    /\b(title|text|typography|caption|subtitle|quote|typing|types|words?)\b/i,
    ["文字动画", "animated text"],
    ["把标题文字换成你的口号", "Replace the headline with your slogan"],
  ],
  [
    /\b(money|price|revenue|sales|dollars?|cash)\b/i,
    ["金额数字", "money figures"],
    ["把金额换成你的销售额", "Replace the amounts with your sales figures"],
  ],
  [
    /\b(map|route|location|globe)\b/i,
    ["地图路线", "map route"],
    ["把地图上的地点换成你的路线", "Replace the places with your route"],
  ],
  [
    /\b(countdown|timer|clock)\b/i,
    ["倒计时", "countdown"],
    ["把倒计时改成你的活动时间", "Set the countdown to your event time"],
  ],
  [
    /\b(photos?|images?|gallery|slideshow|product)\b/i,
    ["图片展示", "photo showcase"],
    ["把图片换成你的产品照片", "Replace the photos with your product shots"],
  ],
  [
    /\b(transition|wipe|reveal|motion|path)\b/i,
    ["转场动效", "transitions"],
    [
      "把转场前后的画面换成你的内容",
      "Replace the shots around the transition with yours",
    ],
  ],
];
const hasCjk = (t) => /\p{Script=Han}/u.test(String(t || ""));

function templateHint(c, t, zh) {
  const words = (list) =>
    list.map((v) => String(v ?? "").replace(/[-_]/g, " ")).join(" ");
  // The title names what the template shows; description and tags are used
  // only when the title says nothing, since they mention incidental parts.
  const hitsIn = (text) => TEMPLATE_HINTS.filter(([re]) => re.test(text));
  const titleHits = hitsIn(words([c.title]));
  const hits = titleHits.length
    ? titleHits
    : hitsIn(words([c.description, ...(Array.isArray(c.tags) ? c.tags : [])]));
  const pick = zh ? 0 : 1;
  const example = hits.length
    ? t.example(hits[0][2][pick])
    : t.exampleFallback(String(c.title || "template"));
  const description = String(c.description || "").trim();
  // Show the description itself when it is in the page language; otherwise a
  // plain line built from what the template's words say it shows.
  const native = description && hasCjk(description) === zh;
  const shows = native
    ? description
    : hits.length
      ? t.shows(hits.slice(0, 3).map((h) => h[1][pick]))
      : "";
  return { example, shows, foreign: native ? "" : description };
}

// Library descriptions can be long or cut off at the source ("…; boils").
// Long text is cut at a word boundary; text that stops without closing
// punctuation gets an ellipsis so it reads as unfinished. The full text goes
// in the title attribute.
function shortText(text, max = 220) {
  let s = String(text).trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const space = cut.lastIndexOf(" ");
    s = (hasCjk(cut) || space < max * 0.6 ? cut : cut.slice(0, space)).replace(
      /[\s,;:，；：、]+$/u,
      "",
    );
    return `${s}…`;
  }
  return /[.!?。！？…)"'」』）]$/u.test(s) ? s : `${s}…`;
}

// Short license line that is always visible; the full text stays folded.
// It never drops a restriction: NC/ND/SA show up, and a license with several
// ids or a scope ("MIT (code); prompts keep…") points to the details instead.
const LICENSE_IDS =
  /\b(CC[-\s]?BY(?:[-\s](?:NC|ND|SA))*|CC[-\s]?0|MIT|Apache|GPL|LGPL|AGPL|BSD|MPL|ISC|Unlicense)\b/gi;
function licenseSummary(license, zh) {
  const s = String(license || "").trim();
  const unknown = zh
    ? "未声明许可 · 仅作参考"
    : "No license stated · reference only";
  const details = zh ? "许可见详情" : "See license details";
  if (!s || /^(license unknown|unknown|noassertion|none|null|n\/a)$/i.test(s))
    return unknown;
  const ids = new Set(
    (s.match(LICENSE_IDS) || []).map((x) =>
      x.toUpperCase().replace(/[-\s]+/g, ""),
    ),
  );
  const scoped =
    /[;()]|\b(code|prompts?|media|images?|videos?|rights|except|only)\b/i.test(
      s,
    );
  if (ids.size !== 1 || scoped) return details;
  const ver = /(\d\.\d)/.exec(s)?.[1];
  const cc = /\bCC[-\s]?BY((?:[-\s](?:NC|ND|SA))*)/i.exec(s);
  if (cc) {
    const mods = (cc[1].match(/NC|ND|SA/gi) || []).map((m) => m.toUpperCase());
    const name = `CC BY${mods.length ? `-${mods.join("-")}` : ""}${ver ? ` ${ver}` : ""}`;
    const rules = [zh ? "需署名" : "credit required"];
    if (mods.includes("NC")) rules.push(zh ? "不可商用" : "non-commercial");
    if (mods.includes("ND")) rules.push(zh ? "不可改编" : "no derivatives");
    if (mods.includes("SA"))
      rules.push(zh ? "改编需同样方式共享" : "share alike");
    return [name, ...rules].join(" · ");
  }
  if (/\bCC[-\s]?0\b/i.test(s))
    return zh ? "CC0 · 可自由使用" : "CC0 · free to use";
  if (/\bMIT\b/i.test(s))
    return zh ? "MIT · 保留许可声明" : "MIT · keep the notice";
  if (/\bApache/i.test(s))
    return zh
      ? `Apache-${ver || "2.0"} · 保留许可声明`
      : `Apache-${ver || "2.0"} · keep the notice`;
  return details;
}

// Always-visible license chip. licenseStatus from the script wins; without it
// the status is derived from the license string, most restrictive first. A
// CC non-commercial or no-derivatives term is always added to the chip.
const LICENSE_STATUS = [
  "open",
  "attribution",
  "copyleft",
  "template",
  "unstated",
];
function licenseStatusOf(c) {
  if (LICENSE_STATUS.includes(c.licenseStatus)) return c.licenseStatus;
  const s = String(c.license || "").trim();
  if (!s || /^(license unknown|unknown|noassertion|none|null|n\/a)$/i.test(s))
    return "unstated";
  if (/\b(A|L)?GPL\b/i.test(s)) return "copyleft";
  if (/\bCC[-\s]?BY\b/i.test(s)) return "attribution";
  // A license limited to the code or the list leaves prompts and media unlicensed.
  if (/\(code\)|for the list only|original authors|retain rights/i.test(s))
    return "unstated";
  if (/\b(MIT|Apache|BSD|ISC|MPL|CC[-\s]?0|Unlicense)\b/i.test(s))
    return "open";
  return "other";
}
function licenseChip(c, t) {
  const status = licenseStatusOf(c);
  const mods =
    /\bCC[-\s]?BY((?:[-\s](?:NC|ND|SA))*)/i.exec(
      String(c.license || ""),
    )?.[1] || "";
  const parts = [t.license[status]];
  if (/NC/i.test(mods)) parts.push(t.license.nc);
  if (/ND/i.test(mods)) parts.push(t.license.nd);
  return { status, text: parts.join(" · ") };
}

// What the card can prove, capped by what it can actually show: "clip" (a
// playable video), "still" (an image only) or "none".
const EVIDENCE_RANK = { none: 0, still: 1, clip: 2 };
function visibleMedia(c) {
  const state = c.mediaState;
  const images =
    state === "none"
      ? []
      : (c.images || [c.image]).map(safeImage).filter(Boolean);
  const videos =
    state === "none" || state === "image"
      ? []
      : (c.videos || []).map(safeVideo).filter(Boolean);
  const shown = videos.length ? "clip" : images.length ? "still" : "none";
  const evidence =
    c.evidence in EVIDENCE_RANK &&
    EVIDENCE_RANK[c.evidence] < EVIDENCE_RANK[shown]
      ? c.evidence
      : shown;
  return { images, videos, evidence };
}

// Code-video render engines get their usual spelling; other names stay as sent.
const ENGINES = {
  hyperframes: "Hyperframes",
  remotion: "Remotion",
  manim: "Manim",
  p5: "p5.js",
  "motion-canvas": "Motion Canvas",
};
const isEngine = (e) => Object.hasOwn(ENGINES, String(e || "").toLowerCase());
const engineName = (e) =>
  e ? (isEngine(e) ? ENGINES[String(e).toLowerCase()] : String(e)) : "";
const withVersion = (name, ver) =>
  ver && !String(name).toLowerCase().includes(String(ver).toLowerCase())
    ? `${name} ${ver}`
    : String(name);

// A short candidate name and its one-line fit. The pick's name wins; else a
// fit written as "Name: what it is" is split at the first colon.
function headline(c) {
  const fit = String(c.fit ?? "").trim();
  const name = String(c.name ?? "").trim();
  if (name) return { name, fit: fit === name ? "" : fit };
  const m = /^([^：:，,。.；;]{2,40}?)\s*[：:]\s*(\S[\s\S]*)$/u.exec(fit);
  if (m && m[1].length <= (hasCjk(m[1]) ? 12 : 32))
    return {
      name: m[1],
      fit: m[2].replace(/^[a-z]/, (ch) => ch.toUpperCase()),
    };
  return { name: fit, fit: "" };
}

// JSON prompts often open with model lists and settings; the preview skips
// those keys so its first line is the description. The editor keeps it all.
const BOILERPLATE_KEY =
  /^(applicable_models|models?|version|aspect_ratio|negative\w*)$/i;
function previewText(prompt) {
  const s = String(prompt).trim();
  if (!s.startsWith("{")) return prompt;
  let o;
  try {
    o = JSON.parse(s);
  } catch {
    return prompt;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return prompt;
  const keys = Object.keys(o);
  const kept = keys.filter((k) => !BOILERPLATE_KEY.test(k));
  if (!kept.length || kept.length === keys.length) return prompt;
  return kept
    .map(
      (k) => `${k}: ${typeof o[k] === "string" ? o[k] : JSON.stringify(o[k])}`,
    )
    .join("\n");
}

// Sample model versus the model the user will generate with. Names are never
// compared as text: the page uses the script's model keys (modelKeys vs
// targetModelKey) when it has both, then its modelMatch, then the legacy
// modelMismatch flag.
function modelState(c, page) {
  const model = c.model ? String(c.model) : "";
  const mm = c.modelMismatch;
  const target = String(
    c.targetModel ||
      page.targetModel ||
      (typeof mm === "string" && mm.trim() && mm !== "true" ? mm : "") ||
      "",
  );
  const keys = Array.isArray(c.modelKeys)
    ? c.modelKeys.map(String).filter(Boolean)
    : [];
  const targetKey = String(c.targetModelKey || page.targetModelKey || "");
  let state = null;
  if (keys.length && targetKey)
    state = keys.includes(targetKey) ? "matched" : "mismatched";
  else if (["matched", "mismatched", "unknown"].includes(c.modelMatch))
    state = c.modelMatch;
  else if (
    mm === true ||
    mm === "true" ||
    (typeof mm === "string" && mm.trim())
  )
    state = "mismatched";
  else if (mm === false && model && target) state = "matched";
  else if (!model) state = "unknown";
  else if (target) state = "unknown";
  // A known sample model and no target to compare with: the chip says it all.
  if (model && !target && !targetKey && state !== "mismatched") state = null;
  return { state, model, target };
}

// Template placeholders ({argument name=… default=…}, {style=…}, also with
// nested braces) are marked so nobody mistakes an unadapted library prompt for
// a final one. A brace-depth scan finds each balanced {…} group.
const PLACEHOLDER_HEAD = /^\{(argument\b|[A-Za-z_][\w ]*=)/;
function placeholderSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < text.length; j += 1) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}" && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) break; // unbalanced from here on: leave the rest as text
    if (PLACEHOLDER_HEAD.test(text.slice(i, end + 1))) {
      spans.push([i, end + 1]);
      i = end;
    }
  }
  return spans;
}
function markPlaceholders(text) {
  const s = String(text);
  let out = "";
  let last = 0;
  for (const [a, b] of placeholderSpans(s)) {
    out +=
      esc(s.slice(last, a)) + `<mark class="ph">${esc(s.slice(a, b))}</mark>`;
    last = b;
  }
  return out + esc(s.slice(last));
}

const PLAY_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>`;

function mediaHtml(c, images, videos, t) {
  const ar = aspect(c.sampleRatio, c.kind);
  const dur = clock(c.sampleDurationSec);
  const [hero, ...rest] = images;
  const video = videos[0];
  // Under a video, a single extra image is usually the library poster again:
  // it becomes the poster fallback instead of a one-item strip.
  const posterAlt = video && rest.length === 1 ? rest[0] : "";
  const thumbs =
    rest.length && !posterAlt
      ? `<div class="thumbs">${rest
          .map(
            (u) =>
              `<a href="${esc(u)}" target="_blank" rel="noopener" title="${t.viewLarge}"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></a>`,
          )
          .join("")}</div>`
      : "";
  if (video) {
    return `<figure class="media">
    <div class="frame is-video is-loading" style="--ar:${ar}" data-poster="${esc(hero || "")}"${posterAlt ? ` data-poster-alt="${esc(posterAlt)}"` : ""}>
      <video src="${esc(video)}${hero || video.includes("#") ? "" : "#t=0.5"}"${hero ? ` poster="${esc(hero)}" preload="none"` : ` preload="metadata"`} muted loop playsinline aria-label="${esc(t.sampleOf(c.title))}"></video>
      <button type="button" class="play" aria-label="${t.play(c.num)}">${PLAY_ICON}</button>
      ${dur ? `<span class="dur" aria-label="${t.sampleLength} ${dur}">${dur}</span>` : ""}
      <a class="fallback" href="${esc(video)}" target="_blank" rel="noopener" hidden><span>${t.videoFallback}<u>${t.videoFallbackLink}</u></span></a>
      ${hero ? `<p class="note poster-note">${t.posterBroken}</p>` : ""}
      <p class="note broken-note">${t.videoBroken}<a href="${esc(video)}" target="_blank" rel="noopener">${t.tryTab}</a></p>
    </div>${thumbs}
  </figure>`;
  }
  if (hero) {
    return `<figure class="media">
    <div class="frame is-loading" style="--ar:${ar}">
      <a class="hero" href="${esc(hero)}" target="_blank" rel="noopener" title="${t.viewLarge}"><img src="${esc(hero)}" alt="${esc(t.imageOf(c.title))}" loading="lazy" decoding="async" onload="this.closest('.frame').classList.remove('is-loading')" onerror="this.closest('.frame').classList.add('broken')"></a>
      <p class="note broken-note">${t.imageBroken}<a href="${esc(hero)}" target="_blank" rel="noopener">${t.tryTab}</a></p>
    </div>${thumbs}
  </figure>`;
  }
  const what = c.kind === "image" ? t.sampleWord.image : t.sampleWord.other;
  return `<figure class="media">
    <div class="frame no-media">
      <p class="note">${t.noMedia(what)}</p>
    </div>
  </figure>`;
}

function candidateHtml(c, i, page) {
  const { t, zh } = page;
  const num = i + 1;
  // mediaState from the library wins: "none" means the URLs are known not to load.
  const { images, videos, evidence } = visibleMedia(c);
  const bare = evidence === "none";
  // A card with nothing to look at is not styled as the recommendation,
  // unless no card has anything to look at.
  const recommended = Boolean(c.default) && (!bare || page.allBare);
  const kind = t.kind[c.kind] ? c.kind : videos.length ? "video" : "image";
  const card = { ...c, kind, num };
  const isTemplate = kind === "code-video" && !(c.adapted || c.content);
  // A code template renders with its framework, not with the page's video or
  // image model, so the page-level target model does not apply to it.
  const {
    state: match,
    model,
    target,
  } = kind === "code-video" &&
  !c.modelMatch &&
  !c.targetModel &&
  !c.modelMismatch
    ? { state: null, model: c.model ? String(c.model) : "", target: "" }
    : modelState(c, page);
  const isCode = kind === "code-video";
  // Code video: an engine renders it and a model may have written the code.
  // Old data without either field keeps its model chip, labelled as an engine
  // only when it names one.
  const engine = isCode ? engineName(c.renderEngine) : "";
  const author = isCode && c.authoringModel ? String(c.authoringModel) : "";
  const legacyCode =
    isCode && c.renderEngine == null && c.authoringModel == null;
  const sep = zh ? "：" : ": ";
  const modelChip = isCode
    ? legacyCode
      ? model
        ? `<span class="chip model">${isEngine(model) ? t.engine : t.sampleModel}${sep}<b>${esc(engineName(model))}</b></span>`
        : ""
      : `${engine ? `<span class="chip model">${t.engine}${sep}<b>${esc(engine)}</b></span>` : ""}${author ? `<span class="chip">${esc(t.writtenBy(author))}</span>` : ""}`
    : model
      ? `<span class="chip model">${t.sampleModel}${sep}<b>${esc(model)}</b></span>`
      : "";
  const what = kind === "image" ? "image" : "other";
  const evidenceChip = `<span class="chip ev is-${evidence}">${evidence === "clip" ? t.evidence.clip : t.evidence[evidence][what]}${bare ? `<span class="ev-more">${zh ? "，" : "; "}${isTemplate ? t.noMediaTemplate : t.noMediaInline}</span>` : ""}</span>`;
  const sampleDur = clock(c.sampleDurationSec);
  const sampleRatio = c.sampleRatio ? String(c.sampleRatio) : "";
  // What the sample is: kind, model, shape, length, prompt language.
  const chips = [
    `<span class="chip">${t.kind[kind]}${kind === "code-video" && c.mode === "template" ? t.template : ""}</span>`,
    evidenceChip,
    modelChip,
    sampleRatio
      ? `<span>${t.sampleRatio} <b>${esc(sampleRatio)}</b></span>`
      : "",
    sampleDur ? `<span>${t.sampleLength} <b>${sampleDur}</b></span>` : "",
    t.promptLang[c.lang] && !isTemplate
      ? `<span>${t.promptLang[c.lang]}</span>`
      : "",
  ].filter(Boolean);
  // What will be generated, next to the button that starts it.
  const goalDur = positive(c.targetDurationSec ?? page.targetDurationSec);
  const goalRatio = String(c.targetRatio || page.targetRatio || "");
  const output = [
    target && kind !== "code-video" ? `<b>${esc(target)}</b>` : "",
    goalRatio && !(sampleRatio && sameRatio(goalRatio, sampleRatio))
      ? `${t.outputRatio} <b>${esc(goalRatio)}</b>`
      : "",
    goalDur
      ? `<b>${t.seconds(goalDur)}</b>${sampleDur && positive(c.sampleDurationSec) !== goalDur ? (zh ? `（${t.lengthNote}）` : ` (${t.lengthNote})`) : ""}`
      : "",
  ].filter(Boolean);
  // Only versionMatch "same" may say the sample was made with the target
  // model; a matched family with another or an unstated version says so. A
  // card without a sample talks about the original prompt instead.
  const vm = c.versionMatch;
  const sampleName = esc(withVersion(model || target, c.sampleVersion));
  const targetName = esc(withVersion(target || model, c.targetVersion));
  // An authoring model in `model` is never the engine.
  const codeEngine = esc(engine || (isEngine(model) ? engineName(model) : ""));
  const note = isCode
    ? match === "matched" && codeEngine
      ? t.engineMatched(codeEngine)
      : match === "mismatched" && codeEngine && target
        ? t.engineMismatched(codeEngine, esc(target))
        : match
          ? t.engineUnknown
          : ""
    : match === "matched"
      ? vm === "same"
        ? bare
          ? t.matchedRef(esc(model || target))
          : t.matched(esc(model || target))
        : vm === "different"
          ? t.versionDiff(sampleName, targetName)
          : t.versionUnknown(sampleName, targetName)
      : match === "mismatched"
        ? model && target
          ? bare
            ? t.mismatchedRef(esc(model), esc(target))
            : t.mismatched(esc(model), esc(target))
          : model
            ? t.mismatchedNoTarget(esc(model))
            : t.mismatchedNoModel(esc(target))
        : match === "unknown"
          ? bare
            ? t.unknownRef
            : model && target
              ? t.unknownPair(esc(model), esc(target))
              : t.unknown
          : "";
  const matchClass =
    match === "matched" && !isCode && vm !== "same"
      ? `is-${vm === "different" ? "version-diff" : "version-unknown"}`
      : `is-${match}`;
  const refs = Math.max(0, Math.floor(Number(c.referenceInputs) || 0));
  // The reference-image line comes only from the dictionary; the script's
  // referenceNote is English working text and is never shown as is.
  const refsUnclear = /\b(unclear|not stated|unknown|unspecified)\b/i.test(
    String(c.referenceNote || ""),
  );
  const needsRefs =
    refs > 0 ||
    refsUnclear ||
    (c.referenceInputs == null && c.needReferenceImages);
  const needsText = refsUnclear ? t.needsUnclear : t.needs(refs);
  const adapted = Boolean(c.adapted);
  const prompt = c.adapted || c.content || "";
  const marked = isTemplate ? "" : markPlaceholders(previewText(prompt));
  const hasPlaceholders =
    !isTemplate && placeholderSpans(String(prompt)).length > 0;
  const link = safeLink(c.link);
  const repo = safeLink(c.sourceUrl);
  const head = headline(c);
  const boxId = `prompt-${num}`;
  const hint = isTemplate ? templateHint(c, t, zh) : null;
  const title = String(c.title ?? "");
  const lic = licenseChip(c, t);
  const summary = licenseSummary(c.license, zh);
  const licDetail =
    summary === lic.text || summary === t.license.other ? "" : summary;
  return `
<article class="cand${recommended ? " is-default" : ""}${isTemplate ? " is-template" : ""}${bare ? " is-bare" : ""}" data-id="${esc(c.id)}" data-num="${num}" data-kind="${kind}" data-evidence="${evidence}">
  ${bare ? "" : mediaHtml(card, images, videos, t)}
  <div class="body">
    <header>
      <span class="num">${num}</span>
      <h2 title="${esc(head.name || title)}">${esc(head.name || title)}</h2>
      ${recommended ? `<span class="badge">${t.recommended}</span>` : ""}
    </header>
    ${head.fit ? `<p class="fit">${esc(head.fit)}</p>` : ""}
    ${head.name && title && !isTemplate ? `<p class="ref" title="${esc(title)}">${bare ? t.refCase : t.refSample}${sep}${esc(title)}</p>` : ""}
    ${chips.length ? `<p class="facts">${chips.join("")}</p>` : ""}
    ${
      hint
        ? `<div class="template"><p>${t.templateNote(esc(title))}</p>${hint.shows ? `<p class="template-shows" title="${esc(hint.shows)}">${esc(shortText(hint.shows))}</p>` : ""}${hint.foreign ? `<p class="template-foreign" lang="${zh ? "en" : "zh"}" title="${esc(hint.foreign)}">${esc(shortText(hint.foreign))}</p>` : ""}</div>`
        : ""
    }
    <div class="prompt${adapted ? " is-adapted" : isTemplate ? "" : " is-original"}">
      <div class="prompt-head">
        <label for="${boxId}">${isTemplate ? t.extraLabel : adapted ? t.promptAdapted : t.promptOriginal}</label>
        <span class="tools"><button type="button" class="link reset" hidden>${t.reset}</button>${isTemplate ? "" : `<button type="button" class="link edit" aria-controls="${boxId}">${t.edit}</button><button type="button" class="link copy" data-label="${adapted ? t.copyAdapted : t.copyOriginal}">${adapted ? t.copyAdapted : t.copyOriginal}</button>`}</span>
      </div>
      ${
        isTemplate
          ? ""
          : `<div class="preview" lang="${c.lang === "zh" ? "zh-CN" : c.lang === "en" ? "en" : ""}"><div class="pv">${marked}</div></div>
      <button type="button" class="link more" hidden>${t.more}</button>`
      }
      <textarea id="${boxId}" spellcheck="false" rows="${isTemplate ? 2 : 6}"${isTemplate ? "" : " hidden"}${hint ? ` placeholder="${esc(hint.example)}"` : ""}>${esc(prompt)}</textarea>
      ${hasPlaceholders && !adapted ? `<p class="ph-note">${t.placeholders}</p>` : ""}
    </div>
    ${
      c.content && !isTemplate
        ? `<details class="orig"${adapted ? "" : " hidden"}><summary>${t.original}</summary><pre>${esc(c.content)}</pre><button type="button" class="link copy-orig">${t.copyOriginal}</button></details>`
        : ""
    }
    <div class="decide">
      ${
        output.length || note
          ? `<div class="plan">${output.length ? `<p class="goal">${t.output}${zh ? "：" : ": "}${output.join(" · ")}</p>` : ""}${note ? `<p class="match ${matchClass}">${note}</p>` : ""}</div>`
          : ""
      }
      ${
        needsRefs
          ? `<p class="needs"><span class="need-chip">${needsText}</span></p>`
          : ""
      }
      <div class="actions">
        <button type="button" class="pick">${t.pick}</button>
        <p class="who">${
          c.author
            ? `${t.by} <b>${esc(c.author)}</b>`
            : c.curatedSource
              ? repo
                ? t.curated(
                    `<a href="${esc(repo)}" target="_blank" rel="noopener">${esc(c.source)}</a>`,
                  )
                : t.curated(esc(c.source))
              : t.noAuthor
        }${
          link
            ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">${kind === "code-video" ? t.templatePage : t.post}</a>`
            : c.curatedSource && !c.author
              ? ""
              : repo
                ? ` · <a href="${esc(repo)}" target="_blank" rel="noopener">${t.library}</a>`
                : ` · ${t.noLink}`
        }</p>
      </div>
      <div class="src"><span class="lic is-${lic.status}">${esc(lic.text)}</span><details><summary>${t.sourceLicense}</summary><p>${esc(c.source)} · ${esc(c.license)}</p>${licDetail ? `<p>${esc(licDetail)}</p>` : ""}</details></div>
    </div>
  </div>
</article>`;
}

// A local file reference, resolved once at render time: symlinks are followed
// to the real file, which must itself be a regular media file of the right
// kind. A file that does not exist yet keeps its literal path (it 404s, and
// serving refuses a symlink put there later).
function resolveLocal(url, ext) {
  const literal = fileURLToPath(url);
  let real;
  try {
    real = fs.realpathSync(literal);
  } catch {
    return { url, path: literal };
  }
  try {
    return fs.statSync(real).isFile() && ext.test(real) && mimeOf(real)
      ? { url, path: real }
      : null;
  } catch {
    return null;
  }
}

// Keep the safe media references of every candidate and collect the local
// ones. serveGallery reads that list back from the page and serves exactly
// these files, nothing else.
function prepareMedia(candidates) {
  const local = new Map();
  const keep = (list, ext) =>
    list
      .map((u) => safeMedia(u, ext))
      .filter((u) => {
        if (!u) return false;
        if (!u.startsWith("file:")) return true;
        if (!local.has(u)) local.set(u, resolveLocal(u, ext));
        return Boolean(local.get(u));
      });
  const shown = candidates.map((c) => ({
    ...c,
    images: keep(c.images || [c.image], IMAGE_EXT),
    videos: keep(c.videos || [], VIDEO_EXT),
  }));
  return { shown, local: [...local.values()].filter(Boolean) };
}

export function renderGallery({
  title,
  request,
  candidates: input,
  runId,
  locale,
  targetRatio,
  targetDurationSec,
  targetModel,
  targetModelKey,
}) {
  const key = `prompt-studio:${runId || title || "gallery"}:`;
  const { shown: candidates, local } = prepareMedia(input);
  const anyVideo = candidates.some(
    (c) =>
      c.videos.length && c.mediaState !== "none" && c.mediaState !== "image",
  );
  // Page language: explicit locale, else the request's language, else Chinese.
  const lang =
    locale === "en" || locale === "zh"
      ? locale
      : request && !hasCjk(request)
        ? "en"
        : "zh";
  const zh = lang === "zh";
  const t = TEXT[lang];
  const allBare =
    candidates.length > 0 &&
    candidates.every((c) => visibleMedia(c).evidence === "none");
  const page = {
    t,
    zh,
    targetRatio,
    targetDurationSec,
    targetModel,
    targetModelKey,
    allBare,
  };
  // Nothing on the page can show a sample: say so once, up front.
  const noneVisible =
    candidates.length > 0 &&
    candidates.every(
      (c) =>
        c.mediaState === "none" ||
        (!c.images.length && !(c.videos || []).length),
    );
  return `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || t.pageTitle)}</title>
<style>
:root{
  --bg:oklch(98.4% .004 95);--surface:oklch(100% 0 0);--sunk:oklch(95.6% .006 95);--frame:oklch(92.5% .007 95);--shine:oklch(97% .005 95);
  --ink:oklch(24% .012 95);--ink-2:oklch(45% .012 95);--line:oklch(89% .008 95);
  --accent:oklch(50% .12 150);--accent-hover:oklch(45% .12 150);--accent-ink:oklch(99% .01 150);--accent-soft:oklch(94% .04 150);
  --warn:oklch(48% .12 60);--warn-soft:oklch(95% .04 75);
  --scrim:oklch(18% .01 95/.62);--scrim-ink:oklch(99% 0 0);
  --shadow:0 1px 2px oklch(20% .02 95/.06),0 8px 24px -12px oklch(20% .02 95/.14);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:oklch(19% .008 95);--surface:oklch(23% .008 95);--sunk:oklch(16.5% .008 95);--frame:oklch(13.5% .008 95);--shine:oklch(19% .008 95);
  --ink:oklch(93% .006 95);--ink-2:oklch(72% .01 95);--line:oklch(33% .01 95);
  --accent:oklch(74% .13 150);--accent-hover:oklch(80% .13 150);--accent-ink:oklch(20% .03 150);--accent-soft:oklch(30% .05 150);
  --warn:oklch(80% .12 75);--warn-soft:oklch(30% .05 70);
  --scrim:oklch(10% .01 95/.7);
  --shadow:0 1px 2px oklch(0% 0 0/.3),0 10px 28px -14px oklch(0% 0 0/.6);
  color-scheme:dark;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
::selection{background:var(--accent-soft);color:var(--ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
a{color:inherit;text-underline-offset:3px}
main{max-width:1120px;margin:0 auto;padding:40px 16px 96px}
.page-head{margin-bottom:24px}
.page-head h1{font-size:1.625rem;line-height:1.25;margin:0 0 6px;letter-spacing:-.02em;text-wrap:balance}
.page-head p{margin:0;color:var(--ink-2);max-width:70ch}
.list{display:grid;gap:20px}
.cand{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);align-items:start;background:var(--surface);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;transition:opacity .2s ease}
.cand.is-default{outline:2px solid var(--accent);outline-offset:-2px}
.media{margin:0;display:flex;flex-direction:column;gap:8px;padding:12px;min-width:0}
.frame{position:relative;width:100%;aspect-ratio:var(--ar,4/3);max-height:460px;border-radius:8px;overflow:hidden;background:var(--frame)}
.frame.is-loading::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,var(--shine) 50%,transparent 70%);background-size:220% 100%;animation:shimmer 1.6s ease-in-out infinite}
@keyframes shimmer{from{background-position:120% 0}to{background-position:-120% 0}}
.hero{display:block;width:100%;height:100%;cursor:zoom-in}
.frame img,.frame video{display:block;width:100%;height:100%;object-fit:contain;transition:opacity .25s ease}
.frame:not(.is-video).is-loading img{opacity:0}
.frame:not(.is-video):not(.is-loading){background:transparent}
.thumbs{display:flex;gap:8px}
.thumbs a{width:56px;height:56px;flex:none}
.thumbs img{width:100%;height:100%;object-fit:cover;border-radius:6px}
.note{display:none;margin:0;position:absolute;inset:auto 12px 12px;color:var(--ink-2);font-size:13px;text-align:center}
.note a{color:var(--accent)}
.frame.broken{aspect-ratio:auto;min-height:160px;display:grid;place-items:center;background:transparent;border:1px dashed var(--line)}
.frame.broken::before,.frame.broken > a.hero,.frame.broken video,.frame.broken .play,.frame.broken .dur{display:none}
.frame.broken .broken-note{display:block;position:static;padding:16px}
.no-media{aspect-ratio:auto;min-height:160px;display:grid;place-items:center;background:transparent;border:1px dashed var(--line)}
.no-media .note{display:block;position:static;padding:16px;max-width:30ch}
.no-media .note b{display:block;color:var(--ink);font-size:14px;margin-bottom:2px}
.is-video{background:oklch(16% .01 95)}
.is-video.poster-broken:not(.video-ok):not(.playing) .poster-note{display:block;color:oklch(85% .01 95)}
.play{position:absolute;left:10px;bottom:10px;width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:999px;background:var(--scrim);color:var(--scrim-ink);box-shadow:0 0 0 1px oklch(100% 0 0/.35);transition:opacity .2s ease,transform .2s cubic-bezier(.16,1,.3,1)}
.play svg{width:16px;height:16px;margin-left:2px}
.frame.is-video:hover .play{transform:scale(1.06)}
.frame.playing .play:not(:focus-visible),.frame.engaged .play{opacity:0;pointer-events:none}
.dur{position:absolute;right:10px;bottom:10px;padding:1px 8px;border-radius:999px;background:var(--scrim);color:var(--scrim-ink);font-size:12px;font-weight:500;pointer-events:none;transition:opacity .2s ease}
.frame.engaged .dur{opacity:0}
.frame.is-video:not(.engaged){cursor:pointer}
.fallback{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;height:100%;color:oklch(92% .01 95);font-size:13px;text-align:center}
.fallback[hidden]{display:none}
.fallback img{max-height:calc(100% - 32px);height:auto;flex:1;min-height:0}
.video-broken video,.video-broken .play,.video-broken .dur{display:none}
.fallback span{padding:0 12px 10px}
.body{padding:20px 24px 20px 12px;display:flex;flex-direction:column;gap:10px;min-width:0}
.body header{display:flex;align-items:center;gap:12px}
.num{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:999px;background:var(--sunk);font-weight:700}
.is-default .num{background:var(--accent);color:var(--accent-ink)}
.body h2{flex:1;font-size:1.0625rem;line-height:1.35;margin:0;text-wrap:balance;overflow-wrap:break-word;hyphens:auto;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.badge{flex:none;color:var(--accent);font-size:13px;font-weight:600}
.fit{margin:-4px 0 0;font-size:14px;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word}
.ref{margin:-4px 0 0;font-size:13px;color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word}
.facts{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:0;font-size:13px;color:var(--ink-2)}
.facts b{color:var(--ink);font-weight:500}
.facts .chip{padding:2px 10px;border-radius:999px;background:var(--sunk)}
.facts .model{background:var(--accent-soft)}
.facts .ev{color:var(--ink);font-weight:500}
.facts .ev.is-none{background:var(--warn-soft);color:var(--warn)}
.ev-more{font-weight:400}
.cand.is-bare{grid-template-columns:1fr}
.cand.is-bare .body{padding:20px 24px}
.cand.is-bare .prompt,.cand.is-bare .orig,.cand.is-bare .template{max-width:88ch}

.template{font-size:13px;color:var(--ink-2);max-width:70ch}
.template p{margin:0}
.template b{color:var(--ink);font-weight:600}
.template-foreign,.template-shows{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word}
.template-foreign{margin-top:2px!important;font-size:12px}
.prompt-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:13px;color:var(--ink-2);margin-bottom:6px}
.tools{display:flex;gap:14px}
.tools .link{white-space:nowrap}
textarea{display:block;width:100%;resize:vertical;min-height:96px;background:var(--sunk);color:var(--ink);border:1px solid transparent;border-radius:8px;padding:12px 14px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,"PingFang SC",monospace;transition:border-color .15s ease,background-color .15s ease;caret-color:var(--accent)}
textarea::placeholder{color:var(--ink-2);opacity:1}
textarea:hover{border-color:var(--line)}
textarea:focus{outline:none;border-color:var(--accent);background:var(--surface)}
textarea:read-only{cursor:default}
.more{margin-top:6px}
.preview{background:var(--sunk);border-radius:8px;padding:10px 14px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,"PingFang SC",monospace;cursor:text}
.pv{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.preview.open .pv{display:block}
textarea[hidden]{display:none}
.preview[hidden]{display:none}
.is-original .preview,.is-original textarea{background:var(--sunk);border:1px dashed var(--line)}
mark.ph{background:var(--warn-soft);color:var(--warn);border-radius:4px;padding:0 3px;font-weight:600}
.ph-note{margin:6px 0 0;font-size:12px;color:var(--warn)}
.orig summary{cursor:pointer;font-size:13px;color:var(--ink-2)}
.orig[hidden]{display:none}
.copy-orig{margin-top:6px}
.orig pre{margin:8px 0 0;background:var(--sunk);border-radius:8px;padding:12px 14px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.decide{padding-top:4px;display:flex;flex-direction:column;gap:8px}
.plan{font-size:13px;color:var(--ink-2);max-width:70ch}
.plan p{margin:0}
.plan b{color:var(--ink);font-weight:600}
.goal{color:var(--ink)}
.match.is-mismatched,.match.is-version-diff{color:var(--warn)}
.needs{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:0;font-size:13px;color:var(--ink-2)}
.need-chip{padding:2px 10px;border-radius:999px;background:var(--warn-soft);color:var(--warn);font-weight:600}
.actions{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap}
.who{flex:1;min-width:10rem;margin:0;font-size:13px;color:var(--ink-2);overflow-wrap:anywhere}
.who b{color:var(--ink);font-weight:500}
.who a{color:var(--accent)}
.src{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 14px;font-size:12px;color:var(--ink-2)}
.lic{color:var(--ink);font-weight:500;padding:1px 8px;border-radius:999px;background:var(--sunk)}
.lic.is-open{background:var(--accent-soft)}
.lic.is-copyleft,.lic.is-unstated{background:var(--warn-soft);color:var(--warn)}
.src summary{cursor:pointer;width:fit-content}
.src p{margin:4px 0 0;overflow-wrap:anywhere}
.is-template textarea{min-height:64px}
.is-template .no-media,.is-template .frame.broken{min-height:120px}
button{font:inherit;cursor:pointer}
.pick{background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:10px 24px;font-weight:600;transition:background-color .15s ease,transform .1s ease}
.pick:hover{background:var(--accent-hover)}
.pick:active{transform:translateY(1px)}
.pick:disabled{cursor:default;opacity:.55}
.link{background:none;border:0;padding:0;color:var(--accent);font-size:13px;text-decoration:underline;text-underline-offset:3px}
.link[hidden]{display:none}
.done .cand:not(.chosen) .media{opacity:.4;filter:saturate(.4)}
.done .cand:not(.chosen){box-shadow:none}
.chosen{outline:2px solid var(--accent);outline-offset:-2px}
.chosen .pick:disabled{opacity:1}
.page-head .status,.page-head .alert{display:none;margin-top:14px;padding:12px 16px;border-radius:12px;font-weight:500;max-width:70ch}
.page-head .status{background:var(--accent-soft);color:var(--ink)}
.page-head .alert{background:var(--warn-soft);color:var(--ink);font-weight:400}
.page-head .status.show,.page-head .alert.show{display:block}
.bar{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:16px;max-width:calc(100vw - 32px);background:var(--ink);color:var(--bg);padding:10px 12px 10px 18px;border-radius:12px;box-shadow:var(--shadow);transition:opacity .2s ease,transform .25s cubic-bezier(.16,1,.3,1)}
.bar.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.bar button{background:transparent;color:var(--bg);border:1px solid currentColor;border-radius:8px;padding:4px 14px}
.bar button:hover{background:oklch(100% 0 0/.12)}
.bar button[hidden]{display:none}
kbd{font:12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2px 6px;border-radius:4px;background:var(--sunk);border:1px solid var(--line)}
.empty{background:var(--surface);border-radius:14px;padding:32px;color:var(--ink-2);box-shadow:var(--shadow)}
@media (max-width:760px){
  main{padding-top:28px}
  .cand{grid-template-columns:1fr}
  .frame{max-height:min(62vh,420px)}
  .no-media,.frame.broken{min-height:112px}
  .body,.cand.is-bare .body{padding:16px}
  .pick{width:100%}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>
<main>
  <div class="page-head">
    <h1>${esc(title || t.pageTitle)}</h1>
    <p>${t.head(esc(request || ""), anyVideo, Math.min(candidates.length, 9) || 1)}</p>
    <p class="alert${noneVisible ? " show" : ""}" role="status">${t.offline}</p>
    <p class="status" role="status"></p>
  </div>
  <div class="list">
    ${
      candidates.length
        ? candidates.map((c, i) => candidateHtml(c, i, page)).join("")
        : `<p class="empty">${t.empty}</p>`
    }
  </div>
</main>
<div class="bar" role="status" aria-live="polite"><span class="bar-text"></span><button type="button" class="undo">${t.undo}</button></div>
<script type="application/json" id="ps-local-media">${scriptJson(local)}</script>
<script>
(() => {
  const KEY = ${scriptJson(key)};
  const T = ${scriptJson(SCRIPT_TEXT[lang])};
  const fmt = (s, v) => s.replace(/\\{(\\w)\\}/g, (_, k) => v[k] ?? "");
  const UNDO_SECONDS = 3;
  // Prompt preview height: about 4 lines on a phone, 8 on a desktop.
  const store = {
    get: (k) => { try { return localStorage.getItem(KEY + k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(KEY + k) : localStorage.setItem(KEY + k, v); } catch {} },
  };
  const served = location.protocol.startsWith("http");
  const cards = [...document.querySelectorAll(".cand")];
  const bar = document.querySelector(".bar");
  const barText = bar.querySelector(".bar-text");
  const undo = bar.querySelector(".undo");
  const status = document.querySelector(".status");
  const alert = document.querySelector(".alert");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let pending = null;
  let closed = false;

  // Media states: loading skeleton, broken sample, and the page-wide notice
  // when every sample fails (usually offline).
  const frames = [...document.querySelectorAll(".frame:not(.no-media)")];
  const blanks = document.querySelectorAll(".frame.no-media").length;
  const failed = (f) => f.classList.contains("broken") || (f.classList.contains("poster-broken") && !f.classList.contains("video-ok"));
  // Metadata ratios can be wrong; once the real size is known, fit the frame to it.
  const shape = (f, w, h) => { if (w > 0 && h > 0) f.style.setProperty("--ar", w + "/" + h); };
  // A clip that failed: the chip says what the card still shows, and a card
  // left with nothing loses the recommended look unless every card has nothing.
  const downgrade = (f) => {
    const card = f.closest(".cand");
    if (!card) return;
    const still = !f.classList.contains("broken") && !f.classList.contains("poster-broken");
    card.dataset.evidence = still ? "still" : "none";
    const chip = card.querySelector(".chip.ev");
    if (chip) { chip.className = "chip ev is-" + (still ? "still" : "none"); chip.textContent = still ? T.evidenceStill : T.evidenceNone; }
    const cards = [...document.querySelectorAll(".cand")];
    if (!still && !cards.every((c) => c.dataset.evidence === "none")) {
      card.classList.remove("is-default");
      card.querySelector(".badge")?.remove();
    }
  };
  // One page note when no card can show a sample (failed loads or no media).
  const recount = () => alert.classList.toggle("show", frames.length + blanks > 0 && frames.every(failed));
  const videos = [];
  // A clip that scrolls away or a hidden tab stops playing.
  const offscreen = "IntersectionObserver" in window
    ? new IntersectionObserver((list) => list.forEach((e) => { if (!e.isIntersecting) e.target.querySelector("video")?.pause(); }))
    : null;
  document.addEventListener("visibilitychange", () => { if (document.hidden) videos.forEach((v) => v.pause()); });
  for (const f of frames) {
    const img = f.querySelector(".hero img");
    if (img) {
      if (img.complete && img.naturalWidth) { f.classList.remove("is-loading"); shape(f, img.naturalWidth, img.naturalHeight); }
      if (img.complete && !img.naturalWidth && img.currentSrc) f.classList.add("broken");
      img.addEventListener("load", () => { f.classList.remove("is-loading"); shape(f, img.naturalWidth, img.naturalHeight); });
      img.addEventListener("error", () => { f.classList.add("broken"); f.classList.remove("is-loading"); recount(); });
      continue;
    }
    const video = f.querySelector("video");
    const play = f.querySelector(".play");
    const fallback = f.querySelector(".fallback");
    let posterUrl = video.getAttribute("poster");
    let posterAlt = f.dataset.posterAlt || "";
    videos.push(video);
    // "No poster" is not a failure; only a poster that fails to load is, and
    // a clip that later plays clears it.
    if (posterUrl) {
      const probe = new Image();
      probe.onload = () => { f.classList.remove("is-loading"); shape(f, probe.naturalWidth, probe.naturalHeight); };
      probe.onerror = () => {
        if (posterAlt) {
          // Second chance: the library's own poster.
          posterUrl = posterAlt;
          posterAlt = "";
          video.setAttribute("poster", posterUrl);
          probe.src = posterUrl;
          return;
        }
        f.classList.add("poster-broken"); f.classList.remove("is-loading");
        if (f.classList.contains("video-broken")) downgrade(f);
        recount();
      };
      probe.src = posterUrl;
    } else {
      // No poster: the video loads its metadata and shows the frame half a second in.
      f.classList.add("no-poster");
    }
    const works = () => { f.classList.add("video-ok"); f.classList.remove("is-loading", "broken"); recount(); };
    const fail = () => {
      if (f.classList.contains("video-broken")) return;
      f.classList.add("video-broken");
      f.classList.remove("playing", "engaged", "is-loading", "video-ok");
      video.removeAttribute("controls");
      if (posterUrl && !f.classList.contains("poster-broken")) {
        const still = new Image();
        still.alt = fmt(T.posterAlt, { l: video.getAttribute("aria-label") });
        still.addEventListener("error", () => { f.classList.add("broken"); downgrade(f); recount(); });
        still.src = posterUrl;
        fallback.prepend(still);
        fallback.hidden = false;
      } else f.classList.add("broken");
      downgrade(f);
      recount();
    };
    const start = () => { const p = video.play(); if (p) p.catch(() => { if (video.error) fail(); }); };
    const preview = () => { if (!calm && !f.classList.contains("engaged")) start(); };
    // Explicit play (click, tap, Enter/Space on the button) hands over the
    // native controls: seek, sound, fullscreen.
    const engage = () => { f.classList.add("engaged"); video.controls = true; start(); video.focus({ preventScroll: true }); };
    video.addEventListener("error", fail);
    video.addEventListener("loadedmetadata", () => { shape(f, video.videoWidth, video.videoHeight); if (!posterUrl) f.classList.remove("is-loading"); });
    video.addEventListener("loadeddata", works);
    // One clip at a time: starting one pauses every other.
    video.addEventListener("play", () => videos.forEach((v) => { if (v !== video && !v.paused) v.pause(); }));
    video.addEventListener("playing", () => { f.classList.add("playing"); works(); });
    video.addEventListener("pause", () => f.classList.remove("playing"));
    f.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") preview(); });
    f.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") video.pause(); });
    play.addEventListener("focus", () => { if (play.matches(":focus-visible")) preview(); });
    play.addEventListener("blur", () => { if (!f.classList.contains("engaged")) video.pause(); });
    f.addEventListener("click", (e) => { if (!f.classList.contains("engaged") && !e.target.closest("a")) engage(); });
    if (offscreen) offscreen.observe(f);
  }
  recount();

  const showBar = (text, canUndo) => { barText.textContent = text; undo.hidden = !canUndo; bar.classList.add("show"); };
  const hideBar = () => bar.classList.remove("show");
  const mark = (card) => {
    document.body.classList.add("done");
    cards.forEach((c) => c.classList.toggle("chosen", c === card));
    card.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });
  };
  const close = (card, text) => {
    closed = true;
    mark(card);
    status.textContent = text;
    status.classList.add("show");
    cards.forEach((c) => { c.querySelector(".pick").disabled = true; c.querySelector("textarea").readOnly = true; });
    card.querySelector(".pick").textContent = T.picked;
    showBar(text, false);
  };

  async function send(card) {
    const box = card.querySelector("textarea");
    const num = card.dataset.num;
    const edited = box.value !== box.defaultValue;
    const reply = edited ? fmt(T.replyEdited, { n: num }) + box.value : fmt(T.reply, { n: num });
    if (served) {
      try {
        const res = await fetch("/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: card.dataset.id, number: Number(num), edited, prompt: box.value }) });
        if (!res.ok) throw new Error(String(res.status));
        // Hosts without background notifications (Codex, Grok) never see the pick,
        // so keep a reply on the clipboard as a fallback.
        try { await navigator.clipboard.writeText(reply); } catch {}
        return close(card, fmt(T.done, { n: num, e: edited ? T.doneEdited : "", r: edited ? fmt(T.copiedEdited, { n: num }) : reply }));
      } catch {
        // The agent stopped listening (timeout or already picked): fall back to copying.
      }
    }
    let copied = false;
    try { await navigator.clipboard.writeText(reply); copied = true; } catch {}
    mark(card);
    status.textContent = copied
      ? fmt(T.copied, { r: edited ? fmt(T.copiedEdited, { n: num }) : reply })
      : fmt(T.replyHint, { n: num, e: edited ? T.replyHintEdited : T.replyHintPlain });
    status.classList.add("show");
    showBar(status.textContent, false);
  }

  function pick(card) {
    if (closed) return;
    if (pending) { clearInterval(pending.timer); }
    mark(card);
    let left = UNDO_SECONDS;
    const tick = () => showBar(fmt(T.pickedIn, { n: card.dataset.num, s: left }) + fmt(served ? T.toAi : T.toCopy, { s: left }), true);
    tick();
    pending = { card, timer: setInterval(() => {
      left -= 1;
      if (left > 0) return tick();
      clearInterval(pending.timer); pending = null;
      showBar(served ? T.sending : T.copying, false);
      send(card);
    }, 1000) };
  }

  undo.addEventListener("click", () => {
    if (!pending) return;
    clearInterval(pending.timer); pending = null;
    document.body.classList.remove("done");
    cards.forEach((c) => c.classList.remove("chosen"));
    hideBar();
  });

  // Clipboard API first; then a temporary visible-but-transparent textarea for
  // execCommand. On failure the caller selects the text for a manual copy.
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const tmp = document.createElement("textarea");
    tmp.value = text;
    tmp.setAttribute("readonly", "");
    tmp.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(tmp);
    const active = document.activeElement;
    let ok = false;
    try { tmp.select(); ok = document.execCommand("copy"); } catch { ok = false; }
    tmp.remove();
    if (active && active.focus) active.focus({ preventScroll: true });
    return ok;
  }
  const selectNode = (node) => {
    if (node.select) { node.focus(); node.select(); return; }
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const flash = (button, ok, label) => {
    button.textContent = ok ? T.copyOk : T.copyFail;
    setTimeout(() => { button.textContent = label(); }, ok ? 1600 : 4000);
  };

  for (const card of cards) {
    const box = card.querySelector("textarea");
    const reset = card.querySelector(".reset");
    const copy = card.querySelector(".copy");
    const orig = card.querySelector(".orig");
    const copyOrig = card.querySelector(".copy-orig");
    const origLabel = copyOrig ? copyOrig.textContent : "";
    const more = card.querySelector(".more");
    const edit = card.querySelector(".edit");
    const preview = card.querySelector(".preview");
    const isEdited = () => box.value !== box.defaultValue;
    // The copy button names what it copies: the edited text once there is one.
    const label = () => (copy ? (isEdited() ? T.copyEdited : copy.dataset.label) : "");
    const sync = () => {
      if (copy) copy.textContent = label();
      if (orig && card.querySelector(".is-original")) orig.hidden = !isEdited();
    };
    let open = false;
    // Templates have only the textarea; prompts show a 3-line preview (with
    // placeholders marked) and switch to the editable box with one click.
    const grow = () => { box.style.height = "0px"; box.style.height = Math.min(box.scrollHeight + 2, 480) + "px"; };
    const editing = () => !preview || preview.hidden;
    const startEdit = (focus) => {
      if (!preview) return;
      preview.hidden = true; more.hidden = true; box.hidden = false;
      if (edit) edit.hidden = true;
      grow();
      if (focus) box.focus();
    };
    const pv = preview && preview.firstElementChild;
    const folds = () => { if (preview && !preview.hidden) more.hidden = !open && pv.scrollHeight <= pv.clientHeight + 2; };
    const saved = store.get(card.dataset.id);
    if (saved != null && saved !== box.defaultValue) { box.value = saved; reset.hidden = false; startEdit(false); sync(); }
    if (preview) {
      folds();
      addEventListener("resize", folds);
      preview.addEventListener("click", () => { if (!closed) startEdit(true); });
      more.addEventListener("click", () => {
        open = !open;
        preview.classList.toggle("open", open);
        more.textContent = open ? T.less : T.more;
        more.hidden = false;
      });
    } else grow();
    if (edit) edit.addEventListener("click", () => startEdit(true));
    box.addEventListener("input", () => {
      const edited = box.value !== box.defaultValue;
      reset.hidden = !edited;
      store.set(card.dataset.id, edited ? box.value : null);
      sync();
      if (editing()) grow();
    });
    reset.addEventListener("click", () => { box.value = box.defaultValue; reset.hidden = true; store.set(card.dataset.id, null); sync(); grow(); box.focus(); });
    if (copy) copy.addEventListener("click", async () => {
      const ok = await copyText(box.value);
      if (!ok) { startEdit(false); selectNode(box); }
      flash(copy, ok, label);
    });
    if (copyOrig) copyOrig.addEventListener("click", async () => {
      const pre = orig.querySelector("pre");
      const ok = await copyText(pre.textContent);
      if (!ok) selectNode(pre);
      flash(copyOrig, ok, () => origLabel);
    });
    card.querySelector(".pick").addEventListener("click", () => pick(card));
  }

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("textarea, input, video")) return;
    if (e.key === "Escape" && pending) return undo.click();
    const card = cards[Number(e.key) - 1];
    if (card) pick(card);
  });
})();
</script>
</body>
</html>
`;
}

// Fill each picked candidate from the library entry, so the page shows the full
// prompt even when the caller only passed ids and fit lines. Pick fields win.
export function buildCandidates(picks, entries) {
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const missing = [];
  const candidates = [];
  for (const p of picks) {
    const e = byId.get(String(p.id));
    if (!e && !p.content) {
      missing.push(p.id);
      continue;
    }
    // Some library prompts start with zero-width characters; drop them.
    const clean = (t) =>
      String(t ?? "")
        .replace(/[​-‍﻿]/g, "")
        .trim();
    const field = (k) => p[k] ?? e?.[k] ?? null;
    const content = clean(p.content ?? e?.content);
    const shown = p.adapted ? clean(p.adapted) : content;
    const videos = p.videos || e?.videos || [];
    candidates.push({
      ...p,
      kind: field("kind") || (videos.length ? "video" : "image"),
      sourceId: field("sourceId"),
      title: p.title || e?.title || `#${p.id}`,
      images: p.images || e?.sourceMedia || (p.image ? [p.image] : []),
      videos,
      category: p.category || e?.category,
      content,
      ...(p.adapted ? { adapted: shown } : {}),
      model: field("model"),
      modelMismatch: field("modelMismatch"),
      modelMatch: field("modelMatch"),
      modelKeys: field("modelKeys"),
      targetModel: p.targetModel ?? null,
      targetModelKey: p.targetModelKey ?? null,
      versionNote: field("versionNote"),
      versionMatch: field("versionMatch"),
      sampleVersion: field("sampleVersion"),
      targetVersion: field("targetVersion"),
      renderEngine: field("renderEngine"),
      authoringModel: field("authoringModel"),
      evidence: field("evidence"),
      licenseStatus: field("licenseStatus"),
      curatedSource: Boolean(field("curatedSource")),
      sourceUrl: field("sourceUrl"),
      author: field("author"),
      link: field("link"),
      lang: field("lang"),
      mode: field("mode"),
      // Sample facts come from the library; a pick's bare ratio/durationSec is
      // what the agent asked for (the target), per older SKILL.md usage.
      sampleRatio:
        p.sampleRatio ??
        e?.sampleRatio ??
        e?.ratio ??
        (e ? null : p.ratio) ??
        null,
      sampleDurationSec:
        p.sampleDurationSec ??
        e?.sampleDurationSec ??
        e?.durationSec ??
        (e ? null : p.durationSec) ??
        null,
      durationSec: field("durationSec"),
      ratio: field("ratio"),
      targetRatio:
        p.targetRatio ??
        (e && p.ratio && p.ratio !== (e.sampleRatio ?? e.ratio)
          ? p.ratio
          : null),
      referenceInputs: field("referenceInputs"),
      referenceNote: field("referenceNote"),
      mediaState: field("mediaState"),
      description: field("description"),
      tags: p.tags || e?.tags || [],
      targetDurationSec: p.targetDurationSec ?? null,
      needReferenceImages:
        p.needReferenceImages ?? Boolean(e?.needReferenceImages),
      hasPlaceholders:
        p.hasPlaceholders ??
        (/\{argument\b/i.test(shown) || /\{[a-z_]+=/i.test(shown)),
      source: p.source || e?.source || "unknown source",
      license: p.license || e?.license || "license unknown",
    });
  }
  if (!candidates.some((c) => c.default) && candidates[0])
    candidates[0].default = true;
  return { candidates, missing };
}

export function writeGallery({ file, ...data }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderGallery(data));
  return file;
}

// The local sample files a written page references (see localMedia).
function readLocalMedia(html) {
  const m =
    /<script type="application\/json" id="ps-local-media">([\s\S]*?)<\/script>/.exec(
      html,
    );
  if (!m) return [];
  try {
    const list = JSON.parse(m[1]);
    return Array.isArray(list)
      ? list.filter(
          (x) =>
            x &&
            typeof x.url === "string" &&
            typeof x.path === "string" &&
            path.isAbsolute(x.path) &&
            mimeOf(x.path),
        )
      : [];
  } catch {
    return [];
  }
}

const mediaRoute = (i, item) =>
  `/media/${i}/${encodeURIComponent(path.basename(item.path))}`;

// Send one allow-listed local file, honouring a single byte Range (video
// players seek with it). The file is opened first and never through a symlink;
// a missing file is 404, any other failure 500, and a dropped client or a read
// error never takes the server down.
const NOT_FOUND = new Set(["ENOENT", "ENOTDIR", "ELOOP", "EISDIR", "EMLINK"]);

function sendFile(req, res, file) {
  const fail = (err) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(err && !NOT_FOUND.has(err.code) ? 500 : 404);
    res.end();
  };
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  fs.open(file, flags, (openErr, fd) => {
    if (openErr) return fail(openErr);
    const done = () => fs.close(fd, () => {});
    fs.fstat(fd, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        done();
        return fail(statErr);
      }
      const size = stat.size;
      const head = {
        "content-type": mimeOf(file),
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(
        String(req.headers.range || "").trim(),
      );
      let start = 0;
      let end = size - 1;
      let status = 200;
      if (range && (range[1] || range[2])) {
        if (range[1] === "") {
          start = Math.max(0, size - Number(range[2]));
        } else {
          start = Number(range[1]);
          if (range[2] !== "") end = Math.min(Number(range[2]), size - 1);
        }
        if (start > end || start >= size) {
          done();
          res.writeHead(416, { ...head, "content-range": `bytes */${size}` });
          return res.end();
        }
        status = 206;
        head["content-range"] = `bytes ${start}-${end}/${size}`;
      }
      res.writeHead(status, { ...head, "content-length": end - start + 1 });
      if (req.method === "HEAD" || size === 0) {
        done();
        return res.end();
      }
      const stream = fs.createReadStream(file, { fd, start, end });
      stream.on("error", fail);
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    });
  });
}

// Serve the page on 127.0.0.1 and resolve with the user's pick (or a timeout).
// `onReady` gets the URL as soon as the port is open, so the caller can open it.
// Local samples the page references are served under /media/<n>/; any other
// path is 404.
export function serveGallery({
  file,
  ids,
  pickFile,
  timeoutMs = 30 * 60 * 1000,
  port = 0,
  onReady = () => {},
}) {
  const allowed = new Set(ids.map(String));
  return new Promise((resolve) => {
    let timer;
    const server = http.createServer((req, res) => {
      const read = req.method === "GET" || req.method === "HEAD";
      if (read && (req.url === "/" || req.url === "/index.html")) {
        let html = fs.readFileSync(file, "utf8");
        readLocalMedia(html).forEach((item, i) => {
          const route = mediaRoute(i, item);
          html = html
            .split(`"${esc(item.url)}"`)
            .join(`"${route}"`)
            .split(`"${esc(item.url)}#`)
            .join(`"${route}#`);
        });
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        return res.end(req.method === "HEAD" ? undefined : html);
      }
      const media = /^\/media\/(\d+)\/[^/?#]+$/.exec(req.url || "");
      // The Host check keeps other sites (DNS rebinding) from reading samples.
      if (
        read &&
        media &&
        /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "")
      ) {
        const item = readLocalMedia(fs.readFileSync(file, "utf8"))[
          Number(media[1])
        ];
        if (item) return sendFile(req, res, item.path);
      }
      if (req.method === "POST" && req.url === "/pick") {
        let body = "";
        req.on("data", (d) => {
          body += d;
          if (body.length > 200_000) req.destroy();
        });
        req.on("end", () => {
          let pick;
          try {
            pick = JSON.parse(body);
          } catch {
            pick = null;
          }
          if (!pick || !allowed.has(String(pick.id))) {
            res.writeHead(400);
            return res.end("unknown candidate");
          }
          const result = {
            status: "picked",
            id: pick.id,
            number: pick.number,
            edited: Boolean(pick.edited),
            prompt: String(pick.prompt || ""),
            at: new Date().toISOString(),
          };
          fs.writeFileSync(pickFile, `${JSON.stringify(result, null, 2)}\n`);
          res.writeHead(200, { "content-type": "application/json" });
          // A playing sample keeps its connection open; drop it once the
          // pick reply is out so the process can exit.
          res.on("finish", () => server.closeAllConnections?.());
          res.end('{"ok":true}');
          clearTimeout(timer);
          server.close();
          resolve({ ...result, pickFile });
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, "127.0.0.1", () => {
      onReady(`http://127.0.0.1:${server.address().port}/`);
      timer = setTimeout(() => {
        server.close();
        server.closeAllConnections?.();
        resolve({ status: "timeout", pickFile: null });
      }, timeoutMs);
    });
  });
}
