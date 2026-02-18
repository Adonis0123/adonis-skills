import skillsData from '@/generated/skills-index.json'

export interface SkillIndexItem {
  slug: string
  name: string
  description: string
  metadata?: {
    author?: string
    version?: string
  }
  installCommand: string
  files: {
    hasReferences: boolean
    hasSrc: boolean
  }
}

const skills = skillsData as SkillIndexItem[]

export const skillsRepo = process.env.NEXT_PUBLIC_SKILLS_REPO || 'adonis0123/adonis-skills'

export function getAllSkills(): SkillIndexItem[] {
  return [...skills].sort((a, b) => a.slug.localeCompare(b.slug))
}

export function getSkillBySlug(slug: string): SkillIndexItem | null {
  return skills.find(skill => skill.slug === slug) || null
}

export function getSkillSourceUrl(slug: string): string {
  return `https://github.com/${skillsRepo}/tree/main/skills/${slug}`
}
