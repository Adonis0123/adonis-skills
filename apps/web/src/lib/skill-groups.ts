import type {
  CatalogGroup,
  CatalogLayout,
  FeaturedEntry,
  LocalizedText,
  SkillListItem,
} from "@/lib/skill-schema";
import type { AppLocale } from "@/i18n/config";

export interface SkillGroupView {
  group: CatalogGroup;
  /** 1-based position of the group in the full catalog, stable while searching. */
  number: number;
  skills: SkillListItem[];
}

export interface FeaturedSkillView {
  entry: FeaturedEntry;
  skill: SkillListItem;
}

export function localize(text: LocalizedText, locale: AppLocale): string {
  return text[locale];
}

/**
 * Buckets skills into Scenario Groups in catalog order. Within a group,
 * Featured Skills come first (in featured order); the rest keep the incoming
 * order, so search ranking survives. Groups with no skills are dropped, which
 * hides empty groups while a search is active.
 */
export function groupSkills(
  skills: readonly SkillListItem[],
  layout: Pick<CatalogLayout, "groups" | "featured">,
): SkillGroupView[] {
  const featuredRank = new Map(
    layout.featured.map((entry, index) => [entry.slug, index]),
  );
  const rank = (skill: SkillListItem) =>
    featuredRank.get(skill.slug) ?? Number.POSITIVE_INFINITY;

  return layout.groups.flatMap((group, index) => {
    const members = skills
      .map((skill, order) => ({ skill, order }))
      .filter(({ skill }) => skill.catalog.group === group.id)
      .sort((a, b) => rank(a.skill) - rank(b.skill) || a.order - b.order)
      .map(({ skill }) => skill);
    return members.length > 0
      ? [{ group, number: index + 1, skills: members }]
      : [];
  });
}

/** Featured entries joined with their skills, in featured order; unknown slugs are skipped. */
export function getFeaturedSkills(
  skills: readonly SkillListItem[],
  featured: readonly FeaturedEntry[],
): FeaturedSkillView[] {
  const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  return featured.flatMap((entry) => {
    const skill = bySlug.get(entry.slug);
    return skill ? [{ entry, skill }] : [];
  });
}

/** Skill count per group id, for chips; groups without matches are absent. */
export function countByGroup(
  skills: readonly SkillListItem[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const skill of skills)
    counts.set(skill.catalog.group, (counts.get(skill.catalog.group) ?? 0) + 1);
  return counts;
}
