# 反模式 — 8 种最常见的"伪插件化"

代码评审 / PR review 时按以下八条扫一遍。**多数命中说明这套机制没真正插件化**，扩展性是假的，3 个月后会还债。

每条都给：症状（怎么看出来）、问题（为什么不好）、修法（具体怎么改）、**严重度**。

**严重度标签说明**：
- 🔴 **Must-fix** — 架构层硬错误，留着等同于没有插件化。
- 🟡 **Smell** — 不一定立刻坏，但暗示设计走形，2~3 次扩展后会显化。
- 🔵 **Context-dependent** — 在某些场景（前端 / 用户面 / 多团队协作）必修，在其他场景（后端内部、CLI、小规模团队）可放宽。

---

## 1. 注册表里有 if-else / switch（🔴 Must-fix）

**症状**：
```ts
const config = {
  modalA: { component: ModalA },
  modalB: { component: ModalB },
}

function renderModal(key) {
  if (key === 'modalA') {
    return <ModalA specialProp={...} />  // ← 这里
  }
  return <config[key].component />
}
```

**问题**：注册表的承诺是"所有条目结构同质"。一旦出现"只针对 X 的特殊处理"，下一个插件作者要么也加一条 if，要么因为不知道这条 if 而踩坑。

**修法**：让 specialProp 进入 Contract 类型本身（变成可选字段），由注册表条目声明而不是消费方判断。或者把这个"特殊"从机制里拎出去——它根本不是这个插件机制的一部分。

**判定边界**：在 Provider/Orchestrator 的**渲染层**（不是 Core 状态机）做一次 `if (key === 'X')` 注入插件特有 prop（如真实项目里 NPS Survey 弹窗注入 `surveyType`）是**可接受的**——只要这种特判 ≤ 1 个、且加了 TODO "如果再出现第二个就升 Contract"。出现第二个特判时必须升级 Contract。

---

## 2. Core Factory 里 import 了具体插件（🔴 Must-fix）

**症状**：
```ts
// core/factory.ts
import { NPSConfig } from '../popups/NpsSurveyModal/config'  // ← 这里
import { NpsSurveyModal } from '../popups/NpsSurveyModal'

export function createStore() {
  if (key === NPSConfig.key) { ... }
}
```

**问题**：内核反向依赖具体实现，就不能称为"通用内核"。**删除一个插件需要改内核**——彻底失败。

**修法**：通过泛型 + 注册表反向注入。内核不能知道任何具体 key 字符串，所有差异通过 Contract 字段表达。

**Check method**: `grep -rE "import.*from.*plugins/" core/` 应为空。

---

## 3. 同一属性双写（🟡 Smell）

**症状**：
```ts
// config.ts
{ cache: { type: 'count', count: 2 } }

// init.ts
init({ open: true, key: 'foo', cache: { type: 'interval', timeout: 1 } })  // ← 这里
```

**问题**：两处定义同一个东西，迟早不一致。读代码时也要打开两个文件交叉对比才能搞清楚最终行为。

**修法**：约定"cache 只在 config 定义"。或者干脆从 init 的类型里把 cache 字段去掉。

**真实情况注脚**：如 case-studies.md 所述，实践中常见某些 banner 的 `init.ts` 仍存在 cache 双写——这是历史债，不是要复制的范例。新插件应避免。

---

## 4. 单插件目录有反向依赖（🔴 Must-fix）

**症状**：
```ts
// popups/ModalA/init.ts
import { useModalBState } from '../ModalB/store'  // ← 这里：A 直接看 B
```

**问题**：删 ModalB 就崩 ModalA。两个插件耦合，违反 Convention Folder 的自治原则。"加新插件 = 新建目录 + 注册一行"的承诺破产。

**修法**：插件间不允许直接 import，所有跨插件通信通过 Core 暴露的 API（store 订阅、event bus）。如果两个插件耦合到必须互相知道——它们本质上是一个插件，合并。

**Check method**: `grep -rE "from '[.]+/[A-Z][a-zA-Z]+(/|'|$)'" plugins/<each-plugin>/` 在每个插件目录内应只命中自身。

---

## 5. 没有延迟加载（🔵 Context-dependent）

**症状**：注册表直接 import 实现：
```ts
import NpsSurveyModal from './NpsSurveyModal'
import VideoToVideoPluginModal from './VideoToVideoPluginModal'
// ...20 个 modal 全部静态 import

export const config = {
  npsSurveyModal: { component: NpsSurveyModal },
  // ...
}
```

**问题**：每加一个插件都让首屏 bundle 涨一点。100 个用户里 99 个看不到的弹窗也被打进了主 chunk。

**修法**：所有 component 字段用 `dynamic()` / `lazy()` 包一层。集中在 `dynamics.ts` 维护，注册表只引用 `Dynamic*` 名字。

**怎么验证修没修对**：不能只看代码 — 必须看 Network panel 或 bundle analyzer 的真实分包，确认每个插件实现是单独 chunk。

**为什么 Context-dependent**：
- 🔴 必修：前端用户面 web app、首屏关键场景、移动端低带宽。
- 🟡 应修：admin / 内部工具的次要页面。
- ⚪️ 可省：后端内部模块、CLI 工具、Rust 编译型项目（compile-time `features` 已做了等效事）、桌面应用（一次性安装）。

---

## 6. 命名漂移（🟡 Smell）

**症状**：
```
configKey:        'promo'
组件名:          PromoModalV2
文件夹:          src/modals/promo-pop/
埋点 widgetName: promoPopup
data-banner-name: promo_pop_v2
hook 名:          useShowPromo
```

**问题**：六个名字六种规则。半年后没人能写脚本"找出所有 promo 相关代码"。重命名一处忘了同步其他几处，bug 静默累积。

**修法**：在 README 里写一张明确的命名推导表（见主 SKILL.md 的"命名推导表"小节）。每个新插件按表填名。一致到能写 codegen 脚本批量生成。

**Check method**: 写一个推导脚本，从 key 推全部命名 → 对照仓库实际文件名/常量名/埋点名。CI 上可以挂这个脚本作为 lint。

---

## 7. 业务知识漏到 Core（🔴 Must-fix）

**症状**：
```ts
// core/factory.ts
function shouldOpen(key, user) {
  if (key === 'npsSurveyModal') {
    return user.signupDays > 7 && user.hasUsedFeature  // ← 业务逻辑
  }
  // ...
}
```

**问题**：每加一个新弹窗都要回 Core 加一条业务逻辑。所谓的 "Core" 实际上是个 god object，所有插件的展示规则都在那里。

**修法**：把 "应不应该显示" 的判断完全交给单插件的 `init.ts`：
```ts
// popups/NpsSurveyModal/init.ts
export const useNpsSurveyModalInit = () => {
  const user = useUser()
  const init = useStore((s) => s.init)
  useEffect(() => {
    init({
      key: 'npsSurveyModal',
      open: user.signupDays > 7 && user.hasUsedFeature,
    })
  }, [user, init])
}
```

Core 只负责"接受 open / 不 open 这个信号 → 走缓存策略 → 决定最终是否显示"，业务"什么算合格"的标准由单插件回答。

**判定边界**：**横切同质的副作用**（"所有插件打开都要埋一次曝光"）写在 Core subscribe 里**不算业务漏出**——它是机制的一部分。区分线：能不能在 Core 里说出这条规则**对每一个插件都成立**？能 → 横切，是 Core 的事；不能 → 业务，是单插件的事。

---

## 8. 没有占位符引导 / onboarding 文档（🔵 Context-dependent）

**症状**：
- 加新插件要 grep 老代码、复制 4 个文件、人肉对照 5 处改动。
- 新人问"加一个新工具要改哪些文件"没有清晰回答。
- 现有 README 写的是"插件原理"而不是"加新插件的 5 步"。

**问题**：插件化的承诺是"机械操作"。如果加新插件还需要脑力推理，那不是插件化，是"散装"。

**修法**：
- 在中央注册表里加注释占位符 `// [PluginKey-Placeholder]:(import)` / `// [PluginKey-Config]:(entry)`，明确每处插入点。
- 在 README 写"加一个新 X 的 N 步"，每步是一个具体动作。
- 复杂插件给一个最小骨架可复制粘贴。
- 如果你能写一个 scaffold 脚本生成所有这些文件——更好，但占位符 + 文档已经是最低标准。

**为什么 Context-dependent**：占位符 + onboarding 是**工程体验问题**，不是架构对错。**小团队 / 一两个人独占维护**的代码可以不做（自己看一眼就知道改哪），但多团队协作或开源项目里必须做。架构层 OK 的代码即使没有占位符也还是真插件化，只是用起来累。

---

## 怎么用这份清单

**作为 PR 检查**：每条 1 分钟，过一遍就行。命中 Must-fix 必须打回；命中 Smell 在 PR 描述里要求解释；Context-dependent 看场景。

**作为重构起点**：从命中 Must-fix 的开始改。修 #2（Core 反向依赖）和 #4（插件反向依赖）通常解锁最大空间。

**作为新建机制的双向校验**：写完 Core factory 后回头对照——"我的 Core 是不是 import 了任何具体插件？"。**自己问自己**比 review 时被人问出来便宜得多。

---

## 一个综合反例

下面是一段集八种反模式于一身的代码，能识别出全部 8 条问题的人基本就掌握了这套方法论。每个反模式在代码里都用 `// ← #N` 锚点标记（不依赖行号——更稳健）。

```ts
// modals/index.ts — 中央"注册表"
import { NPSModal } from './NPSModal'                              // ← #5: 静态 import 进 bundle
import { CheckInModal } from './CheckInModal'

export const modals = {
  nps: {
    component: NPSModal,
    priority: 1,
    cache: { type: 'count', count: 3 },                            // ← #3a: cache 这里写一份
  },
  'check-in': {
    component: CheckInModal,
    customClose: true,                                              // ← #1: 字段不同质（只 check-in 有）
  },
}

// 命名（散落各处，无 README 推导表）：
//   组件名 NPSModal / key 'nps' / 埋点 NPS_MODAL_NAME / data-name 'nps-popup'   // ← #6: 命名漂移
// 末尾无占位符注释，也没有 "添加新弹窗的 N 步" 文档                              // ← #8: 无占位符/onboarding
```

```ts
// modals/core.ts — 所谓的 "core"
import { NPSModal } from './NPSModal'                              // ← #2: Core 反向 import 具体插件
import { specialNpsTracker } from './NPSModal/tracking'            // ← #2: 同上

export function shouldShowModal(key: string, user: User) {
  if (key === 'nps') {                                             // ← #1b + #7: Core 里 key 字符串特判 + 业务逻辑
    if (user.signupDays > 7) {                                     // ← #7: signupDays 是 NPS 弹窗的业务知识，泄漏到 Core
      specialNpsTracker.fire()                                     // ← #7: 同上
      return modals.nps
    }
  }
  if (key === 'check-in') {                                        // ← #1b: 同上特判分支
    const npsState = useStore((s) => s.npsOpen)                    // ← #4: check-in 反向依赖 nps 的 store 状态
    if (!npsState) return modals['check-in']
  }
  return null
}
```

```ts
// modals/NPSModal/init.ts
export const useNpsInit = () => {
  const init = useStore((s) => s.init)
  useEffect(() => {
    init({
      key: 'nps',
      cache: { type: 'count', count: 5 },                          // ← #3b: cache 又写一份（且与 modals/index.ts 的 count: 3 不一致）
    })
  }, [init])
}
```

```tsx
// modals/NPSModal/index.tsx
export const NPSModal = () => {                                    // ← #5: 没有 dynamic() / lazy() 包裹
  return <Modal>...</Modal>
}
```

**自检**：你能不能在代码里看到每个 `// ← #N` 锚点，并说出它为什么是反模式？

参考答案（按反模式编号）：
- `#1` 字段不同质 → `modals/index.ts` 注册表里 `customClose: true` 只有 `check-in` 有；`#1b` 变体 → `modals/core.ts` 的 `shouldShowModal` 里 `if (key === 'nps')` / `if (key === 'check-in')` 的特判分支
- `#2` Core 反向依赖 → `modals/core.ts` 顶部 `import { NPSModal }` 和 `import { specialNpsTracker }` 两行
- `#3` cache 双写 → `modals/index.ts` 注册表里 `cache: { count: 3 }`（锚点 `#3a`）与 `modals/NPSModal/init.ts` 里 `cache: { count: 5 }`（锚点 `#3b`）**两处定义且值不一致**
- `#4` 跨插件反向依赖 → `modals/core.ts` 里 `useStore((s) => s.npsOpen)` —— check-in 必须知道 nps 是否打开
- `#5` 无 lazy loading → `modals/index.ts` 顶部静态 import + `modals/NPSModal/index.tsx` 直接 export 组件（未 `dynamic()` 包裹）
- `#6` 命名漂移 → `modals/index.ts` 底部注释中的四种规则（`NPSModal` / `'nps'` / `NPS_MODAL_NAME` / `'nps-popup'`）
- `#7` 业务漏到 Core → `modals/core.ts` 的 `shouldShowModal` 里 `user.signupDays > 7` 这种 NPS-specific 判断 + `specialNpsTracker.fire()` 调用
- `#8` 无占位符 / onboarding → `modals/index.ts` 底部注释明确写出"末尾无占位符注释，无 onboarding 文档"
