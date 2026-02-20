'use client'

import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useTheme } from 'next-themes'
import { ClayButton } from '@/components/ui'
import { cx } from '@/components/ui/utils'

type ThemeMode = 'light' | 'dark'

interface ThemeToggleProps {
  buttonClassName?: string
}

export function ThemeToggle({ buttonClassName }: ThemeToggleProps) {
  const { t, i18n } = useLingui()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // We intentionally flip mounted after hydration to avoid SSR/client icon-label mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-8 w-[88px]" aria-hidden />
  }

  const theme: ThemeMode = resolvedTheme === 'dark' ? 'dark' : 'light'
  const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark'
  const modeLabel: Record<ThemeMode, string> = {
    dark: t({ id: 'themeToggle.mode.dark', message: 'Dark' }),
    light: t({ id: 'themeToggle.mode.light', message: 'Light' }),
  }
  const label = modeLabel[theme]
  const nextLabel = modeLabel[nextTheme]

  return (
    <ClayButton
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setTheme(nextTheme)}
      aria-label={i18n._('themeToggle.switchTo', { nextLabel })}
      title={i18n._('themeToggle.current', { label })}
      className={cx('rounded-full px-3.5 text-xs md:text-sm', buttonClassName)}
    >
      <span
        className={theme === 'dark' ? 'icon-[lucide--moon-star] size-4' : 'icon-[lucide--sun-medium] size-4'}
        aria-hidden
      />
      <span>{label}</span>
    </ClayButton>
  )
}
