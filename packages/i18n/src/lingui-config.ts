import type { LinguiConfig } from '@lingui/conf'
import { supportedLocales } from './next-config'

const linguiConfig: LinguiConfig = {
  catalogs: [],
  locales: supportedLocales,
  sourceLocale: 'en',
  compileNamespace: 'es',
  format: 'po',
  experimental: {
    extractor: {
      entries: [
        '<rootDir>/src/app/[[]lang[]]/**/{page,layout,loading,error,not-found,template,default}.tsx',
        '<rootDir>/src/components/*.tsx',
        '<rootDir>/src/components/layout/*.tsx',
      ],
      output: '<rootDir>/src/locales/{entryDir}/{entryName}/{locale}',
    },
  },
}

export default linguiConfig
