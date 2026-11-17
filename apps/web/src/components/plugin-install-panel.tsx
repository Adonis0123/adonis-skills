"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { CommandBlock, CopyTextBlock } from "@/components/command-block";
import { InstallTabs, type InstallTab } from "@/components/host-install-tabs";
import { resolveLocaleValue } from "@/i18n/config";
import {
  MIN_CLAUDE_CODE_VERSION,
  type PluginMarketplace,
  buildInstallPrompt,
  claudeInstallCommand,
  claudeManageCommands,
  codexInstallCommand,
  codexRemoveCommand,
  pluginRequirements,
  supportsHost,
} from "@/lib/plugin-install";
import type { PluginItem } from "@/lib/plugin-schema";

type PluginTabId = "claude-code" | "codex" | "grok" | "ask-ai";

interface PluginInstallPanelProps {
  /** Selected plugins, in display order. */
  plugins: readonly Pick<PluginItem, "name" | "hosts">[];
  marketplace: PluginMarketplace;
  /** Show disable / uninstall / update rows under each command (off when the page has its own block). */
  showManage?: boolean;
  /** Extra README notes shown inside the folded disable / uninstall area. */
  manageNote?: ReactNode;
  className?: string;
}

const noteClass = "mt-3 text-sm text-pretty text-muted-foreground";

function ManageRow({
  label,
  command,
  ariaLabel,
}: {
  label: string;
  command: string;
  ariaLabel: string;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <CommandBlock commands={[command]} label={ariaLabel} />
      </dd>
    </div>
  );
}

/** Disable / uninstall / update rows, folded: needed later, so they never outweigh the install command. */
function ManageDisclosure({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group/manage mt-4 rounded-[14px] border border-border bg-card">
      <summary className="clay-focus-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-sm font-medium text-foreground transition-colors hover:text-link [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span
          className="icon-[lucide--chevron-down] size-4 text-muted-foreground transition-transform duration-200 ease-out group-open/manage:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="grid gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}

/** Install area for one or more plugins: a tab per Host plus an "Ask your AI" prompt. */
export function PluginInstallPanel({
  plugins,
  marketplace,
  showManage = true,
  manageNote,
  className,
}: PluginInstallPanelProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const tabs: InstallTab<PluginTabId>[] = [
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "grok", label: "Grok Build" },
    {
      id: "ask-ai",
      label: t({ id: "pluginInstall.tab.askAi", message: "Ask your AI" }),
    },
  ];

  const nothingSelected = (
    <p className="rounded-[12px] border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
      <Trans id="pluginInstall.empty">
        Tick at least one plugin below to get a command.
      </Trans>
    </p>
  );

  const requirements = pluginRequirements(plugins).join(", ");
  const requirementsNote = requirements ? (
    <p className={noteClass}>
      <Trans id="pluginInstall.requirements">
        Needs these programs on PATH: {requirements}
      </Trans>
    </p>
  ) : null;

  const renderPanel = (tab: PluginTabId) => {
    if (plugins.length === 0) return nothingSelected;

    if (tab === "claude-code") {
      const command = claudeInstallCommand(plugins, marketplace);
      const manage = claudeManageCommands(plugins, marketplace);
      if (!command || !manage) return nothingSelected;
      const minVersion = MIN_CLAUDE_CODE_VERSION;
      return (
        <>
          <CopyTextBlock
            key={`claude-code:${command}`}
            text={command}
            label={t({
              id: "pluginInstall.claude.copy.aria",
              message: "Copy the Claude Code install command",
            })}
          />
          <p className={noteClass}>
            <Trans id="pluginInstall.claude.note">
              Paste it into a terminal and run it; start a new session for it to
              take effect. Requires Claude Code ≥ {minVersion}. Works on macOS,
              Linux and WSL.
            </Trans>
          </p>
          {requirementsNote}
          {showManage && (
            <ManageDisclosure
              summary={
                <Trans id="pluginInstall.manage.summary">
                  Disable, uninstall or update later
                </Trans>
              }
            >
              <dl className="grid gap-2.5">
                <ManageRow
                  label={t({
                    id: "pluginInstall.manage.disable",
                    message: "Disable",
                  })}
                  command={manage.disable}
                  ariaLabel={t({
                    id: "pluginInstall.manage.disable.aria",
                    message: "Copy the disable command",
                  })}
                />
                <ManageRow
                  label={t({
                    id: "pluginInstall.manage.uninstall",
                    message: "Uninstall",
                  })}
                  command={manage.uninstall}
                  ariaLabel={t({
                    id: "pluginInstall.manage.uninstall.aria",
                    message: "Copy the uninstall command",
                  })}
                />
                <ManageRow
                  label={t({
                    id: "pluginInstall.manage.update",
                    message: "Update",
                  })}
                  command={manage.update}
                  ariaLabel={t({
                    id: "pluginInstall.manage.update.aria",
                    message: "Copy the update command",
                  })}
                />
              </dl>
              {manageNote}
            </ManageDisclosure>
          )}
        </>
      );
    }

    if (tab === "codex") {
      // Commands verified by a real Codex install (2026-11-17); hooks run only after /hooks trust.
      const command = codexInstallCommand(plugins, marketplace);
      const remove = codexRemoveCommand(plugins, marketplace);
      const claudeOnly = plugins
        .filter((plugin) => !supportsHost(plugin, "codex"))
        .map((plugin) => plugin.name)
        .join(", ");
      if (!command || !remove)
        return (
          <p className="rounded-[12px] border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            <Trans id="pluginInstall.codex.none">
              The selected plugins work in Claude Code only.
            </Trans>
          </p>
        );
      return (
        <>
          <CopyTextBlock
            key={`codex:${command}`}
            text={command}
            label={t({
              id: "pluginInstall.codex.copy.aria",
              message: "Copy the Codex install command",
            })}
          />
          <p className={noteClass}>
            <Trans id="pluginInstall.codex.note">
              Paste it into a terminal and run it, then start a new session. In
              Codex, run{" "}
              <code className="font-mono text-foreground">/hooks</code> and
              trust the plugin hooks, or they will not run.
            </Trans>
          </p>
          {requirementsNote}
          {claudeOnly && (
            <p className={noteClass}>
              <Trans id="pluginInstall.codex.skipped">
                Not included, Claude Code only: {claudeOnly}
              </Trans>
            </p>
          )}
          {showManage && (
            <ManageDisclosure
              summary={
                <Trans id="pluginInstall.manage.codexSummary">
                  Remove it later
                </Trans>
              }
            >
              <dl className="grid gap-2.5">
                <ManageRow
                  label={t({
                    id: "pluginInstall.manage.remove",
                    message: "Remove",
                  })}
                  command={remove}
                  ariaLabel={t({
                    id: "pluginInstall.manage.remove.aria",
                    message: "Copy the Codex remove command",
                  })}
                />
              </dl>
            </ManageDisclosure>
          )}
        </>
      );
    }

    if (tab === "grok") {
      // TODO(plugin-cmds): add the Grok Build install command once it has been tested.
      return (
        <p className="rounded-[12px] border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          <Trans id="pluginInstall.grok.soon">
            Coming soon. Grok Build install steps are still being tested.
          </Trans>
        </p>
      );
    }

    const prompt = buildInstallPrompt(plugins, marketplace, locale);
    return (
      <>
        <CopyTextBlock
          key={`ask-ai:${prompt}`}
          kind="prompt"
          text={prompt}
          label={t({
            id: "pluginInstall.askAi.copy.aria",
            message: "Copy the install prompt",
          })}
        />
        <p className={noteClass}>
          <Trans id="pluginInstall.askAi.note">
            Send it to Claude Code or Codex. The agent runs the command for its
            host, then gives you one line to send in a new session, where the
            hooks take effect.
          </Trans>
        </p>
      </>
    );
  };

  return (
    <InstallTabs<PluginTabId>
      tabs={tabs}
      defaultId="claude-code"
      storageKey="nika-skills:plugin-host"
      ariaLabel={t({
        id: "pluginInstall.tabs.aria",
        message: "Choose how to install",
      })}
      className={className}
    >
      {renderPanel}
    </InstallTabs>
  );
}
