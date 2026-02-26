import { createStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { flattenActions } from './utils/flattenActions'
import { create{{SliceName}}Slice } from './slices/{{sliceName}}'

import type { {{SliceName}}Slice, {{SliceName}}SliceAction, {{SliceName}}SliceConfig } from './slices/{{sliceName}}'

export type * from './slices/{{sliceName}}'

export function create{{StoreName}}Store(config?: {{SliceName}}SliceConfig) {
  return createStore<{{SliceName}}Slice>()(
    immer((...args) => ({
      ...config?.initialState,
      ...flattenActions<{{SliceName}}SliceAction>([create{{SliceName}}Slice(...args)]),
    })),
  )
}

export type {{StoreName}}StoreApi = ReturnType<typeof create{{StoreName}}Store>
