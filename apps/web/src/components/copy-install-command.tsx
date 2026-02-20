'use client'

import { type MouseEvent, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ClayButton } from '@/components/ui'
import { cx } from '@/components/ui/utils'

interface CopyInstallCommandButtonProps {
  command: string
  compact?: boolean
  preventLinkNavigation?: boolean
  className?: string
}

export function CopyInstallCommandButton({
  command,
  compact = false,
  preventLinkNavigation = false,
  className,
}: CopyInstallCommandButtonProps) {
  const { t } = useLingui()
  const [copied, setCopied] = useState(false)

  const onCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    if (preventLinkNavigation) {
      event.preventDefault()
      event.stopPropagation()
    }

    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
    catch {
      setCopied(false)
    }
  }

  const compactIconClass = copied
    ? 'icon-[lucide--check] size-3.5 text-emerald-600 transition-transform duration-200 ease-out scale-105 dark:text-emerald-300'
    : 'icon-[lucide--copy] size-3.5 transition-colors duration-200 ease-out'

  if (compact) {
    return (
      <ClayButton
        type="button"
        variant="ghost"
        size="icon"
        onClick={onCopy}
        className={cx(
          'h-8 w-8 min-h-8 rounded-lg border border-border/70 bg-background/55 p-0 text-clay-muted shadow-none transition-all duration-250 ease-out hover:bg-background/90 hover:text-foreground active:translate-y-0',
          copied
            && 'border-emerald-400/70 bg-emerald-400/15 text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_0_0_3px_rgba(52,211,153,0.22)] dark:border-emerald-500/55 dark:bg-emerald-500/18 dark:text-emerald-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_3px_rgba(16,185,129,0.22)]',
          className,
        )}
        aria-live="polite"
        aria-label={copied
          ? t({ id: 'copyCommand.aria.copied', message: 'Copied command' })
          : t({ id: 'copyCommand.aria.copy', message: 'Copy command' })}
        title={copied
          ? t({ id: 'copyCommand.title.copied', message: 'Copied' })
          : t({ id: 'copyCommand.title.copy', message: 'Copy command' })}
      >
        <span className={compactIconClass} aria-hidden />
      </ClayButton>
    )
  }

  return (
    <ClayButton
      type="button"
      variant={copied ? 'secondary' : 'primary'}
      size="sm"
      onClick={onCopy}
      className={cx('font-mono', className)}
      aria-live="polite"
    >
      <span className={copied ? 'icon-[lucide--check] size-3.5' : 'icon-[lucide--copy] size-3.5'} aria-hidden />
      {copied
        ? t({ id: 'copyCommand.button.copied', message: 'Copied' })
        : t({ id: 'copyCommand.button.copy', message: 'Copy Command' })}
    </ClayButton>
  )
}
