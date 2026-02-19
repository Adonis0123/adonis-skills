import * as React from 'react'
import { cx } from './utils'

export type ClayButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline'
export type ClayButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const variantClassMap: Record<ClayButtonVariant, string> = {
  primary: 'clay-button--primary',
  secondary: 'clay-button--secondary',
  ghost: 'clay-button--ghost',
  outline: 'clay-button--outline',
}

const sizeClassMap: Record<ClayButtonSize, string> = {
  sm: 'clay-button--sm',
  md: 'clay-button--md',
  lg: 'clay-button--lg',
  icon: 'clay-button--icon',
}

export interface ClayButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  variant?: ClayButtonVariant
  size?: ClayButtonSize
}

export const ClayButton = React.forwardRef<HTMLButtonElement, ClayButtonProps>(
  (
    {
      asChild = false,
      variant = 'primary',
      size = 'md',
      className,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const classes = cx(
      'clay-button',
      'clay-focus-ring',
      variantClassMap[variant],
      sizeClassMap[size],
      className,
    )

    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<{
        className?: string
        ref?: React.Ref<unknown>
      }>
      // Forwarding refs through cloneElement is intentional for asChild composition.
      // eslint-disable-next-line react-hooks/refs
      return React.cloneElement(child, {
        className: cx(classes, child.props.className),
        ref: ref as React.Ref<unknown>,
      })
    }

    return (
      <button ref={ref} className={classes} {...buttonProps}>
        {children}
      </button>
    )
  },
)

ClayButton.displayName = 'ClayButton'
