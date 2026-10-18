import { OG_SIZE, renderOgCard } from "@/lib/og-card";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { getAllSkills } from "@/lib/skills";

export const alt = "Nika Skills: every skill, searchable by scenario and tag";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((lang) => ({ lang }));
}

export default async function Image() {
  return renderOgCard({
    title: `All ${getAllSkills().length} skills`,
    description:
      "Search by scenario and tag, then install into Claude Code, Codex, Cursor, or Hermes Agent.",
  });
}
