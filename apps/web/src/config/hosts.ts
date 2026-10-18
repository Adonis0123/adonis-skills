import { siteLayoutConfig } from "@/config/site-layout";
import { skillsRepo } from "@/lib/skills";

export type HostId = "skills-cli" | "claude-code" | "hermes";

export interface HostInstall {
  id: HostId;
  /** Product names shown on the tab; not translated. */
  label: string;
  /** Second line on the tab: who it is for, or how it installs. Not translated. */
  subtitle: string;
  /** True when the method installs the whole collection, not one skill. */
  installsAll: boolean;
  /** Commands to run in order. `slug` is omitted for collection-level installs. */
  commands: (slug: string) => string[];
}

const { ownerDisplay } = siteLayoutConfig;
const repoName = skillsRepo.split("/")[1];

// Adding a Host means adding one entry here; pages and tabs read only this list.
export const HOST_INSTALLS: readonly HostInstall[] = [
  {
    id: "skills-cli",
    label: "skills CLI",
    subtitle: "Codex · Cursor · others",
    installsAll: false,
    commands: (slug) => [`npx skills add ${skillsRepo} --skill ${slug}`],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    subtitle: "Plugin marketplace",
    installsAll: true,
    commands: () => [
      `/plugin marketplace add ${ownerDisplay}/${repoName}`,
      `/plugin install ${repoName}@${repoName}`,
    ],
  },
  {
    id: "hermes",
    label: "Hermes",
    subtitle: "Hermes Agent tap",
    installsAll: false,
    commands: (slug) => [`hermes skills install ${skillsRepo}/skills/${slug}`],
  },
];

export const DEFAULT_HOST_ID: HostId = "skills-cli";

export function isHostId(value: unknown): value is HostId {
  return HOST_INSTALLS.some((host) => host.id === value);
}
