import type { AppLocale } from "@/i18n/config";
import { withLocalePath } from "@/i18n/href";

// Same branch as getSkillSourceUrl in lib/skills.ts: the site documents what is on main.
const SOURCE_BRANCH = "main";

const schemePattern = /^[a-z][a-z\d+\-.]*:/i;

export interface SkillLinkContext {
  /** GitHub `owner/name` that hosts the skills (`skillsRepo`). */
  repo: string;
  /** Skill whose SKILL.md is rendered; relative paths resolve inside `skills/<slug>/`. */
  slug?: string;
  locale: AppLocale;
  /** Whether a skill has its own page on this site. */
  isPublicSkill: (slug: string) => boolean;
  /** Images need the raw file, not GitHub's HTML viewer. */
  asset?: boolean;
}

export interface ResolvedSkillHref {
  href: string;
  external: boolean;
}

/** True for hrefs that leave the site: http(s) and protocol-relative URLs. */
export function isExternalHref(href: string): boolean {
  return /^(?:https?:)?\/\//i.test(href);
}

/** Normalizes `.` and `..` segments; returns null when the path climbs above the repo root. */
function normalizeRepoPath(path: string): string[] | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out;
}

/**
 * The other skill a relative SKILL.md link points at (`../<slug>/...`), if any.
 * The answer does not depend on which skill page renders the link, so the server can
 * look it up once instead of shipping the whole skill list to the browser.
 */
export function linkedSkillSlug(href: string | undefined): string | undefined {
  if (!href || href.startsWith("#") || href.startsWith("/")) return undefined;
  if (schemePattern.test(href) || isExternalHref(href)) return undefined;
  const pathPart = href.split("#", 1)[0].split("?", 1)[0];
  const current = "\0current";
  const segments = normalizeRepoPath(`skills/${current}/${pathPart}`);
  if (!segments || segments[0] !== "skills" || !segments[1]) return undefined;
  return segments[1] === current ? undefined : segments[1];
}

/**
 * Where a crawler or a visitor should land when a SKILL.md link is clicked on the site.
 * SKILL.md links are written relative to the skill folder in the repo, so on the site
 * they would resolve against the page URL and 404. Relative paths go to the file on
 * GitHub, links to another public skill go to that skill's page, site paths get the
 * current locale, and fragments, external URLs, and other schemes stay as written.
 */
export function resolveSkillMarkdownHref(
  href: string | undefined,
  context: SkillLinkContext,
): ResolvedSkillHref {
  if (!href || href.startsWith("#")) {
    return { href: href ?? "", external: false };
  }
  if (isExternalHref(href)) return { href, external: true };
  if (schemePattern.test(href)) return { href, external: false };
  if (href.startsWith("/")) {
    return { href: withLocalePath(href, context.locale), external: false };
  }
  if (!context.slug) return { href, external: false };

  const hashIndex = href.indexOf("#");
  const beforeHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  const pathPart =
    queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex);

  const segments = normalizeRepoPath(`skills/${context.slug}/${pathPart}`);
  if (!segments) return { href, external: false };

  // `../other-skill`, `../other-skill/` or `../other-skill/SKILL.md` → that skill's page.
  const [root, skillSlug, ...rest] = segments;
  const pointsAtSkill =
    root === "skills" &&
    skillSlug !== undefined &&
    (rest.length === 0 || (rest.length === 1 && rest[0] === "SKILL.md"));
  if (
    !context.asset &&
    pointsAtSkill &&
    (skillSlug === context.slug || context.isPublicSkill(skillSlug))
  ) {
    const page = withLocalePath(`/skills/${skillSlug}`, context.locale);
    return { href: `${page}${hash}`, external: false };
  }

  const repoPath = segments.join("/");
  if (context.asset) {
    return {
      href: `https://raw.githubusercontent.com/${context.repo}/${SOURCE_BRANCH}/${repoPath}${query}`,
      external: true,
    };
  }
  const lastSegment = segments[segments.length - 1] ?? "";
  const isDirectory =
    pathPart.endsWith("/") ||
    segments.length === 0 ||
    !lastSegment.includes(".");
  const view = isDirectory ? "tree" : "blob";
  const suffix = repoPath ? `/${repoPath}` : "";
  return {
    href: `https://github.com/${context.repo}/${view}/${SOURCE_BRANCH}${suffix}${query}${hash}`,
    external: true,
  };
}
