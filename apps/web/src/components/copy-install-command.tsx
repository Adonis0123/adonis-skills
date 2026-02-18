'use client'

import { useState } from 'react'

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
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center rounded-xl border border-black/15 bg-black px-4 py-2 font-mono text-xs text-amber-100 transition hover:bg-black/85"
    >
      {copied ? '已复制' : '复制命令'}
    </button>
  )
}
