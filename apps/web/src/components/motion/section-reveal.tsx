'use client'

import { motion } from 'motion/react'
import { usePrefersReducedMotion } from './use-prefers-reduced-motion'

interface SectionRevealProps {
  children: React.ReactNode
  className?: string
  delay?: number
  offsetY?: number
}

export function SectionReveal({
  children,
  className,
  delay = 0,
  offsetY = 18,
}: SectionRevealProps) {
  const prefersReducedMotion = usePrefersReducedMotion()

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }

  const normalizedDelay = Math.max(0, delay) / 1000

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: offsetY, filter: 'blur(1.8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{
        type: 'spring',
        stiffness: 112,
        damping: 18,
        delay: normalizedDelay,
      }}
    >
      {children}
    </motion.div>
  )
}
