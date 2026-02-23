import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { cleanOrphanedCatalogs } from "./catalog-cleanup";
import { resolveSourceLocale } from "./source-locale";

const LOCALES_DIR = path.join(process.cwd(), "src/locales");

interface LocalePoFile {
	locale: string;
	path: string;
}

interface TranslateI18nOptions {
	fillSource?: boolean;
	strict?: boolean;
}

interface BuildI18nOptions {
	translateLocales?: boolean;
	compileCatalogs?: boolean;
	fillSource?: boolean;
	strictTranslate?: boolean;
}

interface ExtractI18nOptions {
	linguiArgs?: readonly string[];
}

interface SyncI18nOptions {
	extractArgs?: readonly string[];
}

function isI18nDryRun(): boolean {
	return ["1", "true"].includes((process.env.I18N_DRY_RUN ?? "").toLowerCase());
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

function resolveSourceLocaleWithLogs(): string {
	const result = resolveSourceLocale();
	for (const warning of result.warnings) {
		console.warn(warning);
	}
	return result.sourceLocale;
}

export function extractI18n({
	linguiArgs = [],
}: ExtractI18nOptions = {}): void {
	const sourceLocale = resolveSourceLocaleWithLogs();
	const dryRun = isI18nDryRun();
	run("extract catalogs", "pnpm", [
		"exec",
		"lingui",
		"extract-experimental",
		...linguiArgs,
	]);

	const cleanupResult = cleanOrphanedCatalogs({
		localesDir: LOCALES_DIR,
		sourceLocale,
		dryRun,
		log: (message) => console.log(message),
		cwd: process.cwd(),
	});

	if (!dryRun && cleanupResult.removedFiles > 0) {
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
	run("compile catalogs", "pnpm", ["exec", "lingui", "compile"]);
	manifestI18n();
}

export function syncI18n({
	extractArgs = [],
}: SyncI18nOptions = {}): void {
	extractI18n({ linguiArgs: extractArgs });
}

export function translateI18n({
	fillSource = false,
	strict = false,
}: TranslateI18nOptions = {}): void {
	const sourceLocale = resolveSourceLocaleWithLogs();
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
		if (strict) {
			throw new Error(
				`[i18n] strict check failed: ${totalMissing} empty msgstr in target locales.`,
			);
		}
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
	strictTranslate = false,
}: BuildI18nOptions = {}): void {
	extractI18n();
	if (translateLocales) {
		translateI18n({ fillSource, strict: strictTranslate });
	}
	if (compileCatalogs) {
		compileI18n();
	}
}
