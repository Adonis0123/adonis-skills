import { buildI18n } from "./index";

const args = new Set(process.argv.slice(2));

buildI18n({
	translateLocales: !args.has("--no-translate"),
	compileCatalogs: args.has("--compile"),
	fillSource: args.has("--fill-source"),
	strictTranslate: args.has("--strict"),
});
