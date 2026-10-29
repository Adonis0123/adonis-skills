import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { LARGE_SLUGS } from "./adapters/youmind-manifest.mjs";
import {
  cacheDir,
  fetchCached,
  SEED_FILE,
  CHECK_INTERVAL_MS,
} from "./studio.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Bump when normalized fields change so parsed caches are rebuilt safely.
const NORMALIZATION_VERSION = 11;
export const REGISTRY_FILE = path.join(HERE, "..", "assets", "sources.json");
export const MODEL_KEYS = {
  seedance: ["seedance"],
  veo: ["veo"],
  kling: ["kling"],
  hailuo: ["hailuo", "minimax", "mini max", "h3"],
  wan: ["wan"],
  "grok-imagine": ["grok"],
  sora: ["sora"],
  runway: ["runway"],
  "gpt-image": [
    "codex image_gen",
    "codex image gen",
    "gpt-image",
    "gpt image",
    "gpt-4o",
    "gpt4o",
  ],
  "nano-banana": ["nano banana", "nano-banana"],
  midjourney: ["midjourney"],
  claude: ["claude", "opus", "fable", "sonnet"],
  gemini: ["gemini"],
  flux: ["flux"],
  seedream: ["seedream"],
  hyperframes: ["hyperframes"],
  remotion: ["remotion"],
  manim: ["manim"],
  "motion-canvas": ["motion-canvas", "motion canvas"],
  p5: ["p5"],
  "three.js": ["three.js", "threejs"],
};
export function modelKeysOf(model) {
  const name = String(model || "")
    .toLowerCase()
    .replace(
      /\bgemini(?:[- ]+(?:\d+(?:\.\d+)*|flash|pro))*[- ]+(?:image\b|生图)/gi,
      "nano-banana",
    );
  const found = [];
  for (const [key, aliases] of Object.entries(MODEL_KEYS)) {
    let position = Infinity;
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(
        `(^|[^a-z0-9])(${escaped})(?=$|[^a-z])`,
        "i",
      ).exec(name);
      if (match) position = Math.min(position, match.index + match[1].length);
    }
    if (position !== Infinity) found.push({ key, position });
  }
  return found.sort((a, b) => a.position - b.position).map(({ key }) => key);
}
export function modelKeyOf(model) {
  return modelKeysOf(model)[0] || null;
}

export function codeVideoFields(entry, source = {}) {
  if (entry?.kind !== "code-video") return {};
  const engines =
    /\b(hyperframes|remotion|manim|p5(?:\.js)?|three\.js|threejs|motion[- ]canvas)\b/i;
  const engine =
    String(entry.renderEngine || "").match(engines)?.[1] ||
    [
      entry.model,
      source.renderEngine,
      entry.content,
      entry.description,
      entry.title,
      source.repo,
      entry.source,
    ]
      .filter(Boolean)
      .join(" ")
      .match(engines)?.[1];
  const renderEngine = engine
    ? engine
        .toLowerCase()
        .replace("p5.js", "p5")
        .replace("threejs", "three.js")
        .replace("motion canvas", "motion-canvas")
    : null;
  const shortModel =
    /\b(?:(?:Claude\s+)?(?:Opus|Sonnet|Fable|Haiku)\s*\d+(?:\.\d+)*|Claude\s*\d+(?:\.\d+)*|GPT[- ](?:\d[\w.-]*|Image[- ]?\d+(?:\.\d+)*)|(?:Gemini|Grok)\s*\d+(?:\.\d+)*)(?:\s+(?:Pro|Flash|Lite|Fast|Turbo))?\b/i;
  const authoringModel =
    [entry.authoringModel, entry.model, source.authoringModel]
      .map((value) => String(value || "").match(shortModel)?.[0])
      .find(Boolean) || null;
  return { renderEngine, authoringModel };
}

export function evidenceOf(entry) {
  return entry?.videos?.length
    ? "clip"
    : entry?.images?.length || entry?.image || entry?.sourceMedia?.length
      ? "still"
      : "none";
}
export function licenseStatusOf(license, source = {}) {
  const value = String(license || "");
  if (/\(code\)|for the list only|original authors|retain rights/i.test(value))
    return "unstated";
  if (source.templateCatalog || /(?:code )?template license/i.test(value))
    return "template";
  if (/\bcc[ -]*by\b/i.test(value)) return "attribution";
  if (/\b(?:a?gpl|lgpl|mpl)(?=v?\d|\b)/i.test(value)) return "copyleft";
  if (
    /\b(?:MIT|Apache|BSD|ISC|CC[ -]*0|Unlicense)\b|public domain/i.test(value)
  )
    return "open";
  return "unstated";
}

function read(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value));
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
const list = (v) =>
  (Array.isArray(v) ? v.flat(Infinity) : v == null ? [] : [v]).filter(
    (v) => v != null,
  );
const text = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
// Numbered slots are identities, so repeated Image 1 mentions count only once.
export function referenceRequirements(entry) {
  // Remove negated input phrases before looking for positive reference context.
  let content = String(entry.content || "")
    .replace(
      /\b(?:does not|doesn't|do not|don't)\s+(?:need|require)\s+(?:(?:an?|any|the)\s+)?(?:(?:reference|supplied|provided|uploaded|attached|given|source)\s+)?(?:images?|photos?|pictures?)\b/gi,
      "",
    )
    .replace(
      /\b(?:(?:reference|supplied|provided|uploaded|attached|given|source)\s+)?(?:images?|photos?|pictures?)\s+(?:is|are)\s+optional\b/gi,
      "",
    )
    .replace(
      /\boptional(?:ly)?\s+(?:upload\s+)?(?:(?:an?|the|your)\s+)?(?:(?:reference|supplied|provided|uploaded|attached|given|source)\s+)?(?:images?|photos?|pictures?)\b/gi,
      "",
    )
    .replace(
      /\b(?:(?:character|person|product|style|background)\s+)?reference\s+(?:sheet|board|card|chart|turnaround)\b/gi,
      "",
    )
    .replace(
      /\b(?:no|without|do not use|not requiring)\s+(?:(?:an?|any|the)\s+)?(?:character|person|product|style|background)\s+references?(?:\s+(?:images?|photos?))?|(?:不需要|无需|不用|没有|无)(?:任何)?(?:参考人物图|人物参考图|产品参考图)/gi,
      "",
    )
    .replace(
      /\b(?:no|without|not requiring|do not use)\s+(?:(?:an?|any|the)\s+)?(?:reference(?:[ -]+(?:images?|photos?|videos?))?|uploaded\s+(?:photos?|images?))\b|(?:不需要|无需|不用|没有|无)(?:任何)?(?:参考图|上传的?图)/gi,
      "",
    );
  const inputContent = content
    .replace(
      /\b(?:supplied|provided|uploaded|attached|given)\s+(?:images?|photos?|pictures?)\s+(?:on|to|in)\s+(?:(?:a|the)\s+)?(?:desk|table|wall|corkboard)\b/gi,
      "",
    )
    .replace(
      /\b(?:no|without|do not use|not requiring)\s+(?:(?:the|any|an?|one|two|three|four|five|both|\d+)\s+)*(?:supplied|provided|uploaded|attached|given)\s+(?:images?|photos?|pictures?)\b/gi,
      "",
    );
  content = inputContent;
  const numbers = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    both: 2,
    a: 1,
    an: 1,
  };
  let statedCount = 0;
  for (const match of inputContent.matchAll(
    /\b(one|two|three|four|five|both|\d+|an?)\s+(?:(?:supplied|provided|uploaded|attached|given|reference)\s+)+(?:images?|photos?|pictures?)\b/gi,
  ))
    statedCount = Math.max(
      statedCount,
      numbers[match[1].toLowerCase()] || Number(match[1]),
    );
  for (const match of inputContent.matchAll(
    /([一二两三四五\d]+)\s*张\s*参考图/g,
  ))
    statedCount = Math.max(
      statedCount,
      { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 }[match[1]] ||
        Number(match[1]) ||
        0,
    );
  for (const match of inputContent.matchAll(
    /\b(?:a\s+)?pair\s+of\s+(?:(?:supplied|provided|uploaded|attached|given|reference)\s+)+(?:images?|photos?|pictures?)\b/gi,
  ))
    statedCount = Math.max(statedCount, 2);
  for (const match of inputContent.matchAll(
    /\b(?:the|use|combine|merge|using)\s+(one|two|three|four|five|\d+)\s+(?:images?|photos?|pictures?)\b/gi,
  ))
    statedCount = Math.max(
      statedCount,
      numbers[match[1].toLowerCase()] || Number(match[1]),
    );
  for (const match of inputContent.matchAll(
    /\b(first|second|third|fourth|fifth)\s+(?:supplied|provided|uploaded|attached|given|reference)\s+(?:image|photo|picture)\b/gi,
  ))
    statedCount = Math.max(
      statedCount,
      { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 }[
        match[1].toLowerCase()
      ],
    );
  if (
    /\b(?:the\s+)?(?:image|photo)\s+above\b|\bsource\s+photo\b/i.test(
      inputContent,
    )
  )
    statedCount = Math.max(statedCount, 1);
  const supplied =
    /\b(?:supplied|provided|uploaded|attached|given)\s+(?:images?|photos?|pictures?)\b/i.test(
      inputContent,
    );
  if (
    /\b(?:supplied|provided|uploaded|attached|given)\s+(?:image|photo|picture)\b/i.test(
      inputContent,
    )
  )
    statedCount = Math.max(statedCount, 1);
  const slots = new Set();
  let referenceBlock = false;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/\[([^\]]+)\]/);
    if (heading)
      referenceBlock = /^(?:character lock|references?)$/i.test(heading[1]);
    const pattern =
      /(@图[ _]*\d+|@(?:image|video)[ _]*\d+(?:\s*\/\s*\d+)*|<(?:image|video)[ _]*\d+>|\b(?:image|video)[ _]*\d+(?:\s*\/\s*\d+)*)/gi;
    for (const match of line.matchAll(pattern)) {
      const token = match[0];
      const before = line.slice(0, match.index);
      const after = line.slice(match.index + token.length);
      const explicitToken = /^[@<]/.test(token);
      if (
        /\b(?:no|without|do not|not)\s+(?:(?:use|using|from|of|in|match|keep)\s+)?$/i.test(
          before,
        )
      )
        continue;
      const label =
        /(?:^|[\s.;…。；])$/.test(before) && /^\s*:(?!\d)/.test(after);
      const contextual =
        /\b(?:use|using|from|of|in|match(?:es)?|keep)\s+(?:the\s+)?$/i.test(
          before,
        );
      if (!explicitToken && !label && !referenceBlock && !contextual) continue;
      if (
        !explicitToken &&
        (/\b(?:gpt[- ]?|skywork\s+|seedance\s+)$/i.test(before) ||
          /^\s*(?:s\b|sec(?:onds?)?\b|:\d)/i.test(after))
      )
        continue;
      const [, type, numbers] = token
        .replace(/^@图/, "@Image")
        .match(/(image|video)[ _]*(\d+(?:\s*\/\s*\d+)*)/i);
      for (const number of numbers.split(/\s*\/\s*/))
        slots.add(`${type.toLowerCase()}:${Number(number)}`);
    }
  }
  const roles = new Set();
  const roleKey = (role) =>
    /character|person|portrait|人物/i.test(role)
      ? "character"
      : /product|产品/i.test(role)
        ? "product"
        : role.toLowerCase();
  for (const match of content.matchAll(
    /\b(character|person|product|style|background)\s+references?\b|\breference\s+(?:photo|image)\s+of\s+(?:the\s+)?(product|character|person)\b|\buploaded\s+(portrait)\b|(参考人物图|人物参考图|产品参考图)/gi,
  )) {
    const before = content.slice(0, match.index);
    const after = content.slice(match.index + match[0].length);
    const input =
      /\b(?:use|using|provided|uploaded|attached|from|based on|match|keep|preserve)\s+(?:(?:the|a|an|your|provided|uploaded|attached)\s+)*(?:(?:character|person|product|style|background)\s+references?\s+and\s+)?$/i.test(
        before,
      );
    const heading =
      /(?:^|\n)\s*$/i.test(before) &&
      /^\s*:\s*(?:(?:the|a|an|your|uploaded|provided)\s+)*(?:image\b|photo\b|picture\b|图)/i.test(
        after,
      );
    if (/^\s+(?:sheet|board|card|chart|turnaround)\b/i.test(after)) continue;
    if (input || heading || match[3] || match[4])
      roles.add(roleKey(match.slice(1).find(Boolean)));
  }
  const unclear =
    /\b(?:provided|uploaded|required|use|using)\s+(?:the\s+)?references?\b/i.test(
      content,
    );
  const generic =
    /\breference[ -]+(?:images?|photos?|videos?)\b|\buploaded\s+(?:photo|image|selfie|portrait)s?\b|^\s*(?:please\s+)?upload\s+(?:(?:an?|the|your)\s+)?(?:reference\s+)?(?:photo|image|selfie|portrait)s?\b|参考图|上传的?图/im.test(
      content.replace(
        /\breference[ -]+(?:images?|photos?|videos?)\s+of\s+(?!the\s+uploaded|uploaded)[^.;\n]+/gi,
        "",
      ),
    );
  const explicit =
    Number.isSafeInteger(entry.referenceInputs) && entry.referenceInputs >= 0
      ? entry.referenceInputs
      : 0;
  const count = Math.max(
    slots.size,
    statedCount,
    roles.size,
    explicit,
    generic || unclear || supplied ? 1 : 0,
  );
  const type = [...slots].some((slot) => slot.startsWith("video:"))
    ? "image/video"
    : "image";
  return {
    referenceInputs: count,
    referenceHint:
      count === 0 && Boolean(entry.referenceHint ?? entry.needReferenceImages),
    referenceNote:
      entry.referenceNote?.includes("count unclear") && count === 1
        ? entry.referenceNote
        : (unclear || supplied || generic) &&
            !statedCount &&
            !slots.size &&
            !roles.size &&
            !explicit
          ? "needs reference images (count unclear)"
          : count
            ? `${count} ${/\[character lock\]/i.test(content) ? "character " : ""}reference ${type}${count === 1 ? "" : "s"}`
            : null,
    needReferenceImages: count > 0,
  };
}

export function normalizeEntry(src, partial) {
  if (!partial || typeof partial !== "object") return null;
  const kind = partial.kind || src.kinds?.[0] || "image";
  const content = text(partial.content);
  const tags = list(partial.tags).map(text).filter(Boolean);
  const category = partial.category == null ? null : text(partial.category);
  if (
    (!content.trim() && kind !== "code-video") ||
    /nsfw/i.test([category, ...tags].join(" "))
  )
    return null;
  let title = text(partial.title).trim();
  if (
    /^(?:<|act as\b|[\[{#`]|you are\b|ignore previous\b|system:|assistant:)/i.test(
      title,
    )
  ) {
    const description = text(partial.description).trim();
    const sentence =
      description.match(/^.*?[.!?。！？](?:\s|$)/)?.[0] || description;
    title = (
      sentence ||
      title
        .replace(/<[^>]*>/g, "")
        .replace(/^act as\s+/i, "")
        .replace(/[\[\]{}#`]/g, "")
    )
      .trim()
      .slice(0, 60);
  }
  const nativeId =
    partial.nativeId ??
    partial.id ??
    createHash("sha256")
      .update(`${title}\n${content}`)
      .digest("hex")
      .slice(0, 16);
  const rawModel = partial.model ? text(partial.model) : src.modelDefault || "";
  const cleanedModel = rawModel
    .replace(
      /[（(][^）)]*(?:标注|attribut|creator|claimed|reported)[^）)]*[）)]/gi,
      "",
    )
    .replace(/[,，]\s*(?:as\s+)?(?:attributed|claimed|reported)\b.*$/i, "")
    .trim();
  if (cleanedModel !== rawModel) tags.push("provenance:creator-claimed");
  const model =
    !cleanedModel ||
    /^(?:unknown|n\/?a|none|未标注|原帖未标注)$/i.test(cleanedModel)
      ? null
      : cleanedModel;
  const rawRatio = text(partial.ratio).trim();
  const ratioParts = rawRatio.match(
    /^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/,
  );
  const ratio =
    ratioParts && Number(ratioParts[1]) > 0 && Number(ratioParts[2]) > 0
      ? `${ratioParts[1]}:${ratioParts[2]}`
      : null;
  const rawDuration = text(partial.durationSec).trim();
  const durationSec =
    /^\d+(?:\.\d+)?\s*(?:s|sec(?:onds?)?|秒)?$/i.test(rawDuration) &&
    parseFloat(rawDuration) > 0
      ? parseFloat(rawDuration)
      : null;
  const urls = (value) =>
    list(value).filter((value) => {
      if (typeof value !== "string" || !/^https:\/\//i.test(value))
        return false;
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    });
  const modes = {
    generate: "text-to-image",
    edit: "image-edit",
    t2va: "text-to-video",
    ref2va: "image-to-video",
    fl2va: "image-to-video",
    "text-to-image": "text-to-image",
    "image-edit": "image-edit",
    "text-to-video": "text-to-video",
    "image-to-video": "image-to-video",
    template: "template",
  };
  const language = text(partial.lang).toLowerCase();
  const lang =
    language === "en" ? "en" : /^zh(?:-|$)/.test(language) ? "zh" : null;
  const modeKey = text(partial.mode).toLowerCase();
  const mode = Object.hasOwn(modes, modeKey) ? modes[modeKey] : null;
  const sourceMedia = urls(partial.sourceMedia);
  const videos = urls(partial.videos);
  const code = codeVideoFields({ ...partial, kind, model }, src);
  const keyModel = kind === "code-video" ? code.renderEngine : model;
  return {
    ...partial,
    id: src.id === "youmind" ? nativeId : `${src.id}:${nativeId}`,
    kind,
    sourceId: src.id,
    source: src.repo,
    sourceUrl: `https://github.com/${src.repo}`,
    curatedSource: Boolean(src.curatedSource),
    license: src.license || "Unknown",
    title,
    description: text(partial.description),
    content,
    lang,
    sourceMedia,
    videos,
    mediaState: videos.length ? "video" : sourceMedia.length ? "image" : "none",
    model,
    ...code,
    evidence: evidenceOf({ videos, sourceMedia }),
    licenseStatus: licenseStatusOf(src.license, src),
    templateCatalog: Boolean(src.templateCatalog),
    modelKey: modelKeyOf(keyModel),
    modelKeys: modelKeysOf(keyModel),
    tags: [...new Set(tags)],
    category,
    author: partial.author || null,
    link: partial.link || null,
    ...referenceRequirements(partial),
    mode,
    durationSec,
    ratio,
    sampleDurationSec: durationSec,
    sampleRatio: ratio,
  };
}
export function loadRegistry({
  cache = cacheDir(),
  registryFile = REGISTRY_FILE,
  sources,
  notes = [],
} = {}) {
  const known = sources || read(registryFile, { sources: [] }).sources || [];
  const user = sources
    ? []
    : read(path.join(cache, "user-sources.json"), { sources: [] }).sources ||
      [];
  const merged = new Map();
  for (const src of [...known, ...user]) {
    if (
      !src ||
      !/^[a-z0-9][a-z0-9-]*$/.test(src.id || "") ||
      !/^[a-z0-9-]+$/.test(src.adapter || "")
    )
      continue;
    let kinds = src.kinds;
    if (!Array.isArray(kinds) || !kinds.length) {
      kinds = ["image"];
      notes.push(`${src.id}: missing kinds; defaulting to image`);
    }
    if (!merged.has(src.id)) merged.set(src.id, { ...src, kinds });
  }
  return [...merged.values()];
}
function selected(opts) {
  const ids =
    typeof opts.sourceIds === "string"
      ? opts.sourceIds.split(",")
      : opts.sourceIds || [];
  return loadRegistry(opts).filter(
    (src) =>
      (!opts.kind || src.kinds?.includes(opts.kind)) &&
      (!ids.length || ids.includes(src.id)),
  );
}
async function adapterOf(src, opts = {}) {
  if (opts.adapterImpl) return opts.adapterImpl;
  // yaml-tree and markdown are implemented independently; absence is supported.
  const file = path.join(HERE, "adapters", `${src.adapter}.mjs`);
  if (!fs.existsSync(file)) return null;
  return import(`./adapters/${src.adapter}.mjs`);
}
function refreshScope(src, opts) {
  const categories =
    src.adapter === "youmind-manifest"
      ? youmindScope(src, opts)
          .wanted.filter(
            (cat) => opts.allowLarge || !LARGE_SLUGS.includes(cat.slug),
          )
          .map((cat) => cat.slug)
          .sort()
      : [];
  return {
    source: createHash("sha256").update(JSON.stringify(src)).digest("hex"),
    categories,
    all: Boolean(opts.all),
  };
}
function refreshAttempt(src, opts) {
  const file = path.join(
    opts.cache || cacheDir(opts.env),
    src.id,
    "refresh-state.json",
  );
  const attemptId = `${process.pid}:${Date.now()}:${Math.random()}`;
  let attempt;
  return {
    start() {
      if (attempt) return;
      attempt = {
        attemptId,
        lastAttemptAt: opts.now ?? Date.now(),
        outcome: "running",
        scope: refreshScope(src, opts),
      };
      write(file, attempt);
    },
    finish(results) {
      if (!attempt || read(file)?.attemptId !== attemptId) return;
      const statuses = results.map((result) => result.status || "");
      const outcome =
        opts.signal?.aborted ||
        statuses.some((status) => /aborted/.test(status))
          ? "aborted"
          : statuses.some((status) => /offline/.test(status))
            ? "offline"
            : statuses.some((status) =>
                  /error|unavailable|rate-limited/.test(status),
                )
              ? "error"
              : "success";
      write(file, { ...attempt, outcome });
    },
  };
}
function recentFailure(src, opts) {
  if (opts.force) return null;
  const state = read(
    path.join(opts.cache || cacheDir(opts.env), src.id, "refresh-state.json"),
  );
  if (!state || !["offline", "error"].includes(state.outcome)) return null;
  const elapsed = (opts.now ?? Date.now()) - state.lastAttemptAt;
  if (elapsed < 0 || elapsed >= CHECK_INTERVAL_MS) return null;
  const scope = refreshScope(src, opts);
  if (state.scope?.source !== scope.source) return null;
  if (
    !state.scope.all &&
    (scope.all ||
      scope.categories.some(
        (category) => !state.scope.categories?.includes(category),
      ))
  )
    return null;
  return state;
}
function context(src, opts, onAttempt = () => {}) {
  const cache = opts.cache || cacheDir();
  const dir = path.join(cache, src.id);
  return {
    ...opts,
    cache,
    dir,
    fetchCached: (url, file, extra = {}) => {
      if (opts.cachedOnly && !fs.existsSync(file))
        return Promise.resolve({ url, file, status: "not-cached" });
      onAttempt();
      return fetchCached(url, file, { ...opts, ...extra, cache: dir });
    },
  };
}
export async function syncSources(opts = {}) {
  const registryNotes = [];
  const outputs = await Promise.all(
    selected({ ...opts, notes: registryNotes }).map(async (src) => {
      const attempt = refreshAttempt(src, opts);
      try {
        const adapter = await adapterOf(src, opts);
        if (!adapter)
          return {
            results: [{ sourceId: src.id, status: "adapter-missing" }],
            notes: [`${src.id}: adapter-missing`],
          };
        const out = await adapter.sync(
          src,
          context(src, opts, () => attempt.start()),
        );
        const results = (out.results || []).map((r) => ({
          ...r,
          sourceId: src.id,
        }));
        attempt.finish(results);
        return {
          results,
          notes: [
            ...(out.notes || []),
            ...results
              .filter((r) =>
                /unavailable|stale|error|skipped|unknown/.test(r.status),
              )
              .map(
                (r) => `${src.id}${r.slug ? `/${r.slug}` : ""}: ${r.status}`,
              ),
          ],
        };
      } catch (error) {
        try {
          attempt.start();
          attempt.finish([{ status: "source-error" }]);
        } catch {
          // A cache write failure must not replace the source's original error.
        }
        return {
          results: [
            {
              sourceId: src.id,
              status: "source-error",
              error: String(error.message || error),
            },
          ],
          notes: [`${src.id}: ${error.message || error}`],
        };
      }
    }),
  );
  return {
    results: outputs.flatMap((o) => o.results),
    notes: [...new Set([...registryNotes, ...outputs.flatMap((o) => o.notes)])],
  };
}
function migrateLegacyIndex(dir, src) {
  const metaFile = path.join(dir, "entries-meta.json");
  const signature = read(metaFile)?.signature;
  if (
    typeof signature !== "string" ||
    fs.existsSync(path.join(dir, "ref.json"))
  )
    return;
  const match = /^([1-4]):(\{.*\})/.exec(signature);
  if (!match) return;
  try {
    const owner = JSON.parse(match[2]);
    if (
      owner.id !== src.id ||
      owner.repo !== src.repo ||
      owner.adapter !== src.adapter
    )
      return;
  } catch {
    return;
  }
  for (const file of [path.join(dir, "entries.json"), metaFile]) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function rawStamp(dir) {
  const parts = [];
  function visit(folder) {
    if (!fs.existsSync(folder)) return;
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (
        folder === dir &&
        ([
          ".normalized.json",
          ".normalized-meta.json",
          "entries-meta.json",
          "state.json",
          "refresh-state.json",
        ].includes(item.name) ||
          /^(?:\.normalized(?:-meta)?|refresh-state|state)\.json\..*\.tmp$/.test(
            item.name,
          ))
      )
        continue;
      const file = path.join(folder, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) {
        const stat = fs.statSync(file);
        parts.push(`${path.relative(dir, file)}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  }
  visit(dir);
  return parts.sort().join("|");
}
export async function loadAllEntries(opts = {}) {
  const entries = [],
    notes = [];
  const sources = selected({ ...opts, notes });
  const seed =
    read(opts.seedFile === undefined ? SEED_FILE : opts.seedFile, {
      entries: [],
    }).entries || [];
  let cached = false;
  for (const src of sources) {
    let loaded = [];
    try {
      const adapter = await adapterOf(src, opts);
      if (!adapter) {
        notes.push(`${src.id}: adapter-missing`);
        continue;
      }
      const ctx = { ...context(src, opts), notes };
      migrateLegacyIndex(ctx.dir, src);
      const file = path.join(ctx.dir, ".normalized.json");
      const metaFile = path.join(ctx.dir, ".normalized-meta.json");
      const signature =
        `${NORMALIZATION_VERSION}:` + JSON.stringify(src) + rawStamp(ctx.dir);
      const parsed =
        read(metaFile)?.signature === signature ? read(file) : null;
      if (Array.isArray(parsed)) {
        loaded = parsed;
        notes.push(...(read(metaFile)?.notes || []));
      } else {
        loaded = (await adapter.load(src, ctx))
          .map((entry) => normalizeEntry(src, entry))
          .filter(Boolean);
        if (loaded.length || fs.existsSync(ctx.dir)) {
          write(file, loaded);
          write(metaFile, {
            signature,
            notes: notes.filter((note) => note.startsWith(`source ${src.id}:`)),
          });
        }
      }
      if (loaded.length) cached = true;
      else
        loaded = seed
          .filter((entry) => (entry.sourceId || "youmind") === src.id)
          .map((entry) =>
            normalizeEntry(src, {
              ...entry,
              nativeId:
                entry.nativeId ??
                (src.id === "youmind"
                  ? entry.id
                  : String(entry.id).replace(`${src.id}:`, "")),
            }),
          )
          .filter(Boolean);
    } catch (error) {
      notes.push(`${src.id}: ${error.message || error}`);
    }
    if (src.adapter === "youmind-manifest" && opts.categories?.length)
      loaded = loaded.filter((e) => opts.categories.includes(e.category));
    if (opts.kind) loaded = loaded.filter((e) => e.kind === opts.kind);
    entries.push(...loaded);
  }
  return { entries, origin: cached ? "cache" : "seed", notes };
}

export function getSourceStats(opts = {}) {
  const cache = opts.cache || cacheDir();
  const notes = [];
  const seed =
    read(opts.seedFile === undefined ? SEED_FILE : opts.seedFile, {
      entries: [],
    }).entries || [];
  const sources = selected({ ...opts, notes }).map((src) => {
    const dir = path.join(cache, src.id);
    const entries = read(path.join(dir, ".normalized.json"), null);
    const state = read(path.join(dir, "state.json"), { sources: {} });
    const fetchedAt =
      Object.values(state.sources || {})
        .map((entry) => entry.fetchedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    return {
      id: src.id,
      title: src.title || src.id,
      kinds: src.kinds,
      entries: Array.isArray(entries) ? entries.length : null,
      ...(Array.isArray(entries) ? {} : { note: "not indexed yet" }),
      seeded: seed.filter((entry) => (entry.sourceId || "youmind") === src.id)
        .length,
      cached: Array.isArray(entries) && entries.length > 0,
      fetchedAt,
      license: src.license || "Unknown",
      seed: src.seed || "never",
      userAdded: Boolean(src.userAdded),
    };
  });
  return { sources, notes };
}

function backgroundPaths(cache) {
  return {
    lockFile: path.join(cache, ".background-sync.json"),
    queueDir: path.join(cache, ".background-queue"),
  };
}
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function writeLock(fd, owner) {
  // A fixed-size write avoids recreating the path if a fast child already removed it.
  const buffer = Buffer.alloc(4096, " ");
  buffer.write(JSON.stringify(owner));
  fs.writeSync(fd, buffer, 0, buffer.length, 0);
}
function releaseLock(lockFile, token) {
  if (read(lockFile)?.token === token) {
    try {
      fs.unlinkSync(lockFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function acquireLock(lockFile, token, opts = {}) {
  const alive = opts.isProcessAlive || processAlive;
  const liveOwner = (owner) => {
    if (!owner || !alive(owner.pid)) return false;
    try {
      return Date.now() - fs.statSync(lockFile).mtimeMs < 3 * 60000;
    } catch {
      return false;
    }
  };
  const create = () => {
    const fd = fs.openSync(lockFile, "wx", 0o600);
    writeLock(fd, { token, pid: process.pid, startedAt: Date.now() });
    return fd;
  };
  try {
    return create();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const owner = read(lockFile);
  if (liveOwner(owner)) return null;
  if (!owner) {
    try {
      if (Date.now() - fs.statSync(lockFile).mtimeMs < 60000) return null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        return create();
      } catch (error) {
        if (error.code === "EEXIST") return null;
        throw error;
      }
    }
  }
  // Serialize stale-owner recovery so two callers cannot remove each other's new lock.
  const recovery = `${lockFile}.recover`;
  try {
    fs.mkdirSync(recovery);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Recovery is synchronous; an empty directory older than a minute is orphaned.
    try {
      if (Date.now() - fs.statSync(recovery).mtimeMs < 60000) return null;
      fs.rmdirSync(recovery);
    } catch (error) {
      if (error.code !== "ENOENT") return null;
    }
    try {
      fs.mkdirSync(recovery);
    } catch (error) {
      if (error.code === "EEXIST") return null;
      throw error;
    }
  }
  try {
    const latest = read(lockFile);
    if (liveOwner(latest)) return null;
    try {
      fs.unlinkSync(lockFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      return create();
    } catch (error) {
      if (error.code === "EEXIST") return null;
      throw error;
    }
  } finally {
    fs.rmdirSync(recovery);
  }
}
function queueFiles(queueDir) {
  try {
    return fs
      .readdirSync(queueDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(queueDir, name));
  } catch {
    return [];
  }
}
export function queueBackgroundSync(sourceIds, opts = {}) {
  if (!sourceIds.length) return { status: "empty", notes: [] };
  const cache = opts.cache || cacheDir(opts.env);
  const { lockFile, queueDir } = backgroundPaths(cache);
  const token = createHash("sha256")
    .update(`${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
  fs.mkdirSync(queueDir, { recursive: true });
  const request = {
    sourceIds,
    categories: opts.categories || [],
    all: Boolean(opts.all),
    allowLarge: Boolean(opts.allowLarge),
    cachedOnly: Boolean(opts.cachedOnly),
    force: Boolean(opts.force),
  };
  const requestFile = path.join(queueDir, `${token}.json`);
  write(`${requestFile}.tmp`, request);
  fs.renameSync(`${requestFile}.tmp`, requestFile);
  let fd;
  try {
    fd = acquireLock(lockFile, token, opts);
    if (fd === null) return { status: "queued", lockFile, notes: [] };
    const args = [
      path.join(HERE, "studio.mjs"),
      "sync",
      "--source",
      sourceIds.join(","),
      "--background-lock",
      lockFile,
      "--background-token",
      token,
    ];
    if (request.categories.length)
      args.push("--category", request.categories.join(","));
    if (request.allowLarge) args.push("--allow-large");
    if (request.all) args.push("--all");
    if (request.cachedOnly) args.push("--cached-only");
    if (request.force) args.push("--force");
    const child = (opts.spawnImpl || spawn)(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...opts.env, PROMPT_STUDIO_CACHE: cache },
    });
    if (!Number.isInteger(child.pid))
      throw new Error("background process did not start");
    writeLock(fd, { token, pid: child.pid, startedAt: Date.now() });
    child.once?.("error", () => releaseLock(lockFile, token));
    child.unref();
    return { status: "started", lockFile, pid: child.pid, notes: [] };
  } catch (error) {
    releaseLock(lockFile, token);
    return {
      status: "failed",
      notes: [`background refresh unavailable: ${error.message || error}`],
    };
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}
function youmindScope(src, opts) {
  const dir = path.join(opts.cache || cacheDir(opts.env), src.id);
  const manifest = read(path.join(dir, "manifest.json"), {});
  const known = Array.isArray(manifest.categories)
    ? manifest.categories.filter(
        (cat) =>
          cat &&
          typeof cat.slug === "string" &&
          typeof cat.file === "string" &&
          !path.isAbsolute(cat.file) &&
          !cat.file.split(/[\\/]/).includes(".."),
      )
    : [];
  const wanted = opts.all
    ? known
    : opts.categories?.length
      ? opts.categories.map(
          (slug) => known.find((cat) => cat.slug === slug) || { slug },
        )
      : known.filter((cat) => fs.existsSync(path.join(dir, cat.file)));
  return { dir, wanted };
}
function freshSource(src, opts) {
  if (opts.force) return false;
  const dir = path.join(opts.cache || cacheDir(opts.env), src.id);
  const state = read(path.join(dir, "state.json"), { sources: {} });
  const base = `https://raw.githubusercontent.com/${src.repo}/${src.branch || "main"}`;
  let urls = Object.keys(state.sources || {});
  if (src.adapter === "youmind-manifest") {
    const { wanted } = youmindScope(src, opts);
    const categories = wanted.filter(
      (cat) => opts.allowLarge || !LARGE_SLUGS.includes(cat.slug),
    );
    if (
      categories.some(
        (cat) => !cat.file || !fs.existsSync(path.join(dir, cat.file)),
      )
    )
      return false;
    const rawBase = src.rawBase || `${base}/references`;
    urls = [
      `${rawBase}/manifest.json`,
      ...categories.map((cat) => `${rawBase}/${cat.file}`),
    ];
  } else if (src.adapter === "json-map") {
    const config = { ...src, ...src.options };
    const files = [config.file, config.mediaBase?.fromFile].filter(Boolean);
    if (
      !files.length ||
      files.some((file) => !fs.existsSync(path.join(dir, "raw", file)))
    )
      return false;
    urls = files.map((file) => `${base}/${file}`);
  }
  const now = opts.now ?? Date.now();
  return (
    urls.length > 0 &&
    urls.every((url) => {
      const entry = state.sources?.[url];
      return (
        entry?.checkedAt != null && now - entry.checkedAt < CHECK_INTERVAL_MS
      );
    })
  );
}
export async function syncForQuery(opts = {}) {
  const notes = [],
    results = [],
    pending = [];
  const sources = selected({ ...opts, notes });
  const cached = await loadAllEntries({ ...opts, seedFile: null });
  notes.push(...cached.notes);
  const usable = new Set(
    cached.entries
      .filter(
        (entry) =>
          entry.kind === "code-video" ||
          entry.sourceMedia?.length ||
          entry.videos?.length,
      )
      .map((entry) => entry.sourceId),
  );
  const cold = [];
  for (const src of sources) {
    if (
      src.adapter === "youmind-manifest" &&
      !opts.all &&
      !opts.categories?.length
    )
      notes.push(`${src.id}: pass --use to search its categories`);
    if (src.adapter === "youmind-manifest" && !opts.allowLarge) {
      for (const cat of youmindScope(src, opts).wanted)
        if (LARGE_SLUGS.includes(cat.slug))
          notes.push(`${src.id}/${cat.slug}: skipped-large`);
    }
    const failure = recentFailure(src, opts);
    if (failure) {
      results.push({
        sourceId: src.id,
        status: `${failure.outcome}-backoff`,
        retryAt: new Date(
          failure.lastAttemptAt + CHECK_INTERVAL_MS,
        ).toISOString(),
      });
      notes.push(
        `${src.id}: ${failure.outcome === "offline" ? "offline; " : ""}could not refresh; retrying after the 10-minute backoff`,
      );
      continue;
    }
    const missingCategory =
      src.adapter === "youmind-manifest" &&
      youmindScope(src, opts).wanted.some(
        (cat) =>
          (opts.allowLarge || !LARGE_SLUGS.includes(cat.slug)) &&
          (!cat.file ||
            !fs.existsSync(
              path.join(opts.cache || cacheDir(opts.env), src.id, cat.file),
            )),
      );
    if (usable.has(src.id) && !missingCategory) {
      const adapter = await adapterOf(src, opts);
      const probePending = adapter?.needsMediaProbe?.(src, context(src, opts));
      if (freshSource(src, opts) && !probePending)
        results.push({ sourceId: src.id, status: "fresh" });
      else pending.push(src.id);
    } else cold.push(src);
  }
  const rawBudget =
    opts.waitSec ??
    opts.budgetSec ??
    (opts.env || process.env).PROMPT_STUDIO_SYNC_BUDGET_SEC ??
    6;
  const budget = Number(rawBudget);
  if (!Number.isFinite(budget) || budget < 0)
    throw new Error("--wait-sec must be a non-negative number");
  const active = new Map();
  const tasks = cold.map((src) => {
    const controller = new AbortController();
    active.set(src.id, controller);
    return syncSources({
      ...opts,
      sources: [src],
      foreground: true,
      signal: controller.signal,
    })
      .then(async (out) => {
        if (!controller.signal.aborted) {
          results.push(...out.results);
          notes.push(...out.notes);
          if (
            out.results.some(
              (result) => result.status === "media-probe-pending",
            )
          ) {
            pending.push(src.id);
            const cached = await loadAllEntries({
              ...opts,
              sources: [src],
              seedFile: null,
            });
            if (cached.entries.length) usable.add(src.id);
          }
        }
      })
      .finally(() => active.delete(src.id));
  });
  let timer;
  try {
    await Promise.race([
      Promise.all(tasks),
      new Promise((resolve) => {
        timer = setTimeout(resolve, budget * 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  for (const [id, controller] of active) {
    pending.push(id);
    controller.abort();
  }
  const uniquePending = [...new Set(pending)];
  if (uniquePending.length) {
    const background = queueBackgroundSync(uniquePending, opts);
    notes.push(...background.notes);
    if (["started", "queued"].includes(background.status)) {
      const refreshing = uniquePending.filter((id) => usable.has(id)).length;
      const downloading = uniquePending.length - refreshing;
      if (refreshing)
        notes.push(
          `${refreshing} sources refreshing cached samples in the background; current results are usable`,
        );
      if (downloading)
        notes.push(
          `${downloading} sources still downloading in the background`,
        );
    }
  }
  return {
    results,
    notes: [...new Set(notes)],
    pending: uniquePending,
    downloading: uniquePending.filter((id) => !usable.has(id)),
    refreshing: uniquePending.filter((id) => usable.has(id)),
  };
}
export async function runBackgroundSync(
  opts = {},
  { lockFile, lockToken } = {},
) {
  const cache = opts.cache || cacheDir(opts.env);
  const paths = backgroundPaths(cache);
  if (
    path.resolve(lockFile || "") !== path.resolve(paths.lockFile) ||
    read(lockFile)?.token !== lockToken
  )
    throw new Error("background lock ownership changed");
  const controller = new AbortController();
  const heartbeat = (opts.setIntervalImpl || setInterval)(() => {
    if (read(lockFile)?.token !== lockToken) return;
    try {
      const now = new Date();
      fs.utimesSync(lockFile, now, now);
    } catch (error) {
      if (error.code !== "ENOENT")
        notes.push(`lock heartbeat: ${error.message}`);
    }
  }, 60000);
  heartbeat.unref?.();
  const cleanup = () => releaseLock(lockFile, lockToken);
  const stop = () => {
    controller.abort();
    cleanup();
  };
  process.once("exit", cleanup);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const results = [],
    notes = [];
  try {
    while (!controller.signal.aborted) {
      const files = queueFiles(paths.queueDir);
      if (!files.length) {
        cleanup();
        // Enqueue happens before lock acquisition. Recheck after release to avoid
        // losing a request that arrived while the previous owner was finishing.
        if (!queueFiles(paths.queueDir).length) break;
        const fd = acquireLock(lockFile, lockToken, opts);
        if (fd === null) break;
        fs.closeSync(fd);
        continue;
      }
      const requests = new Map();
      for (const file of files) {
        const request = read(file, {});
        for (const id of request.sourceIds || []) {
          if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;
          const previous = requests.get(id);
          requests.set(id, {
            sourceIds: [id],
            categories: [
              ...new Set([
                ...(previous?.categories || []),
                ...(request.categories || []),
              ]),
            ],
            all: Boolean(previous?.all || request.all),
            allowLarge: Boolean(previous?.allowLarge || request.allowLarge),
            cachedOnly: previous
              ? previous.cachedOnly && Boolean(request.cachedOnly)
              : Boolean(request.cachedOnly),
            force: Boolean(previous?.force || request.force),
          });
        }
      }
      const outputs = await Promise.all(
        [...requests.values()].map((request) =>
          syncSources({
            ...opts,
            ...request,
            cache,
            kind: undefined,
            signal: controller.signal,
          }),
        ),
      );
      for (const out of outputs) {
        results.push(...out.results);
        notes.push(...out.notes);
      }
      if (controller.signal.aborted) break;
      await loadAllEntries({
        ...opts,
        cache,
        kind: undefined,
        categories: [],
        sourceIds: [...requests.keys()],
      });
      for (const file of files) {
        try {
          fs.unlinkSync(file);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    return { results, notes: [...new Set(notes)] };
  } finally {
    (opts.clearIntervalImpl || clearInterval)(heartbeat);
    cleanup();
    process.removeListener("exit", cleanup);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
