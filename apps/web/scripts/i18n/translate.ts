import { translateI18n } from "./index";

const args = new Set(process.argv.slice(2));

translateI18n({
	fillSource: args.has("--fill-source"),
	strict: args.has("--strict"),
});
