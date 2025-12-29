import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { SessionInput } from '../types/contracts/TradeAccount'

// Trading Account ID (not wallet address!) -> SessionInput
// This matches O2's implementation where sessions are keyed by trading account
interface SessionStoreState {
  sessions: Record<`0x${string}`, SessionInput | null>
  setSession: (tradingAccountId: `0x${string}`, session: SessionInput | null) => void
  getSession: (tradingAccountId: `0x${string}`) => SessionInput | null
  clearSessions: () => void
  clearSessionForAccount: (tradingAccountId: `0x${string}`) => void
}

const STORAGE_VERSION = 2 // Increment version to force migration

const createSessionStore = immer<SessionStoreState>((set, get) => {
  const setSession = (tradingAccountId: `0x${string}`, session: SessionInput | null) => {
    set((state) => {
      const normalizedId = tradingAccountId.toLowerCase() as `0x${string}`
      state.sessions[normalizedId] = session
    })
  }

  const getSession = (tradingAccountId: `0x${string}`): SessionInput | null => {
    const normalizedId = tradingAccountId.toLowerCase() as `0x${string}`
    return get().sessions[normalizedId] || null
  }

  const clearSessions = () => {
    set((state) => {
      state.sessions = {}
    })
  }

  const clearSessionForAccount = (tradingAccountId: `0x${string}`) => {
    set((state) => {
      const normalizedId = tradingAccountId.toLowerCase() as `0x${string}`
      delete state.sessions[normalizedId]
    })
  }

  return {
    sessions: {},
    setSession,
    getSession,
    clearSessions,
    clearSessionForAccount,
  }
})

const createPersistStore = persist(createSessionStore, {
  name: 'o2-session',
  version: STORAGE_VERSION,
  migrate: (persistedState: any, version) => {
    if (version < STORAGE_VERSION) {
      // Force clear old sessions on migration
      return {
        sessions: {},
      }
    }
    return persistedState
  },
  partialize: (state) => ({
    sessions: state.sessions,
  }),
})

const createSubscribedStore = subscribeWithSelector(createPersistStore)

export const useSessionStore = create<SessionStoreState>()(createSubscribedStore)

export const sessionSelectors = {
  sessions: (state: SessionStoreState) => state.sessions,
  getSession: (state: SessionStoreState) => state.getSession,
  setSession: (state: SessionStoreState) => state.setSession,
  clearSessions: (state: SessionStoreState) => state.clearSessions,
  clearSessionForAccount: (state: SessionStoreState) => state.clearSessionForAccount,
}
