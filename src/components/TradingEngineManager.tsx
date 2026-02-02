import { useEffect } from 'react'
import { walletService } from '../services/walletService'
import { tradingEngine } from '../services/tradingEngine'
import { tradingAccountService } from '../services/tradingAccountService'
import { marketService } from '../services/marketService'
import { authFlowService } from '../services/authFlowService'
import { tradingSessionService } from '../services/tradingSessionService'
import { balanceService } from '../services/balanceService'
import { useToast } from './ToastProvider'
import { useTradingStore } from '../stores/useTradingStore'
import { useWalletStore } from '../stores/useWalletStore'
import { filterMarkets } from '../utils/marketFilters'
import { db } from '../services/dbService'

/**
 * Always-mounted component that manages trading engine subscriptions.
 * Renders nothing — exists solely to keep subscriptions alive across route changes.
 */
export default function TradingEngineManager() {
  const { addToast } = useToast()
  const connectedWallet = useWalletStore((state) => state.connectedWallet)
  const isWalletConnected = !!connectedWallet

  const {
    isTrading,
    walletAddress,
    tradingAccount,
    markets,
    setIsTrading,
    setHasResumableSession,
    setShowStrategyRecommendation,
    setWalletAddress,
    setTradingAccount,
    setMarkets,
    setBalances,
    setBalancesLoading,
    setAuthReady,
    setAuthState,
    resetOnDisconnect,
  } = useTradingStore()

  // Reset local UI state when wallet disconnects
  useEffect(() => {
    if (!isWalletConnected) {
      resetOnDisconnect()
    }
  }, [isWalletConnected, resetOnDisconnect])

  // Subscribe to trading engine state changes
  useEffect(() => {
    const unsubscribe = tradingEngine.onTradingStateChange((isActive) => {
      setIsTrading(isActive)
      if (!isActive) {
        setHasResumableSession(true)
      }
    })
    return unsubscribe
  }, [setIsTrading, setHasResumableSession])

  // Set wallet address immediately when wallet connects
  useEffect(() => {
    if (isWalletConnected) {
      const wallet = walletService.getConnectedWallet()
      if (wallet) {
        const address = typeof wallet.address === 'string'
          ? wallet.address
          : (wallet.address as any)?.toString?.() || String(wallet.address)
        setWalletAddress(address)
      }
    }
  }, [isWalletConnected, setWalletAddress])

  // Fetch data when auth flow is ready
  useEffect(() => {
    const loadData = async () => {
      try {
        const wallet = walletService.getConnectedWallet()
        if (!wallet) return

        const walletAddressString = typeof wallet.address === 'string'
          ? wallet.address
          : (wallet.address as any)?.toString?.() || String(wallet.address)
        setWalletAddress(walletAddressString)

        const normalizedAddress = walletAddressString.toLowerCase()

        const account = await tradingAccountService.getTradingAccount(normalizedAddress)
        if (account) {
          setTradingAccount(account)
          tradingEngine.initialize(normalizedAddress, account.id)
        }

        const marketsList = await marketService.fetchMarkets()
        setMarkets(filterMarkets(marketsList))

        if (account && marketsList.length > 0) {
          setBalancesLoading(true)
          try {
            const accountBalances = await balanceService.getAllBalances(
              marketsList,
              account.id,
              walletAddressString
            )
            setBalances(accountBalances)
          } catch (error) {
            console.error('Failed to fetch balances', error)
          } finally {
            setBalancesLoading(false)
          }
        }

        const resumableSession = await tradingSessionService.getResumableSession(normalizedAddress)
        setHasResumableSession(!!resumableSession)
      } catch (error: any) {
        console.error('Failed to load dashboard data', error)
      }
    }

    const unsubscribe = authFlowService.subscribe((state) => {
      if (state.state === 'ready') {
        loadData()
      }
    })

    const currentState = authFlowService.getState()
    if (currentState.state === 'ready') {
      loadData()
    }

    return unsubscribe
  }, [setWalletAddress, setTradingAccount, setMarkets, setBalances, setBalancesLoading, setHasResumableSession])

  // Check for active strategies to show recommendation banner
  useEffect(() => {
    const checkStrategies = async () => {
      if (isTrading) {
        setShowStrategyRecommendation(false)
        return
      }

      const allConfigs = await db.strategyConfigs.toArray()
      const activeConfigs = allConfigs.filter((config) => config.isActive === true)
      setShowStrategyRecommendation(activeConfigs.length === 0)
    }

    checkStrategies()

    const interval = setInterval(() => {
      if (!isTrading) {
        checkStrategies()
      }
    }, 2000)

    const handleFocus = () => {
      if (!isTrading) {
        checkStrategies()
      }
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [isTrading, setShowStrategyRecommendation])

  // Subscribe to trading engine status updates (toast notifications)
  useEffect(() => {
    if (!isTrading) return

    const unsubscribe = tradingEngine.onStatus((message, type, verbosity = 'simple') => {
      console.log(`[TradingEngine] ${type}:`, message)

      const isOrderMessage = message.includes('order placed') || message.includes('filled')
      const isSuccessOrInfo = type === 'success' || type === 'info'

      if (verbosity === 'simple' && isOrderMessage && isSuccessOrInfo) {
        addToast(message, type)
      }
    })

    return unsubscribe
  }, [isTrading, addToast])

  // Subscribe to trade completion for balance updates
  useEffect(() => {
    if (!isTrading || !tradingAccount || !markets.length || !walletAddress) return

    const refreshBalances = async () => {
      try {
        const accountBalances = await balanceService.getAllBalances(
          markets,
          tradingAccount.id,
          walletAddress
        )
        setBalances(accountBalances)
      } catch (error) {
        console.error('Failed to refresh balances after trade', error)
      }
    }

    const unsubscribe = tradingEngine.onTradeComplete(() => {
      refreshBalances()
    })

    return unsubscribe
  }, [isTrading, tradingAccount, markets, walletAddress, setBalances])

  return null
}
