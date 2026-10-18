import { describe, expect, it } from "vitest";
import {
  linkedSkillSlug,
  resolveSkillMarkdownHref,
  type SkillLinkContext,
} from "./skill-link";

const base: SkillLinkContext = {
  repo: "Adonis0123/adonis-skills",
  slug: "installed-app-feature-inventory",
  locale: "en",
  isPublicSkill: (slug) => slug === "file-tidy",
};
const blob = "https://github.com/Adonis0123/adonis-skills/blob/main/skills";
const tree = "https://github.com/Adonis0123/adonis-skills/tree/main/skills";

function resolve(
  href: string | undefined,
  extra: Partial<SkillLinkContext> = {},
) {
  return resolveSkillMarkdownHref(href, { ...base, ...extra });
}

describe("resolveSkillMarkdownHref", () => {
  it("sends relative file links to the file on GitHub", () => {
    expect(resolve("references/jianying-pro-macos.md")).toEqual({
      href: `${blob}/installed-app-feature-inventory/references/jianying-pro-macos.md`,
      external: true,
    });
    expect(resolve("./scripts/run.sh#L3").href).toBe(
      `${blob}/installed-app-feature-inventory/scripts/run.sh#L3`,
    );
  });

  it("uses tree URLs for directories", () => {
    expect(resolve("references/").href).toBe(
      `${tree}/installed-app-feature-inventory/references`,
    );
    expect(resolve("../file-tidy-workspace/skill-main").href).toBe(
      `${tree}/file-tidy-workspace/skill-main`,
    );
  });

  it("sends links to another public skill to its locale-aware page", () => {
    expect(resolve("../file-tidy/SKILL.md")).toEqual({
      href: "/skills/file-tidy",
      external: false,
    });
    expect(resolve("../file-tidy", { locale: "zh" }).href).toBe(
      "/zh/skills/file-tidy",
    );
    expect(resolve("./SKILL.md#usage").href).toBe(
      "/skills/installed-app-feature-inventory#usage",
    );
  });

  it("keeps non-public skills and paths outside skills/ on GitHub", () => {
    expect(resolve("../private-skill/SKILL.md").href).toBe(
      `${blob}/private-skill/SKILL.md`,
    );
    expect(resolve("../../docs/guide.md").href).toBe(
      "https://github.com/Adonis0123/adonis-skills/blob/main/docs/guide.md",
    );
  });

  it("leaves fragments, external URLs, other schemes and unresolvable paths alone", () => {
    expect(resolve("#install")).toEqual({ href: "#install", external: false });
    expect(resolve("https://example.com/x")).toEqual({
      href: "https://example.com/x",
      external: true,
    });
    expect(resolve("mailto:a@example.com").external).toBe(false);
    expect(resolve("../../../etc/passwd").href).toBe("../../../etc/passwd");
    expect(resolve("references/a.md", { slug: undefined }).href).toBe(
      "references/a.md",
    );
    expect(resolve(undefined).href).toBe("");
  });

  it("localizes site-absolute paths", () => {
    expect(resolve("/skills/commit", { locale: "zh" }).href).toBe(
      "/zh/skills/commit",
    );
  });

  it("serves images from raw.githubusercontent.com", () => {
    expect(resolve("assets/demo.png", { asset: true }).href).toBe(
      "https://raw.githubusercontent.com/Adonis0123/adonis-skills/main/skills/installed-app-feature-inventory/assets/demo.png",
    );
  });
});

describe("linkedSkillSlug", () => {
  it("finds the other skill a relative link points at", () => {
    expect(linkedSkillSlug("../file-tidy/SKILL.md")).toBe("file-tidy");
    expect(linkedSkillSlug("../../skills/commit")).toBe("commit");
    expect(linkedSkillSlug("references/a.md")).toBeUndefined();
    expect(linkedSkillSlug("https://example.com")).toBeUndefined();
    expect(linkedSkillSlug("#top")).toBeUndefined();
  });
});
