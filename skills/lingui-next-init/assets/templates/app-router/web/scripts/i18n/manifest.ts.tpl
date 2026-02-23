import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import linguiConfig from "../../lingui.config";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../src/i18n/config";

const LOCALES_DIR = path.join(process.cwd(), "src/locales");
const OUTPUT_FILE = path.join(process.cwd(), "src/i18n/catalog-manifest.ts");
const EN_FALLBACK_LOCALE = "en";
const OWNERSHIP_SOURCE_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
	".md",
	".mdx",
];
const CATALOG_FILE_EXTENSIONS = new Set([".po", ".mjs"]);
const INCLUDED_ENTRY_PREFIXES = [
	"src/app/[lang]/",
	"src/components/",
];
const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

function getValidLocale(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function resolveSourceLocale(): string {
	const configured = getValidLocale(linguiConfig.sourceLocale);
	if (configured) return configured;

	console.warn(
		"[i18n] sourceLocale in lingui.config is missing or invalid, falling back.",
	);
	const defaultLocaleCandidate = getValidLocale(DEFAULT_LOCALE);
	if (defaultLocaleCandidate) {
		console.warn(
			`[i18n] using DEFAULT_LOCALE (${defaultLocaleCandidate}) as sourceLocale fallback.`,
		);
		return defaultLocaleCandidate;
	}

	console.warn(
		`[i18n] DEFAULT_LOCALE is missing or invalid, using ${EN_FALLBACK_LOCALE} as final fallback.`,
	);
	return EN_FALLBACK_LOCALE;
}

function shouldIncludeEntry(entry: string): boolean {
	return INCLUDED_ENTRY_PREFIXES.some((prefix) => entry.startsWith(prefix));
}

function normalizePath(input: string): string {
	return input.replace(/\\/g, "/");
}

function safeDecodeUriComponent(input: string): string {
	try {
		return decodeURIComponent(input);
	} catch {
		return input;
	}
}

function listFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];

	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const fullPath = path.join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...listFiles(fullPath));
			continue;
		}
		if (stats.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

function listCatalogFiles(dir: string): string[] {
	return listFiles(dir).filter((filePath) =>
		CATALOG_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
	);
}

function entrySourceSuffixes(entry: string): string[] {
	return OWNERSHIP_SOURCE_EXTENSIONS.map((ext) => `${entry}${ext}`);
}

/**
 * 判断 entry 是否直接拥有翻译消息。
 * 读取源语言 .po 文件的 #: 源引用行，若存在指向 entry 自身源文件的引用则返回 true。
 * 空 catalog 和纯包装组件（所有消息来自导入的子组件）均返回 false。
 */
function entryOwnsCatalog(entry: string, sourceLocale: string): boolean {
	const poPath = path.join(LOCALES_DIR, entry, `${sourceLocale}.po`);
	if (!existsSync(poPath)) return false;

	const content = readFileSync(poPath, "utf8");
	const suffixes = entrySourceSuffixes(entry);
	const refLinePattern = /^#:\s+(.+)$/gm;
	let match;
	while ((match = refLinePattern.exec(content)) !== null) {
		const refs = match[1]?.trim().split(/\s+/) ?? [];
		for (const token of refs) {
			const ref = normalizePath(
				safeDecodeUriComponent(token.replace(/:\d+(?::\d+)?$/, "")),
			);
			if (suffixes.some((s) => ref.endsWith(s))) return true;
		}
	}
	return false;
}

interface BuildManifestResult {
	manifest: Record<string, Record<string, string>>;
	candidateEntries: number;
}

function buildManifest(sourceLocale: string): BuildManifestResult {
	const fileMap: Record<string, Record<string, string>> = {};
	const files = listFiles(LOCALES_DIR).filter((file) => file.endsWith(".mjs"));
	const ownershipCache = new Map<string, boolean>();
	const candidateEntries = new Set<string>();

	for (const file of listCatalogFiles(LOCALES_DIR)) {
		const rel = normalizePath(path.relative(LOCALES_DIR, file));
		const entry = normalizePath(path.dirname(rel));
		if (entry === ".") continue;
		if (!shouldIncludeEntry(entry)) continue;
		candidateEntries.add(entry);
	}

	for (const file of files) {
		const rel = normalizePath(path.relative(LOCALES_DIR, file));
		const locale = path.basename(rel, ".mjs");
		const entry = normalizePath(path.dirname(rel));

		if (entry === ".") {
			continue;
		}
		if (!shouldIncludeEntry(entry)) {
			continue;
		}
		if (!SUPPORTED_LOCALE_SET.has(locale)) {
			continue;
		}

		// 仅保留拥有自身消息的 entry（过滤空 catalog 和纯包装组件）
		if (!ownershipCache.has(entry)) {
			ownershipCache.set(entry, entryOwnsCatalog(entry, sourceLocale));
		}
		if (!ownershipCache.get(entry)) continue;

		fileMap[entry] ??= {};
		fileMap[entry][locale] = `../locales/${entry}/${locale}.mjs`;
	}

	return {
		manifest: fileMap,
		candidateEntries: candidateEntries.size,
	};
}

function renderManifest(
	manifest: Record<string, Record<string, string>>,
): string {
	const entries = Object.keys(manifest).sort();
	const lines: string[] = [];
	const identifierReg = /^[$A-Z_a-z][$\w]*$/;
	const formatKey = (key: string) =>
		identifierReg.test(key) ? key : JSON.stringify(key);

	lines.push("// Generated by scripts/i18n/manifest.ts. Do not edit manually.");
	lines.push('import type { Messages } from "@lingui/core";');
	lines.push("");
	lines.push("type CatalogModule = {");
	lines.push("\tdefault?: Messages | { messages?: Messages };");
	lines.push("\tmessages?: Messages;");
	lines.push("};");
	lines.push("export type CatalogLoader = () => Promise<CatalogModule>;");
	lines.push(
		"export type CatalogManifest = Record<string, Record<string, CatalogLoader>>;",
	);
	lines.push("");
	lines.push("export const catalogManifest: CatalogManifest = {");

	for (const entry of entries) {
		lines.push(`\t${formatKey(entry)}: {`);
		const locales = Object.keys(manifest[entry] ?? {}).sort();
		for (const locale of locales) {
			const importPath = manifest[entry]?.[locale];
			if (!importPath) continue;
			lines.push(
				`\t\t${formatKey(locale)}: () => import(${JSON.stringify(importPath)}),`,
			);
		}
		lines.push("\t},");
	}

	lines.push("};");
	lines.push("");

	return lines.join("\n");
}

function main(): void {
	const sourceLocale = resolveSourceLocale();
	const { manifest, candidateEntries } = buildManifest(sourceLocale);
	const content = renderManifest(manifest);

	mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
	writeFileSync(OUTPUT_FILE, content, "utf8");

	const kept = Object.keys(manifest).length;
	const skipped = candidateEntries - kept;

	console.log(
		`[i18n] wrote catalog manifest: ${path.relative(process.cwd(), OUTPUT_FILE)}`,
	);
	console.log(
		`[i18n] entries: ${kept}${skipped > 0 ? ` (skipped ${skipped} without own messages)` : ""}`,
	);
}

main();
