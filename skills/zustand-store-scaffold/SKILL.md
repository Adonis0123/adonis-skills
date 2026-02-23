---
name: zustand-store-scaffold
description: "Scaffold type-safe Zustand stores with two patterns: web (component-level store + Context + Provider) and core (slice-based store with immer). Use when creating or updating Zustand stores, contexts, providers, or composing multiple feature slices."
metadata:
  version: "0.1.0"
---

# Zustand Store Scaffold

Quickly generate type-safe Zustand stores following your repository's established patterns.

## Quick Start

### Web Pattern (Component-level Store)
```bash
python3 ~/.claude/skills/zustand-store-scaffold/scripts/scaffold_zustand_store.py \
  --pattern web \
  --name ToolList \
  --path web/src/pages/_components/ToolList/store
```

Generates:
- `index.ts` - Store definition with createStore + immer
- `context.ts` - React Context and useContext hook
- `provider.tsx` - Provider component with memo

### Core Pattern (Slice-based Store)

**Single Slice:**
```bash
python3 ~/.claude/skills/zustand-store-scaffold/scripts/scaffold_zustand_store.py \
  --pattern core \
  --name CoreAgent \
  --path packages/ag-ui-view/src/core/helpers/isomorphic/store
```

**Multiple Slices (Interactive):**
```bash
python3 ~/.claude/skills/zustand-store-scaffold/scripts/scaffold_zustand_store.py \
  --pattern core \
  --name AppStore \
  --path src/store
# Will prompt: Enter slice names (comma-separated, or press Enter for 'core'):
# Example input: auth,user,ui
```

**Multiple Slices (Direct):**
```bash
python3 ~/.claude/skills/zustand-store-scaffold/scripts/scaffold_zustand_store.py \
  --pattern core \
  --name AppStore \
  --path src/store \
  --slices auth,user,ui
```

Generates:
- `index.ts` - Store factory with automatic slice composition
- `slices/[name].ts` - Individual slice files with StateCreator typing

## Options

| Option | Required | Description | Example |
|--------|----------|-------------|---------|
| `--pattern` | ✅ | Store pattern (`web` or `core`) | `--pattern web` |
| `--name` | ✅ | Store name in PascalCase | `--name ToolList` |
| `--path` | ✅ | Target directory path | `--path src/store` |
| `--slices` | ❌ | Comma-separated slice names (core pattern only) | `--slices auth,user,ui` |
| `--force` | ❌ | Overwrite existing files | `--force` |

**Note:** For `core` pattern without `--slices`, the script will interactively ask you to specify slice names.

## Choose the Right Pattern

| Pattern | Use When | Location Pattern | Slices |
|---------|----------|------------------|--------|
| **web** | Component-level state with Provider | `web/src/pages/_components/**/store` | N/A |
| **core** | Isomorphic/shared state with slices | `packages/**/store` | Single or multiple |

### When to Use Multiple Slices (Core Pattern)

Use multiple slices to organize complex state by feature domains:

| Scenario | Recommended Slices |
|----------|-------------------|
| Authentication app | `auth, user, session` |
| E-commerce store | `cart, products, user, ui` |
| Dashboard | `data, filters, ui, settings` |
| Chat application | `messages, contacts, ui, notifications` |

## Post-Generation Steps

After scaffolding, customize the generated files:

1. **Define State**: Update interface properties
   ```ts
   export interface ToolListStoreState {
     toolList: Tool[]  // Add your state fields
     isLoading: boolean
   }
   ```

2. **Add Actions**: Implement state mutations
   ```ts
   export interface ToolListStoreActions {
     setToolList: (list: Tool[]) => void  // Add your actions
     addTool: (tool: Tool) => void
   }
   ```

3. **Set Initial State**: Populate default values
   ```ts
   const initialState: ToolListStoreState = {
     toolList: [],
     isLoading: false,
   }
   ```

4. **Implement Actions** (in the store creator):
   ```ts
   return createStore()(immer((set) => ({
     ...initialState,
     setToolList: (toolList) => set({ toolList }),
     addTool: (tool) => set((state) => {
       state.toolList.push(tool)
     }),
   })))
   ```

## Usage Examples

### Web Store Usage
```tsx
// In your component file
import Provider from './store/provider'
import { useToolListContext } from './store/context'

function ToolListPage() {
  return (
    <Provider initialProp="value">
      <ToolListContent />
    </Provider>
  )
}

function ToolListContent() {
  const toolList = useToolListContext(s => s.toolList)
  const setToolList = useToolListContext(s => s.setToolList)
  // ...
}
```

### Core Store Usage
```ts
// Create store instance
import { createCoreAgentStore } from './store'

const store = createCoreAgentStore({
  initialState: { /* ... */ }
})

// Use with vanilla JS or React
const state = store.getState()
store.setState({ /* ... */ })
```

## References
- See `references/store-patterns.md` for real repository examples
- Check existing stores in your codebase for pattern consistency
