import { OG_SIZE, renderOgCard } from "@/lib/og-card";
import { getAllSkills, getSkillBySlug } from "@/lib/skills";
import { SUPPORTED_LOCALES } from "@/i18n/config";

export const alt = "Nika Skills skill card";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((lang) =>
    getAllSkills().map((skill) => ({ lang, slug: skill.slug })),
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const skill = getSkillBySlug(slug);
  return renderOgCard({
    title: skill?.name ?? "Nika Skills",
    description:
      skill?.catalog.summary ??
      "Teach your coding agent how to finish the job.",
  });
}
