import { OG_SIZE, renderOgCard } from "@/lib/og-card";
import { SUPPORTED_LOCALES } from "@/i18n/config";

export const alt = "Nika Skills: small agent skills I built and use every day";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((lang) => ({ lang }));
}

export default async function Image() {
  return renderOgCard({
    title: "Small agent skills I built and use every day.",
    description:
      "Install them into Claude\u00A0Code, Codex, Cursor, or Hermes\u00A0Agent.",
  });
}
