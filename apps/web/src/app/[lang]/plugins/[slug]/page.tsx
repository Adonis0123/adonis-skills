import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { notFound } from "next/navigation";
import { CommandBlock } from "@/components/command-block";
import { SectionReveal } from "@/components/motion/section-reveal";
import { PluginInstallPanel } from "@/components/plugin-install-panel";
import { TocNav, type TocEntry } from "@/components/toc-nav";
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
  "[&_div:has(>table)]:[background:linear-gradient(to_right,var(--card)_30%,transparent)_left/2.5rem_100%_no-repeat_local,linear-gradient(to_left,var(--card)_30%,transparent)_right/2.5rem_100%_no-repeat_local,radial-gradient(farthest-side_at_0_50%,color-mix(in_oklab,var(--foreground)_30%,transparent),transparent)_left/1rem_100%_no-repeat_scroll,radial-gradient(farthest-side_at_100%_50%,color-mix(in_oklab,var(--foreground)_30%,transparent),transparent)_right/1rem_100%_no-repeat_scroll]",
].join(" ");

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
  // The structured rows below already show these commands; drop README blocks that only repeat them.
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

  const sectionTitles: Record<PluginSectionKey, string> = {
    scenario: i18n._({ id: "pluginDetail.scenario", message: "Scenario" }),
    whyUse: i18n._({ id: "pluginDetail.whyUse", message: "Why use it" }),
    whyBuilt: i18n._({
      id: "pluginDetail.whyBuilt",
      message: "Why we built our own",
    }),
    howItWorks: i18n._({
      id: "pluginDetail.howItWorks",
      message: "How it works",
    }),
    whatItBlocks: i18n._({
      id: "pluginDetail.whatItBlocks",
      message: "What it blocks",
    }),
    whatAgentSees: i18n._({
      id: "pluginDetail.whatAgentSees",
      message: "What the agent sees when blocked",
    }),
    turningOff: i18n._({
      id: "pluginDetail.turningOff",
      message: "Disable and uninstall",
    }),
  };
  const readmeKeys = (
    [
      "scenario",
      "whyUse",
      "whyBuilt",
      "howItWorks",
      "whatItBlocks",
      "whatAgentSees",
    ] as const
  ).filter((key) => sections[key]);

  // Page order: install sits in the header row, then the README sections.
  const toc: TocEntry[] = [
    {
      id: "install",
      label: i18n._({ id: "pluginDetail.install", message: "Install" }),
      level: 2,
    },
    ...readmeKeys.map((key) => ({
      id: key,
      label: sectionTitles[key],
      level: 2,
    })),
    { id: "turning-off", label: sectionTitles.turningOff, level: 2 },
    {
      id: "source",
      label: i18n._({ id: "pluginDetail.source", message: "Source" }),
      level: 2,
    },
  ];

  const block = (id: string, title: string, body: ReactNode) => (
    <ClaySurface key={id} tone="base" elevation="raised" className="p-5 md:p-7">
      <h2 id={id} className={headingClass}>
        {title}
      </h2>
      <div className={readmeBodyClass}>{body}</div>
    </ClaySurface>
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

      <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch">
        <SectionReveal delay={60} className="min-w-0">
          <header className="h-full rounded-[22px] border border-border bg-card p-6 md:p-9">
            {plugin.category && (
              <LocaleLink
                href={`/plugins?group=${plugin.category}`}
                className="clay-focus-ring inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-muted-foreground transition-colors hover:text-link"
              >
                {PLUGIN_CATEGORY_LABELS[plugin.category].title[locale]}
                <span
                  className="icon-[lucide--arrow-up-right] size-3.5"
                  aria-hidden
                />
              </LocaleLink>
            )}
            <h1 className="type-display mt-3 font-mono text-[clamp(1.9rem,1.3rem+2.2vw,3rem)] tracking-[-0.02em] [overflow-wrap:anywhere]">
              {plugin.name}
            </h1>
            {plugin.effect[locale] && (
              <p className="type-lede mt-5 max-w-3xl text-base text-pretty text-muted-foreground md:text-lg">
                {plugin.effect[locale]}
              </p>
            )}
            <ul className="mt-5 flex flex-wrap items-center gap-1.5">
              {plugin.triggers.map((trigger) => (
                <li key={trigger} className="nk-tag gap-1">
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
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="clay-focus-ring mt-6 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-link underline-offset-4 hover:underline"
            >
              <span className="icon-[lucide--github] size-4" aria-hidden />
              <Trans id="pluginDetail.sourceLink">View source on GitHub</Trans>
            </a>
          </header>
        </SectionReveal>

        <SectionReveal delay={100} className="min-w-0">
          <section
            aria-labelledby="install"
            className="h-full rounded-[22px] border border-tint-border bg-tint p-5 md:p-7 dark:bg-card"
          >
            <h2 id="install" className="type-h3 mb-4 scroll-mt-24">
              <Trans id="pluginDetail.install.heading">
                Add it to your agent
              </Trans>
            </h2>
            <PluginInstallPanel
              plugins={[{ name: plugin.name, hosts: plugin.hosts }]}
              marketplace={pluginMarketplace}
              showManage={false}
            />
          </section>
        </SectionReveal>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          {readmeKeys.map((key) =>
            block(
              key,
              sectionTitles[key],
              renderSectionContent(
                resolvePluginReadmeLinks(sections[key] ?? "", plugin),
              ),
            ),
          )}

          {block(
            "turning-off",
            sectionTitles.turningOff,
            <div className="space-y-4">
              {(() => {
                const rows: [string, string, string][] = [];
                if (manage)
                  rows.push(
                    [
                      "Claude Code",
                      i18n._({
                        id: "pluginDetail.manage.disable",
                        message: "Disable",
                      }),
                      manage.disable,
                    ],
                    [
                      "Claude Code",
                      i18n._({
                        id: "pluginDetail.manage.uninstall",
                        message: "Uninstall",
                      }),
                      manage.uninstall,
                    ],
                    [
                      "Claude Code",
                      i18n._({
                        id: "pluginDetail.manage.update",
                        message: "Update",
                      }),
                      manage.update,
                    ],
                  );
                if (codexRemove)
                  rows.push([
                    "Codex",
                    i18n._({
                      id: "pluginDetail.manage.remove",
                      message: "Remove",
                    }),
                    codexRemove,
                  ]);
                if (rows.length === 0) return null;
                return (
                  <dl className="grid gap-2.5">
                    {rows.map(([host, label, command]) => (
                      <div
                        key={command}
                        className="grid gap-1.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-center sm:gap-3"
                      >
                        <dt className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {label}
                          </span>{" "}
                          · {host}
                        </dt>
                        <dd className="min-w-0">
                          <CommandBlock commands={[command]} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                );
              })()}
              {turningOffNote &&
                renderSectionContent(
                  resolvePluginReadmeLinks(turningOffNote, plugin),
                )}
            </div>,
          )}

          {block(
            "source",
            i18n._({ id: "pluginDetail.source", message: "Source" }),
            <p className="text-[15px] leading-7">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="clay-focus-ring inline-flex items-center gap-1.5 rounded-sm font-mono text-[14px] text-link underline underline-offset-2"
              >
                {plugin.sourcePath}
                <span
                  className="icon-[lucide--arrow-up-right] size-3.5"
                  aria-hidden
                />
              </a>
            </p>,
          )}
        </div>

        {toc.length > 2 && (
          <TocNav
            title={<Trans id="pluginDetail.toc.title">On this page</Trans>}
            entries={toc}
          />
        )}
      </div>
    </main>
  );
}
