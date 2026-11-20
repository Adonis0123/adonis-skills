"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { flashLine, flyTo } from "@/components/motion/fly-to";
import {
  FilterTransitionGroup,
  FilterTransitionItem,
  FilterTransitionList,
} from "@/components/motion/filter-transition";
import { RowHighlight } from "@/components/motion/row-highlight";
import { PluginRow, type PluginCardData } from "@/components/plugin-card";
import { PluginInstallPanel } from "@/components/plugin-install-panel";
import { useCatalogQuery } from "@/components/use-catalog-filters";
import { cx } from "@/components/ui/utils";
import { PLUGIN_CATEGORY_LABELS } from "@/config/plugins";
import { resolveLocaleValue } from "@/i18n/config";
import { bulkFlightDelays } from "@/lib/flight-path";
import type { PluginMarketplace } from "@/lib/plugin-install";
import {
  PLUGIN_CATEGORIES,
  type PluginCategory,
  groupPluginsByCategory,
} from "@/lib/plugin-schema";
import {
  addedNames,
  applySelectAll,
  getSelectAllState,
  type SelectAllState,
  togglePluginSelection,
} from "@/lib/plugin-selection";

interface PluginsCatalogProps {
  plugins: PluginCardData[];
  marketplace: PluginMarketplace;
  /** Shown under the list in the left column (the install box stays stuck beside it on desktop). */
  children?: ReactNode;
}

const chipClass = (selected: boolean) =>
  cx(
    "clay-focus-ring ink-box ink-box--pill inline-flex h-8 items-center gap-1.5 px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
    selected
      ? "bg-accent text-accent-foreground"
      : "bg-card text-foreground hover:bg-hover hover:[--ink-line:var(--primary)]",
  );

/**
 * Tri-state "select all" for the rows the filter shows: a visually hidden
 * native checkbox (`indeterminate` set as a DOM property, so assistive tech
 * reads "mixed") drawn like the row check boxes.
 */
function SelectAllCheckbox({
  state,
  count,
  onToggle,
}: {
  state: SelectAllState;
  count: number;
  onToggle: (origin: HTMLElement | null) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = state === "some";
  }, [state]);

  return (
    <label
      htmlFor={id}
      data-state={state}
      className="plugin-select-all inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-[8px] px-1.5 text-sm select-none"
    >
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        className="plugin-select sr-only"
        checked={state === "all"}
        disabled={count === 0}
        onChange={() => onToggle(markRef.current)}
        aria-label={t({
          id: "plugins.selectAll.aria",
          message: `Select all ${count} shown`,
        })}
      />
      <span
        ref={markRef}
        aria-hidden
        className="plugin-check ink-box ink-box--sm"
      >
        <span
          className={cx(
            state === "some" ? "icon-[lucide--minus]" : "icon-[lucide--check]",
            "size-3.5",
          )}
        />
      </span>
      <span aria-hidden>
        <Trans id="plugins.selectAll">Select all</Trans>
      </span>
    </label>
  );
}

/** The new plugin's word in the install command (`name`, or `name@marketplace` for Codex), if on screen. */
function findCommandWord(
  root: HTMLElement | null,
  name: string,
): HTMLElement | null {
  if (!root || root.getClientRects().length === 0) return null;
  for (const word of root.querySelectorAll<HTMLElement>("pre code span")) {
    const text = word.textContent ?? "";
    if (text === name || text.startsWith(`${name}@`)) {
      const rect = word.getBoundingClientRect();
      return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight
        ? word
        : null;
    }
  }
  return null;
}

/**
 * Plugin rows on the left, the install command on the right (after
 * coco-skills' PluginsCatalog). The list is one framed `.ink-box`: a header
 * row (title and count; category chips through `?group=`, as on /skills;
 * tri-state "select all" for the rows shown), then one selectable row per
 * plugin with the list's one sliding highlight behind. The install box
 * sticks beside the list and whatever follows it (`children`) from `lg`, its
 * top on the list's top; below `lg` it follows the list. Nothing is ticked
 * at first. Ticking a plugin flies a pill with its name onto its word in the
 * new command (fly-to.ts), which then flashes; reduced motion skips the
 * flight and the line just appears.
 */
export function PluginsCatalog({
  plugins,
  marketplace,
  children,
}: PluginsCatalogProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const { query, setGroup } = useCatalogQuery(PLUGIN_CATEGORIES);
  const catalogNames = useMemo(
    () => plugins.map((plugin) => plugin.name),
    [plugins],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const asideRef = useRef<HTMLElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLElement>(null);

  const groups = useMemo(() => groupPluginsByCategory(plugins), [plugins]);
  const activeCategory = query.group as PluginCategory | null;
  const visible = activeCategory
    ? plugins.filter((plugin) => plugin.category === activeCategory)
    : plugins;
  const visibleNames = visible.map((plugin) => plugin.name);
  const selectedSet = new Set(selected);
  const selectedPlugins = plugins.filter((plugin) =>
    selectedSet.has(plugin.name),
  );
  const selectAll = getSelectAllState(selected, visibleNames);

  /** Each added plugin (the first few of a bulk add) flies onto its word in the new command, or onto the count. */
  const launchFlights = (origin: HTMLElement | null, added: string[]) => {
    if (!origin?.isConnected) return;
    bulkFlightDelays(added.length).forEach((delayMs, index) => {
      const name = added[index];
      const word = findCommandWord(asideRef.current, name);
      const target = word ?? countRef.current;
      if (!target) return;
      void flyTo(origin, target, name, { delayMs, onLine: !!word }).then(
        (landed) => {
          if (landed && word?.isConnected) flashLine(word, word.closest("pre"));
        },
      );
    });
  };

  const commit = (next: string[], origin: HTMLElement | null) => {
    const added = addedNames(selected, next);
    setSelected(next);
    // The new command only exists once React has committed it: measure on the next frame.
    if (added.length > 0)
      requestAnimationFrame(() => launchFlights(origin, added));
  };

  const count = selected.length;
  const total = plugins.length;

  return (
    <section
      aria-labelledby="plugins-list-heading"
      className="grid items-start gap-(--page-space-y) lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-x-8"
    >
      <div className="ink-box min-w-0 bg-card lg:col-start-1 lg:row-start-1">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-2 pr-2 pl-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2
              id="plugins-list-heading"
              className="font-heading text-lg leading-tight font-bold"
            >
              <Trans id="plugins.list.heading">Pick plugins</Trans>
            </h2>
            <span className="type-mono text-xs text-muted-foreground">
              {total}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label={t({
                id: "plugins.filter.aria",
                message: "Filter by category",
              })}
              className="flex flex-wrap gap-1.5"
            >
              <button
                type="button"
                aria-pressed={!activeCategory}
                onClick={() => setGroup(null)}
                className={chipClass(!activeCategory)}
              >
                <Trans id="plugins.filter.all">All</Trans>
              </button>
              {groups
                .filter((group) => group.category)
                .map((group) => {
                  const category = group.category as PluginCategory;
                  const isSelected = activeCategory === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setGroup(isSelected ? null : category)}
                      className={chipClass(isSelected)}
                    >
                      {PLUGIN_CATEGORY_LABELS[category].title[locale]}
                      <span className="type-mono text-[11px] opacity-80">
                        {group.plugins.length}
                      </span>
                    </button>
                  );
                })}
            </div>
            <SelectAllCheckbox
              state={selectAll}
              count={visibleNames.length}
              onToggle={(origin) =>
                commit(
                  applySelectAll(selected, visibleNames, catalogNames),
                  origin,
                )
              }
            />
          </div>
        </div>

        <FilterTransitionGroup id="plugins-results">
          <div className="relative">
            <RowHighlight listRef={listRef} />
            <FilterTransitionList
              as="ul"
              ref={listRef}
              className="divide-y divide-border"
            >
              {visible.map((plugin, index) => (
                <FilterTransitionItem
                  as="li"
                  key={plugin.name}
                  index={index}
                  className="min-w-0"
                >
                  <PluginRow
                    plugin={plugin}
                    selected={selectedSet.has(plugin.name)}
                    onToggle={(name, origin) =>
                      commit(
                        togglePluginSelection(selected, name, catalogNames),
                        origin,
                      )
                    }
                  />
                </FilterTransitionItem>
              ))}
            </FilterTransitionList>
          </div>
        </FilterTransitionGroup>
      </div>

      <aside
        ref={asideRef}
        aria-labelledby="install"
        className="min-w-0 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1"
      >
        <div className="ink-box ink-box--xl ink-raised bg-tint dark:bg-card">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2 pr-2 pl-4">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2
                id="install"
                className="shrink-0 scroll-mt-24 font-heading text-lg leading-tight font-bold"
              >
                <Trans id="plugins.install.title">Install command</Trans>
              </h2>
              <span
                ref={countRef}
                aria-live="polite"
                className="truncate text-xs text-muted-foreground"
              >
                {count === 0 ? (
                  <Trans id="plugins.install.none">None selected</Trans>
                ) : (
                  <Trans id="plugins.install.count">
                    {count} of {total} selected
                  </Trans>
                )}
              </span>
            </div>
            {count > 0 && (
              <button
                type="button"
                onClick={() => setSelected([])}
                className="clay-focus-ring shrink-0 rounded-full px-2 py-1 text-sm font-medium text-link underline-offset-4 hover:underline"
              >
                <Trans id="plugins.install.clear">Clear</Trans>
              </button>
            )}
          </div>
          <div className="p-3 md:p-4">
            <PluginInstallPanel
              plugins={selectedPlugins}
              marketplace={marketplace}
              catalog
            />
          </div>
        </div>
      </aside>

      {children && (
        <div className="grid min-w-0 gap-(--page-space-y) lg:col-start-1 lg:row-start-2">
          {children}
        </div>
      )}
    </section>
  );
}
