# adonis-skills Web

技能目录 Web UI，基于 Next.js 构建。提供技能浏览、详情查看与一键安装命令复制功能。

本应用是 [adonis-skills](../../) monorepo 的一部分。

## 技术栈

- **框架**：Next.js 16 (App Router)
- **语言**：TypeScript 5
- **UI 库**：React 19
- **样式**：Tailwind CSS 4
- **字体**：Space Grotesk + IBM Plex Mono

## 本地开发

在 **monorepo 根目录**运行（推荐，通过 Turborepo 管理依赖任务）：

```bash
pnpm dev
```

或在本目录单独启动：

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看。

## 构建

```bash
# 在 monorepo 根目录
pnpm build
```

> `build` 任务依赖 `skills:validate` 和 `skills:index` 先完成，Turborepo 会自动处理顺序。

## 目录结构

```
apps/web/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 首页：技能列表
│   │   ├── layout.tsx            # 根布局（元数据、字体）
│   │   ├── globals.css           # 全局样式（CSS 变量）
│   │   ├── not-found.tsx         # 404 页面
│   │   └── skills/[slug]/
│   │       └── page.tsx          # 技能详情页（动态路由）
│   ├── components/
│   │   ├── skill-card.tsx        # 技能卡片组件
│   │   └── copy-install-command.tsx  # 复制安装命令按钮
│   ├── lib/
│   │   └── skills.ts             # 技能数据加载工具函数
│   └── generated/
│       └── skills-index.json     # 由脚本生成，勿手动编辑
└── public/                       # 静态资源
```

## 技能索引

`src/generated/skills-index.json` 由根目录脚本自动生成，不要手动编辑。

更新技能后，在 monorepo 根目录运行：

```bash
pnpm skills:index
```

