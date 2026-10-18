import { describe, expect, it, vi } from "vitest";
import { buildLocaleCookie, buildLocaleSwitchHref } from "./locale-switcher";

// The Lingui macro is compiled away by SWC in Next; vitest runs uncompiled source.
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: () => "" }) }));
vi.mock("@/components/ui", () => ({}));

describe("buildLocaleSwitchHref", () => {
  it("drops the /zh prefix when switching to English", () => {
    expect(
      buildLocaleSwitchHref("/zh/skills/x", "?tab=a", "#install", "en"),
    ).toBe("/skills/x?tab=a#install");
    expect(buildLocaleSwitchHref("/zh", "", "", "en")).toBe("/");
  });

  it("adds the /zh prefix when switching to Chinese", () => {
    expect(buildLocaleSwitchHref("/skills/x", "?tab=a", "#install", "zh")).toBe(
      "/zh/skills/x?tab=a#install",
    );
    expect(buildLocaleSwitchHref("/", "", "", "zh")).toBe("/zh");
  });

  it("treats the internal /en path like the unprefixed one", () => {
    expect(buildLocaleSwitchHref("/en/skills/x", "", "", "zh")).toBe(
      "/zh/skills/x",
    );
  });
});

describe("buildLocaleCookie", () => {
  it("stores the choice site-wide for a year", () => {
    expect(buildLocaleCookie("en")).toBe(
      "NEXT_LOCALE=en; path=/; max-age=31536000; samesite=lax",
    );
  });
});
