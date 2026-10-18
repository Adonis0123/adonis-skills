import { describe, expect, it } from "vitest";
import { findCatalogIssues, type SkillCatalogEntry } from "./skill-schema";

const entry: SkillCatalogEntry = {
  displayName: { en: "Commit Writer", zh: "写提交" },
  group: "git",
  tags: ["git"],
  summary: "Draft an emoji Conventional Commit message.",
  summary_zh: "生成带 emoji 的提交信息。",
  use_cases: [
    "Commit a focused change.",
    "Write a message without committing.",
  ],
  use_cases_zh: ["提交一组相关改动。", "只生成提交信息。"],
};

const group = {
  id: "git",
  title: { en: "Ship clean Git history", zh: "提交干净的 Git 历史" },
  summary: { en: "Commits and branches.", zh: "提交和分支。" },
  illustration: "group-git.webp",
};

const featured = {
  slug: "commit",
  badge: { en: "Daily driver", zh: "每天都用" },
  highlights: [
    { en: "Checks for secrets.", zh: "检查密钥。" },
    { en: "Writes the message.", zh: "写好提交信息。" },
  ],
  illustration: "featured-commit.webp",
};

const entryWithout = (key: keyof SkillCatalogEntry) =>
  Object.fromEntries(Object.entries(entry).filter(([field]) => field !== key));

const catalogWith = (
  skills: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({ groups: [group], featured: [featured], skills, ...extra });

describe("findCatalogIssues", () => {
  it("accepts a catalog that covers every slug", () => {
    expect(
      findCatalogIssues(["commit"], catalogWith({ commit: entry })),
    ).toEqual([]);
  });

  it("reports a missing entry with the fields to add", () => {
    const [issue] = findCatalogIssues(
      ["commit", "branch-creator"],
      catalogWith({ commit: entry }),
    );
    expect(issue).toContain("[branch-creator]");
    expect(issue).toContain("缺少条目");
    expect(issue).toContain("displayName");
    expect(issue).toContain("summary_zh");
  });

  it("reports an entry without a matching skill directory", () => {
    const issues = findCatalogIssues(
      ["branch-creator"],
      catalogWith({ commit: entry, "branch-creator": entry }),
      {},
    );
    expect(
      issues.some((issue) => issue.includes("skills/commit/ 不存在")),
    ).toBe(true);
  });

  it("lists the allowed tags when a tag is outside the vocabulary", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith({ commit: { ...entry, tags: ["git", "devops"] } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("tags[1]");
    expect(issues[0]).toContain("可用标签：agent-workflow");
  });

  it("rejects too many tags, empty summaries, and unknown fields", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith({
        commit: {
          ...entry,
          tags: ["git", "frontend", "architecture", "code-review"],
          summary: "  ",
          extra: true,
        },
      }),
    );
    expect(issues.some((issue) => issue.includes(" tags："))).toBe(true);
    expect(issues.some((issue) => issue.includes(" summary："))).toBe(true);
    expect(issues.some((issue) => issue.includes("extra"))).toBe(true);
  });

  it("rejects a summary over the length limit", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith({ commit: { ...entry, summary_zh: "长".repeat(71) } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("summary_zh");
  });

  it("explains how to add a missing Display Name", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith({ commit: entryWithout("displayName") }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("[commit]");
    expect(issues[0]).toContain("displayName");
    expect(issues[0]).toContain("displayName: { en:");
  });

  it("explains how to add a missing group and lists the known ids", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith({ commit: entryWithout("group") }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("group");
    expect(issues[0]).toContain("可用分组：git");
  });

  it("rejects a group id that is not defined in groups", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith({ commit: { ...entry, group: "devops" } }),
    );
    expect(issues.some((issue) => issue.includes("未知分组 `devops`"))).toBe(
      true,
    );
    expect(issues.some((issue) => issue.includes("可用分组：git"))).toBe(true);
  });

  it("rejects a featured slug that is not a public skill", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith(
        { commit: entry },
        { featured: [{ ...featured, slug: "ghost" }] },
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("featured[0]");
    expect(issues[0]).toContain("`ghost` 不是 skills/ 下的 public skill");
  });

  it("rejects duplicate group ids, duplicate featured slugs, and more than 3 featured", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith(
        { commit: entry },
        {
          groups: [group, group],
          featured: [featured, featured, featured, featured],
        },
      ),
    );
    expect(issues.some((issue) => issue.includes("`git` 重复"))).toBe(true);
    expect(issues.some((issue) => issue.includes("出现了多次"))).toBe(true);
    expect(issues.some((issue) => issue.includes("最多 3 个"))).toBe(true);
  });

  it("reports a group that no skill uses", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith(
        { commit: entry },
        { groups: [group, { ...group, id: "docs" }] },
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("`docs` 没有任何 skill");
  });

  it("checks that referenced illustrations exist when a file list is given", () => {
    const issues = findCatalogIssues(
      ["commit"],
      catalogWith({ commit: entry }),
      { illustrations: ["group-git.webp"] },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("featured-commit.webp 不存在");
  });

  it("requires groups, featured, and skills at the top level", () => {
    expect(findCatalogIssues(["commit"], { commit: entry })[0]).toContain(
      "groups、featured、skills",
    );
    expect(findCatalogIssues(["commit"], null)).toHaveLength(1);
    const missingLists = findCatalogIssues(["commit"], {
      skills: { commit: entry },
    });
    expect(missingLists.some((issue) => issue.includes("缺少 groups"))).toBe(
      true,
    );
    expect(missingLists.some((issue) => issue.includes("缺少 featured"))).toBe(
      true,
    );
  });
});
