import { useLingui } from "@lingui/react/macro";
import { CopyInstallCommandButton } from "@/components/copy-install-command";
import { SKILL_TAG_LABELS } from "@/config/skill-tags";
import { resolveLocaleValue } from "@/i18n/config";
import { LocaleLink } from "@/i18n/locale-link";
import { getSkillInstallCommand, type SkillListItem } from "@/lib/skills";

interface SkillCardProps {
  skill: SkillListItem;
}

function formatDate(isoDate: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(isoDate));
  } catch {
    return isoDate;
  }
}

export function SkillCard({ skill }: SkillCardProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const summary =
    locale === "zh" ? skill.catalog.summary_zh : skill.catalog.summary;
  const installCommand = getSkillInstallCommand(skill.slug);
  const skillName = skill.name;

  return (
    // The title link stretches over the card (h3 is `static` so its ::after anchors to the
    // article, z-2); the footer sits above it (z-3), so no interactive element nests in another.
    <article className="clay-surface clay-tone-base clay-hover-lift relative flex h-full min-w-0 flex-col gap-3 p-5 clay-focus-link-ring md:p-6">
      <h3 className="static text-lg leading-snug md:text-xl">
        <LocaleLink
          href={`/skills/${skill.slug}`}
          className="outline-none after:absolute after:inset-0 after:z-[2] after:rounded-[inherit] after:content-['']"
        >
          {skillName}
        </LocaleLink>
      </h3>

      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
        {summary}
      </p>

      <ul
        className="flex flex-wrap gap-1.5"
        aria-label={t({ id: "skillCard.tags.aria", message: "Tags" })}
      >
        {skill.catalog.tags.map((tag) => (
          <li
            key={tag}
            className="clay-badge clay-badge--neutral px-2.5 py-0.5 text-[11px]"
          >
            {SKILL_TAG_LABELS[tag][locale]}
          </li>
        ))}
      </ul>

      <div className="z-[3] mt-auto flex items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
        {skill.updatedAt ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="icon-[lucide--calendar] size-3.5" aria-hidden />
            <time dateTime={skill.updatedAt}>
              {formatDate(skill.updatedAt, locale)}
            </time>
          </span>
        ) : (
          <span />
        )}
        <CopyInstallCommandButton
          compact
          command={installCommand}
          label={t({
            id: "skillCard.copy.aria",
            message: `Copy install command for ${skillName}`,
          })}
        />
      </div>
    </article>
  );
}
