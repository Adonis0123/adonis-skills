import { OG_SIZE, renderOgCard } from "@/lib/og-card";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { getAllPlugins, getPluginBySlug } from "@/lib/plugins";

export const alt = "Nika Skills plugin card";
export const size = OG_SIZE;
export const contentType = "image/png";
export const dynamicParams = false;

export function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((lang) =>
    getAllPlugins().map((plugin) => ({ lang, slug: plugin.name })),
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plugin = getPluginBySlug(slug);
  return renderOgCard({
    title: plugin?.name ?? "Nika Skills",
    description: plugin?.effect.en || "Hook plugins for Claude Code and Codex.",
  });
}
