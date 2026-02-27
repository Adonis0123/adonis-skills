// {{PASCAL_NAME}} Global Modal Callbacks
// Mount callbacks for global event bridge integration.
// This hook is called unconditionally in the GlobalModals orchestrator.

// Import your global handler hooks here.
// These are typically created with a createGlobalHandler factory:
//
// import { createGlobalHandler } from '@loc/react-utils/src/window'
// export const [useMountOpen{{PASCAL_NAME}}Handler, callOpen{{PASCAL_NAME}}Handler] =
//   createGlobalHandler<() => void>()
//
// Then `callOpen{{PASCAL_NAME}}Handler()` can be called from anywhere
// (API interceptors, error handlers, non-React code) to trigger the modal.

import { use{{PASCAL_NAME}}GlobalModalState } from '.'

// [USER] Import your global handler mount hook, e.g.:
// import { useMountOpen{{PASCAL_NAME}}Handler } from '@/components/GlobalErrorHandler/global-handlers'

export function useMount{{PASCAL_NAME}}GlobalModalCallbacks() {
  const { openModal } = use{{PASCAL_NAME}}GlobalModalState()

  // [USER] Register global handler that triggers openModal, e.g.:
  // useMountOpen{{PASCAL_NAME}}Handler(() => {
  //   openModal({
  //     // ... default data for programmatic open
  //   })
  // })

  // Additional mount-time side effects can be added here.
  // For example, listening to custom events, setting up subscriptions, etc.
}
