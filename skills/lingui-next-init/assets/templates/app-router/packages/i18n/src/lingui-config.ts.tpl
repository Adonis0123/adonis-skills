import type { LinguiConfig } from "@lingui/conf";
import { supportedLocales } from "./next-config";

const linguiConfig: LinguiConfig = {
	locales: supportedLocales,
	sourceLocale: "{{SOURCE_LOCALE}}",
	compileNamespace: "es",
	format: "po",
	experimental: {
		extractor: {
			entries: [
				"<rootDir>/src/app/[[]lang[]]/**/{page,layout,loading,error,not-found,template,default}.tsx",
			],
			output: "<rootDir>/src/locales/{entryDir}/{entryName}/{locale}",
		},
	},
};

export default linguiConfig;
