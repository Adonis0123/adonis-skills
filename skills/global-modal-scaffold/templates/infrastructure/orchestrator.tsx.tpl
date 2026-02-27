// GlobalModals Orchestrator
// Renders all active global modals and invokes mount callbacks.
// Place this component at the bottom of your root layout.

import React, { useEffect, useRef } from 'react'
import { extensions } from '{{EXTENSIONS_IMPORT_PATH}}'
import type { ExtensionKey } from '{{EXTENSIONS_IMPORT_PATH}}'

// Placeholder hook for extensions without useMountCallbacks.
// Ensures consistent hook call order across renders.
function useDefaultMountCallbacks() {}

function GlobalModals() {
  // Read the currently opened modals from the store
  const openedModals = useGlobalStoreSelector((state) => {
    return state.ui.openedGlobalModals
  })

  // Track which modals have been mounted at least once
  const mountedRef = useRef<ExtensionKey[]>([])

  useEffect(() => {
    openedModals.forEach((modal) => {
      if (!mountedRef.current.includes(modal.key)) {
        mountedRef.current.push(modal.key)
      }
    })
  }, [openedModals])

  // IMPORTANT: Unconditionally iterate ALL extensions to call useMountCallbacks.
  // This maintains stable React hook call order regardless of which modals are open.
  extensions.map((item) => {
    if ('useMountCallbacks' in item && item.useMountCallbacks) {
      item.useMountCallbacks()
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useDefaultMountCallbacks()
  })

  return (
    <>
      {extensions.map((item) => {
        // Only render modals that have been opened via openGlobalModal
        const modalEntry = openedModals.find((modal) => modal.key === item.key)
        if (!modalEntry) return null

        const ModalComponent = item.modal
        return <ModalComponent key={item.key} data={modalEntry.data} />
      })}
    </>
  )
}

export default GlobalModals
