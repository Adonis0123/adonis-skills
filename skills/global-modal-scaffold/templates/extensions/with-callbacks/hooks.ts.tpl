// {{PASCAL_NAME}} Global Modal Hooks — With Callbacks Pattern
// Same as enriched pattern: wraps openModal to inject lifecycle side effects.

import { useMemoizedFn } from 'ahooks'
// For useCallback: import { useCallback } from 'react'
import type { GlobalModalCoreData } from '{{MODAL_STATE_HOOK_IMPORT}}'

// --- Modal Data Interface ---

/** Extend this interface with your modal's specific data properties */
export interface {{PASCAL_NAME}}ModalData extends GlobalModalCoreData {
  // Example:
  // infoType: string
  // location?: string
}

// --- Hook ---

export function use{{PASCAL_NAME}}GlobalModalState() {
  const { openModal: _openModal, ...rest } = useGlobalModalState<{{PASCAL_NAME}}ModalData>('{{KEBAB_NAME}}')

  const openModal: typeof _openModal = useMemoizedFn((modalData) => {
    _openModal({
      ...modalData,
      onOpen: (isFirstOpen) => {
        modalData?.onOpen?.(isFirstOpen)

        // [USER] Add your onOpen side effects below.
        // Example: track analytics only on first open
        // if (isFirstOpen) {
        //   trackEvent('{{KEBAB_NAME}}_opened', { location: modalData.location })
        // }
      },
      onClose: () => {
        modalData?.onClose?.()

        // [USER] Add your onClose side effects below.
      },
    })
  })

  return { openModal, ...rest }
}
