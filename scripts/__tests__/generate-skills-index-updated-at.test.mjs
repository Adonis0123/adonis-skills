import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDirtySlugs,
  resolveUpdatedAt,
} from "../generate-skills-index.mjs";

const now = new Date("2026-10-19T14:42:04.123Z");
const noGit = () => assert.fail("git log must not be read");

test("a dirty skill gets today's UTC date at day precision", () => {
  assert.equal(
    resolveUpdatedAt({
      dirty: true,
      committed: "2026-10-01T09:00:00.000Z",
      readGit: noGit,
      now,
    }),
    "2026-10-19T00:00:00.000Z",
  );
});

test("a dirty brand-new skill also gets today's UTC midnight", () => {
  assert.equal(
    resolveUpdatedAt({
      dirty: true,
      committed: undefined,
      readGit: noGit,
      now,
    }),
    "2026-10-19T00:00:00.000Z",
  );
});

test("a clean skill keeps the date the committed index ships", () => {
  assert.equal(
    resolveUpdatedAt({
      dirty: false,
      committed: "2026-10-01T09:00:00.000Z",
      readGit: noGit,
      now,
    }),
    "2026-10-01T09:00:00.000Z",
  );
});

test("a clean skill missing from the committed index falls back to git log", () => {
  assert.equal(
    resolveUpdatedAt({
      dirty: false,
      committed: undefined,
      readGit: () => "2026-09-30T08:00:00.000Z",
      now,
    }),
    "2026-09-30T08:00:00.000Z",
  );
});

test("parseDirtySlugs reads modified, untracked and renamed skill paths", () => {
  const status = [
    " M skills/agent-dispatch/SKILL.md",
    "?? skills/new-skill/SKILL.md",
    "R  skills/renamed-to/SKILL.md",
    "skills/renamed-from/SKILL.md",
    " M apps/web/src/generated/skills-index-lite.json",
    "",
  ].join("\0");
  assert.deepEqual([...parseDirtySlugs(status)].sort(), [
    "agent-dispatch",
    "new-skill",
    "renamed-from",
    "renamed-to",
  ]);
});
