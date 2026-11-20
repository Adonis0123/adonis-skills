import { describe, expect, it } from "vitest";
import { resolveCatalogView } from "./use-catalog-filters";

describe("resolveCatalogView", () => {
  it("renders the compact list before hydration, whatever is stored", () => {
    expect(resolveCatalogView(false, "grid")).toBe("list");
    expect(resolveCatalogView(false, undefined)).toBe("list");
  });

  it("uses the stored layout after hydration", () => {
    expect(resolveCatalogView(true, "grid")).toBe("grid");
    expect(resolveCatalogView(true, "list")).toBe("list");
  });

  it("falls back to the list for a missing or unknown stored value", () => {
    expect(resolveCatalogView(true, undefined)).toBe("list");
    expect(resolveCatalogView(true, "table")).toBe("list");
  });
});
