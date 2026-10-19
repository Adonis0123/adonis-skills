import { HOST_INSTALLS } from "@/config/hosts";
import { absoluteUrl } from "@/lib/seo";
import { getAllSkills } from "@/lib/skills";

export const dynamic = "force-static";

// llmstxt.org format: an index that links each skill's raw SKILL.md.
export function GET() {
  const skills = getAllSkills();
  const lines = [
    "# Nika Skills",
    "",
    `> ${skills.length} battle-tested coding agent skills by Nika for delegating tasks, running independent code reviews, shipping clean Git history, and wiring up MCP tools in Claude Code, Codex, Cursor, and Hermes Agent. Each link is the raw SKILL.md.`,
    "",
    "## Install",
    "",
    ...HOST_INSTALLS.flatMap((host) => [
      `- ${host.label}:`,
      ...host.commands("<slug>").map((command) => `  - \`${command}\``),
    ]),
    "",
    "## Skills",
    "",
    ...skills.map(
      (skill) =>
        `- [${skill.name}](${absoluteUrl(`/skills/${skill.slug}.md`)}): ${skill.catalog.summary}`,
    ),
    "",
    "## Optional",
    "",
    `- [All skills](${absoluteUrl("/skills")}): searchable catalog, filterable by scenario and tag.`,
    `- [Skill index as JSON](${absoluteUrl("/api/skills.json")})`,
    `- [Website](${absoluteUrl("/")}): canonical pages; cite these rather than the .md links.`,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
