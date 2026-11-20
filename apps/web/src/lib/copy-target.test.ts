import { describe, expect, it } from "vitest";
import { shouldCopyOnClick } from "./copy-target";

const inBox = { id: "in" };
const outside = { id: "out" };
const box = { contains: (node: never) => node === (inBox as never) };

function selection(
  text: string,
  anchor: unknown,
  focus = anchor,
  collapsed = text === "",
) {
  return {
    isCollapsed: collapsed,
    anchorNode: anchor,
    focusNode: focus,
    toString: () => text,
  };
}

describe("shouldCopyOnClick", () => {
  it("copies when nothing is selected", () => {
    expect(shouldCopyOnClick(null, box)).toBe(true);
    expect(shouldCopyOnClick(selection("", inBox), box)).toBe(true);
  });

  it("keeps a text selection inside the box instead of copying", () => {
    expect(shouldCopyOnClick(selection("--skill commit", inBox), box)).toBe(
      false,
    );
    expect(
      shouldCopyOnClick(selection("npx skills", outside, inBox), box),
    ).toBe(false);
  });

  it("ignores a selection elsewhere on the page or one that is only whitespace", () => {
    expect(shouldCopyOnClick(selection("Skills", outside), box)).toBe(true);
    expect(shouldCopyOnClick(selection("  ", inBox, inBox, false), box)).toBe(
      true,
    );
  });

  it("never copies on the 2nd / 3rd click of a double / triple click", () => {
    expect(shouldCopyOnClick(null, box, 2)).toBe(false);
    expect(shouldCopyOnClick(null, box, 3)).toBe(false);
    expect(shouldCopyOnClick(null, box, 1)).toBe(true);
  });

  it("still copies on keyboard and programmatic clicks (detail 0)", () => {
    expect(shouldCopyOnClick(null, box, 0)).toBe(true);
  });
});
