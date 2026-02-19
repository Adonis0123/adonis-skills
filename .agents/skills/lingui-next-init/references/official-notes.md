# Lingui Official Notes

Use these official pages when adjusting templates or behavior.

## Core References

1. Configuration reference: https://lingui.dev/ref/conf
2. CLI reference: https://lingui.dev/ref/cli
3. SWC plugin reference: https://lingui.dev/ref/swc-plugin
4. Next.js setup tutorial: https://lingui.dev/tutorials/setup-nextjs
5. React Server Components tutorial: https://lingui.dev/tutorials/react-rsc
6. LLM docs index: https://lingui.dev/llms.txt
7. Source repository: https://github.com/lingui/js-lingui
8. Skills repository (availability varies): https://github.com/lingui/skills

## Notes Applied In This Skill

1. Use `@lingui/swc-plugin` instead of legacy macros Babel plugin in Next.js.
2. Keep Lingui config in `lingui.config.ts` and use `extract-experimental` where entry-based extraction is required.
3. Use compile output consumable by ESM runtime loaders (`.mjs` catalogs).
4. Keep runtime provider flow explicit for React/Next hydration (`setupI18n`, `I18nProvider`).
5. Prefer deterministic scripts for extract/compile/manifest, and avoid hidden magic in build pipeline.
