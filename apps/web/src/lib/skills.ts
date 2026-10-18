import skillsCatalogLayoutData from "@/generated/skills-catalog-layout.json";
import skillsDetailData from "@/generated/skills-detail-index.json";
import skillsListData from "@/generated/skills-index-lite.json";

import type {
  CatalogGroup,
  CatalogLayout,
  FeaturedEntry,
  SkillDetailItem,
  SkillListItem,
} from "@/lib/skill-schema";

export type {
  CatalogGroup,
  CatalogLayout,
  FeaturedEntry,
  LocalizedText,
  SkillCatalogEntry,
  SkillDetailItem,
  SkillListItem,
  SkillSection,
  SkillShowcase,
  SkillShowcaseMessage,
  SkillShowcaseSection,
  SkillShowcaseToolCall,
  SkillTag,
} from "@/lib/skill-schema";

// The generator parses both files through skill-schema before writing them.
const skills = skillsListData as SkillListItem[];
const skillDetails = skillsDetailData as SkillDetailItem[];
const catalogLayout = skillsCatalogLayoutData as CatalogLayout;

export const skillsRepo =
  process.env.NEXT_PUBLIC_SKILLS_REPO || "adonis0123/adonis-skills";

function getUpdatedAtTime(skill: SkillListItem): number {
  if (!skill.updatedAt) return Number.NEGATIVE_INFINITY;

  const time = Date.parse(skill.updatedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function compareSkillsByUpdatedAtDesc(
  a: SkillListItem,
  b: SkillListItem,
): number {
  const timeDiff = getUpdatedAtTime(b) - getUpdatedAtTime(a);
  if (timeDiff !== 0) return timeDiff;

  return a.slug.localeCompare(b.slug);
}

export function getAllSkills(): SkillListItem[] {
  return [...skills].sort(compareSkillsByUpdatedAtDesc);
}

export function getSkillBySlug(slug: string): SkillListItem | null {
  return skills.find((skill) => skill.slug === slug) || null;
}

export function getSkillDetailBySlug(slug: string): SkillDetailItem | null {
  return skillDetails.find((skill) => skill.slug === slug) || null;
}

export function getSkillInstallCommand(slug: string): string {
  return `npx skills add ${skillsRepo} --skill ${slug}`;
}

export function getSkillSourceUrl(slug: string): string {
  return `https://github.com/${skillsRepo}/tree/main/skills/${slug}`;
}

/** Scenario Groups and Featured Skills, in page order. */
export function getCatalogLayout(): CatalogLayout {
  return catalogLayout;
}

export function getCatalogGroup(id: string): CatalogGroup | null {
  return catalogLayout.groups.find((group) => group.id === id) ?? null;
}

export function getFeaturedEntry(slug: string): FeaturedEntry | null {
  return catalogLayout.featured.find((entry) => entry.slug === slug) ?? null;
}

export function getIllustrationSrc(file: string): string {
  return `/brand/illustrations/${file}`;
}
