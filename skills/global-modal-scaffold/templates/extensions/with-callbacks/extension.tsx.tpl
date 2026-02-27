// {{PASCAL_NAME}} Global Modal Extension — With Callbacks Pattern
// Modal with useMountCallbacks for global event bridge integration.
// Allows non-React code (e.g., API interceptors) to trigger this modal.

import dynamic from 'next/dynamic'
// For React.lazy: import { lazy } from 'react'
import { defineGlobalModalExtension } from '../_helpers'
import { useMount{{PASCAL_NAME}}GlobalModalCallbacks } from './hooks/callbacks'

export const {{CAMEL_NAME}}GlobalModalExtension = defineGlobalModalExtension({
  key: '{{KEBAB_NAME}}',
  modal: dynamic(() => import('./components/{{PASCAL_NAME}}Modal')),
  // For React.lazy:
  // modal: lazy(() => import('./components/{{PASCAL_NAME}}Modal')),
  useMountCallbacks: useMount{{PASCAL_NAME}}GlobalModalCallbacks,
})
