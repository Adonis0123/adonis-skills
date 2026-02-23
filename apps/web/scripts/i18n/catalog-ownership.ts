export const OWNERSHIP_SOURCE_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
	".md",
	".mdx",
];

export const CATALOG_FILE_EXTENSIONS = new Set([".po", ".mjs"]);

export function normalizePath(input: string): string {
	return input.replace(/\\/g, "/");
}

export function safeDecodeUriComponent(input: string): string {
	try {
		return decodeURIComponent(input);
	} catch {
		return input;
	}
}

export function entrySourceSuffixes(entry: string): string[] {
	return OWNERSHIP_SOURCE_EXTENSIONS.map((ext) => `${entry}${ext}`);
}

export function entryOwnsCatalogContent(entry: string, content: string): boolean {
	const suffixes = entrySourceSuffixes(entry);
	const refLinePattern = /^#:\s+(.+)$/gm;
	let match: RegExpExecArray | null;

	while ((match = refLinePattern.exec(content)) !== null) {
		const refs = match[1]?.trim().split(/\s+/) ?? [];
		for (const token of refs) {
			const ref = normalizePath(
				safeDecodeUriComponent(token.replace(/:\d+(?::\d+)?$/, "")),
			);
			if (suffixes.some((suffix) => ref.endsWith(suffix))) {
				return true;
			}
		}
	}

	return false;
}
