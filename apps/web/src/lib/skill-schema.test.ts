import { describe, expect, it } from "vitest";
import { findCatalogIssues, type SkillCatalogEntry } from "./skill-schema";

const entry: SkillCatalogEntry = {
  tags: ["git"],
  summary: "Draft an emoji Conventional Commit message.",
  summary_zh: "生成带 emoji 的提交信息。",
  use_cases: [
    "Commit a focused change.",
    "Write a message without committing.",
  ],
  use_cases_zh: ["提交一组相关改动。", "只生成提交信息。"],
};

describe("findCatalogIssues", () => {
  it("accepts a catalog that covers every slug", () => {
    expect(findCatalogIssues(["commit"], { commit: entry })).toEqual([]);
  });

  it("reports a missing entry with the fields to add", () => {
    const [issue] = findCatalogIssues(["commit", "branch-creator"], {
      commit: entry,
    });
    expect(issue).toContain("[branch-creator]");
    expect(issue).toContain("缺少条目");
    expect(issue).toContain("summary_zh");
  });

  it("reports an entry without a matching skill directory", () => {
    const issues = findCatalogIssues([], { commit: entry });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("skills/commit/ 不存在");
  });

  it("lists the allowed tags when a tag is outside the vocabulary", () => {
    const issues = findCatalogIssues(["commit"], {
      commit: { ...entry, tags: ["git", "devops"] },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("tags[1]");
    expect(issues[0]).toContain("可用标签：agent-workflow");
  });

  it("rejects too many tags, empty summaries, and unknown fields", () => {
    const issues = findCatalogIssues(["commit"], {
      commit: {
        ...entry,
        tags: ["git", "frontend", "architecture", "code-review"],
        summary: "  ",
        extra: true,
      },
    });
    expect(issues.some((issue) => issue.includes(" tags："))).toBe(true);
    expect(issues.some((issue) => issue.includes(" summary："))).toBe(true);
    expect(issues.some((issue) => issue.includes("extra"))).toBe(true);
  });

  it("rejects a summary over the length limit", () => {
    const issues = findCatalogIssues(["commit"], {
      commit: { ...entry, summary_zh: "长".repeat(71) },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("summary_zh");
  });

  it("rejects a catalog that is not a slug-keyed object", () => {
    expect(findCatalogIssues(["commit"], [entry])[0]).toContain(
      "必须是以 skill slug 为键的对象",
    );
    expect(findCatalogIssues(["commit"], null)).toHaveLength(1);
  });
});
