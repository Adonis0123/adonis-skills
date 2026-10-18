import type { Metadata } from "next";
import Image from "next/image";
import { Trans } from "@lingui/react/macro";
import { notFound } from "next/navigation";
import { HostInstallTabs } from "@/components/host-install-tabs";
import { SectionReveal } from "@/components/motion/section-reveal";
import { SkillShowcase } from "@/components/skill-showcase";
import { TocNav, type TocEntry } from "@/components/toc-nav";
import { ClaySurface } from "@/components/ui";
import { SKILL_TAG_LABELS } from "@/config/skill-tags";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { initLingui, initPageLingui } from "@/i18n/initLingui";
import { LocaleLink } from "@/i18n/locale-link";
import { localeAlternates } from "@/lib/seo";
import { renderSectionContent, withHeadingIds } from "@/lib/skill-markdown";
import {
  getAllSkills,
  getCatalogGroup,
  getCatalogLayout,
  getFeaturedEntry,
  getIllustrationSrc,
  getSkillBySlug,
  getSkillDetailBySlug,
  getSkillSourceUrl,
} from "@/lib/skills";

interface SkillPageProps {
  params: Promise<{ lang: string; slug: string }>;
}

export async function generateStaticParams() {
  const skills = getAllSkills();
  return SUPPORTED_LOCALES.flatMap((lang) =>
    skills.map((skill) => ({ lang, slug: skill.slug })),
  );
}

export async function generateMetadata({
  params,
}: SkillPageProps): Promise<Metadata> {
  const locale = await initPageLingui(params);
  const i18n = initLingui(locale);
  const { slug } = await params;
  const skill = getSkillBySlug(slug);

  if (!skill)
    return {
      title: i18n._({
        id: "skillDetail.meta.notFoundTitle",
        message: "Skill not found",
      }),
    };

  const description =
    locale === "zh" ? skill.catalog.summary_zh : skill.catalog.summary;
  const title = `${skill.catalog.displayName[locale]} (${skill.slug})`;
  return {
    title,
    description,
    alternates: localeAlternates(`/skills/${skill.slug}`, locale),
    openGraph: { type: "article", title, description },
  };
}

function formatUpdatedAt(isoDate: string, locale: string): string {
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

const kickerClass = "kicker mb-3 text-muted-foreground";

export default async function SkillDetailPage({ params }: SkillPageProps) {
  const locale = await initPageLingui(params);
  const { lang, slug } = await params;
  const skill = getSkillBySlug(slug);
  const skillDetail = getSkillDetailBySlug(slug);

  if (!skill) notFound();

  const { catalog } = skill;
  const summary = locale === "zh" ? catalog.summary_zh : catalog.summary;
  const useCases = locale === "zh" ? catalog.use_cases_zh : catalog.use_cases;
  const sourceUrl = getSkillSourceUrl(skill.slug);
  const showcase = skillDetail?.showcase;
  const sections = withHeadingIds(skillDetail?.sections ?? [], [
    "use-cases",
    "install",
  ]);
  const i18n = initLingui(locale);
  const toc: TocEntry[] = [
    {
      id: "install",
      label: i18n._({ id: "skillDetail.install.title", message: "Install" }),
      level: 2,
    },
    {
      id: "use-cases",
      label: i18n._({
        id: "skillDetail.useCases.title",
        message: "When to reach for it",
      }),
      level: 2,
    },
    ...sections
      .filter(
        (section) => section.id && section.heading && (section.level ?? 1) <= 3,
      )
      .map((section) => ({
        id: section.id as string,
        label: section.heading as string,
        level: Math.max(2, section.level ?? 2),
      })),
  ];

  const displayName = catalog.displayName[locale];
  const group = getCatalogGroup(catalog.group);
  const groupNumber =
    getCatalogLayout().groups.findIndex((item) => item.id === catalog.group) +
    1;
  const featured = getFeaturedEntry(skill.slug);

  return (
    <main
      id="main-content"
      className="site-page-shell site-frame site-frame--detail w-full"
    >
      <SectionReveal delay={20}>
        <LocaleLink
          href="/"
          className="clay-focus-ring mb-4 inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="icon-[lucide--arrow-left] size-3.5" aria-hidden />
          <Trans id="skillDetail.cta.back">All skills</Trans>
        </LocaleLink>
      </SectionReveal>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch">
        <SectionReveal delay={60} className="min-w-0">
          <header className="h-full rounded-[22px] border border-border bg-card p-6 md:p-9">
            <div className="flex items-start justify-between gap-5">
              <div className="min-w-0">
                {group && (
                  <LocaleLink
                    href={`/skills?group=${group.id}`}
                    className="clay-focus-ring type-mono inline-flex max-w-full items-center gap-2 rounded-full text-[12px] text-muted-foreground transition-colors hover:text-link"
                  >
                    <span className="truncate">
                      {String(groupNumber).padStart(2, "0")} ·{" "}
                      {group.title[locale]}
                    </span>
                    <span
                      className="icon-[lucide--arrow-up-right] size-3.5 shrink-0"
                      aria-hidden
                    />
                  </LocaleLink>
                )}
                <h1 className="type-display mt-3 [word-break:keep-all] text-[clamp(2rem,1.4rem+2.4vw,3.25rem)] text-balance">
                  {displayName}
                </h1>
                <p className="type-mono mt-2 text-muted-foreground">
                  {skill.slug}
                </p>
              </div>
              {group && (
                <span className="art-avatar art-avatar--ringed hidden size-24 sm:block">
                  <Image
                    src={getIllustrationSrc(group.illustration)}
                    alt=""
                    width={1024}
                    height={1024}
                    sizes="96px"
                    priority
                  />
                </span>
              )}
            </div>

            <p className="type-lede mt-5 max-w-3xl text-base text-muted-foreground md:text-lg">
              {summary}
            </p>

            <ul className="mt-5 flex flex-wrap gap-1.5">
              {featured && (
                <li className="nk-tag gap-1">
                  <span
                    className="icon-[lucide--sparkles] size-3"
                    aria-hidden
                  />
                  {featured.badge[locale]}
                </li>
              )}
              {catalog.tags.map((tag) => (
                <li key={tag}>
                  <LocaleLink
                    href={`/skills?tag=${tag}`}
                    className="clay-focus-ring nk-tag nk-tag--neutral transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {SKILL_TAG_LABELS[tag][locale]}
                  </LocaleLink>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {skill.metadata?.version && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="icon-[lucide--tag] size-4" aria-hidden />
                  <Trans id="skillDetail.version">
                    Version {skill.metadata.version}
                  </Trans>
                </span>
              )}
              {skill.updatedAt && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="icon-[lucide--calendar] size-4"
                    aria-hidden
                  />
                  <Trans id="skillDetail.updatedAt">
                    Updated{" "}
                    <time dateTime={skill.updatedAt}>
                      {formatUpdatedAt(skill.updatedAt, lang)}
                    </time>
                  </Trans>
                </span>
              )}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="clay-focus-ring inline-flex items-center gap-1.5 rounded-sm font-semibold text-link underline-offset-4 hover:underline"
              >
                <span className="icon-[lucide--github] size-4" aria-hidden />
                <Trans id="skillDetail.source">View source on GitHub</Trans>
              </a>
            </div>
          </header>
        </SectionReveal>

        <SectionReveal delay={100} className="min-w-0">
          <section
            aria-labelledby="install"
            className="h-full rounded-[22px] border border-tint-border bg-tint p-5 md:p-7"
          >
            <p className="kicker kicker-leaf">
              <Trans id="skillDetail.install.kicker">Install</Trans>
            </p>
            <h2 id="install" className="type-h3 mt-2 mb-4 scroll-mt-24">
              <Trans id="skillDetail.install.heading">
                Add it to your agent
              </Trans>
            </h2>
            <HostInstallTabs slug={skill.slug} />
          </section>
        </SectionReveal>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <SectionReveal delay={140}>
            <ClaySurface tone="base" elevation="raised" className="p-5 md:p-7">
              <h2 id="use-cases" className={`${kickerClass} scroll-mt-24`}>
                <Trans id="skillDetail.useCases.title">
                  When to reach for it
                </Trans>
              </h2>
              <ul className="space-y-2">
                {useCases.map((useCase) => (
                  <li
                    key={useCase}
                    className="flex gap-2.5 text-[15px] leading-7 md:text-base"
                  >
                    <span
                      className="icon-[lucide--check] mt-1.5 size-4 shrink-0 text-link"
                      aria-hidden
                    />
                    {useCase}
                  </li>
                ))}
              </ul>
            </ClaySurface>
          </SectionReveal>

          {showcase && (
            <SectionReveal delay={160}>
              <SkillShowcase showcase={showcase} />
            </SectionReveal>
          )}

          {sections.length > 0 && (
            <ClaySurface
              tone="base"
              elevation="raised"
              className="scroll-mt-28 p-5 md:p-8"
            >
              <h2 className={kickerClass}>
                <Trans id="skillDetail.docs.title">Skill instructions</Trans>
              </h2>
              <article className="space-y-8">
                {sections.map((section, index) => {
                  const HeadingTag = (section.level ?? 2) <= 2 ? "h3" : "h4";
                  return (
                    <section key={section.id ?? index} className="space-y-3">
                      {section.heading && (
                        <HeadingTag
                          id={section.id}
                          className="scroll-mt-28 text-lg font-bold md:text-xl"
                        >
                          {section.heading}
                        </HeadingTag>
                      )}
                      {section.raw && renderSectionContent(section.raw)}
                    </section>
                  );
                })}
              </article>
            </ClaySurface>
          )}
        </div>

        {toc.length > 2 && (
          <TocNav
            title={<Trans id="skillDetail.toc.title">On this page</Trans>}
            entries={toc}
          />
        )}
      </div>
    </main>
  );
}
