import type { StoreSetter } from '../types'

export interface {{SliceName}}SliceState {
  // TODO: add state
}

export class {{SliceName}}ActionImpl {
  readonly #set: StoreSetter<{{SliceName}}Slice>
  readonly #get: () => {{SliceName}}Slice

  constructor(set: StoreSetter<{{SliceName}}Slice>, get: () => {{SliceName}}Slice, _api?: unknown) {
    this.#set = set
    this.#get = get
  }

  // TODO: add action methods as arrow functions
  // example = (param: string): void => {
  //   this.#set({ /* state update */ })
  // }
}

export type {{SliceName}}SliceAction = Pick<{{SliceName}}ActionImpl, keyof {{SliceName}}ActionImpl>
export type {{SliceName}}Slice = {{SliceName}}SliceState & {{SliceName}}SliceAction

export interface {{SliceName}}SliceConfig {
  initialState?: Partial<{{SliceName}}SliceState>
}

export const create{{SliceName}}Slice = (...args: [any, any, any]) =>
  new {{SliceName}}ActionImpl(...args)
