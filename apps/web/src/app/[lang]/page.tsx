import Image from "next/image";
import Link from "next/link";
import { Plural, Trans } from "@lingui/react/macro";
import { CommandBlock } from "@/components/command-block";
import { HostInstallTabs } from "@/components/host-install-tabs";
import { HoverFx } from "@/components/motion/hover-fx";
import { PressScale } from "@/components/motion/press-scale";
import {
  FeaturedSkillsSection,
  SkillsLibrarySection,
} from "@/components/skills-library-section";
import { ClayButton, InkStars } from "@/components/ui";
import { PLUGIN_TRIGGER_LABELS } from "@/config/plugins";
import { siteLayoutConfig } from "@/config/site-layout";
import type { AppLocale } from "@/i18n/config";
import { initLingui, initPageLingui } from "@/i18n/initLingui";
import { LocaleLink } from "@/i18n/locale-link";
import { getAllPlugins, type PluginItem } from "@/lib/plugins";
import type { PluginCategory } from "@/lib/plugin-schema";
import {
  getAllSkills,
  getCatalogLayout,
  getIllustrationSrc,
  skillsRepo,
} from "@/lib/skills";

interface HomePageProps {
  params: Promise<{ lang: string }>;
}

const HOST_NAMES = ["Claude Code", "Codex", "Cursor", "Hermes Agent"];

/** Without `--skill`, the skills CLI lists every skill in the repo to pick from. */
const INSTALL_ALL_COMMAND = `npx skills add ${skillsRepo}`;

/** One glyph per plugin category for the strip's icon square (plugins have no logos). */
const PLUGIN_CATEGORY_ICONS: Record<PluginCategory, string> = {
  safety: "icon-[lucide--shield-check]",
  unattended: "icon-[lucide--moon-star]",
  "reply-quality": "icon-[lucide--message-square-text]",
};

/** Literal class names so Tailwind sees them: four plugins or fewer sit in one row from `md`. */
const PLUGIN_COLUMNS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};
const PLUGIN_STRIP_LIMIT = 4;

/** The hero's single emphasis: a hand-drawn leaf stroke under the words, drawn in on load (effects-layout.css). */
function HandUnderline({ children }: { children?: React.ReactNode }) {
  return (
    <span className="hl-underline">
      {children}
      <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden>
        <path d="M3 14 C 50 4, 120 4, 197 11" pathLength={1} />
      </svg>
    </span>
  );
}

/** Home Plugins section: a one-row header, then up to four small cards in one row. */
function PluginsStrip({
  plugins,
  locale,
}: {
  plugins: PluginItem[];
  locale: AppLocale;
}) {
  const cards = plugins.slice(0, PLUGIN_STRIP_LIMIT);
  const pluginCount = plugins.length;
  if (cards.length === 0) return null;

  return (
    <section
      aria-labelledby="plugins-title"
      className="home-section ink-rule-t"
    >
      <div className="home-section-head">
        <div>
          <h2 id="plugins-title" className="type-h3">
            <Trans id="home.plugins.title">Plugins</Trans>
            <span className="type-mono ml-2 text-[12px] text-muted-foreground">
              <Plural
                id="home.plugins.count"
                value={pluginCount}
                one="# plugin"
                other="# plugins"
              />
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Trans id="home.plugins.lede">
              Install a whole bundle in Claude Code or Codex; hooks stop or flag
              risky moves for you.
            </Trans>
          </p>
        </div>
        <LocaleLink
          href="/plugins"
          className="clay-focus-ring inline-flex shrink-0 items-center gap-1 rounded-sm text-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          <Trans id="home.plugins.browse">Browse all</Trans>
          <span className="icon-[lucide--arrow-right] size-4" aria-hidden />
        </LocaleLink>
      </div>

      <ul
        className={`grid grid-cols-1 gap-3 ${PLUGIN_COLUMNS[cards.length] ?? "md:grid-cols-4"}`}
      >
        {cards.map((plugin) => {
          const effect = plugin.effect[locale];
          return (
            <li key={plugin.name} className="fx-host group/plugin min-w-0">
              <div className="home-plugin-card ink-box ink-box--md fx-surface clay-focus-link-ring flex h-full min-w-0 items-center gap-3 bg-card p-3">
                <HoverFx />
                <span
                  aria-hidden
                  className="home-plugin-icon grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-muted-foreground group-has-[a:focus-visible]/plugin:text-primary pointer-fine:group-hover/plugin:text-primary"
                >
                  <span
                    className={`${plugin.category ? PLUGIN_CATEGORY_ICONS[plugin.category] : "icon-[lucide--blocks]"} size-[18px]`}
                  />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <LocaleLink
                    href={`/plugins/${plugin.name}`}
                    className="truncate font-mono text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:z-[2] after:rounded-[inherit] after:content-['']"
                  >
                    {plugin.name}
                  </LocaleLink>
                  <span
                    className="truncate text-xs text-muted-foreground"
                    title={effect}
                  >
                    {plugin.triggers.length > 0 && (
                      <>
                        {plugin.triggers
                          .map(
                            (trigger) => PLUGIN_TRIGGER_LABELS[trigger][locale],
                          )
                          .join(" · ")}
                        {" · "}
                      </>
                    )}
                    {effect}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function HomePage({ params }: HomePageProps) {
  const locale = await initPageLingui(params);
  const i18n = initLingui(locale);
  const heroArtAlt = i18n._({
    id: "home.hero.art.alt",
    message:
      "Nika in a teal hoodie typing on a laptop, cross-legged, while blue little Kiki in a purple wizard hat sends paper planes off with a star wand",
  });
  const skills = getAllSkills();
  const layout = getCatalogLayout();
  const plugins = getAllPlugins();

  return (
    <main id="main-content" className="relative flex w-full flex-col">
      <section className="home-hero hero-wash" aria-labelledby="hero-title">
        <div className="site-frame home-hero-grid">
          <div className="min-w-0">
            <h1
              id="hero-title"
              className="type-display home-hero-title relative text-balance [word-break:keep-all]"
            >
              <InkStars className="absolute -top-3 -left-10 hidden size-9 xl:block" />
              <Trans id="home.hero.headline">
                Teach your coding agent how to{" "}
                <HandUnderline>finish the job.</HandUnderline>
              </Trans>
            </h1>

            <p className="mt-2 text-base text-muted-foreground md:text-lg">
              <Trans id="home.install.headline">One line, any agent.</Trans>
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <div className="min-w-0 flex-[1_1_18rem] sm:max-w-[30rem]">
                <CommandBlock commands={[INSTALL_ALL_COMMAND]} />
              </div>
              <PressScale>
                <ClayButton asChild variant="secondary" size="md">
                  {/* Same-page hash: SmoothScrollProvider (locale layout) animates the scroll. */}
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
                    <span className="max-sm:sr-only">GitHub</span>
                  </Link>
                </ClayButton>
              </PressScale>
            </div>

            <p className="mt-3 text-[13px] text-muted-foreground">
              <Trans id="home.hero.hostsLabel">Works with</Trans>{" "}
              <span className="font-medium text-foreground">
                {HOST_NAMES.join(" · ")}
              </span>
            </p>
          </div>

          <div className="home-hero-art hidden md:block">
            {/* A full painted banner; light and dark are two paintings, faded into the page by a CSS mask. */}
            <div className="home-hero-figure">
              <Image
                src={getIllustrationSrc("hero-banner-light.webp")}
                alt={heroArtAlt}
                width={1536}
                height={1024}
                priority
                sizes="(min-width: 1024px) 640px, 480px"
                className="home-hero-banner dark:hidden"
              />
              <Image
                src={getIllustrationSrc("hero-banner-dark.webp")}
                alt=""
                width={1536}
                height={1024}
                sizes="(min-width: 1024px) 640px, 480px"
                className="home-hero-banner hidden dark:block"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="site-frame home-stack">
        <SkillsLibrarySection skills={skills} layout={layout} />

        <FeaturedSkillsSection skills={skills} layout={layout} />

        <PluginsStrip plugins={plugins} locale={locale} />

        <section
          id="install"
          aria-labelledby="install-title"
          className="home-section ink-rule-t scroll-mt-16"
        >
          <div className="home-section-head">
            <div>
              <h2 id="install-title" className="type-h3">
                <Trans id="home.install.kicker">Install</Trans>
              </h2>
              <p className="text-sm text-muted-foreground">
                <Trans id="home.install.lede">
                  Every skill works in Claude Code, Codex, Cursor and Hermes
                  Agent. Install one, or the whole shelf.
                </Trans>
              </p>
            </div>
          </div>
          <div className="ink-box ink-box--xl ink-raised min-w-0 bg-background p-3 md:p-4">
            <HostInstallTabs slug="<slug>" />
          </div>
        </section>
      </div>
    </main>
  );
}
