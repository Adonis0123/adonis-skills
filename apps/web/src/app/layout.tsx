import type { Metadata } from 'next'
import { IBM_Plex_Mono, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
import { SiteShell } from '@/components/layout/site-shell'
import '@/styles/globals.css'
import '@/styles/custom.css'

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

export const metadata: Metadata = {
  title: {
    default: 'adonis-skills',
    template: '%s | adonis-skills',
  },
  description: '我的技能仓库，支持 npx skills add 快速安装。',
}

const themeInitScript = `
(() => {
  try {
    const key = 'adonis-skills-theme'
    const stored = window.localStorage.getItem(key)
    const theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
  }
  catch {}
})()
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${notoSansSC.variable} ${notoSerifSC.variable} ${ibmPlexMono.variable} antialiased`}>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  )
}
