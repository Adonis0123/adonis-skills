import { SKILL_TAGS, type SkillTag } from "@/lib/skill-schema";
import type { TagLabels } from "@/lib/skill-search";
import type { AppLocale } from "@/i18n/config";

// Bilingual on purpose (not Lingui): search matches both languages on every
// locale, so a Chinese query works on the English page and vice versa.
export const SKILL_TAG_LABELS: Record<SkillTag, Record<AppLocale, string>> = {
  "agent-workflow": { en: "Agent workflow", zh: "多 agent 编排" },
  "code-review": { en: "Code review", zh: "代码审查" },
  git: { en: "Git", zh: "Git" },
  architecture: { en: "Architecture", zh: "架构" },
  "tool-setup": { en: "Tool setup", zh: "工具接入" },
  frontend: { en: "Frontend", zh: "前端" },
  "docs-and-ops": { en: "Docs & ops", zh: "文档与日常" },
};

export const SKILL_TAG_SEARCH_LABELS: TagLabels = SKILL_TAGS.reduce(
  (labels, tag) => ({ ...labels, [tag]: Object.values(SKILL_TAG_LABELS[tag]) }),
  {} as TagLabels,
);
