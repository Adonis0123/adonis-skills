import { skillsRepo } from "@/lib/skills";

export interface SiteNavItem {
  id: "github";
  href: string;
  external?: boolean;
}

export interface FooterLinkItem {
  id: "skill-library" | "example-skill" | "github-repository" | "readme";
  href: string;
  external?: boolean;
}

export interface FooterLinkGroup {
  id: "quick-links" | "resources";
  links: FooterLinkItem[];
}

export interface SiteBrand {
  name: string;
  logoSrc: string;
}

export interface SiteLayoutConfig {
  brand: SiteBrand;
  // GitHub account as the brand writes it; only shown next to repository links.
  ownerDisplay: string;
  repo: string;
  repoUrl: string;
  headerNav: SiteNavItem[];
  footerGroups: FooterLinkGroup[];
}

const repoUrl = `https://github.com/${skillsRepo}`;

// Canonical origin for metadata, sitemap, OG images, and llms.txt links.
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://adonis-skills.vercel.app"
).replace(/\/$/, "");
export const exampleSkillHref = "/skills/weekly-report";

export const siteLayoutConfig: SiteLayoutConfig = {
  brand: {
    name: "Nika Skills",
    logoSrc: "/brand/kiki-plate.svg",
  },
  ownerDisplay: "Adonis0123",
  repo: skillsRepo,
  repoUrl,
  headerNav: [
    {
      id: "github",
      href: repoUrl,
      external: true,
    },
  ],
  footerGroups: [
    {
      id: "quick-links",
      links: [
        {
          id: "skill-library",
          href: "/",
        },
        {
          id: "example-skill",
          href: exampleSkillHref,
        },
      ],
    },
    {
      id: "resources",
      links: [
        {
          id: "github-repository",
          href: repoUrl,
          external: true,
        },
        {
          id: "readme",
          href: `${repoUrl}#readme`,
          external: true,
        },
      ],
    },
  ],
};
