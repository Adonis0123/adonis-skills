import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Checks that SKILL.md makes this skill the verification step for a UI change
// without turning readiness into acceptance or forcing screenshots on log questions.
const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const description =
  skill.split("\n").find((line) => line.startsWith("description:")) ?? "";
const { evals } = JSON.parse(
  readFileSync(join(skillDir, "evals", "evals.json"), "utf8"),
);
const triggers = JSON.parse(
  readFileSync(join(skillDir, "evals", "trigger-eval.json"), "utf8"),
);
const evalFor = (prompt) => evals.find((entry) => entry.prompt === prompt);

test("UI-change acceptance requires screenshot path, Console, and Network", () => {
  // The repo validator requires an ASCII description, so the Chinese trigger
  // phrases live in trigger-eval.json and the description states the intent.
  assert.match(
    description,
    /verification step right after the user or this session changes a web UI/,
  );
  assert.match(description, /asks to accept or check a page/);
  assert.match(skill, /this skill is the verification step/);
  assert.match(skill, /before calling the change done/);
  assert.match(
    skill,
    /`take_screenshot` with `filePath` under the runtime temp root shows the resulting UI/,
  );
  assert.match(
    skill,
    /`list_console_messages` read after the interaction shows new errors/,
  );
  assert.match(
    skill,
    /`list_network_requests` entry shows the request the change should have made/,
  );
  const accept = evalFor("改完设置页了，用 /chrome-dev-mcp 验收");
  assert.ok(accept, "eval for the settings-page acceptance prompt is missing");
  const text = accept.expectations.join("\n");
  assert.match(text, /screenshot with filePath/);
  assert.match(text, /Console/);
  assert.match(text, /Network/);
  for (const pattern of [/验收这个页面/, /改完 UI.*chrome-dev-mcp 看一下/]) {
    assert.ok(
      triggers.some(
        (entry) => entry.should_trigger && pattern.test(entry.query),
      ),
      `positive trigger ${pattern} is missing`,
    );
  }
});

test("readiness and list_pages alone are not VERIFIED", () => {
  assert.match(
    skill,
    /`CHROME_DEV_MCP_READY` and `list_pages` prove the connection only\. Claim a task `VERIFIED` only after the requested/,
  );
  assert.match(description, /proves the connection only, never the change/);
  assert.ok(
    evalFor("改完设置页了，用 /chrome-dev-mcp 验收").expectations.some((e) =>
      /CHROME_DEV_MCP_READY or list_pages alone as VERIFIED/.test(e),
    ),
  );
});

test("a pure Console question does not require a screenshot", () => {
  assert.match(
    skill,
    /A question only about Console or Network on an already open page needs just that evidence, not a screenshot/,
  );
  const consoleOnly = evalFor("看看这个页面 Console 里为什么有红色报错");
  assert.ok(consoleOnly, "eval for the Console-only prompt is missing");
  assert.ok(
    consoleOnly.expectations.some((e) =>
      /Does not require a screenshot/.test(e),
    ),
  );
});

test("the skill no longer hands product-page verification to the calling task", () => {
  assert.doesNotMatch(skill, /stays with the calling task/);
  assert.doesNotMatch(skill, /not a page-acceptance entry point/);
});

test("ordinary navigation and scraping stay out of scope", () => {
  assert.match(
    description,
    /Do not use it for ordinary navigation, form filling, scraping, or desktop UI unless browser-internal signals or UI-change acceptance are required/,
  );
  for (const pattern of [/填表/, /抓取公开商品列表/, /滚到价格表并截图/]) {
    assert.ok(
      triggers.some(
        (entry) => !entry.should_trigger && pattern.test(entry.query),
      ),
      `negative trigger ${pattern} is missing`,
    );
  }
});

test("no-request UI changes still require a successful Network read", () => {
  assert.match(
    skill,
    /When no request is expected.*successfully read empty Network list/,
  );
  assert.match(skill, /Do not invent or replay a request/);
  const noRequest = evals.find((entry) => entry.name === "ui-style-no-request");
  assert.ok(noRequest, "no-request UI acceptance eval is missing");
  assert.ok(
    noRequest.expectations.some((e) => /Reads Network evidence/.test(e)),
  );
  assert.ok(
    noRequest.expectations.some((e) =>
      /Does not mark.*UNVERIFIED solely/.test(e),
    ),
  );
});

test("missing expected requests and failed Network reads remain unverified", () => {
  assert.match(
    skill,
    /An expected request that is absent, or a Network call that fails.*UNVERIFIED/,
  );
  const missing = evals.find(
    (entry) => entry.name === "ui-submit-request-missing",
  );
  assert.ok(missing, "missing expected request eval is missing");
  assert.ok(
    missing.expectations.some((e) =>
      /missing expected request.*UNVERIFIED/.test(e),
    ),
  );
  assert.ok(
    missing.expectations.some((e) =>
      /Does not label an expected request as not applicable/.test(e),
    ),
  );
});
