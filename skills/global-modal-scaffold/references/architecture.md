# Global Modal System — Architecture Deep Dive

## 概述

插件化全局弹窗系统采用**扩展注册表**模式，将每个弹窗封装为独立的扩展插件。核心架构由四层组成：

1. **Store Layer** — Zustand slice 管理弹窗状态
2. **Extension Layer** — 定义和注册弹窗扩展
3. **Orchestrator Layer** — 编排器组件渲染活跃弹窗
4. **Modal Layer** — 各扩展的具体弹窗组件

## Store Slice 完整解剖

### 数据结构

```typescript
openedGlobalModals: Array<{
  key: ExtensionKey  // 字面量联合类型
  data?: GlobalModalData  // 核心回调 + 扩展数据
}>
```

选择数组而非 Map/Record 的原因：
- **有序性** — 弹窗打开顺序即 z-index 顺序
- **多弹窗并发** — 天然支持同时打开多个不同 key 的弹窗
- **Immer 友好** — 数组的 push/filter 操作在 Immer 中简单直观

### openGlobalModal 行为

```
调用 openGlobalModal(key, data)
│
├── 弹窗已在 openedGlobalModals 中？
│   ├── YES → 更新 data → 调用 data.onOpen(false)
│   └── NO  → push { key, data } → 调用 data.onOpen(true)
```

`isFirstOpen` 参数的设计意图：
- `true`（首次打开）— 适合触发一次性副作用（analytics、URL 重写）
- `false`（重复打开）— 适合更新弹窗内容而不重复触发副作用

### closeGlobalModal 行为

```
调用 closeGlobalModal(key)
│
├── 在数组中找到目标弹窗
├── 调用 data.onClose()
└── 从数组中 filter 移除
```

注意：`onClose` 在移除之前调用，确保回调能访问到当前 data。

### Immer 中间件

使用 Immer 的好处：
- `state.ui.openedGlobalModals.push(...)` — 直接可变写法，Immer 自动生成不可变更新
- `existing.data = data` — 直接赋值更新嵌套对象
- 避免手动展开嵌套对象（`...state, ui: { ...state.ui, openedGlobalModals: [...] }`）

## ExtensionKey 类型系统

### 类型推导链

```typescript
// 1. 定义扩展时，key 是字符串字面量
defineGlobalModalExtension({ key: 'confirm-delete', ... })
// TypeScript 推导: { key: 'confirm-delete', ... }

// 2. extensions 数组使用 as const
export const extensions = [ext1, ext2, ext3] as const
// TypeScript 推导: readonly [typeof ext1, typeof ext2, typeof ext3]

// 3. 提取 key 值数组
export const extensionKeys = extensions.map((e) => e.key)
// TypeScript 推导: ('confirm-delete' | 'upgrade-plan' | ...)[]

// 4. TupleToUnion 生成联合类型
export type ExtensionKey = TupleToUnion<typeof extensionKeys>
// 结果: 'confirm-delete' | 'upgrade-plan' | ...
```

### defineGlobalModalExtension 的 const 泛型

```typescript
function defineGlobalModalExtension<const T extends GlobalModalExtension>(config: T) {
  return config
}
```

`const` 泛型参数（TypeScript 5.0+）确保 `key` 被推导为字符串字面量而非 `string`。没有 `const`，所有 key 都会被拓宽为 `string`，类型安全就失效了。

### 好处

- **零维护** — 新增扩展只需添加到 extensions 数组，ExtensionKey 自动更新
- **编译时检查** — 传入不存在的 key 到 `openGlobalModal` 会报类型错误
- **IDE 补全** — 使用 key 时有自动补全提示

## GlobalModals 编排器工作原理

### 渲染流程

```
GlobalModals 组件渲染
│
├── 1. 读取 openedGlobalModals（响应式）
│
├── 2. 遍历 ALL extensions（无条件）
│   ├── 有 useMountCallbacks → 调用它
│   └── 无 useMountCallbacks → 调用空函数
│
└── 3. 遍历 ALL extensions（条件渲染）
    ├── key 在 openedModals 中 → 渲染 <ModalComponent />
    └── key 不在 openedModals 中 → return null
```

### 为什么 useMountCallbacks 必须无条件调用？

React Hooks 规则要求组件每次渲染时的 Hook 调用顺序和数量必须一致。如果用 `if` 包裹 `useMountCallbacks`：

```typescript
// 错误！Hook 调用数量不稳定
extensions.forEach((item) => {
  if (openedModals.includes(item.key)) {  // ← 条件判断
    item.useMountCallbacks?.()  // ← Hook 调用数量随 openedModals 变化
  }
})
```

正确做法：

```typescript
// 正确！每次渲染都调用相同数量的 hooks
extensions.map((item) => {
  if ('useMountCallbacks' in item) {
    item.useMountCallbacks()  // 无条件调用
  }
  return useDefaultMountCallbacks()  // 占位 hook，保持数量一致
})
```

### 挂载位置

编排器作为全局单例挂载在应用 Layout 底部：

```tsx
// Layout.tsx
function DefaultLayout({ children }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
      <GlobalModals />  {/* ← 全局弹窗编排器 */}
    </>
  )
}
```

## 生命周期流程图

### 弹窗打开 → 使用 → 关闭的完整生命周期

```
用户代码调用 openModal(data)
│
├── enriched hook 层注入 onOpen/onClose
│   ├── data.onOpen = 用户 onOpen + 副作用（analytics/URL）
│   └── data.onClose = 用户 onClose + 副作用（恢复 URL）
│
├── store.openGlobalModal(key, enhancedData)
│   ├── push 到 openedGlobalModals 数组
│   └── 调用 enhancedData.onOpen(true)
│       ├── 用户的 onOpen 回调
│       └── analytics 事件/URL 重写等
│
├── GlobalModals 编排器重新渲染
│   └── 找到 key 匹配 → 渲染 <ModalComponent />
│       └── 懒加载 chunk → 首次渲染弹窗
│
├── 用户在弹窗中交互...
│
├── 调用 closeModal()
│   └── store.closeGlobalModal(key)
│       ├── 调用 enhancedData.onClose()
│       │   ├── 用户的 onClose 回调
│       │   └── URL 恢复等
│       └── 从 openedGlobalModals 中移除
│
└── GlobalModals 编排器重新渲染
    └── key 不在 openedModals 中 → return null
        └── destroyOnClose → DOM 完全销毁
```

### 全局事件桥触发流程（with-callbacks）

```
非 React 代码（如 tRPC 错误拦截器）
│
├── callOpenXxxHandler()  ← 调用 window 上注册的全局函数
│
├── window[Symbol] 指向 useMountCallbacks 中注册的回调
│   └── 回调内部调用 openModal(defaultData)
│
└── 后续流程同上（store → 编排器 → 渲染）
```

## 多弹窗并发支持

由于 `openedGlobalModals` 是数组，天然支持同时打开多个弹窗：

```typescript
// 同时打开三个弹窗
openGlobalModal('confirm-delete', { ... })
openGlobalModal('upgrade-plan', { ... })
openGlobalModal('contact-us', { ... })

// openedGlobalModals = [
//   { key: 'confirm-delete', data: {...} },
//   { key: 'upgrade-plan', data: {...} },
//   { key: 'contact-us', data: {...} },
// ]
```

关闭其中一个不影响其他：

```typescript
closeGlobalModal('upgrade-plan')
// openedGlobalModals = [
//   { key: 'confirm-delete', data: {...} },
//   { key: 'contact-us', data: {...} },
// ]
```

## 与 nice-modal-react 等方案的对比

| 维度 | 本系统 | nice-modal-react | React Modal Provider |
|------|--------|-------------------|---------------------|
| **状态管理** | Zustand slice（与全局 store 集成） | 独立 Context + 内部 store | Context + useReducer |
| **类型安全** | ExtensionKey 自动推导 | 手动 ID 字符串 | 泛型但需手动注册 |
| **懒加载** | 原生 dynamic import | 无内建支持 | 无内建支持 |
| **生命周期** | onOpen(isFirstOpen)/onClose | Promise API (resolve/reject) | 无 |
| **全局事件桥** | useMountCallbacks + createGlobalHandler | 无 | 无 |
| **扩展性** | 目录级别的插件结构 | 组件级别注册 | 组件级别 |
| **学习成本** | 中等（需理解扩展模式） | 低（Promise API 直观） | 低 |

**本系统优势**：与项目 store 深度集成、完整的类型安全、目录级代码组织、全局事件桥。

**nice-modal-react 优势**：Promise API 更适合确认弹窗场景（`await modal.show()`）、更低的学习门槛。

## useGlobalModalState 泛型 Hook 设计

```typescript
function useGlobalModalState<T extends GlobalModalData | unknown = unknown>(key: ExtensionKey) {
  // ...
  return {
    open: !!target,
    data: target?.data as T extends GlobalModalData ? T : undefined,
    openModal: (data: T extends GlobalModalData ? T : undefined) => { ... },
    closeModal: () => { ... },
  }
}
```

### 条件类型 `T extends GlobalModalData ? T : undefined`

- 当调用方传入具体类型 `useGlobalModalState<MyModalData>(key)` 时，`data` 和 `openModal` 参数都是 `MyModalData`
- 当不传泛型时（默认 `unknown`），`data` 是 `undefined`，强制调用方创建类型化的包装 hook

### 为什么不直接使用而要包装？

```typescript
// 不推荐：类型信息在组件中散落
const { data } = useGlobalModalState<MyData>('my-modal')

// 推荐：包装 hook 集中管理类型
function useMyModalGlobalModalState() {
  return useGlobalModalState<MyData>('my-modal')
}
// 使用时无需关心类型细节
const { data } = useMyModalGlobalModalState()
```

好处：
- 类型定义集中在扩展的 hooks 文件中
- 组件代码更简洁
- 修改数据类型只需改一处
