# Bundler Recipes

按框架/构建器选择可直接复制的 `code-inspector-plugin` 配置。默认策略是：

- 大多数方案设置 `needEnvInspector: true`
- 使用 `needEnvInspector: true` 时，在 `.env.local` 中启用：`CODE_INSPECTOR=true`
- 仅在开发环境启用

## 统一安装命令

```bash
pnpm add -D code-inspector-plugin
```

## Next.js

### Next.js <= 14.x（webpack）

```js
// next.config.js
const { codeInspectorPlugin } = require("code-inspector-plugin");

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      config.plugins.push(
        codeInspectorPlugin({
          bundler: "webpack",
          needEnvInspector: true,
        })
      );
    }
    return config;
  },
};

module.exports = nextConfig;
```

### Next.js 15.0.x ~ 15.2.x（experimental turbo）

```ts
// next.config.ts
import type { NextConfig } from "next";
import { codeInspectorPlugin } from "code-inspector-plugin";

const nextConfig: NextConfig = {
  experimental: {
    turbo: {
      rules: codeInspectorPlugin({
        bundler: "turbopack",
        needEnvInspector: true,
      }),
    },
  },
};

export default nextConfig;
```

### Next.js >= 15.3.x（包含 16，turbopack）

此为最小接入默认模板（alt-only，无 env 门控）。

```ts
// next.config.ts
import type { NextConfig } from "next";
import { codeInspectorPlugin } from "code-inspector-plugin";

const nextConfig: NextConfig = {
  turbopack: {
    rules: codeInspectorPlugin({
      bundler: "turbopack",
      hotKeys: ["altKey"],
    }),
  },
};

export default nextConfig;
```

### Next.js 异步配置（适配已有复杂插件链）

```ts
// next.config.ts
import type { NextConfig } from "next";

export default async function nextConfig() {
  const isDev = process.env.NODE_ENV === "development";
  let turbopack: NextConfig["turbopack"] | undefined;

  if (isDev) {
    const { codeInspectorPlugin } = await import("code-inspector-plugin");
    turbopack = {
      rules: codeInspectorPlugin({
        bundler: "turbopack",
        needEnvInspector: true,
      }),
    };
  }

  return {
    ...(turbopack ? { turbopack } : {}),
  } satisfies NextConfig;
}
```

## Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { codeInspectorPlugin } from "code-inspector-plugin";

export default defineConfig({
  plugins: [
    codeInspectorPlugin({
      bundler: "vite",
      needEnvInspector: true,
    }),
  ],
});
```

## Webpack

```js
// webpack.config.js
const { codeInspectorPlugin } = require("code-inspector-plugin");

module.exports = {
  plugins: [
    codeInspectorPlugin({
      bundler: "webpack",
      needEnvInspector: true,
    }),
  ],
};
```

## Rspack

```js
// rspack.config.js
const { codeInspectorPlugin } = require("code-inspector-plugin");

module.exports = {
  plugins: [
    codeInspectorPlugin({
      bundler: "rspack",
      needEnvInspector: true,
    }),
  ],
};
```

## Rsbuild

```js
// rsbuild.config.js
const { codeInspectorPlugin } = require("code-inspector-plugin");

module.exports = {
  tools: {
    rspack: {
      plugins: [
        codeInspectorPlugin({
          bundler: "rspack",
          needEnvInspector: true,
        }),
      ],
    },
  },
};
```

## Esbuild

```js
// esbuild.config.js
const esbuild = require("esbuild");
const { codeInspectorPlugin } = require("code-inspector-plugin");

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/main.js",
  plugins: [
    codeInspectorPlugin({
      bundler: "esbuild",
      dev: () => process.env.NODE_ENV === "development",
      needEnvInspector: true,
    }),
  ],
});
```

## Mako

```ts
// .umirc.ts
import { defineConfig } from "umi";
import { codeInspectorPlugin } from "code-inspector-plugin";

export default defineConfig({
  mako: {
    plugins: [
      codeInspectorPlugin({
        bundler: "mako",
        needEnvInspector: true,
      }),
    ],
  },
});
```

## Umi（webpack）

```ts
// .umirc.ts
import { defineConfig } from "umi";
import { codeInspectorPlugin } from "code-inspector-plugin";

export default defineConfig({
  chainWebpack(memo) {
    memo
      .plugin("code-inspector-plugin")
      .use(codeInspectorPlugin({ bundler: "webpack", needEnvInspector: true }));
  },
});
```

## Nuxt

### Nuxt 3.x

```ts
// nuxt.config.ts
import { codeInspectorPlugin } from "code-inspector-plugin";

export default defineNuxtConfig({
  vite: {
    plugins: [
      codeInspectorPlugin({ bundler: "vite", needEnvInspector: true }),
    ],
  },
});
```

### Nuxt 2.x

```js
// nuxt.config.js
import { codeInspectorPlugin } from "code-inspector-plugin";

export default {
  build: {
    extend(config) {
      config.plugins.push(
        codeInspectorPlugin({ bundler: "webpack", needEnvInspector: true })
      );
      return config;
    },
  },
};
```

## Astro

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import { codeInspectorPlugin } from "code-inspector-plugin";

export default defineConfig({
  vite: {
    plugins: [
      codeInspectorPlugin({
        bundler: "vite",
        needEnvInspector: true,
      }),
    ],
  },
});
```

## .env.local 示例

```env
CODE_INSPECTOR=true
```

## 最小验证步骤

```bash
pnpm dev
```

验证标准：

- 浏览器控制台出现 inspector 相关提示
- 按住组合键（默认 `Alt+Shift` 或 `Option+Shift`）时悬浮 DOM 有遮罩
- 点击后 IDE 跳到对应文件行列
