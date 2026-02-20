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
        '<rootDir>/src/components/layout/site-header.tsx',
        '<rootDir>/src/components/layout/mobile-header-menu.tsx',
        '<rootDir>/src/components/layout/site-footer.tsx',
        '<rootDir>/src/components/layout/site-brand.tsx',
        '<rootDir>/src/components/skill-card.tsx',
        '<rootDir>/src/components/copy-install-command.tsx',
        '<rootDir>/src/components/layout/theme-toggle.tsx',
      ],
      output: '<rootDir>/src/locales/{entryDir}/{entryName}/{locale}',
    },
  },
}

export default linguiConfig
