# Troubleshooting

用于排查 `code-inspector-plugin` 接入后“不生效、跳错、打不开 IDE”等问题。遵循从高概率到低概率的顺序。

## 快速排查顺序

1. 确认运行环境：是否处于 dev（不是 build/start 产物）。
2. 确认开关：`.env.local` 是否有 `CODE_INSPECTOR=true`（在 `needEnvInspector: true` 时必须）。
3. 确认组合键：是否与系统/输入法快捷键冲突。
4. 确认 IDE 启动方式：`launchType`、`openIn`、`editor` 是否匹配当前 IDE。
5. 确认路径注入与映射：`include/exclude`、`mappings` 是否过严或错误。
6. 确认端口：inspector server 端口是否冲突。

## 症状对照表

| 症状 | 高概率原因 | 检查点 | 处理建议 |
| --- | --- | --- | --- |
| 按快捷键没有遮罩 | 快捷键冲突 / 插件未启用 | 看控制台提示；检查 `hotKeys` | 改成 `['metaKey','shiftKey']` 或其他组合 |
| 有遮罩但点击不跳 IDE | IDE 启动配置不匹配 | 检查 `launchType`、`openIn`、`editor` | 默认先用 `launchType: 'exec'` |
| 跳转到了错误文件 | 路径映射不正确 | 检查 `mappings` 规则与实际路径 | 先移除 `mappings` 验证，再逐条加回 |
| 某些组件无法定位 | 编译过滤过严 | 检查 `include/exclude` | 放宽匹配范围再逐步收敛 |
| `.env.local` 已配置但不生效 | 环境文件未加载或拼写错误 | 检查变量名、重启 dev server | 确保键为 `CODE_INSPECTOR=true` |
| 偶发失败或无响应 | server 端口冲突 | 查看是否有端口占用 | 显式设置 `port` 为未占用端口 |

## WebStorm / JetBrains 专项

- 优先使用 `launchType: 'exec'`，跨平台更稳定。
- 若在 macOS 且验证编辑器支持 URL Scheme，可尝试 `launchType: 'open'` 提升速度。
- 如果系统存在多个 JetBrains 安装，优先固定 `editor`，避免自动探测到错误实例。

示例：

```ts
codeInspectorPlugin({
  bundler: "vite",
  needEnvInspector: true,
  launchType: "exec",
  openIn: "reuse",
});
```

## 端口冲突处理

```ts
codeInspectorPlugin({
  bundler: "turbopack",
  needEnvInspector: true,
  port: 5688,
});
```

## 最小回归用例

每次调整配置后都执行：

1. 重启 dev server。
2. 打开任意包含 React/Vue 组件的页面。
3. 按组合键悬浮并点击至少两个不同层级的 DOM。
4. 确认 IDE 跳转文件路径和行列号都正确。

## 回滚模板

如需临时回滚到无插件状态：

1. 移除配置文件中的 `codeInspectorPlugin(...)`。
2. 从 `package.json` 删除 `code-inspector-plugin`。
3. 删除 `.env.local` 中 `CODE_INSPECTOR=true`。
4. 重启 dev server 并确认页面无 inspector 注入行为。
