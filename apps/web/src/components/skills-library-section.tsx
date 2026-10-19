"use client";

import Image from "next/image";
import { type FormEvent, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { FeaturedSkillCard } from "@/components/featured-skill-card";
import {
  FilterTransitionBlock,
  FilterTransitionGroup,
  FilterTransitionItem,
  FilterTransitionList,
} from "@/components/motion/filter-transition";
import { PressScale } from "@/components/motion/press-scale";
import { StaggerItem, StaggerList } from "@/components/motion/stagger";
import { SkillCard } from "@/components/skill-card";
import {
  getEmptyResultCause,
  useCatalogFilters,
} from "@/components/use-catalog-filters";
import { ClayButton } from "@/components/ui";
import { SKILL_TAG_LABELS } from "@/config/skill-tags";
import { PRIMARY_SEARCH_ATTR } from "@/components/layout/header-search";
import { resolveLocaleValue } from "@/i18n/config";
import { withLocalePath } from "@/i18n/href";
import { LocaleLink } from "@/i18n/locale-link";
import {
  countByGroup,
  getFeaturedSkills,
  groupSkills,
  type SkillGroupView,
} from "@/lib/skill-groups";
import {
  getIllustrationSrc,
  type CatalogLayout,
  type SkillListItem,
} from "@/lib/skills";

interface SkillsLibrarySectionProps {
  skills: SkillListItem[];
  layout: CatalogLayout;
}

const EMPTY_ILLUSTRATION = "group-review.webp";
/** Cards shown per Scenario Group on the home page; the rest live on /skills. */
export const HOME_GROUP_LIMIT = 6;

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The catalog below the hero: search bar and scenario chips, the Featured
 * Skills, and every Scenario Group. Searching hides the featured row and any
 * group without matches.
 */
export function SkillsLibrarySection({
  skills,
  layout,
}: SkillsLibrarySectionProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
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
  const featuredSlugs = useMemo(
    () => new Set(layout.featured.map((entry) => entry.slug)),
    [layout.featured],
  );
  const groupViews = useMemo(
    () => groupSkills(filteredSkills, layout),
    [filteredSkills, layout],
  );
  const groupCounts = useMemo(
    () => countByGroup(filteredSkills),
    [filteredSkills],
  );
  const featured = useMemo(
    () => getFeaturedSkills(skills, layout.featured),
    [skills, layout.featured],
  );

  // Typing filters in place; Enter opens the full catalog with the same words.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    router.push(
      withLocalePath(
        q ? `/skills?q=${encodeURIComponent(q)}` : "/skills",
        locale,
      ),
    );
  };

  return (
    <>
      <div id="skills" className="relative z-[2] scroll-mt-24">
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t({
              id: "home.search.input.aria",
              message: "Search skills",
            })}
            placeholder={t({
              id: "home.search.placeholder.try",
              // Straight quotes: Noto Sans SC draws curly quotes full-width.
              message:
                'What are you trying to do? Try "review", "commit", "figma"…',
            })}
            className="h-full min-w-0 flex-1 appearance-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="clay-focus-ring relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t({
                id: "home.search.clear",
                message: "Clear search",
              })}
            >
              <span className="icon-[lucide--x] size-4" aria-hidden />
            </button>
          )}
          <span className="type-mono hidden shrink-0 rounded-[8px] bg-muted px-2.5 py-1.5 text-[12px] text-muted-foreground sm:inline">
            {isFiltering ? (
              <Trans id="home.search.countFiltered">
                {resultCount} / {totalCount}
              </Trans>
            ) : (
              <Plural
                id="home.search.count"
                value={totalCount}
                one="# skill"
                other="# skills"
              />
            )}
          </span>
        </form>

        <p className="sr-only" aria-live="polite">
          <Trans id="home.search.resultCount">
            {resultCount} of {totalCount} skills shown
          </Trans>
        </p>

        <nav
          aria-label={t({
            id: "home.scenarios.jump.aria",
            message: "Jump to a scenario",
          })}
          // Mobile: one scrolling row whose right edge fades; desktop: wraps.
          className="-mx-[var(--site-gutter)] mt-3.5 overflow-x-auto px-[var(--site-gutter)] py-1 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] md:mx-0 md:overflow-visible md:px-0 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex w-max gap-2 pr-8 md:w-auto md:flex-wrap md:pr-0">
            {tag && (
              <li>
                <PressScale>
                  <button
                    type="button"
                    onClick={() => setTag(null)}
                    className="scenario-chip scenario-chip--selected clay-focus-ring border pl-3.5"
                    aria-label={t({
                      id: "home.filter.clearTag.aria",
                      message: `Remove the ${SKILL_TAG_LABELS[tag][locale]} tag filter`,
                    })}
                  >
                    <Trans id="home.filter.activeTag">
                      Tag: {SKILL_TAG_LABELS[tag][locale]}
                    </Trans>
                    <span className="icon-[lucide--x] size-3.5" aria-hidden />
                  </button>
                </PressScale>
              </li>
            )}
            {layout.groups.map((group) => {
              const count = groupCounts.get(group.id) ?? 0;
              const content = (
                <>
                  <span className="art-avatar size-[26px]">
                    <Image
                      src={getIllustrationSrc(group.illustration)}
                      alt=""
                      width={1024}
                      height={1024}
                      sizes="26px"
                    />
                  </span>
                  {group.title[locale]}
                  <span className="type-mono text-[11.5px] text-muted-foreground">
                    {count}
                  </span>
                </>
              );
              return (
                <li key={group.id}>
                  {count > 0 ? (
                    // Same-page hash: SmoothScrollProvider animates the jump.
                    <PressScale>
                      <a
                        href={`#group-${group.id}`}
                        className="scenario-chip clay-focus-ring border"
                      >
                        {content}
                      </a>
                    </PressScale>
                  ) : (
                    <span className="scenario-chip" aria-disabled="true">
                      {content}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {!isFiltering && featured.length > 0 && (
        <section
          aria-labelledby="featured-title"
          className="pt-14 md:pt-[72px]"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <p className="kicker kicker-leaf">
                <Trans id="home.featured.kicker">Start here</Trans>
              </p>
              <h2 id="featured-title" className="type-h2 mt-2">
                <Trans id="home.featured.title">
                  Three skills worth installing first
                </Trans>
              </h2>
            </div>
            <p className="text-muted-foreground">
              <Trans id="home.featured.intro">
                One line to install, works the same in every agent.
              </Trans>
            </p>
          </div>
          <StaggerList as="ul" className="grid gap-5 lg:grid-cols-3">
            {featured.map((view, index) => (
              <StaggerItem
                as="li"
                key={view.skill.slug}
                index={index}
                className="min-w-0"
              >
                <FeaturedSkillCard view={view} index={index} />
              </StaggerItem>
            ))}
          </StaggerList>
        </section>
      )}

      {/* Glides up when the featured row hides on search; group grids re-flow by slug. */}
      <FilterTransitionGroup id="home-catalog">
        <FilterTransitionBlock
          as="section"
          id="scenarios"
          aria-labelledby="scenarios-title"
          className="scroll-mt-20 pt-14 md:pt-[72px]"
        >
          <div
            className={isFiltering && resultCount === 0 ? "sr-only" : "mb-2"}
          >
            <p className="kicker kicker-leaf">
              <Trans id="home.scenarios.kicker">By scenario</Trans>
            </p>
            <h2 id="scenarios-title" className="type-h2 mt-2">
              {isFiltering ? (
                <Plural
                  id="home.scenarios.titleFiltered"
                  value={resultCount}
                  one="# skill matches"
                  other="# skills match"
                />
              ) : (
                <Trans id="home.scenarios.title">
                  Find a skill by what you&apos;re doing
                </Trans>
              )}
            </h2>
          </div>

          {groupViews.length > 0 ? (
            <div>
              {groupViews.map((view) => (
                <ScenarioGroup
                  key={view.group.id}
                  view={view}
                  featuredSlugs={featuredSlugs}
                />
              ))}
            </div>
          ) : isFiltering ? (
            <div className="flex flex-col items-center px-4 pt-14 pb-6 text-center">
              <span className="art-avatar mb-5 size-[120px]">
                <Image
                  src={getIllustrationSrc(EMPTY_ILLUSTRATION)}
                  alt=""
                  width={1024}
                  height={1024}
                  sizes="120px"
                />
              </span>
              <h3 className="type-h3 text-pretty">
                {query.trim() ? (
                  <Trans id="home.search.emptyTitle.query">
                    No skills match &quot;{query}&quot;
                  </Trans>
                ) : (
                  <Trans id="home.search.emptyTitle">No matching skills</Trans>
                )}
              </h3>
              <p className="mt-2 max-w-md text-pretty text-muted-foreground">
                {
                  {
                    query: (
                      <Trans id="home.search.emptyHint.query">
                        Kiki looked everywhere. Try another word, in English or
                        Chinese.
                      </Trans>
                    ),
                    tag: (
                      <Trans id="home.search.emptyHintTagOnly">
                        No skills carry this tag yet. Pick another tag.
                      </Trans>
                    ),
                    both: (
                      <Trans id="home.search.emptyHint.both">
                        Kiki looked everywhere. Try another word, or remove the
                        tag filter.
                      </Trans>
                    ),
                  }[emptyCause ?? "query"]
                }
              </p>
              <PressScale className="mt-5">
                <ClayButton size="sm" onClick={clearFilters}>
                  <span
                    className="icon-[lucide--rotate-ccw] size-4"
                    aria-hidden
                  />
                  {tag ? (
                    <Trans id="home.search.clearFilters">Clear filters</Trans>
                  ) : (
                    <Trans id="home.search.clearSearch">Clear search</Trans>
                  )}
                </ClayButton>
              </PressScale>
            </div>
          ) : null}
        </FilterTransitionBlock>
      </FilterTransitionGroup>
    </>
  );
}

function ScenarioGroup({
  view,
  featuredSlugs,
}: {
  view: SkillGroupView;
  featuredSlugs: ReadonlySet<string>;
}) {
  const { i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const { group, number, skills } = view;
  const count = skills.length;
  const shown = skills.slice(0, HOME_GROUP_LIMIT);
  const titleId = `group-${group.id}-title`;

  return (
    <FilterTransitionBlock
      as="section"
      id={`group-${group.id}`}
      aria-labelledby={titleId}
      className="grid scroll-mt-20 gap-5 border-t border-border py-9 first:border-t-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-10 lg:py-11"
    >
      <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 self-start lg:sticky lg:top-24 lg:block">
        <span className="art-avatar art-avatar--ringed row-span-3 size-14 lg:size-16">
          <Image
            src={getIllustrationSrc(group.illustration)}
            alt=""
            width={1024}
            height={1024}
            sizes="64px"
          />
        </span>
        <p className="type-mono text-[12px] text-muted-foreground lg:mt-[18px] lg:mb-1.5">
          {padNumber(number)} ·{" "}
          <Plural
            id="home.group.count"
            value={count}
            one="# skill"
            other="# skills"
          />
        </p>
        <h3 id={titleId} className="type-h3">
          {group.title[locale]}
        </h3>
        <p className="mt-1.5 text-[14.5px] leading-[1.6] text-muted-foreground lg:mt-2">
          {group.summary[locale]}
        </p>
      </div>

      <div className="min-w-0">
        <FilterTransitionList
          as="ul"
          className="grid content-start gap-3.5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {shown.map((skill, index) => (
            <FilterTransitionItem
              as="li"
              key={skill.slug}
              index={index}
              className="min-w-0"
            >
              <SkillCard
                skill={skill}
                featured={featuredSlugs.has(skill.slug)}
              />
            </FilterTransitionItem>
          ))}
        </FilterTransitionList>
        {count > HOME_GROUP_LIMIT && (
          <LocaleLink
            href={`/skills?group=${group.id}`}
            className="clay-focus-ring mt-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-link underline-offset-4 hover:underline"
          >
            <Trans id="home.group.viewAll">
              View all {count} in this group
            </Trans>
            <span className="icon-[lucide--arrow-right] size-4" aria-hidden />
          </LocaleLink>
        )}
      </div>
    </FilterTransitionBlock>
  );
}
