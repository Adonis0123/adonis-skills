"use client";

import { useDeferredValue, useMemo, useSyncExternalStore } from "react";
import { SKILL_TAG_SEARCH_LABELS } from "@/config/skill-tags";
import {
  SKILL_TAGS,
  type SkillListItem,
  type SkillTag,
} from "@/lib/skill-schema";
import { searchSkills } from "@/lib/skill-search";

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
  listeners.forEach((listener) => listener());
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
