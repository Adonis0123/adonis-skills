import "server-only";
import { type I18n, type Messages, setupI18n } from "@lingui/core";
import { type CatalogLoader, catalogManifest } from "./catalog-manifest";
import { type AppLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./config";

type CatalogModule = Awaited<ReturnType<CatalogLoader>>;

function normalizeMessages(mod: CatalogModule): Messages {
	if (mod.messages) {
		return mod.messages;
	}

	const defaultExport = mod.default;
	if (!defaultExport) {
		return {};
	}

	if (typeof defaultExport === "object" && "messages" in defaultExport) {
		return (defaultExport.messages ?? {}) as Messages;
	}

	return defaultExport as Messages;
}

async function loadAllMessages(): Promise<Record<AppLocale, Messages>> {
	const result = {} as Record<AppLocale, Messages>;

	for (const locale of SUPPORTED_LOCALES) {
		const merged: Messages = {};
		for (const loaders of Object.values(catalogManifest)) {
			const loader = loaders[locale];
			if (!loader) continue;
			const mod = await loader();
			Object.assign(merged, normalizeMessages(mod));
		}
		result[locale] = merged;
	}

	return result;
}

const allMessages = await loadAllMessages();

function buildI18nInstances(
	messagesByLocale: Record<AppLocale, Messages>,
): Record<AppLocale, I18n> {
	const instances = {} as Record<AppLocale, I18n>;

	for (const locale of SUPPORTED_LOCALES) {
		instances[locale] = setupI18n({
			locale,
			messages: { [locale]: messagesByLocale[locale] ?? {} },
		});
	}

	return instances;
}

const allI18nInstances = buildI18nInstances(allMessages);

export function getI18nInstance(locale: AppLocale): I18n {
	return allI18nInstances[locale] ?? allI18nInstances[DEFAULT_LOCALE];
}

export function getAllMessages(locale: AppLocale): Messages {
	return allMessages[locale] ?? {};
}
