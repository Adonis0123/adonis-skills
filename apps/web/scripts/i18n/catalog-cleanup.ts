import {
	existsSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import path from "node:path";
import {
	CATALOG_FILE_EXTENSIONS,
	entryOwnsCatalogContent,
	normalizePath,
} from "./catalog-ownership";

export interface CleanOrphanedCatalogsOptions {
	localesDir: string;
	sourceLocale: string;
	dryRun?: boolean;
	log?: (message: string) => void;
	cwd?: string;
}

export interface CleanOrphanedCatalogsResult {
	orphaned: number;
	removedFiles: number;
	removedDirs: number;
}

function listFilesByExtensions(
	dir: string,
	extensions: ReadonlySet<string>,
): string[] {
	if (!existsSync(dir)) return [];

	const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...listFilesByExtensions(fullPath, extensions));
			continue;
		}
		if (
			stats.isFile() &&
			extensions.has(path.extname(entry).toLowerCase())
		) {
			files.push(fullPath);
		}
	}

	return files;
}

function listCatalogFiles(localesDir: string): string[] {
	return listFilesByExtensions(localesDir, CATALOG_FILE_EXTENSIONS);
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
				CATALOG_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
			);
		});
}

function isRemovableCatalogDir(localesDir: string, dir: string): boolean {
	const rel = path.relative(localesDir, dir);
	return (
		rel !== "" &&
		rel !== "." &&
		!rel.startsWith("..") &&
		!path.isAbsolute(rel)
	);
}

function collectPrunableDirs(
	localesDir: string,
	startDir: string,
	pendingFileRemovals: ReadonlySet<string>,
	pendingDirRemovals: ReadonlySet<string>,
): string[] {
	const prunableDirs: string[] = [];
	const scheduledDirRemovals = new Set<string>(pendingDirRemovals);
	let currentDir = startDir;

	while (isRemovableCatalogDir(localesDir, currentDir)) {
		if (!existsSync(currentDir)) break;
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

function removeEmptyCatalogDirs(localesDir: string, startDir: string): number {
	let removedDirs = 0;
	let currentDir = startDir;

	while (isRemovableCatalogDir(localesDir, currentDir)) {
		if (!existsSync(currentDir)) break;
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
 */
export function cleanOrphanedCatalogs({
	localesDir,
	sourceLocale,
	dryRun = false,
	log = console.log,
	cwd = process.cwd(),
}: CleanOrphanedCatalogsOptions): CleanOrphanedCatalogsResult {
	const entries = new Set<string>();
	for (const catalogFile of listCatalogFiles(localesDir)) {
		const entry = normalizePath(
			path.relative(localesDir, path.dirname(catalogFile)),
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
		const entryDir = path.join(localesDir, entry);
		const sourcePoPath = path.join(entryDir, `${sourceLocale}.po`);
		const ownsCatalog =
			existsSync(sourcePoPath) &&
			entryOwnsCatalogContent(entry, readFileSync(sourcePoPath, "utf8"));

		if (ownsCatalog) continue;
		orphaned += 1;

		const filesToRemove = listCatalogFilesInEntry(entryDir);
		if (dryRun) {
			for (const filePath of filesToRemove) {
				pendingFileRemovals.add(filePath);
			}

			const dirsToRemove = collectPrunableDirs(
				localesDir,
				entryDir,
				pendingFileRemovals,
				pendingDirRemovals,
			);
			for (const dirPath of dirsToRemove) {
				pendingDirRemovals.add(dirPath);
			}

			for (const filePath of filesToRemove) {
				log(
					`[i18n] dry-run: would remove catalog file ${path.relative(cwd, filePath)}`,
				);
			}
			for (const dirPath of dirsToRemove) {
				log(
					`[i18n] dry-run: would remove empty catalog directory ${path.relative(cwd, dirPath)}`,
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
		removedDirs += removeEmptyCatalogDirs(localesDir, entryDir);
	}

	if (orphaned > 0 && dryRun) {
		log(
			`[i18n] dry-run: ${orphaned} orphaned catalog(s); ${removedFiles} file(s) and ${removedDirs} empty directory(ies) would be removed`,
		);
	}
	if (orphaned > 0 && !dryRun) {
		log(
			`[i18n] cleaned ${orphaned} orphaned catalog(s): removed ${removedFiles} file(s), pruned ${removedDirs} empty directory(ies)`,
		);
	}

	return {
		orphaned,
		removedFiles,
		removedDirs,
	};
}
