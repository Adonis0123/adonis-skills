# Global Modal System — Portability Guide

本系统设计为 UI 库无关、状态管理方案无关、框架无关。本文档说明如何适配到不同技术栈。

## 状态管理适配

### Zustand（默认）

模板直接使用 Zustand + Immer。无需额外适配。

```typescript
// store-slice.ts.tpl 直接可用
export const createUiSlice: StateCreator<
  GlobalStore,
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set, get) => ({ ... })
```

### Context + useReducer

将 slice 重写为 reducer：

```typescript
type ModalAction =
  | { type: 'OPEN_MODAL'; key: string; data?: GlobalModalData }
  | { type: 'CLOSE_MODAL'; key: string }

function modalReducer(state: UiSliceState, action: ModalAction): UiSliceState {
  switch (action.type) {
    case 'OPEN_MODAL': {
      const existing = state.openedGlobalModals.find((m) => m.key === action.key)
      if (existing) {
        return {
          ...state,
          openedGlobalModals: state.openedGlobalModals.map((m) =>
            m.key === action.key ? { ...m, data: action.data } : m
          ),
        }
      }
      return {
        ...state,
        openedGlobalModals: [...state.openedGlobalModals, { key: action.key, data: action.data }],
      }
    }
    case 'CLOSE_MODAL':
      return {
        ...state,
        openedGlobalModals: state.openedGlobalModals.filter((m) => m.key !== action.key),
      }
  }
}
```

Provider 提供 dispatch + state：

```typescript
const ModalContext = createContext<{
  state: UiSliceState
  dispatch: React.Dispatch<ModalAction>
} | null>(null)
```

hooks 从 Context 读取：

```typescript
function useGlobalModalState<T>(key: string) {
  const { state, dispatch } = useContext(ModalContext)!
  const target = state.openedGlobalModals.find((m) => m.key === key)
  return {
    open: !!target,
    data: target?.data as T,
    openModal: (data: T) => dispatch({ type: 'OPEN_MODAL', key, data }),
    closeModal: () => dispatch({ type: 'CLOSE_MODAL', key }),
  }
}
```

### Redux Toolkit

创建 modal slice：

```typescript
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

const modalSlice = createSlice({
  name: 'globalModals',
  initialState: { openedGlobalModals: [] },
  reducers: {
    openGlobalModal(state, action: PayloadAction<{ key: string; data?: GlobalModalData }>) {
      const existing = state.openedGlobalModals.find((m) => m.key === action.payload.key)
      if (existing) {
        existing.data = action.payload.data
      } else {
        state.openedGlobalModals.push(action.payload)
      }
    },
    closeGlobalModal(state, action: PayloadAction<string>) {
      state.openedGlobalModals = state.openedGlobalModals.filter(
        (m) => m.key !== action.payload,
      )
    },
  },
})
```

### Jotai

使用 atom 管理状态：

```typescript
import { atom, useAtom } from 'jotai'

const openedModalsAtom = atom<Array<{ key: string; data?: GlobalModalData }>>([])

function useGlobalModalState<T>(key: string) {
  const [modals, setModals] = useAtom(openedModalsAtom)
  const target = modals.find((m) => m.key === key)
  return {
    open: !!target,
    data: target?.data as T,
    openModal: (data: T) => setModals((prev) => [...prev, { key, data }]),
    closeModal: () => setModals((prev) => prev.filter((m) => m.key !== key)),
  }
}
```

## UI 库适配

### Ant Design

```typescript
import { Modal } from 'antd'

function GlobalBaseModal({ open, onCancel, width = 560, className, children }: GlobalBaseModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      width={width}
      footer={null}
      destroyOnClose
      className={className}
    >
      {children}
    </Modal>
  )
}
```

### Material UI

```typescript
import { Dialog, DialogContent } from '@mui/material'

function GlobalBaseModal({ open, onCancel, width = 560, className, children }: GlobalBaseModalProps) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth={false} className={className}>
      <DialogContent sx={{ width, p: 3 }}>
        {children}
      </DialogContent>
    </Dialog>
  )
}
```

### Radix UI / shadcn/ui

```typescript
import { Dialog, DialogContent, DialogOverlay } from '@radix-ui/react-dialog'

function GlobalBaseModal({ open, onCancel, width = 560, className, children }: GlobalBaseModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogOverlay className="fixed inset-0 bg-black/50" />
      <DialogContent
        className={cn('fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2', className)}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}
```

### Headless UI

```typescript
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'

function GlobalBaseModal({ open, onCancel, width = 560, className, children }: GlobalBaseModalProps) {
  return (
    <Transition show={open}>
      <Dialog onClose={onCancel} className="relative z-50">
        <TransitionChild>
          <div className="fixed inset-0 bg-black/30" />
        </TransitionChild>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild>
            <DialogPanel
              className={className}
              style={{ width: typeof width === 'number' ? `${width}px` : width }}
            >
              {children}
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  )
}
```

### 原生 HTML dialog

```typescript
function GlobalBaseModal({ open, onCancel, width = 560, className, children }: GlobalBaseModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal()
    } else {
      dialogRef.current?.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={className}
      style={{ width: typeof width === 'number' ? `${width}px` : width }}
      onClose={onCancel}
    >
      {children}
    </dialog>
  )
}
```

## 懒加载方式适配

### Next.js dynamic（默认）

```typescript
import dynamic from 'next/dynamic'

export const myExtension = defineGlobalModalExtension({
  key: 'my-modal',
  modal: dynamic(() => import('./components/MyModal')),
})
```

### React.lazy + Suspense

```typescript
import { lazy, Suspense } from 'react'

const LazyMyModal = lazy(() => import('./components/MyModal'))

// 在编排器中需要用 Suspense 包裹
<Suspense fallback={null}>
  <LazyMyModal />
</Suspense>
```

### Vue defineAsyncComponent

```typescript
import { defineAsyncComponent } from 'vue'

export const myExtension = defineGlobalModalExtension({
  key: 'my-modal',
  modal: defineAsyncComponent(() => import('./components/MyModal.vue')),
})
```

## 函数记忆化适配

### ahooks useMemoizedFn（默认）

```typescript
import { useMemoizedFn } from 'ahooks'

const openModal = useMemoizedFn((data) => {
  _openModal({ ...data, onOpen: ..., onClose: ... })
})
```

优势：无需 deps 数组，引用地址永久稳定。

### React useCallback

```typescript
import { useCallback } from 'react'

const openModal = useCallback((data) => {
  _openModal({ ...data, onOpen: ..., onClose: ... })
}, [_openModal])
```

注意：`_openModal` 来自 Zustand selector，通常是稳定引用，所以 deps 是安全的。

### 不使用记忆化

如果弹窗打开频率低、性能不敏感，可以直接使用普通函数：

```typescript
const openModal = (data) => {
  _openModal({ ...data, onOpen: ..., onClose: ... })
}
```

代价：每次渲染创建新函数引用，如果将 `openModal` 作为 prop 传递可能导致子组件不必要的重渲染。

## 全局事件桥适配

### createGlobalHandler（默认，基于 window Symbol）

```typescript
function createGlobalHandler<T extends (...args: any[]) => void>() {
  const key = Symbol('global-handler')
  const useMountHandler = (callback: T) => {
    useEffect(() => {
      (window as any)[key] = callback
      return () => { delete (window as any)[key] }
    }, [callback])
  }
  const callHandler = (...args: Parameters<T>) => {
    (window as any)[key]?.(...args)
  }
  return [useMountHandler, callHandler] as const
}
```

### CustomEvent

```typescript
const EVENT_NAME = 'open-my-modal'

// 注册监听
useEffect(() => {
  const handler = (e: CustomEvent) => openModal(e.detail)
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}, [openModal])

// 触发
window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ... } }))
```

### EventEmitter（Node.js 风格）

```typescript
import { EventEmitter } from 'events'
const modalEmitter = new EventEmitter()

// 注册
useEffect(() => {
  modalEmitter.on('open', openModal)
  return () => { modalEmitter.off('open', openModal) }
}, [openModal])

// 触发
modalEmitter.emit('open', { ... })
```

## 目录结构适配

### 标准结构（推荐）

```
pages/_blocks/global-modals/
├── _components/
│   ├── GlobalBaseModal/
│   └── GlobalModals/
└── _extensions/
    ├── _helpers/
    ├── index.ts
    └── [each-extension]/
```

### 扁平结构（小项目）

```
components/global-modals/
├── BaseModal.tsx
├── GlobalModals.tsx
├── helpers.ts
├── extensions.ts
└── modals/
    ├── confirm-delete/
    └── upgrade-plan/
```

### Feature 结构（大型项目）

```
features/global-modals/
├── core/
│   ├── store.ts
│   ├── hooks.ts
│   ├── types.ts
│   └── Orchestrator.tsx
├── base/
│   └── BaseModal.tsx
└── extensions/
    ├── registry.ts
    └── [each-extension]/
```

选择哪种结构取决于项目的目录约定和团队偏好。核心逻辑不变，只是文件位置和导入路径不同。
