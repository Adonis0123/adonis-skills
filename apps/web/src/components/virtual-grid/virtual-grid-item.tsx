'use client'

import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/components/motion/use-prefers-reduced-motion'

interface VirtualGridItemProps {
  children: ReactNode
  itemKey: string | number
  index: number
  columns: number
  alreadyAnimated: boolean
  onAnimated: (key: string | number) => void
}

const springConfig = {
  stiffness: 118,
  damping: 18,
}

export function VirtualGridItem({
  children,
  itemKey,
  index,
  columns,
  alreadyAnimated,
  onAnimated,
}: VirtualGridItemProps) {
  const prefersReducedMotion = usePrefersReducedMotion()

  if (prefersReducedMotion || alreadyAnimated) {
    return <div className="min-w-0">{children}</div>
  }

  return (
    <motion.div
      className="min-w-0"
      initial={{ opacity: 0, y: 20, scale: 0.975 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{
        type: 'spring',
        ...springConfig,
        delay: (index % columns) * 0.04,
      }}
      onAnimationComplete={() => onAnimated(itemKey)}
    >
      {children}
    </motion.div>
  )
}
