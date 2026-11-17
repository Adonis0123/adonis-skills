import type { AppLocale } from "@/i18n/config";
import type {
  PluginCategory,
  PluginHost,
  PluginTrigger,
} from "@/lib/plugin-schema";

type Localized = Record<AppLocale, string>;

// Bilingual labels for values that come from the plugin data contract
// (same approach as skill tags: data, not UI copy).

export const PLUGIN_CATEGORY_LABELS: Record<
  PluginCategory,
  { title: Localized; summary: Localized }
> = {
  safety: {
    title: { en: "Safety", zh: "安全防护" },
    summary: {
      en: "Stop commands whose damage cannot be undone.",
      zh: "拦下删了找不回的命令。",
    },
  },
  unattended: {
    title: { en: "Unattended runs", zh: "无人值守" },
    summary: {
      en: "Keep long runs from stalling on a prompt nobody answers.",
      zh: "别让长任务卡在没人点的确认框上。",
    },
  },
  "reply-quality": {
    title: { en: "Reply quality", zh: "回复质量" },
    summary: {
      en: "Check the final reply before the turn ends.",
      zh: "回合结束前检查最后那条回复。",
    },
  },
};

export const PLUGIN_UNCATEGORIZED_LABEL: Localized = {
  en: "Other",
  zh: "其他",
};

export const PLUGIN_TRIGGER_LABELS: Record<PluginTrigger, Localized> = {
  "before-bash": { en: "Before Bash runs", zh: "执行 Bash 前" },
  "reply-end": { en: "When a reply ends", zh: "回复结束时" },
};

/** Product names; not translated. */
export const PLUGIN_HOST_LABELS: Record<PluginHost, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

/** Third-party alternative listed at the bottom of /plugins. */
export const CC_SAFETY_NET_URL = "https://github.com/kenryu42/cc-safety-net";

/** Official docs behind the host-support marks in the "what a plugin can carry" grid. */
export const PLUGIN_DOCS = {
  claudeCode: "https://code.claude.com/docs/en/plugins-reference",
  codexPlugins: "https://developers.openai.com/plugins/build/plugins",
  codexHooks: "https://learn.chatgpt.com/docs/hooks",
} as const;
