# Store Patterns (Repo)

## Web Component Store
Use these files as the reference shape for component-level stores.
- `web/src/pages/_components/ToolList/store/index.ts`
- `web/src/pages/_components/ToolList/store/context.ts`
- `web/src/pages/_components/ToolList/store/provider.tsx`
- `web/src/pages/_components/Inspiration/store/index.ts`
- `web/src/pages/_components/Inspiration/store/context.ts`
- `web/src/pages/_components/Inspiration/store/provider.tsx`

Example excerpts:
```ts
export function createToolListStore(initProps?: Partial<ToolListProps>) {
  return createStore<ToolListStoreState & ToolListStoreActions>()(immer((set) => ({
    ...initialState,
    ...initProps,
    setToolList: (toolList) => {
      set({ toolList })
    },
  })))
}
```

```ts
export const ToolListContext = createContext<ToolListStore | null>(null)
```

## Core Slice Store
Use these files as the reference shape for slice-based core stores.
- `packages/ag-ui-view/src/core/helpers/isomorphic/store/index.ts`
- `packages/ag-ui-view/src/core/helpers/isomorphic/store/slices/core.ts`

Example excerpts:
```ts
export function createCoreAgentStore(config?: CoreSliceConfig) {
  return createStore<CoreSlice>()(
    immer((...args) => {
      const coreSlice = createCoreSlice()(...args)

      return coreSlice
    }),
  )
}
```
