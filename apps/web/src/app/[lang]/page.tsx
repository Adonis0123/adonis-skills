import Image from "next/image";
import Link from "next/link";
import { Trans } from "@lingui/react/macro";
import { SectionReveal } from "@/components/motion/section-reveal";
import { CommandBlock } from "@/components/command-block";
import { SkillsLibrarySection } from "@/components/skills-library-section";
import { ClayButton, ClaySurface } from "@/components/ui";
import { HOST_INSTALLS } from "@/config/hosts";
import { siteLayoutConfig } from "@/config/site-layout";
import { initLingui, initPageLingui } from "@/i18n/initLingui";
import { getAllSkills } from "@/lib/skills";

interface HomePageProps {
  params: Promise<{ lang: string }>;
}

export default async function HomePage({ params }: HomePageProps) {
  const i18n = initLingui(await initPageLingui(params));
  const skills = getAllSkills();
  const skillsCount = skills.length;
  const hostNames = ["Claude Code", "Codex", "Cursor", "Hermes Agent"];

  return (
    <main
      id="main-content"
      className="site-page-shell site-frame site-frame--main relative flex w-full flex-col"
    >
      <SectionReveal delay={20}>
        <section className="clay-surface clay-tone-cream clay-elevation-floating relative overflow-hidden rounded-[1.35rem] md:rounded-[1.6rem] md:bg-[linear-gradient(90deg,var(--card)_38%,var(--hero-art-bg)_64%)]">
          <div className="relative z-10 grid items-center md:grid-cols-[1.05fr_0.95fr]">
            <div className="p-5 sm:p-7 md:py-12 md:pl-10 md:pr-4">
              <h1 className="text-[1.75rem] leading-[1.15] text-balance [word-break:keep-all] sm:text-4xl lg:text-5xl">
                <Trans id="home.hero.title">
                  Small agent skills I built and use every day.
                </Trans>
              </h1>

              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:mt-4 md:text-base md:leading-7">
                <Trans id="home.hero.description">
                  I&apos;m Nika. I build small tools with AI and carry them
                  around like a lantern. These are the {skillsCount} skills I
                  reach for in my own coding work.
                </Trans>
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2.5 sm:mt-6 sm:gap-3">
                <ClayButton asChild size="md">
                  <a href="#skills">
                    <span
                      className="icon-[lucide--arrow-down] size-4"
                      aria-hidden
                    />
                    <Trans id="home.cta.browse">Browse skills</Trans>
                  </a>
                </ClayButton>
                <ClayButton asChild variant="secondary" size="md">
                  <Link
                    href={siteLayoutConfig.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span
                      className="icon-[lucide--github] size-4"
                      aria-hidden
                    />
                    GitHub
                  </Link>
                </ClayButton>
              </div>

              {/* Each separator dot leads its name. The list is shifted left by one dot slot inside a
                  clipping box, so a dot that starts a wrapped line is hidden and no line ends on a dot. */}
              <div className="mt-5 overflow-hidden text-xs text-muted-foreground sm:text-sm">
                <p className="-ml-5 flex flex-wrap">
                  <span className="mr-1.5 ml-5">
                    <Trans id="home.hero.hostsLabel">Works with</Trans>
                  </span>
                  {hostNames.map((name, index) => (
                    <span
                      key={name}
                      className={
                        index > 0
                          ? "whitespace-nowrap before:inline-block before:w-5 before:text-center before:content-['·']"
                          : "whitespace-nowrap"
                      }
                    >
                      {name}
                    </span>
                  ))}
                </p>
              </div>
            </div>

            {/* Light: the gradient behind the card ends in the illustration's own backdrop,
                so its edges disappear. Dark: the art sits in a framed panel instead. */}
            <div className="hero-art-frame hidden self-stretch md:flex md:items-center dark:p-6">
              <Image
                src="/brand/hero.webp"
                alt=""
                width={960}
                height={614}
                priority
                sizes="(min-width: 1400px) 640px, 45vw"
                className="hero-art-fade h-auto w-full dark:rounded-[1.2rem]"
              />
            </div>
          </div>
        </section>
      </SectionReveal>

      <SectionReveal delay={110} className="mt-6 md:mt-10">
        <SkillsLibrarySection skills={skills} />
      </SectionReveal>

      <SectionReveal delay={160} className="mt-10 md:mt-14">
        <section aria-labelledby="install-title">
          <h2 id="install-title" className="text-2xl md:text-3xl">
            <Trans id="home.install.title">Install into your agent</Trans>
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-balance text-muted-foreground md:text-base">
            <Trans id="home.install.intro">
              Every skill works in Claude Code, Codex, Cursor, and Hermes Agent.
              Each skill page has the exact command.
            </Trans>
          </p>

          {/* One row per Host so full commands fit on desktop; stacks on mobile. */}
          <ul className="mt-5 grid gap-3">
            {HOST_INSTALLS.map((host) => (
              <li key={host.id} className="min-w-0">
                <ClaySurface
                  tone="base"
                  elevation="raised"
                  className="grid gap-3 rounded-[1.2rem] p-4 md:grid-cols-[13rem_minmax(0,1fr)] md:items-center md:gap-6 md:p-5"
                >
                  <div>
                    <p className="text-base font-bold">{host.label}</p>
                    <p className="text-xs text-pretty text-muted-foreground">
                      {host.installsAll ? (
                        <Trans id="home.install.scope.all">
                          Installs the whole collection.
                        </Trans>
                      ) : (
                        <Trans id="home.install.scope.one">
                          Installs one skill; replace &lt;slug&gt; with its
                          name.
                        </Trans>
                      )}
                    </p>
                  </div>
                  <CommandBlock
                    commands={host.commands("<slug>")}
                    label={i18n._({
                      id: "home.install.copy.aria",
                      message: "Copy the {host} install command",
                      values: { host: host.label },
                    })}
                  />
                </ClaySurface>
              </li>
            ))}
          </ul>
        </section>
      </SectionReveal>
    </main>
  );
}
