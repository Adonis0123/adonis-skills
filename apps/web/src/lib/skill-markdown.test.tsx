import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  headingSlug,
  renderSectionContent,
  withHeadingIds,
} from "./skill-markdown";

const pageParams = vi.hoisted(() => ({
  current: {} as Record<string, string>,
}));
vi.mock("next/navigation", () => ({ useParams: () => pageParams.current }));

beforeEach(() => {
  pageParams.current = {};
});

function render(raw: string): string {
  return renderToStaticMarkup(<>{renderSectionContent(raw)}</>);
}

describe("renderSectionContent", () => {
  it("renders emphasis and inline code without exposing markdown markers", () => {
    const html = render(
      "**Audit contract** keeps `UNVERIFIED` evidence honest.",
    );

    expect(html).toContain("<strong>Audit contract</strong>");
    expect(html).toContain("<code");
    expect(html).toContain("UNVERIFIED</code>");
    expect(html).not.toContain("**Audit contract**");
  });

  it("renders a valid markdown table as semantic table markup", () => {
    const html = render(
      [
        "| Field | Value |",
        "| --- | --- |",
        "| Coverage | 16/16 |",
        "| Status | `VERIFIED` |",
      ].join("\n"),
    );

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Coverage");
    expect(html).toContain("16/16");
    expect(html).toContain("VERIFIED</code>");
    expect(html).not.toContain("| --- |");
  });

  it("keeps malformed pipe content readable instead of inventing a table", () => {
    const html = render("| not | a table |\n| missing | delimiter row |");

    expect(html).toContain("| not | a table |");
    expect(html).not.toContain("<table");
  });
});

describe("renderSectionContent with standard markdown", () => {
  it("renders underscore emphasis, links, and fenced code", () => {
    const html = render(
      "Decide _what kind_ of work.\n\nSee [docs](https://example.com).\n\n```bash\npnpm test\n```",
    );
    expect(html).toContain("<em>what kind</em>");
    expect(html).not.toContain("_what kind_");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('class="language-bash"');
  });
});

describe("headingSlug", () => {
  it("builds stable ids for English, Chinese, and punctuation-only headings", () => {
    expect(headingSlug("Step 0 — know what you can dispatch to")).toBe(
      "step-0-know-what-you-can-dispatch-to",
    );
    expect(headingSlug("`ocr` Review 流程")).toBe("ocr-review-流程");
    expect(headingSlug("—")).toBe("section");
  });
});

describe("withHeadingIds", () => {
  it("suffixes repeats and skips ids reserved by the page", () => {
    const ids = withHeadingIds(
      [
        { heading: "Install" },
        { heading: "Usage" },
        { heading: "Usage" },
        { content: "intro" },
      ],
      ["install"],
    ).map((s) => ("id" in s ? s.id : undefined));
    expect(ids).toEqual(["install-2", "usage", "usage-2", undefined]);
  });
});

describe("inline code wrapping", () => {
  it("keeps short inline code on one line and lets long paths wrap", () => {
    const html = renderToStaticMarkup(
      <>
        {renderSectionContent(
          "Run `agent-dispatch` with `~/.config/agent-dispatch/accounts.json`.",
        )}
      </>,
    );
    const codes = [
      ...html.matchAll(/<code class="([^"]*)">([^<]*)<\/code>/g),
    ].map((m) => [m[2], m[1].includes("whitespace-nowrap")]);
    expect(codes).toEqual([
      ["agent-dispatch", true],
      ["~/.config/agent-dispatch/accounts.json", false],
    ]);
  });
});

describe("SKILL.md links on a skill page", () => {
  it("rewrites relative links so they do not 404 on the site", () => {
    pageParams.current = {
      lang: "zh",
      slug: "installed-app-feature-inventory",
    };
    const html = render(
      [
        "See [Jianying](references/jianying-pro-macos.md),",
        "[file tidy](../file-tidy/SKILL.md),",
        "[usage](#usage) and [docs](https://example.com).",
      ].join(" "),
    );

    expect(html).toContain(
      'href="https://github.com/adonis0123/adonis-skills/blob/main/skills/installed-app-feature-inventory/references/jianying-pro-macos.md" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain('href="/zh/skills/file-tidy"');
    expect(html).toContain('href="#usage"');
    expect(html).toContain(
      'href="https://example.com" target="_blank" rel="noopener noreferrer"',
    );
  });

  it("links to the GitHub file when the other skill has no page", () => {
    pageParams.current = { lang: "en", slug: "commit" };
    const html = render("[draft](../not-a-public-skill/SKILL.md)");
    expect(html).toContain(
      'href="https://github.com/adonis0123/adonis-skills/blob/main/skills/not-a-public-skill/SKILL.md"',
    );
  });

  it("serves relative images from raw GitHub", () => {
    pageParams.current = { lang: "en", slug: "commit" };
    expect(render("![flow](assets/flow.png)")).toContain(
      'src="https://raw.githubusercontent.com/adonis0123/adonis-skills/main/skills/commit/assets/flow.png"',
    );
  });
});
