"use client";

import { type Messages, setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useEffect, useState } from "react";
import type { AppLocale } from "./config";

type LinguiClientProviderProps = Readonly<{
	children: React.ReactNode;
	initialLocale: AppLocale;
	initialMessages: Messages;
}>;

export function LinguiClientProvider({
	children,
	initialLocale,
	initialMessages,
}: LinguiClientProviderProps): React.ReactElement {
	const [i18n] = useState(() =>
		setupI18n({
			locale: initialLocale,
			messages: { [initialLocale]: initialMessages },
		}),
	);

	useEffect(() => {
		i18n.load(initialLocale, initialMessages);
		i18n.activate(initialLocale);
	}, [i18n, initialLocale, initialMessages]);

	return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
