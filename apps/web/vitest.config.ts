import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["scripts/i18n/__tests__/**/*.test.ts"],
	},
});
