import type { AppLocale } from "@/i18n/config";
import {
  SKILL_TAGS,
  type CatalogLayout,
  type SkillListItem,
  type SkillTag,
} from "@/lib/skill-schema";
import { searchSkills, type TagLabels } from "@/lib/skill-search";

export const CATALOG_SORTS = ["group", "updated", "name"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
export const DEFAULT_CATALOG_SORT: CatalogSort = "group";

/** Filter state of the /skills page, mirrored in `?q=&group=&tag=&sort=`. */
export interface CatalogQuery {
  q: string;
  group: string | null;
  tags: SkillTag[];
  sort: CatalogSort;
}

export const EMPTY_CATALOG_QUERY: CatalogQuery = {
  q: "",
  group: null,
  tags: [],
  sort: DEFAULT_CATALOG_SORT,
};

function isSkillTag(value: string): value is SkillTag {
  return (SKILL_TAGS as readonly string[]).includes(value);
}

function isSort(value: string): value is CatalogSort {
  return (CATALOG_SORTS as readonly string[]).includes(value);
}

/**
 * Reads the catalog state from URL params. Unknown groups, tags, and sorts are
 * dropped so a stale or hand-edited link still renders something sensible.
 * Tags may repeat (`?tag=git&tag=frontend`) or be comma-separated.
 */
export function parseCatalogQuery(
  params: URLSearchParams,
  groupIds: readonly string[],
): CatalogQuery {
  const group = params.get("group");
  const sort = params.get("sort") ?? "";
  const tags = params
    .getAll("tag")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(isSkillTag);

  return {
    q: params.get("q") ?? "",
    group: group && groupIds.includes(group) ? group : null,
    tags: [...new Set(tags)],
    sort: isSort(sort) ? sort : DEFAULT_CATALOG_SORT,
  };
}

/** Canonical query string (`?q=…&group=…&tag=…&sort=…`), omitting defaults; "" when nothing is set. */
export function serializeCatalogQuery(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q);
  if (query.group) params.set("group", query.group);
  for (const tag of query.tags) params.append("tag", tag);
  if (query.sort !== DEFAULT_CATALOG_SORT) params.set("sort", query.sort);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function isCatalogQueryActive(query: CatalogQuery): boolean {
  return query.q.trim() !== "" || query.group !== null || query.tags.length > 0;
}

/** Skills matching search and tags (any selected tag), ignoring the group; drives sidebar counts. */
export function filterByQueryAndTags(
  skills: readonly SkillListItem[],
  query: Pick<CatalogQuery, "q" | "tags">,
  tagLabels: TagLabels,
): SkillListItem[] {
  const byTag =
    query.tags.length > 0
      ? skills.filter((skill) =>
          skill.catalog.tags.some((tag) => query.tags.includes(tag)),
        )
      : skills;
  return searchSkills(byTag, query.q, tagLabels);
}

function updatedTime(skill: SkillListItem): number {
  const time = skill.updatedAt ? Date.parse(skill.updatedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Orders skills for display. `group` keeps catalog group order with Featured
 * Skills first inside each group and the incoming (search-ranked) order
 * otherwise; `updated` is newest first; `name` is A–Z by the Display Name in
 * the current locale. Ties fall back to the slug.
 */
export function sortCatalogSkills(
  skills: readonly SkillListItem[],
  sort: CatalogSort,
  layout: Pick<CatalogLayout, "groups" | "featured">,
  locale: AppLocale,
): SkillListItem[] {
  const indexed = skills.map((skill, order) => ({ skill, order }));
  if (sort === "updated")
    return indexed
      .sort(
        (a, b) =>
          updatedTime(b.skill) - updatedTime(a.skill) ||
          a.skill.slug.localeCompare(b.skill.slug),
      )
      .map(({ skill }) => skill);

  if (sort === "name") {
    const collator = new Intl.Collator(locale === "zh" ? "zh-CN" : "en");
    return indexed
      .sort(
        (a, b) =>
          collator.compare(
            a.skill.catalog.displayName[locale],
            b.skill.catalog.displayName[locale],
          ) || a.skill.slug.localeCompare(b.skill.slug),
      )
      .map(({ skill }) => skill);
  }

  const groupRank = new Map(layout.groups.map((group, i) => [group.id, i]));
  const featuredRank = new Map(
    layout.featured.map((entry, i) => [entry.slug, i]),
  );
  const rank = (map: Map<string, number>, key: string) =>
    map.get(key) ?? Number.POSITIVE_INFINITY;
  return indexed
    .sort(
      (a, b) =>
        rank(groupRank, a.skill.catalog.group) -
          rank(groupRank, b.skill.catalog.group) ||
        rank(featuredRank, a.skill.slug) - rank(featuredRank, b.skill.slug) ||
        a.order - b.order,
    )
    .map(({ skill }) => skill);
}

/** Full pipeline for the results list: search + tags, then group, then sort. */
export function applyCatalogQuery(
  skills: readonly SkillListItem[],
  query: CatalogQuery,
  layout: Pick<CatalogLayout, "groups" | "featured">,
  tagLabels: TagLabels,
  locale: AppLocale,
): SkillListItem[] {
  const matched = filterByQueryAndTags(skills, query, tagLabels);
  const inGroup = query.group
    ? matched.filter((skill) => skill.catalog.group === query.group)
    : matched;
  return sortCatalogSkills(inGroup, query.sort, layout, locale);
}
