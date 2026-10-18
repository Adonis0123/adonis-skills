// Single source of truth for generated skill data. The index generator
// (scripts/generate-skills-index.mjs) and validator import this file directly
// through Node type stripping, so keep it to erasable TypeScript syntax.
import { z } from "zod";

export const SKILL_TAGS = [
  "agent-workflow",
  "code-review",
  "git",
  "architecture",
  "tool-setup",
  "frontend",
  "docs-and-ops",
] as const;

export type SkillTag = (typeof SKILL_TAGS)[number];

export const CATALOG_FILE = "apps/web/content/skill-catalog.yaml";

const text = (max: number) => z.string().trim().min(1).max(max);

export const skillCatalogEntrySchema = z.strictObject({
  tags: z.array(z.enum(SKILL_TAGS)).min(1).max(3),
  summary: text(140),
  summary_zh: text(70),
  use_cases: z.array(text(160)).min(2).max(3),
  use_cases_zh: z.array(text(80)).min(2).max(3),
});

export type SkillCatalogEntry = z.infer<typeof skillCatalogEntrySchema>;

export const skillSectionSchema = z.object({
  heading: z.string().optional(),
  level: z.number().int().min(1).max(3).optional(),
  raw: z.string(),
});

const showcaseToolCallSchema = z.object({
  name: z.string(),
  summary: z.string(),
  result: z.string(),
});

const showcaseMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolCalls: z.array(showcaseToolCallSchema).optional(),
});

export const skillShowcaseSchema = z.object({
  hero: z.object({
    title: z.string(),
    badge: z.string(),
    summary: z.string(),
    keyMoments: z.array(z.string()).min(1),
  }),
  sections: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        intro: z.string(),
        messages: z.array(showcaseMessageSchema).min(1),
      }),
    )
    .min(1),
});

export const skillListItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  metadata: z
    .object({
      author: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  files: z.object({
    hasReferences: z.boolean(),
    hasSrc: z.boolean(),
    hasScripts: z.boolean().optional(),
  }),
  updatedAt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  catalog: skillCatalogEntrySchema,
});

export const skillDetailItemSchema = z.object({
  slug: z.string(),
  sections: z.array(skillSectionSchema).optional(),
  showcase: skillShowcaseSchema.optional(),
});

export const skillListSchema = z.array(skillListItemSchema);
export const skillDetailListSchema = z.array(skillDetailItemSchema);

export type SkillSection = z.infer<typeof skillSectionSchema>;
export type SkillShowcase = z.infer<typeof skillShowcaseSchema>;
export type SkillShowcaseSection = SkillShowcase["sections"][number];
export type SkillShowcaseMessage = z.infer<typeof showcaseMessageSchema>;
export type SkillShowcaseToolCall = z.infer<typeof showcaseToolCallSchema>;
export type SkillListItem = z.infer<typeof skillListItemSchema>;
export type SkillDetailItem = z.infer<typeof skillDetailItemSchema>;

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`))
    .join("")
    .replace(/^\./, "");
}

/**
 * Checks the catalog file against the public skill slugs. Every message names
 * the slug, the field, and how to fix it, so CI output is actionable.
 */
export function findCatalogIssues(
  slugs: readonly string[],
  catalog: unknown,
): string[] {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog))
    return [
      `${CATALOG_FILE} 必须是以 skill slug 为键的对象（例如 \`commit:\` 下写 tags、summary 等字段）`,
    ];

  const entries = catalog as Record<string, unknown>;
  const issues: string[] = [];
  const known = new Set(slugs);

  for (const slug of slugs) {
    if (!(slug in entries)) {
      issues.push(
        `[${slug}] ${CATALOG_FILE} 缺少条目：添加 \`${slug}:\`，写上 tags、summary、summary_zh、use_cases、use_cases_zh`,
      );
      continue;
    }

    const result = skillCatalogEntrySchema.safeParse(entries[slug]);
    if (result.success) continue;

    for (const issue of result.error.issues) {
      const field = formatPath(issue.path) || "(entry)";
      const hint =
        issue.path[0] === "tags" && issue.code === "invalid_value"
          ? `；可用标签：${SKILL_TAGS.join(", ")}`
          : "";
      issues.push(
        `[${slug}] ${CATALOG_FILE} 的 ${field}：${issue.message}${hint}`,
      );
    }
  }

  for (const slug of Object.keys(entries)) {
    if (!known.has(slug))
      issues.push(
        `[${slug}] ${CATALOG_FILE} 有条目但 skills/${slug}/ 不存在：删掉该条目，或改成正确的 slug`,
      );
  }

  return issues;
}
