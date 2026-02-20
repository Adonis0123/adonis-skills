import type { Metadata } from 'next'
import { SiteShell } from '@/components/layout/site-shell'
import { getAllMessages } from '@/i18n/appRouterI18n'
import { type AppLocale, SUPPORTED_LOCALES } from '@/i18n/config'
import { initLingui, resolveAppLocale } from '@/i18n/initLingui'
import { LinguiClientProvider } from '@/i18n/provider'

type LangLayoutProps = Readonly<{
  children: React.ReactNode
  params: Promise<{ lang: string }>
}>

type LangMetadataProps = Readonly<{
  params: Promise<{ lang: string }>
}>

export function generateStaticParams(): Array<{ lang: AppLocale }> {
  return SUPPORTED_LOCALES.map(lang => ({ lang }))
}

export async function generateMetadata({ params }: LangMetadataProps): Promise<Metadata> {
  const { lang } = await params
  const locale = resolveAppLocale(lang)
  const i18n = initLingui(locale)

  return {
    title: {
      default: i18n._({
        id: 'layout.meta.title.default',
        message: 'adonis-skills',
      }),
      template: i18n._({
        id: 'layout.meta.title.template',
        message: '%s | adonis-skills',
      }),
    },
    description: i18n._({
      id: 'layout.meta.description',
      message: 'A practical skill library for AI agent developers, installable with npx skills add.',
    }),
  }
}

export default async function LangLayout({
  children,
  params,
}: LangLayoutProps): Promise<React.ReactElement> {
  const { lang } = await params
  const locale = resolveAppLocale(lang)

  initLingui(locale)
  const messages = getAllMessages(locale)

  return (
    <LinguiClientProvider initialLocale={locale} initialMessages={messages}>
      <SiteShell>{children}</SiteShell>
    </LinguiClientProvider>
  )
}
