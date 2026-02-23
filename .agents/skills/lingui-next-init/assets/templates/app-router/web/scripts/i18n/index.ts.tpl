import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import linguiConfig from "../../lingui.config";
import { DEFAULT_LOCALE } from "../../src/i18n/config";

const LOCALES_DIR = path.join(process.cwd(), "src/locales");
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
const I18N_DRY_RUN = ["1", "true"].includes(
	(process.env.I18N_DRY_RUN ?? "").toLowerCase(),
);

interface LocalePoFile {
	locale: string;
	path: string;
}

interface TranslateI18nOptions {
	fillSource?: boolean;
}

interface BuildI18nOptions {
	translateLocales?: boolean;
	compileCatalogs?: boolean;
	fillSource?: boolean;
}

interface ExtractI18nOptions {
	linguiArgs?: readonly string[];
}

interface SyncI18nOptions {
	extractArgs?: readonly string[];
}

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

function listFilesByExtensions(
	dir: string,
	extensions: ReadonlySet<string>,
): string[] {
	if (!existsSync(dir)) return [];

	const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
	const files: string[] = [];

	for (const entry of entries) {
		const full = path.join(dir, entry);
		const stats = statSync(full);
		if (stats.isDirectory()) {
			files.push(...listFilesByExtensions(full, extensions));
			continue;
		}
		if (
			stats.isFile() &&
			extensions.has(path.extname(entry).toLowerCase())
		) {
			files.push(full);
		}
	}

	return files;
}

function listPoFiles(dir: string): string[] {
	return listFilesByExtensions(dir, new Set([".po"]));
}

function listCatalogFiles(dir: string): string[] {
	return listFilesByExtensions(dir, CATALOG_FILE_EXTENSIONS);
}

function getTargetPoFiles(sourceLocale: string): LocalePoFile[] {
	return listPoFiles(LOCALES_DIR)
		.filter((filePath) => path.basename(filePath) !== `${sourceLocale}.po`)
		.map((filePath) => ({
			locale: path.basename(filePath, ".po"),
			path: filePath,
		}));
}

function run(name: string, command: string, args: string[]): void {
	console.log(`[i18n] ${name}`);
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		stdio: "inherit",
		shell: false,
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function parseQuotedValue(line: string, key: string): string | null {
	const prefix = `${key} "`;
	if (!line.startsWith(prefix) || !line.endsWith('"')) {
		return null;
	}
	return line.slice(prefix.length, -1);
}

function escapePo(str: string): string {
	return str.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function analyzePo(content: string): { total: number; missing: number } {
	const lines = content.split(/\r?\n/);
	let msgid: string | null = null;
	let total = 0;
	let missing = 0;

	for (const line of lines) {
		const id = parseQuotedValue(line, "msgid");
		if (id !== null) {
			msgid = id;
			continue;
		}

		const str = parseQuotedValue(line, "msgstr");
		if (str !== null && msgid !== null) {
			if (msgid !== "") {
				total += 1;
				if (str === "") missing += 1;
			}
			msgid = null;
		}
	}

	return { total, missing };
}

function fillMissingWithSource(content: string): {
	content: string;
	replacements: number;
} {
	const lines = content.split(/\r?\n/);
	let msgid: string | null = null;
	let replacements = 0;

	for (let i = 0; i < lines.length; i += 1) {
		const currentLine = lines[i] ?? "";
		const id = parseQuotedValue(currentLine, "msgid");
		if (id !== null) {
			msgid = id;
			continue;
		}

		const str = parseQuotedValue(currentLine, "msgstr");
		if (str !== null && msgid !== null) {
			if (msgid !== "" && str === "") {
				lines[i] = `msgstr "${escapePo(msgid)}"`;
				replacements += 1;
			}
			msgid = null;
		}
	}

	return {
		content: lines.join("\n"),
		replacements,
	};
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

function isRemovableCatalogDir(dir: string): boolean {
	const rel = path.relative(LOCALES_DIR, dir);
	return (
		rel !== "" &&
		rel !== "." &&
		!rel.startsWith("..") &&
		!path.isAbsolute(rel)
	);
}

function entrySourceSuffixes(entry: string): string[] {
	return OWNERSHIP_SOURCE_EXTENSIONS.map((ext) => `${entry}${ext}`);
}

function entryOwnsCatalog(entry: string, content: string): boolean {
	const suffixes = entrySourceSuffixes(entry);
	const refLinePattern = /^#:\s+(.+)$/gm;
	let match: RegExpExecArray | null;
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

function listCatalogFilesInEntry(entryDir: string): string[] {
	if (!existsSync(entryDir)) return [];
	return readdirSync(entryDir)
		.map((name) => path.join(entryDir, name))
		.filter((filePath) => {
			if (!existsSync(filePath)) return false;
			const stats = statSync(filePath);
			return (
				stats.isFile() &&
				CATALOG_FILE_EXTENSIONS.has(
					path.extname(filePath).toLowerCase(),
				)
			);
		});
}

function collectPrunableDirs(
	startDir: string,
	pendingFileRemovals: ReadonlySet<string>,
	pendingDirRemovals: ReadonlySet<string>,
): string[] {
	const prunableDirs: string[] = [];
	const scheduledDirRemovals = new Set<string>(pendingDirRemovals);
	let currentDir = startDir;

	while (isRemovableCatalogDir(currentDir)) {
		const entries = readdirSync(currentDir);
		const hasRemaining = entries.some((entry) => {
			const fullPath = path.join(currentDir, entry);
			return (
				!pendingFileRemovals.has(fullPath) &&
				!scheduledDirRemovals.has(fullPath)
			);
		});
		if (hasRemaining) break;

		prunableDirs.push(currentDir);
		scheduledDirRemovals.add(currentDir);
		currentDir = path.dirname(currentDir);
	}

	return prunableDirs;
}

function removeEmptyCatalogDirs(startDir: string): number {
	let removedDirs = 0;
	let currentDir = startDir;

	while (isRemovableCatalogDir(currentDir)) {
		if (readdirSync(currentDir).length > 0) break;
		rmdirSync(currentDir);
		removedDirs += 1;
		currentDir = path.dirname(currentDir);
	}

	return removedDirs;
}

/**
 * 清理不拥有自身消息的 entry。
 * 仅删除该 entry 目录下的 .po/.mjs 文件，并向上清理空目录。
 * 判据：sourceLocale 对应 .po 中无任何 #: 引用指向 entry 自身源文件。
 */
function cleanOrphanedCatalogs(sourceLocale: string): {
	orphaned: number;
	removedFiles: number;
	removedDirs: number;
} {
	const entries = new Set<string>();
	for (const catalogFile of listCatalogFiles(LOCALES_DIR)) {
		const entry = normalizePath(
			path.relative(LOCALES_DIR, path.dirname(catalogFile)),
		);
		if (entry === "." || entry.startsWith("..")) continue;
		entries.add(entry);
	}
	const sortedEntries = [...entries].sort((a, b) => a.localeCompare(b));

	let removedFiles = 0;
	let removedDirs = 0;
	let orphaned = 0;
	const pendingFileRemovals = new Set<string>();
	const pendingDirRemovals = new Set<string>();

	for (const entry of sortedEntries) {
		const entryDir = path.join(LOCALES_DIR, entry);
		const sourcePoPath = path.join(entryDir, `${sourceLocale}.po`);
		const ownsCatalog =
			existsSync(sourcePoPath) &&
			entryOwnsCatalog(entry, readFileSync(sourcePoPath, "utf8"));

		if (ownsCatalog) continue;
		orphaned++;

		const filesToRemove = listCatalogFilesInEntry(entryDir);
		if (I18N_DRY_RUN) {
			for (const filePath of filesToRemove) {
				pendingFileRemovals.add(filePath);
			}
			const dirsToRemove = collectPrunableDirs(
				entryDir,
				pendingFileRemovals,
				pendingDirRemovals,
			);
			for (const dirPath of dirsToRemove) {
				pendingDirRemovals.add(dirPath);
			}

			for (const filePath of filesToRemove) {
				console.log(
					`[i18n] dry-run: would remove catalog file ${path.relative(process.cwd(), filePath)}`,
				);
			}
			for (const dirPath of dirsToRemove) {
				console.log(
					`[i18n] dry-run: would remove empty catalog directory ${path.relative(process.cwd(), dirPath)}`,
				);
			}
			removedFiles += filesToRemove.length;
			removedDirs += dirsToRemove.length;
			continue;
		}

		for (const filePath of filesToRemove) {
			unlinkSync(filePath);
			removedFiles += 1;
		}
		removedDirs += removeEmptyCatalogDirs(entryDir);
	}

	if (orphaned > 0 && I18N_DRY_RUN) {
		console.log(
			`[i18n] dry-run: ${orphaned} orphaned catalog(s); ${removedFiles} file(s) and ${removedDirs} empty directory(ies) would be removed`,
		);
	}
	if (orphaned > 0 && !I18N_DRY_RUN) {
		console.log(
			`[i18n] cleaned ${orphaned} orphaned catalog(s): removed ${removedFiles} file(s), pruned ${removedDirs} empty directory(ies)`,
		);
	}

	return {
		orphaned,
		removedFiles,
		removedDirs,
	};
}

export function extractI18n({
	linguiArgs = [],
}: ExtractI18nOptions = {}): void {
	const sourceLocale = resolveSourceLocale();
	run("extract catalogs", "{{PACKAGE_MANAGER}}", [
		"exec",
		"lingui",
		"extract-experimental",
		...linguiArgs,
	]);
	const cleanupResult = cleanOrphanedCatalogs(sourceLocale);
	if (!I18N_DRY_RUN && cleanupResult.removedFiles > 0) {
		console.log(
			"[i18n] catalog files changed during cleanup, regenerating catalog manifest.",
		);
		manifestI18n();
	}
}

export function manifestI18n(): void {
	run("generate page catalog manifest", "node", [
		"--import",
		"tsx",
		"./scripts/i18n/manifest.ts",
	]);
}

export function compileI18n(): void {
	run("compile catalogs", "{{PACKAGE_MANAGER}}", ["exec", "lingui", "compile"]);
	manifestI18n();
}

export function syncI18n({
	extractArgs = [],
}: SyncI18nOptions = {}): void {
	extractI18n({ linguiArgs: extractArgs });
}

export function translateI18n({
	fillSource = false,
}: TranslateI18nOptions = {}): void {
	const sourceLocale = resolveSourceLocale();
	const targetFiles = getTargetPoFiles(sourceLocale);

	if (targetFiles.length === 0) {
		console.log(
			"[i18n] no target locale po files found under src/locales/**/*.po",
		);
		return;
	}

	let totalMissing = 0;

	for (const target of targetFiles) {
		let targetContent = readFileSync(target.path, "utf8");
		if (fillSource) {
			const filled = fillMissingWithSource(targetContent);
			if (filled.replacements > 0) {
				writeFileSync(target.path, filled.content, "utf8");
				targetContent = filled.content;
				console.log(
					`[i18n] ${target.locale}: filled ${filled.replacements} empty msgstr with source text`,
				);
			}
		}

		const stats = analyzePo(targetContent);
		totalMissing += stats.missing;
		console.log(
			`[i18n] ${path.relative(process.cwd(), target.path)}: total=${stats.total}, missing=${stats.missing}`,
		);
	}

	if (totalMissing > 0) {
		console.log(
			`[i18n] translation is still incomplete: ${totalMissing} empty msgstr in target locales.`,
		);
		console.log(
			`[i18n] edit target locale files under src/locales/**/*.po (except **/${sourceLocale}.po), then run i18n:compile if needed.`,
		);
	} else {
		console.log("[i18n] all target locale messages are translated.");
	}
}

export function bootstrapI18n(): void {
	extractI18n();
	compileI18n();
}

export function buildI18n({
	translateLocales = true,
	compileCatalogs = false,
	fillSource = false,
}: BuildI18nOptions = {}): void {
	extractI18n();
	if (translateLocales) {
		translateI18n({ fillSource });
	}
	if (compileCatalogs) {
		compileI18n();
	}
}
