export const ALL_LANGUAGES = [
  {
    abbr: 'en',
    lang: 'en-US',
    language: 'English',
    locale: 'en',
    languageInEn: 'English',
  },
  {
    abbr: 'zh',
    lang: 'zh-CN',
    language: 'Chinese Simplified',
    locale: 'zh',
    languageInEn: 'Chinese Simplified',
  },
] as const

export type I18nAbbr = (typeof ALL_LANGUAGES)[number]['abbr']
