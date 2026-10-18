import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAllSkills, getSkillBySlug } from "@/lib/skills";

export const dynamic = "force-static";
export const dynamicParams = false;

// Serves /skills/<slug>.md. Paths without a dot never reach here: the proxy
// rewrites them to the localized /[lang]/skills/<slug> pages first.
export function generateStaticParams() {
  return getAllSkills().map((skill) => ({ file: `${skill.slug}.md` }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const slug = file.replace(/\.md$/, "");
  if (!file.endsWith(".md") || !getSkillBySlug(slug))
    return new Response("Not found", { status: 404 });

  // `next build` runs in apps/web; skills/ lives at the repository root.
  const markdown = await readFile(
    path.join(process.cwd(), "../../skills", slug, "SKILL.md"),
    "utf8",
  );
  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
