import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".lingui/**",
    // Compiled Lingui catalogs (gitignored). The build recompiles them while
    // turbo runs lint in parallel, so linting them races with file deletion.
    "src/locales/**/*.mjs",
  ]),
]);

export default eslintConfig;
