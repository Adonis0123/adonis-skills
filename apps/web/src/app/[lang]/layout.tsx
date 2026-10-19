import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/shantell-sans/latin-800.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@/styles/globals.css";
import "@/styles/custom.css";
import type { Metadata } from "next";
import { SiteShell } from "@/components/layout/site-shell";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { getAllMessages } from "@/i18n/appRouterI18n";
import { type AppLocale, SUPPORTED_LOCALES } from "@/i18n/config";
import { initLingui, resolveAppLocale } from "@/i18n/initLingui";
import { LinguiClientProvider } from "@/i18n/provider";
import { siteUrl } from "@/config/site-layout";
import { localeAlternates } from "@/lib/seo";

type LangLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}>;

type LangMetadataProps = Readonly<{
  params: Promise<{ lang: string }>;
}>;

export function generateStaticParams(): Array<{ lang: AppLocale }> {
  return SUPPORTED_LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: LangMetadataProps): Promise<Metadata> {
  const { lang } = await params;
  const locale = resolveAppLocale(lang);
  const i18n = initLingui(locale);

  const description = i18n._({
    id: "layout.meta.description",
    message:
      "Battle-tested coding agent skills for delegating tasks, running independent code reviews, shipping clean Git history, and wiring up MCP tools in Claude Code, Codex, Cursor, and Hermes Agent.",
  });

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: i18n._({
        id: "layout.meta.title.default",
        message: "Nika Skills",
      }),
      template: i18n._({
        id: "layout.meta.title.template",
        message: "%s | Nika Skills",
      }),
    },
    description,
    alternates: localeAlternates("/", locale),
    openGraph: {
      type: "website",
      siteName: "Nika Skills",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      description,
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function LangLayout({
  children,
  params,
}: LangLayoutProps): Promise<React.ReactElement> {
  const { lang } = await params;
  const locale = resolveAppLocale(lang);

  initLingui(locale);
  const messages = getAllMessages(locale);

  // This is the root layout: <html lang> must follow the [lang] segment.
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <LinguiClientProvider
            initialLocale={locale}
            initialMessages={messages}
          >
            <SiteShell>{children}</SiteShell>
          </LinguiClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
