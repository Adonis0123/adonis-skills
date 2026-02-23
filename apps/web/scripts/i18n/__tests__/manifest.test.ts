import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildManifest } from "../manifest";
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

describe("buildManifest", () => {
	it("keeps only entries that own their source messages", () => {
		const rootDir = createTempDir("i18n-manifest-");
		tempDirs.push(rootDir);
		const localesDir = path.join(rootDir, "src/locales");

		writeFile(
			localesDir,
			"src/components/skills-library-section/en.po",
			buildPoWithRefs(["../src/components/skills-library-section.tsx:12"]),
		);
		writeFile(
			localesDir,
			"src/components/skills-library-section/en.mjs",
			"export default {}\n",
		);
		writeFile(
			localesDir,
			"src/components/skills-library-section/zh.mjs",
			"export default {}\n",
		);

		writeFile(
			localesDir,
			"src/components/layout/en.po",
			buildPoWithRefs(["../src/components/layout/mobile-header-menu.tsx:8"]),
		);
		writeFile(localesDir, "src/components/layout/en.mjs", "export default {}\n");
		writeFile(localesDir, "src/components/layout/zh.mjs", "export default {}\n");

		const result = buildManifest({
			localesDir,
			sourceLocale: "en",
			supportedLocales: new Set(["en", "zh"]),
			includedEntryPrefixes: ["src/components/"],
		});

		expect(result.candidateEntries).toBe(2);
		expect(Object.keys(result.manifest)).toEqual([
			"src/components/skills-library-section",
		]);
		expect(result.manifest["src/components/skills-library-section"]).toEqual({
			en: "../locales/src/components/skills-library-section/en.mjs",
			zh: "../locales/src/components/skills-library-section/zh.mjs",
		});
	});

	it("keeps entry when source references use Windows-style backslashes", () => {
		const rootDir = createTempDir("i18n-manifest-win-path-");
		tempDirs.push(rootDir);
		const localesDir = path.join(rootDir, "src/locales");

		writeFile(
			localesDir,
			"src/components/skills-library-section/en.po",
			buildPoWithRefs(["..\\src\\components\\skills-library-section.tsx:12"]),
		);
		writeFile(
			localesDir,
			"src/components/skills-library-section/en.mjs",
			"export default {}\n",
		);
		writeFile(
			localesDir,
			"src/components/skills-library-section/zh.mjs",
			"export default {}\n",
		);

		const result = buildManifest({
			localesDir,
			sourceLocale: "en",
			supportedLocales: new Set(["en", "zh"]),
			includedEntryPrefixes: ["src/components/"],
		});

		expect(result.candidateEntries).toBe(1);
		expect(Object.keys(result.manifest)).toEqual([
			"src/components/skills-library-section",
		]);
	});
});
