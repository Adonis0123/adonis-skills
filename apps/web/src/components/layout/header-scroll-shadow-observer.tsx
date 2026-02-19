'use client'

import { useEffect } from 'react'

const SCROLL_THRESHOLD = 4

function setHeaderScrolledState(scrolled: boolean) {
  const root = document.documentElement
  const next = scrolled ? 'true' : 'false'

  if (root.dataset.headerScrolled !== next) {
    root.dataset.headerScrolled = next
  }
}

export function HeaderScrollShadowObserver() {
  useEffect(() => {
    const updateScrollState = () => {
      setHeaderScrolledState(window.scrollY > SCROLL_THRESHOLD)
    }

    updateScrollState()
    window.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)

    return () => {
      window.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [])

  return null
}
