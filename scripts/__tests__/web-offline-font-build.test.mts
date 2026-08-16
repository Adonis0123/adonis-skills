import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test(
  "web production build does not require Google Fonts",
  { timeout: 180_000 },
  () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "adonis-skills-fonts-"));
    const mockedResponses = path.join(fixtureDir, "google-fonts.cjs");
    writeFileSync(mockedResponses, "module.exports = {};\n", { mode: 0o600 });

    try {
      const result = spawnSync(
        "pnpm",
        ["--filter", "@adonis-skills/web", "exec", "next", "build"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            NEXT_FONT_GOOGLE_MOCKED_RESPONSES: mockedResponses,
          },
        },
      );

      assert.equal(
        result.status,
        0,
        `offline web build failed:\n${result.stdout}\n${result.stderr}`,
      );
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  },
);
