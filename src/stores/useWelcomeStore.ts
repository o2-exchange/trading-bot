import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

interface WelcomeStoreState {
  // Owner Address -> Dismissed (boolean)
  dismissals: Record<string, boolean>
  // Global flag: has the user ever seen the welcome modal (regardless of wallet)
  globalDismissed: boolean
  setDismissed: (ownerAddress: string, dismissed: boolean) => void
  getDismissed: (ownerAddress: string) => boolean
  setGlobalDismissed: (dismissed: boolean) => void
  clearDismissals: () => void
}

const createWelcomeStore = immer<WelcomeStoreState>((set, get) => {
  const setDismissed = (ownerAddress: string, dismissed: boolean) => {
    set((state) => {
      const normalizedAddress = ownerAddress.toLowerCase()
      state.dismissals[normalizedAddress] = dismissed
    })
  }

  const getDismissed = (ownerAddress: string): boolean => {
    const normalizedAddress = ownerAddress.toLowerCase()
    return get().dismissals[normalizedAddress] || false
  }

  const setGlobalDismissed = (dismissed: boolean) => {
    set((state) => {
      state.globalDismissed = dismissed
    })
  }

  const clearDismissals = () => {
    set((state) => {
      state.dismissals = {}
    })
  }

  return {
    dismissals: {},
    globalDismissed: false,
    setDismissed,
    getDismissed,
    setGlobalDismissed,
    clearDismissals,
  }
})

const createPersistStore = persist(createWelcomeStore, {
  name: 'o2-welcome-dismissals',
  partialize: (state) => ({
    dismissals: state.dismissals,
    globalDismissed: state.globalDismissed,
  }),
})

export const useWelcomeStore = create<WelcomeStoreState>()(createPersistStore)

export const welcomeSelectors = {
  dismissals: (state: WelcomeStoreState) => state.dismissals,
  globalDismissed: (state: WelcomeStoreState) => state.globalDismissed,
  getDismissed: (state: WelcomeStoreState) => state.getDismissed,
  setDismissed: (state: WelcomeStoreState) => state.setDismissed,
  setGlobalDismissed: (state: WelcomeStoreState) => state.setGlobalDismissed,
  clearDismissals: (state: WelcomeStoreState) => state.clearDismissals,
}
