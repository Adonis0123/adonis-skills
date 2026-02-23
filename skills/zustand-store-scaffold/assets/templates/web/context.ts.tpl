import { createContext, useContext } from 'react'
import { useStore } from 'zustand'

import type { {{StoreName}}Store, {{StoreName}}StoreActions, {{StoreName}}StoreState } from '.'

export const {{StoreName}}Context = createContext<{{StoreName}}Store | null>(null)

export function use{{StoreName}}Context<T>(
  selector: (state: {{StoreName}}StoreState & {{StoreName}}StoreActions) => T,
) {
  const store = useContext({{StoreName}}Context)
  if (!store) {
    throw new Error('Missing {{StoreName}}Context.Provider in the tree')
  }
  return useStore(store, selector)
}
