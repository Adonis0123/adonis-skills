import Image from "next/image";
import { useLingui } from "@lingui/react/macro";
import { CopyInstallCommandButton } from "@/components/copy-install-command";
import { cx } from "@/components/ui/utils";
import { resolveLocaleValue } from "@/i18n/config";
import { LocaleLink } from "@/i18n/locale-link";
import type { FeaturedSkillView } from "@/lib/skill-groups";
import {
  getIllustrationSrc,
  getSkillInstallCommand,
  skillsRepo,
} from "@/lib/skills";

interface FeaturedSkillCardProps {
  view: FeaturedSkillView;
  index: number;
}

/** DESIGN.md featured-card; the first card is the lead (`tint` surface). */
export function FeaturedSkillCard({ view, index }: FeaturedSkillCardProps) {
  const { t, i18n } = useLingui();
  const locale = resolveLocaleValue(i18n.locale);
  const { entry, skill } = view;
  const displayName = skill.catalog.displayName[locale];
  const summary =
    locale === "zh" ? skill.catalog.summary_zh : skill.catalog.summary;
  const command = getSkillInstallCommand(skill.slug);
  const number = String(index + 1).padStart(2, "0");

  return (
    <article
      className={cx(
        "featured-card h-full clay-focus-link-ring",
        index === 0 && "featured-card--lead",
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="type-mono text-[12px] text-muted-foreground">
          {t({
            id: "featured.card.number",
            message: `${number} / Featured`,
          })}
        </span>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-accent pr-2.5 pl-1.5 text-xs font-semibold text-accent-foreground">
          <Image
            src="/brand/kiki-mark.svg"
            alt=""
            width={18}
            height={18}
            unoptimized
            className="size-[18px] object-contain"
          />
          {entry.badge[locale]}
        </span>
      </div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="type-h3 static">
            <LocaleLink
              href={`/skills/${skill.slug}`}
              className="outline-none after:absolute after:inset-0 after:z-[2] after:rounded-[inherit] after:content-['']"
            >
              {displayName}
            </LocaleLink>
          </h3>
          <p className="type-mono mt-1.5 truncate text-muted-foreground">
            {skill.slug}
          </p>
        </div>
        <Image
          src={getIllustrationSrc(entry.illustration)}
          alt=""
          width={1024}
          height={1024}
          sizes="96px"
          className="-mt-2 -mr-2 size-20 shrink-0 object-contain sm:size-24"
        />
      </div>

      <p className="mt-3 text-[15px] leading-[1.65] text-muted-foreground">
        {summary}
      </p>

      <ul className="mt-4 mb-5 grid gap-2 text-[13.5px] leading-[1.5] text-muted-foreground">
        {entry.highlights.map((highlight) => (
          <li key={highlight.en} className="flex gap-2.5">
            <span
              className="mt-[7px] size-1.5 shrink-0 rounded-[2px] bg-primary"
              aria-hidden
            />
            <span>{highlight[locale]}</span>
          </li>
        ))}
      </ul>

      <div className="command-box type-mono relative z-[3] mt-auto">
        {/* The prefix truncates first so the slug, the part that differs, stays readable. */}
        <code title={command} className="flex items-baseline">
          <span className="sr-only">{command}</span>
          <span className="shrink-0 text-link" aria-hidden>
            ${"\u00a0"}
          </span>
          <span className="min-w-0 truncate" aria-hidden>
            npx skills add {skillsRepo} --skill
          </span>
          <span className="shrink-0 text-foreground" aria-hidden>
            {"\u00a0"}
            {skill.slug}
          </span>
        </code>
        <CopyInstallCommandButton
          variant="solid"
          iconOnlyOnMobile
          command={command}
          label={t({
            id: "featured.card.copy.aria",
            message: `Copy install command for ${displayName}`,
          })}
        />
      </div>
    </article>
  );
}
