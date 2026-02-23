import { describe, expect, it } from "vitest";
import { entryOwnsCatalogContent } from "../catalog-ownership";

describe("entryOwnsCatalogContent", () => {
	it("matches entry references and strips line/column suffixes", () => {
		const content = [
			"#: ../src/components/skills-library-section.tsx:60:2",
			"msgid \"home.library.title\"",
			"msgstr \"Skill Library\"",
		].join("\n");

		expect(
			entryOwnsCatalogContent("src/components/skills-library-section", content),
		).toBe(true);
	});

	it("supports URI-decoded references", () => {
		const content = [
			"#: ../src/components/my%20component.tsx:10",
			"msgid \"id\"",
			"msgstr \"value\"",
		].join("\n");

		expect(entryOwnsCatalogContent("src/components/my component", content)).toBe(
			true,
		);
	});

	it("supports Windows-style backslash references", () => {
		const content = [
			"#: ..\\src\\components\\skills-library-section.tsx:10",
			"msgid \"id\"",
			"msgstr \"value\"",
		].join("\n");

		expect(
			entryOwnsCatalogContent("src/components/skills-library-section", content),
		).toBe(true);
	});

	it("returns false when references only point to child components", () => {
		const content = [
			"#: ../src/components/layout/mobile-header-menu.tsx:5",
			"msgid \"id\"",
			"msgstr \"value\"",
		].join("\n");

		expect(entryOwnsCatalogContent("src/components/layout", content)).toBe(false);
	});
});
