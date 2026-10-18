import type { Metadata } from "next";
import { SkillsBrowser } from "@/components/skills-browser";
import { siteLayoutConfig } from "@/config/site-layout";
import { initLingui, initPageLingui } from "@/i18n/initLingui";
import { localeAlternates } from "@/lib/seo";
import { getAllSkills, getCatalogLayout } from "@/lib/skills";

interface SkillsPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({
  params,
}: SkillsPageProps): Promise<Metadata> {
  const locale = await initPageLingui(params);
  const i18n = initLingui(locale);
  const title = i18n._({ id: "skills.meta.title", message: "All skills" });
  const description = i18n._({
    id: "skills.meta.description",
    message:
      "Search and filter every Nika skill by scenario and tag, then install it into Claude Code, Codex, Cursor, or Hermes Agent.",
  });
  return {
    title,
    description,
    alternates: localeAlternates("/skills", locale),
    openGraph: { type: "website", title, description },
  };
}

export default async function SkillsPage({ params }: SkillsPageProps) {
  await initPageLingui(params);

  return (
    <main
      id="main-content"
      className="site-page-shell site-frame site-frame--main w-full"
    >
      <SkillsBrowser
        skills={getAllSkills()}
        layout={getCatalogLayout()}
        requestSkillUrl={`${siteLayoutConfig.repoUrl}/issues/new`}
      />
    </main>
  );
}
