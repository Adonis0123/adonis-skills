"use client";

import { useLocalStorageState } from "ahooks";
import { useDeferredValue, useMemo, useSyncExternalStore } from "react";
import type { SkillTag } from "@/lib/skill-schema";
import {
  type CatalogQuery,
  EMPTY_CATALOG_QUERY,
  parseCatalogQuery,
  serializeCatalogQuery,
} from "@/lib/catalog-query";

// The URL (`?q=`, `?tag=`) is the single source of truth, so filtered views can be
// shared. replaceState does not emit events, so writers notify subscribers here.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const getSnapshot = () => window.location.search;
// The page is statically generated: render unfiltered on the server and hydrate from it.
const getServerSnapshot = () => "";

function notify() {
  listeners.forEach((listener) => listener());
}

/**
 * Writes the full /skills state to the URL. Discrete choices (group, tag,
 * sort) push a history entry so Back restores the previous view; typing
 * replaces the current entry so Back does not step through every keystroke.
 */
export function writeCatalogQuery(
  query: CatalogQuery,
  mode: "push" | "replace" = "push",
) {
  const url = new URL(window.location.href);
  url.search = serializeCatalogQuery(query);
  if (url.href === window.location.href) return;
  if (mode === "push") window.history.pushState(window.history.state, "", url);
  else window.history.replaceState(window.history.state, "", url);
  notify();
}

/** URL-backed filter state for the /skills page (`?q=&group=&tag=&sort=`). */
export function useCatalogQuery(groupIds: readonly string[]) {
  const search = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const query = useMemo(
    () => parseCatalogQuery(new URLSearchParams(search), groupIds),
    [search, groupIds],
  );
  const deferredQ = useDeferredValue(query.q);

  return {
    query,
    /** The search text used for filtering; lags typing slightly under load. */
    deferredQuery: useMemo(
      () => ({ ...query, q: deferredQ }),
      [query, deferredQ],
    ),
    setQ: (q: string) => writeCatalogQuery({ ...query, q }, "replace"),
    setGroup: (group: string | null) => writeCatalogQuery({ ...query, group }),
    toggleTag: (tag: SkillTag) =>
      writeCatalogQuery({
        ...query,
        tags: query.tags.includes(tag)
          ? query.tags.filter((value) => value !== tag)
          : [...query.tags, tag],
      }),
    setSort: (sort: CatalogQuery["sort"]) =>
      writeCatalogQuery({ ...query, sort }),
    clear: () =>
      writeCatalogQuery({ ...EMPTY_CATALOG_QUERY, sort: query.sort }),
  };
}

/** Sets only `?q=` on the current page (used when the header search submits on /skills). */
export function writeSearchParam(q: string) {
  const url = new URL(window.location.href);
  if (q.trim()) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  window.history.pushState(window.history.state, "", url);
  notify();
}

/** How /skills lays out its results: compact rows (default) or cards. */
export type CatalogView = "list" | "grid";

export const DEFAULT_CATALOG_VIEW: CatalogView = "list";

export const CATALOG_VIEW_STORAGE_KEY = "adonis-skills:catalog-view";

/**
 * The layout to render. During SSR and hydration (and for anything
 * unrecognised in storage) it is the default, so the server HTML and the
 * first client render agree; after hydration a stored choice wins.
 */
export function resolveCatalogView(
  hydrated: boolean,
  stored: unknown,
): CatalogView {
  if (!hydrated) return DEFAULT_CATALOG_VIEW;
  return stored === "grid" || stored === "list" ? stored : DEFAULT_CATALOG_VIEW;
}

const noopSubscribe = () => () => {};

/** The /skills layout, remembered per browser (localStorage). */
export function useCatalogView() {
  const [stored, setStored] = useLocalStorageState<CatalogView>(
    CATALOG_VIEW_STORAGE_KEY,
    { defaultValue: DEFAULT_CATALOG_VIEW },
  );
  // False during SSR and hydration, true afterwards.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return [
    resolveCatalogView(hydrated, stored),
    (view: CatalogView) => setStored(view),
  ] as const;
}
