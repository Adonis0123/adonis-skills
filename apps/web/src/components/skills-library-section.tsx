"use client";

import { useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { SkillCard } from "@/components/skill-card";
import {
  getEmptyResultCause,
  useCatalogFilters,
} from "@/components/use-catalog-filters";
import { ClayButton } from "@/components/ui";
import { cx } from "@/components/ui/utils";
import { SKILL_TAG_LABELS } from "@/config/skill-tags";
import { resolveLocaleValue } from "@/i18n/config";
import { SKILL_TAGS, type SkillTag } from "@/lib/skill-schema";
import type { SkillListItem } from "@/lib/skills";

interface SkillsLibrarySectionProps {
  skills: SkillListItem[];
}

const chipClass =
  "clay-focus-ring inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors pointer-coarse:h-11";

export function SkillsLibrarySection({ skills }: SkillsLibrarySectionProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    query,
    setQuery,
    tag,
    setTag,
    filteredSkills,
    isFiltering,
    clearFilters,
  } = useCatalogFilters(skills);
  const resultCount = filteredSkills.length;
  const totalCount = skills.length;
  const emptyCause = getEmptyResultCause(query, tag);

  const renderChip = (value: SkillTag | null, label: string) => {
    const active = tag === value;
    return (
      <button
        key={value ?? "all"}
        type="button"
        aria-pressed={active}
        onClick={() => setTag(value)}
        className={cx(
          chipClass,
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-card text-foreground hover:bg-accent",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <section
      id="skills"
      aria-labelledby="skills-title"
      className="scroll-mt-24"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h2 id="skills-title" className="text-3xl md:text-4xl">
          <Trans id="home.library.title">Skills</Trans>
        </h2>

        <div className="clay-surface clay-tone-base clay-elevation-inset flex h-12 w-full items-center gap-2.5 rounded-[1rem] px-4 clay-focus-within-ring sm:w-96">
          <span
            className="icon-[lucide--search] size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t({
              id: "home.search.input.aria",
              message: "Search skills",
            })}
            placeholder={t({
              id: "home.search.placeholder",
              message: "Search in English or 中文…",
            })}
            className="min-w-0 flex-1 appearance-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="clay-focus-ring -mr-2 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t({
                id: "home.search.clear",
                message: "Clear search",
              })}
            >
              <span className="icon-[lucide--x] size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div
        // Padding leaves room for focus rings. On mobile the right edge fades to hint that the row
        // scrolls, and the wider end padding lets the last chip scroll fully clear of the fade.
        className="-mx-2 mb-5 flex gap-2 overflow-x-auto py-1.5 pr-10 pl-2 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] sm:pr-2 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label={t({ id: "home.filter.aria", message: "Filter by tag" })}
      >
        {renderChip(null, t({ id: "home.filter.all", message: "All" }))}
        {SKILL_TAGS.map((value) =>
          renderChip(value, SKILL_TAG_LABELS[value][locale]),
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        <Trans id="home.search.resultCount">
          {resultCount} of {totalCount} skills shown
        </Trans>
      </p>

      {resultCount > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredSkills.map((skill) => (
            <li key={skill.slug} className="min-w-0">
              <SkillCard skill={skill} />
            </li>
          ))}
        </ul>
      ) : isFiltering ? (
        <div className="clay-surface clay-tone-base flex flex-col items-center px-6 py-14 text-center">
          <span
            className="icon-[lucide--search-x] mb-4 size-10 text-muted-foreground"
            aria-hidden
          />
          <p className="text-lg font-bold text-pretty">
            {query.trim() ? (
              <Trans id="home.search.emptyTitleQuery">
                No skills match “{query}”
              </Trans>
            ) : (
              <Trans id="home.search.emptyTitle">No matching skills</Trans>
            )}
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground text-pretty">
            {
              {
                query: (
                  <Trans id="home.search.emptyHint">
                    Try another word, in English or Chinese.
                  </Trans>
                ),
                tag: (
                  <Trans id="home.search.emptyHintTagOnly">
                    No skills carry this tag yet. Pick another tag.
                  </Trans>
                ),
                both: (
                  <Trans id="home.search.emptyHintTag">
                    Try another word, or clear the tag filter.
                  </Trans>
                ),
              }[emptyCause ?? "query"]
            }
          </p>
          <ClayButton
            variant="secondary"
            size="sm"
            className="mt-5"
            onClick={clearFilters}
          >
            <Trans id="home.search.clearFilters">Clear filters</Trans>
          </ClayButton>
        </div>
      ) : null}
    </section>
  );
}
