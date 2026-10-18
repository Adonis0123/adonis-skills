import { describe, expect, it } from "vitest";
import { getEmptyResultCause, parseTagParam } from "./use-catalog-filters";

const tagOf = (search: string) => parseTagParam(new URLSearchParams(search));

describe("parseTagParam", () => {
  it("returns null when there is no tag or only unknown tags", () => {
    expect(tagOf("")).toBeNull();
    expect(tagOf("?tag=bogus")).toBeNull();
    expect(tagOf("?tag=")).toBeNull();
  });

  it("skips an unknown tag and keeps the next known one", () => {
    expect(tagOf("?tag=bogus&tag=git")).toBe("git");
  });

  it("keeps the first of two known tags", () => {
    expect(tagOf("?tag=code-review&tag=git")).toBe("code-review");
  });
});

describe("getEmptyResultCause", () => {
  it("blames the search word when no tag is selected", () => {
    expect(getEmptyResultCause("zzz", null)).toBe("query");
  });

  it("blames the tag when there is no search word", () => {
    expect(getEmptyResultCause("", "git")).toBe("tag");
    expect(getEmptyResultCause("   ", "git")).toBe("tag");
  });

  it("names both when a word and a tag are set", () => {
    expect(getEmptyResultCause("zzz", "git")).toBe("both");
  });

  it("returns null when nothing is filtering", () => {
    expect(getEmptyResultCause(" ", null)).toBeNull();
  });
});
