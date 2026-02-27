// Global Modal Store Slice
// Zustand UI slice for managing global modal state
// Integrates with your global store via {{STORE_TYPE}}

import type { StateCreator } from 'zustand'
import type { ExtensionKey } from '{{EXTENSION_KEY_TYPE}}'
import type { {{STORE_TYPE}} } from '../..'

// --- Core Data Interface ---

/** Base data interface for all global modals. All modal data types should extend this. */
export interface GlobalModalCoreData {
  /** Called when the modal is closed */
  onClose?: () => void
  /**
   * Called every time openGlobalModal is invoked for this key.
   * @param isFirstOpen - true when the modal is newly pushed to the stack,
   *                      false when data is updated for an already-open modal
   */
  onOpen?: (isFirstOpen: boolean) => void
}

/** Modal data combines core callbacks with arbitrary extension data */
export type GlobalModalData = GlobalModalCoreData & {
  [key: string]: any
}

// --- Slice Types ---

export interface UiSliceState {
  /** Array of currently opened modals (supports multiple concurrent modals) */
  openedGlobalModals: { key: ExtensionKey; data?: GlobalModalData }[]
}

export interface UiSliceActions {
  /**
   * Open a modal by key. If the modal is already open, updates its data
   * and calls onOpen(false). Otherwise pushes to the array and calls onOpen(true).
   */
  openGlobalModal: (key: ExtensionKey, data?: GlobalModalData) => void
  /**
   * Close a modal by key. Removes it from the array and calls data.onClose().
   */
  closeGlobalModal: (key: ExtensionKey) => void
}

export type UiSlice = UiSliceState & UiSliceActions

// --- Slice Creator ---

export const createUiSlice: StateCreator<
  {{STORE_TYPE}},
  [['zustand/immer', never]],
  [],
  UiSlice
> = (set, get) => ({
  openedGlobalModals: [],

  openGlobalModal: (key, data) => {
    set((state) => {
      const existing = state.ui.openedGlobalModals.find((m) => m.key === key)
      if (existing) {
        // Modal already open — update data, signal non-first open
        existing.data = data
        data?.onOpen?.(false)
      } else {
        // New modal — push to array, signal first open
        state.ui.openedGlobalModals.push({ key, data })
        data?.onOpen?.(true)
      }
    })
  },

  closeGlobalModal: (key) => {
    const modalToClose = get().ui.openedGlobalModals.find((m) => m.key === key)
    modalToClose?.data?.onClose?.()
    set((state) => {
      state.ui.openedGlobalModals = state.ui.openedGlobalModals.filter(
        (m) => m.key !== key,
      )
    })
  },
})
