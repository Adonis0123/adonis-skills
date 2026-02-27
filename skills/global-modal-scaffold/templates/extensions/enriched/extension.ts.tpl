// {{PASCAL_NAME}} Global Modal Extension — Enriched Pattern
// Modal with onOpen/onClose lifecycle hooks injected in the hooks layer.

import dynamic from 'next/dynamic'
// For React.lazy: import { lazy } from 'react'
import { defineGlobalModalExtension } from '../_helpers'

export const {{CAMEL_NAME}}GlobalModalExtension = defineGlobalModalExtension({
  key: '{{KEBAB_NAME}}',
  modal: dynamic(() => import('./components/{{PASCAL_NAME}}Modal')),
  // For React.lazy:
  // modal: lazy(() => import('./components/{{PASCAL_NAME}}Modal')),
})
