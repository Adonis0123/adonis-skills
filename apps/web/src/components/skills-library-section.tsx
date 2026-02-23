'use client'

import { Trans, useLingui } from '@lingui/react/macro'
import { AnimatePresence, motion } from 'motion/react'
import { ClaySurface } from '@/components/ui'
import { SkillCard } from '@/components/skill-card'
import { VirtualGrid } from '@/components/virtual-grid/virtual-grid'
import { useSkillSearch } from '@/components/virtual-grid/use-skill-search'
import type { SkillIndexItem } from '@/lib/skills'

interface SkillsLibrarySectionProps {
  skills: SkillIndexItem[]
}

export function SkillsLibrarySection({ skills }: SkillsLibrarySectionProps) {
  const { t } = useLingui()
  const { query, setQuery, filteredSkills, isFiltering } = useSkillSearch(skills)

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 font-mono text-xs uppercase tracking-[0.16em] text-clay-muted">
            <Trans id="home.library.kicker">Library</Trans>
          </p>
          <h2 className="text-3xl md:text-4xl">
            <Trans id="home.library.title">Skill Library</Trans>
          </h2>
        </div>

        <ClaySurface
          tone="base"
          elevation="inset"
          className="flex h-10 w-full items-center gap-2 rounded-[1rem] px-4 sm:w-72 md:w-80"
        >
          <span
            className="icon-[lucide--search] size-3.5 shrink-0 text-clay-muted"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label={t({
              id: 'home.search.input.aria',
              message: 'Search skills',
            })}
            placeholder={t({
              id: 'home.search.placeholder',
              message: 'Search skills...',
            })}
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-clay-muted md:text-xs"
          />
          <AnimatePresence>
            {query && (
              <motion.button
                type="button"
                onClick={() => setQuery('')}
                className="clay-focus-ring shrink-0 rounded-md p-0.5"
                aria-label={t({
                  id: 'home.search.clear',
                  message: 'Clear search',
                })}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.15 }}
              >
                <span
                  className="icon-[lucide--x] size-3 text-clay-muted"
                  aria-hidden
                />
              </motion.button>
            )}
          </AnimatePresence>
        </ClaySurface>
      </div>

      {filteredSkills.length > 0 ? (
        <VirtualGrid
          items={filteredSkills}
          renderItem={skill => <SkillCard skill={skill} />}
          getItemKey={skill => skill.slug}
        />
      ) : isFiltering ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span
            className="icon-[lucide--search-x] mb-4 size-10 text-clay-muted/60"
            aria-hidden
          />
          <p className="font-mono text-sm text-clay-muted">
            <Trans id="home.search.empty">
              No skills found for &quot;{query}&quot;
            </Trans>
          </p>
        </div>
      ) : null}
    </section>
  )
}
