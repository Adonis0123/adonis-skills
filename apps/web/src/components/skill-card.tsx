import { useLingui } from '@lingui/react/macro'
import { CopyInstallCommandButton } from '@/components/copy-install-command'
import {
  ClayBadge,
  ClayCard,
  ClayCardContent,
  ClayCardDescription,
  ClayCardFooter,
  ClayCardHeader,
  ClayCardTitle,
} from '@/components/ui'
import { LocaleLink } from '@/i18n/locale-link'
import { skillsRepo, type SkillListItem } from '@/lib/skills'

interface SkillCardProps {
  skill: SkillListItem
}

const toneCycle = ['peach', 'cream', 'peach'] as const

export function SkillCard({ skill }: SkillCardProps) {
  const { t } = useLingui()
  const tone = toneCycle[skill.slug.charCodeAt(0) % toneCycle.length]
  const installCommand = `npx skills add ${skillsRepo} --skill ${skill.slug}`
  const referencesLabel = skill.files.hasReferences
    ? t({
      id: 'skillCard.references.yes',
      message: 'references: yes',
    })
    : t({
      id: 'skillCard.references.no',
      message: 'references: no',
    })
  const srcLabel = skill.files.hasSrc
    ? t({
      id: 'skillCard.src.yes',
      message: 'src: yes',
    })
    : t({
      id: 'skillCard.src.no',
      message: 'src: no',
    })

  return (
    <LocaleLink
      href={`/skills/${skill.slug}`}
      className="clay-focus-ring block h-full w-full min-w-0 rounded-[var(--radius-xl)]"
    >
      <ClayCard tone={tone} interactive className="h-full min-w-0">
        <ClayCardHeader>
          <div className="flex items-center justify-between gap-3">
            <ClayCardTitle className="text-[1.2rem] md:text-[1.3rem]">{skill.name}</ClayCardTitle>
            <span className="icon-[lucide--sparkles] size-4 shrink-0 text-foreground/70" aria-hidden />
          </div>
          <div className="flex flex-wrap gap-2">
            <ClayBadge tone="neutral" className="font-mono">
              {skill.slug}
            </ClayBadge>
          </div>
          <ClayCardDescription className="line-clamp-3">{skill.description}</ClayCardDescription>
        </ClayCardHeader>

        <ClayCardContent className="pt-1">
          <div className="clay-surface clay-tone-base clay-elevation-inset rounded-2xl p-3">
            <div className="flex items-center justify-between gap-2.5">
              <code
                className="block min-w-0 flex-1 truncate pr-1 font-mono text-[11px] text-clay-muted"
                title={installCommand}
              >
                {installCommand}
              </code>
              <CopyInstallCommandButton
                command={installCommand}
                compact
                preventLinkNavigation
                className="shrink-0"
              />
            </div>
          </div>
        </ClayCardContent>

        <ClayCardFooter className="flex-wrap">
          <ClayBadge tone={skill.files.hasReferences ? 'success' : 'neutral'}>
            {referencesLabel}
          </ClayBadge>
          <ClayBadge tone={skill.files.hasSrc ? 'peach' : 'neutral'}>
            {srcLabel}
          </ClayBadge>
        </ClayCardFooter>
      </ClayCard>
    </LocaleLink>
  )
}
