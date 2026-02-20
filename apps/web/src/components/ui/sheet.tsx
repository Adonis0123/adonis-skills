'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { cx } from './utils'

export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close
export const SheetPortal = SheetPrimitive.Portal
export const SheetTitle = SheetPrimitive.Title
export const SheetDescription = SheetPrimitive.Description

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cx('fixed inset-0 z-50 bg-black/28 backdrop-blur-[1.5px]', className)}
    {...props}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

type SheetSide = 'top' | 'right' | 'bottom' | 'left'

const sideClassMap: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 border-b',
  right: 'inset-y-0 right-0 h-full w-full max-w-[min(88vw,24rem)] border-l',
  bottom: 'inset-x-0 bottom-0 border-t',
  left: 'inset-y-0 left-0 h-full w-full max-w-[min(88vw,24rem)] border-r',
}

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  side?: SheetSide
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, ...props }, ref) => (
  <SheetPrimitive.Content
    ref={ref}
    className={cx(
      'fixed z-50 flex flex-col gap-4 border border-border bg-card text-card-foreground shadow-clay-floating outline-none',
      sideClassMap[side],
      className,
    )}
    {...props}
  />
))
SheetContent.displayName = SheetPrimitive.Content.displayName
