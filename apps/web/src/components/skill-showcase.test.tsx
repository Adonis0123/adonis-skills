import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillShowcase } from "./skill-showcase";

describe("SkillShowcase", () => {
  it("renders a semantic, evidence-labeled workflow preview", () => {
    const html = renderToStaticMarkup(
      <SkillShowcase
        showcase={{
          hero: {
            title: "Audit in action",
            badge: "Synthetic demo",
            summary: "A safe preview.",
            keyMoments: ["Freeze the scope"],
          },
          sections: [
            {
              id: "baseline",
              title: "Capture a baseline",
              intro: "Start clean.",
              messages: [
                {
                  role: "assistant",
                  content: "**Measured carefully**",
                  toolCalls: [
                    {
                      name: "Chrome DevTools",
                      summary: "Capture a trace",
                      result: "Baseline recorded",
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(html).toContain('aria-labelledby="skill-showcase-title"');
    expect(html).toContain("Synthetic demo");
    expect(html).toContain("<strong>Measured carefully</strong>");
    expect(html).toContain("Chrome DevTools");
    expect(html).toContain("Baseline recorded");
  });
});
