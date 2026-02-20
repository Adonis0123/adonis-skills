import type { I18nAbbr } from './data'
import { ALL_LANGUAGES } from './data'

export const supportedLocales = ALL_LANGUAGES.map(lang => lang.abbr) as I18nAbbr[]
export const defaultLocale: I18nAbbr = 'en'
