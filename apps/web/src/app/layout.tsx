import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@/styles/globals.css";
import "@/styles/custom.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { resolveLocaleValue } from "@/i18n/config";

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ lang?: string } | undefined>;
}>;

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const resolvedParams = await params;
  const locale = resolveLocaleValue(resolvedParams?.lang);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
