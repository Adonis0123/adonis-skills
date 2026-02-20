import 'server-only'
import type { I18n } from '@lingui/core'
import { setI18n } from '@lingui/react/server'
import { getI18nInstance } from './appRouterI18n'
import { type AppLocale, resolveLocaleValue } from './config'

export type LangParamsLike =
  | Promise<{ lang?: string } | undefined>
  | { lang?: string }
  | undefined

export function resolveAppLocale(lang: string | undefined): AppLocale {
  return resolveLocaleValue(lang)
}

export function initLingui(locale: AppLocale): I18n {
  const i18n = getI18nInstance(locale)
  i18n.activate(locale)
  setI18n(i18n)
  return i18n
}

export async function initPageLingui(
  params: LangParamsLike,
): Promise<AppLocale> {
  const resolvedParams = await params
  const locale = resolveAppLocale(resolvedParams?.lang)
  initLingui(locale)
  return locale
}
