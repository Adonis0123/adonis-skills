import assert from "node:assert/strict";
import test from "node:test";

import { parseSections } from "../generate-skills-index.mjs";

const doc = (body) => `---\nname: x\ndescription: y\n---\n${body}`;
const headings = (body) => parseSections(doc(body)).map((s) => s.heading);

test("splits a normal document on level 1-3 headings", () => {
  const sections = parseSections(
    doc("Intro\n\n## A\nalpha\n\n### B\nbeta\n\n#### C\ngamma"),
  );
  assert.deepEqual(sections, [
    { raw: "Intro" },
    { raw: "alpha", heading: "A", level: 2 },
    { raw: "beta\n\n#### C\ngamma", heading: "B", level: 3 },
  ]);
});

test("does not split on # lines inside backtick or tilde fences", () => {
  const body = [
    "## Template",
    "```markdown",
    "## Inside backticks",
    "```",
    "~~~",
    "# Inside tildes",
    "~~~",
    "## After",
    "done",
  ].join("\n");
  const sections = parseSections(doc(body));
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["Template", "After"],
  );
  assert.match(sections[0].raw, /## Inside backticks/);
  assert.match(sections[0].raw, /# Inside tildes/);
});

test("a fence closes only with the same character and at least the opening length", () => {
  const body = [
    "## Outer",
    "````md",
    "```",
    "## Still inside",
    "~~~~",
    "## Still inside too",
    "````",
    "## Next",
  ].join("\n");
  assert.deepEqual(headings(body), ["Outer", "Next"]);
});

test("an indented fence (up to 3 spaces) is recognized", () => {
  assert.deepEqual(headings("## A\n   ```\n## In fence\n   ```\n## B"), [
    "A",
    "B",
  ]);
});

test("keeps headings whose body is empty", () => {
  const sections = parseSections(
    doc("# Title\n## Workflow\n### Step 1\ndo it"),
  );
  assert.deepEqual(sections, [
    { raw: "", heading: "Title", level: 1 },
    { raw: "", heading: "Workflow", level: 2 },
    { raw: "do it", heading: "Step 1", level: 3 },
  ]);
});

test("returns no sections for an empty body", () => {
  assert.deepEqual(parseSections(doc("")), []);
});
