import { OG_SIZE, renderOgCard } from "@/lib/og-card";
import { SUPPORTED_LOCALES } from "@/i18n/config";

export const alt = "Nika Skills: hook plugins for Claude Code and Codex";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((lang) => ({ lang }));
}

export default async function Image() {
  return renderOgCard({
    title: "Plugins",
    description:
      "Hook plugins for Claude Code and Codex. Tick the ones you want, copy one command.",
  });
}
