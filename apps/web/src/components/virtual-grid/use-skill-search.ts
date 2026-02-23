'use client'

import { useMemo, useState } from 'react'
import { useDebounceFn } from 'ahooks'
import type { SkillIndexItem } from '@/lib/skills'

export function useSkillSearch(skills: SkillIndexItem[]) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  const { run: applyDebounce, cancel: cancelDebounce } = useDebounceFn(
    (value: string) => setDebouncedQuery(value),
    { wait: 150 },
  )

  const handleChange = (value: string) => {
    setQuery(value)
    if (!value.trim()) {
      cancelDebounce()
      setDebouncedQuery('')
      return
    }
    applyDebounce(value)
  }

  const filteredSkills = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      skill =>
        skill.name.toLowerCase().includes(q)
        || skill.slug.toLowerCase().includes(q)
        || skill.description.toLowerCase().includes(q),
    )
  }, [skills, debouncedQuery])

  const isFiltering = debouncedQuery.trim().length > 0

  return { query, setQuery: handleChange, filteredSkills, isFiltering }
}
