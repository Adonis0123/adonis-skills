import { execSync } from "node:child_process";

function run(cmd: string): void {
  console.log(`[build] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run("pnpm run i18n -- --compile --strict");
// Regenerate the plugin index so a stale or missing file cannot ship an empty /plugins page.
run("pnpm run plugins:index");
run("next build");
