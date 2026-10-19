import { OG_SIZE, renderOgCard } from "@/lib/og-card";
import { SUPPORTED_LOCALES } from "@/i18n/config";

export const alt = "Nika Skills: teach your coding agent how to finish the job";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((lang) => ({ lang }));
}

export default async function Image() {
  return renderOgCard({
    title: "Teach your coding agent how to finish the job.",
    description:
      "Install battle-tested skills into Claude\u00A0Code, Codex, Cursor, or Hermes\u00A0Agent.",
  });
}
