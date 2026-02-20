'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

type AppThemeProviderProps = Readonly<{
  children: React.ReactNode
}>

export function ThemeProvider({
  children,
}: AppThemeProviderProps): React.ReactElement {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
