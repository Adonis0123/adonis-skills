# tokens.json 格式

`scripts/check_tokens.py` 读这份格式。一个文件放完整个设计系统，所有主题共用同一组角色名。

```jsonc
{
  "scales": {                       // 共用色阶，每条浅、深各 12 阶（Radix 式：1–2 背景，3–5 组件底，6–8 边框，9–10 实色，11–12 文字）
    "neutral": { "light": ["#…", …12], "dark": ["#…", …12] },   // 必有
    "amber":   { "light": [...], "dark": [...] }                 // 其他色阶按需加，引用名是 {amber-11}
  },
  "functional": { "success": "#…", "warning": "#…", "danger": "#…", "info": "#…" },  // 引用名 {fn-success}
  "themes": {                       // 每套主题只换界面强调色
    "<主题 id>": {
      "name": "显示名",
      "scale": { "light": [12 阶], "dark": [12 阶] },          // 引用名 {accent-1} … {accent-12}
      "solid": "#…",                // 主按钮底，引用名 {accent-solid}
      "solid-foreground": "#…"      // 主按钮字，引用名 {accent-solid-foreground}
    }
  },
  "roles": {                        // 语义角色，名字用 shadcn 的成对写法
    "light": { "background": "{neutral-2}", "primary": "{accent-solid}", "selected": "color-mix(in srgb, {accent-9} 12%, {card})", … },
    "dark":  { … 同一组键 … }
  },
  "type": { … }, "radius": { … }, "space": { … }
}
```

## 引用规则

- `{名字}` 先在色阶、功能色、当前主题里找，找不到再找同一模式下的其他角色（例如 `{card}`）。
- `{accent-*}` 按当前主题解析，所以角色表只写一份，每套主题自动套用。
- 半透明叠色只写 `color-mix(in srgb, X p%, Y)`，`Y` 可以是 `transparent`。检查脚本能把这种写法算成实色，再测对比度。

## 检查脚本测哪些对比度

| 文字                          | 底                               | 最低                    |
| ----------------------------- | -------------------------------- | ----------------------- |
| `foreground`                  | `background`、`card`、`selected` | 4.5                     |
| `muted-foreground`            | `background`、`card`             | 4.5                     |
| `primary-foreground`          | `primary`                        | 4.5                     |
| `link`                        | `card`                           | 4.5                     |
| `accent-foreground`           | `accent`                         | 4.5                     |
| `nav-active-foreground`       | `nav-active` 叠在 `sidebar` 上   | 4.5                     |
| `warning-text`、`danger-text` | `card`                           | 4.5                     |
| `subtle-foreground`           | `card`                           | 3.0（只给占位符和提示） |

缺这些角色时脚本会报错。不需要某个角色的设计系统，把对应行从脚本的 `PAIRS` 里删掉。
