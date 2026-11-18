import type { Metadata } from "next";
import { Trans } from "@lingui/react/macro";
import { notFound } from "next/navigation";
import { SectionReveal } from "@/components/motion/section-reveal";
import { PluginInstallPanel } from "@/components/plugin-install-panel";
import { ClaySurface } from "@/components/ui";
import {
  PLUGIN_CATEGORY_LABELS,
  PLUGIN_HOST_LABELS,
  PLUGIN_TRIGGER_LABELS,
} from "@/config/plugins";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { initLingui, initPageLingui } from "@/i18n/initLingui";
import { LocaleLink } from "@/i18n/locale-link";
import {
  claudeManageCommands,
  codexRemoveCommand,
  removeRepeatedCommandBlocks,
} from "@/lib/plugin-install";
import type { PluginSectionKey } from "@/lib/plugin-schema";
import {
  getAllPlugins,
  getPluginBySlug,
  getPluginSourceUrl,
  pluginMarketplace,
  resolvePluginReadmeLinks,
} from "@/lib/plugins";
import { localeAlternates } from "@/lib/seo";
import { renderSectionContent } from "@/lib/skill-markdown";

interface PluginPageProps {
  params: Promise<{ lang: string; slug: string }>;
}

// Every plugin is known at build time; anything else is a 404.
export const dynamicParams = false;

export async function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((lang) =>
    getAllPlugins().map((plugin) => ({ lang, slug: plugin.name })),
  );
}

export async function generateMetadata({
  params,
}: PluginPageProps): Promise<Metadata> {
  const locale = await initPageLingui(params);
  const i18n = initLingui(locale);
  const { slug } = await params;
  const plugin = getPluginBySlug(slug);
  if (!plugin)
    return {
      title: i18n._({
        id: "pluginDetail.meta.notFoundTitle",
        message: "Plugin not found",
      }),
    };
  const title = i18n._({
    id: "pluginDetail.meta.title",
    message: "{name} plugin",
    values: { name: plugin.name },
  });
  const description = plugin.effect[locale];
  return {
    title,
    description,
    alternates: localeAlternates(`/plugins/${plugin.name}`, locale),
    openGraph: { type: "article", title, description },
  };
}

const headingClass = "type-h3 mb-4 scroll-mt-24";

// README sections on narrow screens. Short inline code is nowrap, and a run like
// `/tmp`、`/private/tmp` has no line-break opportunity before "/", so the whole run overflowed;
// as inline-blocks the chips move to the next line whole (flags never split at a hyphen).
// Tables keep the site's in-card sideways scroll and show an edge shadow while columns sit
// off-screen; background-attachment local/scroll hides each shadow once that edge is reached.
const readmeBodyClass = [
  "[&_:is(p,li)>code.whitespace-nowrap]:inline-block [&_:is(p,li)>code.whitespace-nowrap]:max-w-full [&_:is(p,li)>code.whitespace-nowrap]:leading-[1.45]",
  "[&_div:has(>table)]:[background:linear-gradient(to_right,var(--card)_30%,transparent)_left/2.5rem_100%_no-repeat_local,linear-gradient(to_left,var(--card)_30%,transparent)_right/2.5rem_100%_no-repeat_local,radial-gradient(farthest-side_at_0_50%,var(--border),transparent)_left/1rem_100%_no-repeat_scroll,radial-gradient(farthest-side_at_100%_50%,var(--border),transparent)_right/1rem_100%_no-repeat_scroll]",
].join(" ");

interface SectionGroupItem {
  key: PluginSectionKey;
  title: string;
}

export default async function PluginDetailPage({ params }: PluginPageProps) {
  const locale = await initPageLingui(params);
  const { slug } = await params;
  const plugin = getPluginBySlug(slug);
  if (!plugin) notFound();

  const i18n = initLingui(locale);
  const sections = plugin.sections[locale];
  const manage = claudeManageCommands([plugin], pluginMarketplace);
  const codexRemove = codexRemoveCommand([plugin], pluginMarketplace);
  const sourceUrl = getPluginSourceUrl(plugin);
  const claudeOnly =
    plugin.hosts.length === 1 && plugin.hosts[0] === "claude-code";
  // The install card already lists these commands; keep only the README's other notes.
  const turningOffNote = sections.turningOff
    ? removeRepeatedCommandBlocks(
        sections.turningOff,
        [
          manage?.disable,
          manage?.uninstall,
          manage?.update,
          codexRemove,
        ].filter((command): command is string => Boolean(command)),
      )
    : "";

  // What the plugin does to the visitor's agent comes first; why it exists comes after.
  const behaviour: SectionGroupItem[] = [
    {
      key: "whatItBlocks",
      title: i18n._({
        id: "pluginDetail.whatItBlocks",
        message: "What it blocks",
      }),
    },
    {
      key: "whatAgentSees",
      title: i18n._({
        id: "pluginDetail.whatAgentSees",
        message: "What the agent sees when blocked",
      }),
    },
  ];
  const background: SectionGroupItem[] = [
    {
      key: "scenario",
      title: i18n._({ id: "pluginDetail.scenario", message: "Scenario" }),
    },
    {
      key: "whyUse",
      title: i18n._({ id: "pluginDetail.whyUse", message: "Why use it" }),
    },
    {
      key: "whyBuilt",
      title: i18n._({
        id: "pluginDetail.whyBuilt",
        message: "Why we built our own",
      }),
    },
    {
      key: "howItWorks",
      title: i18n._({
        id: "pluginDetail.howItWorks",
        message: "How it works",
      }),
    },
  ];
  const present = (items: SectionGroupItem[]) =>
    items.filter((item) => sections[item.key]);
  const behaviourItems = present(behaviour);
  const backgroundItems = present(background);

  const readme = (key: PluginSectionKey) => (
    <div className={readmeBodyClass}>
      {renderSectionContent(
        resolvePluginReadmeLinks(sections[key] ?? "", plugin),
      )}
    </div>
  );

  return (
    <main
      id="main-content"
      className="site-page-shell site-frame site-frame--detail w-full"
    >
      <SectionReveal delay={20}>
        <LocaleLink
          href="/plugins"
          className="clay-focus-ring mb-4 inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="icon-[lucide--arrow-left] size-3.5" aria-hidden />
          <Trans id="pluginDetail.back">All plugins</Trans>
        </LocaleLink>
      </SectionReveal>

      {/*
        Desktop: content on the left, install card on the right and sticky.
        Phone: DOM order puts the install card right after the title.
      */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,31rem)]">
        <SectionReveal
          delay={60}
          className="min-w-0 lg:col-start-1 lg:row-start-1"
        >
          <header className="ink-box ink-box--xl ink-raised bg-card p-6 md:p-9">
            <ul className="flex flex-wrap items-center gap-1.5">
              {plugin.category && (
                <li>
                  <LocaleLink
                    href={`/plugins?group=${plugin.category}`}
                    className="nk-tag clay-focus-ring gap-1 transition-colors hover:text-link"
                  >
                    {PLUGIN_CATEGORY_LABELS[plugin.category].title[locale]}
                  </LocaleLink>
                </li>
              )}
              {plugin.triggers.map((trigger) => (
                <li key={trigger} className="nk-tag nk-tag--neutral gap-1">
                  <span className="icon-[lucide--clock-3] size-3" aria-hidden />
                  {PLUGIN_TRIGGER_LABELS[trigger][locale]}
                </li>
              ))}
              {claudeOnly ? (
                <li className="nk-tag nk-tag--neutral">
                  <Trans id="pluginDetail.claudeOnly">Claude Code only</Trans>
                </li>
              ) : (
                plugin.hosts.map((host) => (
                  <li key={host} className="nk-tag nk-tag--neutral">
                    {PLUGIN_HOST_LABELS[host]}
                  </li>
                ))
              )}
            </ul>
            <h1 className="type-display mt-4 font-mono text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] tracking-[-0.02em] [overflow-wrap:anywhere]">
              {plugin.name}
            </h1>
            {plugin.effect[locale] && (
              <p className="type-lede mt-4 max-w-[60ch] text-base text-pretty text-muted-foreground md:text-lg">
                {plugin.effect[locale]}
              </p>
            )}
          </header>
        </SectionReveal>

        <aside
          aria-labelledby="install"
          className="min-w-0 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-stretch"
        >
          {/* Sticky only when the viewport is tall enough to show the whole card. */}
          <div className="lg:[@media(min-height:880px)]:sticky lg:[@media(min-height:880px)]:top-24">
            <SectionReveal delay={100}>
              <section className="ink-box ink-box--xl ink-raised grid gap-5 bg-tint p-5 md:p-6 dark:bg-card">
                <h2 id="install" className="type-h3 scroll-mt-24">
                  <Trans id="pluginDetail.install.manageHeading">
                    Install and turn off
                  </Trans>
                </h2>
                <PluginInstallPanel
                  plugins={[{ name: plugin.name, hosts: plugin.hosts }]}
                  marketplace={pluginMarketplace}
                  manageNote={
                    turningOffNote ? (
                      <div
                        className={`border-t border-border pt-3 text-sm ${readmeBodyClass}`}
                      >
                        {renderSectionContent(
                          resolvePluginReadmeLinks(turningOffNote, plugin),
                        )}
                      </div>
                    ) : null
                  }
                />
                <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-tint-border pt-4 text-[13px] text-muted-foreground">
                  <code className="font-mono [overflow-wrap:anywhere] text-foreground">
                    {plugin.sourcePath}
                  </code>
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="clay-focus-ring inline-flex items-center gap-1.5 rounded-sm font-semibold text-link underline-offset-4 hover:underline"
                  >
                    <span
                      className="icon-[lucide--github] size-3.5"
                      aria-hidden
                    />
                    <Trans id="pluginDetail.sourceLink">
                      View source on GitHub
                    </Trans>
                  </a>
                </p>
              </section>
            </SectionReveal>
          </div>
        </aside>

        {behaviourItems.length > 0 && (
          <SectionReveal delay={140} className="min-w-0 lg:col-start-1">
            <ClaySurface
              tone="base"
              elevation="raised"
              className="grid min-w-0 gap-9 p-6 md:p-8"
            >
              {behaviourItems.map((item) => (
                <section
                  key={item.key}
                  aria-labelledby={item.key}
                  className="min-w-0"
                >
                  <h2 id={item.key} className={headingClass}>
                    {item.title}
                  </h2>
                  {readme(item.key)}
                </section>
              ))}
            </ClaySurface>
          </SectionReveal>
        )}

        {backgroundItems.length > 0 && (
          <SectionReveal delay={180} className="min-w-0 lg:col-start-1">
            <section
              aria-labelledby="why-this-plugin"
              className="ink-box ink-box--xl grid min-w-0 gap-8 bg-background p-6 md:p-8"
            >
              <h2 id="why-this-plugin" className="type-h3 scroll-mt-24">
                <Trans id="pluginDetail.whyThisPlugin">Why this plugin</Trans>
              </h2>
              {backgroundItems.map((item) => (
                <section
                  key={item.key}
                  aria-labelledby={item.key}
                  className="min-w-0"
                >
                  <h3
                    id={item.key}
                    className="mb-3 scroll-mt-24 text-base font-semibold text-foreground md:text-lg"
                  >
                    {item.title}
                  </h3>
                  {readme(item.key)}
                </section>
              ))}
            </section>
          </SectionReveal>
        )}
      </div>
    </main>
  );
}
