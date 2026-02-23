import type { StateCreator } from 'zustand'

export interface {{SliceName}}SliceState {
  // TODO: add state
}

export interface {{SliceName}}SliceActions {
  // TODO: add actions
}

export type {{SliceName}}Slice = {{SliceName}}SliceState & {{SliceName}}SliceActions

export interface {{SliceName}}SliceConfig {
  initialState?: Partial<{{SliceName}}SliceState>
}

export function create{{SliceName}}Slice<Slice = unknown>(config?: {{SliceName}}SliceConfig) {
  const { initialState } = config || {}

  const slice: StateCreator<
    {{SliceName}}Slice & Slice,
    [['zustand/immer', never]],
    [],
    {{SliceName}}Slice
  > = (set) => ({
    ...initialState,
  })

  return slice
}
