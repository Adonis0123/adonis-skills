// Global Modal Extension Helpers
// Provides the defineGlobalModalExtension factory and type definitions.

import type { TupleToUnion } from 'type-fest'

// --- Extension Interface ---

export interface GlobalModalExtension {
  /** Unique string key identifying this modal extension */
  key: string
  /** Lazily loaded modal component (use dynamic import) */
  modal: React.ElementType
  /**
   * Optional mount callbacks hook. Called unconditionally in the GlobalModals
   * orchestrator to maintain stable hook call order.
   * Use for registering global event handlers that can trigger the modal
   * from non-React code (e.g., API error interceptors).
   */
  useMountCallbacks?: () => void
}

// --- Factory Function ---

/**
 * Type-safe factory for defining a global modal extension.
 * Preserves the literal type of the `key` property for ExtensionKey inference.
 *
 * @example
 * ```ts
 * export const myModalExtension = defineGlobalModalExtension({
 *   key: 'my-modal',
 *   modal: lazy(() => import('./components/MyModal')),
 * })
 * ```
 */
export function defineGlobalModalExtension<const T extends GlobalModalExtension>(
  config: T,
) {
  return config
}

// --- Extensions Registry Template ---

// Import your extensions here:
// import { fooExtension } from './foo'
// import { barExtension } from './bar'

export const extensions = [
  // fooExtension,
  // barExtension,
] as const

export const extensionKeys = extensions.map((e) => e.key)

/**
 * Union type of all registered extension keys.
 * Automatically derived from the extensions array — no manual maintenance needed.
 * Adding a new extension to the array above automatically extends this type.
 */
export type ExtensionKey = TupleToUnion<typeof extensionKeys>
