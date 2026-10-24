// Brand sync. adonis-brand (private) owns the colors (its design system,
// design-system/tokens.json) and the design spec; projects/skills/theme.json
// picks the accent theme (`designSystem.accent`). This public repo keeps a
// snapshot under apps/web/src/styles/brand/ and generates CSS plus the root
// DESIGN.md from it.
//
//   node scripts/sync-brand-tokens.mjs --from <adonis-brand dir>   copy snapshot + regenerate
//   node scripts/sync-brand-tokens.mjs                             regenerate from snapshot
//   node scripts/sync-brand-tokens.mjs --check                     verify (CI); writes nothing
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findBrandIssues,
  pickDesignSystem,
  renderBrandTokensCss,
  renderDesignMd,
  renderThemeRolesCss,
} from "./lib/brand-tokens.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesDir = path.join(root, "apps/web/src/styles");
const snapshotDir = path.join(stylesDir, "brand");
const files = {
  designSystem: path.join(snapshotDir, "design-system.json"),
  source: path.join(snapshotDir, "source.json"),
  design: path.join(snapshotDir, "DESIGN.source.md"),
  designMd: path.join(root, "DESIGN.md"),
  brandCss: path.join(stylesDir, "brand-tokens.css"),
  themeCss: path.join(stylesDir, "theme-roles.css"),
};

const args = process.argv.slice(2);
const check = args.includes("--check");
const fromIndex = args.indexOf("--from");
const from = fromIndex >= 0 ? args[fromIndex + 1] : undefined;

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function git(dir, gitArgs) {
  return execFileSync("git", ["-C", dir, ...gitArgs], {
    encoding: "utf8",
  }).trim();
}

const BRAND_FILES = [
  "design-system/tokens.json",
  "projects/skills/theme.json",
  "projects/skills/DESIGN.md",
];

async function copySnapshot(brandDir) {
  const resolved = path.resolve(brandDir);
  const [tokensPath, themePath, designPath] = BRAND_FILES.map((file) =>
    path.join(resolved, file),
  );
  try {
    await Promise.all(
      BRAND_FILES.map((file) => fs.access(path.join(resolved, file))),
    );
  } catch {
    throw new Error(
      `adonis-brand not found at ${resolved}: expected ${BRAND_FILES.join(", ")}. Pass --from <dir> or set BRAND_REPO.`,
    );
  }
  const dirty =
    git(resolved, ["status", "--porcelain", "--", ...BRAND_FILES]) !== "";
  const source = {
    repo: "adonis-brand",
    commit: git(resolved, ["rev-parse", "HEAD"]),
    // Uncommitted brand edits are allowed while designing, but flagged so the
    // snapshot is re-synced after the brand repo commits them.
    dirty,
    files: BRAND_FILES,
  };
  const theme = await readJson(themePath);
  const accent = theme.designSystem?.accent;
  if (!accent)
    throw new Error(
      `${themePath} has no designSystem.accent; add "designSystem": { "accent": "<theme id from design-system/tokens.json>" }.`,
    );
  // adonis-brand is private: publish only values (scales, the chosen theme,
  // role formulas). Notes and sources stay there; `source.commit` points back.
  const designSystem = pickDesignSystem(await readJson(tokensPath), accent);
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.writeFile(
    files.designSystem,
    `${JSON.stringify(designSystem, null, 2)}\n`,
  );
  await fs.writeFile(files.source, `${JSON.stringify(source, null, 2)}\n`);
  // DESIGN.md is the site's public design spec, so it is copied whole.
  await fs.copyFile(designPath, files.design);
  return source;
}

async function main() {
  const source = from
    ? await copySnapshot(from)
    : await readJson(files.source).catch(() => null);
  const designSystem = await readJson(files.designSystem);

  const issues = findBrandIssues(designSystem);
  if (issues.length > 0)
    throw new Error(`Brand snapshot is invalid:\n- ${issues.join("\n- ")}`);

  const outputs = [
    [files.brandCss, renderBrandTokensCss(designSystem, source)],
    [files.themeCss, renderThemeRolesCss(designSystem, source)],
    [
      files.designMd,
      renderDesignMd(
        await fs.readFile(files.design, "utf8"),
        designSystem,
        source,
      ),
    ],
  ];

  if (check) {
    const stale = [];
    for (const [file, expected] of outputs) {
      const actual = await fs.readFile(file, "utf8").catch(() => "");
      if (actual !== expected) stale.push(path.relative(root, file));
    }
    if (source?.dirty)
      stale.push(
        "apps/web/src/styles/brand/source.json (snapshot taken from uncommitted adonis-brand changes)",
      );
    if (stale.length > 0)
      throw new Error(
        `Brand CSS is out of date: ${stale.join(", ")}. Run \`pnpm brand:sync\` (after committing adonis-brand) and commit the result.`,
      );
    console.log(
      `Brand tokens up to date (adonis-brand@${source?.commit?.slice(0, 12) ?? "unknown"}).`,
    );
    return;
  }

  for (const [file, content] of outputs) await fs.writeFile(file, content);
  console.log(
    `Generated ${outputs.map(([file]) => path.relative(root, file)).join(", ")} from adonis-brand@${source?.commit?.slice(0, 12) ?? "unknown"}${source?.dirty ? " (dirty)" : ""}.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
