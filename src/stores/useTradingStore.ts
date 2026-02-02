import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { TradingAccountBalances } from '../types/tradingAccount'

interface TradingStoreState {
  isTrading: boolean
  hasResumableSession: boolean
  showStrategyRecommendation: boolean
  walletAddress: string | null
  tradingAccount: any | null
  markets: any[]
  balances: TradingAccountBalances | null
  balancesLoading: boolean
  authReady: boolean
  authState: string

  setIsTrading: (isTrading: boolean) => void
  setHasResumableSession: (has: boolean) => void
  setShowStrategyRecommendation: (show: boolean) => void
  setWalletAddress: (address: string | null) => void
  setTradingAccount: (account: any | null) => void
  setMarkets: (markets: any[]) => void
  setBalances: (balances: TradingAccountBalances | null) => void
  setBalancesLoading: (loading: boolean) => void
  setAuthReady: (ready: boolean) => void
  setAuthState: (state: string) => void
  resetOnDisconnect: () => void
}

const createTradingStore = immer<TradingStoreState>((set) => ({
  isTrading: false,
  hasResumableSession: false,
  showStrategyRecommendation: false,
  walletAddress: null,
  tradingAccount: null,
  markets: [],
  balances: null,
  balancesLoading: false,
  authReady: false,
  authState: 'idle',

  setIsTrading: (isTrading) =>
    set((state) => {
      state.isTrading = isTrading
    }),
  setHasResumableSession: (has) =>
    set((state) => {
      state.hasResumableSession = has
    }),
  setShowStrategyRecommendation: (show) =>
    set((state) => {
      state.showStrategyRecommendation = show
    }),
  setWalletAddress: (address) =>
    set((state) => {
      state.walletAddress = address
    }),
  setTradingAccount: (account) =>
    set((state) => {
      state.tradingAccount = account
    }),
  setMarkets: (markets) =>
    set((state) => {
      state.markets = markets
    }),
  setBalances: (balances) =>
    set((state) => {
      state.balances = balances
    }),
  setBalancesLoading: (loading) =>
    set((state) => {
      state.balancesLoading = loading
    }),
  setAuthReady: (ready) =>
    set((state) => {
      state.authReady = ready
    }),
  setAuthState: (authState) =>
    set((state) => {
      state.authState = authState
    }),
  resetOnDisconnect: () =>
    set((state) => {
      state.isTrading = false
      state.hasResumableSession = false
      state.showStrategyRecommendation = false
      state.authReady = false
      state.authState = 'idle'
      state.walletAddress = null
      state.tradingAccount = null
      state.balances = null
    }),
}))

const createSubscribedStore = subscribeWithSelector(createTradingStore)

export const useTradingStore = create<TradingStoreState>()(createSubscribedStore)

export const tradingSelectors = {
  isTrading: (state: TradingStoreState) => state.isTrading,
  hasResumableSession: (state: TradingStoreState) => state.hasResumableSession,
  walletAddress: (state: TradingStoreState) => state.walletAddress,
  tradingAccount: (state: TradingStoreState) => state.tradingAccount,
  markets: (state: TradingStoreState) => state.markets,
  balances: (state: TradingStoreState) => state.balances,
  balancesLoading: (state: TradingStoreState) => state.balancesLoading,
  authReady: (state: TradingStoreState) => state.authReady,
  authState: (state: TradingStoreState) => state.authState,
}
