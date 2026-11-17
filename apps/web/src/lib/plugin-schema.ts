import { z } from "zod";

// Data contract shared with coco-skills (docs: plugin-index "数据契约").
// Relative imports only: scripts/generate-plugins-index.mjs loads this file with Node.

/** Marketplace `category` values, in page order. */
export const PLUGIN_CATEGORIES = [
  "safety",
  "unattended",
  "reply-quality",
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** Hosts a plugin ships a manifest for: `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`. */
export const PLUGIN_HOSTS = ["claude-code", "codex"] as const;
export type PluginHost = (typeof PLUGIN_HOSTS)[number];

/** When the plugin's hooks run, derived from `hooks/hooks.json`. */
export const PLUGIN_TRIGGERS = ["before-bash", "reply-end"] as const;
export type PluginTrigger = (typeof PLUGIN_TRIGGERS)[number];

/** Fixed `##` sections of a plugin README, in page order. */
export const PLUGIN_SECTION_KEYS = [
  "scenario",
  "whyUse",
  "whyBuilt",
  "howItWorks",
  "whatItBlocks",
  "whatAgentSees",
  "turningOff",
] as const;
export type PluginSectionKey = (typeof PLUGIN_SECTION_KEYS)[number];

/** Plugin names are lowercase hyphen-case, e.g. `delete-guard`; they are URL slugs and install ids. */
export const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const localizedText = z.object({ en: z.string(), zh: z.string() });
const sectionMap = z.partialRecord(z.enum(PLUGIN_SECTION_KEYS), z.string());

export const pluginItemSchema = z.object({
  name: z
    .string()
    .regex(
      PLUGIN_NAME_PATTERN,
      "plugin name must be lowercase hyphen-case, e.g. delete-guard",
    ),
  /** Marketplace `description`. */
  description: z.string(),
  category: z.enum(PLUGIN_CATEGORIES).nullable(),
  tags: z.array(z.string()),
  hosts: z.array(z.enum(PLUGIN_HOSTS)),
  triggers: z.array(z.enum(PLUGIN_TRIGGERS)),
  /** Card line "effect": marketplace description (en); README.zh-CN.md lead sentence (zh). */
  effect: localizedText,
  /** Card line "scenario": first sentence of the Scenario section; "" when missing. */
  scenario: localizedText,
  sections: z.object({ en: sectionMap, zh: sectionMap }),
  /** Repository path of the plugin directory, e.g. `plugins/delete-guard`. */
  sourcePath: z.string(),
});
export type PluginItem = z.infer<typeof pluginItemSchema>;

export const pluginIndexSchema = z.object({
  /** Marketplace `name`; installs are addressed as `<plugin>@<marketplace>`. */
  marketplace: z.string(),
  plugins: z.array(pluginItemSchema),
});
export type PluginIndex = z.infer<typeof pluginIndexSchema>;

export const EMPTY_PLUGIN_INDEX: PluginIndex = { marketplace: "", plugins: [] };

export function isPluginCategory(value: unknown): value is PluginCategory {
  return (PLUGIN_CATEGORIES as readonly unknown[]).includes(value);
}

export interface PluginCategoryGroup<T> {
  /** `null` collects plugins without a known category; it always comes last. */
  category: PluginCategory | null;
  plugins: T[];
}

/** Groups plugins by category in PLUGIN_CATEGORIES order; empty groups are dropped. */
export function groupPluginsByCategory<T extends Pick<PluginItem, "category">>(
  plugins: readonly T[],
): PluginCategoryGroup<T>[] {
  const order: (PluginCategory | null)[] = [...PLUGIN_CATEGORIES, null];
  return order
    .map((category) => ({
      category,
      plugins: plugins.filter(
        (plugin) => (plugin.category ?? null) === category,
      ),
    }))
    .filter((group) => group.plugins.length > 0);
}
