// Pre-commit guard for public skills. When a commit touches skills/ or the
// catalog copy, validate the catalog and make sure the generated index that
// the Catalog Site builds from is regenerated and staged.
import { execFileSync, spawnSync } from "node:child_process";

const WATCHED =
  /^(skills\/|apps\/web\/content\/skill-catalog\.yaml$|apps\/web\/public\/brand\/illustrations\/)/;
const GENERATED = "apps/web/src/generated";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function run(script) {
  const result = spawnSync("pnpm", ["-s", script], { stdio: "inherit" });
  return result.status === 0;
}

const staged = git(["diff", "--cached", "--name-only"])
  .split("\n")
  .filter(Boolean);
if (!staged.some((file) => WATCHED.test(file))) process.exit(0);

if (!run("skills:validate")) {
  console.error(
    "\nprecommit-skills: `pnpm skills:validate` failed. Fix the catalog entry it names in apps/web/content/skill-catalog.yaml (see CLAUDE.md → Catalog entry for a new or changed public skill), then commit again.",
  );
  process.exit(1);
}

if (!run("skills:index")) {
  console.error(
    "\nprecommit-skills: `pnpm skills:index` failed; see the error above.",
  );
  process.exit(1);
}

const unstaged = git(["diff", "--name-only", "--", GENERATED]);
if (unstaged) {
  console.error(
    `\nprecommit-skills: the generated index changed:\n${unstaged}\nRun \`git add ${GENERATED}\` and commit again.`,
  );
  process.exit(1);
}
