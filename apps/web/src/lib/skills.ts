import skillsDetailData from '@/generated/skills-detail-index.json'
import skillsListData from '@/generated/skills-index-lite.json'

export interface SkillSection {
  heading?: string
  level?: number
  raw: string
}

export interface SkillListItem {
  slug: string
  name: string
  description: string
  metadata?: {
    author?: string
    version?: string
  }
  files: {
    hasReferences: boolean
    hasSrc: boolean
  }
  updatedAt?: string
  allowedTools?: string[]
}

export interface SkillDetailItem {
  slug: string
  sections?: SkillSection[]
}

const skills = skillsListData as SkillListItem[]
const skillDetails = skillsDetailData as SkillDetailItem[]

export const skillsRepo = process.env.NEXT_PUBLIC_SKILLS_REPO || 'adonis0123/adonis-skills'

function getUpdatedAtTime(skill: SkillListItem): number {
  if (!skill.updatedAt)
    return Number.NEGATIVE_INFINITY

  const time = Date.parse(skill.updatedAt)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

function compareSkillsByUpdatedAtDesc(a: SkillListItem, b: SkillListItem): number {
  const timeDiff = getUpdatedAtTime(b) - getUpdatedAtTime(a)
  if (timeDiff !== 0)
    return timeDiff

  return a.slug.localeCompare(b.slug)
}

export function getAllSkills(): SkillListItem[] {
  return [...skills].sort(compareSkillsByUpdatedAtDesc)
}

export function getSkillBySlug(slug: string): SkillListItem | null {
  return skills.find(skill => skill.slug === slug) || null
}

export function getSkillDetailBySlug(slug: string): SkillDetailItem | null {
  return skillDetails.find(skill => skill.slug === slug) || null
}

export function getSkillInstallCommand(slug: string): string {
  return `npx skills add ${skillsRepo} --skill ${slug}`
}

export function getSkillSourceUrl(slug: string): string {
  return `https://github.com/${skillsRepo}/tree/main/skills/${slug}`
}
