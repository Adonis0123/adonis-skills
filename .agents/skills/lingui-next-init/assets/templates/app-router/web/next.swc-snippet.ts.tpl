import type { NextConfig } from "next";

export const linguiSwcSnippet: Pick<NextConfig, "experimental"> = {
	experimental: {
		swcPlugins: [["@lingui/swc-plugin", {}]],
	},
};
