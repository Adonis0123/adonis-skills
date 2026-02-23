import { createStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { create{{SliceName}}Slice } from './slices/{{sliceName}}'

import type { {{SliceName}}Slice, {{SliceName}}SliceConfig } from './slices/{{sliceName}}'

export type * from './slices/{{sliceName}}'
export { create{{SliceName}}Slice }

export function create{{StoreName}}Store(config?: {{SliceName}}SliceConfig) {
  return createStore<{{SliceName}}Slice>()(
    immer((...args) => {
      const singleSlice = create{{SliceName}}Slice(config)(...args)

      return singleSlice
    }),
  )
}

export type {{StoreName}}StoreApi = ReturnType<typeof create{{StoreName}}Store>
