import linguiConfig from "../../lingui.config";
import { DEFAULT_LOCALE } from "../../src/i18n/config";

const EN_FALLBACK_LOCALE = "en";

export interface ResolveSourceLocaleOptions {
	configuredSourceLocale?: unknown;
	defaultLocale?: unknown;
}

export interface ResolveSourceLocaleResult {
	sourceLocale: string;
	warnings: string[];
}

function getValidLocale(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

export function resolveSourceLocale(
	options: ResolveSourceLocaleOptions = {},
): ResolveSourceLocaleResult {
	const warnings: string[] = [];
	const configuredSourceLocale = Object.prototype.hasOwnProperty.call(
		options,
		"configuredSourceLocale",
	)
		? options.configuredSourceLocale
		: linguiConfig.sourceLocale;
	const preferred = getValidLocale(configuredSourceLocale);

	if (preferred) {
		return { sourceLocale: preferred, warnings };
	}

	warnings.push(
		"[i18n] sourceLocale in lingui.config is missing or invalid, falling back.",
	);

	const defaultLocaleSource = Object.prototype.hasOwnProperty.call(
		options,
		"defaultLocale",
	)
		? options.defaultLocale
		: DEFAULT_LOCALE;
	const defaultLocaleCandidate = getValidLocale(defaultLocaleSource);
	if (defaultLocaleCandidate) {
		warnings.push(
			`[i18n] using DEFAULT_LOCALE (${defaultLocaleCandidate}) as sourceLocale fallback.`,
		);
		return { sourceLocale: defaultLocaleCandidate, warnings };
	}

	warnings.push(
		`[i18n] DEFAULT_LOCALE is missing or invalid, using ${EN_FALLBACK_LOCALE} as final fallback.`,
	);
	return { sourceLocale: EN_FALLBACK_LOCALE, warnings };
}
