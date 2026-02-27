// {{PASCAL_NAME}} Global Modal Hooks — Basic Pattern
// Thin typed wrapper around useGlobalModalState.

import type { GlobalModalCoreData } from '{{MODAL_STATE_HOOK_IMPORT}}'

// --- Modal Data Interface ---

/** Extend this interface with your modal's specific data properties */
export interface {{PASCAL_NAME}}ModalData extends GlobalModalCoreData {
  // Example:
  // title: string
  // onConfirm?: () => void
}

// --- Hook ---

export function use{{PASCAL_NAME}}GlobalModalState() {
  return useGlobalModalState<{{PASCAL_NAME}}ModalData>('{{KEBAB_NAME}}')
}
