'use client'

import { useState } from 'react'
import { ClayButton } from '@/components/ui'

interface CopyInstallCommandButtonProps {
  command: string
}

export function CopyInstallCommandButton({ command }: CopyInstallCommandButtonProps) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
    catch {
      setCopied(false)
    }
  }

  return (
    <ClayButton
      type="button"
      variant={copied ? 'secondary' : 'primary'}
      size="sm"
      onClick={onCopy}
      className="font-mono"
      aria-live="polite"
    >
      <span className={copied ? 'icon-[lucide--check] size-3.5' : 'icon-[lucide--copy] size-3.5'} aria-hidden />
      {copied ? 'Copied' : 'Copy Command'}
    </ClayButton>
  )
}
