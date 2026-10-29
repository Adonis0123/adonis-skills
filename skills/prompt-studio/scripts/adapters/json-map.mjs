import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { defaultFetch } from "../studio.mjs";

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
export function at(value, key = "") {
  return key
    ? key
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .reduce((v, k) => v?.[k], value)
    : value;
}
function options(src) {
  return { ...src, ...src.options };
}
function raw(src, file) {
  return `https://raw.githubusercontent.com/${src.repo}/${src.branch || "main"}/${file}`;
}
function localFile(dir, file) {
  if (
    typeof file !== "string" ||
    !file ||
    path.isAbsolute(file) ||
    file.split(/[\\/]/).includes("..")
  )
    throw new Error("Invalid repository file path");
  return path.join(dir, "raw", file);
}
function compiledRewrites(src, ctx) {
  const rules = [];
  for (const rule of options(src).rewrite || []) {
    try {
      rules.push({
        ...rule,
        pattern: new RegExp(rule.match),
        replacementPattern: rule.replace ? new RegExp(rule.replace[0]) : null,
      });
    } catch {
      const note = `source ${src.id}: invalid rewrite regex`;
      if (ctx.notes && !ctx.notes.includes(note)) ctx.notes.push(note);
    }
  }
  return rules;
}
function probeSignature(src, ctx) {
  const opts = options(src);
  const hash = createHash("sha256").update(JSON.stringify(opts));
  for (const file of [opts.file, opts.mediaBase?.fromFile].filter(Boolean)) {
    try {
      hash.update(fs.readFileSync(localFile(ctx.dir, file)));
    } catch {
      return null;
    }
  }
  return hash.digest("hex");
}
export function needsMediaProbe(src, ctx) {
  if (!options(src).probeMedia) return false;
  const signature = probeSignature(src, ctx);
  const previous = read(path.join(ctx.dir, "media-probe.json"));
  return Boolean(
    signature &&
    (previous?.signature !== signature || previous?.pending?.length),
  );
}
async function probeMedia(src, ctx, notes) {
  if (!needsMediaProbe(src, ctx)) return;
  const file = path.join(ctx.dir, "media-probe.json");
  const signature = probeSignature(src, ctx);
  const previous = read(file) || {};
  const entries = load(src, { ...ctx, notes, ignoreDeadMedia: true });
  const urls = [
    ...new Set(entries.flatMap((e) => [...e.videos, ...e.sourceMedia])),
  ].slice(0, 600);
  const dead = new Set(previous.dead || []);
  const sameVersion = previous.signature === signature;
  const pending = new Set(sameVersion ? previous.pending || [] : urls);
  const queue = urls.filter((url) => pending.has(url));
  let cursor = 0;
  const fetchImpl = ctx.fetchImpl || defaultFetch(ctx.env);
  await Promise.all(
    Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (cursor < queue.length && !ctx.signal?.aborted) {
        const url = queue[cursor++];
        const controller = new AbortController();
        const abort = () => controller.abort();
        ctx.signal?.addEventListener("abort", abort, { once: true });
        let timer;
        try {
          const response = await Promise.race([
            fetchImpl(url, { method: "HEAD", signal: controller.signal }),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error("media probe timeout"));
              }, ctx.probeTimeoutMs ?? 5000);
            }),
          ]);
          if ([403, 404, 410].includes(response.status)) {
            dead.add(url);
            pending.delete(url);
          } else if (response.status >= 200 && response.status < 300) {
            dead.delete(url);
            pending.delete(url);
          }
          await response.body?.cancel();
        } catch {
          /* Preserve confirmed results; retry only this unresolved URL. */
        } finally {
          clearTimeout(timer);
          ctx.signal?.removeEventListener("abort", abort);
        }
      }
    }),
  );
  if (pending.size)
    notes.push(
      `source ${src.id}: media probe incomplete; preserving confirmed dead URLs; ${pending.size} pending`,
    );
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporary,
    JSON.stringify({
      signature,
      dead: [...dead],
      pending: [...pending],
      checked: urls.length - pending.size,
    }),
  );
  fs.renameSync(temporary, file);
}

export async function sync(src, ctx) {
  const opts = options(src);
  const files = [
    opts.file,
    typeof opts.mediaBase === "object" ? opts.mediaBase.fromFile : null,
  ].filter(Boolean);
  const results = [];
  for (const file of files)
    results.push(
      await ctx.fetchCached(raw(src, file), localFile(ctx.dir, file)),
    );
  const notes = [];
  if (opts.probeMedia) {
    if (ctx.foreground) {
      if (needsMediaProbe(src, ctx))
        results.push({ status: "media-probe-pending" });
    } else await probeMedia(src, ctx, notes);
  }
  return { results, notes };
}
export function selectItems(root, expression = "") {
  if (!expression.includes("[]")) {
    const value = at(root, expression);
    return Array.isArray(value) ? value : [];
  }
  const split = expression.indexOf("[]");
  const before = expression.slice(0, split);
  const after = expression.slice(split + 2).replace(/^\./, "");
  const parents = at(root, before);
  if (!Array.isArray(parents)) return [];
  return parents.flatMap((parent) => {
    const children = after ? selectItems(parent, after) : [parent];
    return children
      .filter((v) => v && typeof v === "object")
      .map((v) => ({ ...v, $parent: parent }));
  });
}
function localized(value, locale) {
  if (Array.isArray(value))
    return value.flatMap((v) => localized(v, locale) ?? []);
  if (value && typeof value === "object")
    return localized(value[locale] ?? Object.values(value)[0], locale);
  return value;
}
function values(value) {
  return (Array.isArray(value) ? value.flat(Infinity) : [value]).filter(
    (v) => v != null && v !== "",
  );
}
function media(value, base) {
  return values(value).flatMap((v) => {
    if (typeof v !== "string") return [];
    try {
      const url = /^https?:\/\//i.test(v)
        ? new URL(v)
        : new URL(v.replace(/^\/+/, ""), `${base?.replace(/\/+$/, "")}/`);
      return url.protocol === "https:" || url.protocol === "http:"
        ? [url.href]
        : [];
    } catch {
      return [];
    }
  });
}
export function load(src, ctx) {
  const opts = options(src);
  const rewrites = compiledRewrites(src, ctx);
  const probe =
    opts.probeMedia && !ctx.ignoreDeadMedia
      ? read(path.join(ctx.dir, "media-probe.json"))
      : null;
  const dead = new Set(probe?.dead || []);
  let root;
  try {
    root = read(localFile(ctx.dir, opts.file));
  } catch {
    return [];
  }
  let base = opts.mediaBase;
  if (base && typeof base === "object") {
    try {
      base = at(read(localFile(ctx.dir, base.fromFile)), base.path);
    } catch {
      base = null;
    }
  }
  const filters = Array.isArray(opts.filter)
    ? opts.filter
    : opts.filter
      ? [opts.filter]
      : [];
  const entries = [];
  for (const item of selectItems(root, opts.itemsPath)) {
    if (!item || typeof item !== "object") continue;
    try {
      if (
        !filters.every((filter) => {
          const value = at(item, filter.field);
          return (
            (!("equals" in filter) || value === filter.equals) &&
            (!filter.nonEmpty ||
              (typeof value === "string"
                ? value.trim().length > 0
                : Boolean(value?.length))) &&
            (!("notEquals" in filter) || value !== filter.notEquals)
          );
        })
      )
        continue;
      const entry = {};
      for (const [field, mapping] of Object.entries(opts.map || {})) {
        const mapped = Array.isArray(mapping)
          ? mapping.flatMap((key) =>
              values(localized(at(item, key), opts.locale || "en")),
            )
          : localized(at(item, mapping), opts.locale || "en");
        entry[field] =
          Array.isArray(mapping) &&
          !["tags", "sourceMedia", "videos"].includes(field)
            ? mapped.find((v) => v !== "")
            : mapped;
      }
      for (const field of [
        "title",
        "description",
        "content",
        "model",
        "author",
        "category",
        "link",
        "ratio",
        "mode",
      ]) {
        if (Array.isArray(entry[field]))
          entry[field] = entry[field].filter(Boolean).join(", ");
      }
      entry.content = typeof entry.content === "string" ? entry.content : "";
      entry.title = typeof entry.title === "string" ? entry.title : "";
      entry.nativeId =
        at(item, opts.nativeIdFrom || "id") ??
        entry.nativeId ??
        createHash("sha256")
          .update(`${entry.title}\n${entry.content}`)
          .digest("hex")
          .slice(0, 16);
      entry.kind = entry.kind || opts.kind || src.kinds?.[0];
      entry.model ||= opts.modelDefault || null;
      entry.lang ||= opts.langDefault || opts.locale || item.lang || null;
      entry.mode ||= opts.modeDefault || opts.mode || null;
      entry.tags = values(entry.tags).map(String);
      if (/nsfw/i.test([entry.category, ...entry.tags].join(" "))) continue;
      if (opts.mediaTemplate && !entry.sourceMedia)
        entry.sourceMedia = opts.mediaTemplate.replace(
          /\{([^}]+)\}/g,
          (_, key) => encodeURIComponent(at(item, key) || ""),
        );
      entry.sourceMedia = media(entry.sourceMedia, base);
      entry.videos = media(entry.videos, base);
      // Rules relocate only the matching source URL, preserving unrelated media.
      const rewrittenUrls = new Set();
      for (const rule of rewrites) {
        if (!["videos", "sourceMedia", "drop"].includes(rule.to)) continue;
        const pattern = rule.pattern;
        for (const url of media(
          localized(at(item, rule.field), opts.locale || "en"),
          base,
        )) {
          if (rewrittenUrls.has(url) || !pattern.test(url)) continue;
          rewrittenUrls.add(url);
          entry.sourceMedia = entry.sourceMedia.filter(
            (value) => value !== url,
          );
          entry.videos = entry.videos.filter((value) => value !== url);
          if (rule.to !== "drop") {
            const rewritten = rule.replace
              ? url.replace(rule.replacementPattern, rule.replace[1])
              : url;
            entry[rule.to].push(...media(rewritten, base));
          }
        }
      }
      if (entry.link && opts.linkBase && !/^https?:\/\//i.test(entry.link))
        entry.link = new URL(entry.link, opts.linkBase).href;
      const references = opts.referenceField
        ? at(item, opts.referenceField)
        : null;
      if (Array.isArray(references)) entry.referenceInputs = references.length;
      entry.needReferenceImages = Array.isArray(entry.needReferenceImages)
        ? entry.needReferenceImages.length > 0
        : Boolean(entry.needReferenceImages);
      entry.sourceMedia = entry.sourceMedia.filter((url) => !dead.has(url));
      entry.videos = entry.videos.filter((url) => !dead.has(url));
      entries.push(entry);
    } catch {
      /* A malformed row must not discard the source. */
    }
  }
  return entries;
}
