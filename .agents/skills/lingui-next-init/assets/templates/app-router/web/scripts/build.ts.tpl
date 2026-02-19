import { execSync } from "node:child_process";

function run(cmd: string): void {
	console.log(`[build] $ ${cmd}`);
	execSync(cmd, { stdio: "inherit" });
}

run("{{PACKAGE_MANAGER}} run i18n:compile");
run("next build");
