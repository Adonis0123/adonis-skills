import type { MetadataRoute } from "next";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { withLocalePath } from "@/i18n/href";
import { absoluteUrl } from "@/lib/seo";
import { getAllSkills } from "@/lib/skills";

function entry(path: string, lastModified?: string): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    SUPPORTED_LOCALES.map((lang) => [
      lang,
      absoluteUrl(withLocalePath(path, lang)),
    ]),
  );
  return SUPPORTED_LOCALES.map((lang) => ({
    url: absoluteUrl(withLocalePath(path, lang)),
    ...(lastModified ? { lastModified } : {}),
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...entry("/"),
    ...entry("/skills"),
    ...getAllSkills().flatMap((skill) =>
      entry(`/skills/${skill.slug}`, skill.updatedAt),
    ),
  ];
}
