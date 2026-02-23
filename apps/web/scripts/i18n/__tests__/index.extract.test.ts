import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	spawnSyncMock,
	cleanOrphanedCatalogsMock,
	resolveSourceLocaleMock,
} = vi.hoisted(() => ({
	spawnSyncMock: vi.fn(() => ({ status: 0 })),
	cleanOrphanedCatalogsMock: vi.fn(),
	resolveSourceLocaleMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: spawnSyncMock,
}));

vi.mock("../catalog-cleanup", () => ({
	cleanOrphanedCatalogs: cleanOrphanedCatalogsMock,
}));

vi.mock("../source-locale", () => ({
	resolveSourceLocale: resolveSourceLocaleMock,
}));

const originalDryRun = process.env.I18N_DRY_RUN;

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	delete process.env.I18N_DRY_RUN;

	resolveSourceLocaleMock.mockReturnValue({
		sourceLocale: "en",
		warnings: [],
	});
	cleanOrphanedCatalogsMock.mockReturnValue({
		orphaned: 0,
		removedFiles: 0,
		removedDirs: 0,
	});
});

afterEach(() => {
	if (typeof originalDryRun === "string") {
		process.env.I18N_DRY_RUN = originalDryRun;
	} else {
		delete process.env.I18N_DRY_RUN;
	}
});

describe("extractI18n", () => {
	it("regenerates manifest when cleanup removed catalog files in non-dry-run mode", async () => {
		cleanOrphanedCatalogsMock.mockReturnValue({
			orphaned: 1,
			removedFiles: 2,
			removedDirs: 1,
		});

		const { extractI18n } = await import("../index");
		extractI18n();

		expect(cleanOrphanedCatalogsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceLocale: "en",
				dryRun: false,
			}),
		);
		expect(spawnSyncMock).toHaveBeenCalledTimes(2);
		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			1,
			"pnpm",
			expect.arrayContaining(["extract-experimental"]),
			expect.any(Object),
		);
		expect(spawnSyncMock).toHaveBeenNthCalledWith(
			2,
			"node",
			expect.arrayContaining(["./scripts/i18n/manifest.ts"]),
			expect.any(Object),
		);
	});

	it("does not regenerate manifest in dry-run mode", async () => {
		process.env.I18N_DRY_RUN = "1";
		cleanOrphanedCatalogsMock.mockReturnValue({
			orphaned: 1,
			removedFiles: 3,
			removedDirs: 2,
		});

		const { extractI18n } = await import("../index");
		extractI18n();

		expect(cleanOrphanedCatalogsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceLocale: "en",
				dryRun: true,
			}),
		);
		expect(spawnSyncMock).toHaveBeenCalledTimes(1);
		expect(spawnSyncMock).toHaveBeenCalledWith(
			"pnpm",
			expect.arrayContaining(["extract-experimental"]),
			expect.any(Object),
		);
	});
});
