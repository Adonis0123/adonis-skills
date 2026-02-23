import { createStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface {{StoreName}}Props {
  // TODO: add props from component if needed
}

export interface {{StoreName}}StoreState extends {{StoreName}}Props {
  // TODO: add store state
}

export interface {{StoreName}}StoreActions {
  // TODO: add actions
}

const initialState: {{StoreName}}StoreState = {
}

export function create{{StoreName}}Store(initProps?: Partial<{{StoreName}}Props>) {
  return createStore<{{StoreName}}StoreState & {{StoreName}}StoreActions>()(immer((set) => ({
    ...initialState,
    ...initProps,
  })))
}

export type {{StoreName}}Store = ReturnType<typeof create{{StoreName}}Store>
