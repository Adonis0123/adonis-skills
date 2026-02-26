# Store Patterns (Class-Based)

## Web Component Store

Class-based component-level store with Context + Provider.

Location pattern: `web/src/pages/_components/*/store/`

```ts
// index.ts
import { createStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { flattenActions } from './utils/flattenActions'
import type { StoreSetter } from './types'

export interface ToolListProps {
  initialTools?: Tool[]
}

export interface ToolListStoreState extends ToolListProps {
  toolList: Tool[]
  isLoading: boolean
}

export class ToolListActionImpl {
  readonly #set: StoreSetter<ToolListStoreState & ToolListStoreActions>
  readonly #get: () => ToolListStoreState & ToolListStoreActions

  constructor(
    set: StoreSetter<ToolListStoreState & ToolListStoreActions>,
    get: () => ToolListStoreState & ToolListStoreActions,
    _api?: unknown,
  ) {
    this.#set = set
    this.#get = get
  }

  setToolList = (toolList: Tool[]): void => {
    this.#set({ toolList })
  }

  addTool = (tool: Tool): void => {
    this.#set((state) => ({ toolList: [...state.toolList, tool] }))
  }
}

export type ToolListStoreActions = Pick<ToolListActionImpl, keyof ToolListActionImpl>

const initialState: ToolListStoreState = {
  toolList: [],
  isLoading: false,
}

export function createToolListStore(initProps?: Partial<ToolListProps>) {
  return createStore<ToolListStoreState & ToolListStoreActions>()(
    immer((...args) => ({
      ...initialState,
      ...initProps,
      ...flattenActions<ToolListStoreActions>([new ToolListActionImpl(...args)]),
    })),
  )
}

export type ToolListStore = ReturnType<typeof createToolListStore>
```

## Core Slice Store

Class-based slice store with `flattenActions` composition.

Location pattern: `packages/*/store/`

### Single Slice

```ts
// slices/core.ts
import type { StoreSetter } from '../types'

export interface CoreSliceState {
  agents: Agent[]
  selectedId: string | null
}

export class CoreActionImpl {
  readonly #set: StoreSetter<CoreSlice>
  readonly #get: () => CoreSlice

  constructor(set: StoreSetter<CoreSlice>, get: () => CoreSlice, _api?: unknown) {
    this.#set = set
    this.#get = get
  }

  selectAgent = (id: string): void => {
    this.#set({ selectedId: id })
  }

  getSelectedAgent = (): Agent | undefined => {
    const { agents, selectedId } = this.#get()
    return agents.find((a) => a.id === selectedId)
  }
}

export type CoreSliceAction = Pick<CoreActionImpl, keyof CoreActionImpl>
export type CoreSlice = CoreSliceState & CoreSliceAction

export interface CoreSliceConfig {
  initialState?: Partial<CoreSliceState>
}

export const createCoreSlice = (...args: [any, any, any]) =>
  new CoreActionImpl(...args)
```

```ts
// index.ts
import { createStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { flattenActions } from './utils/flattenActions'
import { createCoreSlice } from './slices/core'
import type { CoreSlice, CoreSliceAction, CoreSliceConfig } from './slices/core'

export type * from './slices/core'

export function createCoreAgentStore(config?: CoreSliceConfig) {
  return createStore<CoreSlice>()(
    immer((...args) => ({
      ...config?.initialState,
      ...flattenActions<CoreSliceAction>([createCoreSlice(...args)]),
    })),
  )
}

export type CoreAgentStoreApi = ReturnType<typeof createCoreAgentStore>
```

### Multiple Slices

```ts
// index.ts (multi-slice composition)
import { createStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { flattenActions } from './utils/flattenActions'
import { createAuthSlice } from './slices/auth'
import { createUserSlice } from './slices/user'
import type { AuthSlice, AuthSliceAction, AuthSliceConfig } from './slices/auth'
import type { UserSlice, UserSliceAction, UserSliceConfig } from './slices/user'

export type * from './slices/auth'
export type * from './slices/user'

export type AppStoreSlice = AuthSlice & UserSlice

export interface AppStoreSliceConfig {
  auth?: AuthSliceConfig
  user?: UserSliceConfig
}

export function createAppStoreStore(config?: AppStoreSliceConfig) {
  return createStore<AppStoreSlice>()(
    immer((...args) => ({
      ...config?.auth?.initialState,
      ...config?.user?.initialState,
      ...flattenActions<AuthSliceAction & UserSliceAction>([
        createAuthSlice(...args),
        createUserSlice(...args),
      ]),
    })),
  )
}

export type AppStoreStoreApi = ReturnType<typeof createAppStoreStore>
```
