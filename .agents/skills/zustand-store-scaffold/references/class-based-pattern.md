# Class-Based Action Pattern

## Motivation

Function-based Zustand slices (interface + object-literal) require two-step navigation:
1. Find the interface definition
2. Find the matching implementation in the object literal

Class-based actions solve this — **Go to Definition** lands directly on the implementation.

### DX Comparison

| Aspect | Function-Based | Class-Based |
|--------|---------------|-------------|
| Go to Definition | Interface → implementation (2 hops) | Direct to method (1 hop) |
| `set`/`get` access | Closure capture (leaked in spread) | `#private` fields (hidden) |
| Slice composition | Manual spread | `flattenActions` (prototype-safe) |
| Type extraction | Manual `interface` + `type` | `Pick<Impl, keyof Impl>` |

## StoreSetter<T>

`StoreSetter<T>` is a type-safe overloaded setter matching Zustand's internal `StoreApi.setState`:

```ts
export interface StoreSetter<TStore> {
  (
    partial: TStore | Partial<TStore> | ((state: TStore) => TStore | Partial<TStore>),
    replace?: false | undefined,
    action?: any,
  ): void
  (state: TStore | ((state: TStore) => TStore), replace: true, action?: any): void
}
```

Use `StoreSetter` instead of raw `(partial: Partial<T>) => void` to get full Zustand setter semantics including `replace` mode and functional updates.

## flattenActions

`flattenActions` extracts methods from class instances by walking the prototype chain, binding each method to its original instance:

```ts
export const flattenActions = <T extends object>(actions: object[]): T => {
  const result = {} as T
  for (const action of actions) {
    let current: object | null = action
    while (current && current !== Object.prototype) {
      const keys = Object.getOwnPropertyNames(current)
      for (const key of keys) {
        if (key === 'constructor') continue
        if (key in result) continue
        const descriptor = Object.getOwnPropertyDescriptor(current, key)
        if (typeof descriptor?.value === 'function') {
          ;(result as any)[key] = descriptor.value.bind(action)
        }
      }
      current = Object.getPrototypeOf(current)
    }
  }
  return result
}
```

**Why prototype chain walking?** Arrow function properties live on the instance, but regular methods live on the prototype. Walking the chain handles both cases.

**Why `bind`?** Detached method references lose `this`. Binding preserves access to `#private` fields.

## #private Fields

Use ECMAScript `#private` fields (not TypeScript `private` keyword) for `set` and `get`:

```ts
class MyActionImpl {
  readonly #set: StoreSetter<MySlice>
  readonly #get: () => MySlice
  // ...
}
```

**Why `#private` over `private`?**
- `#private` is truly invisible at runtime — cannot be accessed via `(obj as any).#field`
- `private` is only a compile-time check — `(obj as any).set` still works
- `#private` fields are not enumerable, so `flattenActions` naturally skips them
- Spread operator (`...instance`) does not copy `#private` fields

## Pick<Impl, keyof Impl> Type Extraction

Extract the public action type from the class implementation:

```ts
export type MySliceAction = Pick<MyActionImpl, keyof MyActionImpl>
```

This creates a type containing only the public interface of the class (arrow function properties), excluding `#private` fields and the constructor. No need to maintain a separate interface.

## Multi-Class Slice Composition

Combine multiple class-based slices in a single store:

```ts
import { flattenActions } from './utils/flattenActions'
import { createAuthSlice } from './slices/auth'
import { createUserSlice } from './slices/user'

export function createAppStore(config?: AppSliceConfig) {
  return createStore<AppSlice>()(
    immer((...args) => ({
      ...config?.auth?.initialState,
      ...config?.user?.initialState,
      ...flattenActions<AuthSliceAction & UserSliceAction>([
        createAuthSlice(...args),
        createUserSlice(...args),
      ]),
    })),
  )
}
```

Each `create*Slice` returns a class instance. `flattenActions` merges all public methods into a flat object, with first-defined wins for name collisions.

## Do / Don't

### Do

- Use arrow functions for action methods (auto-binds `this`)
- Use `#private` for `set` and `get`
- Use `Pick<Impl, keyof Impl>` for action type extraction
- Pass `(...args: [any, any, any])` to slice creators for consistent signatures
- Use `flattenActions` for composing multiple slices

### Don't

- Don't use regular methods (they need explicit `.bind()` when detached)
- Don't use TypeScript `private` keyword (not truly private at runtime)
- Don't spread class instances directly (`...new Impl()` loses prototype methods)
- Don't manually maintain action interfaces (use `Pick` instead)
- Don't access `#set`/`#get` outside the class (by design)
