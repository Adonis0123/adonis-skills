import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PluginIndexError,
  buildPluginIndex,
  deriveHosts,
  deriveTriggers,
  effectLine,
  firstSentence,
  parseReadme,
} from "@/lib/plugin-index";
import { groupPluginsByCategory } from "@/lib/plugin-schema";

const ZH_README = `[English](./README.md) | 中文

# delete-guard

拦下删了找不回的命令。agent 用全权限跑时，它只防误删。

## 遇到的场景

为了少点确认框，我们常让 agent 开全权限跑。这时它清理目录用 \`rm -rf\`。

## 为什么要用

全权限省掉了确认。

\`\`\`text
## 这不是标题
\`\`\`

### 小标题留在正文

## 会拦什么

| 命令 | 结果 |
| --- | --- |
| \`rm -rf src/old\` | 拦下 |

## 安装

不属于契约的标题，丢弃。

## 停用

\`claude plugin disable delete-guard@adonis-skills\`
`;

const EN_README = `[English](./README.md) | [中文](./README.zh-CN.md)

# delete-guard

Blocks commands whose deletions cannot be undone.

## Scenario

Agents clean up with \`rm -rf ./build.old\` in full-permission mode, e.g. during long runs. Nothing is in the trash afterwards.

## What the agent sees:

\`\`\`text
Blocked: rm -rf src/old
\`\`\`

## Turning it off

Run the disable command.
`;

describe("parseReadme", () => {
  it("keeps only the fixed ## sections and the lead under the H1", () => {
    const { lead, sections } = parseReadme(ZH_README, "zh");
    expect(lead).toBe("拦下删了找不回的命令。agent 用全权限跑时，它只防误删。");
    expect(Object.keys(sections)).toEqual([
      "scenario",
      "whyUse",
      "whatItBlocks",
      "turningOff",
    ]);
    expect(sections.turningOff).toBe(
      "`claude plugin disable delete-guard@adonis-skills`",
    );
  });

  it("does not split inside code fences and keeps ### in the body", () => {
    const { sections } = parseReadme(ZH_README, "zh");
    expect(sections.whyUse).toContain("## 这不是标题");
    expect(sections.whyUse).toContain("### 小标题留在正文");
    expect(sections.whatItBlocks).toContain("| `rm -rf src/old` | 拦下 |");
  });

  it("matches English headings case-insensitively and ignores a trailing colon", () => {
    const { sections } = parseReadme(EN_README, "en");
    expect(sections.scenario).toMatch(/^Agents clean up/);
    expect(sections.whatAgentSees).toContain("Blocked: rm -rf src/old");
    expect(sections.turningOff).toBe("Run the disable command.");
    expect(sections.whyBuilt).toBeUndefined();
  });

  it("returns empty parts for an empty README", () => {
    expect(parseReadme("", "en")).toEqual({ lead: "", sections: {} });
  });
});

describe("firstSentence", () => {
  it("stops at Chinese sentence punctuation", () => {
    expect(
      firstSentence("为了少点确认框，我们常让 agent 开全权限跑。这时它……"),
    ).toBe("为了少点确认框，我们常让 agent 开全权限跑。");
  });

  it("skips dots in inline code, paths and abbreviations", () => {
    expect(
      firstSentence(
        "Agents clean up with `rm -rf ./build.old` in full mode, e.g. during long runs. Nothing is left.",
      ),
    ).toBe(
      "Agents clean up with `rm -rf ./build.old` in full mode, e.g. during long runs.",
    );
    expect(firstSentence("Run rm -rf ./x then stop. Next.")).toBe(
      "Run rm -rf ./x then stop.",
    );
  });

  it("uses only the first paragraph and strips list markers", () => {
    expect(
      firstSentence("- first item without a stop\n\nSecond paragraph."),
    ).toBe("first item without a stop");
  });
});

describe("effectLine", () => {
  it("drops the plugin self-description in both languages", () => {
    expect(
      effectLine(
        "Hook plugin: denies Bash commands the permission check cannot parse. More text.",
      ),
    ).toBe("Denies Bash commands the permission check cannot parse.");
    expect(
      effectLine(
        "一个 Claude Code 和 Codex 用的 hook 插件。它拦下会让文件找不回的删除命令，并让 agent 改用废纸篓。",
      ),
    ).toBe("它拦下会让文件找不回的删除命令，并让 agent 改用废纸篓。");
    expect(
      effectLine(
        "一个 Claude Code 和 Codex 用的 hook 插件，让回复保持你的语言。装上就生效。",
      ),
    ).toBe("让回复保持你的语言。");
  });

  it("keeps text without a self-description", () => {
    expect(effectLine("拦下删了找不回的命令。其余放行。")).toBe(
      "拦下删了找不回的命令。",
    );
    expect(effectLine("")).toBe("");
    expect(effectLine("一个 Codex 用的 hook 插件。agent 说完成时检查。")).toBe(
      "agent 说完成时检查。",
    );
  });
});

describe("deriveHosts", () => {
  it("maps manifests to hosts in a fixed order", () => {
    expect(deriveHosts({ claude: true, codex: true })).toEqual([
      "claude-code",
      "codex",
    ]);
    expect(deriveHosts({ claude: true, codex: false })).toEqual([
      "claude-code",
    ]);
    expect(deriveHosts({ claude: false, codex: false })).toEqual([]);
  });
});

describe("deriveTriggers", () => {
  it("maps PreToolUse on Bash and Stop, ignoring other events", () => {
    expect(
      deriveTriggers({
        hooks: {
          Stop: [{ hooks: [] }],
          PostToolUse: [{ hooks: [] }],
          PreToolUse: [{ matcher: "Bash", hooks: [] }],
        },
      }),
    ).toEqual(["before-bash", "reply-end"]);
  });

  it("treats regex and empty matchers that cover Bash as before-bash", () => {
    expect(
      deriveTriggers({ hooks: { PreToolUse: [{ matcher: "Edit|Bash" }] } }),
    ).toEqual(["before-bash"]);
    expect(deriveTriggers({ hooks: { PreToolUse: [{ hooks: [] }] } })).toEqual([
      "before-bash",
    ]);
    expect(
      deriveTriggers({ hooks: { PreToolUse: [{ matcher: "Write" }] } }),
    ).toEqual([]);
  });

  it("returns nothing for malformed files", () => {
    expect(deriveTriggers(null)).toEqual([]);
    expect(deriveTriggers({ hooks: "nope" })).toEqual([]);
    expect(deriveTriggers({ hooks: { PostToolUse: [{}] } })).toEqual([]);
  });
});

describe("groupPluginsByCategory", () => {
  it("orders groups by category and puts uncategorised plugins last", () => {
    const groups = groupPluginsByCategory([
      { name: "a", category: "reply-quality" as const },
      { name: "b", category: null },
      { name: "c", category: "safety" as const },
      { name: "d", category: "reply-quality" as const },
    ]);
    expect(
      groups.map((group) => [group.category, group.plugins.map((p) => p.name)]),
    ).toEqual([
      ["safety", ["c"]],
      ["reply-quality", ["a", "d"]],
      [null, ["b"]],
    ]);
  });

  it("returns no groups for no plugins", () => {
    expect(groupPluginsByCategory([])).toEqual([]);
  });
});

describe("buildPluginIndex", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true });
  });

  function fixture(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-index-"));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(root, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return root;
  }

  // Appends the required headings the parse fixtures leave out, so a plugin passes the contract.
  const COMPLETE_EN = `${EN_README}
## Why use it

It keeps deletes recoverable.

## How it works

A PreToolUse hook.

## What it blocks

Recursive deletes.
`;
  const COMPLETE_ZH = `${ZH_README}
## 怎么做到的

一个 PreToolUse hook。

## 被拦下时 agent 会看到

拦截原因。
`;
  const readmes = (dir: string) => ({
    [`plugins/${dir}/README.md`]: COMPLETE_EN,
    [`plugins/${dir}/README.zh-CN.md`]: COMPLETE_ZH,
  });

  it("indexes ./plugins entries per the data contract", () => {
    const root = fixture({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "adonis-skills",
        plugins: [
          { name: "adonis-skills", source: "./", description: "skills bundle" },
          {
            name: "delete-guard",
            source: "./plugins/delete-guard",
            description: "Blocks deletes that cannot be undone.",
            category: "safety",
            tags: ["hooks", "safety"],
          },
          {
            name: "bash-prompt-guard",
            source: "./plugins/bash-prompt-guard",
            description: "Denies unparseable Bash.",
            category: "unattended",
          },
        ],
      }),
      "plugins/delete-guard/.claude-plugin/plugin.json": "{}",
      "plugins/delete-guard/.codex-plugin/plugin.json": "{}",
      "plugins/delete-guard/hooks/hooks.json": JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] },
      }),
      ...readmes("delete-guard"),
      "plugins/bash-prompt-guard/.claude-plugin/plugin.json": "{}",
      "plugins/bash-prompt-guard/hooks/hooks.json": JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash" }] },
      }),
      ...readmes("bash-prompt-guard"),
    });
    const warnings: string[] = [];
    const index = buildPluginIndex(root, (message) => warnings.push(message));

    expect(index.marketplace).toBe("adonis-skills");
    expect(index.plugins.map((plugin) => plugin.name)).toEqual([
      "delete-guard",
      "bash-prompt-guard",
    ]);
    const [guard, prompt] = index.plugins;
    expect(guard.hosts).toEqual(["claude-code", "codex"]);
    expect(guard.triggers).toEqual(["before-bash"]);
    expect(guard.tags).toEqual(["hooks", "safety"]);
    expect(guard.effect).toEqual({
      en: "Blocks deletes that cannot be undone.",
      zh: "拦下删了找不回的命令。",
    });
    expect(guard.scenario.zh).toBe(
      "为了少点确认框，我们常让 agent 开全权限跑。",
    );
    expect(guard.scenario.en).toMatch(
      /^Agents clean up .* during long runs\.$/,
    );
    expect(guard.sourcePath).toBe("plugins/delete-guard");
    expect(prompt.hosts).toEqual(["claude-code"]);
    expect(prompt.effect.en).toBe("Denies unparseable Bash.");
    expect(warnings).toEqual([]);
  });

  it("only warns on a missing or unknown category", () => {
    const root = fixture({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "m",
        plugins: [
          { name: "loose", source: "./plugins/loose", category: "other" },
        ],
      }),
      ...readmes("loose"),
    });
    const warnings: string[] = [];
    const index = buildPluginIndex(root, (message) => warnings.push(message));
    expect(
      index.plugins.map((plugin) => [plugin.name, plugin.category]),
    ).toEqual([["loose", null]]);
    expect(index.plugins[0].hosts).toEqual([]);
    expect(warnings.join("\n")).toMatch(/loose: missing or unknown category/);
  });

  function problemsOf(root: string): string[] {
    try {
      buildPluginIndex(root);
    } catch (error) {
      expect(error).toBeInstanceOf(PluginIndexError);
      return [...(error as PluginIndexError).problems];
    }
    throw new Error("expected buildPluginIndex to throw");
  }

  it("fails on a source that does not exist or is not ./plugins/<name>, naming the plugin", () => {
    const root = fixture({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "m",
        plugins: [
          { name: "m", source: "./" },
          { name: "ghost", source: "./plugins/ghost" },
          { name: "stray", source: "./plugin/stray" },
          { name: "ok", source: "./plugins/ok" },
        ],
      }),
      ...readmes("ok"),
    });
    const problems = problemsOf(root);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(
      /^ghost: source \.\/plugins\/ghost does not exist; fix the source/,
    );
    expect(problems[1]).toMatch(
      /^stray: source "\.\/plugin\/stray" is not "\.\/plugins\/<name>"/,
    );
  });

  it("fails when a README lacks a required heading; Why we built it stays optional", () => {
    const root = fixture({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "m",
        plugins: [{ name: "half", source: "./plugins/half" }],
      }),
      "plugins/half/README.md": EN_README,
      "plugins/half/README.zh-CN.md": COMPLETE_ZH,
    });
    expect(problemsOf(root)).toEqual([
      'half: plugins/half/README.md is missing or has an empty ## "Why use it", "How it works", "What it blocks"; add these headings with text under each',
    ]);
  });

  it("fails on a name that is not lowercase hyphen-case", () => {
    const root = fixture({
      ".claude-plugin/marketplace.json": JSON.stringify({
        name: "m",
        plugins: [{ name: "Delete_Guard", source: "./plugins/delete-guard" }],
      }),
      ...readmes("delete-guard"),
    });
    expect(problemsOf(root)[0]).toMatch(
      /^Delete_Guard: name must be lowercase hyphen-case/,
    );
  });

  it("returns an empty index without a marketplace", () => {
    const root = fixture({ "README.md": "x" });
    expect(buildPluginIndex(root)).toEqual({ marketplace: "", plugins: [] });
  });
});
