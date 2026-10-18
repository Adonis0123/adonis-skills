import { skillsRepo } from "@/lib/skills";

export interface SiteNavItem {
  id: "skills" | "scenarios" | "install" | "github";
  href: string;
  external?: boolean;
}

export interface FooterLinkItem {
  id:
    | "skill-library"
    | "scenarios"
    | "install"
    | "github-repository"
    | "readme";
  href: string;
  external?: boolean;
}

export interface FooterLinkGroup {
  id: "library" | "resources";
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

export const siteLayoutConfig: SiteLayoutConfig = {
  brand: {
    name: "Nika Skills",
    logoSrc: "/brand/kiki-plate.svg",
  },
  ownerDisplay: "Adonis0123",
  repo: skillsRepo,
  repoUrl,
  headerNav: [
    { id: "skills", href: "/skills" },
    { id: "scenarios", href: "/#scenarios" },
    { id: "install", href: "/#install" },
    {
      id: "github",
      href: repoUrl,
      external: true,
    },
  ],
  footerGroups: [
    {
      id: "library",
      links: [
        { id: "skill-library", href: "/#skills" },
        { id: "scenarios", href: "/#scenarios" },
        { id: "install", href: "/#install" },
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
