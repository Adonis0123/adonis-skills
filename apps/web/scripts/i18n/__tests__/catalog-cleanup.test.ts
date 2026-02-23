import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanOrphanedCatalogs } from "../catalog-cleanup";
import {
	buildPoWithRefs,
	cleanupTempDir,
	createTempDir,
	writeFile,
} from "./test-helpers";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) cleanupTempDir(dir);
	}
});

describe("cleanOrphanedCatalogs", () => {
	it("removes orphan catalog files without deleting valid nested entry catalogs", () => {
		const rootDir = createTempDir("i18n-cleanup-");
		tempDirs.push(rootDir);
		const localesDir = path.join(rootDir, "src/locales");

		writeFile(
			localesDir,
			"src/components/layout/en.po",
			buildPoWithRefs(["../src/components/layout/mobile-header-menu.tsx:2"]),
		);
		writeFile(localesDir, "src/components/layout/en.mjs", "export default {}\n");
		writeFile(localesDir, "src/components/layout/zh.po", 'msgid "id"\nmsgstr ""\n');

		writeFile(
			localesDir,
			"src/components/layout/mobile-header-menu/en.po",
			buildPoWithRefs(["../src/components/layout/mobile-header-menu.tsx:8"]),
		);
		writeFile(
			localesDir,
			"src/components/layout/mobile-header-menu/en.mjs",
			"export default {}\n",
		);
		writeFile(
			localesDir,
			"src/components/layout/mobile-header-menu/zh.po",
			'msgid "id"\nmsgstr "值"\n',
		);

		const result = cleanOrphanedCatalogs({
			localesDir,
			sourceLocale: "en",
			dryRun: false,
			log: () => {},
			cwd: rootDir,
		});

		expect(result.orphaned).toBe(1);
		expect(result.removedFiles).toBe(3);
		expect(result.removedDirs).toBe(0);
		expect(existsSync(path.join(localesDir, "src/components/layout/en.po"))).toBe(
			false,
		);
		expect(
			existsSync(
				path.join(localesDir, "src/components/layout/mobile-header-menu/en.po"),
			),
		).toBe(true);
		expect(
			readFileSync(
				path.join(localesDir, "src/components/layout/mobile-header-menu/en.po"),
				"utf8",
			),
		).toContain("mobile-header-menu.tsx");
	});

	it("does not mutate files in dry-run mode", () => {
		const rootDir = createTempDir("i18n-cleanup-dry-");
		tempDirs.push(rootDir);
		const localesDir = path.join(rootDir, "src/locales");

		writeFile(
			localesDir,
			"src/components/layout/en.po",
			buildPoWithRefs(["../src/components/layout/mobile-header-menu.tsx:1"]),
		);
		writeFile(localesDir, "src/components/layout/zh.po", 'msgid "id"\nmsgstr ""\n');
		writeFile(localesDir, "src/components/layout/en.mjs", "export default {}\n");

		const logs: string[] = [];
		const result = cleanOrphanedCatalogs({
			localesDir,
			sourceLocale: "en",
			dryRun: true,
			log: (message) => logs.push(message),
			cwd: rootDir,
		});

		expect(result.orphaned).toBe(1);
		expect(result.removedFiles).toBe(3);
		expect(existsSync(path.join(localesDir, "src/components/layout/en.po"))).toBe(
			true,
		);
		expect(logs.some((line) => line.includes("dry-run: would remove"))).toBe(
			true,
		);
	});

	it("keeps valid entries when source references use backslashes", () => {
		const rootDir = createTempDir("i18n-cleanup-win-path-");
		tempDirs.push(rootDir);
		const localesDir = path.join(rootDir, "src/locales");

		writeFile(
			localesDir,
			"src/components/skills-library-section/en.po",
			buildPoWithRefs(["..\\src\\components\\skills-library-section.tsx:6"]),
		);
		writeFile(
			localesDir,
			"src/components/skills-library-section/en.mjs",
			"export default {}\n",
		);
		writeFile(
			localesDir,
			"src/components/skills-library-section/zh.po",
			'msgid "id"\nmsgstr "值"\n',
		);

		const result = cleanOrphanedCatalogs({
			localesDir,
			sourceLocale: "en",
			dryRun: false,
			log: () => {},
			cwd: rootDir,
		});

		expect(result.orphaned).toBe(0);
		expect(result.removedFiles).toBe(0);
		expect(result.removedDirs).toBe(0);
		expect(
			existsSync(
				path.join(localesDir, "src/components/skills-library-section/en.po"),
			),
		).toBe(true);
	});
});
