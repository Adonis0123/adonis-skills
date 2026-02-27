---
name: global-modal-scaffold
description: >-
  This skill should be used when the user asks to "create a global modal",
  "add a new modal extension", "scaffold a modal plugin", "add a global dialog",
  "create a modal with callbacks", "set up a global modal system",
  or mentions the global-modals extension system.
metadata:
  version: "0.1.0"
---

# Global Modal Scaffold

插件化全局弹窗系统：基于 Zustand 状态管理 + 扩展注册表 + 懒加载 + 完整类型安全。

## 概述

该系统将全局弹窗抽象为**扩展（Extension）**，每个扩展包含：
- **key** — 唯一标识符（字符串字面量，自动推导为联合类型）
- **modal** — 懒加载的弹窗组件
- **useMountCallbacks?** — 可选的挂载回调（用于全局事件桥接）

核心能力：
- Zustand store slice 管理 `openedGlobalModals` 数组，支持多弹窗并发
- `useGlobalModalState<T>(key)` 泛型 hook 提供 `{ open, data, openModal, closeModal }`
- `onOpen(isFirstOpen)` / `onClose()` 生命周期回调
- `ExtensionKey` 从扩展数组自动推导，新增扩展时类型自动更新
- BaseModal 接口与 UI 库解耦，可适配任意组件库

## 两种工作流程

### 流程一：初始化基础设施（首次搭建）

当项目中尚无全局弹窗系统时使用。读取 `templates/infrastructure/` 下所有 `.tpl` 模板，根据项目技术栈适配后生成基础设施文件。

**步骤：**

1. **询问用户技术栈** — UI 库（Ant Design / Material UI / Headless UI / shadcn 等）、状态管理（Zustand / Redux / Context）、懒加载方式（next/dynamic / React.lazy）、函数记忆化（ahooks useMemoizedFn / useCallback）
2. **确定目标目录** — 建议 `src/pages/_blocks/global-modals/` 或用户指定路径
3. **生成基础设施文件**：
   - 从 `store-slice.ts.tpl` 生成 store slice（需集成到用户的全局 store）
   - 从 `store-hooks.ts.tpl` 生成通用 hooks
   - 从 `helpers.ts.tpl` 生成 `defineGlobalModalExtension` + 类型
   - 从 `orchestrator.tsx.tpl` 生成 GlobalModals 编排器
   - 从 `base-modal.tsx.tpl` 生成 BaseModal 组件（适配用户选择的 UI 库）
4. **创建 extensions 注册表** — 空的 `extensions` 数组 + `ExtensionKey` 类型导出
5. **在布局组件中挂载** — 指导用户将 `<GlobalModals />` 放置在全局 Layout 底部

**生成的目录结构：**
```
global-modals/
├── _components/
│   ├── GlobalBaseModal/index.tsx    # BaseModal 组件
│   └── GlobalModals/index.tsx       # 编排器
└── _extensions/
    ├── _helpers/index.ts            # defineGlobalModalExtension + types
    └── index.ts                     # extensions 数组 + ExtensionKey
```

### 流程二：新增弹窗扩展（已有基础设施）

当项目已有全局弹窗基础设施，需要新增一个弹窗时使用。

**步骤：**

1. **确认扩展模式** — 询问用户需要 basic / enriched / with-callbacks
2. **获取弹窗名称** — 如 `confirm-delete`，自动派生 `ConfirmDelete`（PascalCase）和 `confirmDelete`（camelCase）
3. **创建扩展目录** — `_extensions/{{KEBAB_NAME}}/`
4. **从对应模式模板生成文件** — 替换所有占位符
5. **注册扩展** — 在 `_extensions/index.ts` 的 extensions 数组中导入并添加新扩展
6. **实现具体 UI** — 在 modal-component 中填充业务 UI

## 三种扩展模式

| 模式 | 适用场景 | 文件数 | 特有能力 |
|------|---------|--------|---------|
| **basic** | 简单展示弹窗（确认框、信息展示） | 3 | 无 |
| **enriched** | 需要 onOpen/onClose 副作用（analytics、URL 重写） | 3 | openModal 包装注入生命周期 |
| **with-callbacks** | 需要从非 React 代码触发弹窗（tRPC 错误拦截等） | 4 | useMountCallbacks + 全局事件桥 |

## 模板占位符说明

所有 `.tpl` 模板使用以下占位符，生成时按规则替换：

| 占位符 | 规则 | 示例（输入 `confirm-delete`） |
|--------|------|------|
| `{{PASCAL_NAME}}` | PascalCase | `ConfirmDelete` |
| `{{KEBAB_NAME}}` | kebab-case | `confirm-delete` |
| `{{CAMEL_NAME}}` | camelCase | `confirmDelete` |

基础设施模板额外占位符：

| 占位符 | 说明 |
|--------|------|
| `{{STORE_TYPE}}` | 全局 store 类型名（如 `GlobalStore`） |
| `{{EXTENSION_KEY_TYPE}}` | ExtensionKey 类型的导入路径 |
| `{{EXTENSIONS_IMPORT_PATH}}` | extensions 数组的导入路径 |
| `{{BASE_MODAL_IMPORT}}` | BaseModal 组件的导入路径 |
| `{{MODAL_STATE_HOOK_IMPORT}}` | useGlobalModalState 的导入路径 |

## 命名约定

- **扩展目录**: `kebab-case`（如 `confirm-delete/`）
- **extension 变量**: `camelCase` + `GlobalModalExtension` 后缀（如 `confirmDeleteGlobalModalExtension`）
- **hook 函数**: `use` + `PascalCase` + `GlobalModalState`（如 `useConfirmDeleteGlobalModalState`）
- **Modal 组件**: `PascalCase` + `Modal`（如 `ConfirmDeleteModal`）
- **key 字符串**: `kebab-case`（如 `'confirm-delete'`）

## 关键设计约定

1. **懒加载** — 所有 modal 组件必须使用 dynamic import 包装，避免主包体积膨胀
2. **GlobalModalCoreData** — 所有弹窗数据接口都应继承 `GlobalModalCoreData`（包含 `onClose`、`onOpen` 回调）
3. **destroyOnClose** — BaseModal 建议默认开启销毁模式，确保每次打开时状态干净
4. **isFirstOpen** — `onOpen(isFirstOpen)` 区分首次打开和重复打开，用于控制只触发一次的副作用（如 analytics）
5. **useMountCallbacks 无条件调用** — 编排器中必须无条件遍历所有扩展调用 `useMountCallbacks`，确保 React Hooks 调用顺序稳定
6. **稳定函数引用** — enriched 模式的 hook 包装应使用 `useMemoizedFn`（ahooks）或 `useCallback` 确保引用地址稳定

## 适配说明

本 skill 设计为 UI 库无关、状态管理方案无关。BaseModal 模板仅定义接口，需适配到用户实际使用的组件库。详见 `references/portability.md`。

## 模板文件位置

```
templates/
├── infrastructure/          # 基础设施模板（流程一使用）
│   ├── store-slice.ts.tpl
│   ├── store-hooks.ts.tpl
│   ├── orchestrator.tsx.tpl
│   ├── base-modal.tsx.tpl
│   └── helpers.ts.tpl
└── extensions/              # 扩展模板（流程二使用）
    ├── basic/
    │   ├── extension.ts.tpl
    │   ├── hooks.ts.tpl
    │   └── modal-component.tsx.tpl
    ├── enriched/
    │   ├── extension.ts.tpl
    │   ├── hooks.ts.tpl
    │   └── modal-component.tsx.tpl
    └── with-callbacks/
        ├── extension.tsx.tpl
        ├── hooks.ts.tpl
        ├── callbacks.ts.tpl
        └── modal-component.tsx.tpl
```

## 参考文档

- `references/architecture.md` — 深度架构解析（store 设计、编排器原理、类型系统、生命周期）
- `references/portability.md` — 不同技术栈适配指南（UI 库、状态管理、框架、代码风格）
