import { describe, expect, it } from "vitest";
import designSystem from "@/styles/brand/design-system.json";
import { type DesignSystemSnapshot, resolveLightRoleHex } from "./og-palette";

const ds: DesignSystemSnapshot = {
  scales: {
    neutral: { light: ["#n1", "#n2"], dark: [] },
    paper: { light: ["#p1", "#p2", "#p3"], dark: [] },
  },
  theme: { scale: { light: ["#a1", "#a2"], dark: [] } },
  roles: {
    light: {
      background: "{paper-3}",
      border: "{neutral-2}",
      link: "{accent-2}",
      accent: "color-mix(in srgb, {accent-9} 12%, {card})",
      missing: "{blue-1}",
    },
  },
};

describe("resolveLightRoleHex", () => {
  it("resolves a paper-scale role", () => {
    expect(resolveLightRoleHex(ds, "background")).toBe("#p3");
  });

  it("resolves neutral and accent roles", () => {
    expect(resolveLightRoleHex(ds, "border")).toBe("#n2");
    expect(resolveLightRoleHex(ds, "link")).toBe("#a2");
  });

  it("rejects formulas and scales the snapshot lacks", () => {
    expect(() => resolveLightRoleHex(ds, "accent")).toThrow(/plain scale step/);
    expect(() => resolveLightRoleHex(ds, "missing")).toThrow(
      /plain scale step/,
    );
    expect(() => resolveLightRoleHex(ds, "nope")).toThrow(/plain scale step/);
  });

  it("resolves every role the OG card uses from the real snapshot", () => {
    for (const role of [
      "background",
      "foreground",
      "muted-foreground",
      "link",
      "ink",
    ])
      expect(resolveLightRoleHex(designSystem, role)).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
  });
});
