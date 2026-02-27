// {{PASCAL_NAME}} Global Modal Hooks — Enriched Pattern
// Wraps openModal to inject onOpen/onClose lifecycle side effects.

import { useMemoizedFn } from 'ahooks'
// For useCallback: import { useCallback } from 'react'
import type { GlobalModalCoreData } from '{{MODAL_STATE_HOOK_IMPORT}}'

// --- Modal Data Interface ---

/** Extend this interface with your modal's specific data properties */
export interface {{PASCAL_NAME}}ModalData extends GlobalModalCoreData {
  // Example:
  // detail: SomeDetailType
  // source?: string
}

// --- Hook ---

export function use{{PASCAL_NAME}}GlobalModalState() {
  const { openModal: _openModal, ...rest } = useGlobalModalState<{{PASCAL_NAME}}ModalData>('{{KEBAB_NAME}}')

  // Wrap openModal to inject lifecycle side effects.
  // useMemoizedFn ensures a stable function reference (no deps array needed).
  const openModal: typeof _openModal = useMemoizedFn((modalData) => {
    _openModal({
      ...modalData,
      onOpen: (isFirstOpen) => {
        // Call the caller's onOpen first
        modalData?.onOpen?.(isFirstOpen)

        // [USER] Add your onOpen side effects below.
        // Examples:
        //   - Analytics tracking (only on first open):
        //     if (isFirstOpen) { trackEvent('modal_opened', { name: '{{KEBAB_NAME}}' }) }
        //   - URL rewrite:
        //     window.history.replaceState({}, '', `/modal/{{KEBAB_NAME}}`)
      },
      onClose: () => {
        // Call the caller's onClose first
        modalData?.onClose?.()

        // [USER] Add your onClose side effects below.
        // Examples:
        //   - Restore URL:
        //     window.history.replaceState({}, '', previousPath)
        //   - Cleanup:
        //     resetSomeState()
      },
    })
  })

  // For useCallback pattern (if not using ahooks):
  // const openModal: typeof _openModal = useCallback((modalData) => {
  //   _openModal({ ...modalData, onOpen: ..., onClose: ... })
  // }, [_openModal])

  return { openModal, ...rest }
}
