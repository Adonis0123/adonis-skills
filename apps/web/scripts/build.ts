import { execSync } from "node:child_process";

function run(cmd: string): void {
	console.log(`[build] $ ${cmd}`);
	execSync(cmd, { stdio: "inherit" });
}

run("pnpm run i18n -- --compile --strict");
run("next build");
