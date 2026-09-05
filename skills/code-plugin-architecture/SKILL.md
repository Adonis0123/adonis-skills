---
name: code-plugin-architecture
description: >-
  Design, review, refactor, or explain recurring extension mechanisms when adding or removing one variant requires scattered coordinated edits. Use for plugin architecture, registries, extension points, and cross-stack contract/host mappings. Assess whether a typed map, existing framework mechanism, or lifecycle-owning core is justified. Skip one plugin's internal styling or bugs, user signup, DI containers, and package registries.
metadata:
  author: adonis
  version: "0.4.0"
---

# Code Plugin Architecture

让新增或移除一种变体所需的知识集中在清晰边界内。目标是减少真实的修改传播和回归，结构按问题选择。

## 先确定用户要什么

| 当前请求                 | 本轮产出与边界                                                         |
| ------------------------ | ---------------------------------------------------------------------- |
| 解释 / 命名 / 第一性原理 | 解释当前机制、取舍和反例；不创建实现、README 或评审工程                |
| 只读评审                 | 读取约定范围，报告当前伤害、证据和最小建议；不为验收删除插件或创建分支 |
| 设计                     | 给所需契约、落点、行为和验证方案；示例是建议，不声称已实现             |
| 实现 / 重构              | 检查工作树后修改授权范围，保留既有行为与标识，运行对应验证             |

解释、评审、设计不因加载本 skill 自动变成实现。已有授权继续有效；新增范围、外部动作、破坏性迁移仍需对应授权。用户只问一个变体的内部问题时，处理那个问题，不扩成机制改造。

默认只读本文件。仅当当前任务需要时加载对应引用，不用为一个简单问题读完案例库：

- 需要论证必要性、OCP / DIP / DDD 类比 → [references/first-principles.md](references/first-principles.md)。
- 需要检查具体反模式 → [references/anti-patterns.md](references/anti-patterns.md)。
- 有真实生命周期、订阅、缓存、异步加载或多账号状态 → [references/stateful-runtime.md](references/stateful-runtime.md)。
- 跨团队发布、第三方插件或版本兼容 → [references/governance.md](references/governance.md)。
- 要迁移到 Rust / Tauri / Python 或框架插件 API → [references/cross-stack.md](references/cross-stack.md)。
- 需要多站点、弹窗或工具目录的参考形状 → [references/case-studies.md](references/case-studies.md) 的相关案例；示意代码不是当前仓库证据。

## 从变化出发选择结构

先沿最近一次新增或移除变体的路径，读现有 key、消费方、配置和测试。区分“同一事实必须同步改多处”与“实现、测试、文案各有合法职责”。文件数量、变体数量或出现 switch 本身都不是重构证据。

检查能推翻方案的最便宜证据：真实变体是否共享输入、输出、生命周期；重复的是知识还是外观；现有框架是否已经提供所需扩展点。能从代码查到的事实先查。普通可逆工程默认值自行选择，只有影响产品偏好、难回退取舍、授权或用户独有事实的问题才询问。

| 当前复杂度                               | 合理起点                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| 少量稳定分支，变化不传播                 | 保留函数或 switch；不因未知的未来需求建插件系统                       |
| 同步静态条目，共享简单输入/输出          | 类型明确的映射或函数表；无需 store、Provider、factory、缓存或异步边界 |
| 多变体确实共享订阅、调度、资源或状态转换 | 提取拥有这些生命周期的 Core，变体提供窄契约；按需分目录               |
| 框架已有注册和生命周期机制               | 使用现有机制，只补业务所需的契约；不再复制一套 host                   |
| 第三方独立安装或动态发现                 | 先确认安装模型、兼容性与权限边界；静态注册无法自动满足这一要求        |

收益不成立时给出“保留现状”及证据。用户要求证明某种结构必然正确时，先检查前提，不制造证明。

## 五个概念，按需落地

Identity、Contract、Registry、Runtime Core、Convention Folder 是分析职责的词汇，不要求五个文件、五个模块或每次齐备。简单类型映射可以同时表达前三项；没有生命周期就无需独立 Core。目录负责组织实现，不决定架构是否成立。

1. **Identity**：沿用最权威的稳定 key 和兼容语义。外部供应商 ID、埋点名、已发布路由不应为了命名整齐被重命名；本地目录可保留显式映射。外部字符串先校验，再查注册表。
2. **Contract**：写清输入、输出、失败、生命周期和能力。Identity 只标识条目，不能替代行为契约。共享字段确实适用于全部变体才必填；可选字段有明确默认值；互斥能力用可辨识联合或不同契约，不为“结构同质”堆可选字段。
3. **Registry**：给“有哪些条目”一个可追溯的组合入口。显式表、框架 manifest 或由模块贡献并汇总的表均可；单一事实来源不等于只许一个物理文件。保留重复 key、未知 key 和缺失能力的既有处理。
4. **Runtime Core**：只抽出真实共享的调度与生命周期，依赖 Contract，不硬编码具体插件的业务条件。单插件条件归变体，跨插件产品顺序归编排层。没有共享状态时，普通调用函数就够。
5. **Convention Folder**：当单变体有多份相关资源时聚拢；简单条目留在一个文件也成立。依赖方向应让移除一个变体不破坏无关变体；不为消除所有直接 import 而引入总线。

最小静态例子只表达共同函数签名和可追溯的名单：

```ts
type Formatter = (value: string) => string;

const formatters = {
  upper: (value: string) => value.toUpperCase(),
  lower: (value: string) => value.toLowerCase(),
} satisfies Record<string, Formatter>;

type FormatterKey = keyof typeof formatters;

function format(key: FormatterKey, value: string): string {
  return formatters[key](value);
}
```

示例假定 key 已由类型内调用方提供。若 key 来自 URL、网络或用户输入，必须在边界校验并保留原有未知值错误；TypeScript 类型不能验证运行时输入。

## 条件式工程细节

- **延迟加载**：仅在加载成本和实际渲染路径支持收益时采用。它会引入等待、失败和首次使用延迟；保留 SSR、首屏与错误行为，不默认 `ssr: false`。用真实网络/产物证据确认收益，不凭 dynamic import 字样宣称成功。
- **命名与引导**：存在反复找落点的成本时，给一个添加条目的例子、简短命名映射或仓内已有生成器。占位符、README、脚手架不是插件化的必要条件。
- **调试能力**：优先复用已有日志、DevTools 或测试接口。只有实际诊断需要才增加开发环境探针；不默认暴露全局 store、用户数据或清缓存写入口。
- **有状态的机制**：登录/权限变化必须重算相关意图；订阅、定时器、资源和异步结果必须有明确 owner 与清理；缓存按实际用户/租户边界隔离。静态机制不需要添加这些状态。具体边界见 stateful runtime 引用。

## 实现与验证

1. 冻结本轮范围，说明要减少哪条修改传播以及保留哪些行为；不把纯命名整齐或新框架当目标。
2. 做一个最小、可回退的变体迁移，沿用既有 key、路由、持久化数据和错误契约；确认消费方不再重复同一判断后再移除旧路径。
3. 运行与变化对应的验证：静态表检查合法/未知 key 与已有输出；有状态的机制检查更新、卸载、重复挂载、失败和跨账号隔离；公共 UI 行为还需真实浏览器/渲染信号。

用隔离 fixture 或只读依赖图验证新增/移除条目的传播，不在用户工作区为了“验收”真的删插件。只有用户要求实现且改动有回归风险时补必要行为测试；解释和只读评审不生成测试工程。

检索只能定位候选：字段不同、存在 switch、静态 import 或缺占位符都不能单独判失败。构建/typecheck 不能替代运行时清理、UI 加载或账号切换验收。未跑的必需验证写 `UNVERIFIED`。

## 交付

只交付用户要求的模式：解释给结论与必要例子；评审给证据、影响与最小修法；设计给适用边界、契约与验证；实现给修改和实际结果。迁移路径、目录树、README、调试探针仅在当前改造确实需要时提供，不固定凑齐产物。
