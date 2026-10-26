// Pure functions behind scripts/sync-brand-tokens.mjs. Colors come from the
// design system in the private adonis-brand repo (design-system/tokens.json);
// projects/skills/theme.json picks the accent theme. This module turns a
// public-safe snapshot of them (scales, the chosen theme, role formulas) into
// CSS, following the same reference rules as design-system/check.py.

const HEX = /^#[0-9a-f]{6}$/i;
const REF = /\{([a-z0-9-]+)\}/g;
const MIX =
  /^color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%, (#[0-9a-f]{6}|transparent)\)$/i;
const MODES = ["light", "dark"];

// Text / background / minimum, copied from design-system/check.py (keep the
// two lists identical; scripts/__tests__/brand-tokens.test.mjs compares them
// when the brand repo is checked out next to this one). A background written
// as [role, base] is a translucent role laid on base.
export const CONTRAST_PAIRS = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "background", 4.5],
  // Deliberately below 4.5: white weight-500 text on a saturated accent pill,
  // as in ByteDance Arco / Semi; a 4.5 accent turns grey ("not that color").
  // Raised from 3 to 4 on 2026-10-26: dark mode now reuses the light button color.
  ["primary-foreground", "primary", 4],
  ["primary-foreground", "primary-hover", 4],
  ["primary-foreground", "primary-active", 4],
  ["secondary-foreground", "secondary", 4.5],
  ["secondary-foreground", "secondary-active", 4.5],
  ["danger-solid-foreground", "danger-solid", 4.5],
  ["danger-solid-foreground", "danger-solid-active", 4.5],
  ["accent-foreground", "accent-active", 4.5],
  ["info-text", ["info-soft", "card"], 4.5],
  ["link", "card", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["nav-active-foreground", ["nav-active", "sidebar"], 4.5],
  ["foreground", "selected", 4.5],
  ["warning-text", "card", 4.5],
  ["danger-text", "card", 4.5],
  ["foreground", "tint", 4.5],
  ["accent-foreground", "tint", 4.5],
  ["foreground", "plate", 4.5],
  ["danger-text", ["danger-soft", "card"], 4.5],
  ["warning-text", ["warning-soft", "card"], 4.5],
  ["success-text", ["success-soft", "card"], 4.5],
  // Focus rings are non-text (WCAG 1.4.11 asks 3:1); subtle text is
  // placeholders and hints only.
  ["ring", "card", 3],
  ["subtle-foreground", "card", 3],
];

// The design system has no roles for these, but the site's overlays, focus
// halo and clay shadows need them. They are derived from design-system values
// only, so switching the accent or the mode still moves them.
export const SITE_HELPERS = {
  light: {
    "ring-halo": "color-mix(in srgb, var(--ring) 30%, transparent)",
    overlay: "color-mix(in srgb, {neutral-12} 30%, transparent)",
    "shadow-tint": "{neutral-12}",
    "highlight-tint": "{neutral-1}",
  },
  dark: {
    "ring-halo": "color-mix(in srgb, var(--ring) 18%, transparent)",
    overlay: "color-mix(in srgb, {neutral-1} 60%, transparent)",
    "shadow-tint": "{neutral-1}",
    "highlight-tint": "{neutral-12}",
  },
};

// Roles projects/skills/DESIGN.md may name that the design system dropped;
// the `colors` map lists them under the replacing role so `{colors.x}`
// references keep resolving. Empty while DESIGN.md uses only current roles.
export const DESIGN_MD_ALIASES = {};

function luminance(hex) {
  const channel = (start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio between two #rrggbb colors. */
export function contrastRatio(a, b) {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Public subset of design-system/tokens.json for one accent theme: values
 * only. Notes and `source` fields stay in adonis-brand; they name private paths.
 */
export function pickDesignSystem(tokens, accent) {
  const missing = ["scales", "functional", "themes", "roles"].filter(
    (key) => typeof tokens?.[key] !== "object" || tokens[key] === null,
  );
  if (missing.length > 0)
    throw new Error(
      `design-system/tokens.json is missing ${missing.map((key) => `"${key}"`).join(", ")}; it must have scales, functional, themes and roles (see design-system/README.md in adonis-brand)`,
    );
  const theme = tokens.themes?.[accent];
  if (!theme)
    throw new Error(
      `design-system/tokens.json has no theme "${accent}"; set projects/skills/theme.json designSystem.accent to one of: ${Object.keys(tokens.themes ?? {}).join(", ")}`,
    );
  const { source: _source, ...functional } = tokens.functional;
  return {
    updated: tokens.updated,
    accent,
    scales: Object.fromEntries(
      Object.keys(tokens.scales).map((name) => [
        name,
        { light: tokens.scales[name].light, dark: tokens.scales[name].dark },
      ]),
    ),
    functional,
    theme: {
      scale: theme.scale,
      ...Object.fromEntries(
        SOLID_FIELDS.filter((f) => theme[f] !== undefined).map((f) => [
          f,
          theme[f],
        ]),
      ),
    },
    roles: tokens.roles,
  };
}

/** The theme's button colors; a role references each as {accent-<field>}, e.g. {accent-solid-hover}. */
const SOLID_FIELDS = [
  "solid",
  "solid-foreground",
  "solid-hover",
  "solid-active",
];

const pick = (value, mode) =>
  typeof value === "object" && value !== null ? value[mode] : value;

/** Scale steps and constants a role may reference, as #rrggbb, for one mode. */
export function scaleValues(ds, mode) {
  const values = {};
  for (const name of Object.keys(ds.scales ?? {}))
    (ds.scales[name]?.[mode] ?? []).forEach((hex, i) => {
      values[`${name}-${i + 1}`] = hex;
    });
  for (const [name, hex] of Object.entries(ds.functional ?? {}))
    values[`fn-${name}`] = hex;
  (ds.theme.scale?.[mode] ?? []).forEach((hex, i) => {
    values[`accent-${i + 1}`] = hex;
  });
  for (const field of SOLID_FIELDS)
    if (ds.theme[field] !== undefined)
      values[`accent-${field}`] = pick(ds.theme[field], mode);
  return values;
}

/** CSS variable name for a scale reference, e.g. accent-9 of the leaf theme in dark -> --brand-leaf-dark-9. */
function brandVar(ds, mode, key) {
  const suffix = mode === "dark" ? "-dark" : "";
  if (key.startsWith("fn-")) return `--brand-${key.slice(3)}`;
  if (SOLID_FIELDS.includes(key.slice(7))) {
    const shared = typeof ds.theme[key.slice(7)] !== "object";
    return `--brand-${ds.accent}${key.slice(6)}${shared ? "" : suffix}`;
  }
  const [, name, step] = /^([a-z]+)-(\d+)$/.exec(key);
  return `--brand-${name === "accent" ? ds.accent : name}${suffix}-${step}`;
}

/** Resolves every role of one mode to a CSS value with literal hex colors. */
export function resolveRoles(ds, mode) {
  const values = scaleValues(ds, mode);
  const roles = ds.roles[mode] ?? {};
  const out = {};
  const errors = [];
  const visiting = [];
  const fix = "fix design-system/tokens.json in adonis-brand";
  const resolve = (role) => {
    if (role in out) return out[role];
    if (typeof roles[role] !== "string") {
      errors.push(
        `design-system.json: ${mode}.${role} is ${JSON.stringify(roles[role])}, not a string; write a #hex, a {scale-step} or {role} reference, or a color-mix(); ${fix}`,
      );
      return (out[role] = "#000000");
    }
    if (visiting.includes(role)) {
      errors.push(
        `design-system.json: ${mode} roles refer to each other in a loop (${[...visiting.slice(visiting.indexOf(role)), role].join(" -> ")}); point one of them at a scale step; ${fix}`,
      );
      return "#000000";
    }
    visiting.push(role);
    const text = roles[role].replace(REF, (_, key) => {
      if (key in values) return values[key];
      if (key in roles) return resolve(key);
      errors.push(
        `design-system.json: ${mode}.${role} refers to {${key}}, which is neither a scale step nor a role; ${fix}`,
      );
      return "#000000";
    });
    visiting.pop();
    out[role] = text;
    return text;
  };
  for (const role of Object.keys(roles)) resolve(role);
  return { roles: out, errors: [...new Set(errors)] };
}

function rgb(hex) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

/** A #hex or simple color-mix as a solid #rrggbb; transparent sits on base. */
export function solidHex(value, base) {
  if (HEX.test(value)) return value.toLowerCase();
  const m = MIX.exec(value);
  if (!m) return null;
  const [, a, pct, b] = m;
  const under = b === "transparent" ? base : b;
  if (!under) return null;
  const p = Number(pct) / 100;
  const mixed = rgb(a).map((x, i) =>
    Math.round(x * p + rgb(under)[i] * (1 - p)),
  );
  return `#${mixed.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Validates the snapshot and returns human-readable problems; each one names
 * the value and how to fix it.
 */
export function findBrandIssues(ds) {
  const issues = [];
  for (const mode of MODES) {
    if (!ds.roles?.[mode]) {
      issues.push(`design-system.json: missing roles.${mode}`);
      continue;
    }
    for (const [key, hex] of Object.entries(scaleValues(ds, mode)))
      if (!HEX.test(hex ?? ""))
        issues.push(
          `design-system.json: ${mode} ${key} "${hex}" must be #rrggbb`,
        );
  }
  if (issues.length > 0) return issues;

  for (const mode of MODES) {
    const missing = [
      ...new Set(
        CONTRAST_PAIRS.flatMap(([fg, bg]) => [fg, ...[bg].flat()]).filter(
          (role) => !(role in ds.roles[mode]),
        ),
      ),
    ];
    for (const role of missing)
      issues.push(
        `design-system.json: roles.${mode} has no "${role}", which the contrast check needs; add it to design-system/tokens.json in adonis-brand`,
      );
    const { roles, errors } = resolveRoles(ds, mode);
    issues.push(...errors);
    if (missing.length > 0 || errors.length > 0) continue;
    const card = solidHex(roles.card);
    for (const [fg, bg, need] of CONTRAST_PAIRS) {
      const [bgRole, baseRole] = Array.isArray(bg) ? bg : [bg, "card"];
      const base = baseRole === "card" ? card : solidHex(roles[baseRole]);
      const a = solidHex(roles[fg] ?? "");
      const b = solidHex(roles[bgRole] ?? "", base);
      if (!a || !b) {
        issues.push(
          `design-system.json: ${mode} ${fg}/${bgRole} does not resolve to solid colors; text roles must be #hex, backgrounds #hex or color-mix(in srgb, X p%, Y)`,
        );
        continue;
      }
      const ratio = contrastRatio(a, b);
      if (ratio < need)
        issues.push(
          `design-system.json: ${mode} ${fg} ${a} on ${bgRole} ${b} is ${ratio.toFixed(2)}:1, below ${need}:1; fix the theme in adonis-brand and run design-system/check.py`,
        );
    }
  }
  return issues;
}

function header(source) {
  const from = source?.commit
    ? `adonis-brand@${source.commit.slice(0, 12)}`
    : "adonis-brand (unknown commit)";
  return [
    "/*",
    ` * GENERATED by scripts/sync-brand-tokens.mjs from ${from}.`,
    " * Do not edit by hand: change adonis-brand, then run `pnpm brand:sync`.",
    " */",
  ].join("\n");
}

/** Brand layer: one --brand-* variable per scale step of the chosen theme. */
export function renderBrandTokensCss(ds, source) {
  const lines = [];
  const seen = new Set();
  for (const mode of MODES)
    for (const [key, hex] of Object.entries(scaleValues(ds, mode))) {
      const name = brandVar(ds, mode, key);
      if (seen.has(name)) continue;
      seen.add(name);
      lines.push(`  ${name}: ${hex.toLowerCase()}; /* ${mode} ${key} */`);
    }
  return `${header(source)}\n:root {\n${lines.join("\n")}\n}\n`;
}

/** Semantic roles for light and dark mode; references become var(). */
export function renderThemeRolesCss(ds, source) {
  const block = (mode) => {
    const roles = ds.roles[mode];
    const values = scaleValues(ds, mode);
    const toCss = (formula) =>
      formula.replace(REF, (_, key) =>
        key in values ? `var(${brandVar(ds, mode, key)})` : `var(--${key})`,
      );
    const lines = Object.entries(roles).map(
      ([role, formula]) => `  --${role}: ${toCss(formula)}; /* ${formula} */`,
    );
    lines.push("  /* Site helpers: no design-system role covers these. */");
    for (const [role, formula] of Object.entries(SITE_HELPERS[mode]))
      lines.push(`  --${role}: ${toCss(formula)};`);
    return lines.join("\n");
  };
  return `${[
    header(source),
    `:root {\n${block("light")}\n}`,
    `.dark,\n:root[data-theme="dark"] {\n${block("dark")}\n}`,
  ].join("\n\n")}\n`;
}

/**
 * Root DESIGN.md (google-labs-code/design.md format) from the brand repo's
 * projects/skills/DESIGN.md: injects a `colors` map resolved from the design
 * system so hex values live only in tokens.json. Dark roles get a `-dark`
 * suffix; gradients and translucent roles without a base are skipped.
 */
export function renderDesignMd(designSource, ds, source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(designSource);
  if (!match) throw new Error("DESIGN.md source has no YAML front matter.");
  if (/^colors:/m.test(match[1]))
    throw new Error(
      "DESIGN.md source must not define `colors`; they come from design-system/tokens.json.",
    );
  const colorLines = [];
  for (const [mode, suffix] of [
    ["light", ""],
    ["dark", "-dark"],
  ]) {
    const { roles } = resolveRoles(ds, mode);
    const hexes = {};
    for (const [role, value] of Object.entries(roles)) {
      const hex = solidHex(value, solidHex(roles.card));
      if (hex) hexes[role] = hex;
    }
    for (const [alias, role] of Object.entries(DESIGN_MD_ALIASES))
      if (hexes[role] && !(alias in hexes)) hexes[alias] = hexes[role];
    for (const [role, hex] of Object.entries(hexes))
      colorLines.push(`  ${role}${suffix}: "${hex}"`);
  }
  const from = source?.commit
    ? `adonis-brand@${source.commit.slice(0, 12)}`
    : "adonis-brand (unknown commit)";
  const generated = [
    `# GENERATED by scripts/sync-brand-tokens.mjs from ${from} (projects/skills/DESIGN.md).`,
    "# Do not edit by hand: change adonis-brand, then run `pnpm brand:sync`.",
  ];
  const lines = match[1].split("\n");
  const at = lines.findIndex((line) => /^typography:/.test(line));
  const insertAt = at >= 0 ? at : lines.length;
  lines.splice(insertAt, 0, "colors:", ...colorLines);
  return `---\n${[...generated, ...lines].join("\n")}\n---\n${designSource.slice(match[0].length)}`;
}
