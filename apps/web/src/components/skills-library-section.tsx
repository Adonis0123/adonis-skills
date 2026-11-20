"use client";

import Image from "next/image";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { FeaturedSkillCard } from "@/components/featured-skill-card";
import { PRIMARY_SEARCH_ATTR } from "@/components/layout/header-search";
import { FilterTransitionGroup } from "@/components/motion/filter-transition";
import { PressScale } from "@/components/motion/press-scale";
import { StaggerItem, StaggerList } from "@/components/motion/stagger";
import { SkillList } from "@/components/skill-row";
import { useCatalogQuery } from "@/components/use-catalog-filters";
import { ClayButton } from "@/components/ui";
import { cx } from "@/components/ui/utils";
import { SKILL_TAG_SEARCH_LABELS } from "@/config/skill-tags";
import { resolveLocaleValue } from "@/i18n/config";
import {
  applyCatalogQuery,
  filterByQueryAndTags,
  isCatalogQueryActive,
} from "@/lib/catalog-query";
import { countByGroup, getFeaturedSkills } from "@/lib/skill-groups";
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

/**
 * The home catalog, right under the hero (after coco-skills' SkillsLibrary):
 * one toolbar row (title with the count, a compact search, scenario chips
 * that filter in place), then every skill as a dense SkillRow list in
 * scenario order. State lives in the URL (`?q=&group=`), shared with /skills.
 */
/**
 * Which edges of a horizontal scroller still hide content, for the chip
 * row's edge fades. Starts with the end fading, so the server-rendered row
 * never shows a hard cut before hydration.
 */
function useScrollEdges() {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);
  return { ref, edges, measure };
}

export function SkillsLibrarySection({
  skills,
  layout,
}: SkillsLibrarySectionProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    ref: chipRef,
    edges: chipEdges,
    measure: measureChips,
  } = useScrollEdges();
  const groupIds = useMemo(
    () => layout.groups.map((group) => group.id),
    [layout.groups],
  );
  const { query, deferredQuery, setQ, setGroup, clear } =
    useCatalogQuery(groupIds);
  // Chip counts follow the search but not the chip itself.
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
  const filtering = isCatalogQueryActive(query);
  const resultCount = results.length;
  const totalCount = skills.length;

  // Typing filters in place; Enter only closes the keyboard on phones.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    inputRef.current?.blur();
  };

  return (
    <section
      id="skills"
      aria-labelledby="skills-title"
      className="scroll-mt-24"
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex shrink-0 items-baseline gap-2">
          <h2 id="skills-title" className="type-h3 whitespace-nowrap">
            <Plural
              id="home.search.count"
              value={totalCount}
              one="# skill"
              other="# skills"
            />
          </h2>
          {filtering && (
            <span className="type-mono text-[12px] text-muted-foreground">
              <Trans id="home.search.countFiltered">
                {resultCount} / {totalCount}
              </Trans>
            </span>
          )}
        </div>

        <form
          role="search"
          onSubmit={onSubmit}
          className="search-bar home-search flex h-10 shrink-0 items-center gap-2 pr-1 pl-3 lg:w-[22rem]"
        >
          <span
            className="icon-[lucide--search] size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            {...{ [PRIMARY_SEARCH_ATTR]: "" }}
            type="search"
            value={query.q}
            onChange={(event) => setQ(event.target.value)}
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
            className="h-full min-w-0 flex-1 appearance-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {query.q ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              className="clay-focus-ring relative flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t({
                id: "home.search.clear",
                message: "Clear search",
              })}
            >
              <span className="icon-[lucide--x] size-4" aria-hidden />
            </button>
          ) : (
            <kbd
              aria-hidden
              className="type-mono mr-1.5 hidden rounded-[6px] bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground sm:inline"
            >
              /
            </kbd>
          )}
        </form>
        <p className="sr-only" aria-live="polite">
          <Trans id="home.search.resultCount">
            {resultCount} of {totalCount} skills shown
          </Trans>
        </p>

        <nav
          id="scenarios"
          aria-label={t({
            id: "home.scenarios.filter.aria",
            message: "Filter by scenario",
          })}
          // One scrolling chip row; an edge fades while more chips hide past it.
          ref={chipRef}
          onScroll={measureChips}
          data-fade-start={chipEdges.start || undefined}
          data-fade-end={chipEdges.end || undefined}
          className="home-chip-scroller -mx-[var(--site-gutter)] min-w-0 scroll-mt-24 overflow-x-auto px-[var(--site-gutter)] py-1 lg:mx-0 lg:flex-1 lg:px-0.5"
        >
          <ul className="flex w-max gap-1.5 pr-8">
            {layout.groups.map((group) => {
              const selected = query.group === group.id;
              const count = groupCounts.get(group.id) ?? 0;
              return (
                <li key={group.id}>
                  <PressScale noLift>
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={count === 0 && !selected}
                      onClick={() => setGroup(selected ? null : group.id)}
                      className={cx(
                        "scenario-chip home-chip clay-focus-ring disabled:opacity-50",
                        selected && "scenario-chip--selected",
                      )}
                    >
                      <span className="art-avatar size-[22px]">
                        <Image
                          src={getIllustrationSrc(group.illustration)}
                          alt=""
                          width={1024}
                          height={1024}
                          sizes="22px"
                        />
                      </span>
                      {group.title[locale]}
                      <span className="type-mono text-[11px] text-muted-foreground">
                        {count}
                      </span>
                      {selected && (
                        <span
                          className="icon-[lucide--x] size-3.5"
                          aria-hidden
                        />
                      )}
                    </button>
                  </PressScale>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <FilterTransitionGroup id="home-catalog">
        <div className="mt-3">
          {resultCount > 0 ? (
            <SkillList skills={results} />
          ) : (
            <div className="ink-box ink-box--dashed flex flex-wrap items-center gap-x-5 gap-y-3 bg-card px-4 py-4 md:px-5">
              <span className="art-avatar size-14">
                <Image
                  src={getIllustrationSrc(EMPTY_ILLUSTRATION)}
                  alt=""
                  width={1024}
                  height={1024}
                  sizes="56px"
                />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-heading text-base font-bold text-pretty">
                  {query.q.trim() ? (
                    <Trans id="home.search.emptyTitle.query">
                      No skills match &quot;{query.q}&quot;
                    </Trans>
                  ) : (
                    <Trans id="home.search.emptyTitle">
                      No matching skills
                    </Trans>
                  )}
                </h3>
                <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
                  <Trans id="home.search.emptyHint.query">
                    Kiki looked everywhere. Try another word, in English or
                    Chinese.
                  </Trans>
                </p>
              </div>
              <PressScale>
                <ClayButton size="sm" onClick={clear}>
                  <span
                    className="icon-[lucide--rotate-ccw] size-4"
                    aria-hidden
                  />
                  {query.group || query.tags.length > 0 ? (
                    <Trans id="home.search.clearFilters">Clear filters</Trans>
                  ) : (
                    <Trans id="home.search.clearSearch">Clear search</Trans>
                  )}
                </ClayButton>
              </PressScale>
            </div>
          )}
        </div>
      </FilterTransitionGroup>
    </section>
  );
}

/** The three Featured Skills under the list: a one-row header, then one row of cards. */
export function FeaturedSkillsSection({
  skills,
  layout,
}: SkillsLibrarySectionProps) {
  const featured = useMemo(
    () => getFeaturedSkills(skills, layout.featured),
    [skills, layout.featured],
  );
  if (featured.length === 0) return null;

  return (
    <section
      aria-labelledby="featured-title"
      className="home-section ink-rule-t"
    >
      <div className="home-section-head">
        <h2 id="featured-title" className="type-h3">
          <Trans id="home.featured.title">
            Three skills worth installing first
          </Trans>
        </h2>
        <p className="text-sm text-muted-foreground">
          <Trans id="home.featured.intro">
            One line to install, works the same in every agent.
          </Trans>
        </p>
      </div>
      <StaggerList as="ul" className="grid gap-4 lg:grid-cols-3">
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
  );
}
