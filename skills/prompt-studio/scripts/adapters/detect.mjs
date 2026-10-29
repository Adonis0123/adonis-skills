// Guess an adapter for `sources add <owner/repo>`.
// Pure given { repo, branch, tree, fetchText }: no network and no disk.
import { countPromptBlocks } from "./markdown.mjs";

const PROMPT_KEYS = ["prompt", "promptFull", "content", "prompt_en"];
const ID_KEYS = ["id", "slug", "nativeId"];
const TITLE_KEYS = ["title", "name"];
const IMAGE_KEYS = [
  "image",
  "preview",
  "poster",
  "thumbnail",
  "posterUrl",
  "poster_url",
  "thumbnail_url",
  "imageUrl",
  "image_url",
];
const VIDEO_KEYS = ["video", "mediaUrl", "video_url", "videoUrl"];
const MODEL_KEYS = ["model", "models"];
const AUTHOR_KEYS = ["author", "creator"];
const LINK_KEYS = ["sourceUrl", "url", "sourceLink", "original_post_url"];
const DESC_KEYS = ["description", "summary", "notes"];

function treeInfo(tree) {
  const list = Array.isArray(tree) ? tree : tree?.tree || [];
  const truncated = !Array.isArray(tree) && tree?.truncated === true;
  const paths = [];
  for (const item of list) {
    if (!item?.path) continue;
    if (item.type && item.type !== "blob") continue;
    paths.push(String(item.path).replace(/\\/g, "/"));
  }
  return { paths, truncated };
}

function baseName(filePath) {
  return filePath.split("/").pop();
}

function isSkippedSegment(filePath) {
  return filePath
    .split("/")
    .some((part) => part.startsWith(".") || part === "node_modules");
}

function jsonCandidates(paths) {
  return paths.filter((filePath) => {
    if (!filePath.endsWith(".json")) return false;
    if (isSkippedSegment(filePath)) return false;
    const name = baseName(filePath);
    if (
      /^(package|package-lock|npm-shrinkwrap|tsconfig|jsconfig|vercel)\.json$/.test(
        name,
      )
    ) {
      return false;
    }
    const parts = filePath.split("/");
    return parts.length === 1 || parts[0] === "data";
  });
}

function yamlCandidates(paths) {
  return paths.filter(
    (filePath) => /\.ya?ml$/.test(filePath) && !isSkippedSegment(filePath),
  );
}

function present(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function promptKey(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  for (const key of PROMPT_KEYS) {
    if (present(obj[key])) return key;
  }
  return null;
}

function firstKey(obj, names) {
  const keys = Object.keys(obj);
  for (const name of names) {
    const hit = keys.find((key) => key.toLowerCase() === name.toLowerCase());
    if (hit && present(obj[hit])) return hit;
  }
  return null;
}

function dig(value, dotPath) {
  if (!dotPath) return value;
  let current = value;
  for (const part of dotPath.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = current[part];
  }
  return current;
}

function videoValue(item, field) {
  const value = field ? dig(item, field) : null;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.url === "string")
    return value.url;
  return "";
}

function locatePromptArray(root) {
  let best = null;
  const consider = (arr, itemPath) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    let count = 0;
    let sample = null;
    for (const item of arr) {
      if (promptKey(item)) {
        count += 1;
        if (!sample) sample = item;
      }
    }
    if (!count) return;
    if (!best || count > best.count) best = { path: itemPath, count, sample };
  };
  const walk = (node, itemPath, depth) => {
    if (node == null || depth > 6) return;
    if (Array.isArray(node)) {
      consider(node, itemPath);
      const seen = new Set();
      for (const item of node.slice(0, 8)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        for (const [key, value] of Object.entries(item)) {
          if (!Array.isArray(value) || seen.has(key)) continue;
          seen.add(key);
          const next = itemPath ? `${itemPath}[].${key}` : `[].${key}`;
          consider(value, next);
        }
      }
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, itemPath ? `${itemPath}.${key}` : key, depth + 1);
      }
    }
  };
  walk(root, "", 0);
  return best;
}

function guessMap(sample) {
  const map = {};
  const id = firstKey(sample, ID_KEYS);
  if (id) map.nativeId = id;
  const title = firstKey(sample, TITLE_KEYS);
  if (title) map.title = title;
  const prompt = promptKey(sample);
  if (prompt) map.content = prompt;
  const description = firstKey(sample, DESC_KEYS);
  if (description) map.description = description;

  let image = firstKey(sample, IMAGE_KEYS);
  let video = firstKey(sample, VIDEO_KEYS);
  if (video === "video" && sample.video && typeof sample.video === "object") {
    if (present(sample.video.url)) video = "video.url";
    if (!image && present(sample.video.thumbnail)) image = "video.thumbnail";
  }
  if (image) map.sourceMedia = image;
  if (video) map.videos = video;

  const model = firstKey(sample, MODEL_KEYS);
  if (model) map.model = model;
  const author = firstKey(sample, AUTHOR_KEYS);
  if (author) map.author = author;
  const link = firstKey(sample, LINK_KEYS);
  if (link) map.link = link;
  if (present(sample.category)) map.category = "category";
  if (present(sample.tags)) map.tags = "tags";
  return map;
}

function classifyItem(item, map) {
  const mediaType = String(item.mediaType || item.kind || "").toLowerCase();
  if (
    mediaType === "video" ||
    mediaType === "image" ||
    mediaType === "code-video"
  )
    return mediaType;
  const video = videoValue(item, map.videos);
  if (/\.(mp4|webm|mov)(?:$|\?)/i.test(video)) return "video";
  if (map.sourceMedia && present(dig(item, map.sourceMedia))) return "image";
  return null;
}

function kindsForItems(items, map) {
  const counts = { image: 0, video: 0, "code-video": 0 };
  for (const item of items) {
    if (!promptKey(item)) continue;
    const kind = classifyItem(item, map);
    if (kind) counts[kind] += 1;
  }
  const ranked = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { kinds: ["image"], filter: null, counts };
  const total = ranked.reduce((sum, [, count]) => sum + count, 0);
  const [top, topCount] = ranked[0];
  if (
    ranked.length > 1 &&
    topCount / total >= 0.95 &&
    itemHasMediaType(items)
  ) {
    return {
      kinds: [top],
      filter: { field: "mediaType", equals: top },
      counts,
    };
  }
  return { kinds: ranked.map(([kind]) => kind), filter: null, counts };
}

function itemHasMediaType(items) {
  return items.some((item) => item && item.mediaType);
}

function fileRank(filePath, count) {
  const name = baseName(filePath);
  const preferred = /^(cases|prompts)\.json$/.test(name) ? 2 : 1;
  const inData = filePath.startsWith("data/") ? 1 : 0;
  return preferred * 1_000_000_000 + count * 10 + inData;
}

async function readText(fetchText, filePath) {
  if (typeof fetchText !== "function") return "";
  try {
    const value = await fetchText(filePath);
    return value == null ? "" : String(value);
  } catch {
    return "";
  }
}

function parseJson(text) {
  try {
    return JSON.parse(String(text).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function yamlLooksLikeEntry(text) {
  return /^(prompt|promptFull|content|prompt_en)\s*:/m.test(text);
}

function yamlLocale(text) {
  return /^title:\s*\n\s+en:/m.test(text) || /^prompt:\s*\n\s+en:/m.test(text);
}

function dirOf(filePath) {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}

function kindFromDir(dir) {
  const name = dir.split("/").pop() || dir;
  if (/code-video|remotion|manim|hyperframes/i.test(name)) return "code-video";
  if (/video/i.test(name)) return "video";
  if (/image/i.test(name)) return "image";
  return null;
}

async function detectYaml(paths, fetchText) {
  const files = yamlCandidates(paths);
  const groups = new Map();
  for (const filePath of files) {
    const dir = dirOf(filePath);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(filePath);
  }
  const include = [];
  const kinds = [];
  let samples = 0;
  let locale = null;
  const sampleCap = 8;
  for (const [dir, group] of [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const sorted = group.slice().sort();
    const cap = Math.min(sorted.length, sampleCap);
    let dirHits = 0;
    const hitExt = new Set();
    for (let index = 0; index < cap; index++) {
      const samplePath = sorted[index];
      const text = await readText(fetchText, samplePath);
      if (!yamlLooksLikeEntry(text)) continue;
      dirHits += 1;
      hitExt.add(samplePath.endsWith(".yml") ? "yml" : "yaml");
      if (!locale && yamlLocale(text)) locale = "en";
    }
    if (!dirHits) continue;
    samples += dirHits;
    for (const ext of ["yaml", "yml"]) {
      if (!hitExt.has(ext)) continue;
      include.push(dir ? `${dir}/*.${ext}` : `*.${ext}`);
    }
    const kind = kindFromDir(dir);
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  if (!include.length) return null;
  const options = { include };
  if (paths.some((filePath) => filePath.startsWith("previews/"))) {
    options.previewBase = "previews/";
  }
  if (locale) options.locale = locale;
  if (!kinds.length) kinds.push("image");
  // Prefer the image, video order used by the yaml-tree registry when both exist.
  const ordered = ["image", "video", "code-video"].filter((kind) =>
    kinds.includes(kind),
  );
  return {
    adapter: "yaml-tree",
    options,
    kinds: ordered.length ? ordered : kinds,
    confidence: samples >= 3 ? "high" : "medium",
    reason: `${samples} YAML ${samples === 1 ? "file looks" : "files look"} like one prompt per file (${include.join(", ")}).`,
  };
}

function mdCandidates(paths) {
  return paths.filter(
    (filePath) => filePath.endsWith(".md") && !isSkippedSegment(filePath),
  );
}

function mdPriority(filePath) {
  if (filePath === "README.md") return 0;
  if (/(^|\/)readme\.md$/i.test(filePath)) return 1;
  if (/prompt|cases?|gallery|example/i.test(filePath)) return 2;
  return 3;
}

async function detectMarkdown(paths, fetchText, repo, truncated) {
  const files = mdCandidates(paths)
    .slice()
    .sort((a, b) => mdPriority(a) - mdPriority(b) || a.localeCompare(b));
  const cap = 40;
  const chosen = files.slice(0, cap);
  const scores = [];
  for (const filePath of chosen) {
    const text = await readText(fetchText, filePath);
    scores.push({ filePath, score: countPromptBlocks(text), text });
  }
  const readme = scores.find((item) => item.filePath === "README.md");
  const groups = new Map();
  for (const item of scores) {
    if (item.filePath === "README.md") continue;
    const dir = dirOf(item.filePath) || ".";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(item);
  }
  let bestDir = null;
  for (const [dir, group] of groups) {
    const sum = group.reduce((total, item) => total + item.score, 0);
    if (!bestDir || sum > bestDir.sum) bestDir = { dir, sum, group };
  }
  const bestFile = scores.reduce(
    (best, item) => (item.score > (best?.score || 0) ? item : best),
    null,
  );
  const readmeScore = readme?.score || 0;
  const capped = files.length > chosen.length;
  const note = [
    truncated ? "The git tree was truncated." : "",
    capped ? `Only the first ${cap} Markdown files were scored.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const finish = (options, score, label) => ({
    adapter: "markdown",
    options: { ...options, mode: "sections" },
    kinds: kindsFromRepo(repo),
    confidence: score >= 3 ? "high" : score > 0 ? "medium" : "low",
    reason: `${label}${note ? ` ${note}` : ""}`,
  });

  if (
    readme &&
    readmeScore > 0 &&
    readmeScore >= (bestDir?.sum || 0) &&
    readmeScore >= (bestFile?.score || 0)
  ) {
    return finish(
      { files: ["README.md"] },
      readmeScore,
      `README.md has ${readmeScore} section prompt blocks.`,
    );
  }
  if (
    bestDir &&
    bestDir.group.filter((item) => item.score > 0).length >= 2 &&
    bestDir.sum > readmeScore &&
    bestDir.sum >= (bestFile?.score || 0)
  ) {
    const glob = bestDir.dir === "." ? "*.md" : `${bestDir.dir}/*.md`;
    return finish(
      { glob },
      bestDir.sum,
      `${bestDir.sum} section prompt blocks across ${glob}.`,
    );
  }
  if (bestFile && bestFile.score > 0) {
    return finish(
      { files: [bestFile.filePath] },
      bestFile.score,
      `${bestFile.filePath} has ${bestFile.score} section prompt blocks.`,
    );
  }
  return {
    adapter: null,
    options: {},
    kinds: [],
    confidence: "low",
    reason: `No prompt evidence in Markdown${repo ? ` for ${repo}` : ""}.${note ? ` ${note}` : ""}`,
  };
}

function kindsFromRepo(repo) {
  const name = String(repo || "");
  if (/remotion|hyperframes|manim|motion-canvas|code-video/i.test(name))
    return ["code-video"];
  if (/seedance|veo|kling|hailuo|minimax|\bwan\b|sora|video/i.test(name))
    return ["video"];
  return ["image"];
}

function promptItemsOf(json, itemPath) {
  if (!itemPath) return Array.isArray(json) ? json : [];
  if (itemPath.includes("[].")) {
    const [head, tail] = itemPath.split("[].");
    const parents = head ? dig(json, head) : json;
    if (!Array.isArray(parents)) return [];
    const out = [];
    for (const parent of parents) {
      const child = dig(parent, tail);
      if (Array.isArray(child)) out.push(...child);
    }
    return out;
  }
  const value = dig(json, itemPath);
  return Array.isArray(value) ? value : [];
}

async function detectJsonResult(paths, fetchText) {
  const candidates = jsonCandidates(paths);
  let best = null;
  for (const filePath of candidates) {
    const json = parseJson(await readText(fetchText, filePath));
    if (json == null) continue;
    const found = locatePromptArray(json);
    if (!found) continue;
    const rank = fileRank(filePath, found.count);
    const record = { filePath, rank, json, ...found };
    if (!best || rank > best.rank) best = record;
  }
  if (!best) return null;
  const map = guessMap(best.sample);
  const items = promptItemsOf(best.json, best.path);
  const { kinds, filter } = kindsForItems(
    items.length ? items : [best.sample],
    map,
  );
  const options = {
    file: best.filePath,
    itemsPath: best.path,
    map,
  };
  if (filter) options.filter = filter;
  const promptField = best.sample && promptKey(best.sample);
  if (
    promptField &&
    best.sample[promptField] &&
    typeof best.sample[promptField] === "object"
  ) {
    options.locale = "en";
  }
  const where = best.path ? `at "${best.path}"` : "at the root";
  return {
    adapter: "json-map",
    options,
    kinds,
    confidence: best.count >= 3 ? "high" : "medium",
    reason: `${best.filePath} has ${best.count} objects with ${map.content || "a prompt"} ${where}.`,
  };
}

export async function detectSource({
  repo = "",
  branch = "main",
  tree = [],
  fetchText,
} = {}) {
  try {
    const { paths, truncated } = treeInfo(tree);
    const json = await detectJsonResult(paths, fetchText);
    if (json) {
      if (truncated) json.reason += " The git tree was truncated.";
      return json;
    }
    const yaml = await detectYaml(paths, fetchText);
    if (yaml) {
      if (truncated) yaml.reason += " The git tree was truncated.";
      return yaml;
    }
    const markdown = await detectMarkdown(paths, fetchText, repo, truncated);
    if (markdown.reason && branch && branch !== "main") {
      markdown.reason += ` Branch ${branch}.`;
    }
    return markdown;
  } catch (error) {
    return {
      adapter: null,
      options: {},
      kinds: [],
      confidence: "low",
      reason: `Detection failed: ${error?.message || error}`,
    };
  }
}
