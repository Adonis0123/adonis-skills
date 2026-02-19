import * as React from 'react'
import { cx } from './utils'

export type ClayBadgeTone = 'neutral' | 'peach' | 'blue' | 'cream' | 'success'

const toneClassMap: Record<ClayBadgeTone, string> = {
  neutral: 'clay-badge--neutral',
  peach: 'clay-badge--peach',
  blue: 'clay-badge--blue',
  cream: 'clay-badge--cream',
  success: 'clay-badge--success',
}

export interface ClayBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: ClayBadgeTone
  withDot?: boolean
}

export const ClayBadge = React.forwardRef<HTMLSpanElement, ClayBadgeProps>(
  ({ className, tone = 'neutral', withDot = false, children, ...props }, ref) => (
    <span ref={ref} className={cx('clay-badge', toneClassMap[tone], className)} {...props}>
      {withDot && <span className="size-1.5 rounded-full bg-current/70" aria-hidden />}
      {children}
    </span>
  ),
)

ClayBadge.displayName = 'ClayBadge'
