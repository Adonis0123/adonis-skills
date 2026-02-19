{
	"scripts": {
		"i18n:extract": "lingui extract-experimental",
		"i18n:compile": "lingui compile",
		"i18n:manifest": "node --import tsx ./scripts/i18n/manifest.ts",
		"i18n:sync": "node --import tsx ./scripts/i18n/sync.ts",
		"i18n:bootstrap": "node --import tsx ./scripts/i18n/bootstrap.ts",
		"i18n": "node --import tsx ./scripts/i18n/cli.ts",
		"i18n:translate": "node --import tsx ./scripts/i18n/translate.ts"
	},
	"dependencies": {
		"@lingui/macro": "^5.9.0"
	},
	"devDependencies": {
		"@lingui/cli": "^5.9.0",
		"@lingui/conf": "^5.9.0",
		"@lingui/core": "^5.9.0",
		"@lingui/react": "^5.9.0",
		"@lingui/swc-plugin": "^5.10.1",
		"tsx": "^4.21.0"
	}
}
