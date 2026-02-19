import * as React from 'react'
import { cx } from './utils'

export type ClaySurfaceTone = 'base' | 'peach' | 'blue' | 'cream' | 'muted'
export type ClaySurfaceElevation = 'raised' | 'inset' | 'floating'

const toneClassMap: Record<ClaySurfaceTone, string> = {
  base: 'clay-tone-base',
  peach: 'clay-tone-peach',
  blue: 'clay-tone-blue',
  cream: 'clay-tone-cream',
  muted: 'clay-tone-muted',
}

const elevationClassMap: Record<ClaySurfaceElevation, string> = {
  raised: 'clay-elevation-raised',
  inset: 'clay-elevation-inset',
  floating: 'clay-elevation-floating',
}

export interface ClaySurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: ClaySurfaceTone
  elevation?: ClaySurfaceElevation
  interactive?: boolean
}

export const ClaySurface = React.forwardRef<HTMLDivElement, ClaySurfaceProps>(
  (
    {
      className,
      tone = 'base',
      elevation = 'raised',
      interactive = false,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cx(
        'clay-surface',
        toneClassMap[tone],
        elevationClassMap[elevation],
        interactive && 'clay-hover-lift',
        className,
      )}
      {...props}
    />
  ),
)

ClaySurface.displayName = 'ClaySurface'
