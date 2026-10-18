import { describe, expect, it } from "vitest";
import layoutData from "@/generated/skills-catalog-layout.json";
import skillsListData from "@/generated/skills-index-lite.json";
import type {
  CatalogLayout,
  SkillCatalogEntry,
  SkillListItem,
} from "./skill-schema";
import { countByGroup, getFeaturedSkills, groupSkills } from "./skill-groups";

const groupOf = (id: string, title = id) => ({
  id,
  title: { en: title, zh: title },
  summary: { en: `${title} summary`, zh: `${title} 说明` },
  illustration: `group-${id}.webp`,
});

const skillOf = (slug: string, group: string): SkillListItem => ({
  slug,
  name: slug,
  description: `${slug} description`,
  files: { hasReferences: false, hasSrc: false },
  catalog: {
    displayName: { en: slug, zh: slug },
    group,
    tags: ["git"],
    summary: "s",
    summary_zh: "s",
    use_cases: ["a", "b"],
    use_cases_zh: ["a", "b"],
  } satisfies SkillCatalogEntry,
});

const featuredOf = (slug: string) => ({
  slug,
  badge: { en: "Hot", zh: "热门" },
  highlights: [
    { en: "one", zh: "一" },
    { en: "two", zh: "二" },
  ],
  illustration: `featured-${slug}.webp`,
});

const layout = {
  groups: [groupOf("git"), groupOf("review"), groupOf("docs")],
  featured: [featuredOf("commit-push")],
};

describe("groupSkills", () => {
  it("keeps catalog group order and numbers groups by that order", () => {
    const views = groupSkills(
      [skillOf("weekly", "docs"), skillOf("commit", "git")],
      layout,
    );
    expect(views.map((view) => view.group.id)).toEqual(["git", "docs"]);
    expect(views.map((view) => view.number)).toEqual([1, 3]);
  });

  it("drops groups with no matching skills, e.g. while searching", () => {
    const views = groupSkills([skillOf("review-loop", "review")], layout);
    expect(views).toHaveLength(1);
    expect(views[0].group.id).toBe("review");
    expect(groupSkills([], layout)).toEqual([]);
  });

  it("puts Featured Skills first and keeps the incoming order for the rest", () => {
    const views = groupSkills(
      [
        skillOf("branch", "git"),
        skillOf("commit", "git"),
        skillOf("commit-push", "git"),
      ],
      layout,
    );
    expect(views[0].skills.map((skill) => skill.slug)).toEqual([
      "commit-push",
      "branch",
      "commit",
    ]);
  });
});

describe("getFeaturedSkills", () => {
  it("joins entries with skills in featured order and skips unknown slugs", () => {
    const featured = [featuredOf("b"), featuredOf("missing"), featuredOf("a")];
    const views = getFeaturedSkills(
      [skillOf("a", "git"), skillOf("b", "git")],
      featured,
    );
    expect(views.map((view) => view.skill.slug)).toEqual(["b", "a"]);
  });
});

describe("countByGroup", () => {
  it("counts skills per group id", () => {
    const counts = countByGroup([
      skillOf("a", "git"),
      skillOf("b", "git"),
      skillOf("c", "docs"),
    ]);
    expect(counts.get("git")).toBe(2);
    expect(counts.get("docs")).toBe(1);
    expect(counts.get("review")).toBeUndefined();
  });
});

describe("generated catalog", () => {
  const skills = skillsListData as SkillListItem[];
  const real = layoutData as CatalogLayout;

  it("places every public skill in exactly one rendered group", () => {
    const placed = groupSkills(skills, real).flatMap((view) =>
      view.skills.map((skill) => skill.slug),
    );
    expect([...placed].sort()).toEqual(
      skills.map((skill) => skill.slug).sort(),
    );
  });

  it("resolves every Featured Skill", () => {
    expect(getFeaturedSkills(skills, real.featured)).toHaveLength(
      real.featured.length,
    );
  });
});
