import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

interface WelcomeStoreState {
  // Owner Address -> Dismissed (boolean)
  dismissals: Record<string, boolean>
  setDismissed: (ownerAddress: string, dismissed: boolean) => void
  getDismissed: (ownerAddress: string) => boolean
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

  const clearDismissals = () => {
    set((state) => {
      state.dismissals = {}
    })
  }

  return {
    dismissals: {},
    setDismissed,
    getDismissed,
    clearDismissals,
  }
})

const createPersistStore = persist(createWelcomeStore, {
  name: 'o2-welcome-dismissals',
  partialize: (state) => ({
    dismissals: state.dismissals,
  }),
})

export const useWelcomeStore = create<WelcomeStoreState>()(createPersistStore)

export const welcomeSelectors = {
  dismissals: (state: WelcomeStoreState) => state.dismissals,
  getDismissed: (state: WelcomeStoreState) => state.getDismissed,
  setDismissed: (state: WelcomeStoreState) => state.setDismissed,
  clearDismissals: (state: WelcomeStoreState) => state.clearDismissals,
}
