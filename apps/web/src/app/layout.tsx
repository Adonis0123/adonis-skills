import '@/styles/globals.css'
import '@/styles/custom.css'
import { IBM_Plex_Mono, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { resolveLocaleValue } from '@/i18n/config'

const notoSansSC = Noto_Sans_SC({
  variable: '--font-noto-sans-sc',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
})

const notoSerifSC = Noto_Serif_SC({
  variable: '--font-noto-serif-sc',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
})

type RootLayoutProps = Readonly<{
  children: React.ReactNode
  params: Promise<{ lang?: string } | undefined>
}>

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const resolvedParams = await params
  const locale = resolveLocaleValue(resolvedParams?.lang)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${notoSansSC.variable} ${notoSerifSC.variable} ${ibmPlexMono.variable} antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
