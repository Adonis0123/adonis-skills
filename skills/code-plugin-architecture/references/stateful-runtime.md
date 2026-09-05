# Stateful Runtime

只在多个变体确实共享生命周期、调度、异步加载或状态时读本页。这里把较复杂弹窗/工具机制的边界展开；纯同步映射无需增加这些部件。

## 目录与契约

一种可用形状，沿现有仓库约定调整，不逐项照搬：

```text
plugins/
├── contract.ts          # Shared inputs, outcomes, lifecycle
├── registry.ts          # Composition and duplicate-key handling
├── runtime.ts           # Shared resource ownership and dispatch
└── survey/
    ├── definition.ts    # Variant-specific policy and configuration
    └── view.tsx         # UI only when this variant renders UI
```

Contract 按真实能力表达：纯渲染、同步命令、异步订阅不必强装成同一组字段。确有统一调度需求时可用可辨识联合；不要让无 UI 的插件填写空 component，也不要为静态条目增加假的 `init` / `dispose`。

有资源的 `start` 应交回 cleanup 或等价的所有权句柄。跨插件产品顺序由编排层表达；不要让插件读取另一个插件的私有 store，也不要因此默认引入 event bus。普通函数参数往往足够。

## 状态、重算与清理

| 事件                          | 必须保持的可观察结果                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| 同一 owner 重复挂载           | 订阅和定时器不翻倍，初始化副作用不重复                                     |
| 登录、权限、AB 或远程开关变化 | 依赖这些输入的 eligibility 重算，不能被首次注册的幂等短路吃掉              |
| 切换账号/租户                 | 旧 owner 的工作失效，关闭计数、已读标记与缓存不串给新 owner                |
| 旧异步请求晚返回              | 不覆盖当前 owner/上下文的状态；取消不可用时仍检查请求序号或 owner identity |
| 卸载、替换或初始化失败        | 释放已取得的订阅、定时器、连接和临时资源；迟到结果不再写回                 |
| 加载或执行失败                | 保留明确的错误结果、清理和已约定的重试路径                                 |

把“注册有哪些实现”与“当前上下文是否启用”分开通常更清楚。既有 `force` 接口可用，但它只是重算的一种实现；不能靠反复 force 注册叠加监听。账号缓存键按现有身份边界设计，不把原始用户标识或完整 store 暴露到诊断输出。

同一配置应有明确权威来源；如果确有运行时 override，写明覆盖优先级和失效时机。不能因为同名属性出现在两处就自动删掉合法覆盖。

## 加载与 UI

先核对项目框架版本、SSR 边界和真实加载路径。React `lazy` 在首次渲染时加载，并需要等待和失败处理；它不是“定义后永远不进 bundle”。Next 的 dynamic import 也不自动证明首屏变快。不要默认关闭 SSR、把当前同步交互改成空白等待，或为了一个小图标增加网络请求。

静态注册表可以只引用一个稳定的加载函数。避免在 render 中重建 lazy component 或在每次状态变化时重新注册资源。保留现有 skeleton、错误边界和首次点击语义。

验证至少覆盖当前改动涉及的路径：

- 首次使用前后实际请求/渲染是否符合预期；已挂载但隐藏的 UI 仍可能触发加载。
- 失败和恢复时是否保留用户操作状态。
- 从账号 A 切到 B 后，A 的延迟返回是否被丢弃。
- mount → update → dispose → mount 后，活跃订阅数量和副作用次数是否正确。

## 可选开发体验

多处接入常出错时可补一个添加条目的例子或仓内生成器。已有可靠落点时不再添加占位符约定。需要诊断时复用现有工具，开发环境探针应最小且可清理；不把全局可写 store 当交付要求。

## Sources

- [React lazy](https://react.dev/reference/react/lazy) — first-render loading, Suspense and rejection handling.
- [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading) — framework-specific loading and SSR constraints; check the project's installed version before implementation.
