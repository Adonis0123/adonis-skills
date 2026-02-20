import { skillsRepo } from '@/lib/skills'

export interface SiteNavItem {
  id: 'github'
  href: string
  external?: boolean
}

export interface FooterLinkItem {
  id: 'skill-library' | 'example-skill' | 'github-repository' | 'readme'
  href: string
  external?: boolean
}

export interface FooterLinkGroup {
  id: 'quick-links' | 'resources'
  links: FooterLinkItem[]
}

export interface SiteBrand {
  name: string
  logoSrc: string
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
    logoSrc: '/logo_medium_64x64.png',
  },
  repo: skillsRepo,
  repoUrl,
  headerNav: [
    {
      id: 'github',
      href: repoUrl,
      external: true,
    },
  ],
  footerGroups: [
    {
      id: 'quick-links',
      links: [
        {
          id: 'skill-library',
          href: '/',
        },
        {
          id: 'example-skill',
          href: exampleSkillHref,
        },
      ],
    },
    {
      id: 'resources',
      links: [
        {
          id: 'github-repository',
          href: repoUrl,
          external: true,
        },
        {
          id: 'readme',
          href: `${repoUrl}#readme`,
          external: true,
        },
      ],
    },
  ],
}
