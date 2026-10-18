#!/usr/bin/env node
/**
 * Design token rules for apps/web/src (see adonis-brand projects/skills/DESIGN.md).
 *
 * Components and page CSS use semantic color roles only. Hierarchy comes from
 * switching roles, never from transparency. The only exception is the shadow
 * formula in styles/shadcn-theme.css, which may mix --shadow-tint or
 * --highlight-tint with transparent.
 *
 * Usage: node scripts/check-design-tokens.mjs [rootDir]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCAN_DIR = "apps/web/src";
const SCAN_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const SHADOW_EXCEPTION_FILE = "styles/shadcn-theme.css";

/** Paths relative to apps/web/src that are generated or own raw color values. */
export function isExcluded(relPath) {
  const p = relPath.split(path.sep).join("/");
  if (p === "styles/brand-tokens.css" || p === "styles/theme-roles.css")
    return true;
  if (p.startsWith("styles/brand/")) return true;
  if (p === "lib/og-card.tsx") return true;
  if (/(^|\/)(locales|generated)\//.test(p)) return true;
  if (/\.test\.[^/]+$/.test(p)) return true;
  return false;
}

const COLOR_UTILITY = [
  "bg",
  "text",
  "border",
  "border-[xytrblse]",
  "ring",
  "ring-offset",
  "inset-ring",
  "outline",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "divide",
  "placeholder",
  "caret",
  "accent",
  "decoration",
  "shadow",
  "inset-shadow",
  "drop-shadow",
].join("|");

const PALETTE = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "taupe",
  "mauve",
  "mist",
  "olive",
].join("|");

// `hover:bg-accent/65`, `bg-[var(--x)]/50`, `ring-ring/[0.3]`.
const OPACITY_MODIFIER_RE = new RegExp(
  String.raw`(?<![\w-])((?:${COLOR_UTILITY})-([a-z][\w-]*|\[[^\]\s]+\]|\([^)\s]+\)))\/(\d+|\[[^\]\s]+\]|\([^)\s]+\))`,
  "g",
);
// Size and gradient utilities whose `/x` is line-height or interpolation, not opacity.
const NOT_A_COLOR =
  /^(?:text-(?:xs|sm|base|lg|[2-9]?xl)|bg-(?:linear|radial|conic)(?:-.*)?|shadow-(?:2xs|xs|sm|md|lg|xl|2xl|none|inner)|drop-shadow-(?:xs|sm|md|lg|xl|2xl|none))$/;

const PALETTE_RE = new RegExp(
  String.raw`(?<![\w-])(?:${COLOR_UTILITY})-(?:(?:${PALETTE})-\d{2,3}|black|white)(?![\w-])`,
  "g",
);
const HEX_RE =
  /(?<![\w&-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const FUNC_RE = /(?<![\w-])(rgba?|hsla?)\(/g;
const COLOR_MIX_RE = /color-mix\(/g;
const SHADOW_MIX_RE =
  /^in [a-z]+,\s*var\(--(?:shadow-tint|highlight-tint)\)\s*\d+(?:\.\d+)?%,\s*transparent$/;

function roleHint(utility) {
  const prefix = utility.replace(/-(?:[a-z][\w-]*|\[.*\]|\(.*\))$/, "");
  if (
    prefix === "bg" ||
    prefix === "from" ||
    prefix === "via" ||
    prefix === "to"
  ) {
    return "bg-muted / bg-background / bg-card / bg-accent，遮罩用 bg-overlay";
  }
  if (prefix.startsWith("border") || prefix === "divide")
    return "border-border / border-input / border-ring";
  if (
    prefix === "text" ||
    prefix === "placeholder" ||
    prefix === "caret" ||
    prefix === "decoration"
  ) {
    return "text-foreground / text-muted-foreground / text-link / text-accent-foreground";
  }
  if (
    prefix === "ring" ||
    prefix === "outline" ||
    prefix === "ring-offset" ||
    prefix === "inset-ring"
  ) {
    return `${prefix}-ring / ${prefix}-ring-halo`;
  }
  return "shadcn-theme.css 里的 --clay-shadow-* 阴影变量";
}

/** Return the text inside the parentheses that open at `openIndex`. */
function readParenArgs(content, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === "(") depth++;
    else if (content[i] === ")") {
      depth--;
      if (depth === 0) return content.slice(openIndex + 1, i);
    }
  }
  return content.slice(openIndex + 1);
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Check one file. `relPath` is relative to apps/web/src (posix or native separators).
 * Returns [{ line, problem, fix }].
 */
// Blanks out /* */ and // comments (keeping newlines so line numbers stay right); `://` in URLs is not a comment.
function blankComments(content) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return content
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:\\])\/\/[^\n]*/gm,
      (m, lead) => lead + blank(m.slice(lead.length)),
    );
}

export function checkContent(relPath, rawContent) {
  const content = blankComments(rawContent);
  const p = relPath.split(path.sep).join("/");
  const isCss = p.endsWith(".css");
  const violations = [];
  const add = (index, problem, fix) =>
    violations.push({ line: lineOf(content, index), problem, fix });

  for (const m of content.matchAll(COLOR_MIX_RE)) {
    const args = readParenArgs(content, m.index + m[0].length - 1)
      .replace(/\s+/g, " ")
      .trim();
    if (p === SHADOW_EXCEPTION_FILE && SHADOW_MIX_RE.test(args)) continue;
    add(
      m.index,
      `color-mix(${args})`,
      p === SHADOW_EXCEPTION_FILE
        ? "只有阴影公式可混色：color-mix(in oklab, var(--shadow-tint) N%, transparent) 或 var(--highlight-tint)"
        : "删掉混色，换成一个实色角色 var(--muted) / var(--card) / var(--accent) / var(--border)；遮罩用 var(--overlay)；阴影用 var(--clay-shadow-*)",
    );
  }

  for (const m of content.matchAll(HEX_RE)) {
    add(
      m.index,
      `颜色字面量 ${m[0]}`,
      "用语义角色 var(--foreground) 等或对应 Tailwind 类（bg-card、text-foreground）代替；新颜色先加进品牌仓库色阶",
    );
  }

  for (const m of content.matchAll(FUNC_RE)) {
    add(
      m.index,
      `颜色函数 ${m[1]}(...)`,
      "用语义角色 var(--...) 代替行内颜色；透明度改成换一个更浅或更深的角色",
    );
  }

  for (const m of content.matchAll(OPACITY_MODIFIER_RE)) {
    const [whole, utility] = m;
    if (NOT_A_COLOR.test(utility)) continue;
    // In CSS, `/` also divides values (e.g. `grid-area: a/b`); only flag inside @apply.
    if (isCss) {
      const lineStart = content.lastIndexOf("\n", m.index) + 1;
      if (!/@apply\b/.test(content.slice(lineStart, m.index))) continue;
    }
    add(
      m.index,
      `透明度修饰 ${whole}`,
      `用实色角色代替 ${whole}：${roleHint(utility)}`,
    );
  }

  for (const m of content.matchAll(PALETTE_RE)) {
    add(
      m.index,
      `Tailwind 调色板颜色 ${m[0]}`,
      "换成语义角色类：bg-card / bg-muted / text-foreground / text-muted-foreground / border-border / text-destructive",
    );
  }

  return violations.sort((a, b) => a.line - b.line);
}

function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const rel = path.relative(base, full);
    if (statSync(full).isDirectory()) {
      if (!isExcluded(`${rel}/`)) walk(full, base, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(name)) && !isExcluded(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** Scan apps/web/src under `repoRoot`. Returns [{ file, line, problem, fix }]. */
export function scan(repoRoot) {
  const srcDir = path.join(repoRoot, SCAN_DIR);
  const results = [];
  for (const rel of walk(srcDir, srcDir, []).sort()) {
    const content = readFileSync(path.join(srcDir, rel), "utf8");
    for (const v of checkContent(rel, content)) {
      results.push({
        file: path.posix.join(SCAN_DIR, rel.split(path.sep).join("/")),
        ...v,
      });
    }
  }
  return results;
}

export function formatViolation(v) {
  return `${v.file}:${v.line}  ${v.problem}  →  ${v.fix}`;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = path.resolve(
    process.argv[2] ??
      path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const results = scan(repoRoot);
  if (results.length === 0) {
    console.log(
      `design:check OK — ${SCAN_DIR} uses semantic color roles only.`,
    );
  } else {
    for (const v of results) console.error(formatViolation(v));
    console.error(
      `\n${results.length} design token violation(s). 规则见 adonis-brand projects/skills/DESIGN.md：层级靠换角色，不靠透明度。`,
    );
    process.exitCode = 1;
  }
}
