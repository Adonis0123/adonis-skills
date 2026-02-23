import { memo, useRef } from 'react'

import { create{{StoreName}}Store } from '.'
import { {{StoreName}}Context } from './context'

import type { {{StoreName}}Props, {{StoreName}}Store } from '.'

type {{StoreName}}ProviderProps = React.PropsWithChildren<{{StoreName}}Props>

function {{StoreName}}Provider({ children, ...props }: {{StoreName}}ProviderProps) {
  const storeRef = useRef<{{StoreName}}Store | undefined>(undefined)
  if (!storeRef.current) {
    storeRef.current = create{{StoreName}}Store(props)
  }
  return (
    <{{StoreName}}Context.Provider value={storeRef.current}>
      {children}
    </{{StoreName}}Context.Provider>
  )
}

export default memo({{StoreName}}Provider)
