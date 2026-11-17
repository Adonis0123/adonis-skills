import { describe, expect, it } from "vitest";
import {
  DELETE_GUARD_PROBE,
  buildInstallPrompt,
  claudeInstallCommand,
  claudeManageCommands,
  codexInstallCommand,
  codexRemoveCommand,
  installCheckLine,
  pluginRequirements,
  removeRepeatedCommandBlocks,
} from "@/lib/plugin-install";
import type { PluginHost } from "@/lib/plugin-schema";

const marketplace = {
  source: "Adonis0123/adonis-skills",
  name: "adonis-skills",
};
const both: PluginHost[] = ["claude-code", "codex"];
const ALL = [
  { name: "delete-guard", hosts: both },
  { name: "bash-prompt-guard", hosts: ["claude-code"] as PluginHost[] },
  { name: "reply-language", hosts: both },
  { name: "completion-claim-check", hosts: both },
];
const claudeOnly = ALL.filter((plugin) => plugin.name === "bash-prompt-guard");

describe("claudeInstallCommand", () => {
  it("joins one install per plugin with &&", () => {
    expect(claudeInstallCommand(ALL.slice(0, 2), marketplace)).toBe(
      "claude plugin install delete-guard --marketplace Adonis0123/adonis-skills && " +
        "claude plugin install bash-prompt-guard --marketplace Adonis0123/adonis-skills",
    );
  });

  it("is null when nothing is selected", () => {
    expect(claudeInstallCommand([], marketplace)).toBeNull();
  });
});

describe("codexInstallCommand", () => {
  it("adds the marketplace once and skips Claude-only plugins", () => {
    expect(codexInstallCommand(ALL.slice(0, 2), marketplace)).toBe(
      "codex plugin marketplace add Adonis0123/adonis-skills && " +
        "codex plugin add delete-guard@adonis-skills",
    );
  });

  it("is null when every selected plugin is Claude-only, or nothing is selected", () => {
    expect(codexInstallCommand(claudeOnly, marketplace)).toBeNull();
    expect(codexInstallCommand([], marketplace)).toBeNull();
  });
});

describe("claudeManageCommands", () => {
  it("addresses installed plugins as <name>@<marketplace>", () => {
    expect(claudeManageCommands(ALL.slice(0, 1), marketplace)).toEqual({
      disable: "claude plugin disable delete-guard@adonis-skills",
      uninstall: "claude plugin uninstall delete-guard@adonis-skills",
      update: "claude plugin update delete-guard@adonis-skills",
    });
    expect(claudeManageCommands([], marketplace)).toBeNull();
  });
});

describe("codexRemoveCommand", () => {
  it("removes only Codex plugins, addressed as <name>@<marketplace>", () => {
    expect(codexRemoveCommand(ALL.slice(0, 2), marketplace)).toBe(
      "codex plugin remove delete-guard@adonis-skills",
    );
    expect(codexRemoveCommand(claudeOnly, marketplace)).toBeNull();
  });
});

describe("pluginRequirements", () => {
  it("lists the union of the selected plugins' required programs", () => {
    expect(pluginRequirements(ALL)).toEqual(["python3", "sh", "git", "jq"]);
    expect(pluginRequirements(ALL.slice(0, 3))).toEqual(["python3"]);
    expect(pluginRequirements(ALL.slice(3))).toEqual(["sh", "git", "jq"]);
    expect(pluginRequirements([])).toEqual([]);
  });

  it("does not list perl, which completion-claim-check only uses when present", () => {
    expect(pluginRequirements(ALL)).not.toContain("perl");
  });
});

describe("installCheckLine", () => {
  it("is one line covering every selected plugin", () => {
    for (const locale of ["zh", "en"] as const) {
      const line = installCheckLine(ALL, locale);
      expect(line).not.toContain("\n");
      for (const plugin of ALL) expect(line).toContain(plugin.name);
      expect(line).toContain(DELETE_GUARD_PROBE);
    }
    expect(installCheckLine(ALL, "zh")).toContain(
      "completion-claim-check：需 jq",
    );
    expect(installCheckLine(claudeOnly, "zh")).toContain(
      "bash-prompt-guard（仅 Claude）",
    );
    expect(installCheckLine([], "en")).toBe("");
  });
});

describe("buildInstallPrompt", () => {
  it("tells Codex to trust the hooks only when a Codex plugin is selected", () => {
    expect(buildInstallPrompt(ALL, marketplace, "zh")).toContain("/hooks");
    const en = buildInstallPrompt(ALL.slice(0, 1), marketplace, "en");
    expect(en).toContain("/hooks");
    expect(en).not.toContain("jq");
    expect(buildInstallPrompt(claudeOnly, marketplace, "en")).not.toContain(
      "/hooks",
    );
  });

  it("never checks in the installing session: new session, check line, result pasted back", () => {
    const zh = buildInstallPrompt(ALL, marketplace, "zh");
    expect(zh).toContain("不要在当前会话验证");
    expect(zh).toContain("没被拦不算失败");
    expect(zh).toContain("新开会话");
    expect(zh).toContain("贴回结果");
    const en = buildInstallPrompt(ALL, marketplace, "en");
    expect(en).toContain("do not run the checks in this session");
    expect(en).toContain("nothing blocked here is not a failure");
    expect(en).toContain("open a new session");
    expect(en).toContain("paste the result back");
    // The check line is handed over as its own line, after the new-session step.
    for (const [locale, prompt] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      const lines = prompt.split("\n");
      const step5 = lines.findIndex((line) => line.startsWith("5. "));
      expect(lines[step5 + 1]).toBe(installCheckLine(ALL, locale));
    }
  });

  it("stays within 1000 characters in Chinese with every plugin selected", () => {
    expect(
      [...buildInstallPrompt(ALL, marketplace, "zh")].length,
    ).toBeLessThanOrEqual(1000);
  });

  it("keeps English within 1600 characters (the install commands alone are about 590)", () => {
    const prompt = buildInstallPrompt(ALL, marketplace, "en");
    expect(prompt.split(/\s+/).length).toBeLessThanOrEqual(1000);
    expect(prompt.length).toBeLessThanOrEqual(1600);
  });

  it("carries the exact install commands", () => {
    for (const locale of ["zh", "en"] as const) {
      const prompt = buildInstallPrompt(ALL, marketplace, locale);
      expect(prompt).toContain(claudeInstallCommand(ALL, marketplace)!);
      expect(prompt).toContain(codexInstallCommand(ALL, marketplace)!);
    }
  });

  it("checks delete-guard with a missing path in the project, never /tmp", () => {
    for (const locale of ["zh", "en"] as const) {
      const prompt = buildInstallPrompt(ALL.slice(0, 1), marketplace, locale);
      expect(prompt).toContain(DELETE_GUARD_PROBE);
      expect(prompt).not.toContain("/tmp");
    }
  });

  it("omits the Codex command when only Claude-only plugins are selected", () => {
    const prompt = buildInstallPrompt(claudeOnly, marketplace, "zh");
    expect(prompt).toContain(
      "Claude Code：claude plugin install bash-prompt-guard",
    );
    expect(prompt).not.toContain("Codex：");
  });

  it("is empty when nothing is selected", () => {
    expect(buildInstallPrompt([], marketplace, "en")).toBe("");
  });
});

describe("removeRepeatedCommandBlocks", () => {
  const disable = "claude plugin disable delete-guard@adonis-skills";

  it("drops a fenced block that only repeats a shown command and keeps the prose", () => {
    const readme = [
      "```bash",
      disable,
      "```",
      "",
      "In Codex, run `codex plugin remove delete-guard@adonis-skills`.",
      "",
      "Set `REPLY_LANGUAGE=off`.",
    ].join("\n");
    expect(removeRepeatedCommandBlocks(readme, [disable])).toBe(
      "In Codex, run `codex plugin remove delete-guard@adonis-skills`.\n\nSet `REPLY_LANGUAGE=off`.",
    );
  });

  it("is empty when the section was only the repeated block", () => {
    expect(
      removeRepeatedCommandBlocks(`\`\`\`bash\n$ ${disable}\n\`\`\`\n`, [
        disable,
      ]),
    ).toBe("");
  });

  it("keeps a block that has any other command", () => {
    const readme = `\`\`\`bash\n${disable}\nexport REPLY_LANGUAGE=off\n\`\`\``;
    expect(removeRepeatedCommandBlocks(readme, [disable])).toBe(readme);
  });
});
