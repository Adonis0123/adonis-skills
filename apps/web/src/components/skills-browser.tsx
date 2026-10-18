"use client";

import Image from "next/image";
import { type FormEvent, useMemo, useRef } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { PRIMARY_SEARCH_ATTR } from "@/components/layout/header-search";
import {
  FilterTransitionBlock,
  FilterTransitionGroup,
  FilterTransitionItem,
  FilterTransitionList,
} from "@/components/motion/filter-transition";
import { PressScale } from "@/components/motion/press-scale";
import { SkillCard } from "@/components/skill-card";
import { useCatalogQuery } from "@/components/use-catalog-filters";
import { ClayButton } from "@/components/ui";
import { cx } from "@/components/ui/utils";
import { SKILL_TAG_LABELS, SKILL_TAG_SEARCH_LABELS } from "@/config/skill-tags";
import { resolveLocaleValue } from "@/i18n/config";
import {
  applyCatalogQuery,
  type CatalogSort,
  CATALOG_SORTS,
  filterByQueryAndTags,
  isCatalogQueryActive,
} from "@/lib/catalog-query";
import { countByGroup, groupSkills } from "@/lib/skill-groups";
import { SKILL_TAGS } from "@/lib/skill-schema";
import {
  getIllustrationSrc,
  type CatalogGroup,
  type CatalogLayout,
  type SkillListItem,
} from "@/lib/skills";

interface SkillsBrowserProps {
  skills: SkillListItem[];
  layout: CatalogLayout;
  /** GitHub "new issue" URL for the empty state's request link. */
  requestSkillUrl: string;
}

const EMPTY_ILLUSTRATION = "group-review.webp";

const sidebarItemClass = (selected: boolean) =>
  cx(
    "scenario-chip clay-focus-ring border lg:h-auto lg:min-h-10 lg:w-full lg:gap-2.5 lg:rounded-[10px] lg:py-1.5 lg:pr-2.5 lg:pl-1.5 lg:whitespace-normal",
    selected
      ? "scenario-chip--selected lg:border-transparent"
      : "lg:border-transparent lg:bg-transparent lg:hover:bg-muted",
  );

function GroupAvatar({ group, size }: { group: CatalogGroup; size: number }) {
  return (
    <span className="art-avatar" style={{ width: size, height: size }}>
      <Image
        src={getIllustrationSrc(group.illustration)}
        alt=""
        width={1024}
        height={1024}
        sizes={`${size}px`}
      />
    </span>
  );
}

function ResultsGrid({
  skills,
  featuredSlugs,
}: {
  skills: SkillListItem[];
  featuredSlugs: ReadonlySet<string>;
}) {
  // Keyed by slug so search, group, tag and sort changes re-flow cards instead of re-mounting them.
  return (
    <FilterTransitionList
      as="ul"
      data-skill-results
      className="grid content-start gap-3.5 sm:grid-cols-2 xl:grid-cols-3"
    >
      {skills.map((skill, index) => (
        <FilterTransitionItem
          as="li"
          key={skill.slug}
          index={index}
          data-slug={skill.slug}
          className="min-w-0"
        >
          <SkillCard skill={skill} featured={featuredSlugs.has(skill.slug)} />
        </FilterTransitionItem>
      ))}
    </FilterTransitionList>
  );
}

/** The full catalog at /skills: search, scenario sidebar, tag filters, and sorting, all in the URL. */
export function SkillsBrowser({
  skills,
  layout,
  requestSkillUrl,
}: SkillsBrowserProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupIds = useMemo(
    () => layout.groups.map((group) => group.id),
    [layout.groups],
  );
  const { query, deferredQuery, setQ, setGroup, toggleTag, setSort, clear } =
    useCatalogQuery(groupIds);

  const featuredSlugs = useMemo(
    () => new Set(layout.featured.map((entry) => entry.slug)),
    [layout.featured],
  );
  // Sidebar counts follow search and tags but not the group itself.
  const matched = useMemo(
    () => filterByQueryAndTags(skills, deferredQuery, SKILL_TAG_SEARCH_LABELS),
    [skills, deferredQuery],
  );
  const groupCounts = useMemo(() => countByGroup(matched), [matched]);
  const results = useMemo(
    () =>
      applyCatalogQuery(
        skills,
        deferredQuery,
        layout,
        SKILL_TAG_SEARCH_LABELS,
        locale,
      ),
    [skills, deferredQuery, layout, locale],
  );
  const activeGroup = layout.groups.find((group) => group.id === query.group);
  const sections =
    !activeGroup && query.sort === "group"
      ? groupSkills(results, layout)
      : null;
  const filtering = isCatalogQueryActive(query);
  const resultCount = results.length;
  const totalCount = skills.length;

  const sortLabels: Record<CatalogSort, string> = {
    group: t({ id: "skills.sort.group", message: "By scenario" }),
    updated: t({ id: "skills.sort.updated", message: "Recently updated" }),
    name: t({ id: "skills.sort.name", message: "A–Z" }),
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    inputRef.current?.blur();
  };

  return (
    <>
      <header className="mb-6 md:mb-8">
        <p className="kicker kicker-leaf">
          <Trans id="skills.kicker">Library</Trans>
        </p>
        <h1 className="type-h2 mt-2 md:text-[2.5rem]">
          <Trans id="skills.title">All skills</Trans>
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          <Trans id="skills.intro">
            {totalCount} skills for Claude Code, Codex, Cursor and Hermes Agent.
            Pick a scenario, narrow by tag, or just search.
          </Trans>
        </p>
      </header>

      <form
        role="search"
        onSubmit={onSubmit}
        className="search-bar flex h-[54px] items-center gap-3 pr-2.5 pl-5 md:h-[62px]"
      >
        <span
          className="icon-[lucide--search] size-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          {...{ [PRIMARY_SEARCH_ATTR]: "" }}
          type="search"
          value={query.q}
          onChange={(event) => setQ(event.target.value)}
          aria-label={t({ id: "skills.search.aria", message: "Search skills" })}
          placeholder={t({
            id: "skills.search.placeholder",
            message: "Search by task, name or tag, in English or 中文",
          })}
          className="h-full min-w-0 flex-1 appearance-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {query.q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="clay-focus-ring relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t({
              id: "skills.search.clear",
              message: "Clear search",
            })}
          >
            <span className="icon-[lucide--x] size-4" aria-hidden />
          </button>
        )}
        <span className="type-mono shrink-0 rounded-[8px] bg-muted px-2.5 py-1.5 text-[12px] text-muted-foreground">
          {filtering ? (
            <Trans id="skills.search.countFiltered">
              {resultCount} / {totalCount}
            </Trans>
          ) : (
            <Plural
              id="skills.search.count"
              value={totalCount}
              one="# skill"
              other="# skills"
            />
          )}
        </span>
      </form>
      <p className="sr-only" aria-live="polite">
        <Trans id="skills.search.resultCount">
          {resultCount} of {totalCount} skills shown
        </Trans>
      </p>

      <div className="mt-5 grid gap-5 lg:mt-8 lg:grid-cols-[256px_minmax(0,1fr)] lg:gap-10">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <p className="kicker mb-2 hidden text-muted-foreground lg:block">
            <Trans id="skills.sidebar.title">Scenarios</Trans>
          </p>
          <nav
            aria-label={t({
              id: "skills.sidebar.aria",
              message: "Filter by scenario",
            })}
            // Mobile: one scrolling chip row with a fading right edge; desktop: a sticky list.
            className="-mx-[var(--site-gutter)] overflow-x-auto px-[var(--site-gutter)] py-1 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] lg:mx-0 lg:overflow-visible lg:px-0 lg:[mask-image:none] [&::-webkit-scrollbar]:hidden"
          >
            <ul className="flex w-max gap-2 pr-8 lg:w-auto lg:flex-col lg:gap-0.5 lg:pr-0">
              <li>
                <PressScale display="block" noLift>
                  <button
                    type="button"
                    aria-pressed={!query.group}
                    onClick={() => setGroup(null)}
                    className={sidebarItemClass(!query.group)}
                  >
                    <span className="art-avatar grid size-[26px] place-items-center text-muted-foreground">
                      <span
                        className="icon-[lucide--layout-grid] size-3.5"
                        aria-hidden
                      />
                    </span>
                    <span className="lg:flex-1 lg:text-left">
                      <Trans id="skills.sidebar.all">All</Trans>
                    </span>
                    <span className="type-mono text-[11.5px] text-muted-foreground">
                      {matched.length}
                    </span>
                  </button>
                </PressScale>
              </li>
              {layout.groups.map((group) => {
                const selected = query.group === group.id;
                return (
                  <li key={group.id}>
                    <PressScale display="block" noLift>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setGroup(selected ? null : group.id)}
                        className={sidebarItemClass(selected)}
                      >
                        <GroupAvatar group={group} size={26} />
                        <span className="lg:min-w-0 lg:flex-1 lg:text-left lg:leading-snug">
                          {group.title[locale]}
                        </span>
                        <span className="type-mono text-[11.5px] text-muted-foreground">
                          {groupCounts.get(group.id) ?? 0}
                        </span>
                      </button>
                    </PressScale>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <FilterTransitionGroup id="skills-results">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div
                role="group"
                aria-label={t({
                  id: "skills.tags.aria",
                  message: "Filter by tag",
                })}
                className="flex flex-wrap gap-1.5"
              >
                {SKILL_TAGS.map((tag) => {
                  const selected = query.tags.includes(tag);
                  return (
                    <PressScale key={tag}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleTag(tag)}
                        className={cx(
                          "clay-focus-ring inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] font-medium transition-colors pointer-coarse:h-10",
                          selected
                            ? "border-tint-border bg-accent text-accent-foreground"
                            : "border-border bg-card text-muted-foreground hover:border-tint-border hover:text-foreground",
                        )}
                      >
                        {selected && (
                          <span
                            className="icon-[lucide--check] size-3.5"
                            aria-hidden
                          />
                        )}
                        {SKILL_TAG_LABELS[tag][locale]}
                      </button>
                    </PressScale>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Trans id="skills.sort.label">Sort</Trans>
                <span className="relative">
                  <select
                    value={query.sort}
                    onChange={(event) =>
                      setSort(event.target.value as CatalogSort)
                    }
                    className="clay-focus-ring h-9 appearance-none rounded-[10px] border border-input bg-card pr-8 pl-3 text-sm font-medium text-foreground"
                  >
                    {CATALOG_SORTS.map((sort) => (
                      <option key={sort} value={sort}>
                        {sortLabels[sort]}
                      </option>
                    ))}
                  </select>
                  <span
                    className="icon-[lucide--chevron-down] pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
                    aria-hidden
                  />
                </span>
              </label>
            </div>

            {activeGroup && resultCount > 0 && (
              <div className="mb-5 flex items-start gap-4 rounded-[16px] border border-border bg-card p-4 md:p-5">
                <span className="art-avatar art-avatar--ringed size-14 shrink-0">
                  <Image
                    src={getIllustrationSrc(activeGroup.illustration)}
                    alt=""
                    width={1024}
                    height={1024}
                    sizes="56px"
                  />
                </span>
                <div className="min-w-0">
                  <h2 className="type-h3">{activeGroup.title[locale]}</h2>
                  <p className="mt-1 text-[14.5px] leading-[1.6] text-muted-foreground">
                    {activeGroup.summary[locale]}
                  </p>
                </div>
              </div>
            )}

            {resultCount === 0 ? (
              <div className="flex flex-col items-center rounded-[22px] border border-dashed border-border px-4 pt-12 pb-10 text-center">
                <span className="art-avatar mb-5 size-[120px]">
                  <Image
                    src={getIllustrationSrc(EMPTY_ILLUSTRATION)}
                    alt=""
                    width={1024}
                    height={1024}
                    sizes="120px"
                  />
                </span>
                <h2 className="type-h3">
                  <Trans id="skills.empty.title">Nothing found</Trans>
                </h2>
                <p className="mt-2 max-w-md text-pretty text-muted-foreground">
                  <Trans id="skills.empty.hint">
                    Kiki looked everywhere. Try another word or fewer filters,
                    or ask for the skill you need.
                  </Trans>
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <PressScale>
                    <ClayButton size="sm" onClick={clear}>
                      <span
                        className="icon-[lucide--rotate-ccw] size-4"
                        aria-hidden
                      />
                      <Trans id="skills.empty.clear">Clear filters</Trans>
                    </ClayButton>
                  </PressScale>
                  <ClayButton asChild variant="secondary" size="sm">
                    <a
                      href={requestSkillUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span
                        className="icon-[lucide--github] size-4"
                        aria-hidden
                      />
                      <Trans id="skills.empty.request">
                        Request a skill on GitHub
                      </Trans>
                    </a>
                  </ClayButton>
                </div>
              </div>
            ) : sections ? (
              <div className="grid gap-9">
                {sections.map((section) => (
                  <FilterTransitionBlock
                    as="section"
                    key={section.group.id}
                    aria-labelledby={`skills-group-${section.group.id}`}
                  >
                    <div className="mb-3 flex items-center gap-2.5">
                      <GroupAvatar group={section.group} size={30} />
                      <h2
                        id={`skills-group-${section.group.id}`}
                        className="font-heading text-lg leading-tight font-bold"
                      >
                        {section.group.title[locale]}
                      </h2>
                      <span className="type-mono text-[12px] text-muted-foreground">
                        {section.skills.length}
                      </span>
                    </div>
                    <ResultsGrid
                      skills={section.skills}
                      featuredSlugs={featuredSlugs}
                    />
                  </FilterTransitionBlock>
                ))}
              </div>
            ) : (
              <ResultsGrid skills={results} featuredSlugs={featuredSlugs} />
            )}
          </div>
        </FilterTransitionGroup>
      </div>
    </>
  );
}
