import { HOST_INSTALLS } from "@/config/hosts";
import { absoluteUrl } from "@/lib/seo";
import { getAllSkills } from "@/lib/skills";

export const dynamic = "force-static";

export function GET() {
  const skills = getAllSkills().map((skill) => ({
    slug: skill.slug,
    name: skill.name,
    displayName: skill.catalog.displayName,
    group: skill.catalog.group,
    summary: skill.catalog.summary,
    summaryZh: skill.catalog.summary_zh,
    tags: skill.catalog.tags,
    updatedAt: skill.updatedAt ?? null,
    url: absoluteUrl(`/skills/${skill.slug}`),
    markdownUrl: absoluteUrl(`/skills/${skill.slug}.md`),
    install: Object.fromEntries(
      HOST_INSTALLS.map((host) => [host.id, host.commands(skill.slug)]),
    ),
  }));
  return Response.json({ name: "Nika Skills", count: skills.length, skills });
}
