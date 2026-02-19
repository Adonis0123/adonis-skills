'use client'

import { Children, isValidElement } from 'react'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from './use-prefers-reduced-motion'

interface SkillsGridMotionProps {
  children: React.ReactNode
  className?: string
}

const springConfig = {
  stiffness: 118,
  damping: 18,
}

function getItemKey(item: React.ReactNode, index: number): React.Key {
  if (isValidElement(item) && item.key != null) {
    return item.key
  }

  // Fallback key is only used for static lists without explicit child keys.
  return `static-${index}`
}

export function SkillsGridMotion({
  children,
  className = 'grid gap-5 md:grid-cols-2 xl:grid-cols-3',
}: SkillsGridMotionProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const items = Children.toArray(children)

  if (items.length === 0) {
    return <div className={className} />
  }

  if (prefersReducedMotion) {
    return (
      <div className={className}>
        {items.map((item, index) => (
          <div key={getItemKey(item, index)}>{item}</div>
        ))}
      </div>
    )
  }

  return (
    <motion.div
      className={className}
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: 0.06,
          },
        },
      }}
      initial="hidden"
      animate="show"
    >
      {items.map((item, index) => (
        <motion.div
          key={getItemKey(item, index)}
          variants={{
            hidden: { opacity: 0, y: 20, scale: 0.975 },
            show: {
              opacity: 1,
              y: 0,
              scale: 1,
              transition: {
                type: 'spring',
                ...springConfig,
              },
            },
          }}
        >
          {item}
        </motion.div>
      ))}
    </motion.div>
  )
}
