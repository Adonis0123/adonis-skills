"use client";

import { Fragment, type KeyboardEvent, useId, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
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

interface PluginRowProps {
  plugin: PluginCardData;
  selected: boolean;
  /** `origin` is the check box, where the selection flight starts. */
  onToggle: (name: string, origin: HTMLElement | null) => void;
}

/**
 * One selectable row of the /plugins list (after coco-skills' PluginRow;
 * styles in effects-plugins.css): check box · name and trigger time over a
 * one-line "what it does" · category and host tags · "Details →". The row is
 * the selector: a visually hidden native checkbox whose label covers the row,
 * so a click anywhere ticks it; "Details" sits above the label and never
 * ticks. Space (native) and Enter toggle. Fixed height, hovered, ticked or
 * not; the list's one sliding highlight (RowHighlight) sits behind it, and a
 * ticked row keeps its left bar.
 */
export function PluginRow({ plugin, selected, onToggle }: PluginRowProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const inputId = useId();
  const markRef = useRef<HTMLSpanElement>(null);
  const name = plugin.name;
  const claudeOnly =
    plugin.hosts.length === 1 && plugin.hosts[0] === "claude-code";
  const effect = plugin.effect[locale] ?? "";
  const scenario = plugin.scenario[locale] ?? "";
  const triggers = plugin.triggers
    .map((trigger) => PLUGIN_TRIGGER_LABELS[trigger][locale])
    .join(" · ");
  const toggle = () => onToggle(name, markRef.current);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    toggle();
  };

  return (
    <div className="list-row plugin-row" data-selected={selected || undefined}>
      {/* First child, so `.plugin-select:focus-visible ~ …` can mark the row for the keyboard. */}
      <input
        id={inputId}
        type="checkbox"
        className="plugin-select sr-only"
        checked={selected}
        onChange={toggle}
        onKeyDown={onKeyDown}
        aria-label={t({
          id: "pluginCard.select.aria",
          message: `Include ${name} in the install command`,
        })}
        aria-keyshortcuts="Space Enter"
      />
      <span aria-hidden className="row-indicator" />
      {/* The row-sized hit area; the full scenario and effect come back as its tooltip. */}
      <label
        htmlFor={inputId}
        className="plugin-row-hit"
        title={[scenario, effect]
          .filter(Boolean)
          .join("\n")
          .replaceAll("`", "")}
      />
      <span
        ref={markRef}
        aria-hidden
        className="plugin-check ink-box ink-box--sm"
      >
        <span className="icon-[lucide--check] size-3.5" />
      </span>
      <div className="plugin-row-main">
        <p className="plugin-row-head">
          <span className="plugin-row-name type-mono">{name}</span>
          <span className="plugin-row-trigger">{triggers}</span>
        </p>
        <p className="plugin-row-effect">
          <InlineCodeText text={effect} />
        </p>
      </div>
      <ul
        className="plugin-row-tags"
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
      <LocaleLink
        href={`/plugins/${name}`}
        className="plugin-row-details"
        aria-label={t({
          id: "pluginCard.details.aria",
          message: `${name} details`,
        })}
      >
        {t({ id: "pluginCard.details", message: "Details" })}
        <span aria-hidden className="row-arrow icon-[lucide--arrow-right]" />
      </LocaleLink>
    </div>
  );
}
