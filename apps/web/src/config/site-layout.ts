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
    tagline: '可安装、可复用的 Agent Skills 目录与实践仓库。',
    logoSrc: '/logo_medium_64x64.png',
    logoAlt: 'adonis-skills 品牌 Logo',
  },
  repo: skillsRepo,
  repoUrl,
  headerNav: [
    {
      label: 'GitHub',
      href: repoUrl,
      external: true,
      ariaLabel: '在 GitHub 打开 adonis-skills 仓库',
    },
  ],
  footerGroups: [
    {
      title: '快速访问',
      links: [
        {
          label: '技能目录',
          href: '/',
        },
        {
          label: '示例 Skill',
          href: exampleSkillHref,
        },
      ],
    },
    {
      title: '资源',
      links: [
        {
          label: 'GitHub 仓库',
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
