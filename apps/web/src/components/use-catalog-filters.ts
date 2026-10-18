"use client";

import { useDeferredValue, useMemo, useSyncExternalStore } from "react";
import { SKILL_TAG_SEARCH_LABELS } from "@/config/skill-tags";
import {
  SKILL_TAGS,
  type SkillListItem,
  type SkillTag,
} from "@/lib/skill-schema";
import { searchSkills } from "@/lib/skill-search";
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

function writeParam(key: "q" | "tag", value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
  notify();
}

function isSkillTag(value: string): value is SkillTag {
  return (SKILL_TAGS as readonly string[]).includes(value);
}

/** First known tag among repeated `?tag=` params; unknown values are ignored. */
export function parseTagParam(params: URLSearchParams): SkillTag | null {
  return params.getAll("tag").find(isSkillTag) ?? null;
}

/** Which filters produced an empty result, so the empty state can suggest the right fix. */
export type EmptyResultCause = "query" | "tag" | "both";

export function getEmptyResultCause(
  query: string,
  tag: SkillTag | null,
): EmptyResultCause | null {
  const hasQuery = query.trim() !== "";
  if (hasQuery && tag) return "both";
  if (hasQuery) return "query";
  return tag ? "tag" : null;
}

export function useCatalogFilters(skills: SkillListItem[]) {
  const search = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const query = params.get("q") ?? "";
  const tag = parseTagParam(params);
  const deferredQuery = useDeferredValue(query);

  const filteredSkills = useMemo(() => {
    const byTag = tag
      ? skills.filter((skill) => skill.catalog.tags.includes(tag))
      : skills;
    return searchSkills(byTag, deferredQuery, SKILL_TAG_SEARCH_LABELS);
  }, [skills, tag, deferredQuery]);

  return {
    query,
    setQuery: (value: string) => writeParam("q", value),
    tag,
    setTag: (value: SkillTag | null) => writeParam("tag", value),
    filteredSkills,
    isFiltering: query.trim().length > 0 || tag !== null,
    clearFilters: () => {
      writeParam("q", null);
      writeParam("tag", null);
    },
  };
}

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
