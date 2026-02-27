// Global Modal Hooks
// Generic hooks for interacting with the global modal store

import type { ExtensionKey } from '{{EXTENSION_KEY_TYPE}}'
import type { GlobalModalData } from './store-slice'

// NOTE: Adapt the store access pattern to your project.
// The examples below assume a Zustand-based useGlobalStoreSelector hook.
// Replace with your actual store selector hook.

/**
 * Read data for a specific modal by key.
 * Returns the modal data or undefined if the modal is not open.
 */
export function useTargetGlobalModalData<T = unknown>(key: ExtensionKey) {
  return useGlobalStoreSelector((state) => {
    return state.ui.openedGlobalModals.find((modal) => modal.key === key)?.data
  }) as T | undefined
}

/**
 * Full modal state hook — the primary API for working with global modals.
 *
 * Returns: { open, data, openModal, closeModal }
 *
 * IMPORTANT: If your modal has typed data, create a wrapper hook that calls
 * this with the correct generic type. Do not use this hook directly in
 * components when typed data is needed, as the type would be lost.
 *
 * @example
 * ```ts
 * // In your extension's hooks/index.ts:
 * export function useMyModalGlobalModalState() {
 *   return useGlobalModalState<MyModalData>('my-modal')
 * }
 * ```
 */
export function useGlobalModalState<T extends GlobalModalData | unknown = unknown>(
  key: ExtensionKey,
) {
  return useGlobalStoreSelector((state) => {
    const target = state.ui.openedGlobalModals.find((modal) => modal.key === key)
    return {
      /** Whether the modal is currently open */
      open: !!target,
      /** Typed modal data (undefined when closed) */
      data: target?.data as T extends GlobalModalData ? T : undefined,
      /** Open the modal with optional data */
      openModal: (data: T extends GlobalModalData ? T : undefined) => {
        state.ui.openGlobalModal(key, data)
      },
      /** Close the modal */
      closeModal: () => {
        state.ui.closeGlobalModal(key)
      },
    }
  })
}
