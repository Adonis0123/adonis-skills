import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Runs a repo-skill-creator Python script that imports PyYAML.
// Uses the system python3 when it already has PyYAML; otherwise falls back to
// `uv run --with pyyaml python3` so no global pip install is required.

const PYTHON = "python3";

function canRun(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return !result.error && result.status === 0;
}

export function resolveYamlPythonCommand(probe: {
  hasUv: boolean;
  pythonHasYaml: boolean;
}): { args: string[]; command: string } | null {
  if (probe.pythonHasYaml) {
    return { command: PYTHON, args: [] };
  }
  if (probe.hasUv) {
    return { command: "uv", args: ["run", "--with", "pyyaml", PYTHON] };
  }
  return null;
}

const MISSING_YAML_HELP = [
  "[run-yaml-python] python3 cannot import yaml (PyYAML) and uv is not on PATH.",
  "Fix one of:",
  "  - Install uv (https://docs.astral.sh/uv/), e.g. `brew install uv`; scripts then run via `uv run --with pyyaml python3`",
  "  - Install PyYAML for your user: `python3 -m pip install --user pyyaml`",
].join("\n");

// Probes the machine and returns the command prefix to run a PyYAML script.
// Throws with install guidance when neither PyYAML nor uv is available.
export function resolveYamlPythonRunner(): { args: string[]; command: string } {
  const runner = resolveYamlPythonCommand({
    pythonHasYaml: canRun(PYTHON, ["-c", "import yaml"]),
    hasUv: canRun("uv", ["--version"]),
  });
  if (!runner) {
    throw new Error(MISSING_YAML_HELP);
  }
  if (runner.command !== PYTHON) {
    console.error(
      "[run-yaml-python] python3 has no PyYAML; using uv run --with pyyaml",
    );
  }
  return runner;
}

function main() {
  // pnpm forwards its "--" separator right after the script path from package.json
  // (or first, when called directly); any later "--" belongs to the Python script.
  const rawArgs = process.argv.slice(2);
  const sep = rawArgs[0] === "--" ? 0 : rawArgs[1] === "--" ? 1 : -1;
  const scriptArgs =
    sep < 0 ? rawArgs : [...rawArgs.slice(0, sep), ...rawArgs.slice(sep + 1)];
  if (scriptArgs.length === 0) {
    console.error(
      "Usage: node --experimental-strip-types ./scripts/run-yaml-python.ts <script.py> [args...]",
    );
    process.exit(2);
  }

  let runner: { args: string[]; command: string };
  try {
    runner = resolveYamlPythonRunner();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const result = spawnSync(runner.command, [...runner.args, ...scriptArgs], {
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
