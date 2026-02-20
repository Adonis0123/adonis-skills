import { skillsRepo } from '@/lib/skills'

export interface SiteNavItem {
  label: string
  href: string
  external?: boolean
  ariaLabel?: string
}

export interface FooterLinkItem {
  label: string
  href: string
  external?: boolean
}

export interface FooterLinkGroup {
  title: string
  links: FooterLinkItem[]
}

export interface SiteBrand {
  name: string
  tagline: string
  logoSrc: string
  logoAlt: string
}

export interface SiteLayoutConfig {
  brand: SiteBrand
  repo: string
  repoUrl: string
  headerNav: SiteNavItem[]
  footerGroups: FooterLinkGroup[]
}

const repoUrl = `https://github.com/${skillsRepo}`
export const exampleSkillHref = '/skills/weekly-report'

export const siteLayoutConfig: SiteLayoutConfig = {
  brand: {
    name: 'adonis-skills',
    tagline: 'Discover practical agent skills and install them in seconds.',
    logoSrc: '/logo_medium_64x64.png',
    logoAlt: 'adonis-skills logo',
  },
  repo: skillsRepo,
  repoUrl,
  headerNav: [
    {
      label: 'GitHub',
      href: repoUrl,
      external: true,
      ariaLabel: 'Open the adonis-skills repository on GitHub',
    },
  ],
  footerGroups: [
    {
      title: 'Quick Links',
      links: [
        {
          label: 'Skill Library',
          href: '/',
        },
        {
          label: 'Example Skill',
          href: exampleSkillHref,
        },
      ],
    },
    {
      title: 'Resources',
      links: [
        {
          label: 'GitHub Repository',
          href: repoUrl,
          external: true,
        },
        {
          label: 'README',
          href: `${repoUrl}#readme`,
          external: true,
        },
      ],
    },
  ],
}
