import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PluginIndexError,
  buildPluginIndex,
} from "../apps/web/src/lib/plugin-index.ts";

// Scans .claude-plugin/marketplace.json and plugins/* into the web app's plugin index.
// The output is ignored by Git (apps/web/.gitignore). With a marketplace file, any entry that cannot be
// indexed (bad source, README without the fixed headings) fails the run with exit code 1; production
// builds also fail when the index file is missing (apps/web/src/lib/plugins.ts).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "apps/web/src/generated/plugins-index.json");

async function main() {
  const index = buildPluginIndex(root, (message) =>
    console.warn(`[plugins:index] warning: ${message}`),
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`Generated ${index.plugins.length} plugins -> ${outputPath}`);
}

main().catch((error) => {
  if (error instanceof PluginIndexError) {
    console.error(`[plugins:index] failed, nothing written:`);
    for (const problem of error.problems) console.error(`  - ${problem}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
