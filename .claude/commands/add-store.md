# Add Store: $ARGUMENTS

Create a new Zustand store named `$ARGUMENTS` following the O2 triple-middleware pattern.

## Steps

1. **Read the reference store** for the exact pattern:
   - `src/stores/useSessionStore.ts` (canonical example: immer + persist + subscribeWithSelector)
   - `src/stores/useTradingAccountStore.ts` (more complex state)

2. **Create the store file** at `src/stores/use${ARGUMENTS}Store.ts`:
   - Triple middleware: `immer` + `persist` + `subscribeWithSelector`
   - `STORAGE_VERSION` constant with migration function
   - `partialize` to control which fields are persisted
   - Exported selectors object
   - Address normalization to lowercase `0x${string}` where applicable

3. **Add types** if the store introduces new interfaces.

4. **Wire up** in relevant components using the exported hook and selectors.

## Store Template

```typescript
import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

interface ${ARGUMENTS}StoreState {
  // State fields
  data: Record<string, any>
  // Actions
  setData: (key: string, value: any) => void
  clearData: () => void
}

const STORAGE_VERSION = 1

const createStore = immer<${ARGUMENTS}StoreState>((set, get) => ({
  data: {},

  setData: (key: string, value: any) => {
    set((state) => {
      state.data[key] = value
    })
  },

  clearData: () => {
    set((state) => {
      state.data = {}
    })
  },
}))

const createPersistStore = persist(createStore, {
  name: 'o2-${ARGUMENTS.toLowerCase()}',
  version: STORAGE_VERSION,
  migrate: (persistedState: any, version) => {
    if (version < STORAGE_VERSION) {
      return { data: {} }
    }
    return persistedState
  },
  partialize: (state) => ({
    data: state.data,
  }),
})

const createSubscribedStore = subscribeWithSelector(createPersistStore)

export const use${ARGUMENTS}Store = create<${ARGUMENTS}StoreState>()(createSubscribedStore)

export const ${ARGUMENTS.toLowerCase()}Selectors = {
  data: (state: ${ARGUMENTS}StoreState) => state.data,
  setData: (state: ${ARGUMENTS}StoreState) => state.setData,
  clearData: (state: ${ARGUMENTS}StoreState) => state.clearData,
}
```

## Checklist

- [ ] Triple middleware applied: `immer` -> `persist` -> `subscribeWithSelector`
- [ ] `STORAGE_VERSION` constant defined with migration function
- [ ] `partialize` specifies exactly which fields to persist (exclude actions, derived state)
- [ ] Selectors object exported for consumer components
- [ ] Store name follows `o2-` prefix convention in persist config
- [ ] Address fields use lowercase `0x${string}` type where applicable
- [ ] No direct state mutation outside `set()` with immer
