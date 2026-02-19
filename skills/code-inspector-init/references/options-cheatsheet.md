# Options Cheatsheet

以下是 `code-inspector-plugin` 迁移时最常用的可选项。若用户没有明确要求，优先保持默认配置，只开启 `needEnvInspector`。

## 快速示例

```ts
codeInspectorPlugin({
  bundler: "turbopack",
  needEnvInspector: true,
  hotKeys: ["metaKey", "shiftKey"],
  hideConsole: true,
});
```

## 参数矩阵

| Option | 推荐默认值 | 何时改 | 风险提示 |
| --- | --- | --- | --- |
| `needEnvInspector` | `true` | 需要通过 `.env.local` 明确开关 | 设为 `false` 时，开发环境可能默认直接开启 |
| `hotKeys` | `['altKey', 'shiftKey']` | 需要改为 `Command+Shift` 或避免系统快捷键冲突 | 组合键冲突会导致“看起来没生效” |
| `hideConsole` | `false` | 控制台提示太多、团队希望静默 | 提示隐藏后，新成员不易发现触发方式 |
| `openIn` | `'auto'` | 想强制复用 IDE 窗口（`reuse`）或新开（`new`） | 不同 IDE 下行为差异较大 |
| `launchType` | `'exec'` | macOS 且目标编辑器支持 URL Scheme 时可用 `'open'` | `open` 在非支持编辑器上会失效 |
| `include` / `exclude` | 不设置 | 想限制编译范围或排除噪音文件 | 配置过窄会导致某些组件无法定位 |
| `mappings` | 不设置 | 需要把 `node_modules` 映射回源码仓库路径 | 映射错误会跳错文件或行号 |
| `pathType` | `'absolute'` | 希望 DOM 中显示相对路径时改为 `'relative'` | 相对路径在多工作区下可能不唯一 |
| `skipSnippets` | 不设置 | 明确要跳过某些注入片段 | 对 Next.js/Nuxt 不建议跳过 `console`，对 MPA 不建议跳过 `htmlScript` |

## 常见定制片段

### 1) Command + Shift + 隐藏控制台提示

```ts
codeInspectorPlugin({
  bundler: "vite",
  needEnvInspector: true,
  hotKeys: ["metaKey", "shiftKey"],
  hideConsole: true,
});
```

### 2) 只编译 src + 排除测试文件

```ts
codeInspectorPlugin({
  bundler: "webpack",
  needEnvInspector: true,
  include: /src\//,
  exclude: [/\.test\./, /\.spec\./],
});
```

### 3) node_modules 路径映射

```ts
codeInspectorPlugin({
  bundler: "turbopack",
  needEnvInspector: true,
  mappings: [
    {
      find: /.*node_modules\/my-ui-lib\/dist\/(.*)$/,
      replacement: "/Users/you/workspace/my-ui-lib/src/$1",
    },
  ],
});
```

## 选择原则

- 先让默认方案跑通，再做高级定制。
- 每次只改一个 option，改完立即验证。
- 遇到“能显示遮罩但跳转不准”，优先检查 `mappings` 与 `include/exclude`。
