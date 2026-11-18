import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { SectionReveal } from "@/components/motion/section-reveal";
import { PluginsCatalog } from "@/components/plugins-catalog";
import {
  CC_SAFETY_NET_URL,
  PLUGIN_DOCS,
  PLUGIN_HOST_LABELS,
} from "@/config/plugins";
import { initLingui, initPageLingui } from "@/i18n/initLingui";
import { localeAlternates } from "@/lib/seo";
import type { PluginHost } from "@/lib/plugin-schema";
import { getAllPlugins, pluginMarketplace } from "@/lib/plugins";
import { getIllustrationSrc, getSkillInstallCommand } from "@/lib/skills";

interface PluginsPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({
  params,
}: PluginsPageProps): Promise<Metadata> {
  const locale = await initPageLingui(params);
  const i18n = initLingui(locale);
  const title = i18n._({ id: "plugins.meta.title", message: "Plugins" });
  const description = i18n._({
    id: "plugins.meta.description",
    message:
      "Hook plugins for Claude Code and Codex: block deletes you cannot undo, keep unattended runs moving, and check replies before a turn ends. Tick the ones you want and copy one command.",
  });
  return {
    title,
    description,
    alternates: localeAlternates("/plugins", locale),
    openGraph: { type: "website", title, description },
  };
}

interface Capability {
  id: string;
  name: ReactNode;
  text: ReactNode;
  /** Only hosts whose official docs say a plugin can carry this. */
  hosts: PluginHost[];
}

const code = (text: string) => (
  <code className="rounded bg-muted px-[0.25em] py-px font-mono text-[0.92em] text-foreground">
    {text}
  </code>
);

export default async function PluginsPage({ params }: PluginsPageProps) {
  await initPageLingui(params);
  const plugins = getAllPlugins();
  const marketplace = pluginMarketplace;
  const skillInstall = getSkillInstallCommand("<name>");
  const pluginInstall = `claude plugin install <name> --marketplace ${marketplace.source}`;
  const pluginDisable = `claude plugin disable <name>@${marketplace.name}`;

  // Host support checked against PLUGIN_DOCS on 2026-11-17. Codex docs do not mention
  // slash commands, subagents or LSP in plugins, so those cells carry no Codex mark.
  const capabilities: Capability[] = [
    {
      id: "skill",
      name: <Trans id="plugins.carry.skill.name">Skill</Trans>,
      text: (
        <Trans id="plugins.carry.skill.text">
          Instructions the agent reads and follows when a task matches.
        </Trans>
      ),
      hosts: ["claude-code", "codex"],
    },
    {
      id: "command",
      name: <Trans id="plugins.carry.command.name">Slash command</Trans>,
      text: (
        <Trans id="plugins.carry.command.text">
          A fixed workflow you start by typing {code("/name")}.
        </Trans>
      ),
      hosts: ["claude-code"],
    },
    {
      id: "agent",
      name: <Trans id="plugins.carry.agent.name">Subagent</Trans>,
      text: (
        <Trans id="plugins.carry.agent.text">
          A helper the main agent sends off to do one focused job.
        </Trans>
      ),
      hosts: ["claude-code"],
    },
    {
      id: "hook",
      name: <Trans id="plugins.carry.hook.name">Hook</Trans>,
      text: (
        <Trans id="plugins.carry.hook.text">
          A script the host runs at fixed points, such as before Bash runs or
          when a reply ends. It can allow, block or remind.
        </Trans>
      ),
      hosts: ["claude-code", "codex"],
    },
    {
      id: "mcp",
      name: <Trans id="plugins.carry.mcp.name">MCP server</Trans>,
      text: (
        <Trans id="plugins.carry.mcp.text">
          Connects the agent to outside tools or data, such as a browser or
          design files.
        </Trans>
      ),
      hosts: ["claude-code", "codex"],
    },
    {
      id: "lsp",
      name: <Trans id="plugins.carry.lsp.name">LSP server</Trans>,
      text: (
        <Trans id="plugins.carry.lsp.text">
          Gives the agent go-to-definition and type diagnostics.
        </Trans>
      ),
      hosts: ["claude-code"],
    },
  ];

  const docLinkClass =
    "clay-focus-ring rounded-sm text-link underline underline-offset-2";
  const thClass =
    "border-b border-border px-2.5 py-2.5 text-left align-top font-semibold md:px-3";
  const tdClass = "border-b border-border px-2.5 py-2.5 align-top md:px-3";

  return (
    <main
      id="main-content"
      className="site-page-shell site-frame site-frame--main w-full"
    >
      <SectionReveal delay={20}>
        <header className="flex items-center justify-between gap-8">
          <div className="min-w-0 max-w-3xl">
            <h1 className="type-display text-[clamp(2.4rem,1.6rem+3vw,4rem)]">
              <Trans id="plugins.title">Plugins</Trans>
            </h1>
            <p className="type-lede mt-4 text-pretty text-muted-foreground">
              <Trans id="plugins.intro">
                A plugin is a package your agent host can install, enable and
                disable on demand. One plugin can carry skills, slash commands,
                subagents, hooks, MCP servers and LSP servers; install it once
                and they all work, disable it once and they all stop.
              </Trans>
            </p>
          </div>
          <span className="art-avatar art-avatar--ringed hidden size-36 shrink-0 md:block">
            <Image
              src={getIllustrationSrc("group-tools.webp")}
              alt=""
              width={1024}
              height={1024}
              sizes="144px"
              priority
            />
          </span>
        </header>
      </SectionReveal>

      <SectionReveal delay={60}>
        <section aria-labelledby="plugin-carries" className="mt-12">
          <h2 id="plugin-carries" className="type-h3">
            <Trans id="plugins.carry.heading">What a plugin can carry</Trans>
          </h2>
          <ul className="ink-box ink-raised mt-5 grid gap-px overflow-hidden bg-border sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((item) => (
              <li key={item.id} className="flex flex-col bg-card p-4 md:p-5">
                <h3 className="type-card-title">{item.name}</h3>
                <p className="mt-1.5 flex-1 text-[13.5px] leading-[1.6] text-muted-foreground">
                  {item.text}
                </p>
                <p className="mt-3 flex flex-wrap gap-1.5">
                  {item.hosts.map((host) => (
                    <span key={host} className="nk-tag nk-tag--neutral gap-1">
                      <span
                        className="icon-[lucide--check] size-3"
                        aria-hidden
                      />
                      {PLUGIN_HOST_LABELS[host]}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted-foreground">
            <Trans id="plugins.carry.source">
              A host is marked only where its official docs say so:{" "}
              <a
                href={PLUGIN_DOCS.claudeCode}
                target="_blank"
                rel="noopener noreferrer"
                className={docLinkClass}
              >
                Claude Code plugins reference
              </a>
              ,{" "}
              <a
                href={PLUGIN_DOCS.codexPlugins}
                target="_blank"
                rel="noopener noreferrer"
                className={docLinkClass}
              >
                Codex plugins
              </a>
              ,{" "}
              <a
                href={PLUGIN_DOCS.codexHooks}
                target="_blank"
                rel="noopener noreferrer"
                className={docLinkClass}
              >
                Codex hooks
              </a>
              .
            </Trans>
          </p>
        </section>
      </SectionReveal>

      <SectionReveal delay={80}>
        <section aria-labelledby="skill-vs-plugin" className="mt-12">
          <h2 id="skill-vs-plugin" className="type-h3">
            <Trans id="plugins.compare.heading">
              A skill on its own, or a plugin
            </Trans>
          </h2>
          <div className="ink-box ink-raised mt-5 overflow-x-auto bg-card">
            <table className="w-full border-collapse text-[13.5px] leading-[1.6] md:text-[14px] [&_code]:[overflow-wrap:anywhere] [&_tr:last-child>*]:border-b-0">
              <thead className="bg-muted text-foreground">
                <tr>
                  <th className={`${thClass} w-20 md:w-36`}>
                    <span className="sr-only">
                      <Trans id="plugins.compare.aspect">Aspect</Trans>
                    </span>
                  </th>
                  <th className={thClass}>
                    <Trans id="plugins.compare.skill">A skill on its own</Trans>
                  </th>
                  <th className={thClass}>
                    <Trans id="plugins.compare.plugin">Plugin</Trans>
                  </th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr>
                  <th scope="row" className={`${thClass} text-foreground`}>
                    <Trans id="plugins.compare.what">What it is</Trans>
                  </th>
                  <td className={tdClass}>
                    <Trans id="plugins.compare.what.skill">
                      Instructions the agent reads and follows.
                    </Trans>
                  </td>
                  <td className={tdClass}>
                    <Trans id="plugins.compare.what.plugin">
                      A package that can hold skills, hooks and more.
                    </Trans>
                  </td>
                </tr>
                <tr>
                  <th scope="row" className={`${thClass} text-foreground`}>
                    <Trans id="plugins.compare.runs">When it acts</Trans>
                  </th>
                  <td className={tdClass}>
                    <Trans id="plugins.compare.runs.skill">
                      When the agent decides a task matches.
                    </Trans>
                  </td>
                  <td className={tdClass}>
                    <Trans id="plugins.compare.runs.plugin">
                      Hooks run at fixed points, whether or not the agent thinks
                      of them.
                    </Trans>
                  </td>
                </tr>
                <tr>
                  <th scope="row" className={`${thClass} text-foreground`}>
                    <Trans id="plugins.compare.install">Install</Trans>
                  </th>
                  <td className={tdClass}>{code(skillInstall)}</td>
                  <td className={tdClass}>{code(pluginInstall)}</td>
                </tr>
                <tr>
                  <th scope="row" className={`${thClass} text-foreground`}>
                    <Trans id="plugins.compare.off">Turn it off</Trans>
                  </th>
                  <td className={tdClass}>
                    <Trans id="plugins.compare.off.skill">
                      Delete the skill folder.
                    </Trans>
                  </td>
                  <td className={tdClass}>
                    <Trans id="plugins.compare.off.plugin">
                      {code(pluginDisable)} turns off the whole package; enable
                      it again any time.
                    </Trans>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-pretty text-[15px] leading-[1.7]">
            <Trans id="plugins.hooksOnly">
              Every plugin on this site carries hooks: they run at fixed points
              and stop deletes you cannot undo, commands that would stall an
              unattended run, and replies that miss the mark.
            </Trans>
          </p>
        </section>
      </SectionReveal>

      <div className="mt-12">
        {plugins.length > 0 ? (
          <PluginsCatalog
            plugins={plugins.map(
              ({ name, category, hosts, triggers, effect, scenario }) => ({
                name,
                category,
                hosts,
                triggers,
                effect,
                scenario,
              }),
            )}
            marketplace={marketplace}
          />
        ) : (
          <p className="ink-box ink-box--xl ink-box--dashed px-4 py-12 text-center text-muted-foreground">
            <Trans id="plugins.empty">No plugins are published yet.</Trans>
          </p>
        )}
      </div>

      <aside className="ink-box ink-raised mt-12 flex flex-col gap-2 bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-[14px] leading-[1.6] text-muted-foreground">
          <Trans id="plugins.alsoSee">
            Also worth a look:{" "}
            <strong className="font-semibold text-foreground">
              cc-safety-net
            </strong>
            , a third-party guard for Claude Code, Codex and other agent CLIs.
            It also blocks reading {code(".env")} files and piping{" "}
            {code("curl")} into a shell.
          </Trans>
        </p>
        <a
          href={CC_SAFETY_NET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="clay-focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-sm text-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          <span className="icon-[lucide--github] size-4" aria-hidden />
          kenryu42/cc-safety-net
          <span
            className="icon-[lucide--arrow-up-right] size-3.5"
            aria-hidden
          />
        </a>
      </aside>
    </main>
  );
}
