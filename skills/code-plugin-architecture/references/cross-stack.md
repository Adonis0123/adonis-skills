# 跨技术栈应用 — 这套模式在哪里都成立

## 目录

- 同构对照表（React / VSCode / Webpack / Express / Tailwind / Rust / Python / Tauri / OBS）
- 几个最容易混淆的对照（Python entry_points · Rust+Tauri 三形态 · VSCode 两层 · Webpack/Vite · Tailwind 被动注册）
- AI 生态（2025–2026）：Claude Code plugins 与 MCP
- 2025–2026 框架插件面变化速览（Vite 8 / Next 16 / Tauri v2）
- 怎么用这份对照表 · 一个深层观察

---

"代码插件化"不是 React 特有的，不是前端特有的，不是 TypeScript 特有的。**所有有"扩展点"概念的成熟系统，本质上都是这套模式的实例**。

了解这些跨栈对照能帮你：
- 在不熟悉的技术栈里快速识别"啊这就是 X 那套"。
- 把同事/AI 在某栈学到的经验直接搬到另一栈。
- 避免在已经有强约定插件机制的框架里"再造一层"。

## 同构对照表

**重要：本表把"Identity / Contract / Registry / Runtime Core / Convention Folder + Lazy Loading"五件套 + Lazy Loading 都分开列。**不要把 Identity 和 Contract 混在一起、也不要把 Registry 和 Lazy Loading 混。这是新手映射时最容易踩的坑。

| 模式部件 | React/Web | VSCode Extension | Webpack/Vite | Express/Koa | Tailwind CSS | Rust (内部 crate plugin) | Python (entry_points) | Tauri v2 | OBS Studio |
|---|---|---|---|---|---|---|---|---|---|
| **Identity** | configKey / appKey | extension: `publisher.name`；contribution: command id | plugin name | route path / middleware name | plugin name | crate name + 公开 const PLUGIN_KEY | entry point **name**（`csv_loader`）；group 是命名空间 | Tauri plugin name + invoke command id | filter id |
| **Contract** | TS interface | `package.json` 的 `contributes.commands[]` schema + activate 函数签名 | Webpack 的 `Plugin` interface（`apply(compiler)`） | `(req, res, next) => void` middleware signature | plugin function `({ addUtilities, theme }) => void` | trait（如 `trait Connector`） | Python protocol / abstract base class | `tauri::plugin::Plugin` trait | OBS source / filter / encoder C API |
| **Registry** | `Record<key, config>` | `package.json` 的 `contributes` 字段（声明） + Extension Host 的运行时表 | `webpack.config.js` 的 `plugins: []` | `app.use(...)` 调用栈 | `plugins: [...]` 在 tailwind.config.js | `Cargo.toml` workspace 成员 + 主 crate 的 `register_all()` 显式调用链 | entry point **group**（命名空间，如 `myapp.plugins`） + 包 metadata 自动收集 | `tauri::Builder::default().plugin(...)` 调用链 | `obs_register_source` 调用 + module manifest |
| **Runtime Core** | core slice / Provider | VSCode Extension Host runtime | Webpack compiler hooks | Express middleware chain | Tailwind plugin context API | host crate（持有 `Vec<Box<dyn Trait>>` + 调度 lifecycle） | importlib / 应用自己的注册逻辑 | Tauri runtime + State<T> | OBS plugin loader |
| **Convention Folder** | `popups/[Name]/` | extension 独立 npm 包 | 单独的 plugin npm 包 | 单独的 middleware 文件 | `tailwind/plugin-foo.js` | workspace member crate（`crates/plugin-foo/`） | distribution 包（如 `mypkg-csv-loader`） | `tauri-plugin-foo/` workspace member | 一个 .so 文件 |
| **Lazy loading** | `dynamic()` / `lazy()` | `activationEvents` 触发 + JIT 加载 | code splitting / dynamic import | lazy require | （无，编译期固定） | cargo `features` 编译期开关 + 可选 `dlopen` 运行时加载 | importlib.lazy + 按需 `ep.load()` | Tauri capability gating + 按命令注册 | runtime loader |

## 几个最容易混淆的对照

下面把第一版对照里几个**容易混层级**的栈单独抠出来精确化。

### Python entry_points — Identity vs Registry namespace

```toml
# 插件包的 pyproject.toml
[project.entry-points."myapp.plugins"]  # ← "myapp.plugins" 是 Registry namespace（group）
csv_loader = "myplugin.csv:CSVLoader"   # ← "csv_loader" 是 Identity（name）
```

```python
# Host 应用
from importlib.metadata import entry_points
for ep in entry_points(group='myapp.plugins'):  # ← 按 namespace 查询
    plugin_id = ep.name                          # ← Identity
    plugin_class = ep.load()                     # ← lazy loading
    register(plugin_class())
```

- **Identity = entry point name**（`csv_loader`）—— 这是单个插件的身份。
- **Registry namespace = entry point group**（`myapp.plugins`）—— 这是"我这个 host 应用接受哪一类插件"的命名空间。
- **Contract** = Python protocol / ABC — host 期望插件实现的接口。
- **Lazy loading** = `ep.load()` 是真正的按需 import — namespace 里有 100 个插件不代表都被加载。

特点：
- Registry **从 metadata 自动收集**，host 不需要预先知道哪些 plugin 在场——适合**用户自由 pip install 第三方扩展**的场景。
- 不适合"插件作者也是 host 维护者"的场景——多此一举，直接用 Record 注册表更轻。

---

### Rust + Tauri — 三种 Registry 形态决策

Rust 上 "插件" 的含义跨度很大，常见三种：

**形态 A：编译期静态注册（workspace 内开发）**
- **Identity** = crate name 或 crate 内 `pub const PLUGIN_KEY: &str`
- **Contract** = `trait Plugin { fn key(&self) -> &str; fn init(&self, ctx: &mut Ctx); }`
- **Registry** = 主 crate 中显式列出：
  ```rust
  let plugins: Vec<Box<dyn Plugin>> = vec![
      Box::new(plugin_csv::CsvPlugin::default()),
      Box::new(plugin_sqlite::SqlitePlugin::default()),
      // [Plugin-Placeholder]:(register)
  ];
  ```
- **Lazy loading** = cargo `features` 编译期开关（`#[cfg(feature = "plugin-sqlite")]`）。**用 features 而不是 `Box<dyn>` 是常见误解** —— `Box<dyn>` 是 Contract 的事，不是 lazy loading 的事。
- **场景**：插件作者就是 host 维护者，所有 plugin 在 workspace 里。

**形态 B：编译期分散注册（distributed inventory）**
- 用 `inventory` 或 `linkme` crate 让每个插件 crate 自己 `submit!` 注册。
- **Registry 形状**：concept 上仍是单一表，但物理上分散在多个 crate。主 crate 调 `inventory::iter::<PluginRef>` 收集。
- **场景**：workspace 大，想避免主 crate 的 `register_all()` 列表变成 merge 冲突热点。

**形态 C：运行时动态加载**
- `libloading` / `dlopen` 加载第三方 .so/.dll。
- **巨大风险**：Rust ABI 不稳定，不同 rustc 版本编译的 `Box<dyn Trait>` 不能跨 boundary。要用 `abi_stable` 或 C ABI 包装。
- **场景**：真正需要第三方独立发布插件、用户自主安装的场景。如果不是这种场景，**形态 C 永远不该是首选**。

**Tauri 自带 Plugin 系统的关系**：
- `tauri::Builder::default().plugin(...)` 链是 Tauri 提供的 Registry —— 适合发布给整个 Tauri 生态的横切扩展（窗口管理、文件系统、菜单）。
- 你**业务领域的扩展**（如本案例里的 "数据源 connector"）应当**包成一个 Tauri Plugin**，再在里面自建本 skill 描述的五件套，而不是让每个 connector 都是独立的 Tauri Plugin —— 后者会让粒度过细、扩展点失焦。

---

### VSCode Extension — 两层 Identity 拆开看

VSCode 让人混淆的原因：它**既是**一个"extension as plugin"系统（每个 extension 是 host 视角的一个插件），**又是**一个"contribution as plugin"系统（每个 extension 内可以贡献多个 command / view / menu）。

| 层级 | Identity | Contract | Registry | Convention |
|---|---|---|---|---|
| **Extension-as-plugin**（VSCode 看 extension） | `publisher.extensionName` | `package.json` 顶层（engines / activationEvents / main） | VSCode marketplace + 用户已装 extension 列表 | 独立 npm 包 |
| **Contribution-as-plugin**（extension 看自己的扩展点） | command id / view id（如 `myExt.helloWorld`） | `package.json` 的 `contributes.commands[]` schema | extension `package.json` 的 `contributes` 字段 | extension 内部目录 |

两层都是合法的"插件机制"——只是颗粒度不同。**讨论 VSCode 映射时一定要先问清楚是哪一层**。

类比到一个真实项目（前面案例研究里那个多站点 AI 视频 SaaS）：
- 整个 web 应用整体 = 一个 VSCode extension（host 视角）。
- 项目里的 "Extension Apps" = 这个 extension 贡献的 commands（内部扩展点）。

---

### Webpack/Vite Plugin — Contract 是函数还是对象？

历史上 Webpack Plugin 有过演变：
- 早期：`new MyPlugin().apply(compiler)` 的对象形态。
- 后来：`plugins: [new MyPlugin()]` 配置数组形态。
- Vite：`plugins: [vue(), tailwind()]` 函数式 + 配置注入。

但万变不离：
- **Contract** = `{ name: string, apply(compiler/server): void }`（或它的扩展）。
- **Registry** = config 文件里的 plugins 数组。
- **Runtime Core** = compiler 的 tapable hooks（Webpack）/ Rollup-compat lifecycle（Vite）。

如果你在为自己的构建工具加插件机制——直接抄 Webpack 的 tapable 或 Vite 的 hook 设计，不要发明新模式，开发者已经熟悉这套了。

---

### Tailwind plugin — "被动注册"的代表

Tailwind plugin 是这套模式的一个**变种**：

```js
// plugin function
function myPlugin({ addUtilities, theme, e }) {
  addUtilities({ '.my-class': { ... } })
}
```

它和"注册表 + Core 主动调用"不同——Core (Tailwind generator) 提供一组 helper API 给每个插件，插件在被调用时**贡献内容**而不是被查询。

这种"被动式注册"适合：
- 每次构建/运行时 Core 主导节奏，需要**收集**插件的贡献。
- 插件本身不持有状态，是"声明 + 贡献"的形态。

如果你的需求更适合"被动式"，可以参考 Tailwind 的实现思路。本 skill 主线讲的是"主动式注册"（component map），两种是互补不是冲突。

---

## AI 生态（2025–2026）：Claude Code plugins 与 MCP

AI agent 工具链是五件套最新、也最教科书级的应用场——但两个代表系统的映射质量不同，诚实标注不匹配点比硬套更有用。

### Claude Code plugins / skills — 目前最强的现实实例

| 模式部件 | 落地 |
|---|---|
| **Identity** | plugin.json / SKILL.md frontmatter 的 `name`（manifest 可省——名字从目录名推导，即"主键派生命名"的反向应用） |
| **Contract** | manifest schema + 每类组件的 frontmatter 约定（skills 要 `name`/`description`，hooks 要 hooks.json） |
| **Registry** | marketplace.json（生态级）+ 本地已装插件清单 |
| **Runtime Core** | Claude Code loader——对插件内容零知识，只按约定装载 |
| **Convention Folder** | `commands/`、`agents/`、`skills/<name>/` 自动发现，删插件 = 删目录 |

**不匹配点（重要）**：Contract 的主体是"供 LLM 消费的散文 + frontmatter"，不是编译期接口——没有 typecheck 强约束，行为合规靠模型理解而非类型系统。这是"Contract 可以是函数、类型、也可以是文档约定"的极端例子。

### MCP（Model Context Protocol）

- **Identity** = tool name / registry 里 reverse-DNS 式 server name；**Contract** = `tools/list` 返回的 JSON Schema（`inputSchema`/`outputSchema`）+ 协议消息类型；**Registry** = 两层——生态级官方 MCP Registry（server.json 元数据）+ 客户端连接时经 `tools/list` 构建的运行时工具表；**Runtime Core** = MCP host/client，只讲协议、零业务。
- **不匹配点**：没有 Convention Folder——server 是独立进程、经网络发现而非目录扫描；registry 是动态协议中介（连接时枚举、`listChanged` 通知、`initialize` 版本协商），比本方法论的静态清单更接近**完整 Microkernel**。
- 顺带：OpenAI ChatGPT apps 就是 MCP server（Apps SDK），但其"registry"是人工审核的提交门户，与开放注册精神不同；Vercel AI SDK 的 `tools: {...}` 是**每次请求临时组装**的 record——刻意不做中央注册表，也是一种合法取舍。

## 2025–2026 框架插件面变化速览

- **Vite 8（Rolldown 独占）**：打包引擎从 Rollup 换成 Rust 实现的 Rolldown，但 Rollup 风格插件 API 被刻意保留（`this.meta.rolldownVersion` 探测、`moduleType` 约定）——**Core 整个换掉而 Contract 不动**，五件套依赖方向（`Plugin → Contract ← Core`）价值的最佳现实证明。
- **Next.js 15/16**：依然没有官方插件 API；Next 16 起 Turbopack 默认、自定义 webpack 配置不加 `--webpack` 直接构建失败——事实上的扩展面（改 webpack config）正在被关闭。在 Next 里建业务扩展点，别指望框架层，自建五件套。
- **Tauri v2 capabilities**：插件自带命名 permission，应用在 `src-tauri/capabilities/` 里按窗口授权。这暴露了五件套未覆盖的**第六关注点：声明式作用域授权**（Core 和 Plugin 之间不止"契约"还有"权限"）——治理层展开见 [governance.md](governance.md)。

---

## 怎么用这份对照表

**作为类比工具**：用户在某栈里熟、不熟另一栈时，告诉他"X 栈里的 Y 就是你熟的 Z"——比从零讲一遍快十倍。

**作为决策参考**：要建插件机制时，先问"这个栈/框架里已经有什么？"。如果是 Next.js pages、VSCode extension、Tauri plugin——顺着用，不要造第二套。

**作为去框架化训练**：把这套模式抽象到具体框架之上——技术栈变了，模式不变。这是为什么这个 skill 不绑定任何项目/语言/框架。

---

## 一个深层观察

为什么这套模式在如此不同的技术栈里都成立？

因为它解决的根本问题是**怎么管理"会持续新增的同类东西"**——这个问题与编程语言无关，与 web 还是后端无关，与编译型还是解释型无关。任何"会持续新增的同类东西"都有：

- 命名 → Identity
- 协议 → Contract
- 名单 → Registry
- 通用规则 → Runtime Core
- 单条目自治 → Convention Folder

外加视场景而定的 **Lazy Loading**（前端运行时 / 编译期 features / dlopen）。

这是抽象，不是技术选型。掌握这个抽象，再去任何新栈/新场景，你都能在 30 分钟内识别清楚架构是否健康。
