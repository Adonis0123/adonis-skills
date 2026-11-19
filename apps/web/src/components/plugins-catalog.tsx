"use client";

import { useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  FilterTransitionBlock,
  FilterTransitionGroup,
  FilterTransitionItem,
  FilterTransitionList,
} from "@/components/motion/filter-transition";
import { PressScale } from "@/components/motion/press-scale";
import { PluginCard, type PluginCardData } from "@/components/plugin-card";
import { PluginInstallPanel } from "@/components/plugin-install-panel";
import { useCatalogQuery } from "@/components/use-catalog-filters";
import { cx } from "@/components/ui/utils";
import {
  PLUGIN_CATEGORY_LABELS,
  PLUGIN_UNCATEGORIZED_LABEL,
} from "@/config/plugins";
import { resolveLocaleValue } from "@/i18n/config";
import type { PluginMarketplace } from "@/lib/plugin-install";
import {
  PLUGIN_CATEGORIES,
  type PluginCategory,
  groupPluginsByCategory,
} from "@/lib/plugin-schema";

interface PluginsCatalogProps {
  plugins: PluginCardData[];
  marketplace: PluginMarketplace;
}

const chipClass = (selected: boolean) =>
  cx(
    "clay-focus-ring ink-box ink-box--pill hand-label inline-flex h-9 items-center gap-2 px-3.5 text-base transition-colors pointer-coarse:h-10",
    selected
      ? "bg-accent text-accent-foreground"
      : "bg-card text-foreground hover:bg-hover hover:[--ink-line:var(--primary)]",
  );

/**
 * Install area plus the plugin cards. Ticking a card changes the install command
 * (all ticked by default); `?group=<category>` filters the cards, same as /skills.
 */
export function PluginsCatalog({ plugins, marketplace }: PluginsCatalogProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const { query, setGroup } = useCatalogQuery(PLUGIN_CATEGORIES);
  const [selectedNames, setSelectedNames] = useState<ReadonlySet<string>>(
    () => new Set(plugins.map((plugin) => plugin.name)),
  );

  const selected = useMemo(
    () => plugins.filter((plugin) => selectedNames.has(plugin.name)),
    [plugins, selectedNames],
  );
  const groups = useMemo(() => groupPluginsByCategory(plugins), [plugins]);
  const activeCategory = query.group as PluginCategory | null;
  const visibleGroups = activeCategory
    ? groups.filter((group) => group.category === activeCategory)
    : groups;

  const toggle = (name: string) =>
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allSelected = selected.length === plugins.length;
  const selectedCount = selected.length;
  const totalCount = plugins.length;

  return (
    <>
      <section
        aria-labelledby="install"
        className="ink-box ink-box--xl ink-raised bg-tint p-5 md:p-7 dark:bg-card"
      >
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="install" className="type-h3 scroll-mt-24">
              <Trans id="plugins.install.heading">
                Tick plugins, copy one command
              </Trans>
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <Trans id="plugins.install.selected">
                {selectedCount} of {totalCount} selected. The command and the
                prompt follow the cards below.
              </Trans>
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setSelectedNames(
                allSelected
                  ? new Set()
                  : new Set(plugins.map((plugin) => plugin.name)),
              )
            }
            className="clay-focus-ring rounded-full px-1.5 py-1 text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            {allSelected
              ? t({ id: "plugins.install.clearAll", message: "Clear all" })
              : t({ id: "plugins.install.selectAll", message: "Select all" })}
          </button>
        </div>
        <PluginInstallPanel plugins={selected} marketplace={marketplace} />
      </section>

      <div
        role="group"
        aria-label={t({
          id: "plugins.filter.aria",
          message: "Filter by category",
        })}
        className="mt-10 flex flex-wrap gap-2"
      >
        <PressScale>
          <button
            type="button"
            aria-pressed={!activeCategory}
            onClick={() => setGroup(null)}
            className={chipClass(!activeCategory)}
          >
            <Trans id="plugins.filter.all">All</Trans>
            <span className="type-mono text-[11.5px] opacity-80">
              {totalCount}
            </span>
          </button>
        </PressScale>
        {groups
          .filter((group) => group.category)
          .map((group) => {
            const category = group.category as PluginCategory;
            const isSelected = activeCategory === category;
            return (
              <PressScale key={category}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setGroup(isSelected ? null : category)}
                  className={chipClass(isSelected)}
                >
                  {PLUGIN_CATEGORY_LABELS[category].title[locale]}
                  <span className="type-mono text-[11.5px] opacity-80">
                    {group.plugins.length}
                  </span>
                </button>
              </PressScale>
            );
          })}
      </div>

      <FilterTransitionGroup id="plugins-results">
        <div className="mt-6 grid gap-9">
          {visibleGroups.map((group) => {
            const id = group.category ?? "other";
            return (
              <FilterTransitionBlock
                as="section"
                key={id}
                aria-labelledby={`plugins-group-${id}`}
              >
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2
                    id={`plugins-group-${id}`}
                    className="font-heading text-lg leading-tight font-bold"
                  >
                    {group.category
                      ? PLUGIN_CATEGORY_LABELS[group.category].title[locale]
                      : PLUGIN_UNCATEGORIZED_LABEL[locale]}
                  </h2>
                  {group.category && (
                    <p className="text-sm text-muted-foreground">
                      {PLUGIN_CATEGORY_LABELS[group.category].summary[locale]}
                    </p>
                  )}
                </div>
                <FilterTransitionList
                  as="ul"
                  className="grid content-start gap-3.5 sm:grid-cols-2 xl:grid-cols-3"
                >
                  {group.plugins.map((plugin, index) => (
                    <FilterTransitionItem
                      as="li"
                      key={plugin.name}
                      index={index}
                      className="min-w-0"
                    >
                      <PluginCard
                        plugin={plugin}
                        selected={selectedNames.has(plugin.name)}
                        onToggle={toggle}
                      />
                    </FilterTransitionItem>
                  ))}
                </FilterTransitionList>
              </FilterTransitionBlock>
            );
          })}
        </div>
      </FilterTransitionGroup>
    </>
  );
}
