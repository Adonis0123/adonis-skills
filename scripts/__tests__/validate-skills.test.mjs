import assert from "node:assert/strict";
import test from "node:test";

import {
  DESCRIPTION_MAX_LENGTH,
  descriptionProblems,
} from "../validate-skills.mjs";

const ok = "Generate commit messages from staged diffs. Use when committing.";

test("a normal description passes", () => {
  assert.deepEqual(descriptionProblems(ok), []);
});

test("exactly the limit passes, one over fails with the length and a fix", () => {
  assert.deepEqual(descriptionProblems("a".repeat(DESCRIPTION_MAX_LENGTH)), []);
  const [problem] = descriptionProblems("a".repeat(DESCRIPTION_MAX_LENGTH + 1));
  assert.match(problem, /1025 字符/);
  assert.match(problem, /删掉重复的触发词/);
});

test("length counts characters, not bytes", () => {
  assert.deepEqual(
    descriptionProblems("派".repeat(DESCRIPTION_MAX_LENGTH)),
    [],
  );
});

test("surrounding whitespace is not counted", () => {
  assert.deepEqual(
    descriptionProblems(`  ${"a".repeat(DESCRIPTION_MAX_LENGTH)}\n`),
    [],
  );
});

test("XML tags are reported, plain comparisons are not", () => {
  const [problem] = descriptionProblems(`${ok} e.g. '/figma-mcp <url> 做页面'`);
  assert.match(problem, /<url>/);
  assert.deepEqual(
    descriptionProblems(`${ok} Keep tool count < 30 and > 5.`),
    [],
  );
});

test("too short descriptions keep the existing message", () => {
  assert.match(descriptionProblems("short")[0], /过短/);
});
