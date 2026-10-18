import { describe, expect, it } from "vitest";
import skillsListData from "@/generated/skills-index-lite.json";
import { SKILL_TAG_SEARCH_LABELS } from "@/config/skill-tags";
import type { SkillListItem } from "./skill-schema";
import { searchSkills, tokenizeQuery } from "./skill-search";

const skills = skillsListData as SkillListItem[];
const slugsFor = (query: string) =>
  searchSkills(skills, query, SKILL_TAG_SEARCH_LABELS).map(
    (skill) => skill.slug,
  );

describe("tokenizeQuery", () => {
  it("splits on spaces and punctuation and keeps CJK runs whole", () => {
    expect(tokenizeQuery("  Code-Review, git ")).toEqual([
      "code",
      "review",
      "git",
    ]);
    expect(tokenizeQuery("代码审查")).toEqual(["代码审查"]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });

  it("splits on full-width Chinese punctuation", () => {
    expect(tokenizeQuery("代码审查，架构")).toEqual(["代码审查", "架构"]);
    expect(tokenizeQuery("代码审查、修复")).toEqual(["代码审查", "修复"]);
    expect(tokenizeQuery("「周报」。《总结》　提交")).toEqual([
      "周报",
      "总结",
      "提交",
    ]);
  });
});

describe("searchSkills with Chinese punctuation", () => {
  it("finds a skill matching both words separated by 、 or ，", () => {
    expect(slugsFor("代码审查、修复")).toContain("agentic-review-handoff");
    expect(slugsFor("代码审查，修复")).toContain("agentic-review-handoff");
  });
});

describe("searchSkills", () => {
  it("returns every skill in order for an empty query", () => {
    expect(slugsFor("")).toEqual(skills.map((skill) => skill.slug));
  });

  it("matches multi-word English queries across fields", () => {
    const result = slugsFor("code review");
    expect(result).toContain("agentic-review-handoff");
    expect(result).toContain("open-code-review-loop");
  });

  it("matches Chinese queries through tag labels and Chinese summaries", () => {
    expect(slugsFor("代码审查")).toContain("agentic-review-handoff");
    expect(slugsFor("周报")).toContain("weekly-report");
  });

  it("matches the Display Name in either language", () => {
    expect(slugsFor("Agent Dispatcher")[0]).toBe("agent-dispatch");
    expect(slugsFor("多 Agent 调度")[0]).toBe("agent-dispatch");
  });

  it("ranks a name match above a description-only match", () => {
    expect(slugsFor("commit")[0]).toBe("commit");
  });

  it("tolerates one typo in longer Latin words", () => {
    expect(slugsFor("worktre")).toContain("worktree-tidy");
    expect(slugsFor("reveiw")).toContain("agentic-review-handoff");
  });

  it("requires every token to match", () => {
    expect(slugsFor("commit figma")).toEqual([]);
    expect(slugsFor("zzzz")).toEqual([]);
  });

  it("does not apply typo tolerance to short tokens", () => {
    expect(slugsFor("gti")).toEqual([]);
  });
});
