import { useLingui } from "@lingui/react/macro";
import { CopyInstallCommandButton } from "@/components/copy-install-command";
import { SKILL_TAG_LABELS } from "@/config/skill-tags";
import { resolveLocaleValue } from "@/i18n/config";
import { LocaleLink } from "@/i18n/locale-link";
import { getSkillInstallCommand, type SkillListItem } from "@/lib/skills";

interface SkillCardProps {
  skill: SkillListItem;
  featured?: boolean;
}

/** Catalog card (DESIGN.md skill-card): Display Name, mono slug, summary, tags, outline copy. */
export function SkillCard({ skill, featured = false }: SkillCardProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const { catalog } = skill;
  const summary = locale === "zh" ? catalog.summary_zh : catalog.summary;
  const displayName = catalog.displayName[locale];

  return (
    // The title link stretches over the card (h4 is `static` so its ::after anchors to the
    // article, z-2); the footer sits above it (z-3), so no interactive element nests in another.
    <article className="skill-card h-full clay-focus-link-ring">
      {featured && (
        <span className="type-mono absolute top-3.5 right-4 inline-flex items-center gap-1 text-[10.5px] text-link">
          <span className="icon-[lucide--star] size-3" aria-hidden />
          {t({ id: "skillCard.featured", message: "Featured" })}
        </span>
      )}
      <h4 className="type-card-title static pr-20">
        <LocaleLink
          href={`/skills/${skill.slug}`}
          className="outline-none after:absolute after:inset-0 after:z-[2] after:rounded-[inherit] after:content-['']"
        >
          {displayName}
        </LocaleLink>
      </h4>
      <p className="type-mono mt-0.5 truncate text-[11.5px] text-muted-foreground">
        {skill.slug}
      </p>

      <p className="mt-2.5 mb-3.5 line-clamp-3 text-[13.5px] leading-[1.55] text-muted-foreground">
        {summary}
      </p>

      <div className="z-[3] mt-auto flex items-end justify-between gap-2">
        <ul
          className="flex min-w-0 flex-wrap gap-1.5"
          aria-label={t({ id: "skillCard.tags.aria", message: "Tags" })}
        >
          {/* Two tags keep the footer on one line; the detail page lists all of them. */}
          {catalog.tags.slice(0, 2).map((tag, index) => (
            <li
              key={tag}
              className={index === 0 ? "nk-tag" : "nk-tag nk-tag--neutral"}
            >
              {SKILL_TAG_LABELS[tag][locale]}
            </li>
          ))}
        </ul>
        <CopyInstallCommandButton
          variant="outline"
          command={getSkillInstallCommand(skill.slug)}
          label={t({
            id: "skillCard.copy.ariaLabel",
            message: `Copy install command for ${displayName}`,
          })}
        />
      </div>
    </article>
  );
}
