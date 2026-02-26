import { createStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { flattenActions } from './utils/flattenActions'

import type { StoreSetter } from './types'

export interface {{StoreName}}Props {
  // TODO: add props from component if needed
}

export interface {{StoreName}}StoreState extends {{StoreName}}Props {
  // TODO: add store state
}

export class {{StoreName}}ActionImpl {
  readonly #set: StoreSetter<{{StoreName}}StoreState & {{StoreName}}StoreActions>
  readonly #get: () => {{StoreName}}StoreState & {{StoreName}}StoreActions

  constructor(
    set: StoreSetter<{{StoreName}}StoreState & {{StoreName}}StoreActions>,
    get: () => {{StoreName}}StoreState & {{StoreName}}StoreActions,
    _api?: unknown,
  ) {
    this.#set = set
    this.#get = get
  }

  // TODO: add action methods
}

export type {{StoreName}}StoreActions = Pick<{{StoreName}}ActionImpl, keyof {{StoreName}}ActionImpl>

const initialState: {{StoreName}}StoreState = {
}

export function create{{StoreName}}Store(initProps?: Partial<{{StoreName}}Props>) {
  return createStore<{{StoreName}}StoreState & {{StoreName}}StoreActions>()(
    immer((...args) => ({
      ...initialState,
      ...initProps,
      ...flattenActions<{{StoreName}}StoreActions>([new {{StoreName}}ActionImpl(...args)]),
    })),
  )
}

export type {{StoreName}}Store = ReturnType<typeof create{{StoreName}}Store>
