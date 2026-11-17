import fs from "node:fs";
import path from "node:path";
import {
  PLUGIN_CATEGORIES,
  PLUGIN_NAME_PATTERN,
  PLUGIN_SECTION_KEYS,
  PLUGIN_TRIGGERS,
  type PluginCategory,
  type PluginHost,
  type PluginIndex,
  type PluginItem,
  type PluginSectionKey,
  type PluginTrigger,
  isPluginCategory,
  pluginIndexSchema,
} from "./plugin-schema.ts";

// Builds the plugin index from `.claude-plugin/marketplace.json` and `plugins/*`.
// Relative imports with extensions only: scripts/generate-plugins-index.mjs runs this with Node.

type Locale = "en" | "zh";

/** Fixed README `##` headings per locale (contract shared with coco-skills). */
export const README_HEADINGS: Record<
  Locale,
  Record<string, PluginSectionKey>
> = {
  zh: {
    遇到的场景: "scenario",
    为什么要用: "whyUse",
    为什么自己做: "whyBuilt",
    怎么做到的: "howItWorks",
    会拦什么: "whatItBlocks",
    "被拦下时 agent 会看到": "whatAgentSees",
    停用: "turningOff",
  },
  en: {
    scenario: "scenario",
    "why use it": "whyUse",
    "why we built it": "whyBuilt",
    "how it works": "howItWorks",
    "what it blocks": "whatItBlocks",
    "what the agent sees": "whatAgentSees",
    "turning it off": "turningOff",
  },
};

function normalizeHeading(text: string): string {
  return text
    .replace(/[:：]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export interface ReadmeParts {
  /** Text between the H1 and the first `##`, without the language switcher line. */
  lead: string;
  sections: Partial<Record<PluginSectionKey, string>>;
}

/**
 * Splits a README on `##` headings only (code fences are skipped, `###` stays in
 * the body) and keeps the sections whose heading is one of the fixed headings.
 */
export function parseReadme(markdown: string, locale: Locale): ReadmeParts {
  const headings = README_HEADINGS[locale];
  const sections: Partial<Record<PluginSectionKey, string>> = {};
  const leadLines: string[] = [];
  let current: PluginSectionKey | null = null;
  let inLead = true;
  let buffer: string[] = [];
  let openFence: string | null = null;
  let seenH1 = false;

  const flush = () => {
    if (current) {
      const body = buffer.join("\n").trim();
      if (body && !sections[current]) sections[current] = body;
    }
    buffer = [];
  };

  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const fence = line.match(FENCE);
    if (openFence) {
      if (
        fence &&
        fence[1][0] === openFence[0] &&
        fence[1].length >= openFence.length &&
        !fence[2].trim()
      )
        openFence = null;
    } else if (fence) {
      openFence = fence[1];
    } else {
      const heading = line.match(/^(#{1,2})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flush();
        if (heading[1] === "#") {
          // The first H1 starts the lead (anything above it, such as a language
          // switcher, is dropped); a later H1 ends it like any other heading.
          current = null;
          inLead = !seenH1;
          seenH1 = true;
          leadLines.length = inLead ? 0 : leadLines.length;
          continue;
        }
        inLead = false;
        current = headings[normalizeHeading(heading[2])] ?? null;
        continue;
      }
    }
    if (inLead) leadLines.push(line);
    else if (current) buffer.push(line);
  }
  flush();

  // Language switcher lines such as "[English](./README.md) | 中文" are not lead text.
  const lead = leadLines
    .filter((line) => !/\]\([^)]*README[^)]*\)/.test(line))
    .join("\n")
    .trim();
  return { lead, sections };
}

const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "cf", "approx"]);

/**
 * First sentence of the first paragraph. Ends at 。！？ (zh) or `.!?` followed by
 * whitespace (en); punctuation inside inline code and common abbreviations do not end it.
 */
export function firstSentence(markdown: string): string {
  const paragraph =
    markdown
      .trim()
      .split(/\n\s*\n/)
      .find(
        (block) => block.trim() && !FENCE.test(block.trim().split("\n")[0]),
      ) ?? "";
  const text = paragraph
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim())
    .join(" ")
    .trim();

  let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "`") inCode = !inCode;
    if (inCode) continue;
    if ("。！？".includes(char)) return text.slice(0, i + 1).trim();
    if (
      ".!?".includes(char) &&
      (i === text.length - 1 || /\s/.test(text[i + 1]))
    ) {
      if (char === ".") {
        const word = text.slice(0, i).split(/\s/).pop() ?? "";
        if (ABBREVIATIONS.has(word.toLowerCase().replace(/^\(/, ""))) continue;
      }
      return text.slice(0, i + 1).trim();
    }
  }
  return text;
}

/**
 * Card "effect" line. Drops the self-description that opens every plugin blurb
 * ("Hook plugin: …", "一个 … hook 插件。") so the line says what the plugin does.
 */
export function effectLine(text: string): string {
  const trimmed = text.trim();
  const english = trimmed.replace(/^hook plugin:\s*/i, "");
  if (english !== trimmed) {
    const sentence = firstSentence(english);
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }
  return firstSentence(
    trimmed.replace(/^一个[^。，]*?hook 插件[。，]\s*/i, ""),
  );
}

export interface HostManifests {
  claude: boolean;
  codex: boolean;
}

export function deriveHosts({ claude, codex }: HostManifests): PluginHost[] {
  const hosts: PluginHost[] = [];
  if (claude) hosts.push("claude-code");
  if (codex) hosts.push("codex");
  return hosts;
}

function matcherMatchesBash(matcher: unknown): boolean {
  if (
    matcher === undefined ||
    matcher === null ||
    matcher === "" ||
    matcher === "*"
  )
    return true;
  if (typeof matcher !== "string") return false;
  try {
    return new RegExp(`^(?:${matcher})$`).test("Bash");
  } catch {
    return matcher.split("|").some((part) => part.trim() === "Bash");
  }
}

/** `PreToolUse` matching Bash -> before-bash; `Stop` -> reply-end. Other events are ignored. */
export function deriveTriggers(hooksFile: unknown): PluginTrigger[] {
  const events =
    hooksFile && typeof hooksFile === "object" && "hooks" in hooksFile
      ? (hooksFile as { hooks: unknown }).hooks
      : null;
  if (!events || typeof events !== "object") return [];
  const found = new Set<PluginTrigger>();
  const map = events as Record<string, unknown>;
  const groups = (event: string) =>
    Array.isArray(map[event]) ? (map[event] as unknown[]) : [];

  if (
    groups("PreToolUse").some((group) =>
      matcherMatchesBash(
        group && typeof group === "object"
          ? (group as { matcher?: unknown }).matcher
          : undefined,
      ),
    )
  )
    found.add("before-bash");
  if (groups("Stop").length > 0) found.add("reply-end");
  return PLUGIN_TRIGGERS.filter((trigger) => found.has(trigger));
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const PLUGIN_SOURCE = /^\.\/plugins\/([^/]+)\/?$/;
/** The skills collection entry (`"source": "./"`) is not a plugin. */
const COLLECTION_SOURCE = /^\.\/?$/;

/** README sections every plugin must have; `whyBuilt` is optional (only delete-guard writes it). */
export const REQUIRED_SECTION_KEYS: readonly PluginSectionKey[] =
  PLUGIN_SECTION_KEYS.filter((key) => key !== "whyBuilt");

const README_FILES: Record<Locale, string> = {
  en: "README.md",
  zh: "README.zh-CN.md",
};

function headingFor(locale: Locale, key: PluginSectionKey): string {
  const heading = Object.entries(README_HEADINGS[locale]).find(
    ([, value]) => value === key,
  )?.[0];
  // English headings are stored lowercased for matching; print them as written in the README.
  return locale === "en" && heading
    ? heading.charAt(0).toUpperCase() + heading.slice(1)
    : (heading ?? key);
}

/** Thrown when the marketplace lists a plugin the site cannot index; `problems` has one line per issue. */
export class PluginIndexError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `plugin index has ${problems.length} problem(s):\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    this.name = "PluginIndexError";
    this.problems = problems;
  }
}

/**
 * Scans `<root>/.claude-plugin/marketplace.json` and the plugin directories it lists.
 * Only `./plugins/<name>` entries are plugins; the root collection entry (`./`) is skipped.
 * Without a marketplace file the index is empty. With one, every other entry must resolve to
 * an existing plugin folder with both READMEs carrying the required `##` headings; otherwise
 * this throws a PluginIndexError naming each plugin and the fix. A missing or unknown category
 * only warns (the plugin is listed as uncategorised).
 */
export function buildPluginIndex(
  root: string,
  warn: (message: string) => void = () => {},
): PluginIndex {
  const marketplaceFile = path.join(root, ".claude-plugin", "marketplace.json");
  if (!fs.existsSync(marketplaceFile)) {
    warn(`no marketplace at ${marketplaceFile}; plugin index is empty`);
    return { marketplace: "", plugins: [] };
  }
  const marketplace = readJson(marketplaceFile) as {
    name?: unknown;
    plugins?: unknown;
  };
  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const plugins: PluginItem[] = [];
  const problems: string[] = [];
  let pluginEntries = 0;

  entries.forEach((raw, position) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const source = typeof entry.source === "string" ? entry.source : "";
    if (COLLECTION_SOURCE.test(source)) return;
    pluginEntries += 1;
    const label =
      typeof entry.name === "string" && entry.name
        ? entry.name
        : `plugins[${position}]`;
    const match = source.match(PLUGIN_SOURCE);
    if (!match) {
      problems.push(
        `${label}: source ${JSON.stringify(entry.source ?? null)} is not "./plugins/<name>"; ` +
          "point it at the plugin folder under plugins/ in .claude-plugin/marketplace.json",
      );
      return;
    }
    const name =
      typeof entry.name === "string" && entry.name ? entry.name : match[1];
    if (!PLUGIN_NAME_PATTERN.test(name)) {
      problems.push(
        `${name}: name must be lowercase hyphen-case (e.g. delete-guard); rename it in .claude-plugin/marketplace.json`,
      );
      return;
    }
    const dir = path.join(root, "plugins", match[1]);
    if (!fs.existsSync(dir)) {
      problems.push(
        `${name}: source ${source} does not exist; fix the source in .claude-plugin/marketplace.json or add plugins/${match[1]}/`,
      );
      return;
    }

    const category = isPluginCategory(entry.category) ? entry.category : null;
    if (!category)
      warn(
        `${name}: missing or unknown category ${JSON.stringify(entry.category)}`,
      );
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const description =
      typeof entry.description === "string" ? entry.description.trim() : "";

    let triggers: PluginTrigger[] = [];
    const hooksFile = path.join(dir, "hooks", "hooks.json");
    if (fs.existsSync(hooksFile)) {
      try {
        triggers = deriveTriggers(readJson(hooksFile));
      } catch (error) {
        warn(`${name}: cannot parse hooks/hooks.json (${String(error)})`);
      }
    }

    const readmes = {} as Record<Locale, ReadmeParts>;
    let readmeOk = true;
    for (const locale of ["en", "zh"] as const) {
      const file = `plugins/${match[1]}/${README_FILES[locale]}`;
      const parts = parseReadme(readText(path.join(root, file)), locale);
      readmes[locale] = parts;
      const missing = REQUIRED_SECTION_KEYS.filter(
        (key) => !parts.sections[key],
      );
      if (missing.length > 0) {
        readmeOk = false;
        problems.push(
          `${name}: ${file} is missing or has an empty ## ${missing
            .map((key) => `"${headingFor(locale, key)}"`)
            .join(", ")}; add these headings with text under each`,
        );
      }
    }
    if (!readmeOk) return;
    const { en, zh } = readmes;

    plugins.push({
      name,
      description,
      category,
      tags,
      hosts: deriveHosts({
        claude: fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json")),
        codex: fs.existsSync(path.join(dir, ".codex-plugin", "plugin.json")),
      }),
      triggers,
      effect: {
        en: effectLine(description || en.lead),
        zh: effectLine(zh.lead) || effectLine(description),
      },
      scenario: {
        en: firstSentence(en.sections.scenario ?? ""),
        zh: firstSentence(zh.sections.scenario ?? ""),
      },
      sections: { en: en.sections, zh: zh.sections },
      sourcePath: `plugins/${match[1]}`,
    });
  });

  if (problems.length === 0 && plugins.length !== pluginEntries)
    problems.push(
      `marketplace lists ${pluginEntries} plugin(s) but ${plugins.length} were indexed; check .claude-plugin/marketplace.json`,
    );
  if (problems.length > 0) throw new PluginIndexError(problems);

  const rank = (category: PluginCategory | null) =>
    category ? PLUGIN_CATEGORIES.indexOf(category) : PLUGIN_CATEGORIES.length;
  plugins.sort(
    (a, b) =>
      rank(a.category) - rank(b.category) || a.name.localeCompare(b.name),
  );

  return pluginIndexSchema.parse({
    marketplace: typeof marketplace.name === "string" ? marketplace.name : "",
    plugins,
  });
}
