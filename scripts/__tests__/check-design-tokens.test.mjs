import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkContent,
  formatViolation,
  isExcluded,
  scan,
} from "../check-design-tokens.mjs";

const problems = (rel, content) =>
  checkContent(rel, content).map((v) => v.problem);

test("semantic roles pass", () => {
  const tsx = `<div className="border border-border bg-card text-muted-foreground hover:bg-accent text-sm/6 bg-linear-to-l/oklch from-background to-transparent bg-overlay w-1/2" />`;
  assert.deepEqual(problems("components/a.tsx", tsx), []);
  const css = `.x { background: var(--card); border: 1px solid var(--border); grid-column: 1/3; }\n.y { @apply bg-muted text-foreground; }`;
  assert.deepEqual(problems("styles/custom.css", css), []);
});

test("color-mix outside the shadow exception is reported", () => {
  const css = `.a {\n  background: color-mix(in oklab, var(--primary) 24%, transparent);\n}`;
  const [v] = checkContent("styles/custom.css", css);
  assert.equal(v.line, 2);
  assert.match(
    v.problem,
    /color-mix\(in oklab, var\(--primary\) 24%, transparent\)/,
  );
  assert.match(v.fix, /var\(--overlay\)/);
});

test("shadcn-theme shadow formula is allowed only with shadow/highlight tint", () => {
  const ok = `--s: 0 1px 2px color-mix(in oklab, var(--shadow-tint) 5%, transparent),\n inset 0 3px 6px -3px color-mix(in oklab, var(--highlight-tint) 70%, transparent);`;
  assert.deepEqual(problems("styles/shadcn-theme.css", ok), []);
  const bad = `--s: color-mix(in oklab, var(--primary) 5%, transparent);`;
  assert.equal(problems("styles/shadcn-theme.css", bad).length, 1);
  // The same shadow formula is not allowed in other files.
  assert.equal(problems("styles/custom.css", ok).length, 2);
});

test("hex, rgb and hsl literals are reported", () => {
  const css = `.a { color: #fff; background: #f4f7fc; border-color: #11223344; }\n.b { color: rgb(0 0 0); background: rgba(0,0,0,.2); fill: hsl(10 20% 30%); }`;
  const found = problems("styles/custom.css", css);
  assert.equal(found.filter((p) => p.startsWith("颜色字面量")).length, 3);
  assert.equal(found.filter((p) => p.startsWith("颜色函数")).length, 3);
  // Anchors and ids that are not hex colors pass.
  assert.deepEqual(
    problems(
      "app/page.tsx",
      `<a href="#main-content" /> <a href="#install" />`,
    ),
    [],
  );
});

test("Tailwind opacity modifiers on color utilities are reported with a role hint", () => {
  const tsx = `cx('bg-background/55 hover:bg-accent/65 border-border/70 text-foreground/85 ring-ring/[0.3] bg-[var(--card)]/50 bg-current/70')`;
  const found = checkContent("components/a.tsx", tsx);
  assert.deepEqual(
    found.map((v) => v.problem.replace("透明度修饰 ", "")),
    [
      "bg-background/55",
      "bg-accent/65",
      "border-border/70",
      "text-foreground/85",
      "ring-ring/[0.3]",
      "bg-[var(--card)]/50",
      "bg-current/70",
    ],
  );
  assert.match(found[0].fix, /用实色角色代替 bg-background\/55：bg-muted/);
  assert.match(found[2].fix, /border-border \/ border-input/);
  assert.match(found[3].fix, /text-muted-foreground/);
});

test("@apply opacity modifiers in CSS are reported", () => {
  assert.deepEqual(
    problems(
      "styles/shadcn-theme.css",
      `* { @apply border-border outline-ring/55; }`,
    ),
    ["透明度修饰 outline-ring/55"],
  );
});

test("Tailwind palette color names are reported", () => {
  const found = problems(
    "components/a.tsx",
    `"bg-emerald-500 text-slate-700 border-gray-200 bg-black text-white hover:bg-red-50"`,
  );
  assert.equal(found.length, 6);
  assert.deepEqual(
    problems(
      "components/a.tsx",
      `"bg-blueprint text-whitespace border-white-ish"`,
    ),
    [],
  );
});

test("comments are ignored, URLs and line numbers are kept", () => {
  const css = `/* was #fff and color-mix(in oklab, red 5%, white) */\n.a { background: url(https://x.dev/a.svg); }\n.b { color: #000; }`;
  const [v, ...rest] = checkContent("styles/custom.css", css);
  assert.equal(rest.length, 0);
  assert.equal(v.line, 3);
  assert.deepEqual(
    problems(
      "components/a.tsx",
      `// old: bg-black/50 #abc\nconst href = 'https://example.com'`,
    ),
    [],
  );
});

test("excluded paths", () => {
  for (const p of [
    "styles/brand-tokens.css",
    "styles/theme-roles.css",
    "styles/brand/skills.json",
    "lib/og-card.tsx",
    "lib/skill-markdown.test.tsx",
    "locales/src/app/en.po",
    "generated/skills-index-lite.json",
    "generated/",
  ]) {
    assert.equal(isExcluded(p), true, p);
  }
  for (const p of [
    "styles/custom.css",
    "styles/shadcn-theme.css",
    "components/skill-card.tsx",
    "lib/og.tsx",
  ]) {
    assert.equal(isExcluded(p), false, p);
  }
});

test("scan walks apps/web/src, skips exclusions and formats file:line", () => {
  const root = mkdtempSync(path.join(tmpdir(), "design-check-"));
  try {
    const src = path.join(root, "apps/web/src");
    for (const dir of ["components", "styles/brand", "lib", "generated"])
      mkdirSync(path.join(src, dir), { recursive: true });
    writeFileSync(
      path.join(src, "components/ok.tsx"),
      `<div className="bg-card" />`,
    );
    writeFileSync(
      path.join(src, "components/bad.tsx"),
      `\n<div className="bg-foreground/20" />`,
    );
    writeFileSync(
      path.join(src, "styles/theme-roles.css"),
      `:root { --border: color-mix(in oklab, #000 14%, transparent); }`,
    );
    writeFileSync(path.join(src, "styles/brand/x.css"), `a { color: #fff; }`);
    writeFileSync(path.join(src, "lib/og-card.tsx"), `const c = '#ffffff'`);
    writeFileSync(path.join(src, "lib/a.test.tsx"), `const c = 'bg-black'`);
    writeFileSync(path.join(src, "generated/x.ts"), `const c = 'rgb(0 0 0)'`);
    writeFileSync(path.join(src, "components/notes.md"), `#fff`);

    const results = scan(root);
    assert.equal(results.length, 1);
    assert.equal(results[0].file, "apps/web/src/components/bad.tsx");
    assert.equal(results[0].line, 2);
    assert.match(
      formatViolation(results[0]),
      /^apps\/web\/src\/components\/bad\.tsx:2 {2}透明度修饰 bg-foreground\/20 {2}→ {2}用实色角色代替/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
