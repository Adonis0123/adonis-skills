import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRAST_PAIRS,
  contrastRatio,
  findBrandIssues,
  pickDesignSystem,
  renderBrandTokensCss,
  renderDesignMd,
  renderThemeRolesCss,
  resolveRoles,
  solidHex,
} from "../lib/brand-tokens.mjs";

const ramp = (start, end) =>
  Array.from({ length: 12 }, (_, i) => (i < 6 ? start : end));

const tokens = {
  "$schema-note": "private note",
  updated: "2026-10-24",
  scales: {
    neutral: {
      source: "private source",
      light: [
        "#FCFCFD",
        "#F9F9FB",
        "#F0F0F3",
        "#E8E8EC",
        "#E0E1E6",
        "#D9D9E0",
        "#CDCED6",
        "#B9BBC6",
        "#8B8D98",
        "#80838D",
        "#60646C",
        "#1C2024",
      ],
      dark: [
        "#111113",
        "#18191B",
        "#212225",
        "#272A2D",
        "#2E3135",
        "#363A3F",
        "#43484E",
        "#5A6169",
        "#696E77",
        "#777B84",
        "#B0B4BA",
        "#EDEEF0",
      ],
    },
    amber: {
      light: ramp("#FFF7C2", "#4F3422"),
      dark: ramp("#302008", "#FFCA16"),
    },
    red: {
      light: ramp("#FEEBEC", "#CE2C31"),
      dark: ramp("#3B1219", "#FF9592"),
    },
  },
  functional: { source: "private source", success: "#27A644", info: "#4EA7FC" },
  themes: {
    teal: {
      name: "青绿",
      note: "private note",
      scale: {
        light: ramp("#E5F8F6", "#04706D"),
        dark: ramp("#082E2C", "#89C7C3"),
      },
      solid: "#5FD4C8",
      "solid-foreground": "#111111",
    },
  },
  roles: {
    light: {
      background: "{neutral-2}",
      foreground: "{neutral-12}",
      sidebar: "{neutral-2}",
      card: "{neutral-1}",
      "muted-foreground": "{neutral-11}",
      "subtle-foreground": "{neutral-9}",
      primary: "{accent-solid}",
      "primary-foreground": "{accent-solid-foreground}",
      accent: "color-mix(in srgb, {accent-9} 12%, {card})",
      "accent-foreground": "{accent-11}",
      selected: "color-mix(in srgb, {accent-9} 12%, {card})",
      "nav-active": "color-mix(in srgb, {accent-9} 15%, transparent)",
      "nav-active-foreground": "{accent-11}",
      link: "{accent-11}",
      "warning-text": "{amber-12}",
      "danger-text": "{red-11}",
      success: "{fn-success}",
      ring: "{accent-11}",
      tint: "{accent-2}",
      plate: "{neutral-1}",
      "success-text": "{neutral-12}",
      "success-soft": "color-mix(in srgb, {fn-success} 16%, transparent)",
      "warning-soft": "color-mix(in srgb, {amber-1} 20%, transparent)",
      "danger-soft": "color-mix(in srgb, {red-1} 16%, transparent)",
      "page-tint":
        "linear-gradient(color-mix(in srgb, {accent-9} 10%, {background}) 0, {background} 180px)",
    },
    dark: {
      background: "{neutral-1}",
      foreground: "{neutral-12}",
      sidebar: "{neutral-1}",
      card: "{neutral-3}",
      "muted-foreground": "{neutral-11}",
      "subtle-foreground": "{neutral-9}",
      primary: "{accent-solid}",
      "primary-foreground": "{accent-solid-foreground}",
      accent: "color-mix(in srgb, {accent-9} 20%, {card})",
      "accent-foreground": "{accent-11}",
      selected: "color-mix(in srgb, {accent-9} 20%, {card})",
      "nav-active": "color-mix(in srgb, {accent-9} 24%, transparent)",
      "nav-active-foreground": "{accent-11}",
      link: "{accent-11}",
      "warning-text": "{amber-11}",
      "danger-text": "{red-11}",
      success: "{fn-success}",
      ring: "{accent-11}",
      tint: "{accent-2}",
      plate: "{neutral-1}",
      "success-text": "{neutral-12}",
      "success-soft": "color-mix(in srgb, {fn-success} 16%, transparent)",
      "warning-soft": "color-mix(in srgb, {amber-1} 20%, transparent)",
      "danger-soft": "color-mix(in srgb, {red-1} 16%, transparent)",
      "page-tint":
        "linear-gradient(color-mix(in srgb, {accent-9} 10%, {background}) 0, {background} 180px)",
    },
  },
};

const ds = pickDesignSystem(tokens, "teal");

test("contrastRatio matches WCAG reference values", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrastRatio("#1E2A44", "#F6F1E7").toFixed(2), "12.69");
});

test("pickDesignSystem keeps values and drops private notes and sources", () => {
  const json = JSON.stringify(ds);
  assert.doesNotMatch(json, /private/);
  assert.equal(ds.accent, "teal");
  assert.equal(ds.theme.solid, "#5FD4C8");
  assert.deepEqual(Object.keys(ds.functional), ["success", "info"]);
  assert.throws(() => pickDesignSystem(tokens, "celeste"), /one of: teal/);
});

test("resolveRoles follows scale and role references per mode", () => {
  const light = resolveRoles(ds, "light").roles;
  assert.equal(light.primary, "#5FD4C8");
  assert.equal(light.accent, "color-mix(in srgb, #04706D 12%, #FCFCFD)");
  const dark = resolveRoles(ds, "dark").roles;
  assert.equal(dark.card, "#212225");
  assert.equal(dark["warning-text"], "#FFCA16");
});

test("every scale in tokens.json is published and referenceable", () => {
  const withPaper = structuredClone(tokens);
  withPaper.scales.paper = {
    light: ramp("#F7F2E8", "#27221A"),
    dark: ramp("#1A1712", "#F4EFE7"),
  };
  withPaper.roles.light.plate = "{paper-2}";
  const picked = pickDesignSystem(withPaper, "teal");
  assert.equal(resolveRoles(picked, "light").roles.plate, "#F7F2E8");
  assert.match(
    renderBrandTokensCss(picked, null),
    /--brand-paper-dark-2: #1a1712;/,
  );
});

test("solidHex mixes over an opaque base like check.py", () => {
  assert.equal(solidHex("#ABCDEF"), "#abcdef");
  assert.equal(solidHex("color-mix(in srgb, #000000 50%, #ffffff)"), "#808080");
  assert.equal(
    solidHex("color-mix(in srgb, #000000 50%, transparent)", "#ffffff"),
    "#808080",
  );
  assert.equal(solidHex("linear-gradient(red, blue)"), null);
});

test("a valid snapshot has no issues", () => {
  assert.deepEqual(findBrandIssues(ds), []);
});

test("reports unknown references and low contrast with a fix hint", () => {
  const broken = structuredClone(ds);
  broken.roles.light.link = "{forest-11}";
  broken.roles.dark["muted-foreground"] = "{neutral-9}";
  const issues = findBrandIssues(broken).join("\n");
  assert.match(issues, /light\.link refers to \{forest-11\}/);
  assert.match(issues, /dark muted-foreground .* below 4\.5:1/);
});

test("white text on a saturated accent passes at 3:1 but not below", () => {
  const vivid = structuredClone(ds);
  vivid.theme.solid = { light: "#568C11", dark: "#64A400" };
  vivid.theme["solid-foreground"] = "#FFFFFF";
  assert.deepEqual(findBrandIssues(vivid), []);
  vivid.theme.solid = { light: "#568C11", dark: "#7FBF1F" };
  assert.match(
    findBrandIssues(vivid).join("\n"),
    /dark primary-foreground #ffffff on primary #7fbf1f is 2\.\d\d:1, below 3:1/,
  );
});

test("names a role the contrast check needs but the snapshot lacks", () => {
  const broken = structuredClone(ds);
  delete broken.roles.light["nav-active"];
  const issues = findBrandIssues(broken).join("\n");
  assert.match(issues, /roles\.light has no "nav-active"/);
  assert.doesNotMatch(issues, /does not resolve/);
});

test("reports a role loop and a non-string role instead of crashing", () => {
  const broken = structuredClone(ds);
  broken.roles.dark.link = "{accent-foreground}";
  broken.roles.dark["accent-foreground"] = "{link}";
  broken.roles.light.tint = 42;
  const issues = findBrandIssues(broken).join("\n");
  assert.match(
    issues,
    /dark roles refer to each other in a loop \((link -> accent-foreground -> link|accent-foreground -> link -> accent-foreground)\)/,
  );
  assert.match(issues, /light\.tint is 42, not a string/);
});

test("pickDesignSystem names the section tokens.json lacks", () => {
  const { functional: _functional, ...rest } = tokens;
  assert.throws(
    () => pickDesignSystem(rest, "teal"),
    /tokens\.json is missing "functional"/,
  );
});

// check.py lives in the private brand repo; compare only when it is checked
// out next to this repo (or at BRAND_REPO).
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const checkPy = path.join(
  path.resolve(repoRoot, process.env.BRAND_REPO ?? "../adonis-brand"),
  "design-system/check.py",
);
test(
  "CONTRAST_PAIRS matches design-system/check.py",
  { skip: !fs.existsSync(checkPy) && "brand repo not checked out" },
  () => {
    const block = /^PAIRS = \[\n([\s\S]*?)\n\]/m.exec(
      fs.readFileSync(checkPy, "utf8"),
    )[1];
    const fromPy = [
      ...block.matchAll(
        /^\s*\("([a-z-]+)", (?:"([a-z-]+)"|\("([a-z-]+)", "([a-z-]+)"\)), ([\d.]+)\)/gm,
      ),
    ].map(([, fg, bg, layer, base, need]) => [
      fg,
      bg ?? [layer, base],
      Number(need),
    ]);
    assert.deepEqual(CONTRAST_PAIRS, fromPy);
  },
);

test("reports scale values that are not #rrggbb", () => {
  const broken = structuredClone(ds);
  broken.scales.neutral.light[0] = "#12345";
  assert.match(findBrandIssues(broken).join("\n"), /neutral-1 "#12345"/);
});

test("generated CSS carries provenance and maps references to var()", () => {
  const source = { commit: "4340586c8087bb5d8d7823601beccaa0a243d4e3" };
  const brandCss = renderBrandTokensCss(ds, source);
  assert.match(brandCss, /GENERATED .* adonis-brand@4340586c8087/);
  assert.match(
    brandCss,
    /--brand-neutral-2: #f9f9fb; \/\* light neutral-2 \*\//,
  );
  assert.match(brandCss, /--brand-teal-dark-9: #89c7c3;/);
  assert.match(brandCss, /--brand-teal-solid: #5fd4c8;/);
  assert.match(brandCss, /--brand-success: #27a644;/);

  const rolesCss = renderThemeRolesCss(ds, source);
  assert.match(
    rolesCss,
    /--background: var\(--brand-neutral-2\); \/\* \{neutral-2\} \*\//,
  );
  assert.match(
    rolesCss,
    /--accent: color-mix\(in srgb, var\(--brand-teal-9\) 12%, var\(--card\)\);/,
  );
  assert.match(
    rolesCss,
    /\.dark,\n:root\[data-theme="dark"\] \{\n {2}--background: var\(--brand-neutral-dark-1\);/,
  );
  assert.match(
    rolesCss,
    /--ring-halo: color-mix\(in srgb, var\(--ring\) 18%, transparent\);/,
  );
  assert.doesNotMatch(rolesCss, /#[0-9a-f]{6}/i);
});

test("renderDesignMd injects solid colors before typography", () => {
  const designSource = [
    "---",
    "version: alpha",
    "name: Demo",
    "typography:",
    "  body:",
    "    fontSize: 15px",
    "---",
    "",
    "## Overview",
    "",
  ].join("\n");
  const out = renderDesignMd(designSource, ds, {
    commit: "0123456789abcdef",
  });
  assert.match(
    out,
    /^---\n# GENERATED by scripts\/sync-brand-tokens\.mjs from adonis-brand@0123456789ab/,
  );
  assert.match(out, /colors:\n {2}background: "#f9f9fb"\n/);
  assert.match(out, / {2}accent: "#deebec"\n/);
  assert.match(out, / {2}background-dark: "#111113"\n/);
  assert.match(out, /\ntypography:/);
  assert.doesNotMatch(out, /page-tint/);
  assert.match(out, /---\n\n## Overview\n$/);
});

test("renderDesignMd rejects a source that hardcodes colors", () => {
  assert.throws(
    () =>
      renderDesignMd(
        '---\nname: Demo\ncolors:\n  primary: "#000000"\n---\n',
        ds,
        null,
      ),
    /must not define `colors`/,
  );
});
