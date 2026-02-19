import * as React from 'react'
import { ClaySurface } from './clay-surface'
import type { ClaySurfaceProps } from './clay-surface'
import { cx } from './utils'

export type ClayCardProps = ClaySurfaceProps

export const ClayCard = React.forwardRef<HTMLDivElement, ClayCardProps>(({ className, ...props }, ref) => (
  <ClaySurface ref={ref} className={cx('flex flex-col gap-4 p-5 md:p-6', className)} {...props} />
))
ClayCard.displayName = 'ClayCard'

export const ClayCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cx('flex flex-col gap-2', className)} {...props} />,
)
ClayCardHeader.displayName = 'ClayCardHeader'

export const ClayCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cx('font-heading text-2xl leading-tight text-foreground md:text-[1.75rem]', className)}
      {...props}
    />
  ),
)
ClayCardTitle.displayName = 'ClayCardTitle'

export const ClayCardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cx('text-sm leading-6 text-clay-muted md:text-[15px]', className)} {...props} />
))
ClayCardDescription.displayName = 'ClayCardDescription'

export const ClayCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cx('flex-1', className)} {...props} />,
)
ClayCardContent.displayName = 'ClayCardContent'

export const ClayCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cx('flex items-center gap-2', className)} {...props} />
  ),
)
ClayCardFooter.displayName = 'ClayCardFooter'
