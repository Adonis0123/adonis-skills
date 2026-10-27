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
  "creative",
] as const;

export type SkillTag = (typeof SKILL_TAGS)[number];

export const CATALOG_FILE = "apps/web/content/skill-catalog.yaml";

const text = (max: number) => z.string().trim().min(1).max(max);
const localized = (enMax: number, zhMax: number) =>
  z.strictObject({ en: text(enMax), zh: text(zhMax) });
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const illustrationFile = z
  .string()
  .regex(
    /^[a-z0-9-]+\.webp$/,
    "must be a .webp file name such as group-git.webp",
  );

export const ILLUSTRATIONS_DIR = "apps/web/public/brand/illustrations";

export const skillCatalogEntrySchema = z.strictObject({
  displayName: localized(32, 16),
  group: z.string().regex(idPattern),
  tags: z.array(z.enum(SKILL_TAGS)).min(1).max(3),
  summary: text(140),
  summary_zh: text(70),
  use_cases: z.array(text(160)).min(2).max(3),
  use_cases_zh: z.array(text(80)).min(2).max(3),
});

export const catalogGroupSchema = z.strictObject({
  id: z.string().regex(idPattern),
  title: localized(40, 16),
  summary: localized(120, 50),
  illustration: illustrationFile,
});

export const featuredEntrySchema = z.strictObject({
  slug: z.string().regex(idPattern),
  badge: localized(16, 8),
  highlights: z.array(localized(100, 40)).length(2),
  illustration: illustrationFile,
});

/** Page-level catalog data: Scenario Groups and Featured Skills, both in page order. */
export const catalogLayoutSchema = z.object({
  groups: z.array(catalogGroupSchema).min(1),
  featured: z.array(featuredEntrySchema).min(1).max(3),
});

export type SkillCatalogEntry = z.infer<typeof skillCatalogEntrySchema>;
export type CatalogGroup = z.infer<typeof catalogGroupSchema>;
export type FeaturedEntry = z.infer<typeof featuredEntrySchema>;
export type CatalogLayout = z.infer<typeof catalogLayoutSchema>;
export type LocalizedText = SkillCatalogEntry["displayName"];

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

const FIELD_HINTS: Record<string, string> = {
  displayName:
    '；写成 `displayName: { en: "Commit Writer", zh: "写提交" }`，英文 Title Case',
  group: "；写成 `group: <分组 id>`，分组 id 见文件顶部的 groups",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function zodIssues(
  prefix: string,
  error: z.ZodError,
  hintFor: (path: ReadonlyArray<PropertyKey>, code: string) => string = () =>
    "",
): string[] {
  return error.issues.map((issue) => {
    const field = formatPath(issue.path) || "(entry)";
    return `${prefix} 的 ${field}：${issue.message}${hintFor(issue.path, issue.code)}`;
  });
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
}

export interface CatalogIssueOptions {
  /** File names in ILLUSTRATIONS_DIR; when given, referenced illustrations must exist. */
  illustrations?: readonly string[];
}

/**
 * Checks the catalog file against the public skill slugs. Every message names
 * the slug or list item, the field, and how to fix it, so CI output is actionable.
 */
export function findCatalogIssues(
  slugs: readonly string[],
  catalog: unknown,
  options: CatalogIssueOptions = {},
): string[] {
  if (!isRecord(catalog) || !isRecord(catalog.skills))
    return [
      `${CATALOG_FILE} 必须是含 groups、featured、skills 三个键的对象；skills 下以 skill slug 为键（例如 \`commit:\` 下写 displayName、group、tags、summary 等字段）`,
    ];

  const issues: string[] = [];
  const known = new Set(slugs);
  const illustrations = options.illustrations
    ? new Set(options.illustrations)
    : null;
  const checkIllustration = (where: string, file: unknown) => {
    if (illustrations && typeof file === "string" && !illustrations.has(file))
      issues.push(
        `${where} ${CATALOG_FILE} 的 illustration：${ILLUSTRATIONS_DIR}/${file} 不存在；先从 adonis-brand 复制插画，或改成已有文件名`,
      );
  };

  for (const key of Object.keys(catalog)) {
    if (!["groups", "featured", "skills"].includes(key))
      issues.push(
        `${CATALOG_FILE} 有未知的顶层键 \`${key}\`：skill 条目要写在 skills: 下面`,
      );
  }

  // Scenario Groups
  const groupIds: string[] = [];
  if (!Array.isArray(catalog.groups) || catalog.groups.length === 0) {
    issues.push(
      `${CATALOG_FILE} 缺少 groups：按页面顺序列出场景分组，每项写 id、title {en, zh}、summary {en, zh}、illustration`,
    );
  } else {
    catalog.groups.forEach((group, index) => {
      const result = catalogGroupSchema.safeParse(group);
      if (result.success) {
        groupIds.push(result.data.id);
        checkIllustration(`[groups[${index}]]`, result.data.illustration);
      } else
        issues.push(
          ...zodIssues(`[groups[${index}]] ${CATALOG_FILE}`, result.error),
        );
    });
    for (const id of duplicates(groupIds))
      issues.push(
        `[groups] ${CATALOG_FILE} 的分组 id \`${id}\` 重复：每个分组 id 只能出现一次`,
      );
  }
  const knownGroups = new Set(groupIds);
  const groupHint = `；可用分组：${groupIds.join(", ") || "（先在 groups 里定义）"}`;

  // Featured Skills
  if (!Array.isArray(catalog.featured) || catalog.featured.length === 0) {
    issues.push(
      `${CATALOG_FILE} 缺少 featured：列出 1 到 3 个精选 skill，每项写 slug、badge {en, zh}、两条 highlights、illustration`,
    );
  } else {
    if (catalog.featured.length > 3)
      issues.push(
        `[featured] ${CATALOG_FILE} 最多 3 个精选 skill，现在有 ${catalog.featured.length} 个：删掉多出的`,
      );
    const featuredSlugs: string[] = [];
    catalog.featured.forEach((entry, index) => {
      const result = featuredEntrySchema.safeParse(entry);
      if (!result.success) {
        issues.push(
          ...zodIssues(`[featured[${index}]] ${CATALOG_FILE}`, result.error),
        );
        return;
      }
      featuredSlugs.push(result.data.slug);
      if (!known.has(result.data.slug))
        issues.push(
          `[featured[${index}]] ${CATALOG_FILE} 的 slug：\`${result.data.slug}\` 不是 skills/ 下的 public skill；改成已有的 slug，或删掉这一项`,
        );
      checkIllustration(`[featured[${index}]]`, result.data.illustration);
    });
    for (const slug of duplicates(featuredSlugs))
      issues.push(
        `[featured] ${CATALOG_FILE} 里 \`${slug}\` 出现了多次：每个 skill 只精选一次`,
      );
  }

  // Skill entries
  const entries = catalog.skills;
  const usedGroups = new Set<string>();
  let allEntriesValid = true;
  for (const slug of slugs) {
    if (!(slug in entries)) {
      issues.push(
        `[${slug}] ${CATALOG_FILE} 缺少条目：在 skills: 下添加 \`${slug}:\`，写上 displayName、group、tags、summary、summary_zh、use_cases、use_cases_zh`,
      );
      continue;
    }

    const result = skillCatalogEntrySchema.safeParse(entries[slug]);
    if (!result.success) {
      allEntriesValid = false;
      issues.push(
        ...zodIssues(
          `[${slug}] ${CATALOG_FILE}`,
          result.error,
          (path, code) => {
            const head = String(path[0]);
            if (head === "tags" && code === "invalid_value")
              return `；可用标签：${SKILL_TAGS.join(", ")}`;
            if (path.length === 1 && head in FIELD_HINTS)
              return head === "group"
                ? FIELD_HINTS.group + groupHint
                : FIELD_HINTS[head];
            return "";
          },
        ),
      );
      continue;
    }

    usedGroups.add(result.data.group);
    if (groupIds.length > 0 && !knownGroups.has(result.data.group))
      issues.push(
        `[${slug}] ${CATALOG_FILE} 的 group：未知分组 \`${result.data.group}\`${groupHint}`,
      );
  }

  for (const slug of Object.keys(entries)) {
    if (!known.has(slug))
      issues.push(
        `[${slug}] ${CATALOG_FILE} 有条目但 skills/${slug}/ 不存在：删掉该条目，或改成正确的 slug`,
      );
  }

  // Only meaningful once every entry parsed; otherwise a broken entry would look like an empty group.
  for (const id of allEntriesValid ? groupIds : []) {
    if (!usedGroups.has(id))
      issues.push(
        `[groups] ${CATALOG_FILE} 的分组 \`${id}\` 没有任何 skill：给某个 skill 写上 \`group: ${id}\`，或删掉这个分组`,
      );
  }

  return issues;
}
