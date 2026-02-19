import type { Metadata } from "next";
import { getAllMessages } from "@/i18n/appRouterI18n";
import {
	type AppLocale,
	DEFAULT_LOCALE,
	SUPPORTED_LOCALES,
} from "@/i18n/config";
import { initLingui, resolveAppLocale } from "@/i18n/initLingui";
import { LinguiClientProvider } from "@/i18n/provider";

export const metadata: Metadata = {
	title: "App",
	description: "Lingui i18n enabled app",
};

type LangLayoutProps = Readonly<{
	children: React.ReactNode;
	params: Promise<{ lang: string }>;
}>;

export function generateStaticParams(): Array<{ lang: AppLocale }> {
	return SUPPORTED_LOCALES.map((lang) => ({ lang }));
}

export default async function LangLayout({
	children,
	params,
}: LangLayoutProps): Promise<React.ReactElement> {
	const { lang } = await params;
	const locale = resolveAppLocale(lang);

	initLingui(locale);
	const messages = getAllMessages(locale);

	return (
		<html lang={locale}>
			<body>
				<LinguiClientProvider
					initialLocale={locale}
					initialMessages={messages}
				>
					{children}
				</LinguiClientProvider>
			</body>
		</html>
	);
}
