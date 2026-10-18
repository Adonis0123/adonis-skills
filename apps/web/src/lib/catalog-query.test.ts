import { describe, expect, it } from "vitest";
import { SKILL_TAG_SEARCH_LABELS } from "@/config/skill-tags";
import {
  applyCatalogQuery,
  EMPTY_CATALOG_QUERY,
  filterByQueryAndTags,
  isCatalogQueryActive,
  parseCatalogQuery,
  serializeCatalogQuery,
  sortCatalogSkills,
} from "./catalog-query";
import type { SkillListItem, SkillTag } from "./skill-schema";

const GROUPS = ["git", "review"];
const parse = (search: string) =>
  parseCatalogQuery(new URLSearchParams(search), GROUPS);

const skillOf = (
  slug: string,
  group: string,
  tags: SkillTag[],
  extra: { en?: string; zh?: string; updatedAt?: string } = {},
): SkillListItem => ({
  slug,
  name: slug,
  description: `${slug} description`,
  files: { hasReferences: false, hasSrc: false },
  ...(extra.updatedAt ? { updatedAt: extra.updatedAt } : {}),
  catalog: {
    displayName: { en: extra.en ?? slug, zh: extra.zh ?? slug },
    group,
    tags,
    summary: `${slug} summary`,
    summary_zh: `${slug} 摘要`,
    use_cases: ["a", "b"],
    use_cases_zh: ["甲", "乙"],
  },
});

const layout = {
  groups: GROUPS.map((id) => ({
    id,
    title: { en: id, zh: id },
    summary: { en: id, zh: id },
    illustration: `group-${id}.webp`,
  })),
  featured: [
    {
      slug: "commit-push",
      badge: { en: "Daily", zh: "每天" },
      highlights: [
        { en: "a", zh: "甲" },
        { en: "b", zh: "乙" },
      ],
      illustration: "featured-commit-push.webp",
    },
  ],
};

const skills = [
  skillOf("review-loop", "review", ["code-review"], {
    en: "Review Loop",
    zh: "审查循环",
    updatedAt: "2026-10-01T00:00:00Z",
  }),
  skillOf("commit", "git", ["git"], {
    en: "Commit Writer",
    zh: "写提交",
    updatedAt: "2026-09-01T00:00:00Z",
  }),
  skillOf("commit-push", "git", ["git", "code-review"], {
    en: "Commit & Push",
    zh: "提交并推送",
    updatedAt: "2026-10-10T00:00:00Z",
  }),
  skillOf("branch", "git", ["git", "frontend"], {
    en: "Branch Creator",
    zh: "建分支",
  }),
];

const slugs = (list: SkillListItem[]) => list.map((skill) => skill.slug);

describe("parseCatalogQuery", () => {
  it("returns defaults for an empty query string", () => {
    expect(parse("")).toEqual(EMPTY_CATALOG_QUERY);
  });

  it("reads q, group, repeated or comma-separated tags, and sort", () => {
    expect(
      parse("?q=review&group=git&tag=git&tag=frontend,code-review&sort=name"),
    ).toEqual({
      q: "review",
      group: "git",
      tags: ["git", "frontend", "code-review"],
      sort: "name",
    });
  });

  it("drops unknown groups, tags, and sorts and de-duplicates tags", () => {
    expect(parse("?group=devops&tag=bogus&tag=git&tag=git&sort=stars")).toEqual(
      { ...EMPTY_CATALOG_QUERY, tags: ["git"] },
    );
  });
});

describe("serializeCatalogQuery", () => {
  it("omits defaults and returns an empty string when nothing is set", () => {
    expect(serializeCatalogQuery(EMPTY_CATALOG_QUERY)).toBe("");
    expect(serializeCatalogQuery({ ...EMPTY_CATALOG_QUERY, q: "   " })).toBe(
      "",
    );
  });

  it("round-trips through parseCatalogQuery", () => {
    const query = {
      q: "代码 review",
      group: "review",
      tags: ["git", "frontend"] as SkillTag[],
      sort: "updated" as const,
    };
    const text = serializeCatalogQuery(query);
    expect(text).toBe(
      "?q=%E4%BB%A3%E7%A0%81+review&group=review&tag=git&tag=frontend&sort=updated",
    );
    expect(parse(text)).toEqual(query);
  });
});

describe("isCatalogQueryActive", () => {
  it("ignores sort but counts q, group, and tags", () => {
    expect(isCatalogQueryActive({ ...EMPTY_CATALOG_QUERY, sort: "name" })).toBe(
      false,
    );
    expect(isCatalogQueryActive({ ...EMPTY_CATALOG_QUERY, q: "x" })).toBe(true);
    expect(isCatalogQueryActive({ ...EMPTY_CATALOG_QUERY, group: "git" })).toBe(
      true,
    );
    expect(
      isCatalogQueryActive({ ...EMPTY_CATALOG_QUERY, tags: ["git"] }),
    ).toBe(true);
  });
});

describe("filterByQueryAndTags", () => {
  it("keeps skills carrying any selected tag", () => {
    expect(
      slugs(
        filterByQueryAndTags(
          skills,
          { q: "", tags: ["frontend", "code-review"] },
          SKILL_TAG_SEARCH_LABELS,
        ),
      ),
    ).toEqual(["review-loop", "commit-push", "branch"]);
  });

  it("matches Display Names in both languages", () => {
    const run = (q: string) =>
      slugs(
        filterByQueryAndTags(skills, { q, tags: [] }, SKILL_TAG_SEARCH_LABELS),
      );
    expect(run("Branch Creator")).toEqual(["branch"]);
    expect(run("写提交")).toEqual(["commit"]);
  });
});

describe("sortCatalogSkills", () => {
  it("sorts by group order with Featured Skills first in their group", () => {
    expect(slugs(sortCatalogSkills(skills, "group", layout, "en"))).toEqual([
      "commit-push",
      "commit",
      "branch",
      "review-loop",
    ]);
  });

  it("sorts by most recent update, undated skills last", () => {
    expect(slugs(sortCatalogSkills(skills, "updated", layout, "en"))).toEqual([
      "commit-push",
      "review-loop",
      "commit",
      "branch",
    ]);
  });

  it("sorts A–Z by the Display Name in the current locale", () => {
    expect(slugs(sortCatalogSkills(skills, "name", layout, "en"))).toEqual([
      "branch",
      "commit-push",
      "commit",
      "review-loop",
    ]);
    // Chinese collation orders by pinyin: jian, shen, ti, xie.
    expect(slugs(sortCatalogSkills(skills, "name", layout, "zh"))).toEqual([
      "branch",
      "review-loop",
      "commit-push",
      "commit",
    ]);
  });
});

describe("applyCatalogQuery", () => {
  it("narrows to one group after search and tags, then sorts", () => {
    const result = applyCatalogQuery(
      skills,
      { q: "", group: "git", tags: ["git"], sort: "name" },
      layout,
      SKILL_TAG_SEARCH_LABELS,
      "en",
    );
    expect(slugs(result)).toEqual(["branch", "commit-push", "commit"]);
  });

  it("returns nothing when no skill matches", () => {
    expect(
      applyCatalogQuery(
        skills,
        { ...EMPTY_CATALOG_QUERY, q: "zzzz" },
        layout,
        SKILL_TAG_SEARCH_LABELS,
        "en",
      ),
    ).toEqual([]);
  });
});
