'use client'

import { useTransition } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui'
import { cx } from '@/components/ui/utils'
import { type AppLocale, SUPPORTED_LOCALES, resolveLocaleValue } from '@/i18n/config'
import { replaceLocalePath } from '@/i18n/href'

interface LocaleSwitcherProps {
  ariaLabel: string
  title: string
  className?: string
  triggerClassName?: string
  contentClassName?: string
  contentAlign?: 'start' | 'center' | 'end'
}

const localeLabelMap: Partial<Record<AppLocale, string>> = {
  en: 'English',
  zh: '简体中文',
}

function getLocaleLabel(locale: AppLocale): string {
  return localeLabelMap[locale] ?? locale.toUpperCase()
}

export function LocaleSwitcher({
  ariaLabel,
  title,
  className,
  triggerClassName,
  contentClassName,
  contentAlign = 'end',
}: LocaleSwitcherProps) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const currentLocale = resolveLocaleValue(params?.lang as string | string[] | undefined)

  const onValueChange = (nextLocaleValue: string) => {
    const nextLocale = resolveLocaleValue(nextLocaleValue)
    if (nextLocale === currentLocale) {
      return
    }

    const basePath = replaceLocalePath(pathname || '/', nextLocale)
    const queryString = typeof window === 'undefined' ? '' : window.location.search.slice(1)
    const hash = typeof window === 'undefined' ? '' : window.location.hash
    const targetHref = `${basePath}${queryString ? `?${queryString}` : ''}${hash}`

    startTransition(() => {
      router.replace(targetHref)
    })
  }

  return (
    <div className={cx('relative inline-flex items-center', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={isPending}>
          <button
            type="button"
            aria-label={ariaLabel}
            title={title}
            className={cx(
              'clay-focus-ring clay-button clay-button--secondary clay-button--sm group min-w-[132px] justify-between gap-2 rounded-full bg-transparent px-3 text-left text-xs md:text-sm',
              'disabled:cursor-not-allowed disabled:opacity-70',
              triggerClassName,
            )}
          >
            <span
              className={cx(
                'pointer-events-none icon-[lucide--globe] size-3.5 shrink-0 text-current opacity-70 transition-[opacity,color] duration-200',
                'group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{getLocaleLabel(currentLocale)}</span>
            <span
              className={cx(
                'pointer-events-none icon-[lucide--chevron-down] size-3.5 shrink-0 text-clay-muted transition-all duration-200',
                'group-hover:text-foreground group-focus-visible:text-foreground',
                'group-data-[state=open]:rotate-180 group-data-[state=open]:text-foreground',
              )}
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={contentAlign}
          className={cx(
            'w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 border-border/80 bg-popover/95 p-1.5 backdrop-blur-sm',
            contentClassName,
          )}
        >
          <DropdownMenuLabel className="font-mono text-[11px] uppercase tracking-[0.16em] text-clay-muted">
            {title}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={currentLocale} onValueChange={onValueChange}>
            {SUPPORTED_LOCALES.map(locale => (
              <DropdownMenuRadioItem key={locale} value={locale} disabled={isPending}>
                {getLocaleLabel(locale)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
