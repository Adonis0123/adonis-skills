// Brand palette sync. adonis-brand (private) owns the colors; this public repo
// keeps a snapshot under apps/web/src/styles/brand/ and generates CSS from it.
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
  renderBrandTokensCss,
  renderThemeRolesCss,
} from "./lib/brand-tokens.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesDir = path.join(root, "apps/web/src/styles");
const snapshotDir = path.join(stylesDir, "brand");
const files = {
  palette: path.join(snapshotDir, "palette.json"),
  theme: path.join(snapshotDir, "theme.json"),
  source: path.join(snapshotDir, "source.json"),
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

async function copySnapshot(brandDir) {
  const resolved = path.resolve(brandDir);
  const palettePath = path.join(resolved, "data/palette.json");
  const themePath = path.join(resolved, "projects/skills/theme.json");
  try {
    await fs.access(palettePath);
    await fs.access(themePath);
  } catch {
    throw new Error(
      `adonis-brand not found at ${resolved}: expected data/palette.json and projects/skills/theme.json. Pass --from <dir> or set BRAND_REPO.`,
    );
  }
  const dirty =
    git(resolved, [
      "status",
      "--porcelain",
      "--",
      "data/palette.json",
      "projects/skills/theme.json",
    ]) !== "";
  const source = {
    repo: "adonis-brand",
    commit: git(resolved, ["rev-parse", "HEAD"]),
    // Uncommitted brand edits are allowed while designing, but flagged so the
    // snapshot is re-synced after the brand repo commits them.
    dirty,
    files: ["data/palette.json", "projects/skills/theme.json"],
  };
  // adonis-brand is private: publish only what the site needs (ids, values,
  // names, contrast rules). Sources, usage notes, and decision text stay there;
  // `source.commit` points back to them.
  const palette = JSON.parse(await fs.readFile(palettePath, "utf8"));
  const theme = JSON.parse(await fs.readFile(themePath, "utf8"));
  const publicPalette = {
    updated: palette.updated,
    colors: palette.colors.map(({ id, hex, group, name }) => ({
      id,
      hex,
      group,
      name: { en: name.en },
    })),
  };
  const publicTheme = {
    updated: theme.updated,
    modes: theme.modes,
    contrast: theme.contrast,
  };
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.writeFile(
    files.palette,
    `${JSON.stringify(publicPalette, null, 2)}\n`,
  );
  await fs.writeFile(files.theme, `${JSON.stringify(publicTheme, null, 2)}\n`);
  await fs.writeFile(files.source, `${JSON.stringify(source, null, 2)}\n`);
  return source;
}

async function main() {
  const source = from
    ? await copySnapshot(from)
    : await readJson(files.source).catch(() => null);
  const palette = await readJson(files.palette);
  const theme = await readJson(files.theme);

  const issues = findBrandIssues(palette, theme);
  if (issues.length > 0)
    throw new Error(`Brand snapshot is invalid:\n- ${issues.join("\n- ")}`);

  const outputs = [
    [files.brandCss, renderBrandTokensCss(palette, source)],
    [files.themeCss, renderThemeRolesCss(theme, source)],
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
    `Generated ${path.relative(root, files.brandCss)} and ${path.relative(root, files.themeCss)} from adonis-brand@${source?.commit?.slice(0, 12) ?? "unknown"}${source?.dirty ? " (dirty)" : ""}.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
