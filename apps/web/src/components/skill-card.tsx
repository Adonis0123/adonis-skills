import Link from 'next/link'
import {
  ClayBadge,
  ClayCard,
  ClayCardContent,
  ClayCardDescription,
  ClayCardFooter,
  ClayCardHeader,
  ClayCardTitle,
} from '@/components/ui'
import { skillsRepo, type SkillIndexItem } from '@/lib/skills'

interface SkillCardProps {
  skill: SkillIndexItem
}

const toneCycle = ['peach', 'blue', 'cream'] as const

export function SkillCard({ skill }: SkillCardProps) {
  const tone = toneCycle[skill.slug.charCodeAt(0) % toneCycle.length]

  return (
    <Link
      href={`/skills/${skill.slug}`}
      className="clay-focus-ring block h-full rounded-[var(--radius-xl)]"
    >
      <ClayCard tone={tone} interactive className="h-full">
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
            <p className="font-mono text-[11px] text-clay-muted">npx skills add {skillsRepo} --skill {skill.slug}</p>
          </div>
        </ClayCardContent>

        <ClayCardFooter className="flex-wrap">
          <ClayBadge tone={skill.files.hasReferences ? 'success' : 'neutral'}>
            {skill.files.hasReferences ? 'references: yes' : 'references: no'}
          </ClayBadge>
          <ClayBadge tone={skill.files.hasSrc ? 'blue' : 'neutral'}>
            {skill.files.hasSrc ? 'src: yes' : 'src: no'}
          </ClayBadge>
        </ClayCardFooter>
      </ClayCard>
    </Link>
  )
}
