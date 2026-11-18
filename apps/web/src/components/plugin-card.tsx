"use client";

import { Fragment, useId } from "react";
import { useLingui } from "@lingui/react/macro";
import { cx } from "@/components/ui/utils";
import {
  PLUGIN_CATEGORY_LABELS,
  PLUGIN_HOST_LABELS,
  PLUGIN_TRIGGER_LABELS,
} from "@/config/plugins";
import { resolveLocaleValue } from "@/i18n/config";
import { LocaleLink } from "@/i18n/locale-link";
import type { PluginItem } from "@/lib/plugin-schema";

export type PluginCardData = Pick<
  PluginItem,
  "name" | "category" | "hosts" | "triggers" | "effect" | "scenario"
>;

/** Renders `code` spans in a one-line README excerpt; everything else stays plain text. */
export function InlineCodeText({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code
        key={index}
        className="rounded bg-muted px-[0.25em] py-px font-mono text-[0.92em] text-foreground"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

interface PluginCardProps {
  plugin: PluginCardData;
  selected: boolean;
  onToggle: (name: string) => void;
}

/** Catalog card: a checkbox that feeds the install command, the name linking to details, scenario and effect. */
export function PluginCard({ plugin, selected, onToggle }: PluginCardProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const checkboxId = useId();
  const name = plugin.name;
  const claudeOnly =
    plugin.hosts.length === 1 && plugin.hosts[0] === "claude-code";
  const scenario = plugin.scenario[locale];
  const effect = plugin.effect[locale];

  return (
    // Same structure as SkillCard: the title link stretches over the card (z-2) and the
    // checkbox sits above it (z-3), so no interactive element nests in another.
    <article
      className={cx(
        "skill-card h-full clay-focus-link-ring",
        selected && "border-link",
      )}
    >
      <div className="flex items-start gap-3">
        <label
          htmlFor={checkboxId}
          className="relative z-[3] -m-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-[10px] hover:bg-muted"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(name)}
            aria-label={t({
              id: "pluginCard.select.aria",
              message: `Include ${name} in the install command`,
            })}
            className="clay-focus-ring size-[18px] cursor-pointer rounded-[5px] accent-primary"
          />
        </label>
        <div className="min-w-0 flex-1">
          <h3 className="type-card-title static font-mono text-[15px] tracking-normal">
            <LocaleLink
              href={`/plugins/${name}`}
              className="outline-none after:absolute after:inset-0 after:z-[2] after:rounded-[inherit] after:content-['']"
            >
              {name}
            </LocaleLink>
          </h3>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {plugin.triggers
              .map((trigger) => PLUGIN_TRIGGER_LABELS[trigger][locale])
              .join(" · ")}
          </p>
        </div>
      </div>

      <dl className="mt-3.5 mb-4 grid gap-2 text-[13.5px] leading-[1.6]">
        {scenario && (
          <div>
            <dt className="font-medium text-foreground">
              {t({ id: "pluginCard.scenario", message: "Scenario" })}
            </dt>
            <dd className="text-muted-foreground">
              <InlineCodeText text={scenario} />
            </dd>
          </div>
        )}
        {effect && (
          <div>
            <dt className="font-medium text-foreground">
              {t({ id: "pluginCard.effect", message: "What it does" })}
            </dt>
            <dd className="text-muted-foreground">
              <InlineCodeText text={effect} />
            </dd>
          </div>
        )}
      </dl>

      <ul
        className="mt-auto flex flex-wrap items-center gap-1.5"
        aria-label={t({ id: "pluginCard.hosts.aria", message: "Works in" })}
      >
        {plugin.category && (
          <li className="nk-tag">
            {PLUGIN_CATEGORY_LABELS[plugin.category].title[locale]}
          </li>
        )}
        {claudeOnly ? (
          <li className="nk-tag nk-tag--neutral">
            {t({ id: "pluginCard.claudeOnly", message: "Claude Code only" })}
          </li>
        ) : (
          plugin.hosts.map((host) => (
            <li key={host} className="nk-tag nk-tag--neutral">
              {PLUGIN_HOST_LABELS[host]}
            </li>
          ))
        )}
      </ul>
    </article>
  );
}
