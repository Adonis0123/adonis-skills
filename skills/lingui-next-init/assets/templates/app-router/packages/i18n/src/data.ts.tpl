export const ALL_LANGUAGES = [
{{ALL_LANGUAGES_ENTRIES}}
] as const;

export type I18nAbbr = (typeof ALL_LANGUAGES)[number]["abbr"];
