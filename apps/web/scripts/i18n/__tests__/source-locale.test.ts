import { describe, expect, it } from "vitest";
import { resolveSourceLocale } from "../source-locale";

describe("resolveSourceLocale", () => {
	it("returns sourceLocale from lingui.config when valid", () => {
		const result = resolveSourceLocale();

		expect(result.sourceLocale).toBe("en");
		expect(result.warnings).toEqual([]);
	});

	it("falls back to DEFAULT_LOCALE when sourceLocale is invalid", () => {
		const result = resolveSourceLocale({
			configuredSourceLocale: "",
			defaultLocale: "zh",
		});

		expect(result.sourceLocale).toBe("zh");
		expect(result.warnings.length).toBe(2);
		expect(result.warnings[0]).toContain("sourceLocale");
		expect(result.warnings[1]).toContain("DEFAULT_LOCALE");
	});

	it("falls back to en when both sourceLocale and DEFAULT_LOCALE are invalid", () => {
		const result = resolveSourceLocale({
			configuredSourceLocale: null,
			defaultLocale: "  ",
		});

		expect(result.sourceLocale).toBe("en");
		expect(result.warnings.length).toBe(2);
		expect(result.warnings[1]).toContain("final fallback");
	});
});
