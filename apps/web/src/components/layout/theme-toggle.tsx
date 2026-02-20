'use client'

import { useEffect, useState } from 'react'
import { useLocalStorageState } from 'ahooks'
import { ClayButton } from '@/components/ui'

type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'adonis-skills-theme'

function resolveSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function parseStoredTheme(value: string): ThemeMode {
  if (value === 'dark' || value === 'light') {
    return value
  }

  try {
    const parsed = JSON.parse(value)
    if (parsed === 'dark' || parsed === 'light') {
      return parsed
    }
  } catch {
    // Ignore invalid JSON and fallback to system preference.
  }

  return resolveSystemTheme()
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement

  root.dataset.theme = theme
  root.style.colorScheme = theme
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useLocalStorageState<ThemeMode>(STORAGE_KEY, {
    defaultValue: resolveSystemTheme,
    serializer: value => value,
    deserializer: parseStoredTheme,
  })

  useEffect(() => {
    // We intentionally flip mounted after hydration to avoid SSR/client icon-label mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) {
      return
    }

    applyTheme(theme)
  }, [mounted, theme])

  if (!mounted) {
    return <div className="h-8 w-[88px]" aria-hidden />
  }

  const handleToggle = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark'
  const label = theme === 'dark' ? 'Dark' : 'Light'
  const nextLabel = nextTheme === 'dark' ? 'Dark' : 'Light'

  return (
    <ClayButton
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      aria-label={`Switch to ${nextLabel} theme`}
      title={`Current: ${label} theme`}
      className="rounded-full px-3.5 text-xs md:text-sm"
    >
      <span
        className={theme === 'dark' ? 'icon-[lucide--moon-star] size-4' : 'icon-[lucide--sun-medium] size-4'}
        aria-hidden
      />
      <span>{label}</span>
    </ClayButton>
  )
}
