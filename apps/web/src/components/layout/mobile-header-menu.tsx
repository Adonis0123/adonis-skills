'use client'

import Link from 'next/link'
import { useState } from 'react'
import { motion } from 'motion/react'
import { Trans, useLingui } from '@lingui/react/macro'
import { type SiteNavItem, siteLayoutConfig } from '@/config/site-layout'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { usePrefersReducedMotion } from '@/components/motion/use-prefers-reduced-motion'
import {
  ClayButton,
  Sheet,
  SheetClose,
  SheetContent,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui'
import { cx } from '@/components/ui/utils'
import { LocaleLink } from '@/i18n/locale-link'

function getLinkProps(external?: boolean) {
  if (!external) {
    return {}
  }

  return {
    target: '_blank',
    rel: 'noreferrer',
  }
}

function getNavItemLabel(item: SiteNavItem) {
  switch (item.id) {
    case 'github':
      return <Trans id="siteHeader.nav.github.label">GitHub</Trans>
    default:
      return item.id
  }
}

function getNavItemAria(item: SiteNavItem, t: ReturnType<typeof useLingui>['t']) {
  switch (item.id) {
    case 'github':
      return t({
        id: 'siteHeader.nav.github.aria',
        message: 'Open the adonis-skills repository on GitHub',
      })
    default:
      return t`Open navigation item: ${item.id}`
  }
}

export function MobileHeaderMenu() {
  const { headerNav } = siteLayoutConfig
  const { t } = useLingui()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [open, setOpen] = useState(false)
  const softEase = [0.22, 1, 0.36, 1] as const
  const reduceEase = [0.3, 0, 1, 1] as const

  const overlayTransition = prefersReducedMotion
    ? { duration: 0.08, ease: reduceEase }
    : { duration: 0.18, ease: softEase }

  const panelTransition = prefersReducedMotion
    ? { duration: 0.12, ease: reduceEase }
    : { duration: 0.24, ease: softEase }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <ClayButton
          type="button"
          variant="secondary"
          size="icon"
          aria-label={open
            ? t({
              id: 'siteHeader.menu.close',
              message: 'Close menu',
            })
            : t({
              id: 'siteHeader.menu.open',
              message: 'Open menu',
            })}
          className="site-header-mobile-trigger"
        >
          <span className={open ? 'icon-[lucide--x] size-4' : 'icon-[lucide--menu] size-4'} aria-hidden />
          <span className="sr-only">
            {open
              ? t({
                id: 'siteHeader.menu.close',
                message: 'Close menu',
              })
              : t({
                id: 'siteHeader.menu.open',
                message: 'Open menu',
              })}
          </span>
        </ClayButton>
      </SheetTrigger>

      {open ? (
        <SheetPortal>
          <SheetOverlay asChild>
            <motion.div
              className="mobile-sheet-overlay"
              aria-hidden={false}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={overlayTransition}
            />
          </SheetOverlay>

          <SheetContent asChild side="right" className="mobile-sheet-panel">
            <motion.aside
              className="mobile-sheet-panel-shell transform-gpu will-change-transform"
              initial={{ x: '100%' }}
              animate={{ x: '0%' }}
              transition={panelTransition}
            >
              <div className="mobile-sheet-surface">
                <div className="mobile-sheet-header">
                  <SheetTitle className="font-mono text-[11px] uppercase tracking-[0.16em] text-clay-muted">
                    <Trans id="siteHeader.menu.aria">Site menu</Trans>
                  </SheetTitle>

                  <SheetClose asChild>
                    <ClayButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t({
                        id: 'siteHeader.menu.close',
                        message: 'Close menu',
                      })}
                      className="mobile-sheet-close-button"
                    >
                      <span className="icon-[lucide--x] size-4" aria-hidden />
                    </ClayButton>
                  </SheetClose>
                </div>

                <nav
                  aria-label={t({
                    id: 'siteHeader.nav.aria',
                    message: 'Main navigation',
                  })}
                  className="mobile-sheet-nav"
                >
                  <motion.div
                    className="mobile-sheet-actions"
                    initial={{ opacity: prefersReducedMotion ? 1 : 0, y: prefersReducedMotion ? 0 : 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: prefersReducedMotion ? 0.01 : 0.2,
                      ease: softEase,
                    }}
                  >
                    {headerNav.map(item => {
                      const label = getNavItemLabel(item)
                      const navAria = getNavItemAria(item, t)
                      const actionClassName = cx(
                        'clay-focus-ring clay-button clay-button--secondary clay-button--sm mobile-sheet-action',
                        item.external && 'pr-3',
                      )

                      if (item.external) {
                        return (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: prefersReducedMotion ? 1 : 0.95, y: prefersReducedMotion ? 0 : 2 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: prefersReducedMotion ? 0.01 : 0.16, ease: softEase }}
                          >
                            <SheetClose asChild>
                              <Link
                                href={item.href}
                                aria-label={navAria}
                                className={actionClassName}
                                {...getLinkProps(item.external)}
                              >
                                <span>{label}</span>
                                <span className="icon-[lucide--external-link] size-3.5" aria-hidden />
                              </Link>
                            </SheetClose>
                          </motion.div>
                        )
                      }

                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: prefersReducedMotion ? 1 : 0.95, y: prefersReducedMotion ? 0 : 2 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: prefersReducedMotion ? 0.01 : 0.16, ease: softEase }}
                        >
                          <SheetClose asChild>
                            <LocaleLink
                              href={item.href}
                              aria-label={navAria}
                              className={actionClassName}
                            >
                              <span>{label}</span>
                            </LocaleLink>
                          </SheetClose>
                        </motion.div>
                      )
                    })}

                    <motion.div
                      initial={{ opacity: prefersReducedMotion ? 1 : 0.95, y: prefersReducedMotion ? 0 : 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: prefersReducedMotion ? 0.01 : 0.16, ease: softEase }}
                    >
                      <LocaleSwitcher
                        ariaLabel={t({
                          id: 'siteHeader.locale.aria',
                          message: 'Switch site language',
                        })}
                        title={t({
                          id: 'siteHeader.locale.title',
                          message: 'Language',
                        })}
                        className="mobile-sheet-locale"
                        triggerClassName="mobile-sheet-action"
                        contentAlign="start"
                      />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: prefersReducedMotion ? 1 : 0.95, y: prefersReducedMotion ? 0 : 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: prefersReducedMotion ? 0.01 : 0.16, ease: softEase }}
                      className="mobile-sheet-theme"
                    >
                      <ThemeToggle buttonClassName="mobile-sheet-action rounded-2xl text-sm" />
                    </motion.div>
                  </motion.div>
                </nav>
              </div>
            </motion.aside>
          </SheetContent>
        </SheetPortal>
      ) : null}
    </Sheet>
  )
}
