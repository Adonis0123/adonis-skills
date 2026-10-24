import Image from "next/image";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { HostInstallTabs } from "@/components/host-install-tabs";
import { PressScale } from "@/components/motion/press-scale";
import { SectionReveal } from "@/components/motion/section-reveal";
import { SkillsLibrarySection } from "@/components/skills-library-section";
import { ClayButton } from "@/components/ui";
import { siteLayoutConfig } from "@/config/site-layout";
import { initLingui, initPageLingui } from "@/i18n/initLingui";
import {
  getAllSkills,
  getCatalogLayout,
  getIllustrationSrc,
} from "@/lib/skills";

interface HomePageProps {
  params: Promise<{ lang: string }>;
}

const HOST_NAMES = ["Claude Code", "Codex", "Cursor", "Hermes Agent"];

/** The hero's single emphasis: a hand-drawn leaf stroke under the words. */
function HandUnderline({ children }: { children?: React.ReactNode }) {
  return (
    <span className="hl-underline">
      {children}
      <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden>
        <path d="M3 14 C 50 4, 120 4, 197 11" />
      </svg>
    </span>
  );
}

function formatMonth(isoDate: string | undefined, locale: string): string {
  if (!isoDate) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
    }).format(new Date(isoDate));
  } catch {
    return isoDate.slice(0, 7);
  }
}

export default async function HomePage({ params }: HomePageProps) {
  const locale = await initPageLingui(params);
  const i18n = initLingui(locale);
  const skills = getAllSkills();
  const layout = getCatalogLayout();
  const skillsCount = skills.length;
  // getAllSkills sorts by updatedAt, newest first.
  const updatedMonth = formatMonth(skills[0]?.updatedAt, locale);

  return (
    <main id="main-content" className="relative flex w-full flex-col">
      <section className="hero-wash" aria-labelledby="hero-title">
        <div className="site-frame grid items-center gap-5 pt-5 pb-6 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:pt-16 md:pb-14 lg:pt-[72px] lg:pb-16">
          <SectionReveal delay={20} className="order-2 min-w-0 md:order-1">
            {updatedMonth && (
              <p className="mb-5 hidden h-[30px] items-center gap-2 rounded-full border border-border bg-card pr-3 pl-2.5 text-[13px] font-medium text-muted-foreground sm:inline-flex">
                <span
                  className="size-[7px] rounded-full bg-primary outline-[3px] outline-accent outline-solid"
                  aria-hidden
                />
                <Trans id="home.hero.eyebrow">
                  {skillsCount} skills · updated {updatedMonth}
                </Trans>
              </p>
            )}

            <h1
              id="hero-title"
              className="type-display text-balance [word-break:keep-all]"
            >
              <Trans id="home.hero.headline">
                Teach your coding agent how to{" "}
                <HandUnderline>finish the job.</HandUnderline>
              </Trans>
            </h1>

            <p className="type-lede mt-3.5 max-w-[34rem] text-[15px] text-muted-foreground md:mt-5 md:text-lg">
              <Trans id="home.hero.lede">
                Battle-tested skills for delegating tasks, running independent
                code reviews, shipping clean Git history, and wiring up MCP
                tools. Pick a task, copy one line, and it runs in your agent.
              </Trans>
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3 md:mt-7">
              {/* Same-page hash: SmoothScrollProvider (locale layout) animates the scroll. */}
              <PressScale>
                <ClayButton asChild size="md">
                  <a href="#skills">
                    <Trans id="home.cta.browse">Browse skills</Trans>
                    <span
                      className="icon-[lucide--arrow-down] size-4"
                      aria-hidden
                    />
                  </a>
                </ClayButton>
              </PressScale>
              <PressScale>
                <ClayButton asChild variant="secondary" size="md">
                  <Link
                    href={siteLayoutConfig.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span
                      className="icon-[lucide--github] size-4"
                      aria-hidden
                    />
                    <Trans id="home.cta.github">Star on GitHub</Trans>
                  </Link>
                </ClayButton>
              </PressScale>
            </div>

            {/* Each separator dot leads its name. The list is shifted left by one dot slot inside a
                clipping box, so a dot that starts a wrapped line is hidden and no line ends on a dot. */}
            <div className="mt-4 overflow-hidden text-[13px] text-muted-foreground md:mt-7">
              <p className="-ml-5 flex flex-wrap">
                <span className="mr-2 ml-5">
                  <Trans id="home.hero.hostsLabel">Works with</Trans>
                </span>
                {HOST_NAMES.map((name, index) => (
                  <span
                    key={name}
                    className={
                      index > 0
                        ? "font-medium whitespace-nowrap text-foreground before:inline-block before:w-5 before:text-center before:font-normal before:text-muted-foreground before:content-['·']"
                        : "font-medium whitespace-nowrap text-foreground"
                    }
                  >
                    {name}
                  </span>
                ))}
              </p>
            </div>
          </SectionReveal>

          <SectionReveal delay={80} className="relative order-1 md:order-2">
            {/* Transparent art on the cream plate; the plate (not the image) changes in dark mode. */}
            <div className="art-plate mx-2.5 my-2.5 aspect-[2/1] md:mx-0 md:aspect-[3/2]">
              <Image
                src={getIllustrationSrc("hero.webp")}
                alt={i18n._({
                  id: "home.hero.art.alt",
                  message:
                    "Nika in a green hooded coat holding a lantern, walking with Kiki in a wizard hat",
                })}
                width={1536}
                height={1024}
                priority
                sizes="(min-width: 1280px) 560px, (min-width: 768px) 45vw, 100vw"
                className="absolute inset-0 size-full object-contain p-2 md:p-5"
              />
            </div>
            <p className="speech-bubble absolute top-9 -left-7 hidden max-w-[230px] px-3.5 py-3 text-[13.5px] leading-[1.45] text-muted-foreground lg:block">
              <Trans id="home.hero.bubble">
                <b className="font-semibold text-foreground">
                  Hi, I&apos;m Nika.
                </b>{" "}
                Kiki and I use these skills in our own repos every day before
                they land here.
              </Trans>
            </p>
          </SectionReveal>
        </div>
      </section>

      <SectionReveal delay={110} className="site-frame">
        <SkillsLibrarySection skills={skills} layout={layout} />
      </SectionReveal>

      <section
        id="install"
        aria-labelledby="install-title"
        className="mt-14 scroll-mt-16 border-t border-border bg-card py-12 md:mt-[72px] md:py-16"
      >
        <div className="site-frame grid items-center gap-7 md:grid-cols-[0.85fr_1.15fr] md:gap-14">
          <div>
            <p className="kicker kicker-leaf">
              <Trans id="home.install.kicker">Install</Trans>
            </p>
            <h2 id="install-title" className="type-h2 mt-2.5">
              <Trans id="home.install.headline">One line, any agent.</Trans>
            </h2>
            <p className="mt-2.5 max-w-[26rem] text-base text-muted-foreground">
              <Trans id="home.install.lede">
                Every skill works in Claude Code, Codex, Cursor and Hermes
                Agent. Install one, or the whole shelf.
              </Trans>
            </p>
          </div>
          <div className="min-w-0 rounded-[20px] border border-border bg-background p-4 md:p-6">
            <HostInstallTabs slug="<slug>" />
          </div>
        </div>
      </section>
    </main>
  );
}
