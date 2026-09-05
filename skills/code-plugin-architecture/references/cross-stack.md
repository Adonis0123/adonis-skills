# 跨技术栈映射

用本页定位不同栈的职责，不把它们当成同一套 API。先核对项目版本和现有扩展机制；用户只要解释时，不创建框架、安装包或生成应用。

## 对照

| 技术栈              | Identity / Contract                      | 组合入口与生命周期                                         |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| React / Web         | 应用 key；类型明确的函数或组件能力       | 普通映射或已有 Provider；只有共享状态才提取 Core           |
| Rust 内部扩展       | 稳定 key；trait 或明确函数签名           | 显式构造、框架注册或链接期收集；按资源需求管理 owner       |
| Python entry points | entry point name；host 约定的 protocol   | group 提供发现命名空间，选择具体 entry point 后加载        |
| Tauri               | 插件名称、命令标识；Tauri 插件与命令接口 | 现有 Builder / lifecycle；业务内部扩展可使用普通 Rust 模块 |
| Webpack / Vite      | 使用各自框架的插件接口                   | 配置中的 plugins 与框架 hooks；不要发明共享的 apply 签名   |

Identity 标识一项，Contract 规定能力；发现、加载和权限是三个不同问题。无需让每个概念都落成独立模块。

## Python：发现不等于按需加载

```toml
[project.entry-points."myapp.plugins"]
csv_loader = "myplugin.csv:CSVLoader"
```

`csv_loader` 是 name，`myapp.plugins` 是 group。先查 metadata 可以知道有哪些条目；调用某个 entry point 的 `load()` 才解析其对象。如果对所有条目循环 `load()`，就是在该时刻加载全部条目，并非“只加载用户需要的一个”。内部静态扩展若不需要安装后发现，直接用函数表更便宜。

接口与版本用 [Python importlib.metadata](https://docs.python.org/3/library/importlib.metadata.html) 核对。

## Rust / Tauri：先确定安装模型

| 真实需求                             | 起点                                                 | 不能冒充的能力                          |
| ------------------------------------ | ---------------------------------------------------- | --------------------------------------- |
| 所有实现在 workspace，与应用一起构建 | 显式静态组合；有异构调用需求时用 trait               | 用户在应用发布后安装新的原生 crate      |
| 多个内部 crate 想减少中心列表冲突    | 评估链接期收集与构建约束                             | 不经重编译发现任意第三方实现            |
| 用户确需独立安装第三方扩展           | 先设计插件格式、稳定边界、版本、权限、隔离与失败恢复 | 给静态表加 feature 就声称支持运行时安装 |

[Cargo features](https://doc.rust-lang.org/cargo/reference/features.html) 控制条件编译和可选依赖；不是运行时 lazy loading。`Box<dyn Trait>` 是动态分派，也不等于动态装载。使用 `libloading` / `dlopen` 时不能假设 Rust trait object 的 ABI 跨构建稳定；需要明确兼容策略，例如受限 C ABI 或隔离进程协议，并验证实际边界。

Tauri 已有插件生命周期与命令权限。是否把多个 connector 包成一个 Tauri plugin，取决于发布、权限和生命周期边界；内部模块、单个插件或多个插件都可能合理。不要为了套五层强制包装，也不要把 capabilities 当作代码加载机制。实现前查看 [Tauri Plugin Development](https://v2.tauri.app/develop/plugins/) 并匹配项目版本。

## 构建工具：复用实际框架契约

[Webpack plugins](https://webpack.js.org/concepts/plugins/) 使用插件对象与 compiler 接口；[Vite Plugin API](https://vite.dev/guide/api-plugin) 使用其插件对象及相应 hooks。相似的“注册 + 生命周期”不是相同的调用签名。解释时可类比职责，写代码时必须使用所选工具版本的准确接口。

VSCode 等已有贡献机制的宿主也按同样原则处理：先识别是整个 extension 还是内部 command/view，再使用已有 manifest 和激活路径，不叠加一套虚构 host。

## AI 插件与协议扩展

Claude Code 的 plugins / skills 可以类比“名称、发现入口与宿主执行契约”，但散文指令不是编译期类型保证。确认当前宿主支持的 manifest 与目录，再讨论包装；不要因目录存在就声称已安装或可调用。

MCP 的工具 schema 与协议消息可以表达 Contract；连接后发现的工具表与生态级 server 目录是不同层次。它不要求宿主拥有每个 server 的 Convention Folder。发现、schema 合法、认证成功和真实工具执行分别验证；目录清单不证明目标动作已获授权。

这些类比保留“职责可由不同机制承担”的结论；具体 API、协议版本和权限语义按本次宿主官方文档核实。涉及第三方执行时继续读 [governance.md](governance.md)。
