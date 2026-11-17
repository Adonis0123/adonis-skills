import type { PluginHost, PluginItem } from "@/lib/plugin-schema";

// Install commands and the "Ask your AI" prompt, generated from the selected plugins.
// Pure functions: the plugin pages render them, the unit tests pin them.

export interface PluginMarketplace {
  /** What `--marketplace` takes, e.g. `Adonis0123/adonis-skills`. */
  source: string;
  /** Marketplace name; installed plugins are `<plugin>@<name>`. */
  name: string;
}

type Locale = "en" | "zh";
type InstallPlugin = Pick<PluginItem, "name" | "hosts">;

/** Minimum Claude Code version for one-step `claude plugin install --marketplace`. */
export const MIN_CLAUDE_CODE_VERSION = "2.1.292";

/** A command that deletes nothing: the path does not exist. Never /tmp, which delete-guard allows. */
export const DELETE_GUARD_PROBE = "rm -rf ./delete-guard-probe-missing";

export function supportsHost(plugin: InstallPlugin, host: PluginHost): boolean {
  return plugin.hosts.includes(host);
}

function joinCommands(commands: string[]): string | null {
  return commands.length > 0 ? commands.join(" && ") : null;
}

/** One command for every selected Claude Code plugin; null when none is selected. */
export function claudeInstallCommand(
  plugins: readonly InstallPlugin[],
  marketplace: PluginMarketplace,
): string | null {
  return joinCommands(
    plugins
      .filter((plugin) => supportsHost(plugin, "claude-code"))
      .map(
        (plugin) =>
          `claude plugin install ${plugin.name} --marketplace ${marketplace.source}`,
      ),
  );
}

/**
 * Codex: add the marketplace once, then each plugin that ships a Codex manifest; null when none.
 * Verified by a real install (2026-11-17). Codex runs a plugin's hooks only after the user trusts
 * them in `/hooks`.
 */
export function codexInstallCommand(
  plugins: readonly InstallPlugin[],
  marketplace: PluginMarketplace,
): string | null {
  const names = plugins
    .filter((plugin) => supportsHost(plugin, "codex"))
    .map((plugin) => plugin.name);
  if (names.length === 0) return null;
  return joinCommands([
    `codex plugin marketplace add ${marketplace.source}`,
    ...names.map((name) => `codex plugin add ${name}@${marketplace.name}`),
  ]);
}

export interface ClaudeManageCommands {
  disable: string;
  uninstall: string;
  update: string;
}

/** Disable / uninstall / update the selected plugins; null when none is selected. `claude plugin marketplace update` only refreshes the catalog, so updates use `claude plugin update` (measured 2026-11-17). */
export function claudeManageCommands(
  plugins: readonly InstallPlugin[],
  marketplace: PluginMarketplace,
): ClaudeManageCommands | null {
  const ids = plugins
    .filter((plugin) => supportsHost(plugin, "claude-code"))
    .map((plugin) => `${plugin.name}@${marketplace.name}`);
  if (ids.length === 0) return null;
  return {
    disable: ids.map((id) => `claude plugin disable ${id}`).join(" && "),
    uninstall: ids.map((id) => `claude plugin uninstall ${id}`).join(" && "),
    update: ids.map((id) => `claude plugin update ${id}`).join(" && "),
  };
}

/** `codex plugin remove` for the selected Codex plugins; null when none supports Codex. */
export function codexRemoveCommand(
  plugins: readonly InstallPlugin[],
  marketplace: PluginMarketplace,
): string | null {
  return joinCommands(
    plugins
      .filter((plugin) => supportsHost(plugin, "codex"))
      .map(
        (plugin) => `codex plugin remove ${plugin.name}@${marketplace.name}`,
      ),
  );
}

/**
 * Programs each plugin's hooks need on PATH, as its README's Install section lists them.
 * Optional helpers are left out (completion-claim-check uses perl only to time out git status).
 */
export const PLUGIN_REQUIREMENTS: Record<string, readonly string[]> = {
  "delete-guard": ["python3"],
  "bash-prompt-guard": ["python3"],
  "reply-language": ["python3"],
  "completion-claim-check": ["sh", "git", "jq"],
};

/** Union of the selected plugins' required programs, in first-seen order; [] when none needs any. */
export function pluginRequirements(
  plugins: readonly Pick<PluginItem, "name">[],
): string[] {
  return [
    ...new Set(
      plugins.flatMap((plugin) => PLUGIN_REQUIREMENTS[plugin.name] ?? []),
    ),
  ];
}

/** How to check each plugin in a new session; each probe is harmless when the hook is missing. */
const PROBES: Record<string, Record<Locale, string>> = {
  "delete-guard": {
    zh: `执行 ${DELETE_GUARD_PROBE}，应被拦`,
    en: `run ${DELETE_GUARD_PROBE}, expect a block`,
  },
  "bash-prompt-guard": {
    zh: "执行 echo ${HOME:t}，应被拦",
    en: "run echo ${HOME:t}, expect a denial",
  },
  // The Stop hook needs 60+ Latin letters and acts only when the target language is Chinese.
  "reply-language": {
    zh: "仅中文环境，用英文写三句话，应被拦",
    en: "only if my language is Chinese, reply in three English sentences, expect one stop",
  },
  "completion-claim-check": {
    zh: "需 jq，有未提交改动时只回“已完成”，应被拦",
    en: 'needs jq; with uncommitted changes reply only "done", expect one stop',
  },
};

function probeFor(name: string, locale: Locale): string {
  return (
    PROBES[name]?.[locale] ??
    (locale === "zh" ? "确认插件已启用" : "check the plugin is enabled")
  );
}

/**
 * The one line the user sends in a new session: hooks load only when a session starts, so
 * the session that installed the plugins cannot check them. "" when nothing is selected.
 */
export function installCheckLine(
  plugins: readonly InstallPlugin[],
  locale: Locale,
): string {
  if (plugins.length === 0) return "";
  const zh = locale === "zh";
  const checks = plugins.map((plugin) => {
    const onlyClaude = supportsHost(plugin, "codex")
      ? ""
      : zh
        ? "（仅 Claude）"
        : " (Claude Code only)";
    return `${plugin.name}${onlyClaude}${zh ? "：" : ": "}${probeFor(plugin.name, locale)}`;
  });
  return zh
    ? `逐项做并报结果：${checks.join("；")}。`
    : `Do each check and report: ${checks.join("; ")}.`;
}

/**
 * The "Ask your AI" prompt: environment check, fixed commands, things not to do, then a new
 * session (after Codex hook trust) where the user sends the check line and pastes the result
 * back. The installing session must not run the checks: its hooks are not loaded yet.
 * Returns "" when nothing is selected.
 */
export function buildInstallPrompt(
  plugins: readonly InstallPlugin[],
  marketplace: PluginMarketplace,
  locale: Locale,
): string {
  if (plugins.length === 0) return "";
  const zh = locale === "zh";
  const claude = claudeInstallCommand(plugins, marketplace);
  const codex = codexInstallCommand(plugins, marketplace);
  const checkLine = installCheckLine(plugins, locale);

  if (zh) {
    return [
      `安装 ${marketplace.name} 插件。`,
      "1. 仅限 Claude Code/Codex 和 macOS/Linux/WSL，否则停下。",
      "2. 只原样执行对应宿主的命令：",
      ...(claude ? [`Claude Code：${claude}`] : []),
      ...(codex ? [`Codex：${codex}`] : []),
      "3. 失败即停贴报错；不手写 hook，不改 settings.json，不用 sudo，不读 .env 和密钥，不动已有插件。",
      "4. hook 新会话才生效：不要在当前会话验证，这里没被拦不算失败。",
      codex
        ? "5. 请我新开会话（Codex 先在 /hooks 信任），把下行原样给我发到新会话，我贴回结果："
        : "5. 请我新开会话，把下行原样给我发到新会话，我贴回结果：",
      checkLine,
      "最后三行报：宿主系统、命令、验证行。",
    ].join("\n");
  }

  return [
    `Install the ${marketplace.name} plugins; check them only in a new session.`,
    "1. Only Claude Code or Codex on macOS, Linux or WSL; otherwise stop.",
    "2. Run only your host's command, unchanged:",
    ...(claude ? [`Claude Code: ${claude}`] : []),
    ...(codex ? [`Codex: ${codex}`] : []),
    "3. On failure, stop and show the error. Do not write hooks, edit settings.json, use sudo, read .env or secrets, or touch existing plugins.",
    "4. Hooks load only in a new session: do not run the checks in this session; nothing blocked here is not a failure.",
    codex
      ? "5. Ask me to open a new session (Codex: trust the hooks in /hooks first) and send the next line there unchanged; I will paste the result back:"
      : "5. Ask me to open a new session and send the next line there unchanged; I will paste the result back:",
    checkLine,
    "End with three lines: host and OS, commands run, the check line.",
  ].join("\n");
}

/**
 * Drops fenced code blocks whose every command line is already shown as a structured
 * command row (e.g. the README's `claude plugin disable …` under "Turning it off").
 * Prose and any block with other content are kept; returns "" when nothing is left.
 */
export function removeRepeatedCommandBlocks(
  markdown: string,
  shownCommands: readonly string[],
): string {
  const shown = new Set(shownCommands.map((command) => command.trim()));
  return markdown
    .replace(
      /^```[^\n]*\n([\s\S]*?)^```[ \t]*$\n?/gm,
      (block, body: string) => {
        const lines = body
          .split("\n")
          .map((line) => line.replace(/^\$\s+/, "").trim())
          .filter(Boolean);
        return lines.length > 0 && lines.every((line) => shown.has(line))
          ? ""
          : block;
      },
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
