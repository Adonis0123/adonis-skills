import { describe, expect, it } from "vitest";
import { resolveActiveTocId } from "./toc-nav";

const headings = [
  { id: "use-cases", top: 0 },
  { id: "install", top: 0 },
  { id: "step-0", top: 0 },
  { id: "step-1", top: 0 },
];

function at(...tops: number[]) {
  return headings.map((heading, index) => ({ ...heading, top: tops[index] }));
}

describe("resolveActiveTocId", () => {
  it("returns null for an empty list", () => {
    expect(resolveActiveTocId([], 120, false)).toBeNull();
    expect(resolveActiveTocId([], 120, true)).toBeNull();
  });

  it("picks the first heading while every heading is below the line", () => {
    expect(resolveActiveTocId(at(300, 700, 1200, 1800), 120, false)).toBe(
      "use-cases",
    );
  });

  it("picks the last heading that crossed the line, not the first visible one", () => {
    // Reading inside Step 0: its heading is above the line, Step 1 still below.
    expect(resolveActiveTocId(at(-900, -500, -40, 600), 120, false)).toBe(
      "step-0",
    );
  });

  it("counts a heading sitting exactly on the line as crossed", () => {
    expect(resolveActiveTocId(at(-400, 120, 500, 900), 120, false)).toBe(
      "install",
    );
  });

  it("picks the last heading at the page bottom even if it never reached the line", () => {
    expect(resolveActiveTocId(at(-1500, -1000, 200, 450), 120, true)).toBe(
      "step-1",
    );
  });
});
