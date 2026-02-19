{
	"name": "{{I18N_PACKAGE_NAME}}",
	"version": "0.0.0",
	"private": true,
	"type": "module",
	"main": "./src/index.ts",
	"types": "./src/index.ts",
	"exports": {
		".": "./src/index.ts",
		"./data": "./src/data.ts",
		"./next-config": "./src/next-config.ts",
		"./lingui-config": "./src/lingui-config.ts"
	},
	"scripts": {
		"check": "biome check .",
		"check:unsafe": "biome check --write --unsafe .",
		"check:write": "biome check --write .",
		"typecheck": "tsc --noEmit"
	},
	"devDependencies": {
		"@lingui/conf": "^5.9.0",
		"typescript": "^5.7.0"
	}
}
