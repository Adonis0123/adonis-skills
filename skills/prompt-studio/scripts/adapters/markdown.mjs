// Markdown adapter for README-style prompt libraries.
// Zero dependencies; Node 18+ ESM. Never executes fetched content.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VIDEO_EXT = /\.(mp4|webm|mov)(?:$|[?#])/i;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const LATIN = /[A-Za-z]/g;

// ---------- small helpers ----------

function opt(src, key, fallback) {
  if (src?.options && src.options[key] != null) return src.options[key];
  if (src?.[key] != null) return src[key];
  return fallback;
}

export function globToRegExp(glob) {
  const pattern = typeof glob === "string" ? glob : "";
  let re = "";
  const special = ".+^${}()|[]\\";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (special.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function stringList(value) {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw.filter((item) => typeof item === "string" && item);
}

function unique(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeNewlines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function fileStem(filePath) {
  const base = String(filePath || "entry")
    .split("/")
    .pop();
  return base.replace(/\.(md|markdown)$/i, "") || "entry";
}

export function slugify(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function shortHash(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 8);
}

export function guessLang(text) {
  const value = String(text || "");
  const cjk = value.match(CJK)?.length || 0;
  const latin = value.match(LATIN)?.length || 0;
  const total = cjk + latin;
  if (total < 12) return null;
  if (cjk / total >= 0.15) return "zh";
  if (latin >= 12) return "en";
  return null;
}

function repoRoot(repo, branch, mediaBase) {
  if (mediaBase) return String(mediaBase).replace(/\/?$/, "/");
  return `https://raw.githubusercontent.com/${repo}/${branch}/`;
}

function encodePath(rel) {
  return rel
    .split("/")
    .filter((part) => part && part !== ".")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isBadge(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "img.shields.io" || host.endsWith(".shields.io")) return true;
    if (host === "awesome.re" || host.endsWith(".awesome.re")) return true;
    if (host.endsWith("trendshift.io") && parsed.pathname.includes("badge"))
      return true;
    if (/\/badge(?:\.svg)?$/i.test(parsed.pathname)) return true;
  } catch {
    return false;
  }
  return false;
}

function absoluteHttp(url) {
  if (!url) return null;
  let value = String(url).trim().replace(/^<|>$/g, "");
  if (!value || /^javascript:/i.test(value) || /^data:/i.test(value))
    return null;
  if (value.startsWith("//")) value = `https:${value}`;
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

function toAbsolute(url, { repo, branch, filePath, mediaBase }) {
  const abs = absoluteHttp(url);
  if (abs) return abs;
  if (!url || !repo) return null;
  let raw = String(url).trim().replace(/^<|>$/g, "");
  if (!raw || /^(javascript|data):/i.test(raw)) return null;
  if (raw.startsWith("//")) return absoluteHttp(`https:${raw}`);
  let rootUrl;
  try {
    rootUrl = new URL(repoRoot(repo, branch, mediaBase));
  } catch {
    return null;
  }
  const fileRel = String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  let baseUrl = rootUrl;
  if (fileRel && !raw.startsWith("/")) {
    try {
      baseUrl = new URL(encodePath(fileRel), rootUrl);
    } catch {
      baseUrl = rootUrl;
    }
  }
  if (raw.startsWith("/")) raw = raw.replace(/^\/+/, "");
  let resolved;
  try {
    resolved = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (resolved.origin !== rootUrl.origin) return null;
  const rootPath = rootUrl.pathname.endsWith("/")
    ? rootUrl.pathname
    : `${rootUrl.pathname}/`;
  if (!resolved.pathname.startsWith(rootPath)) {
    // Evolink writes ../../images from cases/*.md. One extra ".." leaves
    // the branch directory. Keep the remainder under the repo raw root.
    const pinned = pinInsideRepo(fileRel, raw);
    if (!pinned) return null;
    try {
      resolved = new URL(pinned, rootUrl);
    } catch {
      return null;
    }
    if (
      resolved.origin !== rootUrl.origin ||
      !resolved.pathname.startsWith(rootPath)
    ) {
      return null;
    }
  }
  return resolved.href;
}

function pinInsideRepo(fileRel, raw) {
  const hashAt = raw.indexOf("#");
  const hash = hashAt >= 0 ? raw.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const queryAt = beforeHash.indexOf("?");
  const query = queryAt >= 0 ? beforeHash.slice(queryAt) : "";
  let pathname = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const fromRoot = pathname.startsWith("/");
  pathname = pathname.replace(/^\/+/, "");
  const stack = fromRoot || !fileRel ? [] : fileRel.split("/").slice(0, -1);
  for (const part of pathname.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length) stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (!stack.length) return null;
  return `${stack.join("/")}${query}${hash}`;
}

function isDirectVideo(url) {
  if (!url) return false;
  const clean = url.split("#")[0];
  return VIDEO_EXT.test(clean);
}

// ---------- title, body, attribution ----------

export function cleanTitle(raw) {
  let title = String(raw || "").trim();
  const numbered = title.match(/^(No\.\s*\d+|Case\s*\d+)\b/i);
  if (numbered) {
    title = title.slice(numbered[0].length).replace(/^[\s:：·.\-–—]+/, "");
  }
  title = title.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  title = title.replace(/`([^`]*)`/g, "$1");
  title = title.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  title = title.replace(/\s*\(\s*by\s+@[^)]+\)\s*$/i, "");
  return title.replace(/\s+/g, " ").trim();
}

function headingNumbers(raw) {
  const text = String(raw || "").trim();
  const caseNo = text.match(/^Case\s*(\d+)\b/i);
  if (caseNo) return { caseNo: caseNo[1] };
  const no = text.match(/^No\.\s*(\d+)\b/i);
  if (no) return { noNum: no[1] };
  return {};
}

function cleanContent(text) {
  if (!text) return "";
  const value = String(text)
    .replace(/^\n+|\n+$/g, "")
    .trim();
  // A comment-only fence is the Evolink broken opener, not a prompt.
  // A comment beside real prompt text stays literal. A trailing ``` stays
  // too: a longer fence can end on an inner closer that belongs to the prompt.
  const withoutComments = value.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!withoutComments) return "";
  if (/^(?:\*\*|__)+$/.test(withoutComments)) return "";
  return value;
}

function openingFence(line) {
  const match = String(line).match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  return { char: match[1][0], len: match[1].length };
}

function isClosingFence(line, char, len) {
  const match = String(line).match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
  return Boolean(match && match[1][0] === char && match[1].length >= len);
}

function nextClose(lines, from, char, len) {
  for (let i = from; i < lines.length; i++) {
    if (isClosingFence(lines[i], char, len)) return i;
  }
  return -1;
}

function column3Heading(line) {
  return /^###\s+(?!#)/.test(line);
}

function entryHeading(line) {
  return /^###\s+(?:Case\s+\d+|No\.\s*\d+)\b/i.test(line);
}

function ignorablePrefix(lines) {
  const text = lines.join("\n").replace(/<!--[\s\S]*?-->/g, "");
  return text.trim() === "";
}

function structuralFenceLine(line) {
  const trimmed = String(line)
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("|")) return true;
  if (/^</.test(trimmed) && !trimmed.replace(/<[^>]*>/g, "").trim())
    return true;
  return /^(?:\*\*|__)?Prompt(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*$/i.test(
    trimmed,
  );
}

function hasPromptLabel(lines, from, to) {
  for (let i = from; i < to; i++) {
    if (/^(?:\*\*|__)?Prompt(?:\*\*|__)?\s*[:：]/i.test(lines[i].trim())) {
      return true;
    }
  }
  return false;
}

function proseBetween(lines, from, to) {
  for (let i = from; i < to; i++) {
    if (!structuralFenceLine(lines[i])) return true;
  }
  return false;
}

// Evolink's false closer is the real prompt's opener: prose, then another fence.
function promptFollowsCloser(lines, closeAt) {
  let seenText = false;
  for (let i = closeAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (column3Heading(line) || /^##\s+(?!#)/.test(line)) return false;
    if (openingFence(line)) return seenText;
    if (line.trim()) seenText = true;
  }
  return false;
}

// A `### ` ends a fence only when that fence never closes. A closed fence
// keeps embedded markdown, including a leading `### Case N` and an inner
// closer. Evolink is the exception: the opener never holds the prompt, a
// Case/No heading follows only comments, and the matching closer is really
// the next prompt's opener.
function recoveryIndex(lines, openAt, char, len) {
  const closeAt = nextClose(lines, openAt + 1, char, len);
  const limit = closeAt < 0 ? lines.length : closeAt;
  for (let i = openAt + 1; i < limit; i++) {
    if (!column3Heading(lines[i])) continue;
    if (closeAt < 0) return i;
    if (
      !ignorablePrefix(lines.slice(openAt + 1, i)) ||
      !entryHeading(lines[i])
    ) {
      continue;
    }
    if (proseBetween(lines, i + 1, closeAt)) continue;
    if (!hasPromptLabel(lines, i + 1, closeAt)) continue;
    if (!promptFollowsCloser(lines, closeAt)) continue;
    return i;
  }
  return -1;
}

function stripCommentsOutsideFences(text) {
  const lines = normalizeNewlines(text).split("\n");
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let inComment = false;
  const out = [];
  for (const line of lines) {
    if (inFence) {
      out.push(line);
      if (isClosingFence(line, fenceChar, fenceLen)) inFence = false;
      continue;
    }
    let visible = "";
    let index = 0;
    while (index < line.length) {
      if (inComment) {
        const end = line.indexOf("-->", index);
        if (end < 0) {
          index = line.length;
          break;
        }
        inComment = false;
        index = end + 3;
        continue;
      }
      const start = line.indexOf("<!--", index);
      if (start < 0) {
        visible += line.slice(index);
        break;
      }
      visible += line.slice(index, start);
      inComment = true;
      index = start + 4;
    }
    if (!inComment) {
      const opened = openingFence(visible);
      if (opened) {
        inFence = true;
        fenceChar = opened.char;
        fenceLen = opened.len;
        out.push(line);
        continue;
      }
    }
    out.push(visible);
  }
  return out.join("\n");
}

function outsideFences(text) {
  const lines = normalizeNewlines(stripCommentsOutsideFences(text)).split("\n");
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const opened = openingFence(lines[index]);
    if (!opened) {
      out.push(lines[index]);
      index += 1;
      continue;
    }
    const recoverAt = recoveryIndex(lines, index, opened.char, opened.len);
    const closeAt = nextClose(lines, index + 1, opened.char, opened.len);
    if (recoverAt >= 0) {
      index = recoverAt;
      continue;
    }
    if (closeAt >= 0) {
      index = closeAt + 1;
      continue;
    }
    break;
  }
  return out.join("\n");
}

function attributionText(text) {
  const prepared = stripCommentsOutsideFences(text);
  const region = outsideFences(prepared);
  const content = extractContent(prepared);
  if (!content) return region;
  const at = region.indexOf(content);
  if (at < 0) return region;
  return `${region.slice(0, at)}\n${region.slice(at + content.length)}`;
}

function firstFence(body) {
  const lines = normalizeNewlines(stripCommentsOutsideFences(body)).split("\n");
  let open = -1;
  let fenceChar = "";
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open < 0) {
      const started = openingFence(line);
      if (started) {
        open = i;
        fenceChar = started.char;
        fenceLen = started.len;
      }
      continue;
    }
    if (isClosingFence(line, fenceChar, fenceLen)) {
      return cleanContent(lines.slice(open + 1, i).join("\n"));
    }
    if (
      column3Heading(line) &&
      recoveryIndex(lines, open, fenceChar, fenceLen) === i
    ) {
      return cleanContent(lines.slice(open + 1, i).join("\n"));
    }
  }
  if (open >= 0) return cleanContent(lines.slice(open + 1).join("\n"));
  return "";
}

function textAfterPromptLabel(body) {
  const match = normalizeNewlines(body).match(
    /(?:^|\n)[ \t]*(?:\*\*|__)?Prompt(?:\*\*|__)?[ \t]*[:：][ \t]*(?:\*\*|__)?[ \t]*([\s\S]*)$/i,
  );
  if (!match) return "";
  const lines = [];
  for (const line of match[1].split("\n")) {
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(line)) break;
    if (/^(?:#{1,6}\s|---\s*$|\*\*(?:Output|Author|Source)|<img\b)/i.test(line))
      break;
    lines.push(line);
  }
  return cleanContent(lines.join("\n"));
}

function extractContent(body) {
  return firstFence(body) || textAfterPromptLabel(body);
}

function extractDescription(body) {
  const lines = normalizeNewlines(body).split("\n");
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length) break;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(trimmed)) break;
    if (/^!\[[^\]]*\]\(/.test(trimmed)) continue;
    if (/^<img\b/i.test(trimmed)) continue;
    if (
      /^<\/?(?:div|a|table|thead|tbody|tr|td|details|summary|p|br)\b/i.test(
        trimmed,
      )
    )
      continue;
    if (trimmed.startsWith("|")) continue;
    if (/^(?:\*\*|__)?Prompt(?:\*\*|__)?\s*[:：]/i.test(trimmed)) break;
    if (
      /^[-*]?\s*(?:\*\*|__)?(?:Author|作者|Source|来源|Published|Image|Metadata|Output|原帖)/i.test(
        trimmed,
      )
    )
      continue;
    if (/img\.shields\.io/i.test(trimmed)) continue;
    kept.push(trimmed);
  }
  let text = kept
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^\*[^*]+\*$/.test(text)) text = text.slice(1, -1).trim();
  if (text.length > 1000) text = text.slice(0, 1000).trim();
  return text;
}

function cleanAuthor(value) {
  if (!value) return null;
  let name = String(value).trim();
  // Bold may close after the colon: `**Author:** [Name](url)`.
  name = name.replace(/^(?:\*\*|__)+/, "").trim();
  name = name.replace(/(?:\*\*|__)+$/, "").trim();
  const linked = name.match(/^\[([^\]]+)\]/);
  if (linked) name = linked[1];
  else name = name.split("·")[0].trim();
  name = name.replace(/\s*\(@[^)]+\)\s*$/, "").trim();
  name = name.replace(/\s*\(https?:\/\/[^)]+\)\s*$/, "").trim();
  name = name
    .replace(/^(?:\*\*|__)+/, "")
    .replace(/(?:\*\*|__)+$/, "")
    .trim();
  if (!name || /^(unknown|n\/a|none|匿名|null)$/i.test(name)) return null;
  return name;
}

function extractAuthor(text) {
  // Bold can close before the colon (`**作者**：`) or after it (`**Author:**`).
  // Gallery rows also put `Author:` after a `·`, not at the start of the line.
  const author =
    text.match(
      /(?:^|\n)\s*[-*]?\s*(?:\*\*|__)?(?:Author|作者)(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*([^\n]+)/i,
    ) || text.match(/·\s*(?:Author|作者)\s*[:：]\s*([^·\n]+)/i);
  if (author) {
    const name = cleanAuthor(author[1]);
    if (name) return name;
  }
  const by =
    text.match(/\bby\s+\[@([^\]]+)\]/i) ||
    text.match(/\bby\s+@([A-Za-z0-9_]+)/);
  if (by) return `@${by[1]}`;
  const source =
    text.match(/\*+\s*Source\s*[:：]\s*\**\s*\[@?([^\]]+)\]/i) ||
    text.match(
      /(?:^|\n)\s*[-*]?\s*(?:\*\*|__)?Source(?:\*\*|__)?\s*[:：]\s*\**\s*\[@?([^\]]+)\]/i,
    );
  if (source) {
    const name = source[1].trim();
    if (
      !name ||
      /^(unknown|x|twitter|twitter post|source|source article)$/i.test(name)
    ) {
      return null;
    }
    return name.startsWith("@") ? name : `@${name}`;
  }
  return null;
}

function extractLink(text) {
  const urls = [
    ...String(text).matchAll(
      /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s)>\]]+/gi,
    ),
  ].map((match) => match[0].replace(/[.,]+$/, ""));
  return urls.find((url) => /\/status\/\d+/.test(url)) || urls[0] || null;
}

function extractGalleryId(text) {
  const match = String(text).match(/[?&]id=(\d+)\b/);
  return match ? match[1] : null;
}

const listSeen = new WeakMap();

function pushUnique(list, value) {
  if (!value) return;
  let seen = listSeen.get(list);
  if (!seen) {
    seen = new Set(list);
    listSeen.set(list, seen);
  }
  if (seen.has(value)) return;
  seen.add(value);
  list.push(value);
}

function extractImages(text, loc) {
  const images = [];
  const tags = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  for (const match of text.matchAll(tags)) {
    const url = toAbsolute(match[1] || match[2] || match[3], loc);
    if (url && !isBadge(url) && !isDirectVideo(url)) pushUnique(images, url);
  }
  const markdown = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(markdown)) {
    const url = toAbsolute(match[1], loc);
    if (url && !isBadge(url) && !isDirectVideo(url)) pushUnique(images, url);
  }
  const imageLine = text.match(/^[ \t]*[-*]?\s*Image\s*[:：]\s*`([^`]+)`/im);
  if (imageLine) {
    const url = toAbsolute(imageLine[1], { ...loc, filePath: "" });
    if (url && !isBadge(url)) pushUnique(images, url);
  }
  return images;
}

function extractVideos(text) {
  const videos = [];
  const urls = String(text).matchAll(/https?:\/\/[^\s)"'<>]+/gi);
  for (const match of urls) {
    const url = match[0].replace(/[.,]+$/, "");
    if (isDirectVideo(url)) pushUnique(videos, url);
  }
  return videos;
}

function parseMetadata(body) {
  const match = body.match(
    /^[ \t]*[-*]?\s*(?:\*\*|__)?Metadata(?:\*\*|__)?\s*[:：]\s*(.+)$/im,
  );
  if (!match) return {};
  const parts = match[1].split("·").map((part) =>
    part
      .replace(/`/g, "")
      .replace(/\[[^\]]*\]\([^)]*\)/g, "")
      .trim(),
  );
  const category =
    parts[0] && !/^(landscape|portrait|square)$/i.test(parts[0])
      ? parts[0]
      : null;
  let ratio = null;
  for (const part of parts) {
    const size = part.match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
    if (size) {
      ratio = `${size[1]}x${size[2]}`;
      break;
    }
  }
  if (!ratio) {
    const aspect = parts.find((part) =>
      /^(landscape|portrait|square|\d+\s*:\s*\d+)$/i.test(part),
    );
    if (aspect) ratio = aspect.toLowerCase().replace(/\s+/g, "");
  }
  return { category, ratio };
}

function baseEntry(partial, src, meta) {
  const kind = opt(src, "kind", null) || src?.kinds?.[0] || null;
  const modelDefault = opt(src, "modelDefault", null);
  const entry = {
    nativeId: partial.nativeId,
    title: partial.title || "",
    content: partial.content || "",
    sourceMedia: partial.sourceMedia || [],
    videos: partial.videos || [],
  };
  if (kind) entry.kind = kind;
  if (partial.description) entry.description = partial.description;
  if (partial.lang) entry.lang = partial.lang;
  if (partial.model || modelDefault)
    entry.model = partial.model || modelDefault;
  if (partial.category) entry.category = partial.category;
  if (partial.author) entry.author = partial.author;
  if (partial.link) entry.link = partial.link;
  if (partial.ratio) entry.ratio = partial.ratio;
  if (partial.tags?.length) entry.tags = partial.tags;
  if (!entry.nativeId) {
    entry.nativeId =
      slugify(entry.title) ||
      shortHash(`${meta?.filePath || ""}\n${entry.title}\n${entry.content}`);
  }
  identity.set(
    entry,
    `${meta?.filePath || ""}\n${entry.title}\n${entry.content}`,
  );
  return entry;
}

const identity = new WeakMap();

function disambiguate(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const base =
      entry.nativeId || shortHash(identity.get(entry) || entry.content || "");
    entry.nativeId = base;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(entry);
  }
  for (const [base, group] of groups) {
    if (group.length < 2) continue;
    for (const entry of group) {
      entry.nativeId = `${base}-${shortHash(identity.get(entry) || "")}`;
    }
  }
  const used = new Set();
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const left = identity.get(a.entry) || "";
      const right = identity.get(b.entry) || "";
      if (left !== right) return left < right ? -1 : 1;
      return a.index - b.index;
    });
  for (const item of ordered) {
    let id = item.entry.nativeId;
    if (!used.has(id)) {
      used.add(id);
      continue;
    }
    let n = 2;
    let next = `${id}-${n}`;
    while (used.has(next)) {
      n += 1;
      next = `${id}-${n}`;
    }
    item.entry.nativeId = next;
    used.add(next);
  }
  return entries;
}

// ---------- modes ----------

function splitSections(text) {
  const lines = normalizeNewlines(stripCommentsOutsideFences(text)).split("\n");
  const sections = [];
  let current = null;
  const push = () => {
    if (current) sections.push(current);
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const opened = current ? openingFence(line) : null;
    if (opened) {
      const recoverAt = recoveryIndex(lines, index, opened.char, opened.len);
      const closeAt = nextClose(lines, index + 1, opened.char, opened.len);
      if (recoverAt >= 0) {
        for (let cursor = index; cursor < recoverAt; cursor++) {
          current.lines.push(lines[cursor]);
        }
        index = recoverAt;
        continue;
      }
      if (closeAt >= 0) {
        for (let cursor = index; cursor <= closeAt; cursor++) {
          current.lines.push(lines[cursor]);
        }
        index = closeAt + 1;
        continue;
      }
      for (let cursor = index; cursor < lines.length; cursor++) {
        current.lines.push(lines[cursor]);
      }
      break;
    }
    const heading = line.match(/^(#{2,3})\s+(?!#)(.*)$/);
    if (heading) {
      push();
      current = { heading: heading[2], lines: [] };
      index += 1;
      continue;
    }
    if (current) current.lines.push(line);
    index += 1;
  }
  push();
  return sections;
}

function sectionNativeId(heading, body, filePath, title, content) {
  const galleryId = extractGalleryId(`${heading}\n${body}`);
  if (galleryId) return galleryId;
  const numbers = headingNumbers(heading);
  const stem = fileStem(filePath).toLowerCase();
  if (numbers.caseNo) return `${stem}-case-${numbers.caseNo}`;
  if (numbers.noNum) return `${stem}-no-${numbers.noNum}`;
  const slug = slugify(title);
  if (slug && stem !== "readme" && stem !== "readme.md")
    return `${stem}-${slug}`;
  if (slug) return slug;
  return shortHash(`${filePath}\n${content}`);
}

export function parseSections(text, src, meta) {
  const loc = {
    repo: src.repo,
    branch: src.branch || "main",
    filePath: meta.filePath,
    mediaBase: opt(src, "mediaBase", null),
  };
  const entries = [];
  for (const section of splitSections(text)) {
    try {
      const body = section.lines.join("\n");
      const content = extractContent(body);
      if (!content) continue;
      const title = cleanTitle(section.heading);
      const whole = `${section.heading}\n${body}`;
      const metaText = attributionText(whole);
      const metaFields = parseMetadata(body);
      const description = extractDescription(body);
      entries.push(
        baseEntry(
          {
            nativeId: sectionNativeId(
              section.heading,
              body,
              meta.filePath,
              title,
              content,
            ),
            title,
            description:
              description && description !== content ? description : "",
            content,
            lang: guessLang(`${title}\n${content}`),
            sourceMedia: extractImages(whole, loc),
            videos: extractVideos(whole),
            author: extractAuthor(metaText),
            link: extractLink(metaText),
            category: metaFields.category,
            ratio: metaFields.ratio,
          },
          src,
          meta,
        ),
      );
    } catch {
      // Skip a broken section. Never throw out of the adapter.
    }
  }
  return entries;
}

export function parsePromptFile(text, src, meta) {
  const normalized = normalizeNewlines(text);
  let title = "";
  for (const line of normalized.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      title = cleanTitle(heading[1]);
      break;
    }
  }
  const content = extractContent(normalized);
  if (!content) return [];
  const loc = {
    repo: src.repo,
    branch: src.branch || "main",
    filePath: meta.filePath,
    mediaBase: opt(src, "mediaBase", null),
  };
  const description = extractDescription(normalized);
  return [
    baseEntry(
      {
        nativeId: fileStem(meta.filePath),
        title,
        description: description && description !== content ? description : "",
        content,
        lang: guessLang(`${title}\n${content}`),
        sourceMedia: extractImages(normalized, loc),
        videos: extractVideos(normalized),
        author: extractAuthor(attributionText(normalized)),
        link: extractLink(attributionText(normalized)),
      },
      src,
      meta,
    ),
  ];
}

function columnRoles(columns) {
  if (Array.isArray(columns)) {
    const map = {};
    columns.forEach((role, index) => {
      if (role && role !== "index" && role !== "#") map[role] = index + 1;
    });
    return map;
  }
  return {
    title: 2,
    link: 2,
    description: 3,
    content: 4,
    ...(columns || {}),
  };
}

function splitRow(line) {
  let raw = line.trim();
  if (raw.startsWith("|")) raw = raw.slice(1);
  if (raw.endsWith("|")) raw = raw.slice(0, -1);
  const cells = [];
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && raw[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (raw[i] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += raw[i];
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function cellPlain(cell) {
  return String(cell || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWrappingQuotes(text) {
  const value = String(text || "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("“") && value.endsWith("”")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function cellLink(cell) {
  const urls = [...String(cell || "").matchAll(/https?:\/\/[^\s)>\]]+/g)].map(
    (match) => match[0],
  );
  return (
    urls.find((url) =>
      /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(url),
    ) ||
    urls.find((url) => /x\.com|twitter\.com/.test(url)) ||
    urls[0] ||
    null
  );
}

export function parseTable(text, src, meta) {
  const roles = columnRoles(opt(src, "columns", null));
  const lines = normalizeNewlines(text).split("\n");
  const entries = [];
  let pendingHeader = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) {
      pendingHeader = false;
      continue;
    }
    if (isSeparatorRow(line)) {
      pendingHeader = false;
      continue;
    }
    const next = lines[i + 1] || "";
    if (isSeparatorRow(next)) {
      pendingHeader = true;
      continue;
    }
    if (pendingHeader) pendingHeader = false;
    try {
      const cells = splitRow(line);
      const at = (role) => {
        const index = roles[role];
        if (!index || index < 1) return "";
        return cells[index - 1] || "";
      };
      const content = stripWrappingQuotes(cellPlain(at("content")));
      if (!content) continue;
      const title =
        cleanTitle(cellPlain(at("title"))) || cleanTitle(content.slice(0, 80));
      const description = cellPlain(at("description"));
      const link = cellLink(at("link")) || cellLink(cells.join(" "));
      const author = cleanAuthor(cellPlain(at("author")));
      entries.push(
        baseEntry(
          {
            nativeId: slugify(title) || `row-${i + 1}`,
            title,
            description:
              description && description !== content ? description : "",
            content,
            lang: guessLang(`${title}\n${content}`),
            link,
            author,
            sourceMedia: [],
            videos: extractVideos(cells.join(" ")),
          },
          src,
          meta,
        ),
      );
    } catch {
      // Skip a broken row.
    }
  }
  return entries;
}

export function parseDocument(text, src, meta) {
  const mode = opt(src, "mode", "sections");
  if (mode === "prompt-files") return parsePromptFile(text, src, meta);
  if (mode === "table") return parseTable(text, src, meta);
  if (mode !== "sections") return [];
  return parseSections(text, src, meta);
}

const CODE_LANG =
  /^(?:bash|sh|shell|zsh|fish|powershell|ps1|pwsh|cmd|bat|console|terminal|js|javascript|ts|typescript|jsx|tsx|py|python|rb|ruby|go|rs|rust|java|c|cpp|cc|h|hpp|cs|php|sql|ya?ml|xml|html|css|scss|json|toml|ini|dockerfile|makefile|diff|vue|svelte)$/i;
const CODE_LINE =
  /^\s*(?:\$|>|#{1,2}\s|\/\/)|^\s*(?:npm|pnpm|yarn|bun|npx|pnpx|git|cd|curl|wget|sudo|apt(?:-get)?|brew|docker|make|cargo|pip3?|python3?|node|go)\b/;

function fenceLanguage(body) {
  const match = normalizeNewlines(body).match(
    /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([^\n`]*)$/m,
  );
  if (!match) return "";
  return match[1].trim().split(/\s+/)[0] || "";
}

function looksLikeCode(content, info) {
  if (info && !/^(?:text|txt|md|markdown|prompt|plaintext)$/i.test(info)) {
    if (CODE_LANG.test(info)) return true;
  }
  const lines = String(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  const codeish = lines.filter((line) => CODE_LINE.test(line)).length;
  return codeish / lines.length >= 0.5;
}

function hasPromptEvidence(heading, body, content) {
  if (/\bprompts?\b|提示词|提示语/i.test(heading || "")) return true;
  if (
    /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*|__)?Prompt(?:\*\*|__)?\s*[:：]/i.test(
      body || "",
    )
  ) {
    return true;
  }
  if (/^(?:case\s*\d+|no\.\s*\d+)\b/i.test(String(heading || "").trim())) {
    return true;
  }
  if (looksLikeCode(content, fenceLanguage(body))) return false;
  const words = String(content).trim().split(/\s+/).filter(Boolean);
  if (words.length >= 6) return true;
  return (String(content).match(CJK)?.length || 0) >= 12;
}

export function countPromptBlocks(text) {
  let count = 0;
  for (const section of splitSections(text)) {
    const body = section.lines.join("\n");
    const content = extractContent(body);
    if (!content || !hasPromptEvidence(section.heading, body, content))
      continue;
    count += 1;
  }
  return count;
}

// ---------- joins ----------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function dig(value, dotPath) {
  if (!dotPath) return value;
  let current = value;
  for (const part of String(dotPath).split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = current[part];
  }
  return current;
}

function normKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function applyIdMap(entries, data, spec) {
  const table = dig(data, spec.path || spec.objectPath || "");
  if (!table || typeof table !== "object" || Array.isArray(table)) return;
  const match = spec.match || "nativeId";
  const into = spec.into || "videos";
  for (const entry of entries) {
    const key = entry[match];
    if (key == null) continue;
    const raw = table[key] ?? table[String(key)];
    const url = typeof raw === "string" ? raw : raw?.url || raw?.mp4 || null;
    if (!url) continue;
    if (into === "sourceMedia") pushUnique(entry.sourceMedia, url);
    else if (!isDirectVideo(url) && into === "videos") continue;
    else pushUnique(entry.videos, url);
  }
}

function applyRecords(entries, data, spec) {
  let rows = dig(data, spec.path || "");
  if (!Array.isArray(rows)) {
    if (Array.isArray(data)) rows = data;
    else if (data && typeof data === "object") {
      rows = Object.values(data).find((value) => Array.isArray(value)) || null;
    }
  }
  if (!Array.isArray(rows)) return;
  const fields = spec.match || ["title", "slug", "id"];
  const copy = spec.copy || {
    author: "author",
    link: "url",
    category: "category",
  };
  const index = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const field of fields) {
      const key = normKey(row[field]);
      if (key && !index.has(key)) index.set(key, row);
    }
  }
  for (const entry of entries) {
    const row =
      index.get(normKey(entry.title)) ||
      index.get(normKey(entry.nativeId)) ||
      index.get(normKey(String(entry.nativeId || "").replace(/^\d+-/, "")));
    if (!row) continue;
    for (const [target, from] of Object.entries(copy)) {
      if (entry[target]) continue;
      const value = row[from];
      if (typeof value === "string" && value.trim())
        entry[target] = value.trim();
    }
  }
}

function applyJoins(entries, src, dir) {
  const joins = opt(src, "joins", null);
  const list = Array.isArray(joins) ? joins : joins ? [joins] : [];
  for (const spec of list) {
    if (!spec || !spec.file) continue;
    const file = safeJoin(dir, spec.file);
    if (!file) continue;
    const data = readJson(file);
    if (data == null) continue;
    try {
      const kind = spec.kind || (Array.isArray(data) ? "records" : "id-map");
      if (kind === "records") applyRecords(entries, data, spec);
      else applyIdMap(entries, data, spec);
    } catch {
      // A bad join skips that file only.
    }
  }
  return entries;
}

// ---------- files on disk and on GitHub ----------

function safeJoin(dir, repoPath) {
  const clean = String(repoPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!clean || clean.split("/").includes("..")) return null;
  return path.join(dir, ...clean.split("/"));
}

function walk(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  const visit = (abs, rel) => {
    let names = [];
    try {
      names = fs.readdirSync(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith("_") || name === "state.json") continue;
      const child = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      let stat;
      try {
        stat = fs.statSync(child);
      } catch {
        continue;
      }
      if (stat.isDirectory()) visit(child, childRel);
      else out.push(childRel);
    }
  };
  visit(dir, "");
  return out;
}

function listRepoFiles(src, dir) {
  try {
    return listRepoFilesUnsafe(src, dir);
  } catch {
    return [];
  }
}

function listRepoFilesUnsafe(src, dir) {
  const explicitValue = opt(src, "files", null);
  const globValue = opt(src, "glob", null);
  const explicit = stringList(explicitValue);
  const globs = stringList(globValue);
  const exclude = stringList(opt(src, "exclude", []));
  let list = [...explicit];
  if (globs.length && dir) {
    const regs = globs.map((item) => globToRegExp(item));
    for (const rel of walk(dir).sort()) {
      if (regs.some((re) => re.test(rel))) list.push(rel);
    }
  }
  const globConfigured = Array.isArray(globValue)
    ? globValue.length > 0
    : globValue != null && globValue !== false;
  if (!explicitValue && !globConfigured) list = ["README.md"];
  const excludeRes = exclude.map((item) => globToRegExp(item));
  list = unique(list).filter(
    (rel) => rel && !excludeRes.some((re) => re.test(rel)),
  );
  const joins = []
    .concat(opt(src, "joins", []))
    .map((item) => item?.file)
    .filter(Boolean);
  return list.filter((rel) => !joins.includes(rel));
}

function rawUrl(repo, branch, repoPath) {
  const encoded = String(repoPath)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${encoded}`;
}

function treeUrl(repo, branch) {
  return `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
}

function subtreeUrl(repo, sha) {
  return `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(sha)}`;
}

async function blobPaths(ctx, repo, branch, dir, results, src) {
  const treeFile = path.join(dir, "_meta", "tree.json");
  fs.mkdirSync(path.dirname(treeFile), { recursive: true });
  results.push(await pull(ctx, treeUrl(repo, branch), treeFile));
  const tree = readJson(treeFile);
  const partial = pathsFromTree(tree);
  if (!tree?.truncated) return matchGlobs(partial, src);
  if (!tree.sha) {
    results.push({
      status: "incomplete-tree",
      error: "git tree truncated and root sha is missing",
    });
    return matchGlobs(partial, src);
  }
  const blobs = new Set();
  const pending = [{ sha: tree.sha, prefix: "" }];
  const expanded = new Set();
  const bodies = new Map();
  let incomplete = false;
  while (pending.length) {
    const next = pending.shift();
    if (!next?.sha) {
      incomplete = true;
      continue;
    }
    const pair = `${next.sha}\n${next.prefix}`;
    if (expanded.has(pair)) continue;
    expanded.add(pair);
    let body = bodies.get(next.sha);
    if (body === undefined) {
      const file = path.join(dir, "_meta", "trees", `${next.sha}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const subReport = await pull(ctx, subtreeUrl(repo, next.sha), file);
      results.push(subReport);
      const loaded = readJson(file);
      const status = String(subReport?.status || "");
      if (
        !loaded ||
        !Array.isArray(loaded.tree) ||
        status.startsWith("unavailable") ||
        status.startsWith("stale")
      ) {
        bodies.set(next.sha, null);
        incomplete = true;
        continue;
      }
      body = loaded;
      bodies.set(next.sha, loaded);
    } else if (body == null) {
      incomplete = true;
      continue;
    }
    if (body.truncated) incomplete = true;
    for (const item of body.tree) {
      if (!item?.path || typeof item.path !== "string") continue;
      const rel = next.prefix ? `${next.prefix}/${item.path}` : item.path;
      if (item.type === "tree") {
        if (item.sha) pending.push({ sha: item.sha, prefix: rel });
        else incomplete = true;
      } else if (!item.type || item.type === "blob") {
        blobs.add(rel);
      }
    }
  }
  if (incomplete) {
    results.push({
      status: "incomplete-tree",
      error: "git tree truncated; subtree fetch did not finish",
    });
    for (const item of partial) blobs.add(item);
  }
  return matchGlobs([...blobs], src);
}

async function pull(ctx, url, file) {
  const extra = {};
  if (ctx.cache) extra.cache = ctx.cache;
  if (ctx.token) extra.token = ctx.token;
  if (ctx.now != null) extra.now = ctx.now;
  if (ctx.env) extra.env = ctx.env;
  try {
    return await ctx.fetchCached(url, file, extra);
  } catch (error) {
    return {
      url,
      file,
      status: "unavailable-error",
      error: String(error?.message || error),
    };
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function pathsFromTree(json) {
  const list = Array.isArray(json) ? json : json?.tree;
  if (!Array.isArray(list)) return [];
  const paths = [];
  for (const item of list) {
    if (!item?.path) continue;
    if (item.type && item.type !== "blob") continue;
    paths.push(item.path);
  }
  return paths;
}

function matchGlobs(paths, src) {
  const globs = stringList(opt(src, "glob", null));
  const exclude = stringList(opt(src, "exclude", [])).map((item) =>
    globToRegExp(item),
  );
  const regs = globs.map((item) => globToRegExp(item));
  return paths.filter((item) => {
    if (!regs.some((re) => re.test(item))) return false;
    if (exclude.some((re) => re.test(item))) return false;
    return true;
  });
}

export async function sync(src = {}, ctx = {}) {
  const results = [];
  if (!ctx || typeof ctx.fetchCached !== "function") {
    return {
      results: [
        {
          status: "unavailable-error",
          error: "fetchCached missing",
        },
      ],
    };
  }
  const repo = src.repo;
  const branch = src.branch || "main";
  const dir = ctx.dir;
  if (!repo || !dir) {
    return {
      results: [
        { status: "unavailable-error", error: "repo and ctx.dir are required" },
      ],
    };
  }
  fs.mkdirSync(dir, { recursive: true });

  const explicit = opt(src, "files", null);
  let remoteFiles = [];
  if (Array.isArray(explicit)) remoteFiles.push(...explicit);
  else if (typeof explicit === "string") remoteFiles.push(explicit);

  if (stringList(opt(src, "glob", null)).length || opt(src, "glob", null)) {
    remoteFiles.push(
      ...(await blobPaths(ctx, repo, branch, dir, results, src)),
    );
  }
  if (!opt(src, "files", null) && !opt(src, "glob", null)) {
    remoteFiles.push("README.md");
  }
  const joins = []
    .concat(opt(src, "joins", []))
    .map((item) => item?.file)
    .filter(Boolean);
  remoteFiles = unique([...remoteFiles, ...joins]);

  for (const repoPath of remoteFiles) {
    const file = safeJoin(dir, repoPath);
    if (!file) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    results.push(await pull(ctx, rawUrl(repo, branch, repoPath), file));
  }
  return { results };
}

export function load(src = {}, ctx = {}) {
  const dir = ctx?.dir;
  if (!dir || !fs.existsSync(dir)) return [];
  const entries = [];
  for (const repoPath of listRepoFiles(src, dir)) {
    const file = safeJoin(dir, repoPath);
    if (!file) continue;
    const text = readText(file);
    if (text == null) continue;
    try {
      entries.push(
        ...parseDocument(text, src, { filePath: repoPath.replace(/\\/g, "/") }),
      );
    } catch {
      // Skip a file the parser cannot read.
    }
  }
  try {
    applyJoins(entries, src, dir);
  } catch {
    // Joins are optional.
  }
  return disambiguate(entries.filter((entry) => entry?.content));
}
