import type { Metadata } from "next";
import Image from "next/image";
import { Trans } from "@lingui/react/macro";
import { notFound } from "next/navigation";
import { HostInstallTabs } from "@/components/host-install-tabs";
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
  // No "Install" entry: on desktop the install card sits right above the list,
  // and phones hide the list.
  const toc: TocEntry[] = [
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
      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        <LocaleLink
          href="/"
          className="clay-focus-ring -ml-1.5 inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="icon-[lucide--arrow-left] size-3.5" aria-hidden />
          <Trans id="skillDetail.cta.back">All skills</Trans>
        </LocaleLink>
        {group && (
          <>
            <span className="text-subtle-foreground" aria-hidden>
              /
            </span>
            <LocaleLink
              href={`/skills?group=${group.id}`}
              className="clay-focus-ring type-mono inline-flex min-w-0 items-center gap-1.5 rounded-full px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-link"
            >
              <span className="truncate">
                {String(groupNumber).padStart(2, "0")} · {group.title[locale]}
              </span>
              <span
                className="icon-[lucide--arrow-up-right] size-3.5 shrink-0"
                aria-hidden
              />
            </LocaleLink>
          </>
        )}
      </div>

      {/*
        Desktop: content on the left; the right column holds the install card and the
        table of contents, sticky together. Phone: DOM order puts the install card
        right after the title, before the body.
      */}
      <div className="grid min-w-0 gap-y-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10 xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-x-12">
        <header className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="flex items-center gap-4">
            {group && (
              <Image
                src={getIllustrationSrc(group.illustration)}
                alt=""
                width={1024}
                height={1024}
                sizes="96px"
                priority
                className="-my-3 -ml-2 hidden size-24 shrink-0 object-contain sm:block"
              />
            )}
            <div className="min-w-0">
              <h1 className="type-display [word-break:keep-all] text-[clamp(2rem,1.5rem+1.4vw,2.75rem)] text-balance">
                {displayName}
              </h1>
              <p className="type-mono text-muted-foreground">{skill.slug}</p>
            </div>
          </div>

          <p className="type-lede mt-3 max-w-3xl text-base text-muted-foreground md:text-[17px]">
            {summary}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-sm text-muted-foreground">
            {(featured || catalog.tags.length > 0) && (
              <ul className="flex flex-wrap gap-1.5">
                {featured && (
                  <li className="nk-tag gap-1">
                    <Image
                      src="/brand/kiki-mark.svg"
                      alt=""
                      width={16}
                      height={16}
                      unoptimized
                      className="size-4 object-contain"
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
            )}
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
                <span className="icon-[lucide--calendar] size-4" aria-hidden />
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

        {/* Spans both rows so the sticky column can travel the whole page. */}
        <aside
          aria-labelledby="install"
          className="detail-enter min-w-0 [--detail-enter-delay:40ms] lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <div className="grid gap-6 lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col">
            <section className="detail-install ink-box ink-box--xl ink-raised shrink-0 bg-tint p-4 md:p-5 dark:bg-card">
              <h2 id="install" className="type-h3 mb-3 scroll-mt-24">
                <Trans id="skillDetail.install.title">Install</Trans>
              </h2>
              <HostInstallTabs slug={skill.slug} />
            </section>
            {toc.length > 1 && (
              <TocNav
                title={<Trans id="skillDetail.toc.title">On this page</Trans>}
                entries={toc}
              />
            )}
          </div>
        </aside>

        <div className="detail-enter grid min-w-0 content-start gap-6 [--detail-enter-delay:80ms] lg:col-start-1 lg:row-start-2">
          <ClaySurface tone="base" elevation="raised" className="p-5 md:p-6">
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

          {showcase && <SkillShowcase showcase={showcase} />}

          {sections.length > 0 && (
            <ClaySurface
              tone="base"
              elevation="raised"
              className="scroll-mt-28 p-5 md:p-7"
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
                          className="scroll-mt-28 text-xl font-bold md:text-2xl"
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
      </div>
    </main>
  );
}
