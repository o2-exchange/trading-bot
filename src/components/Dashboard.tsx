import { useState, useEffect } from 'react'
import { walletService } from '../services/walletService'
import { sessionService } from '../services/sessionService'
import { tradingEngine } from '../services/tradingEngine'
import { tradingAccountService } from '../services/tradingAccountService'
import { marketService } from '../services/marketService'
import { authFlowService } from '../services/authFlowService'
import { tradingSessionService } from '../services/tradingSessionService'
import { useToast } from './ToastProvider'
import AuthFlowGuard from './AuthFlowGuard'
import TradingAccount from './TradingAccount'
import EligibilityCheck from './EligibilityCheck'
import MarketSelector from './MarketSelector'
import StrategyConfig from './StrategyConfig'
import OrderHistory from './OrderHistory'
import TradeHistory from './TradeHistory'
import Balances from './Balances'
import TradeConsole from './TradeConsole'
import CompetitionPanel from './CompetitionPanel'
import { balanceService } from '../services/balanceService'
import { TradingAccountBalances } from '../types/tradingAccount'
import { filterMarkets } from '../utils/marketFilters'
import { db } from '../services/dbService'
import './Dashboard.css'

interface DashboardProps {
  onDisconnect: () => void
}

export default function Dashboard({ onDisconnect }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'trades'>('dashboard')
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [tradingAccount, setTradingAccount] = useState<any>(null)
  const [isEligible, setIsEligible] = useState<boolean | null>(null)
  const [isTrading, setIsTrading] = useState(false)
  const [hasResumableSession, setHasResumableSession] = useState(false)
  const [markets, setMarkets] = useState<any[]>([])
  const [balances, setBalances] = useState<TradingAccountBalances | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [showStrategyRecommendation, setShowStrategyRecommendation] = useState(false)
  const { addToast } = useToast()

  // Fetch data when auth flow is ready (no duplicate initialization)
  useEffect(() => {
    const loadData = async () => {
      try {
        const wallet = walletService.getConnectedWallet()
        if (!wallet) {
          return
        }

        // Get wallet address
        const walletAddressString = typeof wallet.address === 'string' 
          ? wallet.address 
          : (wallet.address as any)?.toString?.() || String(wallet.address)
        setWalletAddress(walletAddressString)

        const normalizedAddress = walletAddressString.toLowerCase()

        // Get trading account from store or fetch if needed
        const account = await tradingAccountService.getTradingAccount(normalizedAddress)
        if (account) {
          setTradingAccount(account)
          // Initialize trading engine with account
          tradingEngine.initialize(normalizedAddress, account.id)
        }

        // Get eligibility from auth flow state
        const authState = authFlowService.getState()
        setIsEligible(authState.isWhitelisted)

        // Fetch markets (uses cache - auth flow already fetched)
        const marketsList = await marketService.fetchMarkets()
        setMarkets(filterMarkets(marketsList))

        // Fetch balances if we have trading account and markets
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

        // Check for resumable trading session
        const resumableSession = await tradingSessionService.getResumableSession(normalizedAddress)
        setHasResumableSession(!!resumableSession)
      } catch (error: any) {
        console.error('Failed to load dashboard data', error)
      }
    }

    // Only load data when auth flow is ready
    const unsubscribe = authFlowService.subscribe((state) => {
      if (state.state === 'ready') {
        loadData()
        // Update eligibility when auth flow state changes
        setIsEligible(state.isWhitelisted)
      } else if (state.isWhitelisted !== null && state.isWhitelisted !== undefined) {
        // Update eligibility even if not ready yet (e.g., during checkSituation)
        setIsEligible(state.isWhitelisted)
      }
    })

    // Load immediately if already ready
    const currentState = authFlowService.getState()
    if (currentState.state === 'ready') {
      loadData()
    }

    return unsubscribe
  }, [])

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

    // Check periodically when not trading (every 2 seconds)
    const interval = setInterval(() => {
      if (!isTrading) {
        checkStrategies()
      }
    }, 2000)

    // Also check when window regains focus
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
  }, [isTrading])

  // Subscribe to trading engine status updates when trading is active
  useEffect(() => {
    if (!isTrading) return

    // Subscribe to trading engine status updates
    const unsubscribe = tradingEngine.onStatus((message, type) => {
      console.log(`[TradingEngine] ${type}:`, message)
      // Show status messages as toasts
      addToast(message, type)
    })

    return unsubscribe
  }, [isTrading, addToast])

  // Subscribe to trade completion for balance updates
  useEffect(() => {
    if (!isTrading || !tradingAccount || !markets.length || !walletAddress) return

    const refreshBalances = async () => {
      // Silently update balances without showing loading state
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
  }, [isTrading, tradingAccount, markets, walletAddress])

  const handleStartTrading = async (resumeSession: boolean = false) => {
    if (!walletAddress || !tradingAccount) {
      addToast('Wallet or trading account not available', 'error')
      return
    }

    // Auth flow should have already created the session
    // Just verify it exists
    const normalizedAddress = walletAddress.toLowerCase()
    const session = await sessionService.getActiveSession(normalizedAddress)
    if (!session) {
      addToast('Session not ready. Please complete authentication.', 'error')
      return
    }

    // Check for active strategies
    const allConfigs = await db.strategyConfigs.toArray()
    const activeConfigs = allConfigs.filter((config) => config.isActive === true)

    if (activeConfigs.length === 0) {
      addToast('Please create and activate a strategy in the Strategy Configuration section first.', 'error')
      return
    }

    try {
      await tradingEngine.start({ resumeSession })
      setIsTrading(true)
      setHasResumableSession(false) // Clear resumable state since we're now trading
      addToast(resumeSession ? 'Trading session resumed' : 'New trading session started', 'success')
    } catch (error: any) {
      addToast(`Failed to start trading: ${error.message}`, 'error')
    }
  }

  const handleStopTrading = () => {
    tradingEngine.stop()
    setIsTrading(false)
    setHasResumableSession(true) // Session is now paused and can be resumed
    addToast('Trading stopped', 'info')
  }

  const handleDisconnect = async () => {
    await walletService.disconnect()
    onDisconnect()
  }

  const [copied, setCopied] = useState(false)

  const handleCopyAddress = async () => {
    if (walletAddress) {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  return (
    <AuthFlowGuard>
      <div className="dashboard">
        <div className="dashboard-header">
          <h1>o2 Trading Bot <span className="alpha-badge">Alpha</span></h1>
          <div className="header-actions">
            {walletAddress && (
              <button className="wallet-chip" onClick={handleCopyAddress} title={walletAddress}>
                <span className="wallet-dot"></span>
                <span className="wallet-address-text">{formatAddress(walletAddress)}</span>
                <span className="copy-icon">{copied ? '✓' : '⧉'}</span>
              </button>
            )}
            <button onClick={handleDisconnect} className="disconnect-button">
              Disconnect
            </button>
          </div>
        </div>

      <div className="dashboard-tabs">
        <button
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={activeTab === 'orders' ? 'active' : ''}
          onClick={() => setActiveTab('orders')}
        >
          Orders
        </button>
        <button
          className={activeTab === 'trades' ? 'active' : ''}
          onClick={() => setActiveTab('trades')}
        >
          Trades
        </button>
      </div>

      <div className="dashboard-content">
        {/* Dashboard tab - always mounted to preserve TradeConsole state */}
        <div className="tab-panel" style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
          <CompetitionPanel walletAddress={walletAddress} />
          <div className="dashboard-main">
            <div className="dashboard-left-column">
              <div className="controls-section">
                <TradingAccount account={tradingAccount} isEligible={isEligible} />

                <div className="trading-controls">
                  <h2>Trading Controls</h2>
                  {showStrategyRecommendation && (
                    <div className="strategy-recommendation-banner">
                      <span className="recommendation-text">
                        No active strategy configured. Please create and activate a strategy in the Strategy Configuration section below before starting trading.
                      </span>
                    </div>
                  )}
                  {!isTrading ? (
                    hasResumableSession ? (
                      <div className="trading-buttons-group">
                        <button onClick={() => handleStartTrading(true)} className="start-button resume-button">
                          Resume Session
                        </button>
                        <button onClick={() => handleStartTrading(false)} className="start-button new-session-button">
                          New Session
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => handleStartTrading(false)} className="start-button">
                        Start Trading
                      </button>
                    )
                  ) : (
                    <button onClick={handleStopTrading} className="stop-button">
                      Stop Trading
                    </button>
                  )}
                </div>

                <TradeConsole isTrading={isTrading} onViewOrders={() => setActiveTab('orders')} />
              </div>

              <div className="markets-section">
                <div className="section-header">
                  <h2>Available Markets</h2>
                </div>
                <div className="section-content">
                  <MarketSelector markets={markets} />
                </div>
              </div>
            </div>

            <div className="dashboard-right-column">
              <div className="balances-section">
                <div className="section-header">
                  <h2>Balances</h2>
                  <a
                    href="https://o2.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="deposit-link"
                  >
                    Deposit Funds on o2.app →
                  </a>
                </div>
                <div className="section-content">
                  <Balances balances={balances} loading={balancesLoading} />
                </div>
              </div>

              <div className="strategy-settings-section">
                <div className="section-header">
                  <h2>Strategy Configuration</h2>
                </div>
                <div className="section-content">
                  <StrategyConfig markets={markets} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {activeTab === 'orders' && (
          <OrderHistory />
        )}

        {activeTab === 'trades' && (
          <TradeHistory />
        )}
      </div>
      </div>
    </AuthFlowGuard>
  )
}

