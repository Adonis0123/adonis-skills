'use client'

import { useState } from 'react'
import { useIsomorphicLayoutEffect } from 'ahooks'

const BREAKPOINTS = [
  { query: '(min-width: 1280px)', columns: 3 },
  { query: '(min-width: 768px)', columns: 2 },
] as const

function getColumns(): number {
  for (const { query, columns } of BREAKPOINTS) {
    if (window.matchMedia(query).matches) return columns
  }
  return 1
}

export function useResponsiveColumns() {
  const [columns, setColumns] = useState(1)

  useIsomorphicLayoutEffect(() => {
    const mediaQueries = BREAKPOINTS.map(({ query }) => window.matchMedia(query))

    const onChange = () => setColumns(getColumns())
    onChange()

    for (const mq of mediaQueries) {
      mq.addEventListener('change', onChange)
    }
    return () => {
      for (const mq of mediaQueries) {
        mq.removeEventListener('change', onChange)
      }
    }
  }, [])

  return columns
}
