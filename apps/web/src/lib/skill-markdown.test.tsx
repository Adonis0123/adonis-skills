import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderSectionContent } from "./skill-markdown";

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

    expect(html).toContain("<pre");
    expect(html).not.toContain("<table");
  });
});
