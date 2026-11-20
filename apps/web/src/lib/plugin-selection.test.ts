import { describe, expect, it } from "vitest";
import {
  addedNames,
  applySelectAll,
  getSelectAllState,
  togglePluginSelection,
} from "./plugin-selection";

const catalog = [
  "delete-guard",
  "bash-prompt-guard",
  "reply-language",
  "completion-claim-check",
];

describe("togglePluginSelection", () => {
  it("adds a plugin in catalog order, not click order", () => {
    expect(
      togglePluginSelection(["reply-language"], "delete-guard", catalog),
    ).toEqual(["delete-guard", "reply-language"]);
  });

  it("removes a ticked plugin", () => {
    expect(
      togglePluginSelection(
        ["delete-guard", "reply-language"],
        "delete-guard",
        catalog,
      ),
    ).toEqual(["reply-language"]);
  });

  it("ignores names the catalog does not have", () => {
    expect(togglePluginSelection(["gone"], "delete-guard", catalog)).toEqual([
      "delete-guard",
    ]);
  });
});

describe("getSelectAllState", () => {
  it("is none, some or all for the visible rows only", () => {
    const visible = ["delete-guard", "bash-prompt-guard"];
    expect(getSelectAllState([], visible)).toBe("none");
    expect(getSelectAllState(["reply-language"], visible)).toBe("none");
    expect(getSelectAllState(["delete-guard"], visible)).toBe("some");
    expect(
      getSelectAllState(["delete-guard", "bash-prompt-guard"], visible),
    ).toBe("all");
  });

  it("is none when the filter shows nothing", () => {
    expect(getSelectAllState(catalog, [])).toBe("none");
  });
});

describe("applySelectAll", () => {
  it("ticks every visible row from none or some, keeping hidden ticks", () => {
    expect(
      applySelectAll(
        ["reply-language"],
        ["bash-prompt-guard", "delete-guard"],
        catalog,
      ),
    ).toEqual(["delete-guard", "bash-prompt-guard", "reply-language"]);
    expect(
      applySelectAll(
        ["delete-guard"],
        ["delete-guard", "bash-prompt-guard"],
        catalog,
      ),
    ).toEqual(["delete-guard", "bash-prompt-guard"]);
  });

  it("unticks only the visible rows when all of them are ticked", () => {
    expect(
      applySelectAll(
        ["delete-guard", "bash-prompt-guard", "reply-language"],
        ["delete-guard", "bash-prompt-guard"],
        catalog,
      ),
    ).toEqual(["reply-language"]);
  });
});

describe("addedNames", () => {
  it("lists what a click added, never what it removed", () => {
    expect(
      addedNames(["delete-guard"], ["delete-guard", "reply-language"]),
    ).toEqual(["reply-language"]);
    expect(
      addedNames(["delete-guard", "reply-language"], ["reply-language"]),
    ).toEqual([]);
  });
});
